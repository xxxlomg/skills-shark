/**
 * PLAN-07 W1：工作台草稿 localStorage 兜底。
 * dirty 期间每次变更同步写入（KB 级，无 debounce 窗口），
 * 防崩溃 / 误关 / tab 切换丢失；保存成功后清除。
 */
export interface WbDraft {
  name: string;
  desc: string;
  purpose: string;
  triggers: string;
  emoji: string;
  body: string;
}

export interface StoredDraft {
  savedAt: number;
  draft: WbDraft;
}

export const EMPTY_DRAFT: WbDraft = {
  name: "",
  desc: "",
  purpose: "",
  triggers: "",
  emoji: "🧩",
  body: "",
};

const keyOf = (id: string) => `ss-wb-draft:${id}`;

export function loadDraft(id: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(keyOf(id));
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredDraft;
    if (!v || typeof v.savedAt !== "number" || !v.draft) return null;
    // 旧草稿字段漂移兼容：与 EMPTY_DRAFT 合并补默认（emoji 等），遗留 steps/resources 自然丢弃
    return { savedAt: v.savedAt, draft: { ...EMPTY_DRAFT, ...v.draft } };
  } catch {
    return null;
  }
}

export function storeDraft(id: string, draft: WbDraft): void {
  try {
    localStorage.setItem(keyOf(id), JSON.stringify({ savedAt: Date.now(), draft }));
  } catch {
    /* 配额满等异常静默——兜底机制本身不应炸 */
  }
}

export function clearDraft(id: string): void {
  try {
    localStorage.removeItem(keyOf(id));
  } catch {
    /* ignore */
  }
}

export function fmtSavedAt(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** hyphen-case 实时校验（顶栏 name 输入）。 */
export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
