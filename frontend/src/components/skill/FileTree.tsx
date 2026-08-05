import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  Plus,
  Trash2,
} from "lucide-react";
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
import {
  readSkillFile,
  skillDeleteFile,
  skillListFiles,
  skillWriteFile,
  type FileNode,
  type Skill,
} from "@/lib/api";

/**
 * W4：附带资源文件树（scripts/references/assets 等）。
 * 新建/删除/查看；后端 skill_list_files / skill_delete_file（C6 同闸）。
 */
interface FileTreeProps {
  skill: Skill | null;
}

function NodeRow({
  node,
  depth,
  collapsed,
  onToggle,
  onView,
  onDelete,
}: {
  node: FileNode;
  depth: number;
  collapsed: Set<string>;
  onToggle: (rel: string) => void;
  onView: (rel: string) => void;
  onDelete: (rel: string) => void;
}) {
  const pad = { paddingLeft: `${8 + depth * 14}px` };
  if (node.is_dir) {
    const open = !collapsed.has(node.rel);
    return (
      <>
        <button
          type="button"
          style={pad}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-text-secondary hover:bg-glass-1"
          onClick={() => onToggle(node.rel)}
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary/70" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-primary/70" />
          )}
          <span className="truncate">{node.name}/</span>
          <span className="flex-1" />
          <Trash2
            className="h-3 w-3 shrink-0 text-text-tertiary hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.rel);
            }}
          />
        </button>
        {open &&
          node.children.map((c) => (
            <NodeRow
              key={c.rel}
              node={c}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onView={onView}
              onDelete={onDelete}
            />
          ))}
      </>
    );
  }
  return (
    <div
      style={pad}
      className="group flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-text-secondary hover:bg-glass-1"
    >
      <span className="w-3 shrink-0" />
      <FileIcon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
      <button
        type="button"
        className="truncate hover:text-text-primary hover:underline"
        onClick={() => onView(node.rel)}
      >
        {node.name}
      </button>
      <span className="flex-1" />
      {node.name.toLowerCase() !== "skill.md" && (
        <Trash2
          className="h-3 w-3 shrink-0 text-text-tertiary hover:text-red-400"
          onClick={() => onDelete(node.rel)}
        />
      )}
    </div>
  );
}

export function FileTree({ skill }: FileTreeProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [viewRel, setViewRel] = useState<string | null>(null);
  const [viewContent, setViewContent] = useState("");
  const [delRel, setDelRel] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newRel, setNewRel] = useState("");

  const load = useCallback(() => {
    if (!skill) return;
    skillListFiles(skill.skill_dir)
      .then(setTree)
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  }, [skill]);

  useEffect(() => {
    load();
  }, [load]);

  if (!skill) {
    return (
      <div className="grid flex-1 place-items-center rounded-md border border-dashed border-border/50 text-xs text-text-tertiary">
        首存创建技能后，可在这里管理附带资源
      </div>
    );
  }

  const view = (rel: string) => {
    readSkillFile(`${skill.skill_dir}/${rel}`)
      .then((c) => {
        setViewContent(c);
        setViewRel(rel);
      })
      .catch(() => toast.error("读取失败"));
  };

  const doDelete = async () => {
    if (!delRel) return;
    try {
      await skillDeleteFile(skill.skill_dir, delRel);
      toast.success(`已删除 ${delRel}`);
      setDelRel(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const doNew = async () => {
    const rel = newRel.trim();
    if (!rel) return;
    try {
      await skillWriteFile(skill.skill_dir, rel, "");
      toast.success(`已创建 ${rel}`);
      setNewOpen(false);
      setNewRel("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-text-tertiary">
          scripts / references / assets——随技能目录落盘
        </span>
        <span className="flex-1" />
        <Button variant="secondary" size="sm" className="h-7 text-xs" onClick={() => setNewOpen(true)}>
          <Plus className="h-3 w-3" />
          新建文件
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-glass-1/60 p-2">
        {tree.length === 0 ? (
          <p className="p-3 text-center text-[11px] text-text-tertiary">（空目录）</p>
        ) : (
          tree.map((n) => (
            <NodeRow
              key={n.rel}
              node={n}
              depth={0}
              collapsed={collapsed}
              onToggle={(rel) =>
                setCollapsed((s) => {
                  const next = new Set(s);
                  if (next.has(rel)) next.delete(rel);
                  else next.add(rel);
                  return next;
                })
              }
              onView={view}
              onDelete={setDelRel}
            />
          ))
        )}
      </div>

      {/* 查看 */}
      <Dialog open={viewRel !== null} onOpenChange={(o) => !o && setViewRel(null)}>
        <DialogContent className="max-w-2xl border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">{viewRel}</DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-text-secondary">
            {viewContent}
          </pre>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={delRel !== null} onOpenChange={(o) => !o && setDelRel(null)}>
        <DialogContent className="max-w-sm border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>删除 {delRel}？</DialogTitle>
          </DialogHeader>
          <p className="p-1 text-xs text-muted-foreground">目录将递归删除，不可恢复。</p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDelRel(null)}>
              取消
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void doDelete()}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建 */}
      <Dialog open={newOpen} onOpenChange={(o) => !o && setNewOpen(false)}>
        <DialogContent className="max-w-sm border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>新建附带文件</DialogTitle>
          </DialogHeader>
          <Input
            value={newRel}
            onChange={(e) => setNewRel(e.target.value)}
            placeholder="例：scripts/setup.sh 或 references/guide.md"
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setNewOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={!newRel.trim()} onClick={() => void doNew()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
