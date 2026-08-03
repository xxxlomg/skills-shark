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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_scan_paths")]
    pub scan_paths: Vec<ScanPathItem>,
    #[serde(default = "default_llm")]
    pub llm: LLMConfig,
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

/// 12 条主流 AI 编码工具的 skills 路径模板 (相对 home 的子路径, label)
const DEFAULT_PATH_TEMPLATES: &[(&str, &str)] = &[
    (".claude/skills", "Claude"),
    (".cursor/skills", "Cursor"),
    (".codex/skills", "Codex"),
    (".agents/skills", "Codex"),
    (".opencode/skills", "OpenCode"),
    (".config/opencode/skills", "OpenCode"),
    (".openclaw/skills", "OpenClaw"),
    (".codeium/windsurf/skills", "Windsurf"),
    (".copilot/skills", "Copilot"),
    (".cline/skills", "Cline"),
    (".continue/skills", "Continue"),
    (".aider/skills", "Aider"),
];

/// 检测磁盘上实际存在的默认路径，返回 ScanPathItem 列表
pub fn detect_default_paths() -> Vec<ScanPathItem> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };

    DEFAULT_PATH_TEMPLATES
        .iter()
        .filter_map(|(sub, label)| {
            let full = home.join(sub);
            if full.is_dir() {
                Some(ScanPathItem {
                    path: full.to_string_lossy().to_string(),
                    label: label.to_string(),
                    enabled: true,
                })
            } else {
                None
            }
        })
        .collect()
}

fn default_scan_paths() -> Vec<ScanPathItem> {
    let mut paths = vec![ScanPathItem {
        path: builtin_skills_dir().to_string_lossy().to_string(),
        label: "builtin".to_string(),
        enabled: true,
    }];
    paths.extend(detect_default_paths());
    paths
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

pub fn load_config() -> AppConfig {
    ensure_data_dir();
    let path = config_path();
    let mut cfg = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<AppConfig>(&text).ok())
            .unwrap_or_else(|| AppConfig {
                scan_paths: default_scan_paths(),
                llm: default_llm(),
            })
    } else {
        AppConfig {
            scan_paths: default_scan_paths(),
            llm: default_llm(),
        }
    };

    // app 自有源自愈：builtin 路径失效（典型：从 dev 迁移来的 config
    // 在 prod 指向项目目录）→ 替换为当前解析值。用户自定义路径永不自动改。
    // 「导入」是 app 自有产物，恒等于当前 imported_dir()——数据目录迁移
    // （identifier 变更/手工拷贝）后旧路径即使仍存在也必须归一，否则会扫旧库。
    let imported = imported_dir();
    let mut changed = false;
    for sp in cfg.scan_paths.iter_mut() {
        let healed = if sp.label == "builtin" && !std::path::Path::new(&sp.path).is_dir() {
            Some(builtin_skills_dir())
        } else if sp.label == "导入"
            && std::path::Path::new(&sp.path) != imported.as_path()
        {
            Some(imported.clone())
        } else {
            None
        };
        if let Some(dir) = healed {
            debug_log(&format!(
                "scan_path self-heal: {} -> {}",
                sp.path,
                dir.display()
            ));
            sp.path = dir.to_string_lossy().to_string();
            changed = true;
        }
    }
    if changed {
        let _ = save_config(&cfg);
    }
    cfg
}

/// 确保「导入」源在 scan_paths 中（首次导入时调，PLAN-04 §3.1）
pub fn ensure_imported_scan_path() {
    let mut cfg = load_config();
    if !cfg.scan_paths.iter().any(|sp| sp.label == "导入") {
        cfg.scan_paths.push(ScanPathItem {
            path: imported_dir().to_string_lossy().to_string(),
            label: "导入".to_string(),
            enabled: true,
        });
        let _ = save_config(&cfg);
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
    let path_exists = cfg
        .scan_paths
        .iter()
        .map(|sp| std::path::Path::new(&sp.path).is_dir())
        .collect();
    MaskedConfig {
        scan_paths: cfg.scan_paths,
        llm: MaskedLLM {
            api_key: masked_key,
            base_url: cfg.llm.base_url,
            model: cfg.llm.model,
        },
        _has_key: !cfg.llm.api_key.is_empty(),
        path_exists,
    }
}
