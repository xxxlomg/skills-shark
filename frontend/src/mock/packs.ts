import type { PackInfo } from "@/lib/api";

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
