import { useEffect, useState } from "react";
import {
  Eye,
  Loader2,
  Package,
  PenLine,
  Save,
  Sparkles,
  Columns2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownPreview } from "@/components/common/MarkdownPreview";
import {
  readSkillFile,
  skillWriteFile,
  skillEditFrontmatter,
  openaiYamlGenerate,
  type Skill,
} from "@/lib/api";
import { isMockMode } from "@/mock";

/**
 * 创作技能编辑表单（UI 反馈 2026-08-05 条目 4/6）：
 * - 居中 Dialog，tab 切换「正文 / Codex 兼容」；
 * - 正文：Markdown 编辑 + 预览（分栏/全屏）；
 * - Codex：一键转换（从 name/description 自动派生三件套，不让用户手写）；
 * - 无「保存 frontmatter」按钮——改名走外层卡片编辑钮。
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

/** 一键转换派生 short_description（25–64 字符硬约束自动满足）。 */
function deriveShortDesc(name: string, desc: string): string {
  let s = desc.trim() || `A skill named ${name}; see body for trigger scenarios.`;
  if (s.length > 64) s = s.slice(0, 64);
  const pad = ` Use when the task matches ${name}.`;
  while (s.length < 25) s += pad.slice(0, 25 - s.length);
  return s;
}

export function CreationEditDialog({
  skill,
  open,
  onClose,
  onSaved,
}: CreationEditDialogProps) {
  const [tab, setTab] = useState<"body" | "codex">("body");
  const [body, setBody] = useState("");
  const [origFm, setOrigFm] = useState("");
  const [desc, setDesc] = useState(skill.description);
  const [preview, setPreview] = useState<PreviewMode>("edit");
  const [busy, setBusy] = useState("");
  const [codexResult, setCodexResult] = useState("");

  useEffect(() => {
    if (!open) return;
    setDesc(skill.description);
    setTab("body");
    setPreview("edit");
    setCodexResult("");
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

  const saveDesc = async () => {
    setBusy("desc");
    try {
      await skillEditFrontmatter(skill.skill_dir, [
        { key: "description", op: "set", value: desc },
      ]);
      toast.success("描述已保存");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const convertCodex = async () => {
    setBusy("codex");
    setCodexResult("");
    try {
      const res = await openaiYamlGenerate(
        skill.skill_dir,
        {
          display_name: skill.name,
          short_description: deriveShortDesc(skill.name, desc),
          default_prompt: `Use $skill-name to ${desc.trim() || `assist with ${skill.name} tasks`}`,
        },
        true
      );
      setCodexResult(
        res.warnings.length > 0
          ? `已生成：${res.path}\n提示：${res.warnings.join("；")}`
          : `已生成：${res.path}`
      );
      toast.success("openai.yaml 一键生成完成");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setCodexResult(`失败：${raw}`);
      toast.error(raw);
    } finally {
      setBusy("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-[min(860px,92vw)] flex-col border-border/60 bg-card/95 backdrop-blur-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-4 w-4 text-primary" />
            {skill.name}
          </DialogTitle>
          {/* tab 切换（条目 4：Codex 兼容不割裂） */}
          <div className="mt-3 flex gap-1 rounded-lg bg-glass-1 p-1">
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                tab === "body"
                  ? "bg-glass-3 text-text-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
              onClick={() => setTab("body")}
            >
              正文
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                tab === "codex"
                  ? "bg-glass-3 text-text-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
              onClick={() => setTab("codex")}
            >
              <Package className="mr-1 inline h-3 w-3" />
              Codex 兼容
            </button>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-1">
          {tab === "body" ? (
            <>
              {/* 预览模式切换（条目 6） */}
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
                    rows={preview === "split" ? 18 : 16}
                    className="w-full resize-y rounded-md border border-input bg-transparent p-2.5 font-mono text-xs leading-relaxed"
                  />
                )}
                {preview !== "edit" && (
                  <div className="min-h-[200px] overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-3">
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
            </>
          ) : (
            <>
              <div>
                <div className="mb-1.5 text-xs text-muted-foreground">
                  描述（转换素材：派生 short_description / default_prompt）
                </div>
                <Input
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="h-8"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1.5 h-7 px-2 text-xs"
                  disabled={busy !== ""}
                  onClick={saveDesc}
                >
                  保存描述
                </Button>
              </div>
              <div className="rounded-md border border-border/40 bg-glass-1 p-3">
                <p className="mb-2 text-[11px] leading-relaxed text-text-tertiary">
                  一键转换：display_name = 技能名；short_description /
                  default_prompt 从描述自动派生（满足 25–64 字符与 $skill-name
                  硬约束）；覆盖写自动备份 .bak
                </p>
                <Button size="sm" disabled={busy !== ""} onClick={convertCodex}>
                  {busy === "codex" && <Loader2 className="h-3 w-3 animate-spin" />}
                  <Sparkles className="h-3 w-3" />
                  一键生成 openai.yaml
                </Button>
                {codexResult && (
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-text-secondary">
                    {codexResult}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
