import { Archive, GitBranch, Plus } from "lucide-react";
import { FolderCard } from "./FolderCard";
import { LayoutToggle } from "./LayoutToggle";
import { GhostCard } from "@/components/common/GhostCard";
import { SectionHead } from "@/components/common/SectionHead";
import { EmptyState } from "@/components/common/EmptyState";
import type { Skill, SkillGroup, LayoutMode } from "@/hooks/useSkills";

interface HomeViewProps {
  groups: SkillGroup[];
  layout: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  onFolderClick: (label: string) => void;
  onSkillClick: (skill: Skill) => void;
  onGitImport: () => void;
  onZipImport: () => void;
  onCreatePack: () => void;
}

export function HomeView({
  groups,
  layout,
  onLayoutChange,
  onFolderClick,
  onSkillClick,
  onGitImport,
  onZipImport,
  onCreatePack,
}: HomeViewProps) {
  const totalSkills = groups.reduce((sum, g) => sum + g.skills.length, 0);

  let idx = 0;

  return (
    <div className="relative py-6">
      <SectionHead
        title="技能库"
        subtitle={`${groups.length} 个分类 · ${totalSkills} 个技能 · 跨工具统一管理`}
      >
        <LayoutToggle value={layout} onChange={onLayoutChange} />
      </SectionHead>

      {groups.length === 0 ? (
        <EmptyState />
      ) : layout === "grid" ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <FolderCard
              key={g.label}
              group={g}
              index={idx++}
              layout="grid"
              onClick={() => onFolderClick(g.label)}
              onSkillClick={onSkillClick}
            />
          ))}
          <GhostCard
            icon={<Archive className="h-[22px] w-[22px]" />}
            title="导入本地 Zip"
            subtitle="选择或拖拽 zip 到窗口"
            index={idx++}
            onClick={onZipImport}
          />
          <GhostCard
            icon={<GitBranch className="h-[22px] w-[22px]" />}
            title="从 Git 仓库导入"
            subtitle="GitHub / Gitee 地址"
            index={idx++}
            onClick={onGitImport}
          />
          <GhostCard
            icon={<Plus className="h-[22px] w-[22px]" />}
            title="创建 Skill Pack"
            subtitle="组合打包你的技能"
            index={idx++}
            onClick={onCreatePack}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {groups.map((g) => (
            <FolderCard
              key={g.label}
              group={g}
              index={idx++}
              layout="list"
              onClick={() => onFolderClick(g.label)}
            />
          ))}
          <GhostCard
            layout="list"
            icon={<Archive className="h-5 w-5" />}
            title="导入本地 Zip"
            subtitle="选择或拖拽 zip 到窗口"
            index={idx++}
            onClick={onZipImport}
          />
          <GhostCard
            layout="list"
            icon={<GitBranch className="h-5 w-5" />}
            title="从 Git 仓库导入"
            subtitle="GitHub / Gitee 地址"
            index={idx++}
            onClick={onGitImport}
          />
          <GhostCard
            layout="list"
            icon={<Plus className="h-5 w-5" />}
            title="创建 Skill Pack"
            subtitle="组合打包你的技能"
            index={idx++}
            onClick={onCreatePack}
          />
        </div>
      )}
    </div>
  );
}
