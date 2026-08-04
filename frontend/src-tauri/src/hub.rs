//! Hub 引用层（PLAN-06 §2.7 / 模块 B）
//!
//! 只做磁盘操作 + 账本，不做 UI、不做业务决策。命令包装在 commands（B5）。
//!
//! 安全不变量：
//! 1. 引用落点只能是注册表中 linkable 工具的 skills 目录（§2.6 解析序：
//!    第一个存在的候选；都不存在则第一个可展开者，按需创建）——永不接受任意目标路径；
//! 2. unlink 只移除 junction 本身（reparse point），永不触碰指向内容；
//!    删除前验证磁盘形态仍是 junction，被替换为真实目录则拒绝；
//! 3. 名字冲突 / 同源同目标重复引用 → 报错不覆盖；
//! 4. 落盘后校验失败 → 回滚已写内容。

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::config::{self, ToolEntry};

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

/// 用户操作语义
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LinkMode {
    Link,
    Copy,
    /// 移动 = 复制 + 原件进回收站；账本按 Copy 记录（§2.7：移动完成后账本是干净的）
    Move,
}

/// 账本记录语义（Move 归一为 Copy）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LedgerMode {
    Link,
    Copy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HubLink {
    pub id: String,
    pub skill_name: String,
    /// 出处目录（Move 模式记录原件原路径，供溯源；原件已进回收站）
    pub source: String,
    /// 磁盘上实际存在的技能目录（junction 或副本实体），绝对路径
    pub target: String,
    /// 引用目标工具 id（注册表工具）
    pub target_tool: String,
    pub mode: LedgerMode,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinksLedger {
    #[serde(default = "ledger_version")]
    pub version: u32,
    #[serde(default)]
    pub links: Vec<HubLink>,
}

fn ledger_version() -> u32 {
    1
}

impl Default for LinksLedger {
    fn default() -> Self {
        LinksLedger { version: 1, links: vec![] }
    }
}

fn ledger_path(base: &Path) -> PathBuf {
    base.join("links.json")
}

pub fn load_ledger(base: &Path) -> LinksLedger {
    let path = ledger_path(base);
    if !path.exists() {
        return LinksLedger::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<LinksLedger>(&text).ok())
        .unwrap_or_else(|| {
            config::debug_log(&format!(
                "hub: links.json 解析失败，启用空账本: {}",
                path.display()
            ));
            LinksLedger::default()
        })
}

pub fn save_ledger(base: &Path, ledger: &LinksLedger) -> Result<(), String> {
    let _ = fs::create_dir_all(base);
    let json = serde_json::to_string_pretty(ledger).map_err(|e| e.to_string())?;
    fs::write(ledger_path(base), json).map_err(|e| format!("账本写入失败: {}", e))
}

fn gen_link_id(source: &Path, target: &Path) -> String {
    use std::hash::{Hash, Hasher};
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (source.to_string_lossy(), target.to_string_lossy()).hash(&mut h);
    format!("{}-{:x}", ts, h.finish())
}

// ---------------------------------------------------------------------------
// 目标解析（§2.6：第一个存在的候选；都不存在则第一个可展开者）
// ---------------------------------------------------------------------------

/// 解析引用落点：linkable 注册表工具的 skills 目录。
/// app_owned 来源与不可链接工具一律拒绝（安全边界）。
pub fn resolve_target_root(tools: &[ToolEntry], tool_id: &str) -> Result<PathBuf, String> {
    let tool = tools
        .iter()
        .find(|t| t.id == tool_id)
        .ok_or_else(|| format!("工具不存在: {}", tool_id))?;
    if tool.app_owned || !tool.linkable {
        return Err(format!("「{}」是应用自有来源，不能作为引用落点", tool.name));
    }
    let mut first_expandable: Option<PathBuf> = None;
    for c in &tool.paths {
        if let Some(p) = config::expand_path(c) {
            if p.is_dir() {
                return Ok(p);
            }
            if first_expandable.is_none() {
                first_expandable = Some(p);
            }
        }
    }
    first_expandable.ok_or_else(|| format!("工具「{}」无可用路径（候选均无法展开）", tool.name))
}

// ---------------------------------------------------------------------------
// 核心操作
// ---------------------------------------------------------------------------

/// link/copy/move 入口：source 技能目录 → target_tool 的 skills 目录。
/// base = 数据目录（links.json 所在）。
pub fn link_skill(
    base: &Path,
    source: &Path,
    target_tool_id: &str,
    mode: LinkMode,
) -> Result<HubLink, String> {
    let cfg = config::load_config();
    let root = resolve_target_root(&cfg.tools, target_tool_id)?;
    link_skill_to_dir(base, source, &root, target_tool_id, mode)
}

/// 显式目标目录版本（测试与内部复用）。
pub fn link_skill_to_dir(
    base: &Path,
    source: &Path,
    target_root: &Path,
    target_tool_id: &str,
    mode: LinkMode,
) -> Result<HubLink, String> {
    // 源校验：目录 + 含 SKILL.md（枢纽只处理合法 skill，§1.6 生态白名单前提）
    if !source.is_dir() {
        return Err(format!("源不是目录: {}", source.display()));
    }
    if !source.join("SKILL.md").is_file() {
        return Err(format!(
            "源缺少 SKILL.md，不是有效技能: {}",
            source.display()
        ));
    }
    let source_abs = fs::canonicalize(source)
        .map_err(|e| format!("源路径规范化失败: {}", e))?;
    let name = source_abs
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "无法取得技能目录名".to_string())?;
    let dest = target_root.join(&name);

    let mut ledger = load_ledger(base);
    if dest_exists(&dest) {
        return Err(format!(
            "目标已有同名技能「{}」（{}），拒绝覆盖",
            name,
            dest.display()
        ));
    }
    let source_str = source_abs.to_string_lossy().to_string();
    if ledger
        .links
        .iter()
        .any(|l| l.source == source_str && l.target_tool == target_tool_id)
    {
        return Err(format!("「{}」已引用到该工具，重复操作被拒绝", name));
    }

    fs::create_dir_all(target_root)
        .map_err(|e| format!("目标目录创建失败: {}", e))?;

    let ledger_mode = match mode {
        LinkMode::Link => {
            junction::create(&source_abs, &dest)
                .map_err(|e| format!("junction 创建失败: {}", e))?;
            if !is_junction(&dest) {
                let _ = junction::delete(&dest);
                return Err("junction 创建后校验失败，已回滚".to_string());
            }
            LedgerMode::Link
        }
        LinkMode::Copy => {
            copy_tree(&source_abs, &dest)?;
            LedgerMode::Copy
        }
        LinkMode::Move => {
            copy_tree(&source_abs, &dest)?;
            if let Err(e) = trash::delete(&source_abs) {
                // 原件未进回收站 → 回滚副本，保持原子性（源不动则目标不留孤儿）
                let _ = fs::remove_dir_all(&dest);
                return Err(format!("原件移入回收站失败，已回滚副本: {}", e));
            }
            LedgerMode::Copy // §2.7：Move 落账本为 copy（原件已走，无引用关系）
        }
    };

    if !dest.is_dir() {
        return Err("落盘后校验失败：目标不可读".to_string());
    }

    let link = HubLink {
        id: gen_link_id(&source_abs, &dest),
        skill_name: name,
        source: source_str,
        target: dest.to_string_lossy().to_string(),
        target_tool: target_tool_id.to_string(),
        mode: ledger_mode,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    ledger.links.push(link.clone());
    save_ledger(base, &ledger)?;
    config::debug_log(&format!(
        "hub link_skill: {} -> {} (mode={:?})",
        link.source, link.target, mode
    ));
    Ok(link)
}

/// 解除引用（§2.7）：link → 移除 junction（只删 reparse point）；copy → 不动磁盘。
/// 安全闸门：目标存在但不是 junction（被用户换成真实目录）→ 拒绝，防误删数据。
pub fn unlink_skill(base: &Path, link_id: &str) -> Result<HubLink, String> {
    let mut ledger = load_ledger(base);
    let idx = ledger
        .links
        .iter()
        .position(|l| l.id == link_id)
        .ok_or_else(|| format!("账本无此记录: {}", link_id))?;
    let link = ledger.links[idx].clone();
    let target = PathBuf::from(&link.target);

    if link.mode == LedgerMode::Link && target.exists() {
        if !is_junction(&target) {
            return Err(format!(
                "「{}」已不是 junction（可能被替换为真实目录），拒绝删除——请人工处理",
                link.skill_name
            ));
        }
        junction::delete(&target).map_err(|e| format!("junction 移除失败: {}", e))?;
        // junction v2 的 delete 只移除 reparse point，留下空目录壳——补删。
        // remove_dir 仅在目录为空时成功，非空（不应发生）则保留并报错，绝不递归。
        if target.exists() {
            fs::remove_dir(&target)
                .map_err(|e| format!("junction 空壳目录清理失败: {}", e))?;
        }
    }
    // copy / 目标已不存在：只清账本

    ledger.links.remove(idx);
    save_ledger(base, &ledger)?;
    config::debug_log(&format!("hub unlink_skill: {} ({})", link.skill_name, link_id));
    Ok(link)
}

/// link → copy 转换（删原件前救命通道，§2.7）：复制实体替换 junction。
pub fn convert_to_copy(base: &Path, link_id: &str) -> Result<HubLink, String> {
    let mut ledger = load_ledger(base);
    let idx = ledger
        .links
        .iter()
        .position(|l| l.id == link_id)
        .ok_or_else(|| format!("账本无此记录: {}", link_id))?;
    if ledger.links[idx].mode != LedgerMode::Link {
        return Err("只有 link 模式可以转副本".to_string());
    }
    let link = ledger.links[idx].clone();
    let target = PathBuf::from(&link.target);
    let source = PathBuf::from(&link.source);

    if !is_junction(&target) {
        return Err("目标已不是 junction，无法转换——请人工检查".to_string());
    }
    if !source.is_dir() {
        return Err("源目录已不存在，无法复制".to_string());
    }

    // junction::get_target 校验指向一致性（防 junction 被改指向后误复制）
    if let Ok(actual) = junction::get_target(&target) {
        if fs::canonicalize(&actual).ok() != fs::canonicalize(&source).ok() {
            return Err("junction 指向与账本源不一致，拒绝转换".to_string());
        }
    }

    junction::delete(&target).map_err(|e| format!("移除 junction 失败: {}", e))?;
    if let Err(e) = copy_tree(&source, &target) {
        // 复制失败 → 尽力恢复 junction（原件还在）
        let _ = junction::create(&source, &target);
        return Err(format!("复制失败，已恢复 junction: {}", e));
    }

    ledger.links[idx].mode = LedgerMode::Copy;
    let updated = ledger.links[idx].clone();
    save_ledger(base, &ledger)?;
    config::debug_log(&format!("hub convert_to_copy: {}", updated.skill_name));
    Ok(updated)
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/// dest 存在性：junction/symlink 指向不存在时 exists() 为 false，需查 metadata
fn dest_exists(p: &Path) -> bool {
    p.exists() || fs::symlink_metadata(p).is_ok()
}

/// junction v2 的 exists 返回 io::Result<bool>；查询失败按「不是 junction」处理
fn is_junction(p: &Path) -> bool {
    junction::exists(p).unwrap_or(false)
}

/// 递归复制技能目录。内部 symlink/junction 一律复制实体（不扩散链接结构）。
fn copy_tree(src: &Path, dst: &Path) -> Result<u64, String> {
    fs::create_dir_all(dst).map_err(|e| format!("目录创建失败: {}", e))?;
    let mut bytes: u64 = 0;
    for entry in walkdir::WalkDir::new(src).follow_links(true) {
        let entry = entry.map_err(|e| format!("遍历失败: {}", e))?;
        let rel = entry
            .path()
            .strip_prefix(src)
            .map_err(|e| format!("相对路径计算失败: {}", e))?;
        if rel.as_os_str().is_empty() {
            continue;
        }
        let dest = dst.join(rel);
        let meta = fs::metadata(entry.path()).map_err(|e| format!("stat 失败: {}", e))?;
        if meta.is_dir() {
            fs::create_dir_all(&dest).map_err(|e| format!("目录创建失败: {}", e))?;
        } else {
            if let Some(parent) = dest.parent() {
                let _ = fs::create_dir_all(parent);
            }
            bytes += fs::copy(entry.path(), &dest)
                .map_err(|e| format!("复制失败 {}: {}", dest.display(), e))?;
        }
    }
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// 测试（B2 验收：junction 链接创建成功、副本独立、Move 原子性、unlink 安全闸门）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("sk-b2-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// 造一个合法 skill 目录（含 SKILL.md + 子目录资源）
    fn make_skill(root: &Path, name: &str) -> PathBuf {
        let d = root.join(name);
        fs::create_dir_all(d.join("references")).unwrap();
        fs::write(d.join("SKILL.md"), format!("---\nname: {}\ndescription: test\n---\nbody", name)).unwrap();
        fs::write(d.join("references").join("r.md"), "ref").unwrap();
        d
    }

    fn cleanup(p: &Path) {
        // junction 必须先解除再删父目录，否则 remove_dir_all 会穿透删源
        if let Ok(rd) = fs::read_dir(p) {
            for e in rd.filter_map(|e| e.ok()) {
                if is_junction(&e.path()) {
                    let _ = junction::delete(e.path());
                }
            }
        }
        let _ = fs::remove_dir_all(p);
    }

    #[test]
    fn link_creates_junction_and_target_reads_source() {
        let root = tmp_root("link");
        let src_root = root.join("src");
        let tgt_root = root.join("tgt");
        fs::create_dir_all(&src_root).unwrap();
        fs::create_dir_all(&tgt_root).unwrap();
        let skill = make_skill(&src_root, "pdf-toolkit");
        let base = root.join("data");

        let link = link_skill_to_dir(&base, &skill, &tgt_root, "codex", LinkMode::Link).unwrap();
        let dest = tgt_root.join("pdf-toolkit");
        assert!(is_junction(&dest), "必须创建为 junction");
        assert!(dest.join("SKILL.md").is_file(), "透过 junction 可读源内容");
        assert_eq!(link.mode, LedgerMode::Link);

        let ledger = load_ledger(&base);
        assert_eq!(ledger.links.len(), 1);
        cleanup(&root);
    }

    #[test]
    fn copy_is_independent_of_source() {
        let root = tmp_root("copy");
        let src_root = root.join("src");
        let tgt_root = root.join("tgt");
        fs::create_dir_all(&src_root).unwrap();
        let skill = make_skill(&src_root, "csv-report");

        let link = link_skill_to_dir(&root.join("data"), &skill, &tgt_root, "cursor", LinkMode::Copy).unwrap();
        assert_eq!(link.mode, LedgerMode::Copy);
        let dest = tgt_root.join("csv-report");
        assert!(!is_junction(&dest), "copy 不得是 junction");
        assert!(dest.join("references").join("r.md").is_file(), "子目录完整复制");

        // 独立性：改副本不影响源
        fs::write(dest.join("SKILL.md"), "changed").unwrap();
        assert!(fs::read_to_string(skill.join("SKILL.md")).unwrap().contains("body"));
        cleanup(&root);
    }

    #[test]
    fn move_removes_source_and_ledger_records_copy() {
        let root = tmp_root("move");
        let src_root = root.join("src");
        let tgt_root = root.join("tgt");
        fs::create_dir_all(&src_root).unwrap();
        let skill = make_skill(&src_root, "move-me");

        let link = link_skill_to_dir(&root.join("data"), &skill, &tgt_root, "codex", LinkMode::Move).unwrap();
        assert!(!skill.exists(), "原件必须已离开源位置（进回收站）");
        assert!(tgt_root.join("move-me").join("SKILL.md").is_file());
        assert_eq!(link.mode, LedgerMode::Copy, "Move 落账本为 copy");
        cleanup(&root);
    }

    #[test]
    fn collision_and_duplicate_rejected() {
        let root = tmp_root("collision");
        let src_root = root.join("src");
        let tgt_root = root.join("tgt");
        fs::create_dir_all(&src_root).unwrap();
        fs::create_dir_all(&tgt_root).unwrap();
        let skill = make_skill(&src_root, "dup");
        let base = root.join("data");

        link_skill_to_dir(&base, &skill, &tgt_root, "codex", LinkMode::Link).unwrap();
        // 目标名已被占用 → 冲突拒绝
        let another = make_skill(&src_root, "other");
        fs::create_dir_all(tgt_root.join("other")).unwrap();
        let err = link_skill_to_dir(&base, &another, &tgt_root, "codex", LinkMode::Link).unwrap_err();
        assert!(err.contains("同名"));
        // 同源同目标重复引用 → 拒绝：手工移除 junction（保留账本记录）制造孤儿态，
        // 再尝试引用——此时 dest 已不存在，必须命中账本重复检查而非同名检查
        let dup_dest = tgt_root.join("dup");
        junction::delete(&dup_dest).unwrap();
        let _ = fs::remove_dir(&dup_dest);
        assert!(!dup_dest.exists());
        let err = link_skill_to_dir(&base, &skill, &tgt_root, "codex", LinkMode::Copy).unwrap_err();
        assert!(err.contains("已引用"), "应命中账本重复检查: {}", err);
        cleanup(&root);
    }

    #[test]
    fn unlink_link_removes_junction_only() {
        let root = tmp_root("unlink");
        let src_root = root.join("src");
        let tgt_root = root.join("tgt");
        fs::create_dir_all(&src_root).unwrap();
        let skill = make_skill(&src_root, "safe-unlink");
        let base = root.join("data");

        let link = link_skill_to_dir(&base, &skill, &tgt_root, "codex", LinkMode::Link).unwrap();
        let removed = unlink_skill(&base, &link.id).unwrap();
        assert_eq!(removed.id, link.id);
        assert!(!tgt_root.join("safe-unlink").exists(), "junction 已移除");
        assert!(skill.join("SKILL.md").is_file(), "源内容毫发无损");
        assert!(load_ledger(&base).links.is_empty());
        cleanup(&root);
    }

    #[test]
    fn unlink_copy_leaves_files() {
        let root = tmp_root("unlink-copy");
        let src_root = root.join("src");
        let tgt_root = root.join("tgt");
        fs::create_dir_all(&src_root).unwrap();
        let skill = make_skill(&src_root, "copy-stays");
        let base = root.join("data");

        let link = link_skill_to_dir(&base, &skill, &tgt_root, "codex", LinkMode::Copy).unwrap();
        unlink_skill(&base, &link.id).unwrap();
        assert!(tgt_root.join("copy-stays").join("SKILL.md").is_file(), "copy 解除引用不动磁盘");
        cleanup(&root);
    }

    #[test]
    fn unlink_refuses_tampered_junction() {
        let root = tmp_root("tamper");
        let src_root = root.join("src");
        let tgt_root = root.join("tgt");
        fs::create_dir_all(&src_root).unwrap();
        let skill = make_skill(&src_root, "tampered");
        let base = root.join("data");

        let link = link_skill_to_dir(&base, &skill, &tgt_root, "codex", LinkMode::Link).unwrap();
        // 模拟篡改：删 junction，换成真实目录
        let dest = tgt_root.join("tampered");
        junction::delete(&dest).unwrap();
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("SKILL.md"), "real now").unwrap();

        let err = unlink_skill(&base, &link.id).unwrap_err();
        assert!(err.contains("不是 junction"), "必须拒绝: {}", err);
        assert!(dest.join("SKILL.md").is_file(), "真实目录未被误删");
        cleanup(&root);
    }

    #[test]
    fn convert_to_copy_replaces_junction() {
        let root = tmp_root("convert");
        let src_root = root.join("src");
        let tgt_root = root.join("tgt");
        fs::create_dir_all(&src_root).unwrap();
        let skill = make_skill(&src_root, "conv");
        let base = root.join("data");

        let link = link_skill_to_dir(&base, &skill, &tgt_root, "codex", LinkMode::Link).unwrap();
        let updated = convert_to_copy(&base, &link.id).unwrap();
        assert_eq!(updated.mode, LedgerMode::Copy);
        let dest = tgt_root.join("conv");
        assert!(!is_junction(&dest), "junction 已被实体替换");
        assert!(dest.join("SKILL.md").is_file());
        cleanup(&root);
    }

    #[test]
    fn resolve_target_root_rules() {
        let tools = vec![
            ToolEntry {
                id: "codex".into(),
                name: "Codex CLI".into(),
                paths: vec!["$SK_B2_NONEXIST_HOME/skills".into(), std::env::temp_dir().to_string_lossy().to_string()],
                builtin: true,
                enabled: true,
                linkable: true,
                app_owned: false,
            },
            ToolEntry {
                id: "builtin".into(),
                name: "builtin".into(),
                paths: vec![],
                builtin: true,
                enabled: true,
                linkable: false,
                app_owned: true,
            },
        ];
        // 环境变量候选失效 → 落到第一个存在者
        let root = resolve_target_root(&tools, "codex").unwrap();
        assert_eq!(root, std::env::temp_dir());
        // app_owned 拒绝
        assert!(resolve_target_root(&tools, "builtin").is_err());
        // 未知工具拒绝
        assert!(resolve_target_root(&tools, "nope").is_err());
    }
}
