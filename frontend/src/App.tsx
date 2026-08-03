import { useState, useCallback, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Toaster } from "@/components/ui/sonner";
import { BackgroundFX } from "@/components/layout/BackgroundFX";
import { Topbar } from "@/components/layout/Topbar";
import { StatBar } from "@/components/layout/StatBar";
import { TabNav, type TabMode } from "@/components/layout/TabNav";
import { Footer } from "@/components/layout/Footer";
import { HomeView } from "@/components/skill/HomeView";
import { CategoryView } from "@/components/skill/CategoryView";
import { PacksView } from "@/components/skill/PacksView";
import { PackCreateDialog } from "@/components/skill/PackCreateDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import type { PackAction } from "@/components/skill/PackCard";
import { DetailSheet } from "@/components/skill/DetailSheet";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { CommandSearch } from "@/components/common/CommandSearch";
import { ImportDialog } from "@/components/skill/ImportDialog";
import { UrlImportDialog } from "@/components/skill/UrlImportDialog";
import {
  packDelete,
  packExport,
  packInstall,
  packsList,
  type ImportSource,
  type PackInfo,
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

  const [tab, setTab] = useState<TabMode>("lib");
  const [view, setView] = useState<View>({ type: "home" });
  const [layout, setLayout] = useState<LayoutMode>(readLayout);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

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

  const handleGitImport = useCallback(() => {
    setUrlDialogOpen(true);
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
      if (action === "delete") {
        setDeleteTarget(pack);
      }
    },
    [refresh]
  );

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

      <Topbar
        totalSkills={totalSkills}
        syncing={syncing}
        onSearchClick={() => setCmdkOpen(true)}
        onSync={handleSync}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-[1180px] px-[26px] pb-20">
          <StatBar
            total={totalSkills}
            translated={translatedCount}
            outdated={0}
            packCount={packs.length}
          />

          <TabNav activeTab={tab} onChange={setTab} />

          {tab === "packs" ? (
            <PacksView
              packs={packs}
              onCreatePack={handleCreatePack}
              onImportPack={handleImportPack}
              onPackAction={handlePackAction}
            />
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
              onCreatePack={handleCreatePack}
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
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </main>

      <Footer />

      <DetailSheet
        skill={liveSelectedSkill}
        open={modalOpen}
        onClose={handleCloseModal}
        onSettingsOpen={() => setSettingsOpen(true)}
        onTranslateDone={handleSync}
      />

      {urlDialogOpen && (
        <UrlImportDialog
          onClose={() => setUrlDialogOpen(false)}
          onReady={(s) => setImportSource(s)}
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
        onSaved={refresh}
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
