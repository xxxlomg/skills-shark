import { useEffect, useState } from "react";
import { Loader2, PenLine, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/common/Tip";
import { skillNew, skillCommitDraft, hubListTools, type ToolInfo } from "@/lib/api";
import { generateAndCommit } from "@/lib/authoring-api";
import { isMockMode, MOCK_TOOLS } from "@/mock";

/**
 * C5/C7 新建技能对话框（UI 反馈 2026-08-05 重构）：
 * - 模板模式为主：name 必填、description 可选（先命名后补描述）；
 * - AI 创作内嵌：标题行右侧入口，停留 60s 未保存淡入「没灵感？试试 AI 创作」；
 * - 双落点共用（§3.9）；
 * - 输入框 focus ring 不被裁切：滚动容器留 padding、行距放宽。
 */
interface NewSkillDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const AI_HINT_DELAY_MS = 60_000;

export function NewSkillDialog({ open, onClose, onCreated }: NewSkillDialogProps) {
  const [mode, setMode] = useState<"template" | "ai">("template");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [topic, setTopic] = useState("");
  const [location, setLocation] = useState("authored");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stream, setStream] = useState("");
  const [aiHint, setAiHint] = useState(false);

  // 停留 60s 未保存 → 淡入提示切 AI（条目 5）
  useEffect(() => {
    if (!open || mode === "ai") return;
    const t = setTimeout(() => setAiHint(true), AI_HINT_DELAY_MS);
    return () => clearTimeout(t);
  }, [open, mode]);

  // 落点候选：可写工具（非 app_owned）
  useEffect(() => {
    if (!open) return;
    if (isMockMode()) {
      setTools(MOCK_TOOLS.filter((t) => !t.app_owned && t.enabled));
      return;
    }
    hubListTools()
      .then((ts) => setTools(ts.filter((t) => !t.app_owned && t.enabled)))
      .catch(() => setTools([]));
  }, [open]);

  const handleCreate = async () => {
    setBusy(true);
    setError("");
    setStream("");
    try {
      if (mode === "template") {
        if (location === "authored") {
          await skillNew({ name, description });
        } else {
          await skillCommitDraft(location, { name, description });
        }
        toast.success(`技能 ${name.trim()} 已创建（${location === "authored" ? "authored" : location}）`);
        setName("");
        setDescription("");
      } else {
        const res = await generateAndCommit(topic, location, (d) =>
          setStream((s) => s + d)
        );
        const warns = res.validation.issues.filter((i) => i.severity !== "info").length;
        toast.success(
          warns > 0 ? `AI 技能已落盘，${warns} 项诊断提示` : "AI 技能已落盘，校验全绿"
        );
        setTopic("");
        setStream("");
      }
      onCreated();
      onClose();
    } catch (e) {
      const raw =
        e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      setError(
        raw === "EXISTS"
          ? "同名技能已存在，请换一个 name"
          : raw.startsWith("PATH_ESCAPE")
            ? "落点不在已注册目录之下（安全闸拦截）"
            : raw
      );
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === "template" ? !!name.trim() : !!topic.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col border-border/60 bg-card/95 backdrop-blur-xl">
        <DialogHeader className="shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <PenLine className="h-4 w-4 text-primary" />
                新建技能
              </DialogTitle>
              <DialogDescription className="mt-1.5">
                {mode === "template"
                  ? "先命名即可创建；描述可稍后在创作页补充"
                  : "输入主题流式生成草稿，落盘后即时校验"}
              </DialogDescription>
            </div>
            {/* AI 创作内嵌入口（条目 5）：60s 未保存淡入引导文案 */}
            {mode === "template" && (
              <Tip label="用 AI 从主题生成草稿">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-text-secondary"
                  onClick={() => setMode("ai")}
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span
                    className={aiHint ? "animate-fade-in text-primary" : ""}
                  >
                    {aiHint ? "没灵感？试试 AI 创作" : "AI 创作"}
                  </span>
                </Button>
              </Tip>
            )}
            {mode === "ai" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-text-secondary"
                onClick={() => setMode("template")}
              >
                返回模板
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* p-1 给 focus ring 留空间，避免外圈特效被裁（条目 3） */}
        <div className="flex flex-col gap-4 overflow-y-auto p-1">
          {mode === "template" ? (
            <>
              <div>
                <div className="mb-1.5 text-xs text-muted-foreground">
                  名称 *（hyphen-case，如 code-review）
                </div>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例：my-new-skill"
                  className="h-8 font-mono"
                />
              </div>
              <div>
                <div className="mb-1.5 text-xs text-muted-foreground">
                  描述（可选——写清"做什么 + 何时用"，模型只凭它决定是否使用）
                </div>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="例：Do X when Y happens"
                  className="h-8"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="mb-1.5 text-xs text-muted-foreground">主题 *</div>
                <Input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="例：为 Spring Boot 项目生成 changelog"
                  className="h-8"
                />
              </div>
              {stream && (
                <pre className="max-h-40 overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-2 font-mono text-[11px] whitespace-pre-wrap text-text-secondary">
                  {stream}
                </pre>
              )}
            </>
          )}

          {/* C9 双落点：两模式共用（§3.9） */}
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">
              落点（§3.9：草稿期建议 authored，明确归属再进工具目录）
            </div>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="authored">创作库（authored）</option>
              {tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={!canSubmit || busy} onClick={handleCreate}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "template" ? "创建" : "生成并落盘"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
