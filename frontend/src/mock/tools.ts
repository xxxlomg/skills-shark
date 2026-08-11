import type { ToolInfo } from "@/lib/api";

/**
 * mock 工具注册表（?mock=1 预览用）。
 * 约定：只保留应用自有来源（builtin/导入/创作库）；外部工具的真实注册表
 * 由后端提供，不做 mock 演示，避免技能库出现空壳分类。
 */
export const MOCK_TOOLS: ToolInfo[] = [
  { id: "builtin", name: "builtin", builtin: true, app_owned: true, enabled: true, linkable: false, paths: [], path_exists: [], link_count: 0 },
  { id: "imported", name: "导入", builtin: true, app_owned: true, enabled: true, linkable: false, paths: [], path_exists: [], link_count: 0 },
  { id: "authored", name: "创作库", builtin: true, app_owned: true, enabled: true, linkable: false, paths: [], path_exists: [], link_count: 0 },
];
