//! 模块 C：技能规范校验器（PLAN-06 §3）
//!
//! C1：骨架 + FM 规则组。
//! - 独立模块，不依赖扫描管线：可校验任意目录（含未纳入扫描的草稿目录）。
//! - 双轨模式（§3.6）：Diagnostic 永不 fail（passed 恒 true）；Strict 下 Error 阻断。
//! - 规则表 = 数据 + 检查函数（§3.5）；strict_error 规则在严格模式升 Error。
//! - FM-01..08（§3.5 FM 层）：FM 层只做类型/格式检查，绝不报"未知字段"（CL/CX 层职责，C2）。
//!
//! 规则来源：两份官方 skill-creator 的 quick_validate.py 差异比对（§3.1）：
//! - name/description 必填、description 无尖括号 = 两家共识（All）
//! - name hyphen-case / name ≤64 / description ≤1024 = Codex 侧规则（Codex）
//! - user-invocable / disable-model-invocation 布尔类型 = Claude 合法字段（Claude）

use serde::Serialize;
use serde_yaml_ng::{Mapping, Value};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// 数据结构（§3.6 统一输出）
// ---------------------------------------------------------------------------

/// 校验模式（§3.6 双轨）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// 诊断：浏览/创作实时反馈，永不阻断
    Diagnostic,
    /// 严格：发布前闸，Error 阻断
    Strict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warn,
    Info,
}

/// 规则所属生态（决定计入哪侧矩阵）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Eco {
    All,
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Pass,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    pub rule_id: String,
    pub severity: Severity,
    pub message: String,
    pub path: String,
    pub hint: String,
    /// 矩阵分流用，不下发前端
    #[serde(skip)]
    pub eco: Eco,
}

#[derive(Debug, Clone, Serialize)]
pub struct EcoVerdict {
    pub verdict: Verdict,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Matrix {
    pub claude: EcoVerdict,
    pub codex: EcoVerdict,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationReport {
    pub mode: Mode,
    pub passed: bool,
    pub issues: Vec<Issue>,
    pub matrix: Matrix,
}

// ---------------------------------------------------------------------------
// 技能文件集（校验输入）
// ---------------------------------------------------------------------------

/// 一个技能目录的校验输入快照。SKILL.md 缺失/损坏也要能表达（FM-01 依赖）。
pub struct SkillFileset {
    /// C2 的 FS 规则组（引用文件存在性、目录深度等）需要以目录为基准
    #[allow(dead_code)]
    pub dir: PathBuf,
    pub skill_md_exists: bool,
    /// frontmatter 解析结果；None = 缺失或解析失败
    pub frontmatter: Option<Mapping>,
    /// frontmatter 缺失/解析失败的原因（供 FM-01 措辞）
    pub fm_error: Option<String>,
}

/// 从目录加载文件集。SKILL.md 不存在时返回 exists=false 的空快照，不报 Err。
pub fn load_fileset(dir: &Path) -> SkillFileset {
    let path = dir.join("SKILL.md");
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => {
            return SkillFileset {
                dir: dir.to_path_buf(),
                skill_md_exists: false,
                frontmatter: None,
                fm_error: None,
            }
        }
    };
    let (fm, fm_error) = match extract_frontmatter(&text) {
        Some(yaml) => match serde_yaml_ng::from_str::<Value>(&yaml) {
            Ok(Value::Mapping(m)) => (Some(m), None),
            Ok(_) => (None, Some("frontmatter 不是键值结构".to_string())),
            Err(e) => (None, Some(format!("YAML 解析失败: {}", e))),
        },
        None => (None, Some("缺少 frontmatter（文件需以 --- 包裹的 YAML 头开始）".to_string())),
    };
    SkillFileset {
        dir: dir.to_path_buf(),
        skill_md_exists: true,
        frontmatter: fm,
        fm_error,
    }
}

/// 提取 `---` 包裹的 frontmatter YAML 文本。容忍 BOM 与 CRLF。
fn extract_frontmatter(text: &str) -> Option<String> {
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.lines();
    // 首行必须是 ---（允许前导空行）
    loop {
        match lines.next() {
            Some(l) if l.trim().is_empty() => continue,
            Some(l) if l.trim() == "---" => break,
            _ => return None,
        }
    }
    let mut yaml = Vec::new();
    for l in lines {
        if l.trim() == "---" {
            return Some(yaml.join("\n"));
        }
        yaml.push(l);
    }
    None // 没有闭合 ---
}

fn fm_value<'a>(m: &'a Mapping, key: &str) -> Option<&'a Value> {
    m.get(&Value::String(key.to_string()))
}

// ---------------------------------------------------------------------------
// 规则表（§3.5 数据 + 检查函数）
// ---------------------------------------------------------------------------

struct RuleSpec {
    id: &'static str,
    base: Severity,
    /// strict 模式下 Warn 升 Error（§3.6：名称规范等卫生类规则严格模式升级）
    strict_error: bool,
    eco: Eco,
    check: fn(&SkillFileset) -> Option<(String, String)>, // (message, hint)
}

fn is_hyphen_case(s: &str) -> bool {
    !s.is_empty()
        && s
            .split('-')
            .all(|seg| !seg.is_empty() && seg.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()))
}

fn check_fm01(fs: &SkillFileset) -> Option<(String, String)> {
    if !fs.skill_md_exists {
        return Some((
            "未找到 SKILL.md".to_string(),
            "技能目录必须包含 SKILL.md".to_string(),
        ));
    }
    if fs.frontmatter.is_none() {
        return Some((
            format!("frontmatter 不可用：{}", fs.fm_error.as_deref().unwrap_or("未知原因")),
            "检查文件以 --- 开头与结尾包裹 YAML 头，且语法正确".to_string(),
        ));
    }
    None
}

fn check_required_string(fs: &SkillFileset, key: &'static str) -> Option<(String, String)> {
    let Some(m) = &fs.frontmatter else {
        return None; // FM-01 已报，不连锁
    };
    match fm_value(m, key) {
        None => Some((
            format!("frontmatter 缺少 {} 字段", key),
            format!("{} 为必填字段", key),
        )),
        Some(Value::String(s)) if s.trim().is_empty() => Some((
            format!("{} 不能为空", key),
            format!("请填写有意义的 {}", key),
        )),
        Some(Value::String(_)) => None,
        Some(_) => Some((
            format!("{} 必须是字符串", key),
            format!("将 {} 的值写成带引号的字符串", key),
        )),
    }
}

fn check_fm02(fs: &SkillFileset) -> Option<(String, String)> {
    check_required_string(fs, "name")
}

fn check_fm03(fs: &SkillFileset) -> Option<(String, String)> {
    check_required_string(fs, "description")
}

fn name_str(fs: &SkillFileset) -> Option<String> {
    fs.frontmatter
        .as_ref()
        .and_then(|m| fm_value(m, "name"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
}

fn desc_str(fs: &SkillFileset) -> Option<String> {
    fs.frontmatter
        .as_ref()
        .and_then(|m| fm_value(m, "description"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
}

fn check_fm04(fs: &SkillFileset) -> Option<(String, String)> {
    let name = name_str(fs)?;
    if is_hyphen_case(&name) {
        None
    } else {
        Some((
            format!("name '{}' 不符合 hyphen-case 规范", name),
            "仅小写字母/数字/连字符，不能首尾连字符或连续连字符".to_string(),
        ))
    }
}

fn check_fm05(fs: &SkillFileset) -> Option<(String, String)> {
    let name = name_str(fs)?;
    if name.chars().count() > 64 {
        Some((
            format!("name 长度 {} 超过 64 字符上限", name.chars().count()),
            "缩短 name（Codex 生态上限 64 字符）".to_string(),
        ))
    } else {
        None
    }
}

fn check_fm06(fs: &SkillFileset) -> Option<(String, String)> {
    let desc = desc_str(fs)?;
    if desc.contains('<') || desc.contains('>') {
        Some((
            "description 含有尖括号".to_string(),
            "移除 < > 字符（两家官方校验器均禁止）".to_string(),
        ))
    } else {
        None
    }
}

fn check_fm07(fs: &SkillFileset) -> Option<(String, String)> {
    let desc = desc_str(fs)?;
    if desc.chars().count() > 1024 {
        Some((
            format!("description 长度 {} 超过 1024 字符上限", desc.chars().count()),
            "精简 description（Codex 生态上限 1024 字符）".to_string(),
        ))
    } else {
        None
    }
}

fn check_fm08(fs: &SkillFileset) -> Option<(String, String)> {
    let Some(m) = &fs.frontmatter else {
        return None;
    };
    for key in ["user-invocable", "disable-model-invocation"] {
        if let Some(v) = fm_value(m, key) {
            if !v.is_bool() {
                return Some((
                    format!("字段 '{}' 必须是布尔值", key),
                    "写成 true / false（不加引号）".to_string(),
                ));
            }
        }
    }
    None
}

/// FM 规则组（C1）。CL/CX/FS 规则组由 C2 追加。
static RULES: &[RuleSpec] = &[
    RuleSpec { id: "FM-01", base: Severity::Error, strict_error: false, eco: Eco::All, check: check_fm01 },
    RuleSpec { id: "FM-02", base: Severity::Error, strict_error: false, eco: Eco::All, check: check_fm02 },
    RuleSpec { id: "FM-03", base: Severity::Error, strict_error: false, eco: Eco::All, check: check_fm03 },
    RuleSpec { id: "FM-04", base: Severity::Warn, strict_error: true, eco: Eco::Codex, check: check_fm04 },
    RuleSpec { id: "FM-05", base: Severity::Warn, strict_error: true, eco: Eco::Codex, check: check_fm05 },
    RuleSpec { id: "FM-06", base: Severity::Error, strict_error: false, eco: Eco::All, check: check_fm06 },
    RuleSpec { id: "FM-07", base: Severity::Warn, strict_error: true, eco: Eco::Codex, check: check_fm07 },
    RuleSpec { id: "FM-08", base: Severity::Error, strict_error: false, eco: Eco::Claude, check: check_fm08 },
];

// ---------------------------------------------------------------------------
// 校验入口
// ---------------------------------------------------------------------------

pub fn validate_fileset(fs: &SkillFileset, mode: Mode) -> ValidationReport {
    let mut issues: Vec<Issue> = Vec::new();
    for rule in RULES {
        if let Some((message, hint)) = (rule.check)(fs) {
            let severity = match (mode, rule.base, rule.strict_error) {
                (Mode::Strict, Severity::Warn, true) => Severity::Error,
                _ => rule.base,
            };
            issues.push(Issue {
                rule_id: rule.id.to_string(),
                severity,
                message,
                path: "SKILL.md".to_string(),
                hint,
                eco: rule.eco,
            });
        }
    }
    let passed = match mode {
        Mode::Diagnostic => true, // §3.6：诊断模式永不 fail
        Mode::Strict => !issues.iter().any(|i| i.severity == Severity::Error),
    };
    ValidationReport {
        mode,
        passed,
        matrix: Matrix {
            claude: eco_verdict(&issues, Eco::Claude, mode),
            codex: eco_verdict(&issues, Eco::Codex, mode),
        },
        issues,
    }
}

/// 校验任意技能目录（§3.8：独立可用，创作页实时校验也走它）。
pub fn validate_dir(dir: &Path, mode: Mode) -> ValidationReport {
    validate_fileset(&load_fileset(dir), mode)
}

fn eco_verdict(issues: &[Issue], eco: Eco, mode: Mode) -> EcoVerdict {
    let rel: Vec<&Issue> = issues
        .iter()
        .filter(|i| i.eco == Eco::All || i.eco == eco)
        .collect();
    let notes = rel
        .iter()
        .filter(|i| i.severity != Severity::Info)
        .map(|i| format!("[{}] {}", i.rule_id, i.message))
        .collect();
    let has_error = rel.iter().any(|i| i.severity == Severity::Error);
    let has_warn = rel.iter().any(|i| i.severity == Severity::Warn);
    let verdict = if has_error && mode == Mode::Strict {
        Verdict::Fail
    } else if has_error || has_warn {
        Verdict::Warn
    } else {
        Verdict::Pass
    };
    EcoVerdict { verdict, notes }
}

// ---------------------------------------------------------------------------
// 测试（C1 验收：两份官方原件 fixture + 规则单测）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn fileset_from(content: &str) -> (tempfile::TempDir, SkillFileset) {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("SKILL.md"), content).unwrap();
        let fs = load_fileset(tmp.path());
        (tmp, fs)
    }

    fn rule_ids(rep: &ValidationReport) -> Vec<String> {
        rep.issues.iter().map(|i| i.rule_id.clone()).collect()
    }

    // ---- FM-01：SKILL.md 存在性 / frontmatter 可解析 ----

    #[test]
    fn fm01_missing_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let rep = validate_dir(tmp.path(), Mode::Strict);
        assert!(!rep.passed);
        assert!(rule_ids(&rep).contains(&"FM-01".to_string()));
    }

    #[test]
    fn fm01_no_frontmatter() {
        let (_t, fs) = fileset_from("# 只有正文没有头\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-01".to_string()));
    }

    #[test]
    fn fm01_broken_yaml() {
        let (_t, fs) = fileset_from("---\nname: [unclosed\n---\nbody\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-01".to_string()));
    }

    #[test]
    fn fm01_unclosed_frontmatter() {
        let (_t, fs) = fileset_from("---\nname: x\n没有闭合线\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-01".to_string()));
    }

    #[test]
    fn fm01_tolerates_bom_and_crlf() {
        let (_t, fs) = fileset_from("\u{feff}---\r\nname: ok-skill\r\ndescription: fine\r\n---\r\nbody\r\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rep.issues.is_empty(), "{:?}", rep.issues);
    }

    // ---- FM-02 / FM-03：必填字段 ----

    #[test]
    fn fm02_missing_name() {
        let (_t, fs) = fileset_from("---\ndescription: has desc\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-02".to_string()));
    }

    #[test]
    fn fm02_non_string_name() {
        let (_t, fs) = fileset_from("---\nname: 123\ndescription: d\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-02".to_string()));
    }

    #[test]
    fn fm03_empty_description() {
        let (_t, fs) = fileset_from("---\nname: ok\ndescription: \"   \"\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-03".to_string()));
    }

    // ---- FM-04：hyphen-case（Codex 生态） ----

    #[test]
    fn fm04_format_violations() {
        for bad in ["Pdf-Toolkit", "pdf_toolkit", "-pdf", "pdf-", "pdf--x", "pdf toolkit"] {
            let content = format!("---\nname: {}\ndescription: d\n---\n", bad);
            let (_t, fs) = fileset_from(&content);
            let rep = validate_fileset(&fs, Mode::Strict);
            assert!(
                rule_ids(&rep).contains(&"FM-04".to_string()),
                "'{}' 应触发 FM-04",
                bad
            );
            // Codex 侧受影响，Claude 侧必须无感
            assert_eq!(rep.matrix.claude.verdict, Verdict::Pass);
            assert_eq!(rep.matrix.codex.verdict, Verdict::Fail);
        }
    }

    #[test]
    fn fm04_valid_names_pass() {
        for ok in ["pdf", "pdf-toolkit", "a1-b2", "gh-address-comments"] {
            let content = format!("---\nname: {}\ndescription: d\n---\n", ok);
            let (_t, fs) = fileset_from(&content);
            let rep = validate_fileset(&fs, Mode::Strict);
            assert!(!rule_ids(&rep).contains(&"FM-04".to_string()), "'{}' 不应触发", ok);
        }
    }

    // ---- FM-05：name ≤ 64 ----

    #[test]
    fn fm05_name_too_long() {
        let long = "a".repeat(65);
        let (_t, fs) = fileset_from(&format!("---\nname: {}\ndescription: d\n---\n", long));
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-05".to_string()));
    }

    // ---- FM-06：description 尖括号（两家共识） ----

    #[test]
    fn fm06_angle_brackets() {
        let (_t, fs) = fileset_from("---\nname: ok\ndescription: use <b> tags\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-06".to_string()));
        // 两家共识 → 双侧矩阵都计入
        assert_eq!(rep.matrix.claude.verdict, Verdict::Fail);
        assert_eq!(rep.matrix.codex.verdict, Verdict::Fail);
    }

    // ---- FM-07：description ≤ 1024 ----

    #[test]
    fn fm07_description_too_long() {
        let long = "x".repeat(1025);
        let (_t, fs) = fileset_from(&format!("---\nname: ok\ndescription: {}\n---\n", long));
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-07".to_string()));
    }

    // ---- FM-08：Claude 布尔字段类型检查 ----

    #[test]
    fn fm08_boolean_type_check() {
        let (_t, fs) = fileset_from("---\nname: ok\ndescription: d\nuser-invocable: \"yes\"\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(rule_ids(&rep).contains(&"FM-08".to_string()));
        // Claude 生态字段：claude 侧 fail，codex 侧无感（未知字段归 CX 层，C2）
        assert_eq!(rep.matrix.claude.verdict, Verdict::Fail);
        assert_eq!(rep.matrix.codex.verdict, Verdict::Pass);
    }

    #[test]
    fn fm08_boolean_ok() {
        let (_t, fs) = fileset_from("---\nname: ok\ndescription: d\nuser-invocable: true\ndisable-model-invocation: false\n---\n");
        let rep = validate_fileset(&fs, Mode::Strict);
        assert!(!rule_ids(&rep).contains(&"FM-08".to_string()));
    }

    // ---- 双轨模式（§3.6） ----

    #[test]
    fn dual_track_diagnostic_never_fails() {
        let (_t, fs) = fileset_from("---\nname: Bad_Name\ndescription: d\n---\n");
        let diag = validate_fileset(&fs, Mode::Diagnostic);
        assert!(diag.passed, "诊断模式 passed 恒 true");
        assert_ne!(diag.matrix.codex.verdict, Verdict::Fail, "诊断模式 verdict 不得 fail");
        // 卫生类规则诊断模式保持 Warn
        let fm04 = diag.issues.iter().find(|i| i.rule_id == "FM-04").unwrap();
        assert_eq!(fm04.severity, Severity::Warn);

        let strict = validate_fileset(&fs, Mode::Strict);
        assert!(!strict.passed, "严格模式必须阻断");
        assert_eq!(strict.matrix.codex.verdict, Verdict::Fail);
        let fm04s = strict.issues.iter().find(|i| i.rule_id == "FM-04").unwrap();
        assert_eq!(fm04s.severity, Severity::Error, "严格模式升级为 Error");
    }

    #[test]
    fn diagnostic_still_reports_structural_errors_but_never_fails() {
        let (_t, fs) = fileset_from("---\ndescription: no name\n---\n");
        let diag = validate_fileset(&fs, Mode::Diagnostic);
        assert!(diag.passed);
        assert!(rule_ids(&diag).contains(&"FM-02".to_string()));
        assert_ne!(diag.matrix.claude.verdict, Verdict::Fail);
    }

    // ---- C1 验收：官方原件 fixture ----

    /// Claude 官方 skill-creator 形态的合规 fixture（本机原件已缺失，用符合
    /// Claude 规范的合成件替代：仅 name/description，格式合规）。
    #[test]
    fn fixture_claude_convention_all_green() {
        let (_t, fs) = fileset_from(
            "---\nname: skill-creator\ndescription: Guide for creating effective Agent Skills. Use when users want to create, update, or validate a skill.\n---\n\n# Skill Creator\n\nBody content.\n",
        );
        for mode in [Mode::Strict, Mode::Diagnostic] {
            let rep = validate_fileset(&fs, mode);
            assert!(rep.issues.is_empty(), "Claude 形态应全绿: {:?}", rep.issues);
            assert!(rep.passed);
            assert_eq!(rep.matrix.claude.verdict, Verdict::Pass);
            assert_eq!(rep.matrix.codex.verdict, Verdict::Pass);
        }
    }

    /// Codex 官方 skill-creator 原件（真机环境测试：文件不存在则跳过）。
    /// 验收口径（PLAN-06 §3.1）：FM 层对官方原件应全绿——官方自家校验器的
    /// 并集规则就出自这里；差异项（若有）属 CL/CX 层职责，C2 再钉。
    #[test]
    fn real_codex_skill_creator_original() {
        let Some(home) = dirs::home_dir() else { return };
        let dir = home.join(".codex").join("skills").join(".system").join("skill-creator");
        if !dir.join("SKILL.md").is_file() {
            return; // 无原件环境自动跳过
        }
        let fs = load_fileset(&dir);
        let rep = validate_fileset(&fs, Mode::Strict);
        let fm_issues: Vec<&Issue> = rep
            .issues
            .iter()
            .filter(|i| i.rule_id.starts_with("FM-"))
            .collect();
        assert!(
            fm_issues.is_empty(),
            "Codex 官方 skill-creator 未过 FM 层: {:?}",
            fm_issues
        );
    }
}
