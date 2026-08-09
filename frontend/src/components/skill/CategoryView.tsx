import { useState, useMemo, type CSSProperties } from "react";
import {
  ArrowLeft,
  Search,
  Folder,
  FolderOpen,
  Languages,
  Loader2,
  PenLine,
} from "lucide-react";
import { SkillCard } from "./SkillCard";
import { LayoutToggle } from "./LayoutToggle";
import { SectionHead } from "@/components/common/SectionHead";
import { EmptyPanel } from "@/components/common/EmptyPanel";
import { useBatchTranslate } from "@/hooks/useBatchTranslate";
import type { Skill, LayoutMode } from "@/hooks/useSkills";
import { collectionRelativeName } from "@/hooks/useSkills";

interface CategoryViewProps {
  label: string;
  skills: Skill[];
  /** PLAN-10 P2：仅展示指定合集（parent_collection），扁平渲染 */
  collection?: string | null;
  layout: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  onBack: () => void;
  onSkillClick: (skill: Skill) => void;
  /** 点击合集文件夹 → 进入该文件夹（面包屑前进） */
  onOpenCollection?: (label: string, collection: string | null) => void;
  /** 文件夹内「创作」→ 跳转工作台并预选落点 */
  onCreateIn?: (target: string) => void;
  onSettingsOpen?: () => void;
  onTranslateDone?: () => void;
}

/** 合集文件夹导航卡：与 SkillCard 同形的标准玻璃卡，点击整卡进入文件夹。 */
function FolderNavCard({
  name,
  count,
  index,
  layout,
  onClick,
}: {
  name: string;
  count: number;
  index: number;
  layout: "grid" | "list";
  onClick: () => void;
}) {
  const wrapStyle = { "--i": index } as CSSProperties;
  if (layout === "list") {
    return (
      <div className="card-wrap" style={wrapStyle}>
        <button
          type="button"
          onClick={onClick}
          className="glass-card glass-card-hover card-glow relative flex w-full items-center gap-4 overflow-hidden px-[18px] py-[14px] text-left"
        >
          <span className="absolute left-0 top-[20%] z-[1] h-[60%] w-[3px] rounded-r-[4px] bg-gradient-to-b from-brand to-cyan opacity-85" />
          <span className="relative z-[1] grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[12px] border border-stroke bg-glass-2 text-brand">
            <Folder className="h-5 w-5" />
          </span>
          <div className="relative z-[1] min-w-0 flex-1">
            <h3 className="truncate font-display text-[15.5px] font-semibold text-text-primary">
              {name}
            </h3>
            <p className="font-mono text-[11px] text-text-tertiary">文件夹</p>
          </div>
          <span className="relative z-[1] shrink-0 rounded-full border border-stroke bg-glass-2 px-2 py-0.5 font-mono text-xs text-text-secondary">
            {count}
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className="card-wrap" style={wrapStyle}>
      <button
        type="button"
        onClick={onClick}
        className="glass-card glass-card-hover card-deco card-glow relative flex h-full w-full flex-col overflow-hidden p-5 text-left"
      >
        <div className="relative z-[1] flex items-start justify-between gap-2">
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] border border-stroke bg-glass-2 text-brand">
            <Folder className="h-[22px] w-[22px]" />
          </span>
          <span className="shrink-0 rounded-full border border-stroke bg-glass-2 px-[10px] py-[3px] font-mono text-[12px] text-text-secondary">
            {count}
          </span>
        </div>
        <h3 className="relative z-[1] mt-4 truncate font-display text-[19px] font-semibold leading-snug text-text-primary">
          {name}
        </h3>
        <p className="relative z-[1] mt-[3px] font-mono text-[12px] text-text-tertiary">
          文件夹
        </p>
      </button>
    </div>
  );
}

export function CategoryView({
  label,
  skills,
  collection,
  layout,
  onLayoutChange,
  onBack,
  onSkillClick,
  onOpenCollection,
  onCreateIn,
  onSettingsOpen,
  onTranslateDone,
}: CategoryViewProps) {
  const [query, setQuery] = useState("");
  const { batch, running, run } = useBatchTranslate({
    onNeedSettings: onSettingsOpen,
    onDone: onTranslateDone,
  });

  // PLAN-10 P2：collection 模式下只看该合集，扁平展示
  const isScoped = Boolean(collection);
  const scopedTitle = collection
    ? collectionRelativeName(label, collection)
    : label;

  const base = useMemo(() => {
    if (!collection) return skills;
    return skills.filter((s) => s.parent_collection === collection);
  }, [skills, collection]);

  // 创作落点：优先用该目录下技能所属工具 id（与工作台落点选项 value 对齐），
  // 兜底用 label。避免 scan_label 与 ToolInfo.name 不一致导致预选失败。
  const createTarget = useMemo(() => {
    const t = base.find(
      (s) => s.tool_id && s.tool_id !== "authored" && s.tool_id !== "builtin",
    );
    return t?.tool_id ?? label;
  }, [base, label]);

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
        {collection ? `返回 ${label}` : "返回技能库"}
      </button>

      <SectionHead
        title={scopedTitle}
        subtitle={`${base.length} 个技能 · ${okCount} 已翻译 · ${pendingCount} 待处理`}
      >
        {onCreateIn && (
          <button
            type="button"
            className="mbtn primary"
            onClick={() => onCreateIn(createTarget)}
            title={`在「${label}」下创作技能`}
          >
            <PenLine className="h-3.5 w-3.5" />
            创作
          </button>
        )}
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
        // 合集过滤视图扁平展示
        <div>{renderSkills(filtered)}</div>
      ) : layout === "grid" ? (
        // 统一卡片：合集=文件夹卡（点击进入，面包屑前进）+ 独立技能卡，同一网格
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collectionOrder.map((c, i) => {
            const list = cmap.get(c);
            if (!list || list.length === 0) return null;
            return (
              <FolderNavCard
                key={`folder-${c}`}
                name={collectionRelativeName(label, c)}
                count={list.length}
                index={i}
                layout="grid"
                onClick={() => onOpenCollection?.(label, c)}
              />
            );
          })}
          {indep.map((s, i) => (
            <SkillCard
              key={s.id}
              skill={s}
              index={collectionOrder.length + i}
              layout="grid"
              onClick={() => onSkillClick(s)}
            />
          ))}
        </div>
      ) : (
        // 统一卡片：列表态
        <div className="flex flex-col gap-[10px]">
          {collectionOrder.map((c, i) => {
            const list = cmap.get(c);
            if (!list || list.length === 0) return null;
            return (
              <FolderNavCard
                key={`folder-${c}`}
                name={collectionRelativeName(label, c)}
                count={list.length}
                index={i}
                layout="list"
                onClick={() => onOpenCollection?.(label, c)}
              />
            );
          })}
          {indep.map((s, i) => (
            <SkillCard
              key={s.id}
              skill={s}
              index={collectionOrder.length + i}
              layout="list"
              onClick={() => onSkillClick(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
