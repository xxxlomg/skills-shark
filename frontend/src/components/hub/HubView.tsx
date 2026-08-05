import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderSymlink,
  Link2Off,
  CopyPlus,
  RefreshCw,
  Loader2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Tip } from "@/components/common/Tip";
import { LayoutToggle } from "@/components/skill/LayoutToggle";
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

/** P9：台账分类筛选 */
type LedgerFilter = "all" | "abnormal" | "link" | "copy";
const LEDGER_FILTERS: { id: LedgerFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "abnormal", label: "仅异常" },
  { id: "link", label: "仅链接" },
  { id: "copy", label: "仅副本" },
];

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
  // P9：台账分类筛选
  const [filter, setFilter] = useState<LedgerFilter>("all");

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

  // P9：按筛选条件过滤后的台账
  const filtered = useMemo(
    () =>
      statuses.filter((s) => {
        if (filter === "abnormal") return s.health !== "normal";
        if (filter === "link") return s.mode === "link";
        if (filter === "copy") return s.mode === "copy";
        return true;
      }),
    [statuses, filter]
  );

  // P9：按落点工具分组（组序按工具显示名；组内保持台账顺序）
  const groups = useMemo(() => {
    const map = new Map<string, LinkStatus[]>();
    for (const s of filtered) {
      const arr = map.get(s.target_tool) ?? [];
      arr.push(s);
      map.set(s.target_tool, arr);
    }
    return [...map.entries()].sort((a, b) =>
      (toolNames[a[0]] ?? a[0]).localeCompare(toolNames[b[0]] ?? b[0])
    );
  }, [filtered, toolNames]);

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

  /** 操作按钮组（卡片 / 列表共用） */
  const renderActions = (s: LinkStatus, busy: boolean) =>
    busy ? (
      <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
    ) : (
      <>
        {s.health === "normal" && s.mode === "link" && (
          <Tip label="复制实体替换 junction，从此独立于出处">
            <button
              type="button"
              className="mbtn"
              onClick={() => setPending({ kind: "convert", link: s })}
            >
              <CopyPlus className="h-3.5 w-3.5" />
              转副本
            </button>
          </Tip>
        )}
        {s.health !== "normal" && s.mode === "link" && (
          <Tip label="移除坏落点并以原出处重新建链">
            <button
              type="button"
              className="mbtn"
              onClick={() => setPending({ kind: "rebuild", link: s })}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重建
            </button>
          </Tip>
        )}
        <Tip
          label={
            s.mode === "link"
              ? "只移除 junction 本体，出处内容不受影响"
              : "副本目录保留，仅移除账本记录"
          }
        >
          <button
            type="button"
            className="mbtn"
            onClick={() => setPending({ kind: "unlink", link: s })}
          >
            <Link2Off className="h-3.5 w-3.5" />
            {s.health === "normal" ? "解除" : "移除记录"}
          </button>
        </Tip>
      </>
    );

  /** 名称 + 徽标行（卡片 / 列表共用） */
  const renderNameRow = (s: LinkStatus) => {
    const health = HEALTH_META[s.health];
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[18px]">🧩</span>
        <span className="truncate font-display text-[14.5px] font-semibold text-text-primary">
          {s.skill_name}
        </span>
        {/* P4：去向工具醒目徽标（一眼看出链接落去了哪个工具） */}
        <span className="flex shrink-0 items-center gap-0.5 rounded-md border border-brand/40 bg-brand/10 px-1.5 py-[1px] text-[10.5px] font-medium text-brand">
          <FolderSymlink className="h-3 w-3" />
          {toolNames[s.target_tool] ?? s.target_tool}
        </span>
        <span className="shrink-0 rounded-full border border-stroke bg-glass-2 px-2 py-[2px] text-[10.5px] text-text-secondary">
          {s.mode === "link" ? "链接" : "副本"}
        </span>
        <span
          className={`flex shrink-0 items-center gap-1.5 rounded-full border border-stroke bg-glass-2 px-2 py-[2px] text-[10.5px] ${health.cls}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${health.dot}`} />
          {health.label}
        </span>
      </div>
    );
  };

  /** 路径行（卡片 / 列表共用）：悬停显示出处/落点（全局 Hint 组件） */
  const renderPathRow = (s: LinkStatus) => (
    <>
      <Tip
        side="bottom"
        label={
          <span className="block font-mono">
            出处：{s.source}
            <br />
            落点：{s.target}
          </span>
        }
      >
        <p className="truncate font-mono text-[11px] text-text-tertiary">
          {s.source} <span className="text-text-secondary">→</span>{" "}
          {toolNames[s.target_tool] ?? s.target_tool}
        </p>
      </Tip>
      {s.health !== "normal" && s.detail && (
        <p className="mt-0.5 text-[11px] text-amber-500/90">{s.detail}</p>
      )}
    </>
  );

  /** P9：分组头部（工具名 + 条数 + 健康汇总） */
  const renderGroupHeader = (toolId: string, items: LinkStatus[]) => {
    const abnormal = items.filter((s) => s.health !== "normal").length;
    return (
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <FolderSymlink className="h-4 w-4 text-brand" />
        <span className="font-display text-[14px] font-semibold text-text-primary">
          {toolNames[toolId] ?? toolId}
        </span>
        <span className="rounded-full border border-stroke bg-glass-2 px-2 py-[2px] text-[10.5px] text-text-secondary">
          {items.length} 条
        </span>
        {abnormal > 0 && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-[2px] text-[10.5px] text-amber-600 dark:bg-amber-950/30">
            {abnormal} 异常
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="pt-6">
      {/* 头部 */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[17px] font-semibold text-text-primary">
            引用台账
          </h2>
          <p className="mt-0.5 text-[12.5px] text-text-tertiary">
            管理技能与各 AI 工具之间的链接 / 副本
            {abnormalCount > 0 && (
              <span className="ml-2 text-amber-500">
                {abnormalCount} 条异常需要处理
              </span>
            )}
          </p>
        </div>
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
      </div>

      {/* P9：分类筛选 */}
      {statuses.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {LEDGER_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                filter === f.id
                  ? "border-brand/50 bg-brand/10 font-medium text-brand"
                  : "border-stroke bg-glass text-text-secondary hover:bg-glass-2 hover:text-text-primary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* 引用台账（按落点工具分组） */}
      {loading ? (
        <div className="glass-card flex items-center justify-center gap-2 p-10 text-[13px] text-text-tertiary">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
        </div>
      ) : statuses.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <FolderSymlink className="mx-auto mb-3 h-8 w-8 text-text-tertiary" />
          <p className="text-[13.5px] text-text-secondary">还没有任何引用记录</p>
          <p className="mt-1 text-[12px] text-text-tertiary">
            点击「新建引用」，把技能链接或复制到 AI 工具的 skills 目录。
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <p className="text-[13.5px] text-text-secondary">
            没有符合当前筛选的记录
          </p>
        </div>
      ) : (
        <div className="space-y-7">
          {groups.map(([toolId, items]) => (
            <section key={toolId}>
              {renderGroupHeader(toolId, items)}
              {layout === "grid" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {items.map((s) => {
                    const busy = actingId === s.id;
                    return (
                      <div
                        key={s.id}
                        className="glass-card flex flex-col gap-2.5 px-[18px] py-[16px]"
                      >
                        {renderNameRow(s)}
                        <div className="min-w-0">{renderPathRow(s)}</div>
                        <div className="mt-auto flex items-center gap-1.5 pt-1">
                          {renderActions(s, busy)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {items.map((s) => {
                    const busy = actingId === s.id;
                    return (
                      <div
                        key={s.id}
                        className="glass-card flex flex-wrap items-center gap-x-4 gap-y-2 px-[18px] py-[14px]"
                      >
                        {renderNameRow(s)}
                        <div className="min-w-0 flex-1 basis-full lg:basis-auto">
                          {renderPathRow(s)}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {renderActions(s, busy)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
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
