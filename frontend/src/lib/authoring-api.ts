/**
 * C7/PLAN-07 W3 创作 AI 链路（契约修订版）：
 * **模型直出 SKILL.md 原文**——废 JSON 围栏；AI 不再生成 references 附件。
 * 流式期间「应用到正文」禁用，流结束后才允许应用。
 * prompt 已抽到 @/lib/ai/prompts/authoring（统一管理）；LLM 调用走 @/lib/ai。
 */
import { callLLMStream, requireLLMConfig } from "@/lib/ai";
import { prompts } from "@/lib/ai";
import { isMockMode } from "@/mock";
import type { WbDraft } from "./wb-draft";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MOCK_SKILL_MD = `---
name: mock-ai-skill
description: 演示创作工作台 AI 创作链路。当需要验证 AI 生成与回显时使用。
---
# mock-ai-skill

演示创作工作台 AI 创作链路端到端。

## 何时使用

- 在 mock 模式下验证 AI 生成与回显

## 指令

- 逐块流式输出本文档
- 流结束后应用到正文编辑区
`;

/**
 * W3 流式生成：直出 SKILL.md 原文。mock 模拟流式。
 * 返回全文与 finishReason（length = 截断，UI 提示重试）。
 */
export async function generateSkillMdStream(
  topic: string,
  draft: WbDraft,
  onDelta: (t: string) => void,
  /** 用户点「停止」时 abort（mock 与真实 LLM 路径都响应） */
  abortSignal?: AbortSignal
): Promise<{ text: string; finishReason: string | null }> {
  if (isMockMode()) {
    const chunks = MOCK_SKILL_MD.match(/.{1,10}/gs) ?? [MOCK_SKILL_MD];
    for (const ch of chunks) {
      if (abortSignal?.aborted) {
        const e = new DOMException("AI 生成已取消", "AbortError");
        throw e;
      }
      onDelta(ch);
      await sleep(20);
    }
    return { text: MOCK_SKILL_MD, finishReason: "stop" };
  }
  const config = requireLLMConfig();
  return callLLMStream(
    prompts.buildAuthoringPrompt(topic, draft),
    config.apiKey,
    config.baseUrl,
    config.model,
    onDelta,
    abortSignal
  );
}