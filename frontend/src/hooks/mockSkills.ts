import type { PackInfo, ToolInfo, LinkStatus } from "@/lib/api";
import type { Skill } from "./useSkills";

/**
 * Dev-only 假数据：用于在无 Tauri 后端时（纯 vite dev）预览 UI。
 * 通过 URL 加 `?mock=1` 启用。对齐 docs/demo-glass.html 的数据形态。
 */

const mk = (
  id: string,
  name: string,
  emoji: string,
  desc: string,
  scan: string,
  opts: {
    zh?: string;
    dz?: string;
    trans?: boolean;
    lost?: boolean;
    del?: boolean;
    coll?: string | null;
    /** 覆盖 tool_id（默认取 scan 小写；聚合样本需对齐 MOCK_TOOLS 真实 id） */
    tool?: string;
    /** 非代表卡（B4 折叠样本：UI 不显示，仅 sync_deleted 用） */
    reps?: boolean;
    /** 其他持有同名技能的工具 id（B4 徽标样本） */
    others?: string[];
  } = {}
): Skill => ({
  id,
  name,
  folder_name: name,
  description: desc,
  emoji,
  scan_label: scan,
  source_path: `/mock/${scan}/${name}/SKILL.md`,
  skill_dir: `/mock/${scan}/${name}`,
  tool_id: opts.tool ?? (scan === "builtin" ? "builtin" : scan.toLowerCase()),
  is_representative: opts.reps ?? true,
  other_sources: opts.others ?? [],
  hub_linked: false,
  hub_link_id: null,
  has_translation: (opts.trans ?? false) && !(opts.lost ?? false),
  translation_lost: opts.lost ?? false,
  title_zh: opts.zh ?? "",
  description_zh: opts.dz ?? "",
  source_deleted: opts.del ?? false,
  parent_collection: opts.coll ?? null,
});

export const MOCK_SKILLS: Skill[] = [
  // builtin（2，全已译）
  mk("b1", "file_reader", "📄", "Read & summarize text-based files; PDF/Office delegated to other skills", "builtin", { zh: "文件读取器", dz: "读取并总结文本类文件，PDF/Office 交给其他技能", trans: true }),
  mk("b2", "guidance", "🧭", "回答 QwenPaw 安装与配置问题，先查本地文档", "builtin", { zh: "安装配置指引", trans: true }),

  // Claude（5，含一个未译、一个含合集）
  mk("c1", "code-review", "🔍", "Deep code review focused on boundaries, concurrency and readability", "Claude", { zh: "代码审查", dz: "深度代码审查，关注边界、并发与可读性", trans: true }),
  mk("c2", "commit-msg", "✍️", "依据 diff 生成 Conventional Commits 信息", "Claude", { zh: "提交信息生成", trans: true, tool: "claude-code", others: ["codex"] }),
  mk("c3", "test-gen", "🧪", "为给定函数生成边界覆盖的单元测试", "Claude", { zh: "单测生成", trans: true, coll: "Claude/testing" }),
  mk("c4", "spring-helper", "🍃", "Spring Boot 配置与依赖排错助手", "Claude", { trans: false, coll: "Claude/testing" }),
  mk("c5", "refactor", "🔧", "在保证行为不变的前提下给出重构建议", "Claude", { zh: "重构助手", lost: true }),

  // OpenCode（8，技能最多 → 精选宽卡；含未译、删除态、合集）
  mk("o1", "browser-cdp", "🌐", "连接运行中的 Chrome，共享登录态", "OpenCode", { zh: "浏览器 CDP", trans: true }),
  mk("o2", "browser-visible", "👁️", "控制浏览器以可见窗口启动", "OpenCode", { zh: "可见浏览器", trans: true }),
  mk("o3", "docx", "📑", "创建、编辑 Word 文档与目录", "OpenCode", { trans: false }),
  mk("o4", "make-skill", "🛠️", "把当前会话沉淀为可复用技能", "OpenCode", { zh: "技能沉淀", trans: true, coll: "OpenCode/meta" }),
  mk("o5", "channel-msg", "📨", "向指定频道主动推送消息", "OpenCode", { trans: false, coll: "OpenCode/meta" }),
  mk("o6", "chat-agent", "🤖", "咨询另一个 Agent 并等待回复", "OpenCode", { zh: "跨 Agent 对话", trans: true }),
  mk("o7", "cron-job", "⏰", "用 cron 表达式管理定时任务", "OpenCode", { zh: "定时任务", trans: true }),
  mk("o8", "memory", "🧠", "读写长期记忆与每日笔记", "OpenCode", { zh: "记忆管理", trans: true, del: true }),

  // Codex（4）
  mk("x1", "shell-master", "🐚", "组合复杂 Shell 管道，安全执行", "Codex", { zh: "Shell 大师", trans: true }),
  mk("x2", "git-flow", "🔀", "编排 rebase / cherry-pick 工作流", "Codex", { trans: false }),
  mk("x3", "regex-doctor", "🩺", "诊断与解释复杂正则表达式", "Codex", { zh: "正则诊断", trans: true }),
  mk("x4", "perf-profiler", "⚡", "定位热点函数与内存泄漏", "Codex", { zh: "性能剖析", trans: true }),
  // B4 聚合样本：commit-msg 同名双装，此条为非代表副本（UI 折叠，仅 sync_deleted 保留）
  mk("x5", "commit-msg", "✍️", "依据 diff 生成 Conventional Commits 信息", "Codex", { zh: "提交信息生成", trans: true, tool: "codex", reps: false, others: ["claude-code"] }),
];

export const MOCK_PACKS: PackInfo[] = [
  {
    id: "mock-pack-1",
    name: "OpenCode Essentials",
    ver: "1.0.0",
    author: "ruanzh",
    created_at: "2026-08-03T00:00:00Z",
    skill_count: 3,
    translated: 2,
    overview: "浏览器连接、技能沉淀与定时任务三件套，开箱即用的 OpenCode 增强包。",
    summary_source: "static",
    skill_names: ["browser-cdp", "make-skill", "cron-job"],
  },
];

/** mock 工具注册表（可变数组：CRUD mock 直接增删改，浏览器里走完管理闭环） */
export const MOCK_TOOLS: ToolInfo[] = [
  { id: "builtin", name: "builtin", builtin: true, app_owned: true, enabled: true, linkable: false, paths: [], path_exists: [], link_count: 0 },
  { id: "claude-code", name: "Claude Code", builtin: true, app_owned: false, enabled: true, linkable: true, paths: ["~/.claude/skills"], path_exists: [true], link_count: 1 },
  { id: "codex", name: "Codex CLI", builtin: true, app_owned: false, enabled: true, linkable: true, paths: ["$CODEX_HOME/skills", "~/.codex/skills", "~/.agents/skills"], path_exists: [false, true, false], link_count: 1 },
  { id: "cursor", name: "Cursor", builtin: true, app_owned: false, enabled: false, linkable: true, paths: ["~/.cursor/skills"], path_exists: [false], link_count: 0 },
  { id: "opencode", name: "OpenCode", builtin: true, app_owned: false, enabled: true, linkable: true, paths: ["~/.opencode/skills", "~/.config/opencode/skills"], path_exists: [true, false], link_count: 0 },
  { id: "custom-my-lab", name: "My Lab", builtin: false, app_owned: false, enabled: true, linkable: true, paths: ["D:\\vault\\skills"], path_exists: [true], link_count: 0 },
  { id: "imported", name: "导入", builtin: true, app_owned: true, enabled: true, linkable: false, paths: [], path_exists: [], link_count: 0 },
];

/** mock 引用台账（Hub 页与 wizard 落链后的可见样本） */
export const MOCK_LINKS: LinkStatus[] = [
  {
    id: "mock-link-1",
    skill_name: "code-review",
    source: "D:\\vault\\skills\\code-review",
    target: "C:\\Users\\mock\\.claude\\skills\\code-review",
    target_tool: "claude-code",
    mode: "link",
    created_at: "2026-08-04T12:00:00Z",
    health: "normal",
    detail: "",
  },
  {
    id: "mock-link-2",
    skill_name: "shell-master",
    source: "D:\\vault\\skills\\shell-master",
    target: "C:\\Users\\mock\\.codex\\skills\\shell-master",
    target_tool: "codex",
    mode: "copy",
    created_at: "2026-08-04T13:00:00Z",
    health: "normal",
    detail: "",
  },
];

export function isMockMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("mock") === "1";
  } catch {
    return false;
  }
}

/** mock 原文：覆盖标题/列表/代码块/链接/加粗，用于预览 MarkdownRenderer */
export const MOCK_RAW = `# browser-cdp

Connect to a running Chrome instance via the Chrome DevTools Protocol and
share its login state across tools.

## When to use

- The target site requires an **authenticated** session you already have open.
- You need to inspect network requests or cookies from a live tab.

## Quick start

\`\`\`bash
chrome --remote-debugging-port=9222
\`\`\`

Then point the agent at \`http://localhost:9222\`. See the
[CDP spec](https://chromedevtools.github.io/devtools-protocol/) for details.

> Note: only one client should drive a tab at a time.
`;

/** mock 译文（与原文段落对齐） */
export const MOCK_TRANS = `# 浏览器 CDP

通过 Chrome DevTools Protocol 连接一个正在运行的 Chrome 实例，
并在多个工具之间共享它的登录态。

## 何时使用

- 目标站点需要你已经打开的**已认证**会话。
- 你需要检查某个活跃标签页的网络请求或 Cookie。

## 快速开始

\`\`\`bash
chrome --remote-debugging-port=9222
\`\`\`

然后让 agent 指向 \`http://localhost:9222\`。详见
[CDP 规范](https://chromedevtools.github.io/devtools-protocol/)。

> 注意：同一时刻只应有一个客户端驱动某个标签页。
`;

/** anchor 格式双语文本，供 parseBilingual 解析 */
export const MOCK_BILINGUAL =
  `<!-- anchor:original -->\n${MOCK_RAW}\n<!-- anchor:translated -->\n${MOCK_TRANS}\n`;
