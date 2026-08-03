import { Search, RefreshCw, Sun, Moon, Settings } from "lucide-react";
import { useTheme } from "next-themes";
import sharkTile from "@/assets/brand/shark-tile.png";

interface TopbarProps {
  totalSkills: number;
  syncing?: boolean;
  onSearchClick: () => void;
  onSync: () => void;
  onOpenSettings: () => void;
}

/**
 * 玻璃顶栏（替代旧 Header）。
 * 视觉来源：docs/style.css .topbar / .brand / .search-trigger / .tb-right / .pill / .iconbtn
 */
export function Topbar({
  totalSkills,
  syncing,
  onSearchClick,
  onSync,
  onOpenSettings,
}: TopbarProps) {
  const { theme, setTheme } = useTheme();
  const isDark = theme !== "light";

  return (
    <header className="glass-topbar sticky top-0 z-40 flex items-center gap-4 px-[26px] py-3">
      {/* 品牌区 */}
      <div className="flex shrink-0 items-center gap-[11px]">
        {/* SkillsShark mark：实心剪影鲨，浅底 navy */}
        <img
          src={sharkTile}
          alt=""
          aria-hidden
          draggable={false}
          className="h-[38px] w-[38px] rounded-[11px]"
          style={{ boxShadow: "0 6px 18px -6px var(--glow)" }}
        />
        <div>
          <h1 className="font-display text-[17px] font-semibold leading-none tracking-[0.2px] text-text-primary">
            SkillsShark
          </h1>
          <p className="mt-[3px] text-[11.5px] leading-none text-text-secondary">
            本地技能管理与翻译
          </p>
        </div>
      </div>

      {/* 搜索触发器（模拟输入框，点击唤起 CmdK） */}
      <div
        role="button"
        tabIndex={0}
        onClick={onSearchClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSearchClick();
        }}
        className="mx-auto flex max-w-[440px] flex-1 cursor-text items-center gap-[9px] rounded-xl border border-stroke bg-glass px-[14px] py-[9px] text-[13.5px] text-text-tertiary transition-colors duration-200 hover:border-stroke-hi hover:text-text-secondary"
      >
        <Search className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="truncate">搜索技能、分类、Pack…</span>
        <span className="kbd ml-auto shrink-0">Ctrl K</span>
      </div>

      {/* 右侧操作区 */}
      <div className="flex shrink-0 items-center gap-2">
        {/* 技能总数 Pill */}
        <div className="flex items-center gap-[7px] rounded-full border border-stroke bg-glass px-[13px] py-[7px] text-[12.5px] font-medium text-text-secondary">
          <span
            className="h-[7px] w-[7px] rounded-full"
            style={{
              background: "var(--accent)",
              boxShadow: "0 0 8px var(--accent)",
            }}
            aria-hidden
          />
          <span className="tabular-nums text-text-primary">{totalSkills}</span>
          <span>技能</span>
        </div>

        {/* 同步 */}
        <button
          type="button"
          className="iconbtn"
          onClick={onSync}
          disabled={syncing}
          title="同步"
          aria-label="同步技能列表"
        >
          <RefreshCw className={`h-[18px] w-[18px] ${syncing ? "animate-spin" : ""}`} />
        </button>

        {/* 主题切换 */}
        <button
          type="button"
          className="iconbtn"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          title={isDark ? "切换亮色" : "切换暗色"}
          aria-label="切换主题"
        >
          {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>

        {/* 设置 */}
        <button
          type="button"
          className="iconbtn"
          onClick={onOpenSettings}
          title="设置"
          aria-label="打开设置"
        >
          <Settings className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  );
}
