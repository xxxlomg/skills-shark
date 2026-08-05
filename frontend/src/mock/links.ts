import type { LinkStatus } from "@/lib/api";

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
