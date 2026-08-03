import { useState, useEffect, useCallback } from "react";
import {
  Key,
  Globe,
  Cpu,
  Save,
  Trash2,
  Eye,
  EyeOff,
  Wifi,
  FolderOpen,
  Plus,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Search,
  Loader2,
  Palette,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  loadLLMConfig,
  saveLLMConfig,
  LLM_DEFAULTS,
} from "@/lib/llm-config";
import { detectPaths } from "@/lib/api";
import type { ScanPathItem } from "@/lib/api";
import { testLLMConnection } from "@/lib/translate-api";
import { ACCENTS, getAccent, setAccent, type AccentId } from "@/lib/accent";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 保存成功后的回调（用于主界面刷新列表） */
  onSaved?: () => void;
}

export function SettingsDialog({ open, onOpenChange, onSaved }: SettingsDialogProps) {
  // LLM 配置
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(LLM_DEFAULTS.baseUrl);
  const [model, setModel] = useState(LLM_DEFAULTS.model);
  const [showKey, setShowKey] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [testing, setTesting] = useState(false);

  // 扫描路径
  const [scanPaths, setScanPaths] = useState<ScanPathItem[]>([]);
  const [pathExists, setPathExists] = useState<boolean[]>([]);
  const [newPath, setNewPath] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [loaded, setLoaded] = useState(false);

  // 检测默认路径
  const [detecting, setDetecting] = useState(false);

  // 主题色预设
  const [accent, setAccentState] = useState<AccentId>(() => getAccent());

  // 加载配置
  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    loadLLMConfig()
      .then((config) => {
        console.log("[settings] loadLLMConfig OK:", config);
        if (config.hasKey) {
          setApiKey(config.apiKey);
          setHasExisting(true);
        } else {
          setApiKey("");
          setHasExisting(false);
        }
        setBaseUrl(config.baseUrl || LLM_DEFAULTS.baseUrl);
        setModel(config.model || LLM_DEFAULTS.model);
        setScanPaths(config.scanPaths || []);
        setPathExists(config.pathExists || []);
        console.log("[settings] scanPaths loaded:", config.scanPaths);
      })
      .catch((err) => {
        console.error("[settings] loadLLMConfig ERROR:", err);
        toast.error("加载配置失败");
      })
      .finally(() => setLoaded(true));
    setShowKey(false);
    setNewPath("");
    setNewLabel("");
  }, [open]);

  const handleSave = useCallback(async () => {
    if (!loaded) {
      toast.error("配置尚未加载完成，请稍候");
      return;
    }
    // 兼容：表单里还填着一条未点"添加"的路径时，直接保存它
    let finalPaths = scanPaths;
    const pendingPath = newPath.trim();
    if (pendingPath) {
      const exists = scanPaths.some(
        (sp) => sp.path.replace(/\\+$/, "") === pendingPath.replace(/\\+$/, "")
      );
      if (exists) {
        toast.info("表单中填写的路径已在列表中，已直接保存");
      } else {
        finalPaths = [
          ...scanPaths,
          {
            path: pendingPath,
            label: newLabel.trim() || pendingPath,
            enabled: true,
          },
        ];
        toast.info(`已自动添加：${pendingPath}`);
      }
    }
    console.log(
      "[settings] handleSave -> scanPaths:",
      JSON.stringify(finalPaths)
    );
    console.log("[settings] handleSave -> llm:", {
      apiKey: apiKey.trim() ? "***" : "",
      baseUrl: baseUrl.trim(),
      model: model.trim(),
    });
    try {
      await saveLLMConfig(
        {
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim() || LLM_DEFAULTS.baseUrl,
          model: model.trim() || LLM_DEFAULTS.model,
        },
        finalPaths
      );
      console.log("[settings] saveLLMConfig OK");
      setHasExisting(true);
      toast.success("配置已保存");
      onOpenChange(false);
      onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      console.error("[settings] saveLLMConfig ERROR:", err);
      toast.error(`保存失败：${msg}`);
    }
  }, [apiKey, baseUrl, model, scanPaths, newPath, newLabel, onOpenChange, onSaved, loaded]);

  const handleClear = useCallback(async () => {
    try {
      await saveLLMConfig(
        {
          apiKey: "",
          baseUrl: LLM_DEFAULTS.baseUrl,
          model: LLM_DEFAULTS.model,
        },
        scanPaths
      );
      setApiKey("");
      setBaseUrl(LLM_DEFAULTS.baseUrl);
      setModel(LLM_DEFAULTS.model);
      setHasExisting(false);
      toast.success("LLM 配置已清除");
    } catch {
      toast.error("清除失败");
    }
  }, [scanPaths]);

  const handleTest = useCallback(async () => {
    if (!apiKey.trim()) {
      toast.error("请先填写 API Key");
      return;
    }
    setTesting(true);
    try {
      await testLLMConnection({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || LLM_DEFAULTS.baseUrl,
        model: model.trim() || LLM_DEFAULTS.model,
      });
      toast.success("连接成功，API 可用");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      toast.error(`连接失败：${msg}`);
    } finally {
      setTesting(false);
    }
  }, [apiKey, baseUrl, model]);

  // 扫描路径操作
  const addScanPath = useCallback(() => {
    if (!newPath.trim()) {
      toast.error("请输入路径");
      return;
    }
    const label = newLabel.trim() || newPath.trim();
    setScanPaths((prev) => [
      ...prev,
      { path: newPath.trim(), label, enabled: true },
    ]);
    setPathExists((prev) => [...prev, true]); // 新添加的默认标记为存在（保存后刷新会更新）
    setNewPath("");
    setNewLabel("");
  }, [newPath, newLabel]);

  const removeScanPath = useCallback((index: number) => {
    setScanPaths((prev) => prev.filter((_, i) => i !== index));
    setPathExists((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const toggleScanPath = useCallback((index: number) => {
    setScanPaths((prev) =>
      prev.map((sp, i) => (i === index ? { ...sp, enabled: !sp.enabled } : sp)),
    );
  }, []);

  // 检测默认路径
  const handleDetectPaths = useCallback(async () => {
    setDetecting(true);
    try {
      const newPaths = await detectPaths();
      if (newPaths.length === 0) {
        toast.info("未发现新的默认路径（所有已知 AI 工具路径要么不存在，要么已配置）");
        return;
      }
      setScanPaths((prev) => [...prev, ...newPaths]);
      setPathExists((prev) => [...prev, ...newPaths.map(() => true)]);
      toast.success(`检测到 ${newPaths.length} 个新路径，已添加（记得点保存）`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知错误";
      toast.error(`检测失败：${msg}`);
    } finally {
      setDetecting(false);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg overflow-hidden [&>*]:min-w-0"
        showCloseButton={false}
      >
        <div className="gradient-bar -mx-6 -mt-6 mb-2 rounded-t-lg" />

        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            ⚙️ 设置
          </DialogTitle>
          <DialogDescription>
            配置 LLM API 密钥和 Skills 扫描路径。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="llm" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="llm" className="flex-1 text-xs">
              <Key className="mr-1 h-3 w-3" />
              LLM 配置
            </TabsTrigger>
            <TabsTrigger value="paths" className="flex-1 text-xs">
              <FolderOpen className="mr-1 h-3 w-3" />
              扫描路径
            </TabsTrigger>
            <TabsTrigger value="appearance" className="flex-1 text-xs">
              <Palette className="mr-1 h-3 w-3" />
              外观
            </TabsTrigger>
          </TabsList>

          {/* LLM 配置 Tab */}
          <TabsContent value="llm" className="space-y-4 pt-3">
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Key className="h-3.5 w-3.5" />
                API Key
              </label>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Globe className="h-3.5 w-3.5" />
                Base URL
              </label>
              <Input
                type="text"
                placeholder={LLM_DEFAULTS.baseUrl}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Cpu className="h-3.5 w-3.5" />
                Model
                <span className="text-xs text-muted-foreground font-normal">
                  （可选）
                </span>
              </label>
              <Input
                type="text"
                placeholder={LLM_DEFAULTS.model}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing}
                className="text-xs"
              >
                <Wifi className="mr-1 h-3 w-3" />
                {testing ? "测试中..." : "测试连接"}
              </Button>
              <div className="flex-1" />
              {hasExisting && (
                <Button
                  variant="outline"
                  onClick={handleClear}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              ⚠️ API Key 存储在后端 _data/config.json，仅本地使用。
            </p>
          </TabsContent>

          {/* 扫描路径 Tab */}
          <TabsContent value="paths" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">
              添加 Skills 所在的文件夹路径。系统会递归扫描每个路径下含 SKILL.md 的子目录（最深 3 层）。
            </p>

            {/* 已有路径列表 */}
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {scanPaths.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  暂无扫描路径
                </p>
              )}
              {scanPaths.map((sp, i) => {
                const exists = i < pathExists.length ? pathExists[i] : true;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2 rounded-lg border p-2 transition-colors ${
                      !exists
                        ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20"
                        : "border-border"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleScanPath(i)}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      title={sp.enabled ? "点击禁用" : "点击启用"}
                    >
                      {sp.enabled ? (
                        <ToggleRight className="h-[26px] w-[26px] text-green-500" />
                      ) : (
                        <ToggleLeft className="h-[26px] w-[26px]" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{sp.label}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {sp.path}
                      </p>
                      {!exists && (
                        <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                          <AlertTriangle className="h-3 w-3" />
                          目录不存在
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => removeScanPath(i)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>

            {/* 检测默认路径按钮 */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDetectPaths}
              disabled={detecting || !loaded}
              className="w-full text-xs"
            >
              {detecting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="mr-1.5 h-3.5 w-3.5" />
              )}
              {detecting ? "检测中…" : "检测默认 AI 工具路径"}
            </Button>

            {/* 添加新路径 */}
            <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                添加扫描路径
              </p>
              <Input
                type="text"
                placeholder="文件夹路径，如 C:\Users\xxx\.cursor\skills"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                className="text-xs"
                disabled={!loaded}
              />
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="标签，如 Cursor"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  className="text-xs flex-1 min-w-0"
                  disabled={!loaded}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addScanPath}
                  className="text-xs"
                  disabled={!loaded}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  添加
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* 外观 Tab */}
          <TabsContent value="appearance" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">
              界面主题色，点击立即生效并自动保存。
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setAccent(a.id);
                    setAccentState(a.id);
                  }}
                  className={`flex items-center gap-2 rounded-lg border p-2.5 transition-colors ${
                    accent === a.id
                      ? "border-stroke-hi bg-glass-2"
                      : "border-border hover:border-stroke-hi"
                  }`}
                >
                  <span className="flex shrink-0 -space-x-1.5">
                    <span
                      className="h-4 w-4 rounded-full ring-1 ring-black/20"
                      style={{ background: a.dark }}
                    />
                    <span
                      className="h-4 w-4 rounded-full ring-1 ring-white/40"
                      style={{ background: a.light }}
                    />
                  </span>
                  <span className="text-sm text-foreground">{a.name}</span>
                  {accent === a.id && (
                    <Check className="ml-auto h-4 w-4 text-[var(--accent)]" />
                  )}
                </button>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {/* 保存按钮 */}
        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} className="w-full" disabled={!loaded}>
            <Save className="mr-1.5 h-4 w-4" />
            {loaded ? "保存配置" : "加载配置中…"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
