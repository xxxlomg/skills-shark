import { useMemo, useState } from "react";
import { Check, Loader2, PackagePlus, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { packCreate, type PackInfo, type PackSkillInput } from "@/lib/api";
import {
  isPackCreateError,
  packErrorText,
  type SkillValidationFailure,
} from "@/lib/api";
import type { Skill } from "@/hooks/useSkills";

interface PackCreateDialogProps {
  skills: Skill[];
  onClose: () => void;
  onCreated: (info: PackInfo) => void;
}

/** 新建 Pack 对话框（PLAN-05 P1）：挑选技能 + 元信息 → 静态总结打包。 */
export function PackCreateDialog({ skills, onClose, onCreated }: PackCreateDialogProps) {
  const [name, setName] = useState("");
  const [ver, setVer] = useState("1.0.0");
  const [author, setAuthor] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // C4：校验门拒绝清单（force 逃生门的展示依据）
  const [failures, setFailures] = useState<SkillValidationFailure[] | null>(null);

  // 源文件已删除的孤儿条目不可打包
  const packable = useMemo(
    () => skills.filter((s) => !s.source_deleted),
    [skills]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return packable;
    return packable.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.title_zh.toLowerCase().includes(q) ||
        s.folder_name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.description_zh.toLowerCase().includes(q) ||
        s.scan_label.toLowerCase().includes(q)
    );
  }, [packable, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((s) => selected.has(s.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filtered.forEach((s) => next.delete(s.id));
      } else {
        filtered.forEach((s) => next.add(s.id));
      }
      return next;
    });
  };

  const handleCreate = async (force = false) => {
    setBusy(true);
    setError("");
    if (!force) setFailures(null);
    try {
      const inputs: PackSkillInput[] = packable
        .filter((s) => selected.has(s.id))
        .map((s) => ({
          source_path: s.source_path,
          name: s.name,
          description: s.description,
          description_zh: s.description_zh,
          has_translation: s.has_translation,
        }));
      const info = await packCreate({
        name: name.trim(),
        ver: ver.trim(),
        author: author.trim(),
        skills: inputs,
        force,
      });
      onCreated(info);
      onClose();
    } catch (e) {
      if (isPackCreateError(e) && e.kind === "validation_failed") {
        setFailures(e.failed);
        setError(e.message);
      } else {
        setFailures(null);
        setError(packErrorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden border-border/60 bg-card/95 backdrop-blur-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-primary" />
            新建 Skill Pack
          </DialogTitle>
          <DialogDescription>
            挑选技能打包为 .skillpack，可在平台内分享流通
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="grid shrink-0 grid-cols-[1fr_100px_1fr] gap-2">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">名称 *</div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：OpenCode Essentials"
                className="h-8"
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">版本</div>
              <Input
                value={ver}
                onChange={(e) => setVer(e.target.value)}
                placeholder="1.0.0"
                className="h-8"
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">作者</div>
              <Input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="可选"
                className="h-8"
              />
            </div>
          </div>

          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索技能…"
              className="h-8 pl-8"
            />
          </div>

          <div className="flex shrink-0 items-center justify-between text-xs text-muted-foreground">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleAll}
                className="h-3.5 w-3.5 accent-[var(--brand)]"
              />
              全选当前列表
            </label>
            <span>已选 {selected.size} / {packable.length}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/50">
            <ul className="divide-y divide-border/40">
              {filtered.map((s) => {
                const on = selected.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border"
                        }`}
                      >
                        {on && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {s.emoji ?? ""} {s.title_zh || s.name}
                          </span>
                          <span className="shrink-0 rounded border border-border/60 px-1.5 py-px text-[10px] text-muted-foreground">
                            {s.scan_label}
                          </span>
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {s.description_zh || s.description || "（无描述）"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-muted-foreground">
                  没有匹配的技能
                </li>
              )}
            </ul>
          </div>

          {failures && failures.length > 0 && (
            <div className="shrink-0 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <p className="font-medium text-amber-600 dark:text-amber-400">
                {failures.length} 个技能未通过严格校验，已拒绝打包：
              </p>
              <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-amber-700/90 dark:text-amber-300/90">
                {failures.map((f) => (
                  <li key={f.skill_path}>
                    <span className="font-mono font-medium">{f.name}</span>
                    <ul className="ml-3 list-disc space-y-0.5">
                      {f.issues.map((iss, i) => (
                        <li key={i}>
                          [{iss.rule_id}] {iss.message}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-text-tertiary">
                  修复后再打包；或强行打包（警告将记入 pack.json，发布时下游可见）
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => handleCreate(true)}
                >
                  {busy ? "打包中…" : "仍要打包"}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          {selected.size > 0 && !name.trim() && (
            <span className="mr-auto text-xs text-amber-500">
              填写名称后即可打包
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!name.trim() || selected.size === 0 || busy}
            onClick={() => handleCreate(false)}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            打包 {selected.size > 0 ? `${selected.size} 项` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
