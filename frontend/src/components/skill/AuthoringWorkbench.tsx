import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CircleHelp,
  Columns2,
  Eye,
  FolderTree,
  Loader2,
  PanelLeft,
  PenLine,
  Save,
  ScrollText,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/common/Tip";
import { MarkdownPreview } from "@/components/common/MarkdownPreview";
import { FileTree } from "./FileTree";
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
import { generateSkillMdStream } from "@/lib/authoring-api";
import { loadLLMConfig } from "@/lib/llm-config";
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
 * 创作工作台（PLAN-08 精修第三轮）。
 * R3-1 「我的描述」改为左侧推拉抽屉（shadcn Sheet，非模态）：仅 做什么/何时用 两输入，
 *      删「由此生成描述」输出框（description 保存时由两字段自动派生）；AI 回显也只写这两项；
 * R3-2 整页不滚：h-dvh 列布局，编辑器/参考/流式 pane 全部内部滚动；
 * R3-3 内容参考 & AI 流式改为右侧并列辅助 pane（不再替换编辑器、不挤压左工作区）。
 * 继承：X1 沉浸顶；X4 AI 创作 Dialog + 流式 + 回显；X5 emoji 全链路。
 */
interface AuthoringWorkbenchProps {
  skill: Skill | null; // null = 新建态
  skills: Skill[]; // 内容参考候选（全局扫描结果，按 scan_label 分组）
  refresh: () => void;
  onOpenSettings: () => void;
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

/** 引导表单 → description（中文，「做什么。当何时用时。」，与 AI prompt 约定一致）。 */
function buildDesc(d: WbDraft): string {
  const purpose = d.purpose.trim().replace(/[。.!！]?\s*$/, "");
  if (!purpose) return "";
  const triggers = d.triggers
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .join("、");
  return triggers ? `${purpose}。当${triggers}时使用。` : `${purpose}。`;
}

/** description 反解析（X4 回显）：先按中文约定「X。当Y时使用。」，
 *  再回退英文/双语约定「X. Use when Y.」（兼容存量）。命中 → purpose/triggers；未命中 → null。 */
function reverseDesc(
  desc: string,
): { purpose: string; triggers: string } | null {
  const t = desc.trim();
  // 中文约定：X。当Y时使用。 / X。当Y时。
  const zh = t.match(/^(.+?)。当(.+?)时(?:使用)?。?$/);
  if (zh) {
    return {
      purpose: zh[1].trim(),
      triggers: zh[2]
        .split(/[、，,;；\/]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join("\n"),
    };
  }
  // 英文/双语约定：X. Use when Y.
  const en = t.match(/^(.+?)\.?\s+Use when\s+(.+?)\.?$/i);
  if (en) {
    return {
      purpose: en[1].trim(),
      triggers: en[2]
        .split(/\s*\/\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join("\n"),
    };
  }
  return null;
}

/** YAML 标量安全引号（emoji 直拼 frontmatter 用；含特殊字符/空 → JSON 引号）。 */
function yq(s: string): string {
  if (s === "" || /[:#]|["'\\]|^\s|\s$/.test(s)) return JSON.stringify(s);
  return s;
}

/** 步骤编号徽章。 */
function StepBadge({ n }: { n: number }) {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
      {n}
    </span>
  );
}

/** emoji 快选网格（X5），可再自定义输入。 */
const COMMON_EMOJI = [
  "✍️",
  "🧩",
  "🛠️",
  "🧪",
  "📦",
  "🔍",
  "🌐",
  "📊",
  "🤖",
  "📝",
  "⚡",
  "🔧",
  "🧠",
  "🚀",
  "🗂️",
  "🔔",
  "🎯",
  "📚",
  "🧮",
  "💾",
];

/** 写作准则（X6 问号悬浮内容）。 */
const GUIDELINES = (
  <div className="flex flex-col gap-1">
    <span>
      · description 一句话说清「做什么 + 何时用」——模型只凭它决定是否使用
    </span>
    <span>· 正文祈使句书写，不用第二人称</span>
    <span>· 长资料拆到 references/，正文保持精简</span>
    <span>· name 用 hyphen-case，与目录名一致</span>
  </div>
);

export function AuthoringWorkbench({
  skill,
  skills,
  refresh,
  onOpenSettings,
  onExit,
}: AuthoringWorkbenchProps) {
  const [current, setCurrent] = useState<Skill | null>(skill);
  const draftId = current?.id ?? "new";

  const [draft, setDraft] = useState<WbDraft>({ ...EMPTY_DRAFT });
  const [origFm, setOrigFm] = useState("");
  const [dirty, setDirty] = useState(false);
  const [stored, setStored] = useState<StoredDraft | null>(null);
  const [location, setLocation] = useState("authored");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [preview, setPreview] = useState<PreviewMode>("split");
  const [rightTab, setRightTab] = useState<"body" | "files">("body");
  const [busy, setBusy] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [refSkillId, setRefSkillId] = useState("");
  const [refContent, setRefContent] = useState("");
  // X4：AI 创作（顶栏按钮 + Dialog + 右侧流式预览）
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [stream, setStream] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamDone, setStreamDone] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [llmReady, setLlmReady] = useState(true);
  // 60s 未保存淡入「没灵感？试试 AI 创作」；保存成功重置
  const [aiHint, setAiHint] = useState(false);
  const [hintTick, setHintTick] = useState(0);
  // X5 emoji 快选 Popover
  const [emojiOpen, setEmojiOpen] = useState(false);
  // R3-1 左侧「我的描述」推拉抽屉（默认展开，可收起以最大化编辑区）
  const [descOpen, setDescOpen] = useState(true);
  // R4：主行 DOM 节点——抽屉 Portal 锚定进主行（absolute），与 Markdown 区水平对齐
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null);
  // R6：#2 右侧 AI 流式预览滚动容器——流式期间追随输出到底部（同翻译功能）
  const previewScrollRef = useRef<HTMLDivElement>(null);

  const dirtyRef = useRef(false);
  const setDirtyAll = useCallback((d: boolean) => {
    dirtyRef.current = d;
    setDirty(d);
  }, []);

  // 初始加载：磁盘内容 + 存量草稿检测 + LLM 配置探测
  useEffect(() => {
    setStored(loadDraft(draftId));
    if (!isMockMode()) {
      loadLLMConfig()
        .then((c) => setLlmReady(!!c.hasKey))
        .catch(() => setLlmReady(false));
    }
    if (current) {
      // R3-1：存量 description 反解析回显「做什么/何时用」，抽屉不空白
      const rev = reverseDesc(current.description);
      setDraft((d) => ({
        ...d,
        name: current.name,
        desc: current.description,
        emoji: current.emoji ?? "🧩",
        ...(rev ? { purpose: rev.purpose, triggers: rev.triggers } : {}),
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

  // 内容参考分组（全局 skills 按 scan_label）
  const refGroups = useMemo(() => {
    const m = new Map<string, Skill[]>();
    for (const s of skills) {
      const k = s.scan_label || "未分类";
      const arr = m.get(k) ?? [];
      arr.push(s);
      m.set(k, arr);
    }
    return [...m.entries()];
  }, [skills]);

  // 选中参考 → 只读加载 SKILL.md（右侧渲染）
  useEffect(() => {
    if (!refSkillId) {
      setRefContent("");
      return;
    }
    const s = skills.find((x) => x.id === refSkillId);
    if (!s) return;
    readSkillFile(s.source_path)
      .then(setRefContent)
      .catch(() => setRefContent("（读取失败）"));
  }, [refSkillId, skills]);

  const refName = useMemo(
    () => skills.find((s) => s.id === refSkillId)?.name ?? "",
    [skills, refSkillId],
  );

  // 60s 未保存淡入 AI 引导；保存成功重置计时
  useEffect(() => {
    setAiHint(false);
    const t = setTimeout(() => setAiHint(true), 60_000);
    return () => clearTimeout(t);
  }, [hintTick]);

  // R6：#2 流式跟随滚动——每次内容落地把预览容器钉到底部（同翻译功能）；
  // 流式结束后不再干预用户滚动。
  useEffect(() => {
    if (!streaming) return;
    const el = previewScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stream, streaming]);

  // X4：AI 流式生成（直出 SKILL.md 原文；右侧预览）
  const runAI = async () => {
    if (!aiTopic.trim() || streaming) return;
    setAiOpen(false);
    setRefSkillId(""); // 关参考，右栏让位给流式
    setRightTab("body");
    setPreview("preview");
    setStreaming(true);
    setStreamDone(false);
    setStream("");
    try {
      const { finishReason } = await generateSkillMdStream(
        aiTopic.trim(),
        draft,
        (d) => setStream((s) => s + d),
      );
      if (finishReason === "length") {
        toast.warning("模型输出被截断——换更短的主题重试");
      } else {
        setStreamDone(true);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  };

  // X4：应用到正文 + 表单回显（description 反解析）
  const applyStream = () => {
    const parts = splitFrontmatter(stream);
    if (parts) {
      const mName = parts.fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
      const mDesc = parts.fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
      const p: Partial<WbDraft> = { body: parts.body };
      if (mDesc) {
        p.desc = mDesc;
        const rev = reverseDesc(mDesc);
        if (rev) {
          p.purpose = rev.purpose;
          p.triggers = rev.triggers;
        } else {
          toast.info("已回填 description；做什么/何时用 未能自动拆分，可手改");
        }
      }
      if (!current && mName) p.name = mName;
      patch(p);
    } else {
      patch({ body: stream });
      toast.warning("流式输出无 frontmatter——全文当 body 应用");
    }
    setStream("");
    setStreamDone(false);
    toast.success("已应用到正文");
  };

  // 草稿兜底：dirty 变更同步写 localStorage
  const patch = useCallback(
    (p: Partial<WbDraft>) => {
      setDraft((d) => {
        const next = { ...d, ...p };
        storeDraft(draftId, next);
        return next;
      });
      setDirtyAll(true);
    },
    [draftId, setDirtyAll],
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
    // R3-1：description 无独立输入——保存时由「做什么/何时用」自动派生，兜底存量 desc
    const desc = buildDesc(draft) || draft.desc;
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
          const r = await skillNew({
            name,
            description: desc,
            emoji: draft.emoji,
          });
          dir = r.skill_dir;
          // X5：恒写 SKILL.md（含 emoji），空 body 落占位，保证 emoji/description 落盘
          const bodyText = draft.body.trim()
            ? draft.body
            : `# ${name}\n\nTODO: 在此补全正文。\n`;
          await skillWriteFile(
            dir,
            "SKILL.md",
            `---\nname: ${name}\ndescription: ${
              desc || "TODO: describe what this skill does and when to use it"
            }\nemoji: ${yq(draft.emoji || "🧩")}\n---\n${bodyText}`,
          );
        } else {
          const r = await skillCommitDraft(location, {
            name,
            description: desc,
            emoji: draft.emoji,
            body: draft.body,
          });
          dir = r.skill_dir;
        }
        clearDraft("new");
        setDirtyAll(false);
        setHintTick((t) => t + 1);
        toast.success(`技能 ${name} 已创建（${location}）`);
        refresh();
        const all = await scanSkills();
        const found =
          all.find((s) => s.skill_dir === dir) ??
          all.find((s) => s.name === name);
        if (found) {
          setCurrent(found);
          setStored(null);
          setOrigFm(
            `name: ${found.name}\ndescription: ${found.description}\nemoji: ${found.emoji ?? "🧩"}`,
          );
        }
      } else {
        // 编辑态保存
        const fm = origFm || `name: ${current.name}\ndescription: ${desc}`;
        await skillWriteFile(
          current.skill_dir,
          "SKILL.md",
          `---\n${fm}\n---\n${draft.body}`,
        );
        if (desc !== current.description) {
          await skillEditFrontmatter(current.skill_dir, [
            { key: "description", op: "set", value: desc },
          ]);
        }
        if (draft.emoji !== (current.emoji ?? "🧩")) {
          await skillEditFrontmatter(current.skill_dir, [
            { key: "emoji", op: "set", value: draft.emoji || "🧩" },
          ]);
        }
        clearDraft(current.id);
        setDirtyAll(false);
        setHintTick((t) => t + 1);
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

  // R3-2：预览 pane 内部滚动（min-h-0 破除 flex/grid 子项 min-height:auto 撑高）
  const previewPane = useMemo(
    () => (
      <div className="h-full min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-4">
        <MarkdownPreview content={draft.body} />
      </div>
    ),
    [draft.body],
  );

  return (
    // R3-2：整页 h-dvh 列布局，页面不滚；pt-4(16)+顶栏 h-12(48)=64 → 抽屉 top-16 对齐
    <div className="flex h-dvh flex-col gap-3 py-4">
      {/* X1 顶栏：整页不滚后恒可见（保留 sticky 无害） */}
      <div className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-3 rounded-lg border border-border/40 bg-[var(--bg-0)]/85 px-3 backdrop-blur-xl">
        <Button variant="ghost" size="sm" onClick={handleBack}>
          <ArrowLeft className="h-3.5 w-3.5" />
          返回创作列表
        </Button>
        <div className="h-4 w-px bg-border/60" />
        {/* R3-1 抽屉开关：推拉「我的描述」 */}
        <Button
          size="sm"
          variant={descOpen ? "secondary" : "ghost"}
          aria-pressed={descOpen}
          onClick={() => setDescOpen((o) => !o)}
        >
          <PanelLeft className="h-3.5 w-3.5" />
          我的描述
        </Button>
        <div className="h-4 w-px bg-border/60" />
        {/* X5 emoji 控件 */}
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="选择技能 emoji"
              className="grid h-8 w-11 shrink-0 place-items-center rounded-md border border-input bg-transparent text-[18px] leading-none hover:bg-glass-2"
            >
              {draft.emoji || "🧩"}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-60">
            <div className="grid grid-cols-8 gap-1">
              {COMMON_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="grid h-7 w-7 place-items-center rounded text-base hover:bg-glass-2"
                  onClick={() => {
                    patch({ emoji: e });
                    setEmojiOpen(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            <Input
              value={draft.emoji}
              onChange={(e) => patch({ emoji: e.target.value })}
              className="mt-2 h-7 text-center text-sm"
              maxLength={10}
              placeholder="或输入（支持组合 emoji）"
            />
          </PopoverContent>
        </Popover>
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
              <span className="text-[11px] text-red-400">
                需小写字母数字 + 连字符
              </span>
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
        {/* X4 AI 创作按钮（保存按钮左侧） */}
        {aiHint && (
          <span className="animate-fade-in text-[11px] text-primary">
            没灵感 ? 试试 AI 创作
          </span>
        )}
        {llmReady ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={streaming}
            onClick={() => setAiOpen(true)}
          >
            <Sparkles className="h-3 w-3" />
            AI 创作
          </Button>
        ) : (
          <Tip
            side="bottom"
            label="未配置 LLM —— 点右侧齿轮到设置页填入 API Key"
          >
            <Button size="sm" variant="secondary" disabled>
              <Sparkles className="h-3 w-3" />
              AI 创作
            </Button>
          </Tip>
        )}
        {/* 设置入口（Topbar 沉浸隐藏后补偿，PLAN-08 §2.1） */}
        <Button
          variant="ghost"
          size="sm"
          aria-label="设置"
          onClick={onOpenSettings}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          disabled={busy || nameInvalid}
          onClick={() => void save()}
        >
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

      {/* 主体 R3：编辑列常显；左「我的描述」进 Sheet 抽屉（R3-1）；
          参考 / AI 流式进右侧辅助 pane（R3-3，不挤压编辑器）；全内部滚动（R3-2）。
          抽屉展开时主行 padding-left 推让 400px + 16px 间隙。 */}
      <div
        ref={(n) => {
          setRowEl(n);
        }}
        className={cn(
          // R5：relative 供抽屉 absolute 锚定；pl = 400(抽屉) + 16(右缝)；抽屉 left-0 与顶栏左缘同线
          "relative flex min-h-0 flex-1 gap-4 transition-[padding-left] duration-500 ease-in-out",
          descOpen && "pl-[416px]",
        )}
      >
        {/* 编辑列（不再被参考/流式替换） */}
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/* 工具条 tabs */}
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant={rightTab === "body" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setRightTab("body")}
            >
              正文
            </Button>
            <Button
              variant={rightTab === "files" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setRightTab("files")}
            >
              <FolderTree className="h-3 w-3" />
              附带资源
            </Button>
            {rightTab === "body" && (
              <div className="ml-2 flex items-center gap-1 border-l border-border/40 pl-2">
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
            )}
          </div>
          {rightTab === "files" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <FileTree skill={current} />
            </div>
          ) : (
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
                  className="h-full min-h-0 w-full flex-1 resize-none overflow-y-auto rounded-md border border-input bg-transparent p-3.5 font-mono text-[13px] leading-[1.7]"
                />
              )}
              {preview !== "edit" && previewPane}
            </div>
          )}
        </div>

        {/* 右侧辅助 pane（R3-3 并列不挤压；R3-2 内部滚动，页面不滚） */}
        {(refSkillId || streaming || streamDone) && (
          <aside className="flex h-full min-h-0 w-[42%] max-w-[620px] shrink-0 flex-col gap-3">
            {refSkillId ? (
              <div className="flex shrink-0 items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-text-secondary">
                <ScrollText className="h-3.5 w-3.5 text-primary" />
                <span className="truncate">
                  内容参考 · {refName} · 只读，不进草稿
                </span>
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setRefSkillId("")}
                >
                  <X className="h-3 w-3" />
                  关闭参考
                </Button>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-text-secondary">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>
                  {streaming
                    ? "AI 生成中… 流式预览（只读）"
                    : "AI 生成完成——内容已流式预览，可应用到正文"}
                </span>
                <div className="flex-1" />
                {streamDone && (
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() =>
                      draft.body.trim() ? setConfirmApply(true) : applyStream()
                    }
                  >
                    应用到正文
                  </Button>
                )}
              </div>
            )}
            <div
              // R6：#2 流式预览滚动容器（streaming 期间自动追随底部）
              ref={previewScrollRef}
              className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-glass-1 p-4"
            >
              <MarkdownPreview
                content={
                  refSkillId
                    ? refContent || "（读取中…）"
                    : stream + (streaming ? "\n▍" : "")
                }
              />
            </div>
          </aside>
        )}
      </div>

      {/* R5 左侧推拉抽屉：Portal 锚定主行内 absolute——四角圆；
          top-0 与工具条行齐平、left-0 与顶部吸附栏左缘同线、bottom-0 与编辑区底齐平；
          警告行在主行之上，永不被遮 */}
      {rowEl && (
        <Sheet open={descOpen} onOpenChange={setDescOpen} modal={false}>
          <SheetContent
            side="left"
            portalContainer={rowEl}
            overlayClassName="hidden"
            showCloseButton={false}
            // 推拉抽屉：点编辑区等外部不收起（复制正文不误触），仅顶栏按钮 / Esc 收起
            onInteractOutside={(e) => e.preventDefault()}
            className="absolute bottom-0 left-0 top-0 flex w-[400px] flex-col rounded-2xl border p-0 shadow-xl sm:max-w-[400px]"
          >
            <SheetHeader className="flex-row items-center justify-between px-5 pb-1 pt-4">
              <SheetTitle className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                <PenLine className="h-3.5 w-3.5 text-primary" />
                我的描述
              </SheetTitle>
              <Tip side="bottom" hoverOnly label={GUIDELINES}>
                <button
                  type="button"
                  aria-label="写作准则"
                  className="grid h-6 w-6 place-items-center rounded text-text-tertiary hover:bg-glass-2 hover:text-text-primary"
                >
                  <CircleHelp className="h-3.5 w-3.5" />
                </button>
              </Tip>
            </SheetHeader>
            <p className="px-5 text-[11px] text-text-tertiary">
              回答两个问题——保存时自动生成 frontmatter description；AI
              创作也只回显这两项。
            </p>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              {/* 做什么 */}
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <StepBadge n={1} />
                  <span className="text-xs font-medium text-text-primary">
                    做什么
                  </span>
                  <span className="text-[10px] text-red-400">*</span>
                </div>
                <textarea
                  value={draft.purpose}
                  onChange={(e) => patch({ purpose: e.target.value })}
                  placeholder="例：为 Spring Boot 项目生成规范的 changelog"
                  className="w-full resize-none rounded-md border border-input bg-transparent p-2.5 text-xs leading-relaxed"
                  rows={3}
                />
              </div>
              {/* 何时用 */}
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <StepBadge n={2} />
                  <span className="text-xs font-medium text-text-primary">
                    何时用
                  </span>
                  <span className="text-[10px] text-text-tertiary">
                    每行一条
                  </span>
                </div>
                <textarea
                  value={draft.triggers}
                  onChange={(e) => patch({ triggers: e.target.value })}
                  placeholder={
                    "例：\n用户要求整理 release notes\n提交历史需要汇总成变更日志"
                  }
                  className="w-full resize-none rounded-md border border-input bg-transparent p-2.5 text-xs leading-relaxed"
                  rows={5}
                />
              </div>
              {/* 内容参考（底部） */}
              <div className="mt-auto border-t border-border/40 pt-3">
                <div className="flex items-center gap-2">
                  <ScrollText className="h-3.5 w-3.5 text-primary" />
                  <h4 className="text-xs font-semibold text-text-primary">
                    内容参考
                  </h4>
                </div>
                <p className="mt-1 text-[11px] text-text-tertiary">
                  看看成熟技能怎么写——只读，渲染在右侧辅助 pane，不进草稿。
                </p>
                <div className="mt-2">
                  <Select
                    value={refSkillId === "" ? undefined : refSkillId}
                    onValueChange={(v) => {
                      setRefSkillId(v);
                      setStream("");
                      setStreamDone(false);
                    }}
                    disabled={streaming}
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue placeholder="选一个技能查看其 SKILL.md（右侧辅助 pane）" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {refGroups.map(([label, arr]) => (
                        <SelectGroup key={label}>
                          <SelectLabel>{label}</SelectLabel>
                          {arr.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.emoji || "🧩"} {s.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* X4 AI 创作 Dialog */}
      <Dialog open={aiOpen} onOpenChange={(o) => !o && setAiOpen(false)}>
        <DialogContent className="max-w-md border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI 创作
            </DialogTitle>
          </DialogHeader>
          <div className="p-1">
            <div className="mb-1.5 text-xs text-muted-foreground">
              描述你需要的 skill（「我的描述」内容会一并作为上下文）
            </div>
            <textarea
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              placeholder="例：为 Spring Boot 项目生成规范的 changelog"
              className="w-full resize-none rounded-md border border-input bg-transparent p-2.5 text-xs leading-relaxed"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAiOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              disabled={!aiTopic.trim() || streaming}
              onClick={() => void runAI()}
            >
              <Sparkles className="h-3 w-3" />
              生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 应用 AI 结果确认（body 非空时） */}
      <Dialog
        open={confirmApply}
        onOpenChange={(o) => !o && setConfirmApply(false)}
      >
        <DialogContent className="max-w-sm border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>替换当前正文？</DialogTitle>
          </DialogHeader>
          <p className="p-1 text-xs leading-relaxed text-muted-foreground">
            应用 AI 结果会替换当前 body（草稿兜底仍保留旧内容，可恢复）。
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmApply(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => {
                applyStream();
                setConfirmApply(false);
              }}
            >
              替换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 返回保护 */}
      <Dialog
        open={confirmExit}
        onOpenChange={(o) => !o && setConfirmExit(false)}
      >
        <DialogContent className="max-w-sm border-border/60 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>有未保存改动</DialogTitle>
          </DialogHeader>
          <p className="p-1 text-xs leading-relaxed text-muted-foreground">
            草稿已自动兜底到本地——直接返回后，下次进入可恢复。
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmExit(false)}
            >
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
