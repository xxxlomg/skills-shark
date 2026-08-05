import { useState, useCallback, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Toaster } from "@/components/ui/sonner";
import { BackgroundFX } from "@/components/layout/BackgroundFX";
import { Topbar } from "@/components/layout/Topbar";
import { StatBar } from "@/components/layout/StatBar";
import { TabNav } from "@/components/layout/TabNav";
import { DEFAULT_VIEW, type ViewId } from "@/lib/view-registry";
import { HubView } from "@/components/hub/HubView";
import { LinkDialog } from "@/components/hub/LinkDialog";
import { Footer } from "@/components/layout/Footer";
import { HomeView } from "@/components/skill/HomeView";
import { CategoryView } from "@/components/skill/CategoryView";
import { PacksView } from "@/components/skill/PacksView";
import { PackCreateDialog } from "@/components/skill/PackCreateDialog";
import { CreationView } from "@/components/skill/CreationView";
import { ManualView } from "@/components/manual/ManualView";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import type { PackAction } from "@/components/skill/PackCard";
import { DetailSheet } from "@/components/skill/DetailSheet";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { CommandSearch } from "@/components/common/CommandSearch";
import { ImportDialog } from "@/components/skill/ImportDialog";
import { UrlImportDialog } from "@/components/skill/UrlImportDialog";
import { RepoBrowseDialog } from "@/components/skill/RepoBrowseDialog";
import {
  packDelete,
  packExport,
  packInstall,
  packsList,
  hubListTools,
  gitStatus,
  publishPack,
  type GitStatusInfo,
  type ImportSource,
  type PackInfo,
  type RepoImportResult,
} from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { useSkills, type Skill, type LayoutMode } from "@/hooks/useSkills";

declare global {
  interface Window {
    hideSplash?: () => void;
  }
}

type View = { type: "home" } | { type: "category"; label: string };

function readLayout(): LayoutMode {
  try {
    const v = localStorage.getItem("sm:layout");
    if (v === "list" || v === "grid") return v;
  } catch { /* ignore */ }
  return "grid";
}

function App() {
  const { skills, groups, loading, error, sync, refresh } = useSkills();

  const [tab, setTab] = useState<ViewId>(DEFAULT_VIEW);
  const [view, setView] = useState<View>({ type: "home" });
  const [layout, setLayout] = useState<LayoutMode>(readLayout);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // 模块 A 发布侧：git/仓库健康度（发布按钮使能依据，§1.11）
  const [gitInfo, setGitInfo] = useState<GitStatusInfo | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const refreshGitInfo = useCallback(() => {
    gitStatus().then(setGitInfo).catch(() => setGitInfo(null));
  }, []);
  useEffect(() => {
    refreshGitInfo();
  }, [refreshGitInfo]);

  const handleLayoutChange = useCallback((mode: LayoutMode) => {
    setLayout(mode);
    try { localStorage.setItem("sm:layout", mode); } catch { /* ignore */ }
  }, []);

  const handleFolderClick = useCallback((label: string) => {
    setView({ type: "category", label });
  }, []);

  const handleBack = useCallback(() => {
    setView({ type: "home" });
  }, []);

  const handleSkillClick = useCallback((skill: Skill) => {
    setSelectedSkill(skill);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await sync();
    } finally {
      setSyncing(false);
    }
  }, [sync]);

  // Skill Packs（PLAN-05 P1：真实数据）
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [packDialogOpen, setPackDialogOpen] = useState(false);
  // PLAN-07 W1：HomeView 新建技能 → 切创作 tab + 进空工作台（信号消费后归零）
  const [newSignal, setNewSignal] = useState(0);
  // PLAN-07：工作台沉浸态 → 隐藏 StatBar/TabNav
  const [wbActive, setWbActive] = useState(false);
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PackInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadPacks = useCallback(async () => {
    try {
      setPacks(await packsList());
    } catch (e) {
      console.error("packs_list failed:", e);
      setPacks([]);
    }
  }, []);

  useEffect(() => {
    loadPacks();
  }, [loadPacks]);

  // ---- 导入（PLAN-04 §3：zip 本地 + URL 远程）----
  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);

  // ---- Hub 引用（PLAN-06 §2.8，B5）：新建引用对话框由 App 统一持有，
  // Hub 页与技能详情页共用同一实例 ----
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkInitialSkillId, setLinkInitialSkillId] = useState<string | null>(null);

  const openLinkDialog = useCallback((skillId?: string) => {
    setLinkInitialSkillId(skillId ?? null);
    setLinkDialogOpen(true);
  }, []);

  const closeLinkDialog = useCallback(() => {
    setLinkDialogOpen(false);
    setLinkInitialSkillId(null);
  }, []);

  // 建链成功后联动刷新：技能扫描 + Hub 台账令牌（修复台账不自动刷新）
  const [hubToken, setHubToken] = useState(0);

  // B4：工具注册表 id → 显示名（卡片 installations 徽标用）
  const [toolNames, setToolNames] = useState<Record<string, string>>({});
  const loadToolNames = useCallback(async () => {
    try {
      const list = await hubListTools();
      setToolNames(Object.fromEntries(list.map((t) => [t.id, t.name])));
    } catch {
      // 拿不到就用原始 id 回退（SkillCard/DetailSheet 内部已兜底）
    }
  }, []);
  useEffect(() => {
    loadToolNames();
  }, [loadToolNames]);

  const handleLinked = useCallback(() => {
    refresh();
    setHubToken((t) => t + 1);
    loadToolNames();
  }, [refresh, loadToolNames]);

  // 设置页工具管理改动（启停/增删/删带引用工具）同样要刷 Hub 台账
  const handleSettingsSaved = useCallback(() => {
    refresh();
    setHubToken((t) => t + 1);
    loadToolNames();
    refreshGitInfo(); // 仓库配置可能在设置页变更
  }, [refresh, loadToolNames, refreshGitInfo]);

  const handleGitImport = useCallback(() => {
    setUrlDialogOpen(true);
  }, []);

  // PLAN-07 W1：新建技能统一进创作工作台（退役 NewSkillDialog）
  const handleNewSkill = useCallback(() => {
    setTab("create");
    setNewSignal((s) => s + 1);
  }, []);

  // 拖拽 zip / skillpack 到窗口任意位置 → 打开导入对话框
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ paths: string[] }>("tauri://drag-drop", (e) => {
      const file = e.payload.paths.find((p) => {
        const lp = p.toLowerCase();
        return lp.endsWith(".zip") || lp.endsWith(".skillpack");
      });
      if (file) setImportSource({ kind: "zip", path: file });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const handleZipImport = useCallback(async () => {
    const file = await open({
      multiple: false,
      filters: [
        { name: "技能包", extensions: ["zip", "skillpack"] },
      ],
    });
    if (typeof file === "string") setImportSource({ kind: "zip", path: file });
  }, []);

  const handleImported = useCallback(
    (stem: string) => {
      toast.success(`已导入到「${stem}」库`);
      refresh();
      setTab("lib");
      setView({ type: "category", label: "导入" });
    },
    [refresh]
  );

  const handleCreatePack = useCallback(() => {
    setPackDialogOpen(true);
  }, []);

  const handleImportPack = useCallback(() => {
    // 与 zip 导入同入口：后端按 pack.json 自动分流（PLAN-05 §3）
    handleZipImport();
  }, [handleZipImport]);

  const handleRepoImport = useCallback(() => {
    setRepoDialogOpen(true);
  }, []);

  const handleRepoImported = useCallback(
    (result: RepoImportResult) => {
      const ok = result.imported.length;
      const fail = result.failed.length;
      if (fail === 0) {
        toast.success(`已从货架导入 ${ok} 个 Pack`);
      } else {
        toast.warning(`导入完成：${ok} 成功 / ${fail} 失败`);
      }
      loadPacks();
      setTab("packs");
    },
    [loadPacks]
  );

  const handlePackImported = useCallback(
    (info: PackInfo) => {
      toast.success(`Pack「${info.name}」已导入`);
      loadPacks();
      setTab("packs");
    },
    [loadPacks]
  );

  const handlePackAction = useCallback(
    async (action: PackAction, pack: PackInfo) => {
      if (action === "install") {
        try {
          const n = await packInstall(pack.id);
          toast.success(`已安装 ${n} 个技能到「${pack.name}」库`);
          await refresh();
          setTab("lib");
          setView({ type: "home" });
        } catch (e) {
          toast.error(`安装失败：${String(e)}`);
        }
        return;
      }
      if (action === "export") {
        try {
          const dest = await save({
            defaultPath: `${pack.name.replace(/[\\/:*?"<>|]/g, "-")}.skillpack`,
            filters: [{ name: "Skill Pack", extensions: ["skillpack"] }],
          });
          if (!dest) return;
          const size = await packExport(pack.id, dest);
          const mb = size / 1024 / 1024;
          toast.success(`已导出（${mb < 0.1 ? "<0.1" : mb.toFixed(1)} MB）`);
          if (size > 50 * 1024 * 1024) {
            toast.warning("导出文件超过 50MB，分享时注意体积");
          }
        } catch (e) {
          toast.error(`导出失败：${String(e)}`);
        }
        return;
      }
      if (action === "publish") {
        setPublishingId(pack.id);
        try {
          const r = await publishPack({ packId: pack.id });
          toast.success(
            r.rebase_retried
              ? `已发布（远端有新提交，自动 rebase 后推送成功）：${r.pack_path}`
              : `已发布到仓库：${r.pack_path}`
          );
          if (r.repo_url) {
            toast.info(`仓库地址：${r.repo_url}`, { duration: 6000 });
          }
          refreshGitInfo();
        } catch (e) {
          toast.error(`发布失败：${String(e)}`, { duration: 8000 });
          refreshGitInfo();
        } finally {
          setPublishingId(null);
        }
        return;
      }
      if (action === "delete") {
        setDeleteTarget(pack);
      }
    },
    [refresh, refreshGitInfo]
  );

  // 发布按钮禁用原因（§1.9 降级立场：不静默失败，明确引导）
  const publishDisabledReason = useMemo(() => {
    if (!gitInfo) return "正在检测 git 环境…";
    if (!gitInfo.installed)
      return "未检测到系统 git——请安装 git，或改用「导出」后自行上传";
    if (!gitInfo.repo_configured)
      return "请先在设置 →「技能仓库」配置本地仓库与远端";
    if (!gitInfo.repo_exists)
      return "配置的仓库路径无效——请在设置中重新初始化";
    if (!gitInfo.clean) return "仓库有未提交改动，请先处理再发布";
    return undefined;
  }, [gitInfo]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await packDelete(deleteTarget.id);
      toast.success(`Pack「${deleteTarget.name}」已删除`);
      setDeleteTarget(null);
      loadPacks();
    } catch (e) {
      toast.error(`删除失败：${String(e)}`);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, loadPacks]);

  const totalSkills = useMemo(
    () => groups.reduce((sum, g) => sum + g.skills.length, 0),
    [groups]
  );

  const translatedCount = useMemo(
    () => skills.filter((s) => s.has_translation).length,
    [skills]
  );

  const lostCount = useMemo(
    () => skills.filter((s) => s.translation_lost).length,
    [skills]
  );

  // 首屏加载结束 → 淡出启动蒙版
  useEffect(() => {
    if (!loading) window.hideSplash?.();
  }, [loading]);

  // 兜底：无论加载是否完成，4s 后强制移除蒙版，防止卡死白屏
  useEffect(() => {
    const t = setTimeout(() => window.hideSplash?.(), 4000);
    return () => clearTimeout(t);
  }, []);

  // 全局 Ctrl/Cmd + K 唤起搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 当前分类的 skills
  const currentGroup = useMemo(() => {
    if (view.type !== "category") return null;
    return groups.find((g) => g.label === view.label) ?? null;
  }, [view, groups]);

  // 抽屉 skill 用列表里的 live 对象：翻译完成 sync 后 title_zh/description_zh
  // 立即生效，不用关抽屉重开。列表里找不到（源被删等）回退快照。
  const liveSelectedSkill = useMemo(() => {
    if (!selectedSkill) return null;
    return skills.find((s) => s.id === selectedSkill.id) ?? selectedSkill;
  }, [skills, selectedSkill]);

  return (
    <>
      <BackgroundFX />

      {/* PLAN-08 §2.1：工作台态沉浸——隐藏全局 header（Topbar）与 Footer */}
      {!wbActive && (
        <Topbar
          totalSkills={totalSkills}
          syncing={syncing}
          onSearchClick={() => setCmdkOpen(true)}
          onSync={handleSync}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      <main className="flex-1">
        {/* PLAN-08 三轮：工作台态全宽 + 无底部留白（页面不滚，内部自滚） */}
        <div
          className={
            wbActive
              ? "mx-auto w-full px-[26px]"
              : "mx-auto w-full max-w-[1180px] px-[26px] pb-20"
          }
        >
          {!wbActive && (
            <StatBar
              total={totalSkills}
              translated={translatedCount}
              outdated={0}
              lost={lostCount}
              packCount={packs.length}
            />
          )}

          {!wbActive && <TabNav activeTab={tab} onChange={setTab} />}

          {/* 视图分发：按视图注册表 id 路由（PLAN-06 §7.6）。
              新视图登记 VIEW_REGISTRY 后在此加一行渲染即可。
              key={tab} 触发轻量淡入（animate-view-enter），缓解 tab 切换生硬感。 */}
          <div key={tab} className="animate-view-enter">
          {tab === "hub" ? (
            <HubView
              onOpenLink={() => openLinkDialog()}
              onSkillsRefresh={refresh}
              refreshToken={hubToken}
              layout={layout}
              onLayoutChange={handleLayoutChange}
            />
          ) : tab === "packs" ? (
            <PacksView
              packs={packs}
              onCreatePack={handleCreatePack}
              onImportPack={handleImportPack}
              onRepoImport={handleRepoImport}
              onPackAction={handlePackAction}
              layout={layout}
              onLayoutChange={handleLayoutChange}
              publishDisabledReason={publishDisabledReason}
              publishingId={publishingId}
            />
          ) : tab === "create" ? (
            <CreationView
              skills={skills}
              refresh={refresh}
              layout={layout}
              onLayoutChange={handleLayoutChange}
              newSignal={newSignal}
              onNewSignalConsumed={() => setNewSignal(0)}
              onWorkbenchChange={setWbActive}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ) : tab === "manual" ? (
            <ManualView />
          ) : error ? (
            <EmptyState hasError errorMessage={error} />
          ) : loading ? (
            <div className="grid gap-5 pt-8 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="glass-card p-6">
                  <div className="mb-3 h-1 w-full animate-pulse rounded bg-glass-2" />
                  <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-glass-2" />
                  <div className="mb-4 h-3 w-1/2 animate-pulse rounded bg-glass-2" />
                  <div className="h-3 w-full animate-pulse rounded bg-glass-2" />
                  <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-glass-2" />
                </div>
              ))}
            </div>
          ) : view.type === "home" ? (
            <HomeView
              groups={groups}
              layout={layout}
              onLayoutChange={handleLayoutChange}
              onFolderClick={handleFolderClick}
              onSkillClick={handleSkillClick}
              onGitImport={handleGitImport}
              onZipImport={handleZipImport}
              onNewSkill={handleNewSkill}
            />
          ) : currentGroup ? (
            <CategoryView
              key={view.label}
              label={view.label}
              skills={currentGroup.skills}
              layout={layout}
              onLayoutChange={handleLayoutChange}
              onBack={handleBack}
              onSkillClick={handleSkillClick}
              onSettingsOpen={() => setSettingsOpen(true)}
              onTranslateDone={handleSync}
              toolNames={toolNames}
            />
          ) : (
            <EmptyState />
          )}
          </div>
        </div>
      </main>

      {!wbActive && <Footer />}

      <DetailSheet
        skill={liveSelectedSkill}
        open={modalOpen}
        onClose={handleCloseModal}
        onSettingsOpen={() => setSettingsOpen(true)}
        onTranslateDone={handleSync}
        onLinkSkill={(s) => openLinkDialog(s.id)}
        toolNames={toolNames}
        onEdited={refresh}
      />

      {linkDialogOpen && (
        <LinkDialog
          skills={skills}
          initialSkillId={linkInitialSkillId}
          onClose={closeLinkDialog}
          onLinked={handleLinked}
        />
      )}

      {urlDialogOpen && (
        <UrlImportDialog
          onClose={() => setUrlDialogOpen(false)}
          onReady={(s) => setImportSource(s)}
        />
      )}

      {repoDialogOpen && (
        <RepoBrowseDialog
          onClose={() => setRepoDialogOpen(false)}
          onImported={handleRepoImported}
        />
      )}

      {importSource && (
        <ImportDialog
          source={importSource}
          onClose={() => setImportSource(null)}
          onImported={handleImported}
          onPackImported={handlePackImported}
        />
      )}

      {packDialogOpen && (
        <PackCreateDialog
          skills={skills}
          onClose={() => setPackDialogOpen(false)}
          onCreated={(info) => {
            toast.success(`Pack「${info.name}」已创建`);
            loadPacks();
            setTab("packs");
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}
        title="删除 Pack"
        description={`确定删除「${deleteTarget?.name ?? ""}」吗？\n只移除 Packs 库中的记录，已导出的 .skillpack 文件不受影响。`}
        confirmText="删除"
        variant="destructive"
        loading={deleting}
        onConfirm={handleConfirmDelete}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={handleSettingsSaved}
      />

      <CommandSearch
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        groups={groups}
        onSkillSelect={(skill) => {
          setSelectedSkill(skill);
          setModalOpen(true);
        }}
        onCategorySelect={(label) => {
          setTab("lib");
          setView({ type: "category", label });
        }}
        onGitImport={() => setUrlDialogOpen(true)}
        onCreatePack={() => setPackDialogOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <Toaster position="top-center" />
    </>
  );
}

export default App;
