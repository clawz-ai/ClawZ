import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { isTauriEnv } from "../lib/env";
import { detectSystemLocale, type Locale } from "../lib/i18n";

type ThemeMode = "light" | "dark" | "system";
export type CurrencyUnit = "USD" | "CNY";

function getEffectiveTheme(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  }
  return mode;
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const effective = getEffectiveTheme(mode);
  document.documentElement.setAttribute("data-theme", effective);
}

const STORE_FILE = "clawz-state.json";
const KEY_CURRENCY = "settings.currency";
const KEY_EXCHANGE_RATE = "settings.exchangeRate";
const KEY_LANGUAGE = "settings.language";
const KEY_APPLIED_SCENARIOS = "settings.appliedScenarios";

let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { autoSave: true } as Parameters<typeof load>[1]);
  }
  return storePromise;
}

async function persistCurrency(currency: CurrencyUnit, exchangeRate: number) {
  if (!isTauriEnv()) return;
  try {
    const store = await getStore();
    await store.set(KEY_CURRENCY, currency);
    await store.set(KEY_EXCHANGE_RATE, exchangeRate);
  } catch (e) {
    console.warn("settingsStore persistence failed:", e);
  }
}

async function persistLanguage(language: Locale) {
  if (!isTauriEnv()) return;
  try {
    const store = await getStore();
    await store.set(KEY_LANGUAGE, language);
  } catch (e) {
    console.warn("settingsStore persistLanguage failed:", e);
  }
}

/** Map of agentId → scenarioTemplateId for tracking which scenario is applied to which agent */
type AppliedScenarios = Record<string, string>;

interface SettingsState {
  currentModel: string;
  theme: ThemeMode;
  language: Locale;
  currency: CurrencyUnit;
  exchangeRate: number;
  appliedScenarios: AppliedScenarios;
  setCurrentModel: (model: string) => void;
  setTheme: (theme: ThemeMode) => void;
  setLanguage: (lang: Locale) => void;
  setCurrency: (currency: CurrencyUnit) => void;
  setExchangeRate: (rate: number) => void;
  setAppliedScenario: (agentId: string, templateId: string) => void;
  loadSettings: () => Promise<void>;
  /** Clear all persisted settings (used during uninstall) */
  resetSettings: () => Promise<void>;
  /** @deprecated Use loadSettings instead */
  loadCurrencySettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  currentModel: "",
  theme: "light",
  language: detectSystemLocale(),
  currency: "CNY",
  exchangeRate: 6.90,
  appliedScenarios: {},
  setCurrentModel: (model) => set({ currentModel: model }),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  setLanguage: (language) => {
    set({ language });
    persistLanguage(language);
  },
  setAppliedScenario: (agentId, templateId) => {
    const updated = { ...get().appliedScenarios, [agentId]: templateId };
    set({ appliedScenarios: updated });
    if (isTauriEnv()) {
      getStore().then((store) => store.set(KEY_APPLIED_SCENARIOS, updated)).catch(() => {});
    }
  },
  setCurrency: (currency) => {
    set({ currency });
    persistCurrency(currency, get().exchangeRate);
  },
  setExchangeRate: (exchangeRate) => {
    set({ exchangeRate });
    persistCurrency(get().currency, exchangeRate);
  },
  loadSettings: async () => {
    if (!isTauriEnv()) return;
    try {
      const store = await getStore();
      const [currency, exchangeRate, language, appliedScenarios] = await Promise.all([
        store.get<CurrencyUnit>(KEY_CURRENCY),
        store.get<number>(KEY_EXCHANGE_RATE),
        store.get<Locale>(KEY_LANGUAGE),
        store.get<AppliedScenarios>(KEY_APPLIED_SCENARIOS),
      ]);
      set({
        ...(currency ? { currency } : {}),
        ...(exchangeRate ? { exchangeRate } : {}),
        ...(language ? { language } : {}),
        ...(appliedScenarios ? { appliedScenarios } : {}),
      });
    } catch (e) {
      console.warn("settingsStore hydrate failed:", e);
    }
  },
  resetSettings: async () => {
    set({
      currentModel: "",
      currency: "CNY",
      exchangeRate: 6.90,
      appliedScenarios: {},
    });
    if (!isTauriEnv()) return;
    try {
      const store = await getStore();
      await Promise.all([
        store.delete(KEY_CURRENCY),
        store.delete(KEY_EXCHANGE_RATE),
        store.delete(KEY_APPLIED_SCENARIOS),
      ]);
    } catch (e) {
      console.warn("settingsStore resetSettings failed:", e);
    }
  },
  loadCurrencySettings: async () => {
    // Delegate to loadSettings for backward compatibility
    await get().loadSettings();
  },
}));

// Apply initial theme on load
if (typeof document !== "undefined") {
  applyTheme(useSettingsStore.getState().theme);
}

// Listen for system theme changes when in "system" mode
if (typeof window !== "undefined" && window.matchMedia) {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      const { theme } = useSettingsStore.getState();
      if (theme === "system") {
        applyTheme("system");
      }
    });
}
