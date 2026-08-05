import { useEffect, useState } from "react";
import { Eye, Loader2, PenLine, Save, Columns2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MarkdownPreview } from "@/components/common/MarkdownPreview";
import { readSkillFile, skillWriteFile, type Skill } from "@/lib/api";
import { isMockMode } from "@/mock";

/**
 * 创作技能正文编辑器（UI 反馈 2026-08-05 第二轮）：
 * - 居中 Dialog，纯正文编辑 + Markdown 三态预览；
 * - Codex/Claude 兼容转换已移入创作卡片右上角菜单（详情页不再出现）。
 */
interface CreationEditDialogProps {
  skill: Skill;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type PreviewMode = "edit" | "split" | "preview";

function splitFrontmatter(md: string): { fm: string; body: string } | null {
  if (!md.startsWith("---")) return null;
  const rest = md.slice(3);
  const idx = rest.indexOf("\n---");
  if (idx < 0) return null;
  return {
    fm: rest.slice(0, idx).replace(/^\n/, ""),
    body: rest.slice(idx + 4).replace(/^\n/, ""),
  };
}

export function CreationEditDialog({
  skill,
  open,
  onClose,
  onSaved,
}: CreationEditDialogProps) {
  const [body, setBody] = useState("");
  const [origFm, setOrigFm] = useState("");
  const [preview, setPreview] = useState<PreviewMode>("edit");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!open) return;
    setPreview("edit");
    if (isMockMode()) {
      setBody(`# ${skill.name}\n\n${skill.description}\n`);
      setOrigFm(`name: ${skill.name}\ndescription: ${skill.description}`);
      return;
    }
    readSkillFile(skill.source_path)
      .then((md) => {
        const parts = splitFrontmatter(md);
        if (parts) {
          setOrigFm(parts.fm);
          setBody(parts.body);
        }
      })
      .catch(() => toast.error("读取 SKILL.md 失败"));
  }, [open, skill]);

  const saveBody = async () => {
    setBusy("body");
    try {
      const full = `---\n${origFm}\n---\n${body}`;
      await skillWriteFile(skill.skill_dir, "SKILL.md", full);
      toast.success("正文已保存");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[min(1180px,94vw)] max-w-[min(1180px,calc(100%-2rem))] flex-col border-border/60 bg-card/95 backdrop-blur-xl sm:max-w-none">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-4 w-4 text-primary" />
            {skill.name}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-1">
          {/* 预览模式切换 */}
          <div className="flex items-center gap-1">
            <Button
              variant={preview === "edit" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setPreview("edit")}
            >
              编辑
            </Button>
            <Button
              variant={preview === "split" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setPreview("split")}
            >
              <Columns2 className="h-3 w-3" />
              分栏
            </Button>
            <Button
              variant={preview === "preview" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setPreview("preview")}
            >
              <Eye className="h-3 w-3" />
              预览
            </Button>
          </div>
          <div
            className={
              preview === "split"
                ? "grid min-h-0 flex-1 gap-3 md:grid-cols-2"
                : "flex min-h-0 flex-1 flex-col"
            }
          >
            {preview !== "preview" && (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={preview === "split" ? 24 : 22}
                className="w-full resize-y rounded-md border border-input bg-transparent p-3.5 font-mono text-[13px] leading-[1.7]"
              />
            )}
            {preview !== "edit" && (
              <div className="min-h-[240px] overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-4">
                <MarkdownPreview content={body} />
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button size="sm" disabled={busy !== ""} onClick={saveBody}>
              {busy === "body" && <Loader2 className="h-3 w-3 animate-spin" />}
              <Save className="h-3 w-3" />
              保存正文
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
