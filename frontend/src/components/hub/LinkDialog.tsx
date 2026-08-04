import { useEffect, useMemo, useState } from "react";
import {
  FolderSymlink,
  Copy,
  Trash2,
  Check,
  Search,
  Loader2,
  Link2,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/common/Tip";
import {
  hubLinkSkill,
  hubLinkableTools,
  type LinkMode,
  type LinkableTool,
  type Skill,
} from "@/lib/api";

interface LinkDialogProps {
  skills: Skill[];
  /** 从技能详情页进入时预选该技能 */
  initialSkillId?: string | null;
  onClose: () => void;
  onLinked: () => void;
}

const MODES: { value: LinkMode; label: string; icon: typeof Link2; desc: string }[] = [
  {
    value: "link",
    label: "链接（推荐）",
    icon: Link2,
    desc: "创建 junction 引用，与出处共享同一份内容：出处更新即时同步到所有工具，不占额外空间。",
  },
  {
    value: "copy",
    label: "复制",
    icon: Copy,
    desc: "复制一份完整实体到目标工具，此后与出处互不影响，各自维护。",
  },
  {
    value: "move",
    label: "移动",
    icon: Trash2,
    desc: "复制到目标工具后，原件移入回收站。适合把散落技能收归单一来源。",
  },
];

/** 步骤标题：编号圆标 + 标题 + 引导文案 */
function StepHeader({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-bold text-brand">
          {n}
        </span>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      {hint && <p className="pl-7 text-xs text-text-tertiary">{hint}</p>}
    </div>
  );
}

/**
 * 新建引用对话框（PLAN-06 §2.8，B5）。
 * 居中 Dialog：左 sidebar 选技能，右侧选目标工具与方式。
 * 集合根技能可勾选「引用整个合集」；builtin 技能禁止 move。
 */
export function LinkDialog({ skills, initialSkillId, onClose, onLinked }: LinkDialogProps) {
  const [query, setQuery] = useState("");
  const [skillId, setSkillId] = useState<string | null>(initialSkillId ?? null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [mode, setMode] = useState<LinkMode>("link");
  const [moveConfirmed, setMoveConfirmed] = useState(false);
  const [wholeCollection, setWholeCollection] = useState(false);
  const [tools, setTools] = useState<LinkableTool[]>([]);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    hubLinkableTools()
      .then((ts) => {
        setTools(ts);
        const first = ts.find((t) => t.enabled);
        if (first) setToolId(first.id);
      })
      .catch((e) => toast.error(`加载工具清单失败：${String(e)}`))
      .finally(() => setToolsLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? skills.filter((s) => s.name.toLowerCase().includes(q))
      : skills;
    return list.slice(0, 60);
  }, [skills, query]);

  const selectedSkill = skills.find((s) => s.id === skillId) ?? null;
  const selectedTool = tools.find((t) => t.id === toolId) ?? null;
  const moveBlocked = selectedSkill?.tool_id === "builtin";

  // 集合级引用：仅当选中技能挂在集合根下（parent_collection 且结构匹配 skill_dir）
  const collectionRoot = useMemo(() => {
    if (!selectedSkill?.parent_collection) return null;
    const root = selectedSkill.parent_collection;
    if (!selectedSkill.skill_dir.replace(/\\/g, "/").startsWith(root.replace(/\\/g, "/"))) {
      return null;
    }
    return root;
  }, [selectedSkill]);

  useEffect(() => {
    setWholeCollection(false);
  }, [skillId]);

  const canSubmit =
    !!selectedSkill &&
    !!selectedTool?.enabled &&
    (mode !== "move" || (moveConfirmed && !moveBlocked));

  const submitLabel =
    mode === "link" ? "创建链接" : mode === "copy" ? "创建副本" : "移动";

  const submit = async () => {
    if (!selectedSkill || !selectedTool || !canSubmit) return;
    setBusy(true);
    try {
      await hubLinkSkill({
        // 集合级引用 = 以合集根目录作为 source（后端按目录根节点校验）
        sourcePath: wholeCollection && collectionRoot ? collectionRoot : selectedSkill.skill_dir,
        targetToolId: selectedTool.id,
        mode,
      });
      toast.success(
        wholeCollection
          ? `已把合集「${selectedSkill.parent_collection?.split(/[\\/]/).pop()}」${mode === "link" ? "链接" : mode === "copy" ? "复制" : "移动"}到 ${selectedTool.name}`
          : `已${mode === "link" ? "链接" : mode === "copy" ? "复制" : "移动"}「${selectedSkill.name}」到 ${selectedTool.name}`,
      );
      onLinked();
      onClose();
    } catch (e) {
      toast.error(`操作失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex h-[min(620px,88vh)] w-[min(880px,94vw)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-stroke px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-text-primary">
            <FolderSymlink className="h-4 w-4 text-brand" />
            引用技能到工具
          </DialogTitle>
          <DialogDescription>
            把技能链接 / 复制到 AI 工具的 skills 目录，让对应工具能发现它。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* 左 sidebar：1 · 选择技能 */}
          <aside className="flex w-[300px] shrink-0 flex-col border-r border-stroke">
            <div className="shrink-0 space-y-2.5 p-4 pb-3">
              <StepHeader n={1} title="选择技能" hint="支持名称搜索" />
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索技能名..."
                  className="pl-8"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-4">
              {filtered.length === 0 && (
                <p className="py-6 text-center text-xs text-text-tertiary">无匹配技能</p>
              )}
              {filtered.map((s) => {
                const active = s.id === skillId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSkillId(active ? null : s.id)}
                    className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors ${
                      active
                        ? "border-brand bg-brand/10 font-medium text-text-primary ring-1 ring-brand/50"
                        : "border-transparent text-text-secondary hover:bg-glass-2 hover:text-text-primary"
                    }`}
                  >
                    <span className={`shrink-0 ${active ? "text-brand" : "text-text-tertiary"}`}>
                      {active ? <Check className="h-4 w-4" /> : <FolderSymlink className="h-4 w-4" />}
                    </span>
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="shrink-0 text-xs text-text-tertiary">{s.scan_label}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* 右侧：2 · 目标工具 + 3 · 方式 */}
          <div className="min-w-0 flex-1 space-y-6 overflow-y-auto p-5">
            <section className="space-y-2.5">
              <StepHeader n={2} title="选择目标工具" hint="只有启用且路径存在的工具可作为落点" />
              {toolsLoading ? (
                <p className="flex items-center gap-2 text-xs text-text-tertiary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载工具清单…
                </p>
              ) : tools.length === 0 ? (
                <p className="text-xs text-text-tertiary">
                  没有可链接的外部工具。请先在设置中启用工具路径。
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {tools.map((t) => (
                    <Tip
                      key={t.id}
                      label={t.enabled ? (t.has_existing_dir ? "落点目录已存在" : "将新建落点目录") : "未启用"}
                    >
                      <button
                        type="button"
                        disabled={!t.enabled}
                        onClick={() => setToolId(t.id)}
                        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                          toolId === t.id
                            ? "border-brand bg-brand/10 font-medium text-brand ring-1 ring-brand/50"
                            : "border-stroke bg-glass text-text-secondary hover:border-stroke-hi"
                        }`}
                      >
                        {t.name}
                      </button>
                    </Tip>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2.5">
              <StepHeader n={3} title="选择方式" hint="链接共享同一份内容；复制各自维护；移动会收归原件" />
              <div className="space-y-2">
                {MODES.map((opt) => {
                  const Icon = opt.icon;
                  const disabled = opt.value === "move" && moveBlocked;
                  const active = mode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setMode(opt.value);
                        if (opt.value !== "move") setMoveConfirmed(false);
                      }}
                      className={`w-full rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        active
                          ? "border-brand bg-brand/10 ring-1 ring-brand/50"
                          : "border-stroke bg-glass hover:border-stroke-hi"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-brand" : "text-text-secondary"}`} />
                        <span className={`text-sm font-medium ${active ? "text-brand" : "text-text-primary"}`}>
                          {opt.label}
                        </span>
                      </div>
                      <p className="mt-1 pl-6 text-xs text-text-tertiary">
                        {disabled ? "内置技能不支持移动（原件在应用资源目录）" : opt.desc}
                      </p>
                    </button>
                  );
                })}
              </div>

              {collectionRoot && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-stroke bg-glass p-3 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={wholeCollection}
                    onChange={(e) => setWholeCollection(e.target.checked)}
                    className="mt-0.5 accent-[var(--brand)]"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 font-medium text-text-primary">
                      <Layers className="h-3.5 w-3.5 text-brand" />
                      引用整个合集「{selectedSkill?.parent_collection?.split(/[\\/]/).pop()}」
                    </span>
                    <span className="mt-0.5 block text-xs text-text-tertiary">
                      将把合集下所有技能一并{mode === "link" ? "链接" : mode === "copy" ? "复制" : "移动"}到目标工具。
                    </span>
                  </span>
                </label>
              )}

              {mode === "move" && !moveBlocked && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-400/50 bg-amber-400/10 p-3 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={moveConfirmed}
                    onChange={(e) => setMoveConfirmed(e.target.checked)}
                    className="mt-0.5 accent-amber-500"
                  />
                  <span>我已知晓：原件将从当前位置移入回收站</span>
                </label>
              )}
            </section>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-stroke px-5 py-4">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={!canSubmit || busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
