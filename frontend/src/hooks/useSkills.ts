/**
 * Skills 数据 Hook — 通过 Tauri invoke 扫描 + 前端分组
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MOCK_SKILLS, isMockMode } from "./mockSkills";

export interface Skill {
  id: string;
  name: string;
  folder_name: string;
  description: string;
  emoji: string | null;
  scan_label: string;
  source_path: string;
  /** v0.2（B4）：实际扫描到的技能目录（junction 落点不穿透，hub 操作锚点） */
  skill_dir: string;
  /** 来源工具注册表 id */
  tool_id: string;
  /** 同名组代表卡片（B4 代表选取） */
  is_representative: boolean;
  /** 其他持有同名技能的工具 id 列表（UI 徽标用） */
  other_sources: string[];
  /** 该目录是 junction（hub link 落点） */
  hub_linked: boolean;
  /** 账本中对应的 link id（供解除引用/转副本） */
  hub_link_id: string | null;
  has_translation: boolean;
  title_zh: string;
  /** 译文中的中文描述（无译文为空串），展示优先于 description */
  description_zh: string;
  source_deleted: boolean;
  parent_collection: string | null;
}

export interface SkillGroup {
  label: string;
  skills: Skill[];
}

export type LayoutMode = "grid" | "list";

/** 翻译状态（后端暂无"过期"检测，仅 ok / no 两态） */
export type TranslateStatus = "ok" | "old" | "no";

export function skillStatus(s: Skill): TranslateStatus {
  return s.has_translation ? "ok" : "no";
}

export const STATUS_TEXT: Record<TranslateStatus, string> = {
  ok: "已翻译",
  old: "译文过期",
  no: "待翻译",
};

/** 通用容器目录名：嵌套合集最内层常叫 skills/skill，无标识意义，显示时跳过 */
const GENERIC_COLLECTION_SEGMENTS = new Set(["skills", "skill"]);

/**
 * 合集显示名：取相对扫描根路径里「第一个有标识意义的段」。
 * 例：superpowers/skills → superpowers；skills/superpowers → superpowers。
 * 末段常是通用容器词 skills，直接取末段会丢失真正的父级名。
 * 全为通用词的极端情况回退末段，避免空串。
 */
export function collectionDisplayName(collection: string): string {
  const segments = collection
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return collection;
  const meaningful = segments.find(
    (s) => !GENERIC_COLLECTION_SEGMENTS.has(s.toLowerCase())
  );
  return meaningful ?? segments[segments.length - 1];
}

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isMockMode()) {
        await new Promise((r) => setTimeout(r, 250));
        setSkills(MOCK_SKILLS);
        return;
      }
      const data = await invoke<Skill[]>("scan_skills");
      setSkills(data);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /** 刷新同步：标记已删除 + 重新扫描 */
  const sync = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isMockMode()) {
        await new Promise((r) => setTimeout(r, 250));
        setSkills(MOCK_SKILLS);
        return;
      }
      const currentIds = skills.map((s) => s.id);
      const data = await invoke<Skill[]>("sync_deleted", { currentIds });
      setSkills(data);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [skills]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * 按 scan_label 分组，保持首次出现顺序。
   * 空标签归"未分类"，排最后。
   * 0 个 skill 的组不输出。
   */
  const groups = useMemo<SkillGroup[]>(() => {
    const map = new Map<string, Skill[]>();
    const order: string[] = [];

    for (const s of skills) {
      const key = s.scan_label || "未分类";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(s);
    }

    // "未分类" 排最后
    const uncat = "未分类";
    const sorted = order.filter((k) => k !== uncat);
    if (map.has(uncat)) sorted.push(uncat);

    return sorted
      .map((label) => ({ label, skills: map.get(label)! }))
      .filter((g) => g.skills.length > 0);
  }, [skills]);

  return {
    skills,
    groups,
    loading,
    error,
    refresh,
    sync,
  };
}
