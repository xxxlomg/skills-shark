use std::fs;
use std::path::Path;

use crate::config::{self, AppConfig, MaskedConfig, ScanPathItem};
use crate::import;
use crate::pack;
use crate::scanner::{self, Skill};
use crate::translations;

// ---------------------------------------------------------------------------
// scan_skills — 扫描所有 enabled 路径
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn scan_skills() -> Vec<Skill> {
    let start = std::time::Instant::now();
    let cfg = config::load_config();
    let scan_items = config::scan_items_from_tools(&cfg.tools);
    let paths: Vec<String> = scan_items
        .iter()
        .map(|p| format!("{} ({})", p.path, p.label))
        .collect();
    let result = scanner::scan_all_skills(&scan_items);
    config::debug_log(&format!(
        "scan_skills: paths=[{}] found={} elapsed={}ms",
        paths.join(" | "),
        result.len(),
        start.elapsed().as_millis()
    ));
    result
}

// ---------------------------------------------------------------------------
// read_translation — 读取译文内容
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_translation(skill_id: String) -> Result<String, String> {
    translations::read_translated_content(&skill_id)
        .ok_or_else(|| format!("译文不存在: {}", skill_id))
}

// ---------------------------------------------------------------------------
// read_skill_file — 读取指定路径的文件内容
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn read_skill_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err(format!("文件不存在: {}", path));
    }
    fs::read_to_string(p).map_err(|e| format!("读取失败: {}", e))
}

// ---------------------------------------------------------------------------
// write_translation — 写入译文 + 更新 index
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn write_translation(
    skill_id: String,
    bilingual_text: String,
    source_path: String,
    scan_label: String,
    source_hash: String,
    model: String,
    title_zh: String,
) -> Result<(), String> {
    translations::save_translation(
        &skill_id,
        &bilingual_text,
        &source_path,
        &scan_label,
        &source_hash,
        &model,
        &title_zh,
    )
}

// ---------------------------------------------------------------------------
// load_config — 返回脱敏配置
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_config() -> MaskedConfig {
    config::load_masked_config()
}

// ---------------------------------------------------------------------------
// get_llm_api_key — 返回明文 API Key（仅供前端发起 LLM 请求）
//
// load_config 返回的是脱敏 key，不能用于实际请求（否则 401）。
// Tauri 为本地同进程应用，明文 key 留在前端内存无安全风险，
// 设置页用 password 输入框遮罩显示即可。
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_llm_api_key() -> String {
    config::load_config().llm.api_key
}

// ---------------------------------------------------------------------------
// save_config — 保存配置（如果 api_key 含 **** 则保留原值）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_config(
    scan_paths: Vec<ScanPathItem>,
    llm_api_key: String,
    llm_base_url: String,
    llm_model: String,
) -> Result<(), String> {
    config::debug_log(&format!(
        "save_config CALLED: scan_paths={} api_key_len={} base_url={} model={}",
        scan_paths.len(),
        llm_api_key.len(),
        llm_base_url,
        llm_model
    ));
    for (i, sp) in scan_paths.iter().enumerate() {
        config::debug_log(&format!("  scan_path[{}] = {} ({}) enabled={}", i, sp.path, sp.label, sp.enabled));
    }
    let old = config::load_config();
    let final_key = if llm_api_key.contains("****") && !old.llm.api_key.is_empty() {
        old.llm.api_key.clone()
    } else {
        llm_api_key
    };

    // v0.2（B1）：前端仍以 scan_paths 行提交（过渡契约），反向合并回 tools。
    let tools = config::apply_scan_paths_edit(&old.tools, &scan_paths);
    let new_config = AppConfig {
        tools,
        llm: config::LLMConfig {
            api_key: final_key,
            base_url: llm_base_url,
            model: llm_model,
        },
    };
    match config::save_config(&new_config) {
        Ok(()) => {
            config::debug_log("save_config OK: tools merged & written");
            Ok(())
        }
        Err(e) => {
            config::debug_log(&format!("save_config ERROR: {}", e));
            Err(e)
        }
    }
}

// ---------------------------------------------------------------------------
// detect_paths — v0.2 语义：返回被禁用的注册表工具中仍存在的候选路径
// （注册表工具永远在配置中，「检测未配置路径」已消亡；B5 前端改造后此命令退役）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn detect_paths() -> Vec<ScanPathItem> {
    let cfg = config::load_config();
    config::detect_unconfigured_paths(&cfg.tools)
}

// ---------------------------------------------------------------------------
// 导入（PLAN-04 §3，Phase 1：zip）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn preview_zip_import(path: String) -> Result<import::ImportPreview, String> {
    import::preview_zip(Path::new(&path))
}

#[tauri::command]
pub fn commit_zip_import(
    path: String,
    stem: String,
    selected: Vec<String>,
    replace: bool,
) -> Result<usize, String> {
    let n = import::commit_zip_import(
        Path::new(&path),
        &stem,
        &selected,
        replace,
        &config::imported_dir(),
    )?;
    config::ensure_imported_scan_path();
    config::debug_log(&format!(
        "commit_zip_import: path={} stem={} selected={} replace={}",
        path,
        stem,
        n,
        replace
    ));
    Ok(n)
}

// ---------------------------------------------------------------------------
// 导入（PLAN-04 §3.4，Phase 2：URL）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn preview_url_import(url: String) -> Result<import::ImportPreview, String> {
    config::debug_log(&format!("preview_url_import: {}", url));
    import::preview_url(&url)
}

#[tauri::command]
pub fn commit_url_import(
    token: String,
    stem: String,
    selected: Vec<String>,
    replace: bool,
) -> Result<usize, String> {
    let n = import::commit_url_import(&token, &stem, &selected, replace, &config::imported_dir())?;
    config::ensure_imported_scan_path();
    config::debug_log(&format!(
        "commit_url_import: stem={} imported={} replace={}",
        stem, n, replace
    ));
    Ok(n)
}

// ---------------------------------------------------------------------------
// sync_deleted — 同步删除状态 + 返回完整列表
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn sync_deleted(current_ids: Vec<String>) -> Vec<Skill> {
    let _ = translations::sync_deleted_status(&current_ids);
    let cfg = config::load_config();
    let scan_items = config::scan_items_from_tools(&cfg.tools);
    scanner::scan_all_skills(&scan_items)
}

// ---------------------------------------------------------------------------
// Skill Packs（PLAN-05 P1）
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn packs_list() -> Vec<pack::PackInfo> {
    pack::list_packs(&config::packs_dir())
}

#[tauri::command]
pub fn pack_create(
    name: String,
    ver: String,
    author: String,
    skills: Vec<pack::PackSkillInput>,
) -> Result<pack::PackInfo, String> {
    pack::create_pack(&config::packs_dir(), &name, &ver, &author, &skills)
}

#[tauri::command]
pub fn pack_export(id: String, dest: String) -> Result<u64, String> {
    pack::export_pack(&config::packs_dir(), &id, Path::new(&dest))
}

#[tauri::command]
pub fn pack_import(path: String) -> Result<pack::PackInfo, String> {
    pack::import_pack(&config::packs_dir(), Path::new(&path))
}

#[tauri::command]
pub fn pack_install(id: String) -> Result<usize, String> {
    let n = pack::install_pack(&config::packs_dir(), &config::imported_dir(), &id)?;
    config::ensure_imported_scan_path();
    Ok(n)
}

#[tauri::command]
pub fn pack_delete(id: String) -> Result<(), String> {
    pack::delete_pack(&config::packs_dir(), &id)
}
