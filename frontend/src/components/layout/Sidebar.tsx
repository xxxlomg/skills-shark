import { Boxes } from "lucide-react";
import { VIEW_REGISTRY, type ViewId } from "@/lib/view-registry";
import { SkillTree } from "./SkillTree";
import type { Skill, SkillGroup } from "@/hooks/useSkills";

/**
 * PLAN-10 P2：侧栏布局（navMode === "sidebar"）
 *
 * 结构：
 *  - 上层：主视图菜单（技能库 / Packs / Hub / 创作），数据驱动自 VIEW_REGISTRY，
 *    替代顶栏模式下的 TabNav。
 *  - 下层（仅技能库 tab）：技能库目录树（工具 → 合集 → 技能）。
 *
 * 沉浸态（创作工作台 wbActive）由 App 层隐藏本组件；本组件不再自行判断。
 */

interface SidebarProps {
  activeTab: ViewId;
  onChangeTab: (tab: ViewId) => void;
  groups: SkillGroup[];
  currentLabel: string | null;
  currentCollection: string | null;
  selectedSkillId: string | null;
  onOpenCollection: (label: string, collection: string | null) => void;
  onOpenSkill: (skill: Skill) => void;
}

export function Sidebar({
  activeTab,
  onChangeTab,
  groups,
  currentLabel,
  currentCollection,
  selectedSkillId,
  onOpenCollection,
  onOpenSkill,
}: SidebarProps) {
  return (
    <aside className="sticky top-[64px] z-30 flex h-[calc(100vh-64px)] w-[236px] shrink-0 flex-col border-r border-stroke bg-glass-1/60">
      {/* 主视图菜单（替代 TabNav） */}
      <nav className="space-y-0.5 p-2.5" aria-label="主导航">
        {VIEW_REGISTRY.map((view) => {
          const Icon = view.icon;
          const active = activeTab === view.id;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onChangeTab(view.id)}
              aria-current={active ? "page" : undefined}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-brand/10 text-brand ring-1 ring-brand/40"
                  : "text-text-secondary hover:bg-glass-2 hover:text-text-primary"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {view.label}
            </button>
          );
        })}
      </nav>

      <div className="mx-2.5 border-t border-stroke/70" />

      {activeTab === "lib" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
            <Boxes className="h-3 w-3" />
            技能库目录
          </div>
          <SkillTree
            groups={groups}
            currentLabel={currentLabel}
            currentCollection={currentCollection}
            selectedSkillId={selectedSkillId}
            onOpenCollection={onOpenCollection}
            onOpenSkill={onOpenSkill}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-[11px] leading-relaxed text-text-tertiary">
          目录树仅在技能库视图显示
          <br />
          切换顶部菜单可回到技能库
        </div>
      )}
    </aside>
  );
}