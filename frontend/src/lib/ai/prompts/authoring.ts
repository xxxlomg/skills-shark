/**
 * 创作模块 prompt（AI 生成 SKILL.md）。
 * 维护提示：改这里即可，无需动调用方。
 *
 * 输出契约：模型直出 SKILL.md 原文（frontmatter 仅 name/description），
 * 不生成 references 附件；用与主题一致的语言（中文技能 → description 中文）。
 */
import type { WbDraft } from "@/lib/wb-draft";

/**
 * W3 prompt 插槽。输出契约：直出 SKILL.md 原文（frontmatter 仅 name/description）。
 * 表单内容作为上下文喂入（AI 规划去模糊，§4.4）。
 * description 中文结构「做什么。当何时用时。」与创作台 buildDesc/reverseDesc 约定一致。
 */
export function buildAuthoringPrompt(topic: string, draft: WbDraft): string {
  const ctx: string[] = [];
  if (draft.purpose.trim()) ctx.push(`目的：${draft.purpose.trim()}`);
  if (draft.triggers.trim()) ctx.push(`触发场景：${draft.triggers.trim().split(/\n+/).join("；")}`);
  return [
    "你是一个技能创作助手。根据主题生成一份完整的 Agent Skill 文档。",
    "语言：正文与 description 一律用与主题一致的语言书写（主题是中文就用中文）。",
    "输出契约（硬规则）：",
    "1. 直接输出 SKILL.md 原文，以 --- 开头；",
    "2. frontmatter 只含 name（hyphen-case）与 description（中文一句话，结构「做什么。当何时用时。」，说清「做什么 + 何时用」）；",
    "3. 正文祈使句书写，不用第二人称；触发信息写进 description；",
    "4. 不输出 JSON 围栏，不输出文档之外的任何解释文字。",
    "",
    `主题：${topic}`,
    ...(ctx.length ? ["", "用户已提供的上下文：", ...ctx] : []),
  ].join("\n");
}