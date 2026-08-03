use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::config::{self, ScanPathItem};
use crate::translations;

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub folder_name: String,
    pub description: String,
    pub emoji: Option<String>,
    pub scan_label: String,
    pub source_path: String,
    pub has_translation: bool,
    pub title_zh: String,
    /// 译文中 frontmatter description 的中文版本（扫描时从译文文件派生，
    /// 无译文时为空串）。卡片/详情描述优先展示它。
    #[serde(default)]
    pub description_zh: String,
    pub source_deleted: bool,
    /// 所属合集的中间路径（相对 scan_path  base 之下）。
    /// 一级 skill 为 None；嵌套 skill 为 Some("collection") 或 Some("a/b")。
    #[serde(default)]
    pub parent_collection: Option<String>,
}

// ---------------------------------------------------------------------------
// ID 生成
// ---------------------------------------------------------------------------

pub fn make_skill_id(abs_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(abs_path.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..8]) // 16 hex chars
}

// 简易 hex 编码（避免引入 hex crate）
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

// ---------------------------------------------------------------------------
// 虚拟 id（PLAN-04 §2.2）
// ---------------------------------------------------------------------------

/// app 自有源（物理位置随构建形态/data-dir 变化）→ 虚拟 id token；
/// 外部用户配置源返回 None，保持绝对路径 id（独立唯一，不合并）。
fn app_owned_token(label: &str, base: &Path) -> Option<String> {
    if label == "builtin" {
        return Some("builtin".to_string());
    }
    if base == config::imported_dir() {
        return Some("imported".to_string());
    }
    None
}

fn make_virtual_id(token: &str, rel_dir: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}\x00{}", token, rel_dir).as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..8])
}

fn rel_dir_slashed(child: &Path, base: &Path) -> String {
    child
        .strip_prefix(base)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default()
}

/// 导入库拍平迁移：新 rel 形如 stem/folder，从 stem/.import.json 的
/// skills[{rel, folder}] 映射反查导入前嵌套 rel，派生旧虚拟 id。
/// 文件缺失/格式不符（旧版字符串数组）返回 None——旧版未拍平，id 本就直 hit。
fn imported_old_id(base: &Path, rel: &str) -> Option<String> {
    let mut segs = rel.splitn(2, '/');
    let stem = segs.next()?;
    let folder = segs.next()?;
    let json_path = base.join(stem).join(".import.json");
    let text = fs::read_to_string(json_path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let old_rel = v["skills"]
        .as_array()?
        .iter()
        .find(|r| r["folder"].as_str() == Some(folder))
        .and_then(|r| r["rel"].as_str())?;
    Some(make_virtual_id("imported", &format!("{}/{}", stem, old_rel)))
}

// ---------------------------------------------------------------------------
// Frontmatter 解析
// ---------------------------------------------------------------------------

pub fn parse_frontmatter(text: &str) -> HashMap<String, String> {
    let mut meta = HashMap::new();
    // 匹配 --- ... --- 块
    let re = Regex::new(r"(?s)\A---\r?\n(.*?)\r?\n---").unwrap();
    if let Some(caps) = re.captures(text) {
        let fm = &caps[1];
        let line_re = Regex::new(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$").unwrap();
        for line in fm.lines() {
            if let Some(caps) = line_re.captures(line) {
                let key = caps[1].to_string();
                let mut val = caps[2].trim().to_string();
                // 去引号
                if val.len() >= 2 {
                    let bytes = val.as_bytes();
                    if (bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
                        || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\'')
                    {
                        val = val[1..val.len() - 1].to_string();
                    }
                }
                meta.insert(key, val);
            }
        }
    }
    meta
}

/// 从译文 .md 的 translated 段提取 frontmatter description（中文）。
/// 译文格式：`<!-- anchor:original -->\n<原文>\n<!-- anchor:translated -->\n<译文>`。
/// 翻译 prompt 要求保留 Markdown/frontmatter 结构，故译文段首行仍为
/// `description: <中文>`；取单行值，缺失则返回空串。
fn extract_description_zh(skill_id: &str) -> String {
    let text = match translations::read_translated_content(skill_id) {
        Some(t) => t,
        None => return String::new(),
    };
    let translated = match text.split("<!-- anchor:translated -->").nth(1) {
        Some(t) => t,
        None => return String::new(),
    };
    let re = Regex::new(r"(?m)^description:\s*(.+)$").unwrap();
    re.captures(translated)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_default()
}

fn extract_emoji(text: &str) -> Option<String> {
    let re = Regex::new(r#"emoji:\s*["']?([^"'\n]+)"#).unwrap();
    let limited = &text[..text.len().min(2000)];
    re.captures(limited)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| !s.is_empty())
}

// ---------------------------------------------------------------------------
// 递归扫描（max_depth=3，有 SKILL.md 即停）
// ---------------------------------------------------------------------------

const MAX_SCAN_DEPTH: usize = 3;

/// 递归扫描目录，收集含 SKILL.md 的子目录。
///
/// - `depth` 从 1 开始（base 的直接子目录 = depth 1）。
/// - `collection` 表示「当前 dir 作为合集容器时的中间路径」。
///   base 调用时为 None；进入一个无 SKILL.md 的子目录后，该子目录名成为合集名。
fn scan_dir_recursive(
    dir: &Path,
    depth: usize,
    base: &Path,
    scan_label: &str,
    collection: Option<String>,
    token: &Option<String>,
    translation_meta: &HashMap<String, translations::TranslationMeta>,
    skills: &mut Vec<Skill>,
    seen_ids: &mut std::collections::HashSet<String>,
    rekeys: &mut Vec<(String, String)>,
) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let mut dirs: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    dirs.sort_by_key(|e| e.file_name());

    for entry in dirs {
        let child = entry.path();
        let skill_md = child.join("SKILL.md");
        let folder_name = child
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if skill_md.is_file() {
            // 有 SKILL.md → 记为 skill，归属当前 collection，不再递归
            register_skill(
                &child,
                &skill_md,
                base,
                scan_label,
                collection.clone(),
                token,
                translation_meta,
                skills,
                seen_ids,
                rekeys,
            );
        } else {
            // 无 SKILL.md → 该目录是合集容器，递归下一层
            let next_collection = match &collection {
                None => Some(folder_name),
                Some(c) => Some(format!("{}/{}", c, folder_name)),
            };
            scan_dir_recursive(
                &child,
                depth + 1,
                base,
                scan_label,
                next_collection,
                token,
                translation_meta,
                skills,
                seen_ids,
                rekeys,
            );
        }
    }
}

/// 将一个含 SKILL.md 的目录注册为 Skill
#[allow(clippy::too_many_arguments)]
fn register_skill(
    child: &Path,
    skill_md: &Path,
    base: &Path,
    scan_label: &str,
    collection: Option<String>,
    token: &Option<String>,
    translation_meta: &HashMap<String, translations::TranslationMeta>,
    skills: &mut Vec<Skill>,
    seen_ids: &mut std::collections::HashSet<String>,
    rekeys: &mut Vec<(String, String)>,
) {
    let abs_path = match fs::canonicalize(skill_md) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => skill_md.to_string_lossy().to_string(),
    };

    // app 自有源用虚拟 id（与绝对路径解耦），外部源保持绝对路径 id
    let rel = rel_dir_slashed(child, base);
    let skill_id = match token {
        Some(t) => make_virtual_id(t, &rel),
        None => make_skill_id(&abs_path),
    };
    if seen_ids.contains(&skill_id) {
        return;
    }
    seen_ids.insert(skill_id.clone());

    let text = match fs::read_to_string(skill_md) {
        Ok(t) => t,
        Err(_) => return,
    };

    let fm = parse_frontmatter(&text);
    let emoji = extract_emoji(&text);
    let folder_name = child
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // 翻译关联：新 id 直取；未命中时两类回退（命中即排队 rekey）：
    // 1) 导入库拍平迁移：.import.json 映射精确派生旧虚拟 id；
    // 2) 一次性迁移（§2.3）：source_path 精确相等，或 builtin 旧键的
    //    source_path 以 rel/SKILL.md 结尾。
    let mut migrated_from: Option<String> = None;
    let tmeta = translation_meta.get(&skill_id).cloned().or_else(|| {
        if token.is_none() {
            return None;
        }
        // 导入库拍平迁移：按 .import.json 的 rel→folder 映射精确认领旧虚拟 id，
        // 不做 basename 猜测（避免跨 stem 同名互偷）。
        if scan_label == "导入" {
            if let Some(old_id) = imported_old_id(base, &rel) {
                if old_id.as_str() != skill_id.as_str() {
                    if let Some(m) = translation_meta.get(&old_id) {
                        rekeys.push((old_id.clone(), skill_id.clone()));
                        migrated_from = Some(old_id);
                        return Some(m.clone());
                    }
                }
            }
        }
        let rel_md = format!("{}/SKILL.md", rel);
        translation_meta
            .iter()
            .find(|(k, m)| {
                k.as_str() != skill_id.as_str()
                    && (m.source_path == abs_path
                        || (m.scan_label == "builtin"
                            && (m.source_path.ends_with(&format!("/{}", rel_md))
                                || m.source_path.ends_with(&format!("\\{}", rel_md)))))
            })
            .map(|(k, m)| {
                rekeys.push((k.clone(), skill_id.clone()));
                migrated_from = Some(k.clone());
                m.clone()
            })
    });
    let has_translation = tmeta.as_ref().map(|m| !m.source_deleted).unwrap_or(false);
    let title_zh = tmeta
        .map(|m| m.title_zh.clone())
        .unwrap_or_default();
    // 迁移当次 md 文件还是旧名，用旧 id 读译文；rekey 落盘后下次自然用新 id
    let description_zh = if has_translation {
        extract_description_zh(migrated_from.as_ref().unwrap_or(&skill_id))
    } else {
        String::new()
    };

    skills.push(Skill {
        id: skill_id,
        name: fm.get("name").cloned().unwrap_or_else(|| folder_name.clone()),
        folder_name,
        description: fm.get("description").cloned().unwrap_or_default(),
        emoji,
        scan_label: scan_label.to_string(),
        source_path: abs_path,
        has_translation,
        title_zh,
        description_zh,
        source_deleted: false,
        parent_collection: collection,
    });
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

pub fn scan_all_skills(scan_paths: &[ScanPathItem]) -> Vec<Skill> {
    let mut translation_meta = translations::load_all_meta();
    let mut skills: Vec<Skill> = Vec::new();
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut rekeys: Vec<(String, String)> = Vec::new();

    for sp in scan_paths.iter().filter(|sp| sp.enabled) {
        let base = Path::new(&sp.path);
        if !base.is_dir() {
            continue;
        }
        let token = app_owned_token(&sp.label, base);

        // 从 depth=1、collection=None 开始递归
        scan_dir_recursive(
            base,
            1,
            base,
            &sp.label,
            None,
            &token,
            &translation_meta,
            &mut skills,
            &mut seen_ids,
            &mut rekeys,
        );
    }

    // id 迁移换键落盘，重读 meta 再跑孤儿 pass，避免旧键造成假孤儿
    if !rekeys.is_empty() {
        for (old, new) in &rekeys {
            let _ = translations::rekey(old, new);
        }
        config::debug_log(&format!("id migration rekeys: {:?}", rekeys));
        translation_meta = translations::load_all_meta();
    }

    // 加入已翻译但源文件已删除的孤儿记录
    for (sid, tmeta) in &translation_meta {
        if !seen_ids.contains(sid) {
            let folder = tmeta
                .source_path
                .rsplit(['/', '\\'])
                .nth(1)
                .unwrap_or(sid)
                .to_string();
            skills.push(Skill {
                id: sid.clone(),
                name: folder.clone(),
                folder_name: folder,
                description: String::new(),
                emoji: None,
                scan_label: tmeta.scan_label.clone(),
                source_path: tmeta.source_path.clone(),
                has_translation: true,
                title_zh: tmeta.title_zh.clone(),
                description_zh: extract_description_zh(sid),
                source_deleted: true,
                parent_collection: None,
            });
        }
    }

    skills
}
