import { useMemo } from "react";
import { Archive, FolderPlus, GitBranch } from "lucide-react";
import { FolderCard } from "./FolderCard";
import { LayoutToggle } from "./LayoutToggle";
import { GhostCard } from "@/components/common/GhostCard";
import { EmptyPanel } from "@/components/common/EmptyPanel";
import { SectionHead } from "@/components/common/SectionHead";
import type { Skill, SkillGroup, LayoutMode } from "@/hooks/useSkills";

interface HomeViewProps {
  groups: SkillGroup[];
  layout: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
  onFolderClick: (label: string) => void;
  onSkillClick: (skill: Skill) => void;
  onGitImport: () => void;
  onZipImport: () => void;
  /** 技能库页头「新建文件夹」入口（顶栏布局的主入口） */
  onNewFolder?: () => void;
  /** 本会话新建的空工具根（0 技能），补一张空卡片 */
  extraFolderLabels?: string[];
}

export function HomeView({
  groups,
  layout,
  onLayoutChange,
  onFolderClick,
  onSkillClick,
  onGitImport,
  onZipImport,
  onNewFolder,
  extraFolderLabels,
}: HomeViewProps) {
  const totalSkills = groups.reduce((sum, g) => sum + g.skills.length, 0);

  // 新建但尚无技能的工具根（不在 groups 里），补空卡片
  const extraTools = useMemo(
    () =>
      (extraFolderLabels ?? []).filter(
        (l) => !groups.some((g) => g.label === l)
      ),
    [extraFolderLabels, groups]
  );

  let idx = 0;

  return (
    <div className="relative py-6">
      <SectionHead
        title="技能库"
        subtitle={`${groups.length} 个分类 · ${totalSkills} 个技能 · 跨工具统一管理`}
      >
        {onNewFolder && (
          <button
            type="button"
            onClick={onNewFolder}
            title="新建文件夹"
            aria-label="新建文件夹"
            className="iconbtn shrink-0"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        )}
        <LayoutToggle value={layout} onChange={onLayoutChange} />
      </SectionHead>

      {groups.length === 0 ? (
        <EmptyPanel
          icon={<Archive className="h-7 w-7" />}
          title="技能库还是空的"
          description="导入本地 zip、从 Git 仓库拉取，或点「新建技能」，开始构建你的技能库。"
          actions={[
            <GhostCard
              key="zip"
              icon={<Archive className="h-[22px] w-[22px]" />}
              title="导入本地 Zip"
              subtitle="选择或拖拽 zip 到窗口"
              index={0}
              onClick={onZipImport}
            />,
            <GhostCard
              key="git"
              icon={<GitBranch className="h-[22px] w-[22px]" />}
              title="从 Git 仓库导入"
              subtitle="GitHub / Gitee 地址"
              index={1}
              onClick={onGitImport}
            />,
          ]}
        />
      ) : layout === "grid" ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {/* 导入入口独占一行（grid）：与数据卡片分行，消除割裂感 */}
          <div className="col-span-full grid gap-5 sm:grid-cols-2">
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
          </div>
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
          {extraTools.map((l) => (
            <FolderCard
              key={`empty:${l}`}
              group={{ label: l, skills: [] }}
              index={idx++}
              layout="grid"
              onClick={() => onFolderClick(l)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
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
          {groups.map((g) => (
            <FolderCard
              key={g.label}
              group={g}
              index={idx++}
              layout="list"
              onClick={() => onFolderClick(g.label)}
            />
          ))}
          {extraTools.map((l) => (
            <FolderCard
              key={`empty:${l}`}
              group={{ label: l, skills: [] }}
              index={idx++}
              layout="list"
              onClick={() => onFolderClick(l)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
