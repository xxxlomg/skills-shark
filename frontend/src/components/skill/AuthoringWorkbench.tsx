import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Columns2,
  Eye,
  Loader2,
  PenLine,
  Save,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tip } from "@/components/common/Tip";
import { MarkdownPreview } from "@/components/common/MarkdownPreview";
import {
  hubListTools,
  readSkillFile,
  scanSkills,
  skillCommitDraft,
  skillEditFrontmatter,
  skillNew,
  skillWriteFile,
  type Skill,
  type ToolInfo,
} from "@/lib/api";
import { isMockMode, MOCK_TOOLS } from "@/mock";
import {
  EMPTY_DRAFT,
  NAME_RE,
  clearDraft,
  fmtSavedAt,
  loadDraft,
  storeDraft,
  type StoredDraft,
  type WbDraft,
} from "@/lib/wb-draft";

/**
 * PLAN-07 W1/W2：创作工作台。
 * - 全页沉浸态（App 层隐藏 StatBar/TabNav）；
 * - 顶栏：返回 / name（新建可编辑+hyphen-case 实时校验；编辑态只读）/ 落点（新建态，shadcn Select）/ 未保存圆点 / 保存；
 * - Ctrl+S = 保存（仅 mount 期间挂载监听）；
 * - 草稿 localStorage 兜底：dirty 变更同步写入；进入时有存量草稿 → 三态恢复横幅；
 * - 返回保护：dirty → 确认（保存并返回 / 直接返回）；
 * - 左栏：步骤化引导表单（W2）——①做什么 ②何时用 + 折叠可选区 + description 生成。
 */
interface AuthoringWorkbenchProps {
  skill: Skill | null; // null = 新建态
  refresh: () => void;
  onExit: () => void;
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

/** 引导表单 → description（英文，「做什么 + 何时用」）。 */
function buildDesc(d: WbDraft): string {
  const purpose = d.purpose.trim().replace(/\.\s*$/, "");
  if (!purpose) return "";
  const triggers = d.triggers
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" / ");
  return triggers ? `${purpose}. Use when ${triggers}.` : `${purpose}.`;
}

/** 步骤编号徽章。 */
function StepBadge({ n }: { n: number }) {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
      {n}
    </span>
  );
}

export function AuthoringWorkbench({ skill, refresh, onExit }: AuthoringWorkbenchProps) {
  const [current, setCurrent] = useState<Skill | null>(skill);
  const draftId = current?.id ?? "new";

  const [draft, setDraft] = useState<WbDraft>({ ...EMPTY_DRAFT });
  const [origFm, setOrigFm] = useState("");
  const [dirty, setDirty] = useState(false);
  const [stored, setStored] = useState<StoredDraft | null>(null);
  const [location, setLocation] = useState("authored");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [preview, setPreview] = useState<PreviewMode>("split");
  const [busy, setBusy] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [optOpen, setOptOpen] = useState(false);

  const dirtyRef = useRef(false);
  const setDirtyAll = useCallback((d: boolean) => {
    dirtyRef.current = d;
    setDirty(d);
  }, []);

  // 初始加载：磁盘内容 + 存量草稿检测
  useEffect(() => {
    setStored(loadDraft(draftId));
    if (current) {
      setDraft((d) => ({
        ...d,
        name: current.name,
        desc: current.description,
      }));
      readSkillFile(current.source_path)
        .then((md) => {
          const parts = splitFrontmatter(md);
          if (parts) {
            setOrigFm(parts.fm);
            setDraft((d) => ({ ...d, body: parts.body }));
          } else {
            setDraft((d) => ({ ...d, body: md }));
          }
        })
        .catch(() => toast.error("读取 SKILL.md 失败"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 落点候选（新建态）
  useEffect(() => {
    if (current) return;
    if (isMockMode()) {
      setTools(MOCK_TOOLS.filter((t) => !t.app_owned && t.enabled));
      return;
    }
    hubListTools()
      .then((ts) => setTools(ts.filter((t) => !t.app_owned && t.enabled)))
      .catch(() => setTools([]));
  }, [current]);

  // 草稿兜底：dirty 变更同步写 localStorage（KB 级，无窗口）
  const patch = useCallback(
    (p: Partial<WbDraft>) => {
      setDraft((d) => {
        const next = { ...d, ...p };
        storeDraft(draftId, next);
        return next;
      });
      setDirtyAll(true);
    },
    [draftId, setDirtyAll]
  );

  // Ctrl+S（仅 mount 期间）
  const saveRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nameInvalid = !current && !!draft.name && !NAME_RE.test(draft.name);

  const save = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!current) {
        // 首存 = 创建
        const name = draft.name.trim();
        if (!NAME_RE.test(name)) {
          toast.error("name 必须 hyphen-case（小写字母数字 + 连字符）");
          return;
        }
        let dir: string;
        if (location === "authored") {
          const r = await skillNew({ name, description: draft.desc });
          dir = r.skill_dir;
          if (draft.body.trim()) {
            await skillWriteFile(
              dir,
              "SKILL.md",
              `---\nname: ${name}\ndescription: ${
                draft.desc || "TODO: describe what this skill does and when to use it"
              }\n---\n${draft.body}`
            );
          }
        } else {
          const r = await skillCommitDraft(location, {
            name,
            description: draft.desc,
            body: draft.body,
          });
          dir = r.skill_dir;
        }
        clearDraft("new");
        setDirtyAll(false);
        toast.success(`技能 ${name} 已创建（${location}）`);
        refresh();
        // 切编辑态：拉最新扫描找新技能
        const all = await scanSkills();
        const found =
          all.find((s) => s.skill_dir === dir) ?? all.find((s) => s.name === name);
        if (found) {
          setCurrent(found);
          setStored(null);
          setOrigFm(`name: ${found.name}\ndescription: ${found.description}`);
        }
      } else {
        // 编辑态保存
        const fm = origFm || `name: ${current.name}\ndescription: ${draft.desc}`;
        await skillWriteFile(
          current.skill_dir,
          "SKILL.md",
          `---\n${fm}\n---\n${draft.body}`
        );
        if (draft.desc !== current.description) {
          await skillEditFrontmatter(current.skill_dir, [
            { key: "description", op: "set", value: draft.desc },
          ]);
        }
        clearDraft(current.id);
        setDirtyAll(false);
        toast.success("已保存（Ctrl+S 等效）");
        refresh();
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      toast.error(raw === "EXISTS" ? "同名技能已存在，请换一个 name" : raw);
    } finally {
      setBusy(false);
    }
  }, [busy, current, draft, location, origFm, refresh, setDirtyAll]);

  useEffect(() => {
    saveRef.current = () => void save();
  }, [save]);

  const handleBack = () => {
    if (dirtyRef.current) setConfirmExit(true);
    else onExit();
  };

  const previewPane = useMemo(
    () => (
      <div className="min-h-[240px] flex-1 overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-4">
        <MarkdownPreview content={draft.body} />
      </div>
    ),
    [draft.body]
  );

  return (
    <div className="flex min-h-[70vh] flex-col gap-4 py-6">
      {/* 顶栏 */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          返回创作列表
        </Button>
        <div className="h-4 w-px bg-border/60" />
        {current ? (
          <Tip label="编辑态 name 只读——改名回列表用卡片菜单（将同步重命名目录）">
            <span className="font-display text-[15px] font-semibold text-text-primary">
              {current.name}
            </span>
          </Tip>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="skill 名称（hyphen-case）"
              className="h-8 w-56 font-mono text-[13px]"
            />
            {nameInvalid && (
              <span className="text-[11px] text-red-400">需小写字母数字 + 连字符</span>
            )}
          </div>
        )}
        {!current && (
          <Select value={location} onValueChange={setLocation}>
            <SelectTrigger size="sm" className="min-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="authored">落点：创作库（authored）</SelectItem>
              {tools.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  落点：{t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex-1" />
        {dirty && (
          <Tip label="有未保存改动（草稿已自动兜底）">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
          </Tip>
        )}
        <Button size="sm" disabled={busy || nameInvalid} onClick={() => void save()}>
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          <Save className="h-3 w-3" />
          保存
        </Button>
      </div>

      {/* 草稿恢复横幅（三态） */}
      {stored && (
        <div className="flex items-center gap-3 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-text-secondary">
          <span>检测到未保存草稿（{fmtSavedAt(stored.savedAt)} 保存）</span>
          <div className="flex-1" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDraft(stored.draft);
              setDirtyAll(true);
              setStored(null);
            }}
          >
            恢复草稿
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setStored(null)}>
            用磁盘内容
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400"
            onClick={() => {
              clearDraft(draftId);
              setStored(null);
            }}
          >
            丢弃草稿
          </Button>
        </div>
      )}

      {/* 主体：左栏引导表单 + 右栏编辑器 */}
      <div className="grid flex-1 gap-4 lg:grid-cols-[38fr_62fr]">
        <div className="flex flex-col gap-3">
          <div className="glass-card p-5">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
              <PenLine className="h-3.5 w-3.5 text-primary" />
              我的描述
            </h3>
            <p className="mt-1 text-[11px] text-text-tertiary">
              回答两个问题即可生成 description，可选项收在折叠里。
            </p>

            <div className="mt-4 flex flex-col gap-4">
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <StepBadge n={1} />
                  <span className="text-xs font-medium text-text-primary">做什么</span>
                  <span className="text-[10px] text-red-400">*</span>
                </div>
                <textarea
                  value={draft.purpose}
                  onChange={(e) => patch({ purpose: e.target.value })}
                  placeholder="例：为 Spring Boot 项目生成规范的 changelog"
                  className="w-full resize-none rounded-md border border-input bg-transparent p-2.5 text-xs leading-relaxed"
                  rows={2}
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <StepBadge n={2} />
                  <span className="text-xs font-medium text-text-primary">何时用</span>
                  <span className="text-[10px] text-text-tertiary">每行一条</span>
                </div>
                <textarea
                  value={draft.triggers}
                  onChange={(e) => patch({ triggers: e.target.value })}
                  placeholder={"例：\n用户要求整理 release notes\n提交历史需要汇总成变更日志"}
                  className="w-full resize-none rounded-md border border-input bg-transparent p-2.5 text-xs leading-relaxed"
                  rows={3}
                />
              </div>

              {/* 可选区：折叠 */}
              <div className="rounded-md border border-border/40 bg-glass-1/60">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-text-secondary hover:text-text-primary"
                  onClick={() => setOptOpen((v) => !v)}
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${optOpen ? "" : "-rotate-90"}`}
                  />
                  可选 · 步骤概要与附带资源
                </button>
                {optOpen && (
                  <div className="flex flex-col gap-3 px-3 pb-3">
                    <textarea
                      value={draft.steps}
                      onChange={(e) => patch({ steps: e.target.value })}
                      placeholder={"步骤概要，每行一步：\n读取 git log\n按 feat/fix 分类\n输出 markdown"}
                      className="w-full resize-none rounded-md border border-input bg-transparent p-2.5 text-xs leading-relaxed"
                      rows={3}
                    />
                    <div className="flex gap-3 text-[11px] text-text-secondary">
                      {(
                        [
                          ["scripts", "scripts/"],
                          ["references", "references/"],
                          ["assets", "assets/"],
                        ] as const
                      ).map(([k, label]) => (
                        <label key={k} className="flex cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={draft.resources[k]}
                            onChange={(e) =>
                              patch({
                                resources: { ...draft.resources, [k]: e.target.checked },
                              })
                            }
                            className="h-3 w-3 accent-[var(--brand)]"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 生成结果 */}
              <div className="border-t border-border/40 pt-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!draft.purpose.trim()}
                    onClick={() => {
                      patch({ desc: buildDesc(draft) });
                      toast.success("description 已生成——可继续微调");
                    }}
                  >
                    <Sparkles className="h-3 w-3" />
                    由此生成描述
                  </Button>
                  <span className="text-[10px] text-text-tertiary">英文 ·「做什么 + 何时用」</span>
                </div>
                <textarea
                  value={draft.desc}
                  onChange={(e) => patch({ desc: e.target.value })}
                  placeholder="生成结果会出现在这里，写入 frontmatter description"
                  className="mt-2 w-full resize-none rounded-md border border-input bg-transparent p-2.5 font-mono text-[11px] leading-relaxed"
                  rows={3}
                />
              </div>
            </div>
          </div>

          <div className="glass-card p-5">
            <h3 className="mb-2.5 text-[13px] font-semibold text-text-primary">写作准则</h3>
            <ul className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-text-tertiary">
              <li>· description 一句话说清「做什么 + 何时用」——模型只凭它决定是否使用</li>
              <li>· 正文祈使句书写，不用第二人称</li>
              <li>· 长资料拆到 references/，正文保持精简</li>
              <li>· name 用 hyphen-case，与目录名一致</li>
            </ul>
          </div>
        </div>

        <div className="flex min-h-[420px] flex-col gap-3">
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
                value={draft.body}
                onChange={(e) => patch({ body: e.target.value })}
                className="w-full flex-1 resize-none rounded-md border border-input bg-transparent p-3.5 font-mono text-[13px] leading-[1.7]"
              />
            )}
            {preview !== "edit" && previewPane}
          </div>
        </div>
      </div>

      {/* 返回保护 */}
      <Dialog open={confirmExit} onOpenChange={(o) => !o && setConfirmExit(false)}>
        <DialogContent className="max-w-sm border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>有未保存改动</DialogTitle>
          </DialogHeader>
          <p className="p-1 text-xs leading-relaxed text-muted-foreground">
            草稿已自动兜底到本地——直接返回后，下次进入可恢复。
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirmExit(false)}>
              取消
            </Button>
            <Button variant="ghost" size="sm" onClick={onExit}>
              直接返回
            </Button>
            <Button
              size="sm"
              disabled={busy || nameInvalid}
              onClick={() => {
                void save().then(() => onExit());
              }}
            >
              保存并返回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
