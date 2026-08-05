import { useEffect, useMemo, useState } from "react";
import { Loader2, PenLine, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewSkillDialog } from "@/components/skill/NewSkillDialog";
import {
  readSkillFile,
  skillEditFrontmatter,
  skillWriteFile,
  openaiYamlGenerate,
  type Skill,
} from "@/lib/api";
import { isMockMode } from "@/mock";

/**
 * C9 创作页（PLAN-06 §3.13）：authored 技能列表 + 编辑表单。
 * - frontmatter 表单走 C10 skill_edit_frontmatter（未知字段字节级保留）；
 * - 正文走 C6 skill_write_file（归属闸）；
 * - Codex 兼容三件套走 C8 openai_yaml_generate。
 */
interface CreationViewProps {
  skills: Skill[];
  refresh: () => void;
}

function splitFrontmatter(md: string): { fm: string; body: string } | null {
  if (!md.startsWith("---")) return null;
  const rest = md.slice(3);
  const idx = rest.indexOf("\n---");
  if (idx < 0) return null;
  return { fm: rest.slice(0, idx).replace(/^\n/, ""), body: rest.slice(idx + 4).replace(/^\n/, "") };
}

export function CreationView({ skills, refresh }: CreationViewProps) {
  const authored = useMemo(
    () => skills.filter((s) => s.tool_id === "authored"),
    [skills]
  );
  const [selected, setSelected] = useState<Skill | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [body, setBody] = useState("");
  const [origFm, setOrigFm] = useState("");
  const [dn, setDn] = useState("");
  const [sd, setSd] = useState("");
  const [dp, setDp] = useState("");
  const [busy, setBusy] = useState<string>("");

  // 选中技能 → 读 SKILL.md 拆 frontmatter/body
  useEffect(() => {
    if (!selected) return;
    if (isMockMode()) {
      setName(selected.name);
      setDesc(selected.description);
      setBody(`# ${selected.name}\n\n${selected.description}\n`);
      setOrigFm(`name: ${selected.name}\ndescription: ${selected.description}`);
      return;
    }
    readSkillFile(selected.source_path)
      .then((md) => {
        const parts = splitFrontmatter(md);
        if (parts) {
          setOrigFm(parts.fm);
          setBody(parts.body);
          const nameLine = parts.fm.split("\n").find((l) => l.startsWith("name:"));
          const descLine = parts.fm.split("\n").find((l) => l.startsWith("description:"));
          setName(nameLine?.replace(/^name:\s*/, "").replace(/^"|"$/g, "") ?? "");
          setDesc(descLine?.replace(/^description:\s*/, "").replace(/^"|"$/g, "") ?? "");
        }
      })
      .catch(() => toast.error("读取 SKILL.md 失败"));
  }, [selected]);

  const saveMeta = async () => {
    if (!selected) return;
    setBusy("meta");
    try {
      await skillEditFrontmatter(selected.skill_dir, [
        { key: "name", op: "set", value: name },
        { key: "description", op: "set", value: desc },
      ]);
      toast.success("frontmatter 已保存（未知字段保留）");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const saveBody = async () => {
    if (!selected) return;
    setBusy("body");
    try {
      // frontmatter 原样回拼，正文整文件写（C6 归属闸 + rel 安全）
      const full = `---\n${origFm}\n---\n${body}`;
      await skillWriteFile(selected.skill_dir, "SKILL.md", full);
      toast.success("正文已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };

  const saveCodex = async () => {
    if (!selected) return;
    setBusy("codex");
    try {
      const res = await openaiYamlGenerate(
        selected.skill_dir,
        { display_name: dn, short_description: sd, default_prompt: dp },
        true
      );
      toast.success(
        res.warnings.length > 0 ? `openai.yaml 已写入：${res.warnings.join("；")}` : "openai.yaml 已写入"
      );
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      toast.error(raw === "EXISTS" ? "openai.yaml 已存在" : raw);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mx-auto flex max-w-5xl gap-6 px-6 py-6">
      {/* 左：authored 列表 */}
      <div className="w-64 shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <PenLine className="h-4 w-4 text-primary" />
            我的创作（{authored.length}）
          </h2>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Sparkles className="h-3 w-3" />
            新建
          </Button>
        </div>
        <div className="flex flex-col gap-1.5">
          {authored.length === 0 && (
            <p className="text-xs text-text-tertiary">
              还没有创作技能——点「新建」用模板或 AI 起草
            </p>
          )}
          {authored.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelected(s)}
              className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                selected?.id === s.id
                  ? "border-primary/60 bg-glass-2"
                  : "border-border/40 bg-glass-1 hover:bg-glass-2"
              }`}
            >
              <div className="truncate font-medium text-text-primary">{s.name}</div>
              <div className="truncate text-[11px] text-text-tertiary">{s.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 右：编辑表单 */}
      <div className="min-w-0 flex-1">
        {!selected ? (
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border/50 text-sm text-text-tertiary">
            选择左侧技能开始编辑
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* frontmatter 表单（C10） */}
            <section className="rounded-lg border border-border/40 bg-glass-1 p-4">
              <h3 className="mb-3 text-xs font-semibold text-text-secondary">
                frontmatter（保存时未知字段/注释字节级保留）
              </h3>
              <div className="flex flex-col gap-3">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">name（hyphen-case）</div>
                  <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 font-mono" />
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">
                    description（做什么 + 何时用）
                  </div>
                  <Input value={desc} onChange={(e) => setDesc(e.target.value)} className="h-8" />
                </div>
                <Button size="sm" disabled={busy !== ""} onClick={saveMeta}>
                  {busy === "meta" && <Loader2 className="h-3 w-3 animate-spin" />}
                  <Save className="h-3 w-3" />
                  保存 frontmatter
                </Button>
              </div>
            </section>

            {/* 正文（C6） */}
            <section className="rounded-lg border border-border/40 bg-glass-1 p-4">
              <h3 className="mb-3 text-xs font-semibold text-text-secondary">正文（Markdown）</h3>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs"
              />
              <Button size="sm" className="mt-2" disabled={busy !== ""} onClick={saveBody}>
                {busy === "body" && <Loader2 className="h-3 w-3 animate-spin" />}
                <Save className="h-3 w-3" />
                保存正文
              </Button>
            </section>

            {/* Codex 兼容（C8） */}
            <section className="rounded-lg border border-border/40 bg-glass-1 p-4">
              <h3 className="mb-1 text-xs font-semibold text-text-secondary">
                Codex 兼容（agents/openai.yaml）
              </h3>
              <p className="mb-3 text-[11px] text-text-tertiary">
                默认写三个文案字段；icon/brand_color 需提供时才写入（官方原则）
              </p>
              <div className="flex flex-col gap-3">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">display_name</div>
                  <Input value={dn} onChange={(e) => setDn(e.target.value)} className="h-8" />
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">
                    short_description（25–64 字符，当前 {[...sd].length}）
                  </div>
                  <Input value={sd} onChange={(e) => setSd(e.target.value)} className="h-8" />
                </div>
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">
                    default_prompt（必须含 $skill-name）
                  </div>
                  <Input
                    value={dp}
                    onChange={(e) => setDp(e.target.value)}
                    placeholder="Use $skill-name to ..."
                    className="h-8"
                  />
                </div>
                <Button size="sm" disabled={busy !== ""} onClick={saveCodex}>
                  {busy === "codex" && <Loader2 className="h-3 w-3 animate-spin" />}
                  生成 openai.yaml
                </Button>
              </div>
            </section>
          </div>
        )}
      </div>

      {dialogOpen && (
        <NewSkillDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onCreated={refresh}
        />
      )}
    </div>
  );
}
