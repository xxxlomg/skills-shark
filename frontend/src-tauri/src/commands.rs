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
        publish_repo: old.publish_repo,
        download_dir: old.download_dir,
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
// P5 下载/导入目录（PLAN-09 P5）：URL 下载、Pack 安装、zip/目录导入统一归口
// config::imported_dir()，此处仅提供读取/保存命令。
// ---------------------------------------------------------------------------

/// 返回当前生效的下载/导入目录（含自定义配置展开后的实际路径）
#[tauri::command]
pub fn get_download_dir() -> String {
    config::imported_dir().to_string_lossy().to_string()
}

/// 保存自定义下载/导入目录（空串 = 恢复默认）
#[tauri::command]
pub fn set_download_dir(dir: String) -> Result<(), String> {
    config::set_download_dir(Some(dir))
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

/// 创建 Skill Pack（C4：打包前强制校验，PLAN-06 §3.7）。
/// force: 逃生门，缺省 false（旧前端调用不传即为 false，serde Option 缺参 → None）。
/// 校验失败返回 `pack::PackCreateError::ValidationFailed`（结构化清单），
/// 经 tauri `impl<T: Serialize> From<T> for InvokeError` 原样下发前端。
#[tauri::command]
pub fn pack_create(
    name: String,
    ver: String,
    author: String,
    skills: Vec<pack::PackSkillInput>,
    force: Option<bool>,
) -> Result<pack::PackInfo, pack::PackCreateError> {
    pack::create_pack(
        &config::packs_dir(),
        &name,
        &ver,
        &author,
        &skills,
        force.unwrap_or(false),
    )
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
    /// 是否已在设置中配置「我的技能仓库」
    pub repo_configured: bool,
    /// 配置的本地路径（未配置为空串）
    pub repo_path: String,
    /// 配置的路径是否存在且是 git 仓库
    pub repo_exists: bool,
    /// 当前分支（未知为空串）
    pub branch: String,
    /// 工作区是否干净（未配置/不存在时 false）
    pub clean: bool,
    pub ahead: u32,
    pub behind: u32,
}

/// git 可用性 + 发布仓库健康度（设置页与发布按钮的使能依据，§1.11）
#[tauri::command]
pub async fn git_status() -> GitStatusInfo {
    let info = crate::git::detect();
    let cfg = config::load_config();
    let (repo_configured, repo_path) = match cfg.publish_repo.as_ref() {
        Some(r) => (true, r.local_path.clone()),
        None => (false, String::new()),
    };
    let mut out = GitStatusInfo {
        installed: info.installed,
        version: info.version,
        repo_configured,
        repo_path: repo_path.clone(),
        repo_exists: false,
        branch: String::new(),
        clean: false,
        ahead: 0,
        behind: 0,
    };
    if info.installed && repo_configured {
        let repo = std::path::Path::new(&repo_path);
        if repo.exists() && crate::git::is_repo(repo).await {
            out.repo_exists = true;
            out.branch = crate::git::current_branch(repo).await.unwrap_or_default();
            out.clean = crate::git::status_clean(repo).await.unwrap_or(false);
            if let Ok((a, b)) = crate::git::ahead_behind(repo).await {
                out.ahead = a;
                out.behind = b;
            }
        }
    }
    out
}

/// repo_setup（§1.11）：空目录 git init + 设 remote + 初始 commit；已有仓库校验/补 remote。
#[tauri::command]
pub async fn repo_setup(
    local_path: String,
    remote_url: String,
    init_if_missing: bool,
) -> Result<crate::publish::RepoInfo, String> {
    config::debug_log(&format!(
        "repo_setup: {} -> {} (init={})",
        local_path, remote_url, init_if_missing
    ));
    crate::publish::repo_setup(&local_path, &remote_url, init_if_missing).await
}

/// publish_pack（§1.7 全流程）：校验闸 → 备份 → export → index 合并 → commit → push。
#[tauri::command]
pub async fn publish_pack(
    pack_id: String,
    message: Option<String>,
) -> Result<crate::publish::PublishResult, String> {
    config::debug_log(&format!("publish_pack: {}", pack_id));
    crate::publish::publish_pack(&pack_id, message).await
}

/// 保存/清除发布仓库配置（空串 = 清除）。不含 git 操作——初始化走 repo_setup。
#[tauri::command]
pub fn save_publish_repo(local_path: String, remote_url: String) -> Result<(), String> {
    let mut cfg = config::load_config();
    cfg.publish_repo = if local_path.trim().is_empty() && remote_url.trim().is_empty() {
        None
    } else {
        Some(config::PublishRepo {
            local_path: local_path.trim().to_string(),
            remote_url: remote_url.trim().to_string(),
        })
    };
    config::save_config(&cfg)
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

/// C5（PLAN-06 §3.13）：新建技能（模板模式）。落点固定 authored 自有源
/// （双落点选择 C9 接）。name 走 hyphen-case（FM-04 同语义）+ ≤64；
/// description 可空——空则补占位符（创作习惯：先命名后补描述，UI 反馈 2026-08-05）。
/// 同名目录已存在 → Err("EXISTS")。
#[tauri::command]
pub fn skill_new(name: String, description: String) -> Result<serde_json::Value, String> {
    let desc = if description.trim().is_empty() {
        crate::authoring::DESC_PLACEHOLDER.to_string()
    } else {
        description
    };
    let dir = create_skill_template(&crate::config::authored_dir(), &name, &desc)?;
    Ok(serde_json::json!({
        "skill_dir": dir.to_string_lossy(),
        "source_path": dir.join("SKILL.md").to_string_lossy(),
    }))
}

/// name 规则（FM-04 同语义）：hyphen-case + ≤64。skill_new / skill_rename 共用。
pub(crate) fn validate_skill_name(name: &str) -> Result<(), String> {
    if !crate::validate::is_hyphen_case(name) {
        return Err(
            "name 必须为 hyphen-case：小写字母数字 + 连字符，不首尾连字符、不双连字符"
                .to_string(),
        );
    }
    if name.len() > 64 {
        return Err("name 不得超过 64 字符".to_string());
    }
    Ok(())
}

/// C5 核心（纯函数，base_dir 参数化以便单测不碰全局 DATA_DIR）：
/// 在 base 下创建 `<name>/SKILL.md` 模板。校验 name/description；
/// 同名已存在 → Err("EXISTS")；写失败回滚半成品目录。
pub(crate) fn create_skill_template(
    base: &std::path::Path,
    name: &str,
    description: &str,
) -> Result<std::path::PathBuf, String> {
    let name = name.trim();
    validate_skill_name(name)?;
    let desc = description.trim();
    if desc.is_empty() {
        return Err("description 不能空——它是模型决定是否使用该技能的唯一依据".to_string());
    }
    let dir = base.join(name);
    if dir.exists() {
        return Err("EXISTS".to_string());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败：{e}"))?;
    let md = format!(
        "---\nname: {name}\ndescription: {desc}\n---\n\n# {name}\n\n{desc}\n\n## When to use\n\n- （补充触发场景；祈使句书写）\n\n## Instructions\n\n- （正文祈使句，不用第二人称）\n"
    );
    std::fs::write(dir.join("SKILL.md"), md).map_err(|e| {
        // 回滚：写失败清掉半成品目录，不留脏状态
        let _ = std::fs::remove_dir_all(&dir);
        format!("写入 SKILL.md 失败：{e}")
    })?;
    Ok(dir)
}

// ---------------------------------------------------------------------------
// C5 单测：skill_new 模板模式（不碰全局 DATA_DIR）
// ---------------------------------------------------------------------------
#[cfg(test)]
mod c5_tests {
    use super::create_skill_template;

    #[test]
    fn creates_template_skill_and_validates_clean() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = create_skill_template(tmp.path(), "my-new-skill", "Do X when Y happens").unwrap();
        let md = std::fs::read_to_string(dir.join("SKILL.md")).unwrap();
        assert!(md.starts_with("---\nname: my-new-skill\ndescription: Do X when Y happens\n---"));
        // 模板产物必须通过自家严格校验（不引入 FM 级 Error）
        let rep = crate::validate::validate_dir(&dir, crate::validate::Mode::Strict);
        assert!(
            rep.issues.iter().all(|i| i.severity != crate::validate::Severity::Error),
            "模板产物不应带 Error：{:?}",
            rep.issues
        );
    }

    #[test]
    fn rejects_bad_name_and_empty_desc() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(create_skill_template(tmp.path(), "Bad_Name", "d").is_err());
        assert!(create_skill_template(tmp.path(), "ok-name", "  ").is_err());
        assert!(
            create_skill_template(tmp.path(), &"a".repeat(65), "d").is_err(),
            "65 字符 name 应拒"
        );
    }

    #[test]
    fn rejects_duplicate_name() {
        let tmp = tempfile::tempdir().unwrap();
        create_skill_template(tmp.path(), "dup-skill", "d").unwrap();
        let err = create_skill_template(tmp.path(), "dup-skill", "d").unwrap_err();
        assert_eq!(err, "EXISTS");
    }
}
