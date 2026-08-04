use std::fs;
use std::path::Path;

use crate::config::{self, AppConfig, MaskedConfig};
use crate::hub;
use crate::import;
use crate::pack;
use crate::scanner::{self, Skill};
use crate::shelf;
use crate::translations;

// ---------------------------------------------------------------------------
// scan_skills — 扫描所有 enabled 路径
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn scan_skills() -> Vec<Skill> {
    let start = std::time::Instant::now();
    let cfg = config::load_config();
    let targets = config::scan_targets_from_tools(&cfg.tools);
    let paths: Vec<String> = targets
        .iter()
        .map(|t| format!("{} ({})", t.path, t.label))
        .collect();
    let mut result = scanner::scan_all_skills(&targets);
    // hub 账本 join：junction 落点标记补充 link id（供 UI 解除引用/转副本）
    let ledger = hub::load_ledger(&config::get_data_dir());
    if !ledger.links.is_empty() {
        let by_target: std::collections::HashMap<String, String> = ledger
            .links
            .iter()
            .map(|l| {
                (
                    config::norm_for_compare(std::path::Path::new(&l.target)),
                    l.id.clone(),
                )
            })
            .collect();
        for skill in result.iter_mut() {
            if skill.hub_linked {
                let key = config::norm_for_compare(std::path::Path::new(&skill.skill_dir));
                if let Some(id) = by_target.get(&key) {
                    skill.hub_link_id = Some(id.clone());
                }
            }
        }
    }
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
// save_config — 仅保存 LLM 配置（如果 api_key 含 **** 则保留原值）。
// v0.2（B5 收尾）：tools 不再经此命令改动——工具增删改走 hub_*_tool 命令，
// 前端 scan_paths 桥接已拆除（PLAN-06 §2.6）。
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn save_config(
    llm_api_key: String,
    llm_base_url: String,
    llm_model: String,
) -> Result<(), String> {
    config::debug_log(&format!(
        "save_config CALLED: api_key_len={} base_url={} model={}",
        llm_api_key.len(),
        llm_base_url,
        llm_model
    ));
    let old = config::load_config();
    let final_key = if llm_api_key.contains("****") && !old.llm.api_key.is_empty() {
        old.llm.api_key.clone()
    } else {
        llm_api_key
    };

    let new_config = AppConfig {
        tools: old.tools,
        llm: config::LLMConfig {
            api_key: final_key,
            base_url: llm_base_url,
            model: llm_model,
        },
    };
    match config::save_config(&new_config) {
        Ok(()) => {
            config::debug_log("save_config OK: llm written, tools untouched");
            Ok(())
        }
        Err(e) => {
            config::debug_log(&format!("save_config ERROR: {}", e));
            Err(e)
        }
    }
}

// ---------------------------------------------------------------------------
// Hub 引用层（PLAN-06 §2.7，B5 接线）
// ---------------------------------------------------------------------------

/// linkable 目标工具清单（引用对话框的下拉源）：注册表外部工具，
/// 排除 app_owned（builtin/imported/authored 不可作落点）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct LinkableTool {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    /// 当前是否有候选目录已存在（供 UI 提示「将新建目录」）
    pub has_existing_dir: bool,
}

#[tauri::command]
pub fn hub_linkable_tools() -> Vec<LinkableTool> {
    let cfg = config::load_config();
    cfg.tools
        .iter()
        .filter(|t| !t.app_owned && t.linkable)
        .map(|t| LinkableTool {
            has_existing_dir: t.paths.iter().any(|c| {
                config::expand_path(c).map(|p| p.is_dir()).unwrap_or(false)
            }),
            id: t.id.clone(),
            name: t.name.clone(),
            enabled: t.enabled,
        })
        .collect()
}

#[tauri::command]
pub fn hub_link_skill(
    source_path: String,
    target_tool_id: String,
    mode: hub::LinkMode,
) -> Result<hub::HubLink, String> {
    hub::link_skill(
        &config::get_data_dir(),
        Path::new(&source_path),
        &target_tool_id,
        mode,
    )
}

#[tauri::command]
pub fn hub_unlink_skill(link_id: String) -> Result<hub::HubLink, String> {
    hub::unlink_skill(&config::get_data_dir(), &link_id)
}

#[tauri::command]
pub fn hub_convert_to_copy(link_id: String) -> Result<hub::HubLink, String> {
    hub::convert_to_copy(&config::get_data_dir(), &link_id)
}

#[tauri::command]
pub fn hub_links_status() -> Vec<hub::LinkStatus> {
    hub::links_status(&config::get_data_dir())
}

/// 触发一次扫描以刷新 junction 落点后的技能列表（前端 link/unlink 后调用）。
/// 复用 scan_skills 逻辑，含账本 join。
#[tauri::command]
pub fn hub_rescan() -> Vec<Skill> {
    scan_skills()
}

// ---------------------------------------------------------------------------
// 工具管理（PLAN-06 §2.6/§2.10，B5 收尾）：设置页「工具」面板数据源。
// 桥接命令 detect_paths 已退役：注册表工具恒在配置中，禁用/启用走 update。
// ---------------------------------------------------------------------------

/// 工具全量信息（设置页工具管理渲染用）
#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolInfo {
    pub id: String,
    pub name: String,
    /// 注册表/应用自有工具：名称路径不可改，只能禁用
    pub builtin: bool,
    /// 应用自有来源（builtin/imported/authored）：不可作引用落点
    pub app_owned: bool,
    pub enabled: bool,
    pub linkable: bool,
    /// 候选路径原样（含 `~` / `$VAR` 模板）
    pub paths: Vec<String>,
    /// 各候选展开后是否存在（与 paths 一一对应）
    pub path_exists: Vec<bool>,
    /// 名下引用记录数（links.json 台账）
    pub link_count: usize,
}

fn tool_info(t: &config::ToolEntry, link_count: usize) -> ToolInfo {
    ToolInfo {
        id: t.id.clone(),
        name: t.name.clone(),
        builtin: t.builtin,
        app_owned: t.app_owned,
        enabled: t.enabled,
        linkable: t.linkable,
        paths: t.paths.clone(),
        path_exists: t
            .paths
            .iter()
            .map(|c| config::expand_path(c).map(|p| p.is_dir()).unwrap_or(false))
            .collect(),
        link_count,
    }
}

fn link_counts_by_tool() -> std::collections::HashMap<String, usize> {
    let ledger = hub::load_ledger(&config::get_data_dir());
    let mut m: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for l in &ledger.links {
        *m.entry(l.target_tool.clone()).or_insert(0) += 1;
    }
    m
}

#[tauri::command]
pub fn hub_list_tools() -> Vec<ToolInfo> {
    let cfg = config::load_config();
    let counts = link_counts_by_tool();
    cfg.tools
        .iter()
        .map(|t| tool_info(t, counts.get(&t.id).copied().unwrap_or(0)))
        .collect()
}

#[tauri::command]
pub fn hub_add_tool(name: String, paths: Vec<String>) -> Result<ToolInfo, String> {
    let mut cfg = config::load_config();
    let entry = config::add_tool(&mut cfg.tools, &name, &paths)?;
    config::save_config(&cfg)?;
    config::debug_log(&format!("hub_add_tool: {} -> {}", entry.name, entry.id));
    Ok(tool_info(&entry, 0))
}

#[tauri::command]
pub fn hub_update_tool(
    id: String,
    name: Option<String>,
    paths: Option<Vec<String>>,
    enabled: Option<bool>,
) -> Result<ToolInfo, String> {
    let mut cfg = config::load_config();
    let entry = config::update_tool(
        &mut cfg.tools,
        &id,
        name.as_deref(),
        paths.as_deref(),
        enabled,
    )?;
    config::save_config(&cfg)?;
    let counts = link_counts_by_tool();
    Ok(tool_info(&entry, counts.get(&id).copied().unwrap_or(0)))
}

#[tauri::command]
pub fn hub_remove_tool(id: String, force: bool) -> Result<(), String> {
    let mut cfg = config::load_config();
    let counts = link_counts_by_tool();
    let n = counts.get(&id).copied().unwrap_or(0);
    if n > 0 && !force {
        return Err(format!(
            "该工具名下还有 {} 条引用记录，请先在 Hub 页解除引用，或确认「一并移除记录」后重试",
            n
        ));
    }
    config::remove_tool(&mut cfg.tools, &id)?;
    config::save_config(&cfg)?;
    if n > 0 {
        let dropped = hub::drop_links_for_tool(&config::get_data_dir(), &id)?;
        config::debug_log(&format!(
            "hub_remove_tool: {} 已删除，连带清理 {} 条账本记录",
            id, dropped
        ));
    }
    Ok(())
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
pub async fn preview_url_import(url: String) -> Result<import::ImportPreview, String> {
    config::debug_log(&format!("preview_url_import: {}", url));
    import::preview_url(&url).await
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
    let targets = config::scan_targets_from_tools(&cfg.tools);
    scanner::scan_all_skills(&targets)
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

// ---------------------------------------------------------------------------
// 模块 A：Git 仓库货架导入（PLAN-06 §1.8/§1.9/§1.11；MEMO-A）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
pub struct GitStatusInfo {
    pub installed: bool,
    pub version: String,
}

/// git 可用性探测（会话内缓存；设置页/导入入口的使能依据）
#[tauri::command]
pub fn git_status() -> GitStatusInfo {
    let info = crate::git::detect();
    GitStatusInfo {
        installed: info.installed,
        version: info.version,
    }
}

/// 浏览仓库货架：浅克隆（无 git 时降级 archive 通道）→ 500MB 闸
/// → index.json 或降级扫描 → pending token。async（clone 可能分钟级）。
#[tauri::command]
pub async fn repo_browse(url: String) -> Result<shelf::ShelfPreview, String> {
    config::debug_log(&format!("repo_browse: {}", url));
    shelf::repo_browse(&url).await
}

/// 勾选导入：逐包 pack::import_pack；部分失败不回滚；完成后清理 clone 目录。
#[tauri::command]
pub fn repo_import_commit(
    token: String,
    selected: Vec<String>,
) -> Result<shelf::RepoImportResult, String> {
    config::debug_log(&format!("repo_import_commit: {} 个包", selected.len()));
    shelf::repo_import_commit(&token, &selected)
}

// ---------------------------------------------------------------------------
// skill_validate — 模块 C 校验器（PLAN-06 §3.8）
// ---------------------------------------------------------------------------

/// 校验任意技能目录。mode: "strict"（发布前闸）| "diagnostic"（默认，永不阻断）。
#[tauri::command]
pub fn skill_validate(path: String, mode: Option<String>) -> Result<crate::validate::ValidationReport, String> {
    let mode = match mode.as_deref() {
        Some("strict") => crate::validate::Mode::Strict,
        _ => crate::validate::Mode::Diagnostic,
    };
    Ok(crate::validate::validate_dir(Path::new(&path), mode))
}
