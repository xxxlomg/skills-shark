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
import { skillNew, skillCommitDraft, hubListTools, type ToolInfo } from "@/lib/api";
import { generateAndCommit } from "@/lib/authoring-api";
import { isMockMode, MOCK_TOOLS } from "@/mock";

/**
 * C5/C7：新建技能对话框。
 * - 模板模式（C5）：name + description，落点 authored；
 * - AI 模式（C7）：主题 → 流式生成 → skill_commit_draft 落盘 → 校验报告；
 *   落点双选（authored / 可写工具目录，§3.9）。
 * 同名已存在（EXISTS）提示改名。
 */
interface NewSkillDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

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
        // C9 双落点：authored 走 skill_new（C5 语义）；工具目录走 commit_draft 空 body 骨架
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
          warns > 0
            ? `AI 技能已落盘，${warns} 项诊断提示`
            : "AI 技能已落盘，校验全绿"
        );
        setTopic("");
        setStream("");
      }
      onCreated();
      onClose();
    } catch (e) {
      const raw = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
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

  const canSubmit =
    mode === "template"
      ? !!name.trim() && !!description.trim()
      : !!topic.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border-border/60 bg-card/95 backdrop-blur-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-4 w-4 text-primary" />
            新建技能
          </DialogTitle>
          <DialogDescription>
            模板模式手写骨架；AI 模式输入主题流式生成草稿，落盘后即时校验
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto pr-1">
          {/* 模式切换 */}
          <div className="flex gap-1 rounded-lg bg-glass-1 p-1">
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                mode === "template" ? "bg-glass-3 text-text-primary" : "text-text-secondary hover:text-text-primary"
              }`}
              onClick={() => setMode("template")}
            >
              模板模式
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                mode === "ai" ? "bg-glass-3 text-text-primary" : "text-text-secondary hover:text-text-primary"
              }`}
              onClick={() => setMode("ai")}
            >
              <Sparkles className="mr-1 inline h-3 w-3" />
              AI 生成
            </button>
          </div>

          {mode === "template" ? (
            <>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">
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
                <div className="mb-1 text-xs text-muted-foreground">
                  描述 *（写清"做什么 + 何时用"——模型只凭它决定是否使用）
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
                <div className="mb-1 text-xs text-muted-foreground">主题 *</div>
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
            <div className="mb-1 text-xs text-muted-foreground">
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
