import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TipProps {
  label: string;
  children: ReactNode;
  /** 气泡相对子元素的位置，默认下方（卡片顶部空间常被 tab 占用） */
  side?: "top" | "bottom";
}

/**
 * 主题化悬浮提示：玻璃材质气泡，替代原生 title 的白底字条。
 *
 * 基于 Radix Tooltip 的 Portal 渲染到 body：
 * 卡片带 backdrop-filter（独立层叠上下文）且 overflow-hidden，
 * 卡内绝对定位气泡会被兄弟卡片遮挡、被卡片裁切；
 * Portal + z-50 一次性 escape 两者（网格/列表态均适用）。
 */
export function Tip({ label, children, side = "bottom" }: TipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={6}
        className="tip-bubble max-w-[240px] rounded-[10px] border-0 px-[10px] py-[5px] text-[11px] leading-snug"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
