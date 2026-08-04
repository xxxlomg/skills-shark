import { useLayoutEffect, useRef, useState } from "react";
import { VIEW_REGISTRY, type ViewId } from "@/lib/view-registry";

interface TabNavProps {
  activeTab: ViewId;
  onChange: (tab: ViewId) => void;
}

/**
 * 主导航，带滑块指示器。
 *
 * PLAN-06 §7.6：导航项完全数据驱动——本组件只消费 VIEW_REGISTRY
 * （id + 标题 + 图标 + 权重），不硬编码 Tab 数量与顺序、不感知具体业务视图。
 * 交互稿定稿后改注册表数据即接入，不重写本组件。
 *
 * 视觉来源：docs/style.css .tabnav / .tab-ind
 * 滑块位置通过 ref 测量按钮 offsetLeft/offsetWidth 计算，resize 时重算。
 */
export function TabNav({ activeTab, onChange }: TabNavProps) {
  const btnRefs = useRef<Map<ViewId, HTMLButtonElement | null>>(new Map());
  const [indicator, setIndicator] = useState({ x: 0, width: 0, ready: false });

  useLayoutEffect(() => {
    const measure = () => {
      const btn = btnRefs.current.get(activeTab);
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

        {VIEW_REGISTRY.map((view) => {
          const active = activeTab === view.id;
          const Icon = view.icon;
          return (
            <button
              key={view.id}
              type="button"
              ref={(el) => {
                btnRefs.current.set(view.id, el);
              }}
              onClick={() => onChange(view.id)}
              aria-pressed={active}
              className={`relative z-[2] flex items-center gap-[7px] rounded-[10px] border-0 bg-transparent px-[18px] py-2 font-body text-[13.5px] font-medium transition-colors duration-250 ${
                active ? "text-text-primary" : "text-text-secondary"
              }`}
              style={{ cursor: "pointer" }}
            >
              <Icon className="h-[15px] w-[15px]" />
              {view.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
