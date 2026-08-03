import { Download, Package, Plus } from "lucide-react";
import { PackCard, type PackAction } from "./PackCard";
import type { PackInfo } from "@/lib/api";
import { GhostCard } from "@/components/common/GhostCard";
import { SectionHead } from "@/components/common/SectionHead";

interface PacksViewProps {
  packs: PackInfo[];
  onCreatePack: () => void;
  onImportPack: () => void;
  onPackAction: (action: PackAction, pack: PackInfo) => void;
}

/** Skill Packs 视图：Pack 卡片网格 + 导入 ghost 卡（PLAN-05 P1 真实数据）。 */
export function PacksView({
  packs,
  onCreatePack,
  onImportPack,
  onPackAction,
}: PacksViewProps) {
  let idx = 0;

  return (
    <div className="relative py-6">
      <SectionHead
        title="Skill Packs"
        subtitle="自由组合技能、封装成包，一键分享与安装"
      >
        <button type="button" className="mbtn primary" onClick={onCreatePack}>
          <Plus className="h-3.5 w-3.5" />
          新建 Pack
        </button>
      </SectionHead>

      {packs.length === 0 ? (
        <div className="flex flex-col items-center gap-6 py-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-[16px] border border-stroke bg-glass-2 text-brand">
              <Package className="h-7 w-7" />
            </span>
            <h3 className="font-display text-[17px] font-semibold text-text-primary">
              还没有 Skill Pack
            </h3>
            <p className="max-w-xs text-[13px] leading-relaxed text-text-secondary">
              把常用技能组合打包，一键分享给团队，或导入别人做好的包。
            </p>
          </div>
          <div className="grid w-full max-w-[560px] grid-cols-2 gap-5">
            <GhostCard
              icon={<Plus className="h-[22px] w-[22px]" />}
              title="新建 Pack"
              subtitle="从技能库挑选技能打包"
              index={idx++}
              onClick={onCreatePack}
            />
            <GhostCard
              icon={<Download className="h-[22px] w-[22px]" />}
              title="导入 .skillpack"
              subtitle="拖入或选择打包文件"
              index={idx++}
              onClick={onImportPack}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((p) => (
            <PackCard key={p.id} pack={p} index={idx++} onAction={onPackAction} />
          ))}
          <GhostCard
            icon={<Download className="h-[22px] w-[22px]" />}
            title="导入 .skillpack"
            subtitle="拖入或选择打包文件"
            index={idx++}
            onClick={onImportPack}
          />
        </div>
      )}
    </div>
  );
}
