/**
 * C7/PLAN-07 W3 创作 AI 链路（契约修订版）：
 * **模型直出 SKILL.md 原文**——废 JSON 围栏；AI 不再生成 references 附件。
 * 流式期间「应用到正文」禁用，流结束后才允许应用。
 * prompt 插槽：正文可换，输出契约锁死。
 */
import { callLLMStream } from "./translate-api";
import { getLLMConfig } from "./llm-config";
import { isMockMode } from "@/mock";
import type { WbDraft } from "./wb-draft";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * W3 prompt 插槽。输出契约：直出 SKILL.md 原文（frontmatter 仅 name/description）。
 * 表单内容作为上下文喂入（AI 规划去模糊，§4.4）。
 */
export function buildAuthoringPrompt(topic: string, draft: WbDraft): string {
  const ctx: string[] = [];
  if (draft.purpose.trim()) ctx.push(`目的：${draft.purpose.trim()}`);
  if (draft.triggers.trim()) ctx.push(`触发场景：${draft.triggers.trim().split(/\n+/).join("；")}`);
  if (draft.steps.trim()) ctx.push(`步骤概要：${draft.steps.trim().split(/\n+/).join("；")}`);
  return [
    "你是一个技能创作助手。根据主题生成一份完整的 Agent Skill 文档。",
    "输出契约（硬规则）：",
    "1. 直接输出 SKILL.md 原文，以 --- 开头；",
    "2. frontmatter 只含 name（hyphen-case）与 description（英文一句，说清「做什么 + 何时用」）；",
    "3. 正文祈使句书写，不用第二人称；触发信息写进 description；",
    "4. 不输出 JSON 围栏，不输出文档之外的任何解释文字。",
    "",
    `主题：${topic}`,
    ...(ctx.length ? ["", "用户已提供的上下文：", ...ctx] : []),
  ].join("\n");
}

const MOCK_SKILL_MD = `---
name: mock-ai-skill
description: Demonstrate the W3 AI planning stream. Use when verifying the authoring workbench AI chain.
---
# mock-ai-skill

Demonstrate the AI planning stream end to end.

## When to use

- When verifying the W3 AI chain in mock mode

## Instructions

- Stream this document chunk by chunk
- Apply it to the body editor after the stream ends
`;

/**
 * W3 流式生成：直出 SKILL.md 原文。mock 模拟流式。
 * 返回全文与 finishReason（length = 截断，UI 提示重试）。
 */
export async function generateSkillMdStream(
  topic: string,
  draft: WbDraft,
  onDelta: (t: string) => void
): Promise<{ text: string; finishReason: string | null }> {
  if (isMockMode()) {
    const chunks = MOCK_SKILL_MD.match(/.{1,10}/gs) ?? [MOCK_SKILL_MD];
    for (const ch of chunks) {
      onDelta(ch);
      await sleep(20);
    }
    return { text: MOCK_SKILL_MD, finishReason: "stop" };
  }
  const config = getLLMConfig();
  if (!config.apiKey) {
    throw new Error("请先在设置中配置 API Key");
  }
  return callLLMStream(
    buildAuthoringPrompt(topic, draft),
    config.apiKey,
    config.baseUrl,
    config.model,
    onDelta
  );
}
