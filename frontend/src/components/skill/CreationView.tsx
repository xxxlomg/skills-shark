import { useMemo, useState, type CSSProperties } from "react";
import { PenLine, Pencil, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionHead } from "@/components/common/SectionHead";
import { Tip } from "@/components/common/Tip";
import { LayoutToggle } from "./LayoutToggle";
import { NewSkillDialog } from "./NewSkillDialog";
import { CreationEditDialog } from "./CreationEditDialog";
import { skillRename, type Skill } from "@/lib/api";
import type { LayoutMode } from "@/hooks/useSkills";

/**
 * C9 创作页（UI 反馈 2026-08-05 条目 4 重构）：
 * - 与其他主页同构：SectionHead + 卡片网格（ghost 新建卡独占一行）；
 * - 卡片点击 → 居中 CreationEditDialog（正文/Codex tab + Markdown 预览）；
 * - 卡片右上角编辑钮 → 重命名（C10 skill_edit_frontmatter）；
 * - 无「保存 frontmatter」常驻按钮。
 */
interface CreationViewProps {
  skills: Skill[];
  refresh: () => void;
  layout: LayoutMode;
  onLayoutChange: (m: LayoutMode) => void;
}

export function CreationView({
  skills,
  refresh,
  layout,
  onLayoutChange,
}: CreationViewProps) {
  const authored = useMemo(
    () => skills.filter((s) => s.tool_id === "authored"),
    [skills]
  );
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [renaming, setRenaming] = useState<Skill | null>(null);
  const [newName, setNewName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  let idx = 0;

  const openRename = (s: Skill) => {
    setRenaming(s);
    setNewName(s.name);
  };

  const submitRename = async () => {
    if (!renaming) return;
    setRenameBusy(true);
    try {
      await skillRename(renaming.skill_dir, newName.trim());
      toast.success(`已重命名为 ${newName.trim()}`);
      setRenaming(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRenameBusy(false);
    }
  };

  return (
    <div className="relative py-6">
      <SectionHead
        title="创作"
        subtitle={`${authored.length} 个创作技能 · 草稿期建议留在 authored`}
      >
        <button type="button" className="mbtn primary" onClick={() => setNewOpen(true)}>
          <Sparkles className="h-3.5 w-3.5" />
          新建
        </button>
        <LayoutToggle value={layout} onChange={onLayoutChange} />
      </SectionHead>

      {layout === "grid" ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {authored.map((s) => (
            <AuthoredCard
              key={s.id}
              skill={s}
              index={idx++}
              layout="grid"
              onClick={() => setEditing(s)}
              onRename={() => openRename(s)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {authored.map((s) => (
            <AuthoredCard
              key={s.id}
              skill={s}
              index={idx++}
              layout="list"
              onClick={() => setEditing(s)}
              onRename={() => openRename(s)}
            />
          ))}
        </div>
      )}

      {authored.length === 0 && (
        <p className="mt-6 text-center text-xs text-text-tertiary">
          还没有创作技能——点「新建」用模板或 AI 起草
        </p>
      )}

      {newOpen && (
        <NewSkillDialog
          open={newOpen}
          onClose={() => setNewOpen(false)}
          onCreated={refresh}
        />
      )}

      {editing && (
        <CreationEditDialog
          skill={editing}
          open={!!editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}

      {/* 重命名小弹窗（条目 4：外层卡片编辑钮） */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="max-w-sm border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" />
              重命名技能
            </DialogTitle>
          </DialogHeader>
          <div className="p-1">
            <div className="mb-1.5 text-xs text-muted-foreground">
              新名称（hyphen-case，如 code-review）
            </div>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-8 font-mono"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={!newName.trim() || renameBusy}
              onClick={submitRename}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 创作卡片：与 FolderCard 同形的玻璃卡；右上角编辑钮重命名。 */
function AuthoredCard({
  skill,
  index,
  layout,
  onClick,
  onRename,
}: {
  skill: Skill;
  index: number;
  layout: "grid" | "list";
  onClick: () => void;
  onRename: () => void;
}) {
  const wrapStyle = { "--i": index } as CSSProperties;

  if (layout === "list") {
    return (
      <div className="card-wrap" style={wrapStyle}>
        <div
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          }}
          className="glass-card glass-card-hover card-glow relative flex w-full cursor-pointer items-center gap-4 overflow-hidden px-[18px] py-[14px] text-left"
        >
          <span className="absolute left-0 top-[20%] z-[1] h-[60%] w-[3px] rounded-r-[4px] bg-gradient-to-b from-brand to-cyan opacity-85" />
          <span className="relative z-[1] grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[12px] border border-stroke bg-glass-2 text-brand">
            <PenLine className="h-5 w-5" />
          </span>
          <div className="relative z-[1] min-w-0 flex-1">
            <h3 className="truncate font-display text-[15.5px] font-semibold text-text-primary">
              {skill.name}
            </h3>
            <p className="truncate text-[11px] text-text-tertiary">{skill.description}</p>
          </div>
          <Tip label="重命名">
            <button
              type="button"
              className="relative z-[1] grid h-7 w-7 place-items-center rounded-md border border-stroke bg-glass-2 text-text-secondary hover:text-text-primary"
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </Tip>
        </div>
      </div>
    );
  }

  return (
    <div className="card-wrap" style={wrapStyle}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className="glass-card glass-card-hover card-glow relative flex h-full w-full cursor-pointer flex-col overflow-hidden p-[18px] text-left"
      >
        <div className="relative z-[1] flex items-start justify-between">
          <span className="grid h-[42px] w-[42px] place-items-center rounded-[12px] border border-stroke bg-glass-2 text-brand">
            <PenLine className="h-5 w-5" />
          </span>
          <Tip label="重命名">
            <button
              type="button"
              className="grid h-7 w-7 place-items-center rounded-md border border-stroke bg-glass-2 text-text-secondary hover:text-text-primary"
              onClick={(e) => {
                e.stopPropagation();
                onRename();
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </Tip>
        </div>
        <h3 className="relative z-[1] mt-3 truncate font-display text-[15.5px] font-semibold text-text-primary">
          {skill.name}
        </h3>
        <p className="relative z-[1] mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-tertiary">
          {skill.description}
        </p>
      </div>
    </div>
  );
}
