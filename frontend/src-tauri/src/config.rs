//! 配置管理（v0.2 数据模型，PLAN-06 §2.6 / B1）
//!
//! 配置文件：<Roaming>\Skills Shark\config.json
//!
//! 数据源从 v0.1 扁平 `scan_paths` 升级为 `tools` 注册表：
//! - 外部工具（注册表内置 10 家）：多候选路径，支持 `~` / `$VAR` 展开（expand_path）；
//! - 应用自有来源（builtin/imported，C5 起加 authored）：app_owned=true，路径运行时
//!   动态解析（dev↔prod 漂移免疫，取代 v0.1 的 label/path 猜测式自愈），linkable=false。
//!
//! v0.1 `scan_paths` 读兼容一版：仅当 `tools` 缺失时作为迁移输入
//! （migrate_scan_paths_to_tools，幂等），写时丢弃。前端过渡期契约不变：
//! MaskedConfig.scan_paths 由 tools 派生（config_view_from_tools），save_config
//! 收到的 scan_paths 反向合并回 tools（apply_scan_paths_edit）；B5 前端改造后拆除桥接。

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

/// 追加写调试日志到 _data/debug.log（release 也能查）
pub fn debug_log(msg: &str) {
    let path = get_data_dir().join("debug.log");
    let line = format!(
        "[{}] {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        msg
    );
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(line.as_bytes());
    }
}

// ---------------------------------------------------------------------------
// 数据目录（PLAN-04 §1：外部化、单一目录）
// ---------------------------------------------------------------------------

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 项目根（frontend/src-tauri 上两级 = skills-manager/）
fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 旧版数据目录（项目 _data/）。仅作 init 前兜底与一次性迁移源。
fn legacy_data_dir() -> PathBuf {
    project_root().join("_data")
}

/// 固定数据目录名：与 identifier 解耦——identifier/产品名再变更不会孤儿化数据。
const DATA_DIR_NAME: &str = "Skills Shark";

/// 初始化数据/资源目录，lib.rs setup 调一次。
/// 解析优先级：SKILLS_MANAGER_DATA env（portable 口子）> Roaming\Skills Shark
/// （D1）> 旧版兜底。dev/prod 同机同目录（D5 不隔离）。
pub fn init_data_dir(app: &tauri::AppHandle) {
    let dir = match std::env::var("SKILLS_MANAGER_DATA") {
        Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
        _ => app
            .path()
            .data_dir()
            .map(|d| d.join(DATA_DIR_NAME))
            .unwrap_or_else(|_| legacy_data_dir()),
    };
    let _ = DATA_DIR.set(dir.clone());
    if let Ok(rd) = app.path().resource_dir() {
        let _ = RESOURCE_DIR.set(rd);
    }
    migrate_legacy_data(&dir);
    debug_log(&format!("data_dir initialized: {}", dir.display()));
}

/// 一次性迁移：新目录新鲜（无 config/translations.json）且旧项目 _data
/// 有内容时拷贝。旧目录原样保留作备份，不删。
fn migrate_legacy_data(target: &PathBuf) {
    let legacy = legacy_data_dir();
    if legacy == *target || !legacy.is_dir() {
        return;
    }
    if target.join("config.json").exists() || target.join("translations.json").exists() {
        return;
    }
    let _ = fs::create_dir_all(target.join("translations"));
    let mut copied: Vec<String> = Vec::new();
    for name in ["config.json", "translations.json"] {
        let src = legacy.join(name);
        if src.is_file() && fs::copy(&src, target.join(name)).is_ok() {
            copied.push(name.to_string());
        }
    }
    if let Ok(entries) = fs::read_dir(legacy.join("translations")) {
        for e in entries.filter_map(|e| e.ok()) {
            let src = e.path();
            let dst = target.join("translations").join(e.file_name());
            if src.is_file() && !dst.exists() && fs::copy(&src, &dst).is_ok() {
                copied.push(format!("translations/{}", e.file_name().to_string_lossy()));
            }
        }
    }
    if !copied.is_empty() {
        debug_log(&format!("migrated from legacy _data: {}", copied.join(", ")));
    }
}

/// 获取数据目录。init 前回退旧版项目 _data（保持旧行为不崩）。
pub fn get_data_dir() -> PathBuf {
    DATA_DIR.get().cloned().unwrap_or_else(legacy_data_dir)
}

/// 导入 skills 存放目录（PLAN-04 §3，Phase 1 接入扫描与 UI）
pub fn imported_dir() -> PathBuf {
    get_data_dir().join("imported")
}

/// Skill Pack canonical 存储目录（PLAN-05 §2.4：packs/<id>/）
pub fn packs_dir() -> PathBuf {
    get_data_dir().join("packs")
}

fn config_path() -> PathBuf {
    get_data_dir().join("config.json")
}

pub fn translations_dir() -> PathBuf {
    get_data_dir().join("translations")
}

pub fn translations_json_path() -> PathBuf {
    get_data_dir().join("translations.json")
}

fn ensure_data_dir() {
    let dir = get_data_dir();
    let _ = fs::create_dir_all(&dir);
    let _ = fs::create_dir_all(translations_dir());
}

// ---------------------------------------------------------------------------
// 数据模型
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanPathItem {
    pub path: String,
    pub label: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LLMConfig {
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
}

fn default_base_url() -> String {
    "https://api.deepseek.com".to_string()
}

fn default_model() -> String {
    "deepseek-v4-flash".to_string()
}

/// v0.2 工具注册表条目（PLAN-06 §2.6）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolEntry {
    /// 稳定 id：注册表工具（claude-code/codex/...）或 custom-<slug> / builtin / imported
    pub id: String,
    /// 显示名，同时作为扫描结果的 scan_label（「导入」/「builtin」两个名字是
    /// scanner/translations 的硬契约，勿改）
    pub name: String,
    /// 候选路径，可含 `~` / `$VAR` 模板；app_owned 条目此字段被忽略（动态解析）
    #[serde(default)]
    pub paths: Vec<String>,
    /// true = app 内置（注册表工具或应用自有来源），不可被前端删除只能禁用
    #[serde(default)]
    pub builtin: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 能否成为 Hub 引用（link/copy）落点；app_owned 来源恒 false
    #[serde(default = "default_true")]
    pub linkable: bool,
    /// 应用自有来源（builtin/imported/authored）：路径动态解析 + 虚拟 id 语义
    #[serde(default)]
    pub app_owned: bool,
}

/// 应用自有来源 id（scanner/translations 依赖其 name 契约）
pub const TOOL_ID_BUILTIN: &str = "builtin";
pub const TOOL_ID_IMPORTED: &str = "imported";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub tools: Vec<ToolEntry>,
    #[serde(default = "default_llm")]
    pub llm: LLMConfig,
}

/// 读兼容解析结构：区分「字段缺失」与「显式空数组」
#[derive(Deserialize)]
struct RawConfig {
    tools: Option<Vec<ToolEntry>>,
    /// v0.1 遗留：仅在 tools 缺失时作为迁移输入
    scan_paths: Option<Vec<ScanPathItem>>,
    #[serde(default)]
    llm: Option<LLMConfig>,
}

fn default_llm() -> LLMConfig {
    LLMConfig {
        api_key: String::new(),
        base_url: default_base_url(),
        model: default_model(),
    }
}

/// builtin skills 目录（dev: 项目 skills/；release: 资源目录 skills/，
/// 经 bundle.resources 打包，见 tauri.conf.json）
fn builtin_skills_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        project_root().join("skills")
    } else {
        RESOURCE_DIR.get().map(|r| r.join("skills")).unwrap_or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."))
                .join("skills")
        })
    }
}

/// v0.2 内置工具注册表（PLAN-06 §2.2 逐家核实过的真实目录）。
/// 注册表是静态数据：目录出现即被扫描（v0.1 是首装探测后冻结，此为有意升级）。
struct RegistryTool {
    id: &'static str,
    name: &'static str,
    paths: &'static [&'static str],
}

const TOOL_REGISTRY: &[RegistryTool] = &[
    RegistryTool { id: "claude-code", name: "Claude Code", paths: &["~/.claude/skills"] },
    // $CODEX_HOME 优先（镜像 Codex CLI 自身解析序）；展开失败自动落到后续候选
    RegistryTool { id: "codex", name: "Codex CLI", paths: &["$CODEX_HOME/skills", "~/.codex/skills", "~/.agents/skills"] },
    RegistryTool { id: "cursor", name: "Cursor", paths: &["~/.cursor/skills"] },
    RegistryTool { id: "opencode", name: "OpenCode", paths: &["~/.opencode/skills", "~/.config/opencode/skills"] },
    RegistryTool { id: "openclaw", name: "OpenClaw", paths: &["~/.openclaw/skills"] },
    RegistryTool { id: "windsurf", name: "Windsurf", paths: &["~/.codeium/windsurf/skills"] },
    RegistryTool { id: "copilot", name: "Copilot", paths: &["~/.copilot/skills"] },
    RegistryTool { id: "cline", name: "Cline", paths: &["~/.cline/skills"] },
    RegistryTool { id: "continue", name: "Continue", paths: &["~/.continue/skills"] },
    RegistryTool { id: "aider", name: "Aider", paths: &["~/.aider/skills"] },
];

/// v0.1 label → 注册表 id（迁移/反向合并用）
fn registry_id_by_legacy_label(label: &str) -> Option<&'static str> {
    match label {
        "Claude" => Some("claude-code"),
        "Codex" => Some("codex"),
        "Cursor" => Some("cursor"),
        "OpenCode" => Some("opencode"),
        "OpenClaw" => Some("openclaw"),
        "Windsurf" => Some("windsurf"),
        "Copilot" => Some("copilot"),
        "Cline" => Some("cline"),
        "Continue" => Some("continue"),
        "Aider" => Some("aider"),
        _ => None,
    }
}

fn registry_entry(reg: &RegistryTool, enabled: bool) -> ToolEntry {
    ToolEntry {
        id: reg.id.to_string(),
        name: reg.name.to_string(),
        paths: reg.paths.iter().map(|s| s.to_string()).collect(),
        builtin: true,
        enabled,
        linkable: true,
        app_owned: false,
    }
}

fn app_owned_tool(id: &str, name: &str) -> ToolEntry {
    ToolEntry {
        id: id.to_string(),
        name: name.to_string(),
        paths: vec![],
        builtin: true,
        enabled: true,
        linkable: false,
        app_owned: true,
    }
}

/// 应用自有来源的运行时路径（不存配置，dev↔prod 漂移免疫）
pub fn app_owned_path(tool_id: &str) -> Option<PathBuf> {
    match tool_id {
        TOOL_ID_BUILTIN => Some(builtin_skills_dir()),
        TOOL_ID_IMPORTED => Some(imported_dir()),
        _ => None, // authored：C5 接入
    }
}

/// 路径展开：`~` → home；`$VAR` / `$VAR/rest` → 环境变量（未设置/为空 → None，
/// 候选自动失效）；其余原样。
pub fn expand_path(s: &str) -> Option<PathBuf> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    if t == "~" {
        return dirs::home_dir();
    }
    if let Some(rest) = t.strip_prefix("~/").or_else(|| t.strip_prefix("~\\")) {
        return dirs::home_dir().map(|h| h.join(rest));
    }
    if let Some(body) = t.strip_prefix('$') {
        let (var, rest) = match body.find(['/', '\\']) {
            Some(i) => (&body[..i], &body[i + 1..]),
            None => (body, ""),
        };
        if var.is_empty() {
            return None;
        }
        let val = std::env::var(var).ok().filter(|v| !v.trim().is_empty())?;
        let mut p = PathBuf::from(val);
        if !rest.is_empty() {
            p = p.join(rest.trim_start_matches(['/', '\\']));
        }
        return Some(p);
    }
    Some(PathBuf::from(t))
}

/// 大小写折叠 + 分隔符统一 + 去尾部分隔符（Windows 路径比较用）。
/// 实测边界：用户配置中同目录可能以 `\` 与混合 `/` 两种形态并存，
/// 不统一分隔符会导致重复候选 → 重复扫描。
fn norm_for_compare(p: &std::path::Path) -> String {
    let mut s = p.to_string_lossy().to_lowercase();
    if cfg!(windows) {
        s = s.replace('/', "\\");
    }
    s.trim_end_matches(['/', '\\']).to_string()
}

/// 去重追加候选路径（按展开后语义比较；展开失败的模板按原文比较）
fn push_path_if_new(paths: &mut Vec<String>, candidate: &str) {
    let c = candidate.trim();
    if c.is_empty() {
        return;
    }
    let c_norm = expand_path(c).map(|p| norm_for_compare(&p));
    for existing in paths.iter() {
        let e_norm = expand_path(existing).map(|p| norm_for_compare(&p));
        match (&e_norm, &c_norm) {
            (Some(a), Some(b)) if a == b => return,
            (None, None) if existing.trim() == c => return,
            _ => {}
        }
    }
    paths.push(c.to_string());
}

/// 新鲜安装默认：builtin 自有源 + 全量注册表（enabled；扫描时过滤不存在的目录）
pub fn default_tools() -> Vec<ToolEntry> {
    let mut tools = vec![app_owned_tool(TOOL_ID_BUILTIN, "builtin")];
    tools.extend(TOOL_REGISTRY.iter().map(|r| registry_entry(r, true)));
    tools.push(app_owned_tool(TOOL_ID_IMPORTED, "导入"));
    tools
}

/// 保证应用自有来源条目存在（entry 恒在，enabled 可由用户控制）。
/// v0.2 中 app 自有源是应用不变量，不再是可删的扫描路径。
fn ensure_app_owned_entries(tools: &mut Vec<ToolEntry>) {
    if !tools.iter().any(|t| t.id == TOOL_ID_BUILTIN) {
        tools.insert(0, app_owned_tool(TOOL_ID_BUILTIN, "builtin"));
    }
    if !tools.iter().any(|t| t.id == TOOL_ID_IMPORTED) {
        tools.push(app_owned_tool(TOOL_ID_IMPORTED, "导入"));
    }
}

/// v0.1 scan_paths → v0.2 tools 迁移（幂等：load 侧仅在 tools 缺失时调用）。
/// 语义：同 label 多行合并为一个 tool（候选级开关坍缩为工具级，OR 语义）；
/// 已知 label 的非标准路径作为附加候选保留（不丢用户自定义落点）。
pub fn migrate_scan_paths_to_tools(items: &[ScanPathItem]) -> Vec<ToolEntry> {
    let mut tools: Vec<ToolEntry> = Vec::new();
    for sp in items {
        if sp.label == "builtin" || sp.label == "导入" {
            let id = if sp.label == "builtin" { TOOL_ID_BUILTIN } else { TOOL_ID_IMPORTED };
            match tools.iter_mut().find(|t| t.id == id) {
                Some(t) => t.enabled = t.enabled || sp.enabled,
                None => {
                    let mut t = app_owned_tool(id, &sp.label);
                    t.enabled = sp.enabled;
                    tools.push(t);
                }
            }
            continue;
        }
        if let Some(reg_id) = registry_id_by_legacy_label(&sp.label) {
            let reg = TOOL_REGISTRY.iter().find(|r| r.id == reg_id).expect("registry invariant");
            match tools.iter_mut().find(|t| t.id == reg_id) {
                Some(t) => {
                    t.enabled = t.enabled || sp.enabled;
                    push_path_if_new(&mut t.paths, &sp.path);
                }
                None => {
                    let mut t = registry_entry(reg, sp.enabled);
                    push_path_if_new(&mut t.paths, &sp.path);
                    tools.push(t);
                }
            }
            continue;
        }
        // 自定义来源：按 label 合并
        let slug = slugify_label(&sp.label);
        let id = if slug.is_empty() {
            format!("custom-{}", short_hash(&sp.path))
        } else {
            format!("custom-{}", slug)
        };
        match tools.iter_mut().find(|t| t.id == id) {
            Some(t) => {
                t.enabled = t.enabled || sp.enabled;
                push_path_if_new(&mut t.paths, &sp.path);
            }
            None => tools.push(ToolEntry {
                id,
                name: if sp.label.trim().is_empty() { sp.path.clone() } else { sp.label.clone() },
                paths: vec![sp.path.clone()],
                builtin: false,
                enabled: sp.enabled,
                linkable: true,
                app_owned: false,
            }),
        }
    }
    tools
}

fn slugify_label(label: &str) -> String {
    let s: String = label
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    s.trim_matches('-').to_string()
}

/// 短哈希（自定义源无 label 时的 id 兜底，非安全用途）
fn short_hash(s: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    format!("{:x}", h.finish())
}

/// 扫描派生：enabled 工具 → 实际要扫的目录（app_owned 动态解析；外部工具
/// 展开候选后取存在者——与 v0.1「存在的配置路径全扫」行为一致）。
/// 返回 ScanPathItem 视图供 scanner 消费（B4 前 scanner 不改签名）。
pub fn scan_items_from_tools(tools: &[ToolEntry]) -> Vec<ScanPathItem> {
    let mut out = Vec::new();
    for tool in tools.iter().filter(|t| t.enabled) {
        let dirs: Vec<PathBuf> = if tool.app_owned {
            app_owned_path(&tool.id).into_iter().filter(|p| p.is_dir()).collect()
        } else {
            let mut seen = std::collections::HashSet::new();
            tool.paths
                .iter()
                .filter_map(|c| expand_path(c))
                .filter(|p| p.is_dir())
                .filter(|p| seen.insert(norm_for_compare(p)))
                .collect()
        };
        for d in dirs {
            out.push(ScanPathItem {
                path: d.to_string_lossy().to_string(),
                label: tool.name.clone(),
                enabled: true,
            });
        }
    }
    out
}

/// 前端过渡视图（MaskedConfig.scan_paths 派生源）：
/// - app_owned：恒显示（路径动态解析，存在性由 path_exists 表达）
/// - 注册表工具：仅当有候选目录存在时显示其存在的候选（含 disabled 行，供重新启用）
/// - 自定义工具：恒显示其存储路径
pub fn config_view_from_tools(tools: &[ToolEntry]) -> Vec<ScanPathItem> {
    let mut out = Vec::new();
    for tool in tools {
        if tool.app_owned {
            if let Some(p) = app_owned_path(&tool.id) {
                out.push(ScanPathItem {
                    path: p.to_string_lossy().to_string(),
                    label: tool.name.clone(),
                    enabled: tool.enabled,
                });
            }
            continue;
        }
        if tool.builtin {
            let mut seen = std::collections::HashSet::new();
            for c in &tool.paths {
                if let Some(p) = expand_path(c) {
                    if p.is_dir() && seen.insert(norm_for_compare(&p)) {
                        out.push(ScanPathItem {
                            path: p.to_string_lossy().to_string(),
                            label: tool.name.clone(),
                            enabled: tool.enabled,
                        });
                    }
                }
            }
            continue;
        }
        for p in &tool.paths {
            out.push(ScanPathItem {
                path: p.clone(),
                label: tool.name.clone(),
                enabled: tool.enabled,
            });
        }
    }
    out
}

/// 前端保存反向合并（过渡期桥接）：incoming scan_paths 行 → tools 更新。
/// - app_owned 行：在 → enabled 随行；不在（用户删行）→ enabled=false（条目保留）
/// - 注册表工具：路径命中其展开候选或 label 同名 → 更新 enabled；新增路径吸收为候选；
///   无任何行且此前有存在候选（用户删行）→ enabled=false；隐藏工具（无存在候选）不动
/// - 其余行 → 自定义工具（按 label 合并），整段重建
pub fn apply_scan_paths_edit(current: &[ToolEntry], items: &[ScanPathItem]) -> Vec<ToolEntry> {
    let mut matched = vec![false; items.len()];
    let mut result: Vec<ToolEntry> = Vec::new();

    for tool in current {
        let mut t = tool.clone();
        if tool.app_owned {
            let rows: Vec<usize> = items
                .iter()
                .enumerate()
                .filter(|(_, sp)| sp.label == tool.name)
                .map(|(i, _)| i)
                .collect();
            if rows.is_empty() {
                t.enabled = false; // 用户删行：禁用但保留条目（应用不变量）
            } else {
                t.enabled = rows.iter().any(|i| items[*i].enabled);
                for i in rows {
                    matched[i] = true;
                }
            }
            result.push(t);
            continue;
        }
        if tool.builtin {
            let candidates: Vec<String> = tool
                .paths
                .iter()
                .filter_map(|c| expand_path(c))
                .map(|p| norm_for_compare(&p))
                .collect();
            let rows: Vec<usize> = items
                .iter()
                .enumerate()
                .filter(|(_, sp)| {
                    sp.label == tool.name
                        || candidates.contains(&norm_for_compare(std::path::Path::new(&sp.path)))
                })
                .map(|(i, _)| i)
                .collect();
            if rows.is_empty() {
                // 无行：此前有存在候选 = 用户删行 → 禁用；隐藏工具不动
                let had_existing = tool.paths.iter().any(|c| {
                    expand_path(c).map(|p| p.is_dir()).unwrap_or(false)
                });
                if had_existing {
                    t.enabled = false;
                }
            } else {
                t.enabled = rows.iter().any(|i| items[*i].enabled);
                for i in &rows {
                    push_path_if_new(&mut t.paths, &items[*i].path);
                    matched[*i] = true;
                }
            }
            result.push(t);
            continue;
        }
        // 自定义工具在下方由未匹配行重建，此处丢弃旧条目
    }

    for (i, sp) in items.iter().enumerate() {
        if matched[i] {
            continue;
        }
        let migrated = migrate_scan_paths_to_tools(std::slice::from_ref(sp));
        for mt in migrated {
            match result.iter_mut().find(|t| t.id == mt.id) {
                Some(t) => {
                    t.enabled = t.enabled || mt.enabled;
                    for p in mt.paths {
                        push_path_if_new(&mut t.paths, &p);
                    }
                }
                None => result.push(mt),
            }
        }
    }
    result
}

/// v0.2 detect：返回「被禁用的注册表工具中仍存在的候选」，供设置页重新启用。
/// （v0.1 语义「检测未配置路径」已消亡——注册表工具永远在配置中。）
pub fn detect_unconfigured_paths(tools: &[ToolEntry]) -> Vec<ScanPathItem> {
    let mut out = Vec::new();
    for tool in tools.iter().filter(|t| t.builtin && !t.app_owned && !t.enabled) {
        for c in &tool.paths {
            if let Some(p) = expand_path(c) {
                if p.is_dir() {
                    out.push(ScanPathItem {
                        path: p.to_string_lossy().to_string(),
                        label: tool.name.clone(),
                        enabled: true,
                    });
                }
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

pub fn load_config() -> AppConfig {
    ensure_data_dir();
    let path = config_path();
    let raw: Option<RawConfig> = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<RawConfig>(&text).ok())
    } else {
        None
    };

    // tools 已存在 → 直接用（幂等）；否则按 v0.1 scan_paths 迁移；都没有 → 新鲜默认。
    // 注意区分「scan_paths 字段缺失」（旧式全新安装 → 默认）与「显式空数组」
    // （用户清空过 → 仍走迁移，随后 ensure_app_owned_entries 补回应用自有源）。
    let has_tools = raw
        .as_ref()
        .and_then(|r| r.tools.as_ref())
        .map(|t| !t.is_empty())
        .unwrap_or(false);
    let (mut tools, migrated) = if has_tools {
        (raw.as_ref().and_then(|r| r.tools.clone()).unwrap(), false)
    } else if let Some(sp) = raw.as_ref().and_then(|r| r.scan_paths.clone()) {
        let t = migrate_scan_paths_to_tools(&sp);
        debug_log(&format!(
            "config migrate: v0.1 scan_paths({}) -> v0.2 tools({})",
            sp.len(),
            t.len()
        ));
        (t, true)
    } else {
        (default_tools(), true)
    };

    ensure_app_owned_entries(&mut tools);
    let llm = raw
        .and_then(|r| r.llm)
        .unwrap_or_else(default_llm);
    let cfg = AppConfig { tools, llm };
    if migrated {
        let _ = save_config(&cfg); // 落盘固化迁移结果，下次启动走幂等路径
    }
    cfg
}

/// 确保「导入」源在 tools 中且启用（首次导入时调，PLAN-04 §3.1）
pub fn ensure_imported_scan_path() {
    let mut cfg = load_config();
    match cfg.tools.iter_mut().find(|t| t.id == TOOL_ID_IMPORTED) {
        Some(t) if !t.enabled => {
            t.enabled = true;
            let _ = save_config(&cfg);
        }
        Some(_) => {}
        None => {
            cfg.tools.push(app_owned_tool(TOOL_ID_IMPORTED, "导入"));
            let _ = save_config(&cfg);
        }
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    ensure_data_dir();
    let path = config_path();
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// 返回脱敏后的配置（供前端展示）
#[derive(Debug, Clone, Serialize)]
pub struct MaskedConfig {
    pub scan_paths: Vec<ScanPathItem>,
    pub llm: MaskedLLM,
    pub _has_key: bool,
    /// 与 scan_paths 一一对应，标记目录是否存在
    pub path_exists: Vec<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MaskedLLM {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
}

pub fn load_masked_config() -> MaskedConfig {
    let cfg = load_config();
    let key = &cfg.llm.api_key;
    let masked_key = if key.len() > 8 {
        format!("{}****{}", &key[..4], &key[key.len() - 4..])
    } else if !key.is_empty() {
        "****".to_string()
    } else {
        String::new()
    };
    // 过渡期前端视图：由 tools 派生（B5 前端改造后此桥接移除）
    let scan_paths = config_view_from_tools(&cfg.tools);
    let path_exists = scan_paths
        .iter()
        .map(|sp| std::path::Path::new(&sp.path).is_dir())
        .collect();
    MaskedConfig {
        scan_paths,
        llm: MaskedLLM {
            api_key: masked_key,
            base_url: cfg.llm.base_url,
            model: cfg.llm.model,
        },
        _has_key: !cfg.llm.api_key.is_empty(),
        path_exists,
    }
}

// ---------------------------------------------------------------------------
// 测试（B1 验收：迁移不丢自定义路径 / $VAR~ 展开 / 注册表全量识别 / 幂等）
// 仅测纯函数；load_config/save_config 触碰真实数据目录，不在单测覆盖内。
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn sp(path: &str, label: &str, enabled: bool) -> ScanPathItem {
        ScanPathItem { path: path.into(), label: label.into(), enabled }
    }

    // ---- expand_path ----

    #[test]
    fn expand_absolute_passthrough() {
        let p = expand_path(r"C:\Users\x\.claude\skills").unwrap();
        assert_eq!(p, PathBuf::from(r"C:\Users\x\.claude\skills"));
    }

    #[test]
    fn expand_home_tilde() {
        let home = dirs::home_dir().expect("home");
        assert_eq!(expand_path("~/.claude/skills").unwrap(), home.join(".claude/skills"));
        assert_eq!(expand_path("~").unwrap(), home);
    }

    #[test]
    fn expand_env_var() {
        std::env::set_var("SK_TEST_HOME", r"C:\fake-codex");
        assert_eq!(
            expand_path("$SK_TEST_HOME/skills").unwrap(),
            PathBuf::from(r"C:\fake-codex\skills")
        );
        assert_eq!(expand_path("$SK_TEST_HOME").unwrap(), PathBuf::from(r"C:\fake-codex"));
        std::env::remove_var("SK_TEST_HOME");
        assert!(expand_path("$SK_TEST_HOME/skills").is_none()); // 未设置 → 候选失效
    }

    #[test]
    fn expand_empty_or_bare_dollar() {
        assert!(expand_path("").is_none());
        assert!(expand_path("  ").is_none());
        assert!(expand_path("$/skills").is_none());
    }

    // ---- migrate_scan_paths_to_tools ----

    #[test]
    fn migrate_preserves_order_labels_and_custom_paths() {
        let items = vec![
            sp(r"C:\proj\skills", "builtin", true),
            sp(r"C:\Users\x\.claude\skills", "Claude", true),
            sp(r"D:\my\tools", "MyTools", true),
            sp(r"D:\my\tools2", "MyTools", false), // 同 label 合并
            sp(r"C:\data\imported", "导入", true),
        ];
        let tools = migrate_scan_paths_to_tools(&items);
        let ids: Vec<&str> = tools.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["builtin", "claude-code", "custom-mytools", "imported"]);

        let my = &tools[2];
        assert_eq!(my.paths.len(), 2, "同 label 两行合并为一个 tool 两条候选");
        assert!(my.enabled, "候选级开关坍缩为工具级 OR 语义");
        assert!(!my.builtin && my.linkable && !my.app_owned);

        let builtin = &tools[0];
        assert!(builtin.app_owned && !builtin.linkable && builtin.paths.is_empty());
    }

    #[test]
    fn migrate_known_label_custom_location_becomes_candidate() {
        // label 是已知工具但路径非标准（用户自定义 Codex 落点）→ 吸收为附加候选，不丢
        let items = vec![sp(r"D:\custom\codex-skills", "Codex", true)];
        let tools = migrate_scan_paths_to_tools(&items);
        assert_eq!(tools.len(), 1);
        let codex = &tools[0];
        assert_eq!(codex.id, "codex");
        assert!(codex.paths.iter().any(|p| p.contains("custom\\codex-skills") || p.contains("custom/codex-skills")));
        assert!(codex.paths.len() >= 4, "注册表模板 3 条 + 自定义 1 条");
    }

    #[test]
    fn migrate_empty_respects_user_intent() {
        assert!(migrate_scan_paths_to_tools(&[]).is_empty());
    }

    #[test]
    fn migrate_unlabeled_custom_uses_hash_id() {
        let items = vec![sp(r"D:\x\skills", "", true)];
        let tools = migrate_scan_paths_to_tools(&items);
        assert_eq!(tools.len(), 1);
        assert!(tools[0].id.starts_with("custom-"));
        assert_eq!(tools[0].name, r"D:\x\skills", "无 label 时以路径为名");
    }

    // ---- default_tools / ensure ----

    #[test]
    fn default_tools_full_registry_recognized() {
        let tools = default_tools();
        // builtin + 10 注册表 + 导入
        assert_eq!(tools.len(), 12);
        assert_eq!(tools[0].id, "builtin");
        assert!(tools.iter().all(|t| t.enabled));
        let codex = tools.iter().find(|t| t.id == "codex").unwrap();
        assert_eq!(codex.paths.len(), 3);
        assert!(codex.paths[0].starts_with("$CODEX_HOME"));
        // 注册表工具全部 linkable，app_owned 全部不 linkable
        assert!(tools.iter().filter(|t| !t.app_owned).all(|t| t.linkable));
        assert!(tools.iter().filter(|t| t.app_owned).all(|t| !t.linkable));
    }

    #[test]
    fn ensure_app_owned_idempotent() {
        let mut tools = vec![];
        ensure_app_owned_entries(&mut tools);
        assert_eq!(tools.len(), 2);
        ensure_app_owned_entries(&mut tools);
        assert_eq!(tools.len(), 2, "重复调用不重复插入");
        assert_eq!(tools[0].id, "builtin", "builtin 恒在首位（扫描顺序锚点，B4 代表选取依赖）");
    }

    // ---- apply_scan_paths_edit（前端保存反向合并）----

    #[test]
    fn apply_edit_toggle_and_delete_semantics() {
        let current = default_tools();
        // 前端视图（模拟 config_view_from_tools 的输出 + 用户操作）：
        let claude_dir = dirs::home_dir().unwrap().join(".claude/skills");
        std::fs::create_dir_all(&claude_dir).ok(); // 测试机可能没有，创建临时目录兜底
        let view = config_view_from_tools(&current);
        assert!(view.iter().any(|sp| sp.label == "builtin"));

        // 用户禁用 builtin 行、删除 Claude 行（若存在）
        let edited: Vec<ScanPathItem> = view
            .iter()
            .filter(|sp| sp.label != "Claude Code")
            .map(|sp| ScanPathItem {
                enabled: if sp.label == "builtin" { false } else { sp.enabled },
                ..sp.clone()
            })
            .collect();
        let result = apply_scan_paths_edit(&current, &edited);
        let builtin = result.iter().find(|t| t.id == "builtin").unwrap();
        assert!(!builtin.enabled, "禁用行 → tool.enabled=false");
        let claude = result.iter().find(|t| t.id == "claude-code").unwrap();
        if claude_dir.is_dir() {
            assert!(!claude.enabled, "删除存在的行 → 禁用");
        }
        assert!(result.iter().any(|t| t.id == "imported"), "应用自有源条目永不丢失");
    }

    #[test]
    fn apply_edit_new_custom_row_creates_tool() {
        let current = default_tools();
        let items = vec![sp(r"E:\new\skills", "新工具", true)];
        let result = apply_scan_paths_edit(&current, &items);
        let custom = result.iter().find(|t| t.name == "新工具");
        assert!(custom.is_some(), "未匹配行 → 新自定义工具");
        let c = custom.unwrap();
        assert!(!c.builtin && c.linkable);
        assert_eq!(c.paths, vec![r"E:\new\skills".to_string()]);
    }

    #[test]
    fn migrate_mixed_separator_duplicates_deduped() {
        // 真实配置实测边界：同目录以反斜杠与混合分隔符两种形态出现（Claude/OpenCode
        // 各有两行）→ 必须坍缩为单一候选，否则重复扫描产生重复卡片
        let home = dirs::home_dir().unwrap();
        let bs = home.join(".claude\\skills").to_string_lossy().to_string();
        let mixed = home.join(".claude/skills").to_string_lossy().to_string();
        let items = vec![sp(&bs, "Claude", true), sp(&mixed, "Claude", true)];
        let tools = migrate_scan_paths_to_tools(&items);
        assert_eq!(tools.len(), 1);
        let claude = &tools[0];
        let home_variants = claude
            .paths
            .iter()
            .filter(|p| p.contains(".claude"))
            .count();
        assert_eq!(home_variants, 1, "分隔符变体必须去重: {:?}", claude.paths);
    }

    #[test]
    fn scan_items_dedup_separator_variants() {
        let tmp = std::env::temp_dir().join(format!("sk-b1-dedup-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let bs = tmp.to_string_lossy().to_string();
        let mixed = bs.replace('\\', "/");
        let tool = ToolEntry {
            id: "t".into(),
            name: "T".into(),
            paths: vec![bs.clone(), mixed],
            builtin: false,
            enabled: true,
            linkable: true,
            app_owned: false,
        };
        let items = scan_items_from_tools(&[tool]);
        assert_eq!(items.len(), 1, "同目录两种分隔符形态只扫一次");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ---- serde round-trip（tools 字段缺失/存在的读兼容）----

    #[test]
    fn raw_config_distinguishes_absent_vs_empty_scan_paths() {
        // 旧格式（有 scan_paths 键）
        let old = r#"{"scan_paths":[{"path":"D:\\a","label":"MyTools","enabled":true}]}"#;
        let raw: RawConfig = serde_json::from_str(old).unwrap();
        assert!(raw.tools.is_none());
        assert_eq!(raw.scan_paths.as_ref().unwrap().len(), 1);

        // 显式空数组 ≠ 缺失
        let empty = r#"{"scan_paths":[]}"#;
        let raw: RawConfig = serde_json::from_str(empty).unwrap();
        assert_eq!(raw.scan_paths.as_ref().unwrap().len(), 0);

        // 新格式
        let new = r#"{"tools":[{"id":"builtin","name":"builtin","builtin":true,"enabled":true,"linkable":false,"app_owned":true}]}"#;
        let raw: RawConfig = serde_json::from_str(new).unwrap();
        assert!(raw.tools.is_some());
        assert!(raw.scan_paths.is_none());
    }

    #[test]
    fn tool_entry_serde_defaults() {
        // 手写最小 JSON：缺省字段取默认值（enabled/linkable 默认 true）
        let minimal = r#"{"id":"x","name":"X"}"#;
        let t: ToolEntry = serde_json::from_str(minimal).unwrap();
        assert!(t.enabled && t.linkable && !t.builtin && !t.app_owned && t.paths.is_empty());
    }
}
