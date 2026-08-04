import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search, FolderSymlink, Copy, FolderInput } from "lucide-react";
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
import {
  hubLinkSkill,
  hubLinkableTools,
  type LinkMode,
  type LinkableTool,
} from "@/lib/api";
import type { Skill } from "@/hooks/useSkills";
import { collectionDisplayName } from "@/hooks/useSkills";

interface LinkDialogProps {
  /** 全部技能（来源候选；孤儿条目自动排除） */
  skills: Skill[];
  /** 从详情页进入时预选的技能 id */
  initialSkillId?: string | null;
  onClose: () => void;
  /** 引用成功后回调（父级刷新扫描） */
  onLinked: () => void;
}

const MODE_OPTIONS: {
  value: LinkMode;
  label: string;
  icon: typeof FolderSymlink;
  desc: string;
}[] = [
  {
    value: "link",
    label: "链接（推荐）",
    icon: FolderSymlink,
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
    icon: FolderInput,
    desc: "复制到目标工具后，原件移入回收站。适合把散落的技能收拢到单一出处。",
  },
];

/**
 * 新建引用对话框（PLAN-06 §2.8）：选技能 → 选目标工具 → 选方式（link/copy/move）。
 * 安全边界由后端强制：落点只能是注册表 linkable 工具的 skills 目录；
 * 同名冲突 / 重复引用一律报错不覆盖。
 */
export function LinkDialog({ skills, initialSkillId, onClose, onLinked }: LinkDialogProps) {
  const [tools, setTools] = useState<LinkableTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [query, setQuery] = useState("");
  const [skillId, setSkillId] = useState<string | null>(initialSkillId ?? null);
  const [toolId, setToolId] = useState<string | null>(null);
  const [mode, setMode] = useState<LinkMode>("link");
  const [moveConfirmed, setMoveConfirmed] = useState(false);
  // 集合级引用（§2.8）：选中合集内技能时可选「引用整个合集」
  const [wholeCollection, setWholeCollection] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hubLinkableTools()
      .then((list) => {
        if (cancelled) return;
        setTools(list);
        // 默认选中第一个已启用的工具
        const firstEnabled = list.find((t) => t.enabled);
        if (firstEnabled) setToolId(firstEnabled.id);
      })
      .catch((e) => toast.error(`加载工具列表失败：${String(e)}`))
      .finally(() => !cancelled && setLoadingTools(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // 来源候选：排除孤儿（无源文件）
  const candidates = useMemo(
    () => skills.filter((s) => !s.source_deleted),
    [skills]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.title_zh.toLowerCase().includes(q) ||
        s.folder_name.toLowerCase().includes(q) ||
        s.scan_label.toLowerCase().includes(q)
    );
  }, [candidates, query]);

  const selectedSkill = useMemo(
    () => candidates.find((s) => s.id === skillId) ?? null,
    [candidates, skillId]
  );
  const selectedTool = useMemo(
    () => tools.find((t) => t.id === toolId) ?? null,
    [tools, toolId]
  );

  // 集合根目录：skill_dir = <集合根>/<folder_name>，剥掉末段即得。
  // 结构不符（末段 ≠ folder_name）时返回 null，集合级入口自动隐藏。
  const collectionRoot = useMemo(() => {
    const s = selectedSkill;
    if (!s?.parent_collection || !s.skill_dir) return null;
    const norm = s.skill_dir.replace(/[\\/]+$/, "");
    const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
    if (idx <= 0) return null;
    if (norm.slice(idx + 1).toLowerCase() !== s.folder_name.toLowerCase()) return null;
    return norm.slice(0, idx);
  }, [selectedSkill]);

  // 内置技能不支持「移动」：原件位于应用资源目录，移走无意义且可能被更新恢复
  const moveBlocked = selectedSkill?.tool_id === "builtin";

  const canSubmit =
    !busy &&
    !!selectedSkill &&
    !!selectedTool &&
    selectedTool.enabled &&
    (mode !== "move" || (moveConfirmed && !moveBlocked));

  const handleSubmit = async () => {
    if (!selectedSkill || !selectedTool || !canSubmit) return;
    // 来源目录：集合级 → 合集根（§2.8）；单技能 → skill_dir（扫描锚点，junction 落点不穿透）；
    // 兜底从 source_path 反推
    const singleDir =
      selectedSkill.skill_dir ||
      selectedSkill.source_path.replace(/[\\/]+SKILL\.md$/i, "");
    const dir = wholeCollection && collectionRoot ? collectionRoot : singleDir;
    setBusy(true);
    try {
      const link = await hubLinkSkill({
        sourcePath: dir,
        targetToolId: selectedTool.id,
        mode,
      });
      toast.success(
        `已${mode === "link" ? "链接" : mode === "copy" ? "复制" : "移动"}「${link.skill_name}」到 ${selectedTool.name}`
      );
      onLinked();
      onClose();
    } catch (e) {
      toast.error(`引用失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>引用技能到工具</DialogTitle>
          <DialogDescription>
            把技能链接 / 复制到 AI 工具的 skills 目录，让对应工具能发现它。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          {/* 1. 选技能 */}
          <section>
            <p className="mb-2 text-[12.5px] font-medium text-text-secondary">
              1 · 选择技能
            </p>
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索技能名…"
                className="pl-8"
              />
            </div>
            <div className="max-h-[180px] space-y-1 overflow-y-auto rounded-lg border border-stroke bg-glass p-1.5">
              {filtered.length === 0 && (
                <p className="px-2 py-3 text-center text-[12px] text-text-tertiary">
                  没有匹配的技能
                </p>
              )}
              {filtered.map((s) => {
                const active = skillId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSkillId(s.id);
                      setWholeCollection(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors ${
                      active
                        ? "bg-glass-2 text-text-primary"
                        : "text-text-secondary hover:bg-glass-2/60"
                    }`}
                  >
                    <span className="shrink-0">{s.emoji || "🧩"}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {s.title_zh || s.name}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-text-tertiary">
                      {s.scan_label}
                    </span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-brand" />}
                  </button>
                );
              })}
            </div>

            {/* 集合级引用（PLAN-06 §2.8）：选中合集内技能时可选引用整个合集 */}
            {collectionRoot && selectedSkill?.parent_collection && (
              <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-stroke bg-glass px-3 py-2 text-[12px] text-text-secondary transition-colors hover:border-stroke-hi">
                <input
                  type="checkbox"
                  checked={wholeCollection}
                  onChange={(e) => setWholeCollection(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--brand)]"
                />
                <span>
                  引用整个合集「{collectionDisplayName(selectedSkill.parent_collection)}」
                  <span className="block text-[11px] text-text-tertiary">
                    将把合集下所有技能一并{mode === "link" ? "链接" : mode === "copy" ? "复制" : "移动"}到目标工具
                  </span>
                </span>
              </label>
            )}
          </section>

          {/* 2. 选目标工具 */}
          <section>
            <p className="mb-2 text-[12.5px] font-medium text-text-secondary">
              2 · 选择目标工具
            </p>
            {loadingTools ? (
              <p className="flex items-center gap-1.5 text-[12px] text-text-tertiary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载中…
              </p>
            ) : tools.length === 0 ? (
              <p className="text-[12px] text-text-tertiary">
                没有可链接的外部工具。请先在设置中启用工具路径。
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tools.map((t) => {
                  const active = toolId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={!t.enabled}
                      onClick={() => setToolId(t.id)}
                      title={
                        !t.enabled
                          ? "该工具已在设置中停用"
                          : !t.has_existing_dir
                            ? "skills 目录尚不存在，将自动新建"
                            : undefined
                      }
                      className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors ${
                        active
                          ? "border-stroke-hi bg-glass-2 text-text-primary"
                          : "border-stroke bg-glass text-text-secondary hover:border-stroke-hi"
                      } ${!t.enabled ? "cursor-not-allowed opacity-45" : ""}`}
                    >
                      {t.name}
                      {!t.enabled && <span className="ml-1 text-[10.5px] text-text-tertiary">（已停用）</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedTool && !selectedTool.has_existing_dir && (
              <p className="mt-1.5 text-[11.5px] text-text-tertiary">
                该工具的 skills 目录尚不存在，引用时将自动创建。
              </p>
            )}
          </section>

          {/* 3. 选方式 */}
          <section>
            <p className="mb-2 text-[12.5px] font-medium text-text-secondary">
              3 · 选择方式
            </p>
            <div className="space-y-1.5">
              {MODE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const disabled = opt.value === "move" && moveBlocked;
                const active = mode === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => setMode(opt.value)}
                    className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                      active
                        ? "border-stroke-hi bg-glass-2"
                        : "border-stroke bg-glass hover:border-stroke-hi"
                    } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium text-text-primary">
                        {opt.label}
                      </span>
                      <span className="block text-[11.5px] leading-relaxed text-text-tertiary">
                        {disabled ? "内置技能不支持移动（原件在应用资源目录）" : opt.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {mode === "move" && !moveBlocked && (
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={moveConfirmed}
                  onChange={(e) => setMoveConfirmed(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--brand)]"
                />
                我已知晓：原件将从当前位置移入回收站
              </label>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === "link" ? "创建链接" : mode === "copy" ? "复制" : "移动"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
