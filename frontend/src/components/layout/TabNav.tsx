import { useLayoutEffect, useRef, useState } from "react";
import { Boxes, Package } from "lucide-react";

export type TabMode = "lib" | "packs";

interface TabNavProps {
  activeTab: TabMode;
  onChange: (tab: TabMode) => void;
}

const TABS: { key: TabMode; label: string; icon: typeof Boxes }[] = [
  { key: "lib", label: "技能库", icon: Boxes },
  { key: "packs", label: "Packs", icon: Package },
];

/**
 * 双 Tab 导航（技能库 / Packs），带滑块指示器。
 * 视觉来源：docs/style.css .tabnav / .tab-ind
 * 滑块位置通过 ref 测量按钮 offsetLeft/offsetWidth 计算，resize 时重算。
 */
export function TabNav({ activeTab, onChange }: TabNavProps) {
  const btnRefs = useRef<Record<TabMode, HTMLButtonElement | null>>({
    lib: null,
    packs: null,
  });
  const [indicator, setIndicator] = useState({ x: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const measure = () => {
      const btn = btnRefs.current[activeTab];
      if (!btn) return;
      // tab-ind 定位在 left:5px，按钮 offsetLeft 相对 nav（offsetParent）
      setIndicator({
        x: btn.offsetLeft - 5,
        width: btn.offsetWidth,
        ready: true,
      });
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeTab]);

  return (
    <div className="text-center">
      <nav
        className="relative mt-[26px] inline-flex gap-1 rounded-[14px] border border-stroke bg-glass p-[5px]"
        style={{ backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}
        aria-label="主导航"
      >
        {/* 滑块指示器 */}
        <span
          aria-hidden
          className="absolute left-[5px] top-[5px] z-[1] h-[calc(100%-10px)] rounded-[10px] border border-stroke-hi bg-glass-2"
          style={{
            transform: `translateX(${indicator.x}px)`,
            width: indicator.width,
            boxShadow: "0 4px 14px -6px var(--glow)",
            transition:
              "transform 0.35s cubic-bezier(0.4,0,0.2,1), width 0.35s cubic-bezier(0.4,0,0.2,1)",
            opacity: indicator.ready ? 1 : 0,
          }}
        />

        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              ref={(el) => {
                btnRefs.current[tab.key] = el;
              }}
              onClick={() => onChange(tab.key)}
              aria-pressed={active}
              className={`relative z-[2] flex items-center gap-[7px] rounded-[10px] border-0 bg-transparent px-[18px] py-2 font-body text-[13.5px] font-medium transition-colors duration-250 ${
                active ? "text-text-primary" : "text-text-secondary"
              }`}
              style={{ cursor: "pointer" }}
            >
              <tab.icon className="h-[15px] w-[15px]" />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
