//! Skill Pack — 平台原生打包格式（PLAN-05 P1）。
//!
//! 格式：.skillpack = zip，内含 pack.json（机器层唯一事实源）+ README.md
//! （人类层）+ skills/<name>/（原样 skill 文件夹）+ 可选 i18n/ sidecar（P2）。
//! 所有函数接受显式 base 路径，便于测试注入；命令层传 config::packs_dir()。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::import;

pub const FORMAT_VERSION: u32 = 1;
/// 单次打包技能数上限（与 PLAN-05 §2.3 AI 输入预算对齐）
const MAX_SKILLS_PER_PACK: usize = 40;
/// 静态总结里单条 description 截断长度
const DESC_TRUNC: usize = 300;
const GENERATOR: &str = "SkillsShark 0.1.0";

// ---------------------------------------------------------------------------
// Manifest（pack.json schema v1）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackFileEntry {
    pub rel: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackSkillEntry {
    pub path: String,
    pub name: String,
    pub has_translation: bool,
    pub bytes: u64,
    pub files: Vec<PackFileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackSummary {
    /// "ai" | "static"
    pub source: String,
    pub overview: String,
    /// key = skill path（skills/<folder>），value = 一句话作用
    pub skills: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackManifest {
    pub format_version: u32,
    pub id: String,
    pub name: String,
    pub ver: String,
    pub author: String,
    pub created_at: String,
    pub generator: String,
    pub summary: PackSummary,
    #[serde(default)]
    pub i18n: Vec<String>,
    pub skills: Vec<PackSkillEntry>,
}

/// 前端 PackCard 展示用
#[derive(Debug, Clone, Serialize)]
pub struct PackInfo {
    pub id: String,
    pub name: String,
    pub ver: String,
    pub author: String,
    pub created_at: String,
    pub skill_count: usize,
    pub translated: usize,
    pub overview: String,
    /// summary.source：ai / static
    pub summary_source: String,
    pub skill_names: Vec<String>,
}

/// 打包输入：前端直接传扫描结果的字段（source_path = SKILL.md 绝对路径，
/// 避免虚拟 id 反解）。
#[derive(Debug, Clone, Deserialize)]
pub struct PackSkillInput {
    pub source_path: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub description_zh: String,
    #[serde(default)]
    pub has_translation: bool,
}

/// zip 内 pack.json 探测结果（ImportDialog 分流用）
#[derive(Debug, Clone, Serialize)]
pub struct PackDetect {
    pub name: String,
    pub ver: String,
    pub author: String,
    pub skill_count: usize,
    pub format_version: u32,
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| format!("读取失败 {}: {}", path.display(), e))?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Ok(hex_encode(&hasher.finalize()))
}

/// name → 目录安全的 slug id
fn slugify(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    // 折叠连续 '-'
    let mut out = String::new();
    let mut prev_dash = false;
    for c in s.chars() {
        if c == '-' {
            if !prev_dash {
                out.push(c);
            }
            prev_dash = true;
        } else {
            out.push(c);
            prev_dash = false;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() { "pack".to_string() } else { out }
}

/// packs/<id> 冲突时追加数字后缀
fn alloc_pack_dir(base: &Path, preferred: &str) -> String {
    if !base.join(preferred).exists() {
        return preferred.to_string();
    }
    let mut n = 2;
    loop {
        let cand = format!("{}-{}", preferred, n);
        if !base.join(&cand).exists() {
            return cand;
        }
        n += 1;
    }
}

/// 递归收集目录下所有文件：(相对路径斜杠式, sha256, 字节数)
fn collect_files(dir: &Path, base: &Path) -> Result<Vec<(String, String, u64)>, String> {
    let mut out = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let p = entry.path();
        if p.is_dir() {
            out.extend(collect_files(&p, base)?);
        } else if p.is_file() {
            let rel = p
                .strip_prefix(base)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            let sha = sha256_file(&p)?;
            let bytes = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            out.push((rel, sha, bytes));
        }
    }
    Ok(out)
}

fn read_manifest(dir: &Path) -> Result<PackManifest, String> {
    let text = fs::read_to_string(dir.join("pack.json"))
        .map_err(|e| format!("pack.json 读取失败: {}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("pack.json 解析失败: {}", e))
}

fn to_info(m: &PackManifest) -> PackInfo {
    PackInfo {
        id: m.id.clone(),
        name: m.name.clone(),
        ver: m.ver.clone(),
        author: m.author.clone(),
        created_at: m.created_at.clone(),
        skill_count: m.skills.len(),
        translated: m.skills.iter().filter(|s| s.has_translation).count(),
        overview: m.summary.overview.clone(),
        summary_source: m.summary.source.clone(),
        skill_names: m.skills.iter().map(|s| s.name.clone()).collect(),
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    let mut out: String = s.chars().take(max).collect();
    if s.chars().count() > max {
        out.push('…');
    }
    out
}

// ---------------------------------------------------------------------------
// 静态总结 + README（P1；P2 加 AI 分支）
// ---------------------------------------------------------------------------

fn build_static_summary(
    name: &str,
    author: &str,
    entries: &[(String, PackSkillInput)], // (folder, input)
) -> PackSummary {
    let names: Vec<&str> = entries.iter().map(|(_, s)| s.name.as_str()).collect();
    let overview = truncate_chars(
        &format!(
            "{} 打包的 {} 个技能合集：{}",
            if author.is_empty() { "未知作者" } else { author },
            entries.len(),
            names.join("、")
        ),
        200,
    );
    let _ = name;
    let mut skills = HashMap::new();
    for (folder, s) in entries {
        let desc = if !s.description_zh.trim().is_empty() {
            &s.description_zh
        } else {
            &s.description
        };
        let one = truncate_chars(desc.trim(), DESC_TRUNC);
        let one = if one.is_empty() { "（无描述）".to_string() } else { one };
        skills.insert(format!("skills/{}", folder), one);
    }
    PackSummary {
        source: "static".to_string(),
        overview,
        skills,
    }
}

fn render_readme(m: &PackManifest) -> String {
    let mut md = String::new();
    md.push_str(&format!("# {}\n\n", m.name));
    md.push_str(&format!(
        "> v{} · by {} · {} · 由 {} 生成\n\n",
        m.ver, m.author, m.created_at, m.generator
    ));
    md.push_str("## 概述\n\n");
    md.push_str(&m.summary.overview);
    md.push_str("\n\n## 技能清单\n\n");
    md.push_str("| 技能 | 说明 |\n| --- | --- |\n");
    for s in &m.skills {
        let desc = m
            .summary
            .skills
            .get(&s.path)
            .cloned()
            .unwrap_or_default()
            .replace('|', "/")
            .replace('\n', " ");
        let desc = truncate_chars(&desc, 120);
        md.push_str(&format!("| {} | {} |\n", s.name, desc));
    }
    md.push_str("\n---\n\n");
    md.push_str("本包由 SkillsShark 打包。用 SkillsShark 导入可获得完整体验（含翻译）；");
    md.push_str("手动解包后 skills/ 下每个文件夹也是标准 skill，可单独取用。\n");
    md
}

// ---------------------------------------------------------------------------
// 打包
// ---------------------------------------------------------------------------

/// 创建 canonical pack：packs/<id>/（temp 写入后 rename，防半写）。
pub fn create_pack(
    base: &Path,
    name: &str,
    ver: &str,
    author: &str,
    skills: &[PackSkillInput],
) -> Result<PackInfo, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Pack 名称不能为空".to_string());
    }
    if skills.is_empty() {
        return Err("至少选择 1 个技能".to_string());
    }
    if skills.len() > MAX_SKILLS_PER_PACK {
        return Err(format!("单次打包上限 {} 个技能", MAX_SKILLS_PER_PACK));
    }

    // 解析源目录 + 确定性改名（排序后分配，与选择顺序无关）
    let mut entries: Vec<(String, PathBuf, &PackSkillInput)> = Vec::new();
    for s in skills {
        let md_path = Path::new(&s.source_path);
        if !md_path.is_file() {
            return Err(format!("技能源文件不存在: {}", s.source_path));
        }
        let dir = md_path
            .parent()
            .ok_or_else(|| format!("非法路径: {}", s.source_path))?;
        let folder = dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|n| !n.is_empty())
            .ok_or_else(|| format!("无法取目录名: {}", dir.display()))?;
        entries.push((folder, dir.to_path_buf(), s));
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut placed: Vec<(String, PathBuf, &PackSkillInput)> = Vec::new();
    for (folder, dir, s) in entries {
        let mut target = folder.clone();
        let mut n = 2;
        while used.contains(&target) {
            target = format!("{}-{}", folder, n);
            n += 1;
        }
        used.insert(target.clone());
        placed.push((target, dir, s));
    }

    let id = alloc_pack_dir(base, &slugify(name));
    let tmp = base.join(format!(".tmp-{}", id));
    if tmp.exists() {
        fs::remove_dir_all(&tmp).map_err(|e| e.to_string())?;
    }
    let skills_root = tmp.join("skills");
    fs::create_dir_all(&skills_root).map_err(|e| e.to_string())?;

    let mut manifest_skills: Vec<PackSkillEntry> = Vec::new();
    let mut summary_inputs: Vec<(String, PackSkillInput)> = Vec::new();
    for (folder, src, s) in &placed {
        let dst = skills_root.join(folder);
        import::copy_dir_recursive(src, &dst)?;
        let files = collect_files(&dst, &dst)?;
        let bytes: u64 = files.iter().map(|(_, _, b)| b).sum();
        manifest_skills.push(PackSkillEntry {
            path: format!("skills/{}", folder),
            name: s.name.clone(),
            has_translation: s.has_translation,
            bytes,
            files: files
                .into_iter()
                .map(|(rel, sha, _)| PackFileEntry { rel, sha256: sha })
                .collect(),
        });
        summary_inputs.push((folder.clone(), (*s).clone()));
    }

    let manifest = PackManifest {
        format_version: FORMAT_VERSION,
        id: id.clone(),
        name: name.to_string(),
        ver: if ver.trim().is_empty() { "1.0.0".to_string() } else { ver.trim().to_string() },
        author: author.trim().to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        generator: GENERATOR.to_string(),
        summary: build_static_summary(name, author, &summary_inputs),
        i18n: Vec::new(),
        skills: manifest_skills,
    };

    fs::write(
        tmp.join("pack.json"),
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::write(tmp.join("README.md"), render_readme(&manifest)).map_err(|e| e.to_string())?;

    // temp → 正式目录（原子化收尾）
    let final_dir = base.join(&id);
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &final_dir).map_err(|e| {
        let _ = fs::remove_dir_all(&tmp);
        format!("落盘失败: {}", e)
    })?;

    crate::config::debug_log(&format!(
        "pack_create: id={} skills={} name={}",
        id,
        manifest.skills.len(),
        name
    ));
    Ok(to_info(&manifest))
}

// ---------------------------------------------------------------------------
// 列表 / 删除
// ---------------------------------------------------------------------------

pub fn list_packs(base: &Path) -> Vec<PackInfo> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(base) else {
        return out;
    };
    for e in entries.filter_map(|e| e.ok()) {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        match read_manifest(&p) {
            Ok(m) => out.push(to_info(&m)),
            Err(err) => {
                crate::config::debug_log(&format!(
                    "packs_list skip {}: {}",
                    p.display(),
                    err
                ));
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

pub fn delete_pack(base: &Path, id: &str) -> Result<(), String> {
    let dir = base.join(id);
    if !dir.join("pack.json").is_file() {
        return Err(format!("Pack 不存在: {}", id));
    }
    fs::remove_dir_all(&dir).map_err(|e| format!("删除失败: {}", e))
}

// ---------------------------------------------------------------------------
// 导出（canonical → .skillpack zip）
// ---------------------------------------------------------------------------

fn zip_dir(dir: &Path, dest: &Path) -> Result<u64, String> {
    let file = fs::File::create(dest).map_err(|e| format!("创建导出文件失败: {}", e))?;
    let mut zw = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default();
    let files = collect_files(dir, dir)?;
    for (rel, _, _) in &files {
        zw.start_file(rel, opts).map_err(|e| e.to_string())?;
        let mut f = fs::File::open(dir.join(rel)).map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        zw.write_all(&buf).map_err(|e| e.to_string())?;
    }
    zw.finish().map_err(|e| format!("zip 写入失败: {}", e))?;
    fs::metadata(dest).map(|m| m.len()).map_err(|e| e.to_string())
}

pub fn export_pack(base: &Path, id: &str, dest: &Path) -> Result<u64, String> {
    let dir = base.join(id);
    if !dir.join("pack.json").is_file() {
        return Err(format!("Pack 不存在: {}", id));
    }
    let size = zip_dir(&dir, dest)?;
    crate::config::debug_log(&format!(
        "pack_export: id={} dest={} bytes={}",
        id,
        dest.display(),
        size
    ));
    Ok(size)
}

// ---------------------------------------------------------------------------
// 探测 / 导入
// ---------------------------------------------------------------------------

/// zip 内找 pack.json（根或单层包裹目录下），返回摘要信息
pub fn detect_pack(zip_path: &Path) -> Option<PackDetect> {
    let file = fs::File::open(zip_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut candidates: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let Ok(entry) = archive.by_index(i) else {
            continue;
        };
        let name = entry.name().replace('\\', "/");
        let segs: Vec<&str> = name.split('/').filter(|s| !s.is_empty()).collect();
        if segs.last() == Some(&"pack.json") && segs.len() <= 2 {
            candidates.push(name);
        }
    }
    // 优先根级；其次唯一包裹目录
    let pick = if candidates.iter().any(|c| c == "pack.json") {
        Some("pack.json".to_string())
    } else if candidates.len() == 1 {
        candidates.into_iter().next()
    } else {
        None
    }?;
    let mut entry = archive.by_name(&pick).ok()?;
    let mut text = String::new();
    entry.read_to_string(&mut text).ok()?;
    let m: PackManifest = serde_json::from_str(&text).ok()?;
    Some(PackDetect {
        name: m.name,
        ver: m.ver,
        author: m.author,
        skill_count: m.skills.len(),
        format_version: m.format_version,
    })
}

/// 导入 .skillpack：版本闸 → sha256 自验 → 落 packs/<id>。
/// id 冲突自动追加后缀（不覆盖已有 pack）。
pub fn import_pack(base: &Path, zip_path: &Path) -> Result<PackInfo, String> {
    let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
    import::extract_safely(zip_path, tmp.path())?;

    // pack.json 定位：优先根级；否则仅当唯一子目录内含 pack.json 才解包裹。
    // 注意不能复用 import::unwrap_single_dir——本格式的 skills/ 恰好是
    // 唯一顶层目录，会被误判成包裹层。
    let root = if tmp.path().join("pack.json").is_file() {
        tmp.path().to_path_buf()
    } else {
        let dirs: Vec<PathBuf> = fs::read_dir(tmp.path())
            .map(|e| e.filter_map(|x| x.ok()).map(|x| x.path()).filter(|p| p.is_dir()).collect())
            .unwrap_or_default();
        if dirs.len() == 1 && dirs[0].join("pack.json").is_file() {
            dirs[0].clone()
        } else {
            tmp.path().to_path_buf()
        }
    };

    let manifest_path = root.join("pack.json");
    if !manifest_path.is_file() {
        return Err("非 Skill Pack：缺少 pack.json".to_string());
    }
    let text = fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
    let m: PackManifest =
        serde_json::from_str(&text).map_err(|e| format!("pack.json 解析失败: {}", e))?;

    if m.format_version > FORMAT_VERSION {
        return Err(format!(
            "该包由更新版本的 SkillsShark 生成（format v{}），请升级后再导入",
            m.format_version
        ));
    }

    // sha256 自验
    for s in &m.skills {
        let rel = s.path.trim_start_matches("skills/");
        let skill_dir = root.join("skills").join(rel);
        if !skill_dir.is_dir() {
            return Err(format!("包内缺少技能目录: {}", s.path));
        }
        for f in &s.files {
            let fp = skill_dir.join(&f.rel);
            if !fp.is_file() {
                return Err(format!("包内缺少文件: {}/{}", s.path, f.rel));
            }
            let sha = sha256_file(&fp)?;
            if sha != f.sha256 {
                return Err(format!("文件校验失败（sha256 不符）: {}/{}", s.path, f.rel));
            }
        }
    }

    let id = alloc_pack_dir(base, &m.id);
    let target = base.join(&id);
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    for item in ["pack.json", "README.md"] {
        let src = root.join(item);
        if src.is_file() {
            fs::copy(&src, target.join(item)).map_err(|e| e.to_string())?;
        }
    }
    if root.join("i18n").is_dir() {
        import::copy_dir_recursive(&root.join("i18n"), &target.join("i18n"))?;
    }
    import::copy_dir_recursive(&root.join("skills"), &target.join("skills"))?;

    // id 被改名时同步 manifest，保证后续导出/安装一致
    if id != m.id {
        let mut m2 = m.clone();
        m2.id = id.clone();
        fs::write(
            target.join("pack.json"),
            serde_json::to_string_pretty(&m2).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        crate::config::debug_log(&format!(
            "pack_import: id conflict, {} -> {}",
            m.id, id
        ));
        return Ok(to_info(&m2));
    }

    crate::config::debug_log(&format!(
        "pack_import: id={} skills={}",
        id,
        m.skills.len()
    ));
    Ok(to_info(&m))
}

// ---------------------------------------------------------------------------
// 安装（packs/<id> → imported 库，pack = 一个合集）
// ---------------------------------------------------------------------------

/// 安装：skills/* 逐目录拷入 imported/<stem>；stem 冲突自动追加后缀。
pub fn install_pack(pack_base: &Path, imported_base: &Path, id: &str) -> Result<usize, String> {
    let dir = pack_base.join(id);
    let m = read_manifest(&dir).map_err(|_| format!("Pack 不存在: {}", id))?;

    let stem0 = import::sanitize_stem(&m.name);
    let mut stem = stem0.clone();
    let mut n = 2;
    while imported_base.join(&stem).exists() {
        stem = format!("{}-{}", stem0, n);
        n += 1;
    }
    let target = imported_base.join(&stem);
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;

    let mut records: Vec<serde_json::Value> = Vec::new();
    for s in &m.skills {
        let folder = s.path.trim_start_matches("skills/");
        let src = dir.join("skills").join(folder);
        if !src.is_dir() {
            return Err(format!("Pack 内缺少技能目录: {}", s.path));
        }
        import::copy_dir_recursive(&src, &target.join(folder))?;
        records.push(serde_json::json!({ "rel": folder, "folder": folder }));
    }

    let prov = serde_json::json!({
        "source": format!("pack:{}", m.id),
        "kind": "pack",
        "imported_at": chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%z").to_string(),
        "skills": records,
    });
    fs::write(
        target.join(".import.json"),
        serde_json::to_string_pretty(&prov).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    crate::config::debug_log(&format!(
        "pack_install: pack={} -> imported/{} skills={}",
        id,
        stem,
        m.skills.len()
    ));
    Ok(m.skills.len())
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn write_skill(dir: &Path, name: &str, desc: &str) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {}\ndescription: {}\n---\n# {}\nbody\n", name, desc, name),
        )
        .unwrap();
        fs::write(dir.join("ref.md"), "resource").unwrap();
    }

    fn input(dir: &Path, name: &str, desc: &str) -> PackSkillInput {
        PackSkillInput {
            source_path: dir.join("SKILL.md").to_string_lossy().to_string(),
            name: name.to_string(),
            description: desc.to_string(),
            description_zh: String::new(),
            has_translation: false,
        }
    }

    #[test]
    fn create_list_export_import_install_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let src_root = tmp.path().join("src");
        write_skill(&src_root.join("alpha"), "alpha", "desc alpha");
        write_skill(&src_root.join("beta"), "beta", "desc beta");

        let pack_base = tmp.path().join("packs");
        let imported = tmp.path().join("imported");

        // 创建
        let info = create_pack(
            &pack_base,
            "My Test Pack",
            "1.2.0",
            "tester",
            &[
                input(&src_root.join("alpha"), "alpha", "desc alpha"),
                input(&src_root.join("beta"), "beta", "desc beta"),
            ],
        )
        .unwrap();
        assert_eq!(info.id, "my-test-pack");
        assert_eq!(info.skill_count, 2);
        assert!(pack_base.join("my-test-pack/pack.json").is_file());
        assert!(pack_base.join("my-test-pack/README.md").is_file());
        assert!(pack_base.join("my-test-pack/skills/alpha/SKILL.md").is_file());
        // 根目录无 SKILL.md（格式红线）
        assert!(!pack_base.join("my-test-pack/SKILL.md").exists());

        // 列表
        let list = list_packs(&pack_base);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "My Test Pack");

        // 导出
        let zip_path = tmp.path().join("out.skillpack");
        let size = export_pack(&pack_base, "my-test-pack", &zip_path).unwrap();
        assert!(size > 0);

        // 探测
        let detect = detect_pack(&zip_path).unwrap();
        assert_eq!(detect.name, "My Test Pack");
        assert_eq!(detect.skill_count, 2);

        // 导入（新 base，id 冲突场景用第二个 base 验证改名）
        let import_base = tmp.path().join("packs2");
        let info2 = import_pack(&import_base, &zip_path).unwrap();
        assert_eq!(info2.id, "my-test-pack");
        let info3 = import_pack(&import_base, &zip_path).unwrap();
        assert_eq!(info3.id, "my-test-pack-2");

        // 安装
        let n = install_pack(&import_base, &imported, "my-test-pack").unwrap();
        assert_eq!(n, 2);
        assert!(imported.join("My Test Pack/alpha/SKILL.md").is_file());
        assert!(imported.join("My Test Pack/beta/ref.md").is_file());
        assert!(imported.join("My Test Pack/.import.json").is_file());
        // 再装一次 → stem 自动后缀
        install_pack(&import_base, &imported, "my-test-pack").unwrap();
        assert!(imported.join("My Test Pack-2/alpha/SKILL.md").is_file());
    }

    #[test]
    fn tampered_file_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let src_root = tmp.path().join("src");
        write_skill(&src_root.join("alpha"), "alpha", "d");

        let pack_base = tmp.path().join("packs");
        create_pack(
            &pack_base,
            "Tamper",
            "1.0.0",
            "t",
            &[input(&src_root.join("alpha"), "alpha", "d")],
        )
        .unwrap();
        let zip_path = tmp.path().join("t.skillpack");
        export_pack(&pack_base, "tamper", &zip_path).unwrap();

        // 解包篡改后重压：sha256 不符 → 拒绝
        let ex = tmp.path().join("ex");
        import::extract_safely(&zip_path, &ex).unwrap();
        fs::write(ex.join("skills/alpha/SKILL.md"), "hacked").unwrap();
        let evil = tmp.path().join("evil.skillpack");
        zip_dir(&ex, &evil).unwrap();

        let err = import_pack(&tmp.path().join("packs3"), &evil).unwrap_err();
        assert!(err.contains("sha256"));
    }

    #[test]
    fn future_version_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let src_root = tmp.path().join("src");
        write_skill(&src_root.join("alpha"), "alpha", "d");

        let pack_base = tmp.path().join("packs");
        create_pack(
            &pack_base,
            "Future",
            "1.0.0",
            "t",
            &[input(&src_root.join("alpha"), "alpha", "d")],
        )
        .unwrap();

        // 手改 format_version 后重压
        let mp = pack_base.join("future/pack.json");
        let mut m: PackManifest =
            serde_json::from_str(&fs::read_to_string(&mp).unwrap()).unwrap();
        m.format_version = FORMAT_VERSION + 1;
        fs::write(&mp, serde_json::to_string_pretty(&m).unwrap()).unwrap();
        let zip_path = tmp.path().join("f.skillpack");
        export_pack(&pack_base, "future", &zip_path).unwrap();

        let err = import_pack(&tmp.path().join("packs4"), &zip_path).unwrap_err();
        assert!(err.contains("升级"));
    }

    #[test]
    fn non_pack_zip_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("plain.zip");
        let file = fs::File::create(&zip_path).unwrap();
        let mut zw = zip::ZipWriter::new(file);
        zw.start_file("skills/a/SKILL.md", zip::write::SimpleFileOptions::default())
            .unwrap();
        zw.write_all(b"---\nname: a\n---\n").unwrap();
        zw.finish().unwrap();
        assert!(detect_pack(&zip_path).is_none());
        let err = import_pack(&tmp.path().join("packs5"), &zip_path).unwrap_err();
        assert!(err.contains("pack.json"));
    }

    #[test]
    fn collision_rename_deterministic() {
        let tmp = tempfile::tempdir().unwrap();
        let src_root = tmp.path().join("src");
        // 两个同名目录（不同父级）→ 第二个自动 -2
        write_skill(&src_root.join("a/tool"), "tool", "d1");
        write_skill(&src_root.join("b/tool"), "tool", "d2");
        let pack_base = tmp.path().join("packs");
        let info = create_pack(
            &pack_base,
            "Dup",
            "1.0.0",
            "t",
            &[
                input(&src_root.join("a/tool"), "tool", "d1"),
                input(&src_root.join("b/tool"), "tool", "d2"),
            ],
        )
        .unwrap();
        assert_eq!(info.skill_count, 2);
        assert!(pack_base.join("dup/skills/tool/SKILL.md").is_file());
        assert!(pack_base.join("dup/skills/tool-2/SKILL.md").is_file());
    }
}
