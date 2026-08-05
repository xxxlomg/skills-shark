import type { Skill } from "@/hooks/useSkills";

/** mock 技能工厂：对齐 docs/demo-glass.html 的数据形态。 */
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
