/**
 * LLM 配置管理 — 通过 Tauri invoke 读写 _data/config.json
 */

import { invoke } from "@tauri-apps/api/core";
import type { MaskedConfig, ScanPathItem } from "./api";

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ScanPathConfig {
  scanPaths: ScanPathItem[];
}

export const LLM_DEFAULTS = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
};

const DEFAULT_LLM: LLMConfig = {
  apiKey: "",
  baseUrl: LLM_DEFAULTS.baseUrl,
  model: LLM_DEFAULTS.model,
};

let cachedConfig: (LLMConfig & ScanPathConfig & { hasKey: boolean; pathExists: boolean[] }) | null = null;

/** 从 Rust 端加载配置 */
export async function loadLLMConfig(): Promise<LLMConfig & ScanPathConfig & { hasKey: boolean; pathExists: boolean[] }> {
  try {
    // load_config 返回脱敏 key（仅用于"是否已配置"指示与 base_url/model），
    // 实际发请求需明文 key，故并行取 get_llm_api_key。
    const [cfg, rawKey] = await Promise.all([
      invoke<MaskedConfig>("load_config"),
      invoke<string>("get_llm_api_key"),
    ]);
    cachedConfig = {
      apiKey: rawKey,
      baseUrl: cfg.llm.base_url,
      model: cfg.llm.model,
      scanPaths: cfg.scan_paths,
      hasKey: cfg._has_key,
      pathExists: cfg.path_exists ?? [],
    };
    return cachedConfig;
  } catch {
    return { ...DEFAULT_LLM, scanPaths: [], hasKey: false, pathExists: [] };
  }
}

/** 获取当前 LLM 配置（同步，使用缓存） */
export function getLLMConfig(): LLMConfig {
  if (cachedConfig) {
    return {
      apiKey: cachedConfig.apiKey,
      baseUrl: cachedConfig.baseUrl,
      model: cachedConfig.model,
    };
  }
  return DEFAULT_LLM;
}

/** 保存配置到 Rust 端 */
export async function saveLLMConfig(
  llm: LLMConfig,
  scanPaths: ScanPathItem[]
): Promise<void> {
  await invoke("save_config", {
    scanPaths,
    llmApiKey: llm.apiKey,
    llmBaseUrl: llm.baseUrl,
    llmModel: llm.model,
  });
  cachedConfig = { ...llm, scanPaths, hasKey: !!llm.apiKey, pathExists: scanPaths.map(() => true) };
}
