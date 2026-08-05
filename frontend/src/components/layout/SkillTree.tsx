import { useMemo, useState, useCallback } from "react";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import type { Skill, SkillGroup } from "@/hooks/useSkills";
import { collectionDisplayName } from "@/hooks/useSkills";

/**
 * PLAN-10 P2：技能库目录树（工具 → 合集 → 技能）
 *
 * 层级与 useSkills 分组一致：
 *  - 工具 = scan_label（即首页文件夹卡片，config.rs 里 tool.name）
 *  - 合集 = skill.parent_collection（工具内更深一层的目录；null 为散落根目录）
 *  - 技能 = skill
 *
 * 点击直达：
 *  - 工具节点 → 该工具的分类视图（CategoryView）
 *  - 合集节点 → 该合集（collection 过滤）视图
 *  - 技能节点 → 直接打开详情抽屉
 *
 * 展开状态持久化到 localStorage（sm:tree-open），当前所在分支自动强制展开。
 */

const TREE_OPEN_KEY = "sm:tree-open";

interface CollNode {
  key: string;
  collection: string;
  skills: Skill[];
}

interface ToolNode {
  label: string;
  count: number;
  indep: Skill[];
  colls: CollNode[];
}

interface SkillTreeProps {
  groups: SkillGroup[];
  /** 当前分类视图的工具（scan_label） */
  currentLabel: string | null;
  /** 当前分类视图的合集过滤（null = 整工具） */
  currentCollection: string | null;
  selectedSkillId: string | null;
  onOpenCollection: (label: string, collection: string | null) => void;
  onOpenSkill: (skill: Skill) => void;
}

function readOpen(): Set<string> {
  try {
    const v = localStorage.getItem(TREE_OPEN_KEY);
    if (!v) return new Set();
    return new Set(v.split(",").filter(Boolean));
  } catch {
    return new Set();
  }
}

export function SkillTree({
  groups,
  currentLabel,
  currentCollection,
  selectedSkillId,
  onOpenCollection,
  onOpenSkill,
}: SkillTreeProps) {
  const [open, setOpen] = useState<Set<string>>(readOpen);

  const toggle = useCallback((key: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(TREE_OPEN_KEY, [...next].join(","));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const tree = useMemo<ToolNode[]>(
    () =>
      groups.map((g) => {
        const collMap = new Map<string, Skill[]>();
        const indep: Skill[] = [];
        for (const s of g.skills) {
          if (s.parent_collection) {
            if (!collMap.has(s.parent_collection))
              collMap.set(s.parent_collection, []);
            collMap.get(s.parent_collection)!.push(s);
          } else {
            indep.push(s);
          }
        }
        const colls: CollNode[] = [...collMap.entries()]
          .map(([collection, skills]) => ({
            key: `coll:${g.label}\u241f${collection}`,
            collection,
            skills,
          }))
          .sort((a, b) =>
            collectionDisplayName(a.collection).localeCompare(
              collectionDisplayName(b.collection)
            )
          );
        return { label: g.label, count: g.skills.length, indep, colls };
      }),
    [groups]
  );

  // 当前所在分支强制展开（可读性优先；手动折叠其它分支仍持久化）
  const activeToolKey = currentLabel ? `tool:${currentLabel}` : null;
  const activeCollKey =
    currentLabel && currentCollection
      ? `coll:${currentLabel}\u241f${currentCollection}`
      : null;

  const isOpen = (key: string) =>
    open.has(key) || key === activeToolKey || key === activeCollKey;

  const skillActive = (id: string) => id === selectedSkillId;

  const renderSkill = (skill: Skill) => {
    const active = skillActive(skill.id);
    return (
      <button
        key={`s:${skill.id}`}
        type="button"
        onClick={() => onOpenSkill(skill)}
        className={`flex w-full min-w-0 items-center gap-1.5 rounded-md py-[3px] pr-1.5 pl-2 text-left transition-colors ${
          active
            ? "bg-brand/10 font-medium text-brand"
            : "text-text-secondary hover:bg-glass-2 hover:text-text-primary"
        }`}
      >
        <span className="w-[14px] shrink-0 text-center text-[11px]">
          {skill.emoji || "🧩"}
        </span>
        <span className="truncate">{skill.title_zh || skill.name}</span>
      </button>
    );
  };

  return (
    <div className="space-y-0.5">
      {tree.map((tool) => {
        const toolKey = `tool:${tool.label}`;
        const openTool = isOpen(toolKey);
        const toolActive = currentLabel === tool.label;
        const hasChildren = tool.indep.length > 0 || tool.colls.length > 0;

        return (
          <div key={toolKey}>
            {/* 工具节点 */}
            <div
              className={`flex items-center gap-0.5 rounded-md transition-colors ${
                toolActive ? "bg-glass-2" : "hover:bg-glass-2/60"
              }`}
            >
              <button
                type="button"
                aria-label={openTool ? "收起" : "展开"}
                onClick={() => toggle(toolKey)}
                className={`grid h-[22px] w-[18px] shrink-0 place-items-center text-text-tertiary transition-transform hover:text-text-primary ${
                  openTool ? "rotate-90" : ""
                }`}
                style={{ transform: openTool ? "rotate(90deg)" : undefined }}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onOpenCollection(tool.label, null)}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-[3px] pr-1.5 text-left"
              >
                <Folder
                  className={`h-3.5 w-3.5 shrink-0 ${
                    toolActive ? "text-brand" : "text-text-tertiary"
                  }`}
                />
                <span
                  className={`truncate text-[12.5px] ${
                    toolActive
                      ? "font-semibold text-text-primary"
                      : "font-medium text-text-secondary"
                  }`}
                >
                  {tool.label}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-text-tertiary">
                  {tool.count}
                </span>
              </button>
            </div>

            {/* 子节点 */}
            {openTool && hasChildren && (
              <div className="ml-[9px] space-y-0.5 border-l border-stroke/50 pl-[7px]">
                {tool.indep.map(renderSkill)}
                {tool.colls.map((coll) => {
                  const openColl = isOpen(coll.key);
                  const collActive =
                    currentCollection === coll.collection &&
                    currentLabel === tool.label;
                  return (
                    <div key={coll.key}>
                      <div
                        className={`flex items-center gap-0.5 rounded-md transition-colors ${
                          collActive ? "bg-glass-2" : "hover:bg-glass-2/60"
                        }`}
                      >
                        <button
                          type="button"
                          aria-label={openColl ? "收起" : "展开"}
                          onClick={() => toggle(coll.key)}
                          className="grid h-[22px] w-[18px] shrink-0 place-items-center text-text-tertiary transition-transform hover:text-text-primary"
                          style={{
                            transform: openColl
                              ? "rotate(90deg)"
                              : undefined,
                          }}
                        >
                          <ChevronRight className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onOpenCollection(tool.label, coll.collection)
                          }
                          className="flex min-w-0 flex-1 items-center gap-1.5 py-[3px] pr-1.5 text-left"
                        >
                          <FolderOpen
                            className={`h-3.5 w-3.5 shrink-0 ${
                              collActive ? "text-brand" : "text-text-tertiary"
                            }`}
                          />
                          <span
                            className={`truncate text-[12px] ${
                              collActive
                                ? "font-semibold text-text-primary"
                                : "text-text-secondary"
                            }`}
                          >
                            {collectionDisplayName(coll.collection)}
                          </span>
                          <span className="ml-auto shrink-0 font-mono text-[10px] text-text-tertiary">
                            {coll.skills.length}
                          </span>
                        </button>
                      </div>
                      {openColl && (
                        <div className="space-y-0.5 pt-0.5">
                          {coll.skills.map(renderSkill)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}