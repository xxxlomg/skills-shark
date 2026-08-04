/**
 * 统一 API 封装 — 全部走 Tauri invoke
 * 不再使用 fetch / HTTP
 */

import { invoke } from "@tauri-apps/api/core";
import {
  isMockMode,
  MOCK_PACKS,
  MOCK_RAW,
  MOCK_TOOLS,
  MOCK_LINKS,
  MOCK_SHELF,
} from "@/hooks/mockSkills";

// ---------------------------------------------------------------------------
// 类型（与 Rust 端对齐）
// ---------------------------------------------------------------------------

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
  llm: MaskedLLM;
  _has_key: boolean;
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

/** 保存 LLM 配置（v0.2 B5 收尾：tools 走 hub_*_tool 命令，不再经此通道） */
export function saveConfig(params: {
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
}): Promise<void> {
  return invoke("save_config", {
    llmApiKey: params.llmApiKey,
    llmBaseUrl: params.llmBaseUrl,
    llmModel: params.llmModel,
  });
}

/** 同步删除状态 + 返回完整列表 */
export function syncDeleted(currentIds: string[]): Promise<Skill[]> {
  return invoke<Skill[]>("sync_deleted", { currentIds });
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
  if (isMockMode()) {
    return Promise.resolve(
      MOCK_TOOLS.filter((t) => !t.app_owned && t.linkable && t.enabled).map(
        (t) => ({
          id: t.id,
          name: t.name,
          enabled: t.enabled,
          has_existing_dir: t.path_exists.some(Boolean),
        }),
      ),
    );
  }
  return invoke<LinkableTool[]>("hub_linkable_tools");
}

/** 建链/建副本/移动：source 必须是含 SKILL.md 的技能目录 */
export function hubLinkSkill(params: {
  sourcePath: string;
  targetToolId: string;
  mode: LinkMode;
}): Promise<HubLink> {
  if (isMockMode()) {
    const tool = MOCK_TOOLS.find((t) => t.id === params.targetToolId);
    if (!tool) return Promise.reject(new Error("目标工具不存在"));
    const name = params.sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? "skill";
    const ledgerMode: LedgerMode = params.mode === "link" ? "link" : "copy";
    const link: LinkStatus = {
      id: `mock-link-${Date.now()}`,
      skill_name: name,
      source: params.sourcePath,
      target: `C:\\Users\\mock\\${tool.id}\\skills\\${name}`,
      target_tool: tool.id,
      mode: ledgerMode,
      created_at: new Date().toISOString(),
      health: "normal",
      detail: "",
    };
    MOCK_LINKS.push(link);
    tool.link_count += 1;
    return Promise.resolve(link);
  }
  return invoke<HubLink>("hub_link_skill", params);
}

/** 解除引用：link → 只移除 junction 本体；copy → 只清账本 */
export function hubUnlinkSkill(linkId: string): Promise<HubLink> {
  if (isMockMode()) {
    const i = MOCK_LINKS.findIndex((l) => l.id === linkId);
    if (i < 0) return Promise.reject(new Error("引用记录不存在"));
    const [link] = MOCK_LINKS.splice(i, 1);
    const tool = MOCK_TOOLS.find((t) => t.id === link.target_tool);
    if (tool && tool.link_count > 0) tool.link_count -= 1;
    return Promise.resolve(link);
  }
  return invoke<HubLink>("hub_unlink_skill", { linkId });
}

/** link → copy 转换：复制实体替换 junction（删原件前救命通道） */
export function hubConvertToCopy(linkId: string): Promise<HubLink> {
  if (isMockMode()) {
    const link = MOCK_LINKS.find((l) => l.id === linkId);
    if (!link) return Promise.reject(new Error("引用记录不存在"));
    link.mode = "copy";
    return Promise.resolve(link);
  }
  return invoke<HubLink>("hub_convert_to_copy", { linkId });
}

/** 全量诊断：账本逐条对账（normal/missing/orphaned） */
export function hubLinksStatus(): Promise<LinkStatus[]> {
  if (isMockMode()) return Promise.resolve([...MOCK_LINKS]);
  return invoke<LinkStatus[]>("hub_links_status");
}

/** link/unlink 后刷新技能列表（等价 scan_skills，含账本 join） */
export function hubRescan(): Promise<Skill[]> {
  return invoke<Skill[]>("hub_rescan");
}

// ---------------------------------------------------------------------------
// 工具管理（PLAN-06 §2.6/§2.10，B5 收尾）：设置页「工具」面板
// ---------------------------------------------------------------------------

/** 工具全量信息（与 Rust ToolInfo 对齐） */
export interface ToolInfo {
  id: string;
  name: string;
  /** 注册表/应用自有工具：名称路径不可改，只能禁用 */
  builtin: boolean;
  /** 应用自有来源（builtin/imported/authored）：不可作引用落点 */
  app_owned: boolean;
  enabled: boolean;
  linkable: boolean;
  /** 候选路径原样（含 ~ / $VAR 模板） */
  paths: string[];
  /** 各候选展开后是否存在（与 paths 一一对应） */
  path_exists: boolean[];
  /** 名下引用记录数（links.json 台账） */
  link_count: number;
}

/** 全量工具列表（含 app_owned / 禁用项，供设置页管理） */
export function hubListTools(): Promise<ToolInfo[]> {
  if (isMockMode()) return Promise.resolve([...MOCK_TOOLS]);
  return invoke<ToolInfo[]>("hub_list_tools");
}

/** 新增自定义工具（builtin=false / linkable=true） */
export function hubAddTool(params: {
  name: string;
  paths: string[];
}): Promise<ToolInfo> {
  if (isMockMode()) {
    const name = params.name.trim();
    if (!name) return Promise.reject(new Error("工具名称不能为空"));
    if (MOCK_TOOLS.some((t) => t.name === name)) {
      return Promise.reject(new Error(`已存在同名工具：${name}`));
    }
    const paths = params.paths.map((p) => p.trim()).filter(Boolean);
    if (paths.length === 0) {
      return Promise.reject(new Error("至少需要一个扫描路径"));
    }
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "tool";
    let id = `custom-${slug}`;
    let n = 2;
    while (MOCK_TOOLS.some((t) => t.id === id)) {
      id = `custom-${slug}-${n}`;
      n += 1;
    }
    const tool: ToolInfo = {
      id,
      name,
      builtin: false,
      app_owned: false,
      enabled: true,
      linkable: true,
      paths,
      path_exists: paths.map(() => true),
      link_count: 0,
    };
    MOCK_TOOLS.push(tool);
    return Promise.resolve(tool);
  }
  return invoke<ToolInfo>("hub_add_tool", params);
}

/** 更新工具：自定义可改 name/paths；任意可改 enabled（未传的字段不变） */
export function hubUpdateTool(params: {
  id: string;
  name?: string;
  paths?: string[];
  enabled?: boolean;
}): Promise<ToolInfo> {
  if (isMockMode()) {
    const tool = MOCK_TOOLS.find((t) => t.id === params.id);
    if (!tool) return Promise.reject(new Error(`工具不存在：${params.id}`));
    if (params.name !== undefined && !tool.builtin) {
      const n = params.name.trim();
      if (!n) return Promise.reject(new Error("工具名称不能为空"));
      tool.name = n;
    }
    if (params.paths !== undefined && !tool.app_owned) {
      tool.paths = params.paths;
      tool.path_exists = params.paths.map(() => true);
    }
    if (params.enabled !== undefined) tool.enabled = params.enabled;
    return Promise.resolve(tool);
  }
  const args: Record<string, unknown> = { id: params.id };
  if (params.name !== undefined) args.name = params.name;
  if (params.paths !== undefined) args.paths = params.paths;
  if (params.enabled !== undefined) args.enabled = params.enabled;
  return invoke<ToolInfo>("hub_update_tool", args);
}

/** 删除自定义工具；force=true 时连带移除名下账本记录 */
export function hubRemoveTool(params: {
  id: string;
  force: boolean;
}): Promise<void> {
  if (isMockMode()) {
    const i = MOCK_TOOLS.findIndex((t) => t.id === params.id);
    if (i < 0) return Promise.reject(new Error(`工具不存在：${params.id}`));
    const tool = MOCK_TOOLS[i];
    if (tool.builtin || tool.app_owned) {
      return Promise.reject(new Error("内置工具不能删除，只能禁用"));
    }
    if (tool.link_count > 0 && !params.force) {
      return Promise.reject(
        new Error(
          `该工具名下还有 ${tool.link_count} 条引用记录，请先在 Hub 页解除引用，或确认「一并移除记录」后重试`,
        ),
      );
    }
    if (tool.link_count > 0) {
      for (let j = MOCK_LINKS.length - 1; j >= 0; j--) {
        if (MOCK_LINKS[j].target_tool === params.id) MOCK_LINKS.splice(j, 1);
      }
    }
    MOCK_TOOLS.splice(i, 1);
    return Promise.resolve();
  }
  return invoke("hub_remove_tool", params);
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

// ---------------------------------------------------------------------------
// 模块 A：Git 仓库货架导入（PLAN-06 §1；MEMO-A）
// ---------------------------------------------------------------------------

export interface GitStatusInfo {
  installed: boolean;
  version: string;
}

/** 货架条目（index.json 或降级扫描产出） */
export interface ShelfPackEntry {
  id: string;
  name: string;
  ver: string;
  path: string;
  skill_count: number;
  summary_zh: string;
  updated_at: string;
  declared_sha256: string;
  actual_sha256: string;
  /** 清单声明与包内容不一致（可能清单过期；不阻断导入） */
  sha256_mismatch: boolean;
}

export interface ShelfPreview {
  repo_name: string;
  updated_at: string;
  /** git+index / git+scan / archive+index / archive+scan */
  source: string;
  packs: ShelfPackEntry[];
  token: string;
}

export interface ImportFailure {
  path: string;
  error: string;
}

export interface RepoImportResult {
  imported: PackInfo[];
  failed: ImportFailure[];
  warnings: string[];
}

export function gitStatus(): Promise<GitStatusInfo> {
  if (isMockMode()) {
    return Promise.resolve({
      installed: true,
      version: "git version 2.47.0.windows.1 (mock)",
    });
  }
  return invoke<GitStatusInfo>("git_status");
}

/** 浏览仓库货架：浅克隆 → 500MB 闸 → index.json/降级扫描。无 git 自动降级 archive 通道。 */
export function repoBrowse(url: string): Promise<ShelfPreview> {
  if (isMockMode()) {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (/fail/i.test(url)) {
          reject(new Error("未找到 .skillpack 货架包（已检查 index.json 并扫描目录 3 层），请确认仓库布局"));
          return;
        }
        resolve({
          ...MOCK_SHELF,
          packs: MOCK_SHELF.packs.map((p) => ({ ...p })),
          token: `shelf-mock-${Date.now().toString(16)}`,
        });
      }, 1200);
    });
  }
  return invoke<ShelfPreview>("repo_browse", { url });
}

/** 勾选导入：逐包 pack_import；部分失败不回滚；完成后清理临时目录。 */
export function repoImportCommit(params: {
  token: string;
  selected: string[];
}): Promise<RepoImportResult> {
  if (isMockMode()) {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        const selected = new Set(params.selected);
        const chosen = MOCK_SHELF.packs.filter((p) => selected.has(p.path));
        const imported: PackInfo[] = chosen.map((p) => {
          const info: PackInfo = {
            id: p.id,
            name: p.name,
            ver: p.ver,
            author: "mock-shelf",
            created_at: new Date().toISOString(),
            skill_count: p.skill_count,
            translated: 0,
            overview: p.summary_zh || "Mock 货架包",
            summary_source: "static",
            skill_names: Array.from(
              { length: Math.min(p.skill_count, 3) },
              (_, i) => `skill-${i + 1}`
            ),
          };
          MOCK_PACKS.push(info);
          return info;
        });
        const warnings = chosen
          .filter((p) => p.sha256_mismatch)
          .map((p) => `「${p.name}」货架清单声明的 sha256 与包内容不一致（清单可能过期），已按包内自验结果导入`);
        resolve({ imported, failed: [], warnings });
      }, 800);
    });
  }
  return invoke<RepoImportResult>("repo_import_commit", params);
}

// ---------------------------------------------------------------------------
// 模块 C：规范校验（PLAN-06 §3）
// ---------------------------------------------------------------------------

export type ValidateMode = "strict" | "diagnostic";
export type ValidateSeverity = "error" | "warn" | "info";
export type ValidateVerdict = "pass" | "warn" | "fail";

export interface ValidationIssue {
  rule_id: string;
  severity: ValidateSeverity;
  message: string;
  path: string;
  hint: string;
}

export interface ValidationReport {
  mode: ValidateMode;
  passed: boolean;
  issues: ValidationIssue[];
  matrix: {
    claude: { verdict: ValidateVerdict; notes: string[] };
    codex: { verdict: ValidateVerdict; notes: string[] };
  };
}

/** 校验任意技能目录；diagnostic 永不阻断，strict 为发布前闸 */
export function skillValidate(
  path: string,
  mode: ValidateMode = "diagnostic"
): Promise<ValidationReport> {
  return invoke<ValidationReport>("skill_validate", { path, mode });
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
