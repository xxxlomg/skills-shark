import { useState, useEffect, useCallback, useRef } from "react";
import {
  Copy,
  Download,
  Columns2,
  X,
  Languages,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownRenderer } from "@/components/common/MarkdownRenderer";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { parseBilingual, type BilingualContent } from "@/lib/bilingual";
import {
  translateSkill,
  loadTranslation,
} from "@/lib/translate-api";
import { readSkillFile } from "@/lib/api";
import { loadLLMConfig } from "@/lib/llm-config";
import type { Skill } from "@/hooks/useSkills";

type ViewMode = "zh" | "en" | "both";

interface DetailSheetProps {
  skill: Skill | null;
  open: boolean;
  onClose: () => void;
  onSettingsOpen?: () => void;
  onTranslateDone?: () => void;
}

export function DetailSheet({
  skill,
  open,
  onClose,
  onSettingsOpen,
  onTranslateDone,
}: DetailSheetProps) {
  const [view, setView] = useState<ViewMode>("en");
  const [bilingual, setBilingual] = useState<BilingualContent | null>(null);
  const [rawOriginal, setRawOriginal] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fallback, setFallback] = useState(false);

  // 翻译相关
  const [translating, setTranslating] = useState(false);
  const [showReTranslateConfirm, setShowReTranslateConfirm] = useState(false);
  const [hasLLMKey, setHasLLMKey] = useState(false);

  // 流式翻译：当前累积译文 + 分块进度
  const [streaming, setStreaming] = useState<{
    text: string;
    chunkIndex: number;
    totalChunks: number;
  } | null>(null);
  // 防御锁：杜绝翻译重入（连点 / effect 误触发）
  const translatingRef = useRef(false);
  // 流式节流：delta 高频到达，限频 ~10fps（100ms）。
  // setTimeout 节流（首帧立即、尾帧必达）：旧 rAF 时间闸在被跳过时
  // 不补调度，导致突发到达/流末尾内容永远不落地（流式不渲染的根因）。
  const streamingRef = useRef({ text: "", chunkIndex: 0, totalChunks: 0 });
  const flushTimerRef = useRef<number | null>(null);
  const lastFlushRef = useRef(0);
  // 内容区 ref：流式翻译时让滚动容器追随输出到底部
  const contentRef = useRef<HTMLDivElement>(null);

  // 流式跟随滚动：每次节流帧落地后，把 radix viewport 钉到底部。
  // 仅在 translating 且译文 tab 生效，结束后不再干预用户滚动。
  useEffect(() => {
    if (!translating || view !== "zh") return;
    const vp = contentRef.current?.closest(
      "[data-radix-scroll-area-viewport]"
    );
    if (vp) vp.scrollTop = vp.scrollHeight;
  }, [streaming, translating, view]);

  const flushStreaming = useCallback(() => {
    if (flushTimerRef.current != null) return;
    const wait = Math.max(0, 100 - (performance.now() - lastFlushRef.current));
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      // 翻译已收尾时丢弃尾帧，避免覆盖收尾时的 setStreaming(null)
      if (!translatingRef.current) return;
      lastFlushRef.current = performance.now();
      setStreaming(streamingRef.current);
    }, wait);
  }, []);

  useEffect(
    () => () => {
      if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
    },
    []
  );

  // 检查 LLM 配置
  useEffect(() => {
    if (!open) return;
    loadLLMConfig()
      .then((c) => setHasLLMKey(c.hasKey))
      .catch(() => setHasLLMKey(false));
  }, [open]);

  // 加载内容
  useEffect(() => {
    if (!skill || !open) return;

    let cancelled = false;
    setView("en");
    setBilingual(null);
    setRawOriginal(null);
    setFallback(false);
    setLoading(true);

    (async () => {
      // 1. 尝试加载译文
      if (skill.has_translation) {
        try {
          const text = await loadTranslation(skill.id);
          if (cancelled) return;
          if (text) {
            const parsed = parseBilingual(text);
            if (parsed.originals.length > 0) {
              setBilingual(parsed);
              setLoading(false);
              return;
            }
          }
        } catch {
          // 译文读取失败，降级
        }
      }

      // 2. 降级加载原文
      try {
        const text = await readSkillFile(skill.source_path);
        if (cancelled) return;
        setRawOriginal(text);
        setFallback(true);
      } catch {
        if (!cancelled) setFallback(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // 以 id 为键：sync 刷新带来的对象更新（同 id）不重跑加载、不重置 tab，
    // 仅打开/切换 skill 时重新加载。
  }, [skill?.id, open]);

  // 执行翻译（流式）
  const doTranslate = useCallback(async () => {
    if (!skill || translatingRef.current) return;
    translatingRef.current = true;
    setTranslating(true);
    // 立即切到译文 tab，准备流式渲染
    setView("zh");
    streamingRef.current = { text: "", chunkIndex: 0, totalChunks: 0 };
    setStreaming(streamingRef.current);
    try {
      // 先读原文
      const rawContent = await readSkillFile(skill.source_path);
      const result = await translateSkill(
        skill.id,
        rawContent,
        skill.source_path,
        skill.scan_label,
        (fullSoFar, chunkIndex, totalChunks) => {
          streamingRef.current = { text: fullSoFar, chunkIndex, totalChunks };
          flushStreaming();
        }
      );
      // 翻译完成，重新加载译文
      const text = await loadTranslation(skill.id);
      if (text) {
        const parsed = parseBilingual(text);
        setBilingual(parsed);
      }
      setFallback(false);
      setRawOriginal(null);
      setStreaming(null);
      toast.success(`翻译完成${result.titleZh ? `，标题：${result.titleZh}` : ""}`);
      onTranslateDone?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      toast.error(`翻译失败：${msg}`);
      setStreaming(null);
    } finally {
      setTranslating(false);
      translatingRef.current = false;
    }
  }, [skill, onTranslateDone, flushStreaming]);

  // 点击翻译按钮
  const handleTranslateClick = useCallback(() => {
    if (!hasLLMKey) {
      toast.error("请先在设置中配置 API Key");
      onSettingsOpen?.();
      return;
    }
    if (skill?.has_translation) {
      setShowReTranslateConfirm(true);
    } else {
      doTranslate();
    }
  }, [hasLLMKey, skill, doTranslate, onSettingsOpen]);

  const handleConfirmReTranslate = useCallback(() => {
    setShowReTranslateConfirm(false);
    doTranslate();
  }, [doTranslate]);

  // 描述随 tab 联动：原文 tab → 原文；译文/并排 → 译文（缺失时回退原文）
  const displayDesc =
    view === "en"
      ? skill?.description || ""
      : skill?.description_zh || skill?.description || "";

  const handleCopyUsage = useCallback(async () => {
    if (!displayDesc) {
      toast.error("该 skill 没有描述信息");
      return;
    }
    try {
      await navigator.clipboard.writeText(displayDesc);
      toast.success("已复制描述");
    } catch {
      toast.error("复制失败");
    }
  }, [displayDesc]);

  /** 下载译文 */
  const handleDownloadTranslated = useCallback(() => {
    if (!bilingual || !skill) return;
    let content = "";
    const filename = `${skill.folder_name || skill.id}-zh.md`;
    if (view === "zh") {
      content = bilingual.translated.join("\n\n---\n\n");
    } else if (view === "en") {
      content = bilingual.originals.join("\n\n---\n\n");
    } else {
      const sections = bilingual.originals.map((o, i) => {
        const t = bilingual.translated[i] || "";
        return `## 原文\n\n${o}\n\n## 译文\n\n${t}`;
      });
      content = sections.join("\n\n---\n\n");
    }
    try {
      const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`已下载 ${filename}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      toast.error(`下载失败：${msg}`);
    }
  }, [bilingual, skill, view]);

  if (!skill) return null;

  const displayName = skill.title_zh || skill.name;
  const isDeleted = skill.source_deleted;
  // 以实际译文内容为准（has_translation 为 true 但解析失败时同样无译文可看）
  const hasTrans = !!bilingual && bilingual.translated.length > 0;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="glass-sheet flex w-[min(90vw,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]"
      >
        {/* 顶部三色渐变条 */}
        <div className="h-[3px] shrink-0 bg-gradient-to-r from-brand via-cyan to-amber" />

        {/* 头部 */}
        <div className="flex shrink-0 items-start gap-[14px] border-b border-stroke px-6 pb-4 pt-5">
          <span className="text-[34px] leading-none">{skill.emoji || "🧩"}</span>
          <div className="min-w-0 flex-1">
            <SheetTitle className="font-display text-[21px] font-semibold text-text-primary">
              {view === "en" ? skill.name : displayName}
            </SheetTitle>
            <p className="mt-[2px] font-mono text-[11.5px] text-text-secondary">
              {skill.name} · {skill.scan_label}
            </p>
            {isDeleted && (
              <div className="mt-1.5">
                <Badge variant="destructive" className="text-[11px]">
                  源文件已删除
                </Badge>
              </div>
            )}
            <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
              {displayDesc || "无描述"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="ml-auto grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] border border-stroke bg-glass text-text-secondary transition-colors hover:border-stroke-hi hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 视图切换 + 操作 */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stroke px-6 py-3">
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <TabsList className="h-auto gap-[2px] rounded-[10px] border border-stroke bg-glass p-[3px]">
              <TabsTrigger
                value="en"
                className="rounded-lg px-[14px] py-[6px] text-[12.5px] text-text-tertiary data-[state=active]:border data-[state=active]:border-stroke-hi data-[state=active]:bg-glass-2 data-[state=active]:text-text-primary data-[state=active]:shadow-none"
              >
                原文
              </TabsTrigger>
              <TabsTrigger
                value="zh"
                disabled={!hasTrans && !translating}
                className="rounded-lg px-[14px] py-[6px] text-[12.5px] text-text-tertiary data-[state=active]:border data-[state=active]:border-stroke-hi data-[state=active]:bg-glass-2 data-[state=active]:text-text-primary data-[state=active]:shadow-none"
              >
                译文
                {translating && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
                )}
              </TabsTrigger>
              <TabsTrigger
                value="both"
                disabled={!hasTrans}
                className="rounded-lg px-[14px] py-[6px] text-[12.5px] text-text-tertiary data-[state=active]:border data-[state=active]:border-stroke-hi data-[state=active]:bg-glass-2 data-[state=active]:text-text-primary data-[state=active]:shadow-none"
              >
                <Columns2 className="mr-1 h-3.5 w-3.5" />
                并排对照
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="ml-auto flex flex-wrap gap-2">
            {/* 翻译按钮 — 已删除的 skill 不显示 */}
            {!isDeleted && (
              <button
                type="button"
                className={`mbtn ${skill.has_translation ? "" : "primary"}`}
                onClick={handleTranslateClick}
                disabled={translating}
              >
                {translating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Languages className="h-3.5 w-3.5" />
                )}
                {translating
                  ? "翻译中..."
                  : skill.has_translation
                    ? "重新翻译"
                    : "翻译"}
              </button>
            )}

            <button type="button" className="mbtn" onClick={handleCopyUsage}>
              <Copy className="h-3.5 w-3.5" />
              复制描述
            </button>

            {bilingual && (
              <button
                type="button"
                className="mbtn"
                onClick={handleDownloadTranslated}
              >
                <Download className="h-3.5 w-3.5" />
                下载译文
              </button>
            )}
          </div>
        </div>

        {/* 内容区 */}
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <div ref={contentRef} className="min-w-0 px-6 py-5">
            {loading && (
              <div className="space-y-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            )}

            {/* 流式翻译中：译文 tab 实时渲染 */}
            {!loading && translating && view === "zh" && streaming && (
              <div className="min-w-0 space-y-4 overflow-x-auto">
                <div className="fallback-notice">
                  🔄 <strong>正在流式翻译</strong>
                  {streaming.totalChunks > 1 &&
                    `（第 ${streaming.chunkIndex + 1} / ${streaming.totalChunks} 块）`}
                  …
                </div>
                <div className="min-w-0 overflow-x-auto">
                  <MarkdownRenderer content={streaming.text} />
                  <span className="streaming-cursor">▍</span>
                </div>
              </div>
            )}

            {/* 翻译中切回原文 tab：显示原文（重译场景显示旧译文） */}
            {!loading && translating && view !== "zh" && (
              <div className="min-w-0 overflow-x-auto">
                {rawOriginal ? (
                  <MarkdownRenderer content={rawOriginal} />
                ) : bilingual ? (
                  <BilingualView view={view} bilingual={bilingual} />
                ) : (
                  <p className="loading-text">正在准备原文…</p>
                )}
              </div>
            )}

            {!loading && !translating && fallback && rawOriginal && (
              <>
                <div className="fallback-notice">
                  ⏳ <strong>翻译尚未生成</strong>：点击上方「翻译」按钮生成中文译文。
                  {!hasLLMKey && (
                    <>
                      {" "}请先在设置中配置 API Key（<code>⚙️</code> 图标）。
                    </>
                  )}
                </div>
                <div className="min-w-0 overflow-x-auto">
                  <MarkdownRenderer content={rawOriginal} />
                </div>
              </>
            )}

            {!loading && !translating && fallback && !rawOriginal && (
              <p className="loading-text">
                无法读取文件。请确认后端服务已启动。
              </p>
            )}

            {!loading && !translating && bilingual && (
              <BilingualView view={view} bilingual={bilingual} />
            )}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </SheetContent>

      <ConfirmDialog
        open={showReTranslateConfirm}
        onOpenChange={setShowReTranslateConfirm}
        title="是否需要重新翻译？"
        description="当前已有翻译结果，重新翻译将覆盖现有内容。"
        confirmText="确认重新翻译"
        onConfirm={handleConfirmReTranslate}
      />
    </Sheet>
  );
}

/* ---------- 对照视图 ---------- */

function BilingualView({
  view,
  bilingual,
}: {
  view: ViewMode;
  bilingual: BilingualContent;
}) {
  const { originals, translated } = bilingual;

  if (!originals || originals.length === 0) {
    return <p className="loading-text">该文件没有可展示的对照内容。</p>;
  }

  if (view === "both") {
    return (
      <div>
        {originals.map((o, i) => (
          <div key={i} className="bi-block">
            <div className="grid grid-cols-1 lg:grid-cols-2">
              <div className="min-w-0">
                <p className="bi-label">🌐 原文 (original)</p>
                <div className="bi-col bi-original min-w-0 overflow-x-auto">
                  <MarkdownRenderer content={o} />
                </div>
              </div>
              <div className="min-w-0 lg:border-l lg:border-stroke">
                <p className="bi-label">✅ 译文 (中文)</p>
                <div className="bi-col min-w-0 overflow-x-auto">
                  <MarkdownRenderer content={translated[i] || ""} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (view === "zh") {
    return (
      <div className="min-w-0 space-y-4 overflow-x-auto">
        {translated.map((t, i) => (
          <div key={i} className="min-w-0 overflow-x-auto">
            <MarkdownRenderer content={t} />
            {i < translated.length - 1 && <hr className="my-4" />}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4 overflow-x-auto">
      {originals.map((o, i) => (
        <div key={i} className="min-w-0 overflow-x-auto">
          <MarkdownRenderer content={o} />
          {i < originals.length - 1 && <hr className="my-4" />}
        </div>
      ))}
    </div>
  );
}
