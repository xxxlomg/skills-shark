/**
 * LLM 直调 + 磁盘持久化（Tauri invoke）
 * LLM 调用保留在前端（需要流式），翻译完成后通过 invoke 写入 _data/
 */

import { invoke } from "@tauri-apps/api/core";
import { getLLMConfig } from "./llm-config";
import { isMockMode, MOCK_SKILLS } from "@/hooks/mockSkills";

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// 翻译
// ---------------------------------------------------------------------------

// 分块阈值：10000 字符 ≈ 2500 input tokens，译文约 5000~7500 output tokens，
// 在 max_tokens=8192 内安全。常规 README（≤10000 字符）单次请求完成；
// 仅超长文档才分块。若单块仍被截断，finish_reason=length 会明确报错。
const CHUNK_SIZE = 10000;
// 流式空闲超时：只要持续有数据返回就不超时，仅在长时间无响应时 abort
const STREAM_IDLE_TIMEOUT = 30_000;

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";
  for (const line of lines) {
    if (current.length + line.length + 1 > CHUNK_SIZE && current.length > 0) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function buildPrompt(chunk: string): string {
  return [
    "你是一个技术文档翻译专家。请将以下英文内容翻译为中文。",
    "要求：",
    "1. 保留所有 Markdown 格式（标题、代码块、列表等）",
    "2. 代码块内的代码不翻译，但代码块前后的说明文字要翻译",
    "3. 专业术语保留英文，首次出现时用括号标注中文",
    "4. 翻译要通顺、专业、准确",
    "5. 直接输出翻译结果，不要加任何前缀说明",
    "",
    "---",
    chunk,
  ].join("\n");
}

interface StreamResult {
  text: string;
  finishReason: string;
  /** 收到的 reasoning_content 片段数（思考模式诊断用） */
  reasoningChunks: number;
}

/**
 * 流式调用 LLM（SSE）。每收到一段增量文本就回调 onDelta，返回完整文本。
 * 采用空闲超时：每次收到数据重置计时器，仅在长时间无响应时 abort，
 * 避免长文本块因固定总超时被误杀。
 *
 * DeepSeek 注意：v4 系列思考模式默认开启，推理内容走 reasoning_content 且
 * 计入 max_tokens 预算——会出现「HTTP 200 + [DONE] 但 content 为空」。
 * 翻译任务显式禁用思考模式。
 */
async function callLLMStream(
  prompt: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  onDelta: (delta: string) => void
): Promise<StreamResult> {
  const controller = new AbortController();
  let idleTimer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT);
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        // DeepSeek 输出上限 8192；与 CHUNK_SIZE=10000 匹配，防止译文被截断
        max_tokens: 8192,
        stream: true,
        // 翻译任务无需思考/推理。仅对 DeepSeek 端点发送（其他 OpenAI 兼容
        // 服务可能不识别该参数而报 400）。
        // 参数位置已对照官方文档（api-docs.deepseek.com/zh-cn/api/create-chat-completion）：
        // thinking、reasoning_effort 均为请求体顶层字段；thinking 默认 enabled、
        // effort 默认 high，故两者都显式声明。effort=low 是兜底：若端点忽略
        // thinking 参数，推理成本也降到最低档。
        ...(baseUrl.includes("deepseek")
          ? { thinking: { type: "disabled" }, reasoning_effort: "low" }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`LLM API 错误 ${response.status}: ${errText.slice(0, 200)}`);
    }
    if (!response.body) {
      throw new Error("LLM API 未返回流式响应体");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    let full = "";
    let finishReason = "";
    let reasoningChunks = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle();
      sseBuffer += decoder.decode(value, { stream: true });
      // SSE 以行分隔；保留最后一段可能不完整的行待下次拼接
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const choice = json.choices?.[0];
          if (choice?.finish_reason) finishReason = String(choice.finish_reason);
          // 思考模式的推理内容：不计入译文，仅计数用于诊断
          // （推理到达同样会重置空闲超时，data 持续即不 abort）
          if (choice?.delta?.reasoning_content) reasoningChunks++;
          const delta = choice?.delta?.content ?? "";
          if (delta) {
            full += delta;
            onDelta(delta);
          }
        } catch {
          // 忽略无法解析的行（心跳、注释等）
        }
      }
    }
    return { text: full, finishReason, reasoningChunks };
  } finally {
    clearTimeout(idleTimer);
  }
}

export interface TranslateResult {
  bilingualHtml: string;
  bilingualText: string;
  titleZh: string;
  model: string;
}

/**
 * 执行翻译：LLM 直调 + 分块 + 磁盘持久化
 */
export async function translateSkill(
  skillId: string,
  rawContent: string,
  sourcePath: string,
  scanLabel: string,
  onProgress?: (fullSoFar: string, chunkIndex: number, totalChunks: number) => void
): Promise<TranslateResult> {
  const config = getLLMConfig();
  if (!config.apiKey) {
    throw new Error("请先在设置中配置 API Key");
  }

  const chunks = splitIntoChunks(rawContent);
  const translatedChunks: string[] = [];
  // 已完成块的译文，用于流式回调时拼接「到目前为止的完整译文」
  let completed = "";

  for (let i = 0; i < chunks.length; i++) {
    const prompt = buildPrompt(chunks[i]);
    let buffer = "";
    const { text: translated, finishReason, reasoningChunks } =
      await callLLMStream(
        prompt,
        config.apiKey,
        config.baseUrl,
        config.model,
        (delta) => {
          buffer += delta;
          onProgress?.(completed + buffer, i, chunks.length);
        }
      );
    // 防御：拒绝「HTTP 200 但空译文」的假成功（此前会静默写入空翻译）
    if (!translated.trim()) {
      throw new Error(
        reasoningChunks > 0
          ? "模型只返回了推理内容、未返回译文——思考模式消耗了全部 max_tokens 预算。请确认模型支持关闭思考模式或改用非推理模型"
          : "模型返回内容为空，翻译失败"
      );
    }
    if (finishReason === "length") {
      throw new Error(
        "模型输出达到 max_tokens 上限被截断，译文不完整已中止。该文档过长，请拆分后重试"
      );
    }
    translatedChunks.push(translated);
    completed += translated + "\n\n";
  }

  const fullTranslation = translatedChunks.join("\n\n");

  // 提取中文标题
  const titleMatch = fullTranslation.match(/^#\s+(.+)$/m);
  const titleZh = titleMatch ? titleMatch[1].trim() : "";

  // 构建双语对照（anchor 格式，兼容 bilingual.ts 解析）
  const originalLines = rawContent.split("\n");
  const translatedLines = fullTranslation.split("\n");
  const bilingualHtmlParts: string[] = [];
  const maxLen = Math.max(originalLines.length, translatedLines.length);
  for (let i = 0; i < maxLen; i++) {
    const orig = originalLines[i] ?? "";
    const trans = translatedLines[i] ?? "";
    if (orig || trans) {
      bilingualHtmlParts.push(
        `<div class="bilingual-row"><span class="orig">${escapeHtml(orig)}</span><span class="trans">${escapeHtml(trans)}</span></div>`
      );
    }
  }
  const bilingualHtml = bilingualHtmlParts.join("\n");

  // 构建 anchor 格式文本（用于磁盘存储 + bilingual.ts 解析）
  const bilingualText =
    `<!-- anchor:original -->\n${rawContent}\n` +
    `<!-- anchor:translated -->\n${fullTranslation}\n`;

  // 持久化到磁盘（Tauri invoke）
  const sourceHash = await computeHash(rawContent);
  await invoke("write_translation", {
    skillId,
    bilingualText,
    sourcePath,
    scanLabel,
    sourceHash,
    model: config.model,
    titleZh,
  });

  return { bilingualHtml, bilingualText, titleZh, model: config.model };
}

/**
 * 读取已翻译内容（从磁盘）
 */
export async function loadTranslation(skillId: string): Promise<string | null> {
  if (isMockMode()) {
    const s = MOCK_SKILLS.find((m) => m.id === skillId);
    if (s?.has_translation) {
      return [
        "<!-- anchor:original -->",
        `# ${s.name}\n\n${s.description}`,
        "<!-- anchor:translated -->",
        `# ${s.title_zh || s.name}\n\n${s.description_zh || s.description}`,
      ].join("\n");
    }
    return null;
  }
  try {
    return await invoke<string>("read_translation", { skillId });
  } catch {
    return null;
  }
}

/**
 * 读取已翻译内容的双语 HTML
 */
export async function loadTranslationHtml(skillId: string): Promise<string | null> {
  const text = await loadTranslation(skillId);
  if (!text) return null;
  return textToBilingualHtml(text);
}

function textToBilingualHtml(text: string): string {
  const lines = text.split("\n");
  const rows: string[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const orig = lines[i] ?? "";
    const trans = lines[i + 1] ?? "";
    if (orig || trans) {
      rows.push(
        `<div class="bilingual-row"><span class="orig">${escapeHtml(orig)}</span><span class="trans">${escapeHtml(trans)}</span></div>`
      );
    }
  }
  return rows.join("\n");
}

async function computeHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 测试 LLM 连接
 */
export async function testLLMConnection(config: {
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
        // 测试连接无需思考，避免推理拖慢测试（同翻译请求，显式关闭 + low 兜底）
        ...(config.baseUrl.includes("deepseek")
          ? { thinking: { type: "disabled" }, reasoning_effort: "low" }
          : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`API 错误 ${response.status}: ${errText.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
