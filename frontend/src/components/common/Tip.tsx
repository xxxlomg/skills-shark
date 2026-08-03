import type { ReactNode } from "react";

interface TipProps {
  label: string;
  children: ReactNode;
  /** 气泡相对子元素的位置，默认下方（卡片顶部空间常被 tab 占用） */
  side?: "top" | "bottom";
}

/**
 * 主题化悬浮提示：玻璃材质气泡，替代原生 title 的白底字条。
 * 纯 CSS 显隐（group-hover），无 JS 定位。
 */
export function Tip({ label, children, side = "bottom" }: TipProps) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`tip-bubble pointer-events-none absolute left-1/2 z-30 w-max max-w-[240px] -translate-x-1/2 rounded-[10px] px-[10px] py-[5px] text-[11px] leading-snug opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100 ${
          side === "top" ? "bottom-full mb-[6px]" : "top-full mt-[6px]"
        }`}
      >
        {label}
      </span>
    </span>
  );
}
