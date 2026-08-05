import type { ToolInfo } from "@/lib/api";

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
