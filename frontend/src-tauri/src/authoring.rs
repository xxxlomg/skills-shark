//! 模块 C 创作后端（PLAN-06 §3.10/§3.13 C6）：
//! - `skill_write_file`：编辑器整文件写（rel_path 禁 `..`/绝对路径 + 归属检查）；
//! - `skill_commit_draft`：AI 模式落盘入口（归属检查 + 写 SKILL.md/references + 诊断校验）；
//! - 路径归属安全基线 `assert_path_owned_with_roots`：所有写入口必过，
//!   落点必须落在 authored/ 或已启用 tools 展开路径或 builtin/imported 自有源之下。
//!
//! 安全核心函数全部 roots 参数化——单测不碰全局 DATA_DIR / 真实注册表。

use std::path::{Component, Path, PathBuf};

/// 词法规范化（不碰文件系统）：解析 `.`/`..`，用于尚不存在目录的归属判定。
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 大小写不敏感前缀比较（Windows 盘符/目录大小写不敏感）。
fn owned_by(child: &Path, root: &Path) -> bool {
    let c = child.to_string_lossy().to_lowercase();
    let r = root.to_string_lossy().to_lowercase();
    let with_sep = |s: &str| format!("{s}\\") ;
    c == r || c.starts_with(&with_sep(&r)) || c.starts_with(&format!("{r}/"))
}

/// 当前生效的写归属根集合：authored + builtin + imported + 已启用 tools 的展开路径。
pub(crate) fn owned_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        crate::config::authored_dir(),
        crate::config::builtin_skills_dir(),
        crate::config::imported_dir(),
    ];
    let cfg = crate::config::load_config();
    for t in &cfg.tools {
        if !t.enabled {
            continue;
        }
        for p in &t.paths {
            if let Some(exp) = crate::config::expand_path(p) {
                roots.push(exp);
            }
        }
    }
    roots
}

/// 路径归属检查（C6 安全基线）。违反 → Err("PATH_ESCAPE:<normalized>")。
pub(crate) fn assert_path_owned_with_roots(path: &Path, roots: &[PathBuf]) -> Result<(), String> {
    let norm = normalize(path);
    for r in roots {
        if owned_by(&norm, &normalize(r)) {
            return Ok(());
        }
    }
    Err(format!("PATH_ESCAPE:{}", norm.display()))
}

/// rel_path 安全检查：禁 `..` 组件、禁绝对路径（C6 验收硬标准）。
fn assert_rel_safe(rel: &str) -> Result<(), String> {
    let p = Path::new(rel);
    if p.is_absolute() {
        return Err("rel_path 不允许绝对路径".to_string());
    }
    if p.components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("rel_path 不允许 .. 逃逸".to_string());
    }
    Ok(())
}

/// 编辑器整文件写核心（roots 参数化）。
pub(crate) fn write_file_checked(
    skill_dir: &Path,
    rel_path: &str,
    content: &str,
    roots: &[PathBuf],
) -> Result<PathBuf, String> {
    assert_rel_safe(rel_path)?;
    assert_path_owned_with_roots(skill_dir, roots)?;
    let target = skill_dir.join(rel_path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::write(&target, content).map_err(|e| format!("写入失败：{e}"))?;
    Ok(target)
}

/// 编辑器保存用（整文件写）。frontmatter 表单编辑不走这里（走 C10 skill_edit_frontmatter）。
#[tauri::command]
pub fn skill_write_file(
    skill_dir: String,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    write_file_checked(Path::new(&skill_dir), &rel_path, &content, &owned_roots())?;
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct DraftFile {
    pub rel_path: String,
    pub content: String,
}

#[derive(serde::Deserialize)]
pub struct SkillDraft {
    pub name: String,
    pub description: String,
    /// 正文（空则用模板骨架）
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub references: Vec<DraftFile>,
}

/// AI 模式落盘入口（§3.11）。location = "authored" 或 tool_id（§3.9 双落点）。
/// 写完跑诊断校验一并返回。
#[tauri::command]
pub fn skill_commit_draft(
    location: String,
    draft: SkillDraft,
) -> Result<serde_json::Value, String> {
    let roots = owned_roots();
    let base = if location == crate::config::TOOL_ID_AUTHORED {
        crate::config::authored_dir()
    } else {
        resolve_tool_base(&location)?
    };
    // SKILL.md 走模板核心（name/desc 校验 + EXISTS 拒）
    let dir = crate::commands::create_skill_template(&base, &draft.name, &draft.description)?;
    // 正文覆盖模板骨架
    if !draft.body.trim().is_empty() {
        let md = format!(
            "---\nname: {}\ndescription: {}\n---\n\n{}",
            draft.name.trim(),
            draft.description.trim(),
            draft.body
        );
        std::fs::write(dir.join("SKILL.md"), md)
            .map_err(|e| format!("写入 SKILL.md 失败：{e}"))?;
    }
    // references 逐个过安全检查
    for f in &draft.references {
        write_file_checked(&dir, &f.rel_path, &f.content, &roots)?;
    }
    let report = crate::validate::validate_dir(&dir, crate::validate::Mode::Diagnostic);
    Ok(serde_json::json!({
        "skill_dir": dir.to_string_lossy(),
        "validation": report,
    }))
}

/// §3.9 工具落点：第一个存在的展开路径；都不存在则创建 paths[0]。
fn resolve_tool_base(tool_id: &str) -> Result<PathBuf, String> {
    let cfg = crate::config::load_config();
    let tool = cfg
        .tools
        .iter()
        .find(|t| t.id == tool_id && !t.app_owned)
        .ok_or_else(|| format!("未知或不可写工具：{tool_id}"))?;
    for p in &tool.paths {
        if let Some(exp) = crate::config::expand_path(p) {
            if exp.is_dir() {
                return Ok(exp);
            }
        }
    }
    let first = tool
        .paths
        .first()
        .and_then(|p| crate::config::expand_path(p))
        .ok_or_else(|| format!("工具 {tool_id} 无可用路径"))?;
    std::fs::create_dir_all(&first).map_err(|e| format!("创建工具目录失败：{e}"))?;
    Ok(first)
}

// ---------------------------------------------------------------------------
// C8：openai.yaml emitter + 约束校验（PLAN-06 §3.12，官方 schema 锚点：
// mock/skills/codex-skill-creator/references/openai_yaml.md）
// 六字段全在 interface: 下；字符串一律引号包裹、键不引号、2 空格缩进。
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize, Default, Clone)]
pub struct OpenaiFields {
    pub display_name: String,
    pub short_description: String,
    pub default_prompt: String,
    pub icon_small: Option<String>,
    pub icon_large: Option<String>,
    pub brand_color: Option<String>,
}

/// YAML 字符串引号包裹 + 标准转义（`"` `\` `\n`）。
fn yq(s: &str) -> String {
    format!(
        "\"{}\"",
        s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
    )
}

/// 裸文件名归一为 `./assets/<file>`（§3.12 约束 4）。
fn normalize_asset(p: &str) -> String {
    let t = p.trim().replace('\\', "/");
    if t.starts_with("./") || t.starts_with('/') {
        t
    } else {
        let file = t.rsplit('/').next().unwrap_or(&t);
        format!("./assets/{file}")
    }
}

/// C8 emitter：字段顺序镜像官方示例（display_name → short_description →
/// icon_small → icon_large → brand_color → default_prompt）；
/// icon/brand_color 仅在提供时写入（官方原则：可选字段不得臆造）。
pub(crate) fn emit_openai_yaml(f: &OpenaiFields) -> String {
    let mut out = String::from("interface:\n");
    out.push_str(&format!("  display_name: {}\n", yq(&f.display_name)));
    out.push_str(&format!("  short_description: {}\n", yq(&f.short_description)));
    if let Some(v) = &f.icon_small {
        out.push_str(&format!("  icon_small: {}\n", yq(v)));
    }
    if let Some(v) = &f.icon_large {
        out.push_str(&format!("  icon_large: {}\n", yq(v)));
    }
    if let Some(v) = &f.brand_color {
        out.push_str(&format!("  brand_color: {}\n", yq(v)));
    }
    out.push_str(&format!("  default_prompt: {}\n", yq(&f.default_prompt)));
    out
}

/// §3.12 约束校验：返回 (severity, message) 列表。error 阻断写入。
fn check_openai_fields(f: &OpenaiFields, skill_dir: &Path) -> Vec<(&'static str, String)> {
    let mut issues: Vec<(&'static str, String)> = vec![];
    if !f.default_prompt.contains("$skill-name") {
        issues.push((
            "error",
            "default_prompt 必须包含 $skill-name（官方硬规则）".to_string(),
        ));
    }
    let chars = f.short_description.chars().count();
    if !(25..=64).contains(&chars) {
        issues.push((
            "error",
            format!("short_description 须 25–64 字符（当前 {chars}）"),
        ));
    }
    for (key, val) in [
        ("icon_small", &f.icon_small),
        ("icon_large", &f.icon_large),
    ] {
        if let Some(p) = val {
            if !skill_dir.join(p).exists() {
                issues.push((
                    "warn",
                    format!("{key} 资源 {p} 不存在（不阻断，文件可能后补）"),
                ));
            }
        }
    }
    issues
}

/// 生成 `agents/openai.yaml`。已存在默认拒（EXISTS）；overwrite=true 先备份 .bak。
/// error 级约束违例拒写；warn 随结果返回。
pub(crate) fn generate_openai_yaml_checked(
    skill_dir: &Path,
    mut fields: OpenaiFields,
    overwrite: bool,
    roots: &[PathBuf],
) -> Result<serde_json::Value, String> {
    assert_path_owned_with_roots(skill_dir, roots)?;
    fields.icon_small = fields.icon_small.map(|p| normalize_asset(&p));
    fields.icon_large = fields.icon_large.map(|p| normalize_asset(&p));

    let issues = check_openai_fields(&fields, skill_dir);
    let errors: Vec<String> = issues
        .iter()
        .filter(|(s, _)| *s == "error")
        .map(|(_, m)| m.clone())
        .collect();
    if !errors.is_empty() {
        return Err(errors.join("；"));
    }

    let target = skill_dir.join("agents").join("openai.yaml");
    if target.exists() {
        if !overwrite {
            return Err("EXISTS".to_string());
        }
        let bak = skill_dir.join("agents").join("openai.yaml.bak");
        std::fs::copy(&target, &bak).map_err(|e| format!("备份失败：{e}"))?;
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    std::fs::write(&target, emit_openai_yaml(&fields))
        .map_err(|e| format!("写入 openai.yaml 失败：{e}"))?;

    let warnings: Vec<String> = issues
        .iter()
        .filter(|(s, _)| *s == "warn")
        .map(|(_, m)| m.clone())
        .collect();
    Ok(serde_json::json!({
        "path": target.to_string_lossy(),
        "warnings": warnings,
    }))
}

#[tauri::command]
pub fn openai_yaml_generate(
    skill_dir: String,
    fields: OpenaiFields,
    overwrite: Option<bool>,
) -> Result<serde_json::Value, String> {
    generate_openai_yaml_checked(
        Path::new(&skill_dir),
        fields,
        overwrite.unwrap_or(false),
        &owned_roots(),
    )
}

// ---------------------------------------------------------------------------
// C6 单测：路径逃逸全拒（验收硬标准）
// ---------------------------------------------------------------------------
#[cfg(test)]
mod c6_tests {
    use super::*;

    fn roots_with(tmp: &Path) -> Vec<PathBuf> {
        vec![tmp.to_path_buf()]
    }

    #[test]
    fn rejects_dotdot_rel() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        std::fs::create_dir_all(&skill).unwrap();
        let err = write_file_checked(&skill, "../evil.md", "x", &roots_with(tmp.path()))
            .unwrap_err();
        assert!(err.contains(".."), "{err}");
    }

    #[test]
    fn rejects_absolute_rel() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        let err = write_file_checked(&skill, r"C:\Windows\evil.md", "x", &roots_with(tmp.path()))
            .unwrap_err();
        assert!(err.contains("绝对路径"), "{err}");
    }

    #[test]
    fn rejects_unregistered_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let skill = outside.path().join("my-skill");
        std::fs::create_dir_all(&skill).unwrap();
        let err = write_file_checked(&skill, "a.md", "x", &roots_with(tmp.path())).unwrap_err();
        assert!(err.starts_with("PATH_ESCAPE"), "{err}");
    }

    #[test]
    fn rejects_sneaky_dotdot_into_sibling() {
        // rel 里 .. 解析后逃出 skill_dir 但仍在 root 下——归属过但 rel 安全闸先拒
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        std::fs::create_dir_all(&skill).unwrap();
        assert!(write_file_checked(&skill, "sub/../../x.md", "x", &roots_with(tmp.path()))
            .is_err());
    }

    #[test]
    fn allows_nested_rel_under_owned_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let skill = tmp.path().join("my-skill");
        std::fs::create_dir_all(&skill).unwrap();
        let written =
            write_file_checked(&skill, "references/guide.md", "hello", &roots_with(tmp.path()))
                .unwrap();
        assert!(written.exists());
        assert_eq!(std::fs::read_to_string(written).unwrap(), "hello");
    }

    #[test]
    fn normalize_resolves_dotdot_lexically() {
        let p = normalize(Path::new(r"C:\a\b\..\c"));
        assert_eq!(p, PathBuf::from(r"C:\a\c"));
    }
}

// ---------------------------------------------------------------------------
// C8 单测：emitter 格式快照 + 约束校验 + 覆盖备份
// ---------------------------------------------------------------------------
#[cfg(test)]
mod c8_tests {
    use super::*;

    fn valid_fields() -> OpenaiFields {
        OpenaiFields {
            display_name: "My Skill".into(),
            short_description: "A UI blurb of proper length here".into(), // 33 chars
            default_prompt: "Use $skill-name to do the thing".into(),
            icon_small: None,
            icon_large: None,
            brand_color: None,
        }
    }

    #[test]
    fn emitter_snapshot_order_quotes_indent() {
        let mut f = valid_fields();
        f.icon_small = Some("./assets/s.png".into());
        f.brand_color = Some("#3B82F6".into());
        let y = emit_openai_yaml(&f);
        assert_eq!(
            y,
            "interface:\n  display_name: \"My Skill\"\n  short_description: \"A UI blurb of proper length here\"\n  icon_small: \"./assets/s.png\"\n  brand_color: \"#3B82F6\"\n  default_prompt: \"Use $skill-name to do the thing\"\n",
            "字段顺序/引号/2 空格缩进必须镜像官方示例"
        );
    }

    #[test]
    fn emitter_escapes_quotes_backslash_newline() {
        let mut f = valid_fields();
        f.display_name = "Say \"hi\" \\ \n".into();
        let y = emit_openai_yaml(&f);
        assert!(y.contains("display_name: \"Say \\\"hi\\\" \\\\ \\n\""), "{y}");
    }

    #[test]
    fn rejects_missing_skill_name_token() {
        let tmp = tempfile::tempdir().unwrap();
        let mut f = valid_fields();
        f.default_prompt = "Do the thing".into();
        let err = generate_openai_yaml_checked(tmp.path(), f, false, &[tmp.path().to_path_buf()])
            .unwrap_err();
        assert!(err.contains("$skill-name"), "{err}");
    }

    #[test]
    fn rejects_short_desc_out_of_range() {
        let tmp = tempfile::tempdir().unwrap();
        let mut f = valid_fields();
        f.short_description = "too short".into();
        assert!(generate_openai_yaml_checked(tmp.path(), f.clone(), false, &[tmp.path().to_path_buf()])
            .unwrap_err()
            .contains("25"));
        let mut f2 = valid_fields();
        f2.short_description = "x".repeat(65);
        assert!(generate_openai_yaml_checked(tmp.path(), f2, false, &[tmp.path().to_path_buf()])
            .is_err());
    }

    #[test]
    fn overwrite_backs_up_bak_and_bare_icon_normalized() {
        let tmp = tempfile::tempdir().unwrap();
        let roots = vec![tmp.path().to_path_buf()];
        let f = valid_fields();
        let first = generate_openai_yaml_checked(tmp.path(), f.clone(), false, &roots).unwrap();
        assert!(first["path"].as_str().unwrap().contains("openai.yaml"));
        // 已存在 → 默认拒
        assert_eq!(
            generate_openai_yaml_checked(tmp.path(), f.clone(), false, &roots).unwrap_err(),
            "EXISTS"
        );
        // overwrite → .bak 出现
        let mut f3 = f.clone();
        f3.icon_small = Some("logo.png".into()); // 裸文件名 → ./assets/logo.png（资源不存在 → warn 不阻断）
        let res = generate_openai_yaml_checked(tmp.path(), f3, true, &roots).unwrap();
        let warns = res["warnings"].as_array().unwrap();
        assert!(warns.iter().any(|w| w.as_str().unwrap().contains("icon_small")), "{res}");
        assert!(tmp.path().join("agents/openai.yaml.bak").exists());
        let content = std::fs::read_to_string(tmp.path().join("agents/openai.yaml")).unwrap();
        assert!(content.contains("icon_small: \"./assets/logo.png\""), "{content}");
    }

    #[test]
    fn rejects_unowned_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let err = generate_openai_yaml_checked(
            outside.path(),
            valid_fields(),
            false,
            &[tmp.path().to_path_buf()],
        )
        .unwrap_err();
        assert!(err.starts_with("PATH_ESCAPE"), "{err}");
    }
}

// ---------------------------------------------------------------------------
// C10：结构化编辑——frontmatter 行级外科手术（PLAN-06 §3.14）
// 策略：不解析重序列化。行式扫描顶层 key，只动被编辑 key 的行范围；
// 未知字段/注释/多行块字节级保留（验收硬标准）。零新依赖。
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
pub struct FrontmatterEdit {
    pub key: String,
    /// "set" | "delete"
    pub op: String,
    #[serde(default)]
    pub value: Option<String>,
}

fn fm_yaml_quote(s: &str) -> String {
    format!(
        "\"{}\"",
        s.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
    )
}

fn is_top_level(line: &str) -> bool {
    let t = line.trim_end_matches('\r');
    !t.is_empty()
        && !t.starts_with(' ')
        && !t.starts_with('\t')
        && !t.starts_with('#')
        && t.contains(':')
}

fn is_top_level_key(line: &str, key: &str) -> bool {
    is_top_level(line)
        && line.trim_end_matches('\r').split(':').next().unwrap_or("").trim() == key
}

/// 顶层 key 的行范围 [start, end)：key 行 → 下一个顶层 key 之前。
fn key_span(lines: &[String], key: &str) -> Option<(usize, usize)> {
    let start = lines.iter().position(|l| is_top_level_key(l, key))?;
    let end = lines[start + 1..]
        .iter()
        .position(|l| is_top_level(l))
        .map(|p| start + 1 + p)
        .unwrap_or(lines.len());
    Some((start, end))
}

/// frontmatter 行级编辑核心。返回新全文（frontmatter 之外的字节原样）。
pub(crate) fn edit_frontmatter_checked(
    md_content: &str,
    edits: &[FrontmatterEdit],
) -> Result<String, String> {
    let stripped = md_content.strip_prefix("---").ok_or("SKILL.md 无 frontmatter")?;
    let end_pos = stripped
        .find("\n---")
        .ok_or("frontmatter 未闭合")?;
    let fm = &stripped[..end_pos];
    let body = &stripped[end_pos..]; // 含 "\n---..." 前缀，原样保留
    let mut lines: Vec<String> = fm.split('\n').map(String::from).collect();

    for edit in edits {
        match edit.op.as_str() {
            "set" => {
                let value = edit.value.as_deref().ok_or("set 操作必须带 value")?;
                let new_line = format!("{}: {}", edit.key, fm_yaml_quote(value));
                if let Some((s, e)) = key_span(&lines, &edit.key) {
                    lines.splice(s..e, [new_line]);
                } else {
                    lines.push(new_line);
                }
            }
            "delete" => {
                if let Some((s, e)) = key_span(&lines, &edit.key) {
                    lines.splice(s..e, []);
                }
            }
            other => return Err(format!("未知编辑操作：{other}")),
        }
    }
    // body 含 "\n---..." 前缀（原样保留）；fm 与 body 拼接即还原分隔线
    Ok(format!("---{}{}", lines.join("\n"), body))
}

/// 结构化编辑命令：行级改写 SKILL.md frontmatter，写后跑诊断校验。
/// frontmatter 表单编辑专用——禁止用 skill_write_file 全量重写（丢未知字段）。
#[tauri::command]
pub fn skill_edit_frontmatter(
    skill_dir: String,
    edits: Vec<FrontmatterEdit>,
) -> Result<serde_json::Value, String> {
    let dir = PathBuf::from(&skill_dir);
    assert_path_owned_with_roots(&dir, &owned_roots())?;
    let md = dir.join("SKILL.md");
    let content =
        std::fs::read_to_string(&md).map_err(|e| format!("读取 SKILL.md 失败：{e}"))?;
    let new_content = edit_frontmatter_checked(&content, &edits)?;
    std::fs::write(&md, new_content).map_err(|e| format!("写入失败：{e}"))?;
    let report = crate::validate::validate_dir(&dir, crate::validate::Mode::Diagnostic);
    Ok(serde_json::json!({ "validation": report }))
}

// ---------------------------------------------------------------------------
// C10 单测：字节级保留（验收硬标准）
// ---------------------------------------------------------------------------
#[cfg(test)]
mod c10_tests {
    use super::*;

    /// 含未知字段（metadata 嵌套）+ 注释 + 多行块标量的第三方 SKILL.md fixture
    const FIXTURE: &str = "---\nname: old-name\ndescription: Old description\n# third-party comment\nmetadata:\n  author: someone\n  version: 2\ndescription_block: |\n  line1\n  line2\n---\n\n# Body\n\nKeep me.\n";

    #[test]
    fn set_preserves_unknown_fields_byte_level() {
        let out = edit_frontmatter_checked(
            FIXTURE,
            &[FrontmatterEdit {
                key: "name".into(),
                op: "set".into(),
                value: Some("new-name".into()),
            }],
        )
        .unwrap();
        // 除 name 行外逐字节一致
        let expect = FIXTURE.replacen(
            "name: old-name",
            "name: \"new-name\"",
            1,
        );
        assert_eq!(out, expect, "未知字段/注释/多行块必须字节级保留");
        assert!(out.contains("metadata:\n  author: someone\n  version: 2"));
        assert!(out.contains("description_block: |\n  line1\n  line2"));
        assert!(out.contains("# third-party comment"));
        assert!(out.ends_with("\n\n# Body\n\nKeep me.\n"));
    }

    #[test]
    fn set_replaces_multiline_block_range() {
        let out = edit_frontmatter_checked(
            FIXTURE,
            &[FrontmatterEdit {
                key: "description_block".into(),
                op: "set".into(),
                value: Some("flat now".into()),
            }],
        )
        .unwrap();
        assert!(out.contains("description_block: \"flat now\"\n---"));
        assert!(!out.contains("line1"), "块标量续行必须随整段移除");
    }

    #[test]
    fn delete_removes_key_only() {
        let out = edit_frontmatter_checked(
            FIXTURE,
            &[FrontmatterEdit {
                key: "metadata".into(),
                op: "delete".into(),
                value: None,
            }],
        )
        .unwrap();
        assert!(!out.contains("metadata:"));
        assert!(!out.contains("author: someone"));
        assert!(out.contains("name: old-name"));
        assert!(out.contains("# Body"), "正文不受影响");
    }

    #[test]
    fn set_appends_unknown_key() {
        let out = edit_frontmatter_checked(
            FIXTURE,
            &[FrontmatterEdit {
                key: "allowed-tools".into(),
                op: "set".into(),
                value: Some("Read,Grep".into()),
            }],
        )
        .unwrap();
        assert!(out.contains("description_block: |\n  line1\n  line2\nallowed-tools: \"Read,Grep\"\n---"));
    }

    #[test]
    fn rejects_no_frontmatter_and_unclosed() {
        assert!(edit_frontmatter_checked("# just body", &[]).is_err());
        assert!(edit_frontmatter_checked("---\nname: x\nno close", &[]).is_err());
    }
}

