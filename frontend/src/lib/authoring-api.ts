/**
 * C7 创作 AI 链路（PLAN-06 §3.11）：
 * 主题 → 流式生成 → draft 解析 → skill_commit_draft 落盘 → 校验报告。
 *
 * prompt 插槽：Paw 出初稿后替换 buildAuthoringPrompt 正文；
 * **输出契约锁死**：```json fence + {name, description, body, references} 四字段，
 * 换 prompt 不改契约。
 */
import { invoke } from "@tauri-apps/api/core";
import { callLLMStream } from "./translate-api";
import { getLLMConfig } from "./llm-config";
import { isMockMode, mockValidationReport, MOCK_SKILLS } from "@/mock";
import type { ValidationReport } from "./api";

export interface DraftFile {
  rel_path: string;
  content: string;
}

export interface GeneratedDraft {
  name: string;
  description: string;
  body: string;
  references: DraftFile[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** §3.11 prompt 插槽（占位版）。输出契约见文件头。 */
export function buildAuthoringPrompt(topic: string): string {
  return [
    "你是一个技能创作助手。根据主题生成一个 Agent Skill 草稿。",
    "硬规则：",
    "1. name 必须 hyphen-case（小写字母数字 + 连字符）；",
    "2. description 一句话说清「做什么 + 何时用」——模型只凭它决定是否使用；",
    "3. 正文祈使句书写，不用第二人称；",
    "4. 只输出一个 ```json 围栏，结构 {name, description, body, references: [{rel_path, content}]}；references 可为空数组。",
    "",
    `主题：${topic}`,
  ].join("\n");
}

/** 解析模型输出的 JSON 围栏 → GeneratedDraft。契约违例即抛错（UI 提示重试）。 */
export function parseDraft(text: string): GeneratedDraft {
  const m = text.match(/```json\s*([\s\S]*?)```/);
  if (!m) {
    throw new Error("模型未输出 JSON 围栏——请重试，或改用模板模式");
  }
  let raw: Partial<GeneratedDraft>;
  try {
    raw = JSON.parse(m[1]) as Partial<GeneratedDraft>;
  } catch {
    throw new Error("模型输出的 JSON 无法解析——请重试");
  }
  if (!raw.name || !raw.description) {
    throw new Error("草稿缺 name/description 字段");
  }
  return {
    name: String(raw.name),
    description: String(raw.description),
    body: String(raw.body ?? ""),
    references: Array.isArray(raw.references)
      ? raw.references.map((r) => ({
          rel_path: String(r.rel_path),
          content: String(r.content),
        }))
      : [],
  };
}

/**
 * C7 全链路：流式生成（onDelta 逐段回调）→ 解析 → 落盘（C6 安全闸）→ 校验报告。
 * mock 模式模拟流式 + 假落盘，供 ?mock=1 走查。
 */
export async function generateAndCommit(
  topic: string,
  location: string,
  onDelta: (t: string) => void
): Promise<{ skill_dir: string; validation: ValidationReport }> {
  if (isMockMode()) {
    const fake = JSON.stringify({
      name: "mock-generated-skill",
      description: "Mock skill generated via C7 AI chain placeholder prompt",
      body: "# mock-generated-skill\n\nDo the mock thing.\n\n## When to use\n\n- When verifying the C7 chain.",
      references: [],
    });
    const wrapped = "```json\n" + fake + "\n```";
    const chunks = wrapped.match(/.{1,8}/gs) ?? [wrapped];
    for (const ch of chunks) {
      onDelta(ch);
      await sleep(15);
    }
    const draft = parseDraft(wrapped);
    // mock 落盘可见性：推入扫描列表（与 skillNew mock 同语义）
    if (!MOCK_SKILLS.some((s) => s.tool_id === "authored" && s.name === draft.name)) {
      MOCK_SKILLS.push({
        id: `authored|${draft.name}`,
        name: draft.name,
        folder_name: draft.name,
        description: draft.description,
        emoji: "✨",
        scan_label: "创作",
        source_path: `/mock/authored/${draft.name}/SKILL.md`,
        skill_dir: `/mock/authored/${draft.name}`,
        tool_id: "authored",
        is_representative: true,
        other_sources: [],
        hub_linked: false,
        hub_link_id: null,
        has_translation: false,
        translation_lost: false,
        title_zh: "",
        description_zh: "",
        source_deleted: false,
        parent_collection: null,
      });
    }
    return {
      skill_dir: `/mock/authored/${draft.name}`,
      validation: mockValidationReport("default", "diagnostic"),
    };
  }

  const config = getLLMConfig();
  if (!config.apiKey) {
    throw new Error("请先在设置中配置 API Key");
  }
  const { text, finishReason } = await callLLMStream(
    buildAuthoringPrompt(topic),
    config.apiKey,
    config.baseUrl,
    config.model,
    onDelta
  );
  if (finishReason === "length") {
    throw new Error("模型输出被截断（finish_reason=length）——换更短的主题重试");
  }
  const draft = parseDraft(text);
  return invoke("skill_commit_draft", { location, draft });
}
