use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::config::{self, ScanTarget};
use crate::translations;

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    /// v0.2（B4）：`tool_id|rel_dir` 稳定键，跨构建形态/路径漂移不变。
    /// v0.1 键（hex8 虚拟 id / 路径哈希）在扫描时精确回退并 rekey 落盘。
    pub id: String,
    pub name: String,
    pub folder_name: String,
    pub description: String,
    pub emoji: Option<String>,
    pub scan_label: String,
    pub source_path: String,
    /// 实际扫描到的技能目录（junction 落点时不穿透——hub 操作锚点；
    /// 与 source_path 的 canonical 值互补：后者透过 junction 指向出处文件）
    #[serde(default)]
    pub skill_dir: String,
    /// 来源工具注册表 id（builtin/imported/custom-*/claude-code/...）
    #[serde(default)]
    pub tool_id: String,
    /// 是否为同名组的代表卡片（B4 代表选取：tools 顺序即优先级）
    #[serde(default = "default_true_bool")]
    pub is_representative: bool,
    /// 其他持有同名技能的工具 id 列表（UI 徽标/切换用）
    #[serde(default)]
    pub other_sources: Vec<String>,
    /// 该目录是 junction（hub link 落点）
    #[serde(default)]
    pub hub_linked: bool,
    /// 账本中对应的 link id（commands 层 join 填充；scanner 不读账本）
    #[serde(default)]
    pub hub_link_id: Option<String>,
    pub has_translation: bool,
    /// 元数据记录存在且源未删除，但译文 .md 丢失/为空。
    /// 卡片状态如实降级为「待翻译」+ 此标记驱动「译文丢失」提示。
    #[serde(default)]
    pub translation_lost: bool,
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

fn default_true_bool() -> bool {
    true
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
// 虚拟 id（v0.1 遗留键，B4 起仅用于译文回退 rekey）
// ---------------------------------------------------------------------------

fn make_virtual_id(token: &str, rel_dir: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}\x00{}", token, rel_dir).as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..8])
}

/// junction/symlink 目录探测（hub link 落点标记用）。
/// junction::exists 只查 reparse point，不穿透目标，悬空链接也能识别。
fn is_reparse_dir(p: &Path) -> bool {
    #[cfg(windows)]
    {
        junction::exists(p).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        fs::symlink_metadata(p)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
    }
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
    tool_id: &str,
    collection: Option<String>,
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
                tool_id,
                collection.clone(),
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
                tool_id,
                next_collection,
                translation_meta,
                skills,
                seen_ids,
                rekeys,
            );
        }
    }
}

/// 将一个含 SKILL.md 的目录注册为 Skill。
/// id = `tool_id|rel_dir`（v0.2 稳定键）；译文关联未命中时按序精确回退 v0.1
/// 旧键并排队 rekey（①导入库拍平映射 ②虚拟 id/路径哈希 ③source_path 兜底）。
#[allow(clippy::too_many_arguments)]
fn register_skill(
    child: &Path,
    skill_md: &Path,
    base: &Path,
    scan_label: &str,
    tool_id: &str,
    collection: Option<String>,
    translation_meta: &HashMap<String, translations::TranslationMeta>,
    skills: &mut Vec<Skill>,
    seen_ids: &mut std::collections::HashSet<String>,
    rekeys: &mut Vec<(String, String)>,
) {
    let abs_path = match fs::canonicalize(skill_md) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => skill_md.to_string_lossy().to_string(),
    };

    let rel = rel_dir_slashed(child, base);
    let skill_id = format!("{}|{}", tool_id, rel);
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

    // v0.1 遗留键候选：app 自有源 = 虚拟 id；外部工具 = 路径哈希。
    // 注意：junction 落点副本的 canonicalize 穿透回源文件，其 v0.1 路径哈希
    // 与源技能旧键相同——按扫描顺序（tools 顺序，确定性）先者认领。
    let legacy_virtual = if tool_id == config::TOOL_ID_BUILTIN || tool_id == config::TOOL_ID_IMPORTED
    {
        Some(make_virtual_id(tool_id, &rel))
    } else {
        None
    };
    let legacy_path = make_skill_id(&abs_path);

    let mut migrated_from: Option<String> = None;
    let tmeta = translation_meta.get(&skill_id).cloned().or_else(|| {
        // ① 导入库拍平迁移：按 .import.json 的 rel→folder 映射精确认领旧虚拟 id，
        //    不做 basename 猜测（避免跨 stem 同名互偷）。
        if tool_id == config::TOOL_ID_IMPORTED {
            if let Some(old_id) = imported_old_id(base, &rel) {
                if old_id != skill_id {
                    if let Some(m) = translation_meta.get(&old_id) {
                        rekeys.push((old_id.clone(), skill_id.clone()));
                        migrated_from = Some(old_id);
                        return Some(m.clone());
                    }
                }
            }
        }
        // ② v0.1 键直取
        if let Some(lv) = &legacy_virtual {
            if let Some(m) = translation_meta.get(lv) {
                rekeys.push((lv.clone(), skill_id.clone()));
                migrated_from = Some(lv.clone());
                return Some(m.clone());
            }
        }
        if let Some(m) = translation_meta.get(&legacy_path) {
            rekeys.push((legacy_path.clone(), skill_id.clone()));
            migrated_from = Some(legacy_path.clone());
            return Some(m.clone());
        }
        // ③ 兜底仅限 app 自有源（对齐 v0.1 语义）：外部工具的旧键是路径哈希，
        //    ②已精确覆盖；若放开 source_path 模糊匹配，junction 穿透造成的
        //    canonical 同址会在多工具间按 HashMap 随机序互偷译文。
        if tool_id != config::TOOL_ID_BUILTIN && tool_id != config::TOOL_ID_IMPORTED {
            return None;
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
    // 历史残留自愈：meta 已是新键（直取命中）但 md 仍旧名——过去 rekey 的
    // rename 失败被吞所致。正向重算 v0.1 旧键候选，旧名 md 存在即改名修复，
    // 本次扫描随后用新 id 直接命中。真丢失（旧名也不在）则落入 lost 判定。
    if migrated_from.is_none()
        && tmeta.is_some()
        && translations::read_translated_content(&skill_id)
            .map(|t| t.trim().is_empty())
            .unwrap_or(true)
    {
        let mut candidates: Vec<String> = Vec::new();
        if let Some(old) = imported_old_id(base, &rel) {
            candidates.push(old);
        }
        if let Some(lv) = &legacy_virtual {
            candidates.push(lv.clone());
        }
        candidates.push(legacy_path.clone());
        for old in candidates {
            if old != skill_id && translations::repair_rename(&old, &skill_id) {
                config::debug_log(&format!("translation md repaired: {} -> {}", old, skill_id));
                break;
            }
        }
    }

    // 状态以译文内容实际存在为准：meta 在但 .md 丢失/为空 → lost（卡片不再谎报「已翻译」）。
    // 迁移当次 md 文件还是旧名，用旧 id 读；rekey 落盘后下次自然用新 id。
    let read_id = migrated_from.as_ref().unwrap_or(&skill_id);
    let translation_lost = tmeta
        .as_ref()
        .map(|m| {
            !m.source_deleted
                && translations::read_translated_content(read_id)
                    .map(|t| t.trim().is_empty())
                    .unwrap_or(true)
        })
        .unwrap_or(false);
    let has_translation = tmeta.as_ref().map(|m| !m.source_deleted).unwrap_or(false)
        && !translation_lost;
    let title_zh = tmeta
        .map(|m| m.title_zh.clone())
        .unwrap_or_default();
    let description_zh = if has_translation {
        extract_description_zh(read_id)
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
        skill_dir: child.to_string_lossy().to_string(),
        tool_id: tool_id.to_string(),
        is_representative: true, // 代表选取 pass 精化
        other_sources: vec![],
        hub_linked: is_reparse_dir(child),
        hub_link_id: None, // commands 层 join 账本填充
        has_translation,
        translation_lost,
        title_zh,
        description_zh,
        source_deleted: false,
        parent_collection: collection,
    });
}

// ---------------------------------------------------------------------------
// 测试（B4 验收：稳定 rekey / 代表选取优先级 / junction 感知）
// 注意：scanner 会只读加载真实 translations.json；下列用例的临时技能名与
// 真实译文不可能碰撞，rekey 队列恒空 → 不产生任何写副作用。
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ScanTarget;

    fn tmp_root(tag: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("sk-b4-{}-{}", tag, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn make_skill(root: &Path, name: &str) {
        let d = root.join(name);
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("SKILL.md"),
            format!("---\nname: {}\ndescription: test skill\n---\nbody", name),
        )
        .unwrap();
    }

    fn target(path: &Path, tool_id: &str, label: &str) -> ScanTarget {
        ScanTarget {
            path: path.to_string_lossy().to_string(),
            label: label.to_string(),
            tool_id: tool_id.to_string(),
        }
    }

    /// 过滤孤儿条目（scanner 会附带真实 translations.json 的孤儿，与本测试无关）
    fn live(skills: Vec<Skill>) -> Vec<Skill> {
        skills.into_iter().filter(|s| !s.source_deleted).collect()
    }

    #[test]
    fn stable_rekey_format_and_nesting() {
        let root = tmp_root("rekey");
        let tool_a = root.join("a");
        make_skill(&tool_a, "solo-a");
        // 嵌套合集：pack/solo-b
        let nested = tool_a.join("pack").join("solo-b");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            nested.join("SKILL.md"),
            "---\nname: solo-b\ndescription: nested\n---\nbody",
        )
        .unwrap();

        let skills = live(scan_all_skills(&[target(&tool_a, "claude-code", "Claude Code")]));
        assert_eq!(skills.len(), 2);
        let flat = skills.iter().find(|s| s.folder_name == "solo-a").unwrap();
        assert_eq!(flat.id, "claude-code|solo-a", "顶层 id = tool_id|name");
        assert_eq!(flat.tool_id, "claude-code");
        assert_eq!(flat.parent_collection, None);
        let nest = skills.iter().find(|s| s.folder_name == "solo-b").unwrap();
        assert_eq!(nest.id, "claude-code|pack/solo-b", "嵌套 rel 消歧");
        assert_eq!(nest.parent_collection.as_deref(), Some("pack"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn representative_selection_cross_tool_priority() {
        let root = tmp_root("rep");
        let tool_a = root.join("a"); // 优先级高（扫描顺序在前）
        let tool_b = root.join("b");
        make_skill(&tool_a, "pdf-toolkit");
        make_skill(&tool_a, "only-a");
        make_skill(&tool_b, "pdf-toolkit"); // 同名副本
        make_skill(&tool_b, "only-b");

        let skills = live(scan_all_skills(&[
            target(&tool_a, "claude-code", "Claude Code"),
            target(&tool_b, "codex", "Codex CLI"),
        ]));
        assert_eq!(skills.len(), 4, "非代表副本保留在输出（防 sync_deleted 误杀译文）");

        let rep = skills
            .iter()
            .find(|s| s.id == "claude-code|pdf-toolkit")
            .unwrap();
        assert!(rep.is_representative, "扫描顺序首个 = 代表");
        assert_eq!(rep.other_sources, vec!["codex".to_string()]);

        let cand = skills.iter().find(|s| s.id == "codex|pdf-toolkit").unwrap();
        assert!(!cand.is_representative);
        assert_eq!(cand.other_sources, vec!["claude-code".to_string()]);

        // 无同名者不受影响
        let solo = skills.iter().find(|s| s.id == "claude-code|only-a").unwrap();
        assert!(solo.is_representative && solo.other_sources.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn same_tool_collection_namesakes_not_collapsed() {
        let root = tmp_root("same-tool");
        let tool_a = root.join("a");
        for coll in ["x", "y"] {
            let d = tool_a.join(coll).join("dup");
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("SKILL.md"), "---\nname: dup\ndescription: d\n---\nb").unwrap();
        }
        let skills = live(scan_all_skills(&[target(&tool_a, "claude-code", "Claude Code")]));
        assert_eq!(skills.len(), 2);
        // 同工具内不同合集的同名目录 = 不同技能，均为代表
        assert!(skills.iter().all(|s| s.is_representative));
        assert!(skills.iter().all(|s| s.other_sources.is_empty()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn hub_linked_junction_detected_and_repped() {
        let root = tmp_root("junction");
        let src_tool = root.join("claude"); // 出处工具
        let tgt_tool = root.join("codex"); // 引用落点工具
        fs::create_dir_all(&src_tool).unwrap();
        fs::create_dir_all(&tgt_tool).unwrap();
        make_skill(&src_tool, "shared-skill");
        make_skill(&tgt_tool, "native-skill");

        // 经 hub 层创建 junction（账本写 root/data，不碰真实数据目录）
        let link = crate::hub::link_skill_to_dir(
            &root.join("data"),
            &src_tool.join("shared-skill"),
            &tgt_tool,
            "codex",
            crate::hub::LinkMode::Link,
        )
        .unwrap();

        let skills = live(scan_all_skills(&[
            target(&src_tool, "claude-code", "Claude Code"),
            target(&tgt_tool, "codex", "Codex CLI"),
        ]));
        // claude: shared-skill；codex: native-skill + junction 副本
        assert_eq!(skills.len(), 3);
        let linked = skills.iter().find(|s| s.id == "codex|shared-skill").unwrap();
        assert!(linked.hub_linked, "junction 落点必须被识别");
        assert!(linked.skill_dir.ends_with("shared-skill"));
        assert!(
            linked.source_path.contains("claude"),
            "canonicalize 穿透 junction 指向出处: {}",
            linked.source_path
        );
        // 同名跨工具 → 出处（扫描顺序在前）为代表
        let origin = skills.iter().find(|s| s.id == "claude-code|shared-skill").unwrap();
        assert!(origin.is_representative);
        assert!(!linked.is_representative);
        let _ = junction::delete(tgt_tool.join("shared-skill"));
        let _ = fs::remove_dir_all(&root);
        assert!(!link.id.is_empty());
    }

    /// 历史残留自愈：meta 已是新键但 md 仍旧名（过去 rekey rename 失败被吞）→
    /// 扫描时正向重算旧键并改名，状态恢复「已翻译」。
    #[test]
    fn repair_legacy_md_under_new_meta_key() {
        // 独立临时数据目录，绝不碰真实用户数据
        let data = tmp_root("repair-data");
        crate::config::set_data_dir_for_test(data.clone());
        let tdir = data.join("translations");
        fs::create_dir_all(&tdir).unwrap();

        let root = tmp_root("repair");
        let tool = root.join("t");
        make_skill(&tool, "repair-me");

        // 先扫一次拿新 id 与 legacy 路径哈希（此时 meta 为空，无副作用）
        let first = scan_all_skills(&[target(&tool, "claude-code", "Claude Code")]);
        let sk = first.iter().find(|s| s.folder_name == "repair-me").unwrap();
        let new_id = sk.id.clone();
        let legacy = make_skill_id(&sk.source_path);
        let src_json = sk.source_path.replace('\\', "\\\\");

        // 构造残留态：meta 新键 + md 旧名
        fs::write(
            data.join("translations.json"),
            format!(
                "{{\"{}\":{{\"source_path\":\"{}\",\"scan_label\":\"Claude Code\",\"source_hash\":\"h\",\"translated_at\":\"t\",\"model\":\"m\",\"title_zh\":\"修\",\"source_deleted\":false}}}}",
                new_id, src_json
            ),
        )
        .unwrap();
        fs::write(
            tdir.join(format!("{}.md", legacy)),
            "<!-- anchor:original -->\nx\n<!-- anchor:translated -->\n修复译文",
        )
        .unwrap();

        let skills = live(scan_all_skills(&[target(&tool, "claude-code", "Claude Code")]));
        let sk = skills.iter().find(|s| s.folder_name == "repair-me").unwrap();
        assert!(sk.has_translation, "repair pass 应恢复已翻译状态");
        assert!(!sk.translation_lost);
        assert!(
            tdir.join(translations::md_filename(&new_id)).exists(),
            "md 应改名到新键（percent-encode 文件名）"
        );

        let _ = fs::remove_dir_all(&root);
    }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

pub fn scan_all_skills(targets: &[ScanTarget]) -> Vec<Skill> {
    let mut translation_meta = translations::load_all_meta();
    let mut skills: Vec<Skill> = Vec::new();
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut rekeys: Vec<(String, String)> = Vec::new();

    for t in targets {
        let base = Path::new(&t.path);
        if !base.is_dir() {
            continue;
        }

        // 从 depth=1、collection=None 开始递归
        scan_dir_recursive(
            base,
            1,
            base,
            &t.label,
            &t.tool_id,
            None,
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

    // B4 代表选取：同名技能跨工具出现时，按扫描顺序（= tools 注册顺序，
    // builtin → 注册表 → 自定义 → 导入）首个为代表。非代表副本保留在输出中
    // （sync_deleted 依赖全量 id，防止误杀其译文），前端按 is_representative 折叠。
    // 仅跨工具去重：同工具内不同合集的同名目录是不同技能，不折叠。
    for i in 0..skills.len() {
        let mut earlier_rep: Option<usize> = None;
        let mut others: Vec<String> = Vec::new();
        for j in 0..skills.len() {
            if j == i || skills[j].folder_name != skills[i].folder_name {
                continue;
            }
            if skills[j].tool_id != skills[i].tool_id {
                if j < i && earlier_rep.is_none() {
                    earlier_rep = Some(j);
                }
                others.push(skills[j].tool_id.clone());
            }
        }
        skills[i].is_representative = earlier_rep.is_none();
        skills[i].other_sources = others;
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
                skill_dir: tmeta.source_path.clone(),
                tool_id: sid.split('|').next().unwrap_or("").to_string(),
                is_representative: true,
                other_sources: vec![],
                hub_linked: false,
                hub_link_id: None,
                has_translation: translations::read_translated_content(sid)
                    .map(|t| !t.trim().is_empty())
                    .unwrap_or(false),
                translation_lost: translations::read_translated_content(sid)
                    .map(|t| t.trim().is_empty())
                    .unwrap_or(true),
                title_zh: tmeta.title_zh.clone(),
                description_zh: extract_description_zh(sid),
                source_deleted: true,
                parent_collection: None,
            });
        }
    }

    skills
}
