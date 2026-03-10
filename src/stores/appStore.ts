import { create } from "zustand";
import type { StatusData, AgentDetail, ConfiguredModel } from "../lib/tauri";
import { readOpenClawConfig } from "../lib/tauri";

const CACHE_KEY = "clawz_status_cache";

function loadCachedStatus(): StatusData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveCachedStatus(status: StatusData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(status));
  } catch { /* ignore quota errors */ }
}

interface AppState {
  status: StatusData | null;
  statusStale: boolean; // true = showing cached data, waiting for fresh
  setStatus: (status: StatusData) => void;
  onboarded: boolean;
  setOnboarded: (v: boolean) => void;
  agents: AgentDetail[] | null;
  setAgents: (agents: AgentDetail[]) => void;
  config: Record<string, unknown> | null;
  setConfig: (config: Record<string, unknown>) => void;
  /** Refresh config from backend and update store. Returns the fresh config. */
  refreshConfig: () => Promise<Record<string, unknown> | null>;
  /** Cached result of getModelsStatus() — avoids re-fetching on every navigation */
  modelsStatus: Record<string, unknown> | null;
  setModelsStatus: (data: Record<string, unknown>) => void;
  /** Cached result of listSelectableModels() */
  catalogModels: ConfiguredModel[] | null;
  setCatalogModels: (models: ConfiguredModel[]) => void;
}

const cached = loadCachedStatus();

export const useAppStore = create<AppState>((set) => ({
  status: cached,
  statusStale: cached !== null,
  setStatus: (status) => {
    saveCachedStatus(status);
    set({ status, statusStale: false });
  },
  onboarded: false,
  setOnboarded: (v) => set({ onboarded: v }),
  agents: null,
  setAgents: (agents) => set({ agents }),
  config: null,
  setConfig: (config) => set({ config }),
  refreshConfig: async () => {
    try {
      const cfg = await readOpenClawConfig();
      set({ config: cfg });
      return cfg;
    } catch {
      return null;
    }
  },
  modelsStatus: null,
  setModelsStatus: (data) => set({ modelsStatus: data }),
  catalogModels: null,
  setCatalogModels: (models) => set({ catalogModels: models }),
}));
