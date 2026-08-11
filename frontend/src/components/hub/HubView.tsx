import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  FolderSymlink,
  Link2Off,
  CopyPlus,
  RefreshCw,
  Loader2,
  Plus,
  MoveUpRight,
  MapPin,
  ListFilter,
  MoreVertical,
  ArrowRight,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { winPath } from "@/lib/path";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Tip } from "@/components/common/Tip";
import { GhostCard } from "@/components/common/GhostCard";
import { EmptyPanel } from "@/components/common/EmptyPanel";
import { SectionHead } from "@/components/common/SectionHead";
import { LayoutToggle } from "@/components/skill/LayoutToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { LayoutMode } from "@/hooks/useSkills";
import {
  hubConvertToCopy,
  hubLinksStatus,
  hubLinkableTools,
  hubLinkSkill,
  hubUnlinkSkill,
  type LinkStatus,
} from "@/lib/api";

interface HubViewProps {
  /** 打开新建引用对话框（对话框由 App 统一持有） */
  onOpenLink: () => void;
  /** 磁盘变更后刷新技能列表（App 的 refresh） */
  onSkillsRefresh: () => Promise<void> | void;
  /** 建链成功等外部变更令牌：变化时重取台账（修复 dialog 建链后台账不刷新） */
  refreshToken?: number;
  layout: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
}

const HEALTH_META: Record<
  LinkStatus["health"],
  { label: string; cls: string; dot: string }
> = {
  normal: {
    label: "正常",
    cls: "text-text-secondary",
    dot: "bg-emerald-400",
  },
  missing: {
    label: "落点缺失",
    cls: "text-amber-500",
    dot: "bg-amber-400",
  },
  orphaned: {
    label: "孤儿",
    cls: "text-red-400",
    dot: "bg-red-400",
  },
};

/** P9：台账统一筛选（类型 / 状态 / 落点工具，空集合 = 不过滤） */
type ModeKind = LinkStatus["mode"];
type HealthFilter = "normal" | "abnormal";

/** 筛选面板里的可勾选小片 */
function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-[3px] text-[11.5px] transition-colors ${
        active
          ? "border-brand/50 bg-brand/10 font-medium text-brand"
          : "border-stroke bg-glass text-text-secondary hover:bg-glass-2 hover:text-text-primary"
      }`}
    >
      {label}
    </button>
  );
}

/** 筛选弹层内的一个维度分组：小号大写字标签 + 可勾选片 */
function FilterSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/**
 * Hub 页（PLAN-06 §2.7/§2.8）：引用台账总览 + 全模式操作。
 * 账本（links.json）是索引，文件系统是真相；诊断由后端 hub_links_status 逐条对账。
 * 与技能库 / Packs 一致，支持卡片（grid）/ 列表（list）两种布局。
 */
export function HubView({
  onOpenLink,
  onSkillsRefresh,
  refreshToken,
  layout,
  onLayoutChange,
}: HubViewProps) {
  const [statuses, setStatuses] = useState<LinkStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  // 待确认操作：解除 / 转副本 / 重建
  const [pending, setPending] = useState<
    | { kind: "unlink"; link: LinkStatus }
    | { kind: "convert"; link: LinkStatus }
    | { kind: "rebuild"; link: LinkStatus }
    | null
  >(null);
  // P9：台账统一筛选（类型 / 状态 / 落点工具；空集合 = 不过滤）
  const [fMode, setFMode] = useState<Set<ModeKind>>(new Set());
  const [fHealth, setFHealth] = useState<Set<HealthFilter>>(new Set());
  const [fTools, setFTools] = useState<Set<string>>(new Set());

  const toggleSet = useCallback(
    <T,>(
      value: T,
      updater: (action: Set<T> | ((prev: Set<T>) => Set<T>)) => void
    ) => {
      updater((prev) => {
        const next = new Set(prev);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    },
    []
  );
  const clearAllFilters = useCallback(() => {
    setFMode(new Set());
    setFHealth(new Set());
    setFTools(new Set());
  }, []);

  const refreshStatuses = useCallback(async () => {
    try {
      setStatuses(await hubLinksStatus());
    } catch (e) {
      toast.error(`加载引用状态失败：${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatuses();
  }, [refreshStatuses, refreshToken]);

  // tool_id → 显示名（linkable 清单覆盖所有可能的落点工具；缺失回退原始 id）
  const [toolNames, setToolNames] = useState<Record<string, string>>({});
  useEffect(() => {
    hubLinkableTools()
      .then((list) => {
        const map: Record<string, string> = {};
        for (const t of list) map[t.id] = t.name;
        setToolNames(map);
      })
      .catch(() => {
        /* 名称映射失败不阻塞主流程，显示原始 id */
      });
  }, []);

  const abnormalCount = useMemo(
    () => statuses.filter((s) => s.health !== "normal").length,
    [statuses]
  );

  // P9：按统一筛选条件过滤后的台账（平铺，不再按工具分块）。
  // 与逻辑（AND）：每个已选 tag 都是独立谓词，条目须全部满足才显示——
  // 选中「链接」+「正常」= 正常链接；选中「链接」+「副本」= 无结果。
  const filtered = useMemo(
    () =>
      statuses.filter((s) => {
        for (const m of fMode) if (s.mode !== m) return false;
        for (const h of fHealth) {
          if (h === "normal" ? s.health !== "normal" : s.health === "normal")
            return false;
        }
        for (const t of fTools) if (s.target_tool !== t) return false;
        return true;
      }),
    [statuses, fMode, fHealth, fTools]
  );

  // 落点工具筛选项（去重 + 按显示名排序）
  const toolOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of statuses) set.add(s.target_tool);
    return [...set].sort((a, b) =>
      (toolNames[a] ?? a).localeCompare(toolNames[b] ?? b)
    );
  }, [statuses, toolNames]);

  const filterActiveCount = fMode.size + fHealth.size + fTools.size;

  /** 已启用筛选的标签（内联展示，点 × 单个移除） */
  const activeTags = useMemo(() => {
    const tags: { id: string; label: string; onRemove: () => void }[] = [];
    for (const m of fMode) {
      tags.push({
        id: `mode:${m}`,
        label: m === "link" ? "链接" : "副本",
        onRemove: () => toggleSet(m, setFMode),
      });
    }
    for (const h of fHealth) {
      tags.push({
        id: `health:${h}`,
        label: h === "normal" ? "正常" : "异常",
        onRemove: () => toggleSet(h, setFHealth),
      });
    }
    for (const t of fTools) {
      tags.push({
        id: `tool:${t}`,
        label: toolNames[t] ?? t,
        onRemove: () => toggleSet(t, setFTools),
      });
    }
    return tags;
  }, [fMode, fHealth, fTools, toolNames, toggleSet]);

  const doAction = useCallback(
    async (p: NonNullable<typeof pending>) => {
      setActingId(p.link.id);
      try {
        if (p.kind === "unlink") {
          await hubUnlinkSkill(p.link.id);
          toast.success(
            p.link.mode === "link"
              ? `已解除「${p.link.skill_name}」的链接（junction 已移除，出处内容不受影响）`
              : `已移除「${p.link.skill_name}」的账本记录（副本目录保留）`
          );
        } else if (p.kind === "convert") {
          await hubConvertToCopy(p.link.id);
          toast.success(`「${p.link.skill_name}」已转为独立副本，不再依赖出处`);
        } else {
          // 重建：清掉坏落点 + 以原出处重新建链（源缺失时后端会明确报错）
          await hubUnlinkSkill(p.link.id);
          await hubLinkSkill({
            sourcePath: p.link.source,
            targetToolId: p.link.target_tool,
            mode: "link",
          });
          toast.success(`「${p.link.skill_name}」的链接已重建`);
        }
        await Promise.all([refreshStatuses(), Promise.resolve(onSkillsRefresh())]);
      } catch (e) {
        toast.error(`操作失败：${String(e)}`);
        // 复合操作可能已部分生效，无条件重读状态
        await refreshStatuses();
      } finally {
        setActingId(null);
        setPending(null);
      }
    },
    [refreshStatuses, onSkillsRefresh]
  );

  /** 健康状态徽标：仅异常时显示（默认状态不刷存在感） */
  const healthChip = (s: LinkStatus) => {
    if (s.health === "normal") return null;
    const cls =
      s.health === "missing"
        ? "border-amber-300/60 bg-amber-400/10 text-amber-500"
        : "border-red-300/60 bg-red-400/10 text-red-400";
    return (
      <span className={`shrink-0 rounded-full border px-2 py-[1px] text-[10.5px] font-medium ${cls}`}>
        {HEALTH_META[s.health].label}
      </span>
    );
  };

  /** 卡片左缘状态色条：正常隐藏，异常上色（状态当信号，不强刷徽章墙） */
  const barCls = (s: LinkStatus) =>
    s.health === "normal"
      ? "border-l-2 border-l-transparent"
      : s.health === "missing"
        ? "border-l-2 border-l-amber-400"
        : "border-l-2 border-l-red-400";

  /** 操作 ⋯ 菜单（卡片 / 列表共用）：上下文相关，收掉底部一排裸按钮 */
  const renderMenu = (s: LinkStatus, busy: boolean) => {
    const isLink = s.mode === "link";
    const healthy = s.health === "normal";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="引用操作"
            disabled={busy}
            className="iconbtn h-7 w-7 rounded-md"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreVertical className="h-4 w-4" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[150px]">
          {isLink && healthy && (
            <DropdownMenuItem onSelect={() => setPending({ kind: "convert", link: s })}>
              <CopyPlus />
              转副本
            </DropdownMenuItem>
          )}
          {isLink && !healthy && (
            <DropdownMenuItem onSelect={() => setPending({ kind: "rebuild", link: s })}>
              <RefreshCw />
              重建链接
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setPending({ kind: "unlink", link: s })}
          >
            <Link2Off />
            {s.health === "normal" ? "解除链接" : "移除记录"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  /** 网格卡片（方向 A 减负 + B 状态信号）：名称 + ⋯菜单 + 出处→落点面板 + 元信息 */
  const renderCard = (s: LinkStatus, busy: boolean) => (
    <div
      key={s.id}
      className={`glass-card relative flex flex-col gap-2.5 px-[18px] py-[14px] ${barCls(s)}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[18px]">🧩</span>
        <span className="truncate font-display text-[15px] font-semibold text-text-primary">
          {s.skill_name}
        </span>
        {/* 模式（链接/副本）紧跟名称，不单独占一行 */}
        <span className="shrink-0 rounded-md border border-stroke bg-glass-2 px-1.5 py-[1px] text-[10.5px] text-text-secondary">
          {s.mode === "link" ? "链接" : "副本"}
        </span>
        {healthChip(s)}
        <span className="ml-auto shrink-0">{renderMenu(s, busy)}</span>
      </div>
      {renderCardPath(s)}
      {/* 底部只放"下一步"主按钮：异常链接才露重建，其余操作进 ⋯ 菜单 */}
      {s.health !== "normal" && s.mode === "link" && (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            className="mbtn primary"
            disabled={busy}
            onClick={() => setPending({ kind: "rebuild", link: s })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重建
          </button>
        </div>
      )}
    </div>
  );

  /** 列表行：两栏结构——左栏（名称 + 出处/落点）可截断收缩，右栏（状态 + ⋯菜单）固定不换行 */
  const renderRow = (s: LinkStatus, busy: boolean) => (
    <div
      key={s.id}
      className={`glass-card relative flex items-center gap-3 px-[18px] py-[12px] ${barCls(s)}`}
    >
      {/* 左栏：min-w-0 flex-1，路径超长时截断而非把右栏挤换行 */}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[16px]">🧩</span>
          <span className="truncate font-display text-[14px] font-semibold text-text-primary">
            {s.skill_name}
          </span>
          {/* 模式（链接/副本）紧跟名称，不单独占行 */}
          <span className="shrink-0 rounded-md border border-stroke bg-glass-2 px-1.5 py-[1px] text-[10.5px] text-text-secondary">
            {s.mode === "link" ? "链接" : "副本"}
          </span>
        </div>
        <Tip
          side="bottom"
          label={
            <span className="block font-mono text-[11px]">
              落点：{toolNames[s.target_tool] ?? s.target_tool}
              <br />
              {winPath(s.target)}
            </span>
          }
        >
          <span className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px]">
            <span className="shrink-0 text-[10.5px] font-semibold text-text-tertiary">出处</span>
            <span className="min-w-0 truncate text-text-tertiary">{winPath(s.source)}</span>
            <ArrowRight className="h-3 w-3 shrink-0 text-text-tertiary" />
            <span className="shrink-0 text-[10.5px] font-semibold text-brand">落点</span>
            <span className="min-w-0 truncate text-text-secondary">{winPath(s.target)}</span>
          </span>
        </Tip>
      </div>
      {/* 右栏：状态 + 菜单，shrink-0 固定，永远在行尾不换行 */}
      <div className="flex shrink-0 items-center gap-2">
        {healthChip(s)}
        {renderMenu(s, busy)}
      </div>
    </div>
  );

  /** 卡片内的出处→落点可视化（网格窄卡片专用）：
   *  内嵌分组面板 + 毛细分隔线（taste-skill「分组块 + 稀疏分隔线」），
   *  出处（中性）在上、落点（品牌色强调）在下，去掉空箭头行，纵向更紧凑。 */
  const renderCardPath = (s: LinkStatus) => (
    <div className="min-w-0 space-y-1.5">
      <div className="overflow-hidden rounded-[10px] border border-stroke bg-glass-1/70">
        {/* 出处 */}
        <div className="flex min-w-0 items-center gap-2 px-2.5 py-[7px]">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border border-stroke bg-glass-2 text-text-tertiary">
            <MoveUpRight className="h-3 w-3" />
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-text-tertiary">出处</span>
          <Tip
            side="bottom"
            label={<span className="block font-mono text-[11px]">{winPath(s.source)}</span>}
          >
            <span className="truncate font-mono text-[11px] text-text-tertiary">
              {winPath(s.source)}
            </span>
          </Tip>
        </div>
        <div className="h-px border-t border-stroke/70" />
        {/* 落点 */}
        <div className="flex min-w-0 items-center gap-2 px-2.5 py-[7px]">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border border-brand/35 bg-brand/10 text-brand">
            <MapPin className="h-3 w-3" />
          </span>
          <span className="shrink-0 text-[11px] font-semibold text-brand">落点</span>
          <Tip
            side="bottom"
            label={
              <span className="block font-mono text-[11px]">
                {toolNames[s.target_tool] ?? s.target_tool}
                <br />
                {winPath(s.target)}
              </span>
            }
          >
            <span className="truncate font-mono text-[11px] text-text-secondary">
              {winPath(s.target)}
            </span>
          </Tip>
        </div>
      </div>
      {s.health !== "normal" && s.detail && (
        <p className="text-[11px] text-amber-500/90">{s.detail}</p>
      )}
    </div>
  );

  return (
    <div className="relative py-6">
      {/* 头部（与其他页面统一用 SectionHead） */}
      <SectionHead
        title="引用台账"
        subtitle={
          <>
            管理技能与各 AI 工具之间的链接 / 副本
            <Tip
              side="bottom"
              label={
                <span className="block max-w-[240px] leading-relaxed">
                  建链约束：① 源须为真实目录；② 禁止循环引用（源与落点互含被拒）；
                  ③ 同名落点拒绝；④ 一个源可对多个落点（1 对多）。
                </span>
              }
            >
              <span className="ml-1 inline-grid h-[15px] w-[15px] cursor-help place-items-center rounded-md border border-stroke bg-glass-2 align-middle font-mono text-[10px] text-text-tertiary hover:border-stroke-hi hover:text-text-secondary">
                ?
              </span>
            </Tip>
            {abnormalCount > 0 && (
              <span className="ml-2 text-amber-500">
                {abnormalCount} 条异常需要处理
              </span>
            )}
          </>
        }
      >
        <button type="button" className="mbtn" onClick={refreshStatuses}>
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </button>
        <button type="button" className="mbtn primary" onClick={onOpenLink}>
          <Plus className="h-3.5 w-3.5" />
          新建引用
        </button>
        {/* 布局切换固定最右，远离主操作按钮防误触 */}
        <LayoutToggle value={layout} onChange={onLayoutChange} />
      </SectionHead>

      {/* P9：统一筛选入口 —— 筛选按钮(弹层勾选) + 已选标签(内联可移除) + 结果计数 */}
      {statuses.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="mbtn">
                <ListFilter className="h-3.5 w-3.5" />
                筛选
                {filterActiveCount > 0 && (
                  <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand/20 px-1 font-mono text-[10px] text-brand">
                    {filterActiveCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 p-0">
              <div className="space-y-3 p-3">
                <FilterSection label="类型">
                  <FilterChip
                    label="链接"
                    active={fMode.has("link")}
                    onClick={() => toggleSet("link", setFMode)}
                  />
                  <FilterChip
                    label="副本"
                    active={fMode.has("copy")}
                    onClick={() => toggleSet("copy", setFMode)}
                  />
                </FilterSection>
                <FilterSection label="状态">
                  <FilterChip
                    label="正常"
                    active={fHealth.has("normal")}
                    onClick={() => toggleSet("normal", setFHealth)}
                  />
                  <FilterChip
                    label="异常"
                    active={fHealth.has("abnormal")}
                    onClick={() => toggleSet("abnormal", setFHealth)}
                  />
                </FilterSection>
                <FilterSection label="落点工具">
                  {toolOptions.map((t) => (
                    <FilterChip
                      key={t}
                      label={toolNames[t] ?? t}
                      active={fTools.has(t)}
                      onClick={() => toggleSet(t, setFTools)}
                    />
                  ))}
                </FilterSection>
              </div>
              <div className="flex items-center justify-between border-t border-stroke px-3 py-2">
                <span className="text-[11px] text-text-tertiary">
                  {filterActiveCount > 0
                    ? `已选 ${filterActiveCount} 项 · 叠加（AND）`
                    : "未启用筛选"}
                </span>
                <button
                  type="button"
                  className="text-[11.5px] text-brand hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={filterActiveCount === 0}
                  onClick={clearAllFilters}
                >
                  清除全部
                </button>
              </div>
              <div className="border-t border-stroke/60 px-3 py-1.5 text-[10.5px] text-text-tertiary">
                多条件为「与」逻辑：需同时满足所有已选标签
              </div>
            </PopoverContent>
          </Popover>

          {/* 已选筛选标签：内联展示、点 × 单个移除 */}
          {activeTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={tag.onRemove}
              className="group inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand/10 px-2 py-[2px] text-[11.5px] text-brand transition-colors hover:border-brand/60 hover:bg-brand/15"
            >
              {tag.label}
              <X className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100" />
            </button>
          ))}

          {/* 结果计数 */}
          <span className="ml-auto text-[11.5px] text-text-tertiary">
            {filterActiveCount > 0
              ? `显示 ${filtered.length} / ${statuses.length} 条`
              : `共 ${statuses.length} 条`}
          </span>
        </div>
      )}

      {/* 引用台账（平铺，不按工具分块） */}
      {loading ? (
        <div className="glass-card flex items-center justify-center gap-2 p-10 text-[13px] text-text-tertiary">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
        </div>
      ) : statuses.length === 0 ? (
        <EmptyPanel
          icon={<FolderSymlink className="h-7 w-7" />}
          title="还没有任何引用记录"
          description="把技能链接或复制到 AI 工具的 skills 目录，建立从技能库到工具的引用台账。"
          actions={[
            <GhostCard
              key="new-link"
              icon={<Plus className="h-[22px] w-[22px]" />}
              title="新建引用"
              subtitle="把技能链接到 AI 工具"
              index={0}
              onClick={onOpenLink}
            />,
          ]}
        />
      ) : filtered.length === 0 ? (
        <EmptyPanel
          icon={<ListFilter className="h-7 w-7" />}
          title="没有符合当前筛选的记录"
          description="调整或清除筛选条件即可看到更多内容。"
        />
      ) : layout === "grid" ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => renderCard(s, actingId === s.id))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((s) => renderRow(s, actingId === s.id))}
        </div>
      )}

      {/* 确认对话框 */}
      <ConfirmDialog
        open={pending?.kind === "unlink"}
        onOpenChange={(o) => !o && !actingId && setPending(null)}
        title={pending?.link.mode === "link" ? "解除链接" : "移除账本记录"}
        description={
          pending?.link.mode === "link"
            ? `确定解除「${pending?.link.skill_name}」的链接吗？\n只移除 junction 本体，出处内容不受影响。`
            : `确定移除「${pending?.link.skill_name}」的账本记录吗？\n副本目录会保留在磁盘上，只是不再被本应用跟踪。`
        }
        confirmText="确定"
        variant="destructive"
        loading={!!actingId}
        onConfirm={() => pending && doAction(pending)}
      />
      <ConfirmDialog
        open={pending?.kind === "convert"}
        onOpenChange={(o) => !o && !actingId && setPending(null)}
        title="转为副本"
        description={`把「${pending?.link.skill_name}」从链接转为独立副本？\n将复制一份实体替换 junction，此后不再随出处同步。`}
        confirmText="转副本"
        loading={!!actingId}
        onConfirm={() => pending && doAction(pending)}
      />
      <ConfirmDialog
        open={pending?.kind === "rebuild"}
        onOpenChange={(o) => !o && !actingId && setPending(null)}
        title="重建链接"
        description={`重建「${pending?.link.skill_name}」的链接？\n将移除损坏的落点，并以原出处重新创建 junction。\n若出处已不存在，重建会失败并明确报错。`}
        confirmText="重建"
        loading={!!actingId}
        onConfirm={() => pending && doAction(pending)}
      />
    </div>
  );
}
