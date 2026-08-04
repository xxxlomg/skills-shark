/**
 * 统一 API 封装 — 全部走 Tauri invoke
 * 不再使用 fetch / HTTP
 */

import { invoke } from "@tauri-apps/api/core";
import { isMockMode, MOCK_PACKS, MOCK_RAW } from "@/hooks/mockSkills";

// ---------------------------------------------------------------------------
// 类型（与 Rust 端对齐）
// ---------------------------------------------------------------------------

export interface ScanPathItem {
  path: string;
  label: string;
  enabled: boolean;
}

export interface Skill {
  id: string;
  name: string;
  folder_name: string;
  description: string;
  emoji: string | null;
  scan_label: string;
  source_path: string;
  /** v0.2（B4）：实际扫描到的技能目录（junction 落点不穿透，hub 操作锚点） */
  skill_dir: string;
  /** 来源工具注册表 id（builtin / imported / custom-xxx / claude-code 等） */
  tool_id: string;
  /** 同名组代表卡片（B4 代表选取：tools 顺序即优先级） */
  is_representative: boolean;
  /** 其他持有同名技能的工具 id 列表（UI 徽标用） */
  other_sources: string[];
  /** 该目录是 junction（hub link 落点） */
  hub_linked: boolean;
  /** 账本中对应的 link id（供解除引用/转副本） */
  hub_link_id: string | null;
  has_translation: boolean;
  /** 元数据在但译文 .md 丢失/为空（状态已降级为待翻译，此标记驱动丢失提示） */
  translation_lost: boolean;
  title_zh: string;
  description_zh: string;
  source_deleted: boolean;
  parent_collection: string | null;
}

export interface MaskedLLM {
  api_key: string;
  base_url: string;
  model: string;
}

export interface MaskedConfig {
  scan_paths: ScanPathItem[];
  llm: MaskedLLM;
  _has_key: boolean;
  path_exists: boolean[];
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** 扫描所有 enabled 路径，返回 skill 列表 */
export function scanSkills(): Promise<Skill[]> {
  return invoke<Skill[]>("scan_skills");
}

/** 读取指定路径的文件内容 */
export function readSkillFile(path: string): Promise<string> {
  if (isMockMode()) return Promise.resolve(MOCK_RAW);
  return invoke<string>("read_skill_file", { path });
}

/** 写入译文 + 更新 translations.json */
export function writeTranslation(params: {
  skillId: string;
  bilingualText: string;
  sourcePath: string;
  scanLabel: string;
  sourceHash: string;
  model: string;
  titleZh: string;
}): Promise<void> {
  return invoke("write_translation", {
    skillId: params.skillId,
    bilingualText: params.bilingualText,
    sourcePath: params.sourcePath,
    scanLabel: params.scanLabel,
    sourceHash: params.sourceHash,
    model: params.model,
    titleZh: params.titleZh,
  });
}

/** 加载脱敏配置 */
export function loadConfig(): Promise<MaskedConfig> {
  return invoke<MaskedConfig>("load_config");
}

/** 保存配置 */
export function saveConfig(params: {
  scanPaths: ScanPathItem[];
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
}): Promise<void> {
  return invoke("save_config", {
    scanPaths: params.scanPaths,
    llmApiKey: params.llmApiKey,
    llmBaseUrl: params.llmBaseUrl,
    llmModel: params.llmModel,
  });
}

/** 同步删除状态 + 返回完整列表 */
export function syncDeleted(currentIds: string[]): Promise<Skill[]> {
  return invoke<Skill[]>("sync_deleted", { currentIds });
}

/** 检测磁盘上存在但尚未配置的默认路径 */
export function detectPaths(): Promise<ScanPathItem[]> {
  return invoke<ScanPathItem[]>("detect_paths");
}

// ---------------------------------------------------------------------------
// Hub 引用层（PLAN-06 §2.7，模块 B / B5 接线）
// ---------------------------------------------------------------------------

/** 用户操作语义（Rust serde lowercase） */
export type LinkMode = "link" | "copy" | "move";
/** 账本记录语义（Move 归一为 copy：原件已进回收站，无引用关系） */
export type LedgerMode = "link" | "copy";
/** 单条引用健康状态：正常 / 落点缺失 / 孤儿（悬空或被替换） */
export type LinkHealth = "normal" | "missing" | "orphaned";

/** linkable 目标工具（引用对话框下拉源；app_owned 已被后端排除） */
export interface LinkableTool {
  id: string;
  name: string;
  enabled: boolean;
  /** 候选目录是否已存在（false 时 UI 提示「将新建目录」） */
  has_existing_dir: boolean;
}

/** 账本条目（links.json） */
export interface HubLink {
  id: string;
  skill_name: string;
  /** 出处目录（Move 模式记录原件原路径，供溯源） */
  source: string;
  /** 磁盘上实际存在的技能目录（junction 或副本实体），绝对路径 */
  target: string;
  /** 引用目标工具 id */
  target_tool: string;
  mode: LedgerMode;
  created_at: string;
}

/** 账本条目 + 对账结果（Rust 端 #[serde(flatten)]，字段平铺） */
export interface LinkStatus extends HubLink {
  health: LinkHealth;
  /** 人类可读诊断（health != normal 时给出原因） */
  detail: string;
}

/** linkable 目标工具清单 */
export function hubLinkableTools(): Promise<LinkableTool[]> {
  if (isMockMode()) return Promise.resolve([]);
  return invoke<LinkableTool[]>("hub_linkable_tools");
}

/** 建链/建副本/移动：source 必须是含 SKILL.md 的技能目录 */
export function hubLinkSkill(params: {
  sourcePath: string;
  targetToolId: string;
  mode: LinkMode;
}): Promise<HubLink> {
  return invoke<HubLink>("hub_link_skill", params);
}

/** 解除引用：link → 只移除 junction 本体；copy → 只清账本 */
export function hubUnlinkSkill(linkId: string): Promise<HubLink> {
  return invoke<HubLink>("hub_unlink_skill", { linkId });
}

/** link → copy 转换：复制实体替换 junction（删原件前救命通道） */
export function hubConvertToCopy(linkId: string): Promise<HubLink> {
  return invoke<HubLink>("hub_convert_to_copy", { linkId });
}

/** 全量诊断：账本逐条对账（normal/missing/orphaned） */
export function hubLinksStatus(): Promise<LinkStatus[]> {
  if (isMockMode()) return Promise.resolve([]);
  return invoke<LinkStatus[]>("hub_links_status");
}

/** link/unlink 后刷新技能列表（等价 scan_skills，含账本 join） */
export function hubRescan(): Promise<Skill[]> {
  return invoke<Skill[]>("hub_rescan");
}

// ---------------------------------------------------------------------------
// 导入（PLAN-04 §3）
// ---------------------------------------------------------------------------

export interface ImportCandidate {
  /** 相对解压根的路径；"" 表示 zip 根目录本身是 skill */
  rel: string;
  name: string;
  description: string;
}

export interface ImportPreview {
  default_stem: string;
  candidates: ImportCandidate[];
  /** URL 导入的 pending 凭证（zip 本地导入为 null） */
  token: string | null;
  /** zip 内含 pack.json 时的探测结果（PLAN-05：分流到 Pack 导入） */
  pack: PackDetect | null;
}

// ---------------------------------------------------------------------------
// Skill Packs（PLAN-05 P1）
// ---------------------------------------------------------------------------

/** zip 内 pack.json 探测摘要 */
export interface PackDetect {
  name: string;
  ver: string;
  author: string;
  skill_count: number;
  format_version: number;
}

/** Pack 库条目（← packs/<id>/pack.json） */
export interface PackInfo {
  id: string;
  name: string;
  ver: string;
  author: string;
  created_at: string;
  skill_count: number;
  translated: number;
  overview: string;
  /** ai / static */
  summary_source: string;
  skill_names: string[];
}

/** 打包输入：source_path = SKILL.md 绝对路径 */
export interface PackSkillInput {
  source_path: string;
  name: string;
  description: string;
  description_zh: string;
  has_translation: boolean;
}

export function packsList(): Promise<PackInfo[]> {
  if (isMockMode()) return Promise.resolve(MOCK_PACKS);
  return invoke<PackInfo[]>("packs_list");
}

export function packCreate(params: {
  name: string;
  ver: string;
  author: string;
  skills: PackSkillInput[];
}): Promise<PackInfo> {
  return invoke<PackInfo>("pack_create", params);
}

/** 导出 .skillpack；返回文件字节数 */
export function packExport(id: string, dest: string): Promise<number> {
  return invoke<number>("pack_export", { id, dest });
}

export function packImport(path: string): Promise<PackInfo> {
  return invoke<PackInfo>("pack_import", { path });
}

/** 安装到 imported 库；返回安装的技能数 */
export function packInstall(id: string): Promise<number> {
  return invoke<number>("pack_install", { id });
}

export function packDelete(id: string): Promise<void> {
  return invoke("pack_delete", { id });
}

export type ImportSource =
  | { kind: "zip"; path: string }
  | { kind: "url"; url: string; token: string; preload: ImportPreview };

/** 预览 zip：安全解压 + 探测 SKILL.md */
export function previewZipImport(path: string): Promise<ImportPreview> {
  return invoke<ImportPreview>("preview_zip_import", { path });
}

/** 提交导入到 imported 库；同名已存在且 replace=false 时后端返回 Err("EXISTS") */
export function commitZipImport(params: {
  path: string;
  stem: string;
  selected: string[];
  replace: boolean;
}): Promise<number> {
  return invoke<number>("commit_zip_import", params);
}

/** 解析 URL：archive zip 优先，git clone 兜底（后端下载/clone） */
export function previewUrlImport(url: string): Promise<ImportPreview> {
  return invoke<ImportPreview>("preview_url_import", { url });
}

export function commitUrlImport(params: {
  token: string;
  stem: string;
  selected: string[];
  replace: boolean;
}): Promise<number> {
  return invoke<number>("commit_url_import", params);
}
