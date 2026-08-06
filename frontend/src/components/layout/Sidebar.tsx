import { useState } from "react";
import {
  RefreshCw,
  Sun,
  Moon,
  Settings,
  MoreHorizontal,
  BookOpen,
  ExternalLink,
  Boxes,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useTheme } from "next-themes";
import sharkTile from "@/assets/brand/shark-tile.png";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LINKS } from "@/lib/links";
import { VIEW_REGISTRY, type ViewId } from "@/lib/view-registry";
import { SkillTree } from "./SkillTree";
import type { Skill, SkillGroup } from "@/hooks/useSkills";

/**
 * PLAN-10 侧栏重构（全高传统侧栏）
 *
 * 顶栏模式隐藏全局 Topbar 后，把顶栏的功能全部收进侧栏：
 *  - 顶部固定：品牌区（含折叠按钮）
 *  - 中部：主导航（技能库 / Packs / Hub / 创作）
 *  - 可滚动区：技能库目录树（仅 lib tab）
 *  - 底部固定：用户栏式单菜单按钮（同步/主题/设置/手册/关于）
 *  - 折叠为图标栏（w-[60px]），导航/用户栏仅保留图标
 *
 * 搜索不再提供侧栏入口：全局搜索统一由 Ctrl+K 触发（居中弹层），
 * 避免一个误导性的假输入框。
 *
 * 侧栏树区与主内容区各自独立滚动（见 App.tsx 布局壳），页面级不滚。
 * 沉浸态（创作工作台 wbActive）由 App 层隐藏本组件。
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
  // 顶栏功能收编（PLAN-10 侧栏重构）
  syncing?: boolean;
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenManual: () => void;
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
  syncing,
  onSync,
  onOpenSettings,
  onOpenManual,
}: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const isDark = theme !== "light";

  // 折叠态：收窄为图标栏（存 localStorage，跨会话记忆）
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sm:sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapse = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sm:sidebar-collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  return (
    <aside
      className={`glass-sidebar flex h-full shrink-0 flex-col transition-[width] duration-200 ${
        collapsed ? "w-[60px]" : "w-[252px]"
      }`}
    >
      {/* ===== 顶部固定：品牌区（含折叠按钮） ===== */}
      <div
        className={`flex shrink-0 items-center pt-4 pb-3 ${
          collapsed ? "flex-col gap-2 px-0" : "gap-[11px] px-4"
        }`}
      >
        <img
          src={sharkTile}
          alt=""
          aria-hidden
          draggable={false}
          className={collapsed ? "h-[30px] w-[30px] rounded-[9px]" : "h-[34px] w-[34px] rounded-[10px]"}
          style={{ boxShadow: "0 6px 18px -6px var(--glow)" }}
        />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[15px] font-semibold leading-none tracking-[0.2px] text-text-primary">
              SkillsShark
            </h1>
          </div>
        )}
        <button
          type="button"
          onClick={toggleCollapse}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          className="iconbtn shrink-0"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* ===== 主导航 ===== */}
      <nav
        className={`shrink-0 space-y-0.5 py-1 ${
          collapsed ? "flex flex-col items-center px-0" : "px-2.5"
        }`}
        aria-label="主导航"
      >
        {VIEW_REGISTRY.map((v) => {
          const Icon = v.icon;
          const active = activeTab === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onChangeTab(v.id)}
              aria-label={collapsed ? v.label : undefined}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg py-2 text-[14px] font-medium transition-colors ${
                collapsed ? "w-10 justify-center px-0" : "w-full px-3"
              } ${
                active
                  ? "bg-brand/10 text-brand ring-1 ring-brand/40"
                  : "text-text-secondary hover:bg-glass-2 hover:text-text-primary"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && v.label}
            </button>
          );
        })}
      </nav>

      <div
        className={`my-1 shrink-0 border-t border-stroke/70 ${
          collapsed ? "mx-auto w-8" : "mx-2.5"
        }`}
      />

      {/* ===== 可滚动区：技能库目录树（折叠态隐藏，但保留占位撑满高度） ===== */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {!collapsed &&
          (activeTab === "lib" ? (
            <>
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
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-[12px] leading-relaxed text-text-tertiary">
              目录树仅在技能库视图显示
              <br />
              切换左侧菜单可回到技能库
            </div>
          ))}
      </div>

      {/* ===== 底部固定：用户栏式单菜单按钮 =====
          头像用字母 S（圆形，当前用户即产品名），栏本身不可点，
          仅尾部「⋯」按钮触发菜单；菜单含 刷新同步 / 主题明暗 /
          设置 / 使用手册 / 关于我们（指向产品官网）。
          折叠态仅保留居中的「⋯」按钮（隐藏头像与文字），且恒钉在底部。 */}
      <div className="shrink-0 border-t border-stroke/70 px-2.5 pb-3 pt-2">
        <div
          className={`flex items-center ${
            collapsed ? "justify-center" : "gap-2.5"
          }`}
        >
          {!collapsed && (
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-primary text-[15px] font-bold text-primary-foreground"
            >
              S
            </span>
          )}
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-text-primary">
                菜单
              </span>
              <span className="block truncate text-[11px] text-text-tertiary">
                同步 · 设置 · 关于
              </span>
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="打开菜单" className="iconbtn">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-[224px]">
              <DropdownMenuItem onSelect={onSync}>
                <RefreshCw className={syncing ? "animate-spin" : ""} />
                刷新同步
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTheme(isDark ? "light" : "dark")}>
                {isDark ? <Sun /> : <Moon />}
                {isDark ? "切换亮色" : "切换暗色"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenSettings}>
                <Settings />
                设置
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onOpenManual}>
                <BookOpen />
                使用手册
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={LINKS.site} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  关于我们
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </aside>
  );
}
