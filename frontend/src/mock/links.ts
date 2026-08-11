import type { LinkStatus } from "@/lib/api";

/**
 * mock 引用台账（Hub 页）。
 * 约定：外部工具不做 mock 演示后，引用台账默认为空，展示 Hub 空状态；
 * 真实引用由后端 ledger 提供。
 */
export const MOCK_LINKS: LinkStatus[] = [];
