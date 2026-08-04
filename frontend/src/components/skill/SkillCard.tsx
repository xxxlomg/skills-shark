import { memo, type CSSProperties } from "react";
import { Check, FolderSymlink } from "lucide-react";
import type { Skill } from "@/hooks/useSkills";
import { StatusBadge } from "./StatusBadge";

interface SkillCardProps {
  skill: Skill;
  index: number;
  layout: "grid" | "list";
  /** 工具注册表 id → 显示名（B4 徽标用；缺省回退原始 id） */
  toolNames?: Record<string, string>;
  onClick: () => void;
}

/** B4 installations 徽标：同名技能装于多个工具时，每个出处一枚 ✓ 徽标 */
function InstallBadges({ skill, toolNames }: { skill: Skill; toolNames?: Record<string, string> }) {
  if (skill.other_sources.length === 0) return null;
  const sources = [skill.tool_id, ...skill.other_sources];
  return (
    <span className="flex flex-wrap items-center gap-1">
      {sources.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-0.5 rounded border border-stroke bg-glass-2 px-1.5 py-px text-[10px] text-text-tertiary"
        >
          <Check aria-hidden className="h-2.5 w-2.5 text-green-500" />
          {toolNames?.[t] ?? t}
        </span>
      ))}
    </span>
  );
}

/**
 * 技能卡片：网格态为竖排玻璃卡（顶部装饰条），列表态为横排玻璃行（左侧竖条）。
 */
export const SkillCard = memo(function SkillCard({ skill, index, layout, toolNames, onClick }: SkillCardProps) {
  const displayName = skill.title_zh || skill.name;
  const wrapStyle = { "--i": index } as CSSProperties;

  if (layout === "list") {
    return (
      <div className="card-wrap" style={wrapStyle}>
        <button
          type="button"
          onClick={onClick}
          className="glass-card glass-card-hover card-glow relative flex w-full items-center gap-4 overflow-hidden px-[18px] py-[14px] text-left"
        >
          {/* 列表态：左侧竖向装饰条 */}
          <span className="absolute left-0 top-[20%] z-[1] h-[60%] w-[3px] rounded-r-[4px] bg-gradient-to-b from-brand to-cyan opacity-85" />
          <span className="relative z-[1] grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[12px] border border-stroke bg-glass-2 text-[20px]">
            {skill.emoji || "🧩"}
          </span>
          <div className="relative z-[1] min-w-0 flex-1">
            <h3 className="flex items-center gap-1.5 truncate font-display text-[15.5px] font-semibold text-text-primary">
              <span className="truncate">{displayName}</span>
              {skill.hub_linked && (
                <FolderSymlink
                  aria-label="Hub 链接落点"
                  className="h-3.5 w-3.5 shrink-0 text-text-tertiary"
                />
              )}
            </h3>
            <p className="truncate font-mono text-[11px] text-text-tertiary">
              {skill.name} · {skill.scan_label}
            </p>
            {skill.other_sources.length > 0 && (
              <div className="mt-1">
                <InstallBadges skill={skill} toolNames={toolNames} />
              </div>
            )}
          </div>
          <div className="relative z-[1] shrink-0">
            <StatusBadge skill={skill} />
          </div>
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
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[13px] border border-stroke bg-glass-2 text-[22px]">
            {skill.emoji || "🧩"}
          </span>
          <StatusBadge skill={skill} />
        </div>
        <h3 className="relative z-[1] mt-4 flex items-start gap-1.5 font-display text-[19px] font-semibold leading-snug text-text-primary">
          <span className="min-w-0">{displayName}</span>
          {skill.hub_linked && (
            <FolderSymlink
              aria-label="Hub 链接落点"
              className="mt-[5px] h-4 w-4 shrink-0 text-text-tertiary"
            />
          )}
        </h3>
        <p className="relative z-[1] mt-[3px] font-mono text-[12px] text-text-tertiary">
          {skill.name} · {skill.scan_label}
        </p>
        {skill.other_sources.length > 0 && (
          <div className="relative z-[1] mt-2">
            <InstallBadges skill={skill} toolNames={toolNames} />
          </div>
        )}
        <p className="relative z-[1] mt-[10px] line-clamp-2 text-[12.5px] leading-relaxed text-text-secondary">
          {skill.description_zh || skill.description || "暂无描述"}
        </p>
      </button>
    </div>
  );
}, (prev, next) =>
  // 忽略 onClick：闭包仅捕获稳定 skill + 父级稳定回调，同 skill 下行为等价
  prev.skill === next.skill &&
  prev.index === next.index &&
  prev.layout === next.layout &&
  prev.toolNames === next.toolNames
);
