import { useState, useMemo } from "react";
import {
  ArrowLeft,
  Search,
  Folder,
  FolderOpen,
  ChevronRight,
  Languages,
  Loader2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SkillCard } from "./SkillCard";
import { LayoutToggle } from "./LayoutToggle";
import { SectionHead } from "@/components/common/SectionHead";
import { EmptyPanel } from "@/components/common/EmptyPanel";
import { useBatchTranslate } from "@/hooks/useBatchTranslate";
import type { Skill, LayoutMode } from "@/hooks/useSkills";
import { collectionDisplayName } from "@/hooks/useSkills";

interface CategoryViewProps {
  label: string;
  skills: Skill[];
  /** PLAN-10 P2：仅展示指定合集（parent_collection），扁平渲染 */
  collection?: string | null;
  layout: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  onBack: () => void;
  onSkillClick: (skill: Skill) => void;
  onSettingsOpen?: () => void;
  onTranslateDone?: () => void;
}

const PREVIEW_MAX = 3;

export function CategoryView({
  label,
  skills,
  collection,
  layout,
  onLayoutChange,
  onBack,
  onSkillClick,
  onSettingsOpen,
  onTranslateDone,
}: CategoryViewProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // A1: 折叠过渡结束后才卸载子卡片 DOM，默认折叠态砍掉 ~90% 闲置 backdrop-filter 层
  const [mounted, setMounted] = useState<Set<string>>(() => new Set());
  const { batch, running, run } = useBatchTranslate({
    onNeedSettings: onSettingsOpen,
    onDone: onTranslateDone,
  });

  // PLAN-10 P2：collection 模式下只看该合集，扁平展示
  const isScoped = Boolean(collection);
  const scopedTitle = collection ? collectionDisplayName(collection) : label;

  const base = useMemo(() => {
    if (!collection) return skills;
    return skills.filter((s) => s.parent_collection === collection);
  }, [skills, collection]);

  const toggleCollection = (c: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
    // A1: 展开/收起都先标记已挂载；收起后由 onTransitionEnd 延迟卸载
    setMounted((prev) => {
      if (prev.has(c)) return prev;
      return new Set(prev).add(c);
    });
  };

  // 合集稳定顺序（基于全量 skills 首次出现，搜索时不跳）
  const collectionOrder = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const s of skills) {
      const c = s.parent_collection;
      if (c && !seen.has(c)) {
        seen.add(c);
        order.push(c);
      }
    }
    return order;
  }, [skills]);

  const filtered = useMemo(() => {
    if (!query) return base;
    const q = query.toLowerCase();
    return base.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.title_zh.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.description_zh.toLowerCase().includes(q) ||
        s.folder_name.toLowerCase().includes(q)
    );
  }, [base, query]);

  // 分组（基于 filtered）
  const { indep, cmap } = useMemo(() => {
    const indepArr = filtered.filter((s) => !s.parent_collection);
    const map = new Map<string, Skill[]>();
    for (const s of filtered) {
      const c = s.parent_collection;
      if (c) {
        if (!map.has(c)) map.set(c, []);
        map.get(c)!.push(s);
      }
    }
    return { indep: indepArr, cmap: map };
  }, [filtered]);

  const hasCollections = cmap.size > 0;
  const showIndepHeader = indep.length > 0 && hasCollections;

  const okCount = base.filter((s) => s.has_translation).length;
  const pendingCount = base.length - okCount;
  const hasUntranslated = pendingCount > 0;

  // 渲染一组 skills（grid / list 均由 SkillCard 承担）
  const renderSkills = (list: Skill[], offset = 0) =>
    layout === "grid" ? (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((skill, i) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            index={offset + i}
            layout="grid"
            onClick={() => onSkillClick(skill)}
          />
        ))}
      </div>
    ) : (
      <div className="flex flex-col gap-[10px]">
        {list.map((skill, i) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            index={offset + i}
            layout="list"
            onClick={() => onSkillClick(skill)}
          />
        ))}
      </div>
    );

  return (
    <div className="relative py-6">
      <button type="button" onClick={onBack} className="back-btn">
        <ArrowLeft className="h-[15px] w-[15px]" />
        返回技能库
      </button>

      <SectionHead
        title={scopedTitle}
        subtitle={`${base.length} 个技能 · ${okCount} 已翻译 · ${pendingCount} 待处理`}
      >
        <button
          type="button"
          className="mbtn primary"
          onClick={() => run(base)}
          disabled={running || !hasUntranslated}
        >
          {running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              翻译中 {batch?.current}/{batch?.total}
            </>
          ) : (
            <>
              <Languages className="h-3.5 w-3.5" />
              批量翻译未译
            </>
          )}
        </button>
        <LayoutToggle value={layout} onChange={onLayoutChange} />
      </SectionHead>

      {/* 分类内搜索 */}
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-[14px] top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="在本分类中搜索…"
          className="h-10 w-full rounded-[12px] border border-stroke bg-glass pl-10 pr-4 text-[13.5px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-stroke-hi"
          style={{ backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
        />
      </div>

      {filtered.length === 0 ? (
        query ? (
          <EmptyPanel
            icon={<Search className="h-7 w-7" />}
            title={`没有匹配「${query}」的技能`}
            description="换个关键词，或清除搜索条件再试试。"
          />
        ) : (
          <EmptyPanel
            icon={<FolderOpen className="h-7 w-7" />}
            title="这个分类还是空的"
            description="导入技能，或从其他来源把技能放进这个分类。"
          />
        )
      ) : isScoped ? (
        // PLAN-10 P2：合集过滤视图扁平展示（不再套合集分组）
        <div>{renderSkills(filtered)}</div>
      ) : (
        <div className="space-y-6">
          {/* 独立技能区 */}
          {indep.length > 0 && (
            <section>
              {showIndepHeader && (
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-3 w-1 rounded-full bg-gradient-to-b from-brand to-cyan" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                    独立技能
                  </span>
                  <span className="text-xs tabular-nums text-text-tertiary/70">
                    {indep.length}
                  </span>
                </div>
              )}
              {renderSkills(indep)}
            </section>
          )}

          {/* 合集区 */}
          {hasCollections && (
            <section className="space-y-3">
              {showIndepHeader && (
                <div className="mb-1 flex items-center gap-2">
                  <span className="h-3 w-1 rounded-full bg-gradient-to-b from-brand/70 to-cyan/60" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                    技能合集
                  </span>
                </div>
              )}

              {collectionOrder.map((c) => {
                const list = cmap.get(c);
                if (!list || list.length === 0) return null;
                // 搜索态：有匹配结果的合集强制展开，避免「搜得到却看不见」
                const open = expanded.has(c) || query.trim().length > 0;
                const display = collectionDisplayName(c);
                const isNested = c !== display;
                const previews = list.slice(0, PREVIEW_MAX);
                const overflow = list.length - PREVIEW_MAX;

                return (
                  <div
                    key={c}
                    className={`glass-card overflow-hidden transition-colors ${
                      open ? "border-stroke-hi" : ""
                    }`}
                  >
                    <button
                      onClick={() => toggleCollection(c)}
                      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-glass-2/60"
                      aria-expanded={open}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-stroke bg-glass-2 text-brand">
                        {open ? (
                          <FolderOpen className="h-4 w-4" />
                        ) : (
                          <Folder className="h-4 w-4" />
                        )}
                      </span>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
                            {display}
                          </span>
                        </TooltipTrigger>
                        {isNested && (
                          <TooltipContent side="top" align="start">
                            {c}
                          </TooltipContent>
                        )}
                      </Tooltip>

                      <span className="hidden shrink-0 items-center gap-1 text-base sm:flex">
                        {previews.map((s, i) => (
                          <span key={i} className="opacity-80">
                            {s.emoji || "🧩"}
                          </span>
                        ))}
                        {overflow > 0 && (
                          <span className="ml-0.5 font-mono text-[10px] text-text-tertiary">
                            +{overflow}
                          </span>
                        )}
                      </span>

                      <span className="shrink-0 rounded-full border border-stroke bg-glass-2 px-2 py-0.5 font-mono text-xs text-text-secondary">
                        {list.length}
                      </span>

                      <ChevronRight
                        className={`h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-300 ${
                          open ? "rotate-90" : ""
                        }`}
                      />
                    </button>

                    <div
                      className={`grid transition-all duration-300 ease-out ${
                        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                      }`}
                      onTransitionEnd={(e) => {
                        // A1: 收起动画播完后卸载子卡片 DOM（展开时 open=true 不触发）
                        if (e.propertyName === "grid-template-rows" && !open) {
                          setMounted((prev) => {
                            const n = new Set(prev);
                            n.delete(c);
                            return n;
                          });
                        }
                      }}
                    >
                      <div className="min-h-0 overflow-hidden">
                        {(open || mounted.has(c)) && (
                          <div className="border-t border-stroke/60 px-4 pb-4 pt-3">
                            {renderSkills(list)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
