import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { translateSkill } from "@/lib/translate-api";
import { readSkillFile } from "@/lib/api";
import { loadLLMConfig } from "@/lib/llm-config";
import type { Skill } from "@/hooks/useSkills";

interface BatchState {
  current: number;
  total: number;
}

/**
 * 批量翻译队列：顺序翻译一组 skill，单个失败不中断整体。
 * 返回进度状态与触发函数；内置重入锁，防止重复触发。
 */
export function useBatchTranslate(opts: {
  onNeedSettings?: () => void;
  onDone?: () => void;
}) {
  const { onNeedSettings, onDone } = opts;
  const [batch, setBatch] = useState<BatchState | null>(null);
  const runningRef = useRef(false);

  const run = useCallback(
    async (skills: Skill[]) => {
      const targets = skills.filter((s) => !s.has_translation && !s.source_deleted);
      if (runningRef.current || targets.length === 0) return;

      // 预检 API Key，避免队列中途整体失败
      const cfg = await loadLLMConfig().catch(() => ({ hasKey: false }));
      if (!cfg.hasKey) {
        toast.error("请先在设置中配置 API Key");
        onNeedSettings?.();
        return;
      }

      runningRef.current = true;
      let ok = 0;
      let fail = 0;
      const total = targets.length;
      for (let i = 0; i < total; i++) {
        const s = targets[i];
        setBatch({ current: i + 1, total });
        try {
          const raw = await readSkillFile(s.source_path);
          await translateSkill(s.id, raw, s.source_path, s.scan_label);
          ok++;
        } catch {
          fail++;
        }
      }
      setBatch(null);
      runningRef.current = false;

      if (fail === 0) toast.success(`批量翻译完成：${ok} 个技能`);
      else toast.warning(`批量翻译完成：成功 ${ok}，失败 ${fail}`);
      onDone?.();
    },
    [onNeedSettings, onDone]
  );

  return { batch, running: batch !== null, run };
}
