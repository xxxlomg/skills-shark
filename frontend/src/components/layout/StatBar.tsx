import { Layers, CheckCircle2, Package, FileWarning } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface StatBarProps {
  total: number;
  translated: number;
  /** 译文丢失（曾翻译但文件没了）；与卡片徽章同源同步 */
  lost: number;
  packCount: number;
}

interface StatItem {
  icon: LucideIcon;
  color: string;
  value: number;
  label: string;
}

/**
 * 统计条：技能总数 / 已翻译 / 译文丢失 / Packs + 翻译进度条。
 * 视觉来源：docs/style.css .statbar / .stat / .progwrap / .prog
 */
export function StatBar({ total, translated, lost, packCount }: StatBarProps) {
  const pct = total > 0 ? Math.round((translated / total) * 100) : 0;

  const items: StatItem[] = [
    { icon: Layers, color: "var(--cyan)", value: total, label: "技能" },
    { icon: CheckCircle2, color: "var(--green)", value: translated, label: "已翻译" },
    { icon: FileWarning, color: "var(--amber)", value: lost, label: "译文丢失" },
    { icon: Package, color: "var(--rose)", value: packCount, label: "Packs" },
  ];

  return (
    <div className="glass mx-auto mt-[22px] flex w-full flex-wrap items-center gap-x-[22px] gap-y-[10px] rounded-lg px-[22px] py-[14px]">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-[9px] text-[13px] text-text-secondary">
          <span
            className="grid h-[30px] w-[30px] place-items-center rounded-[9px] border border-stroke bg-glass-2"
            style={{ color: item.color }}
            aria-hidden
          >
            <item.icon className="h-[15px] w-[15px]" />
          </span>
          <span>
            <b className="font-display text-[18px] font-semibold text-text-primary">
              {item.value}
            </b>{" "}
            {item.label}
          </span>
        </div>
      ))}

      {/* 翻译进度 */}
      <div className="ml-auto flex min-w-[220px] items-center gap-3 max-md:ml-0 max-md:w-full">
        <span className="whitespace-nowrap text-[12px] text-text-secondary">
          翻译进度 {pct}%
        </span>
        <div className="relative h-[7px] min-w-[120px] flex-1 overflow-hidden rounded-full bg-glass-2">
          <div className="prog-fill h-full" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
