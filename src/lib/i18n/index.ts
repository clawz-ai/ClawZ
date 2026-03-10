import { useCallback } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import zh from "./zh-CN";
import en from "./en-US";

export type { TranslationKey, TranslationMap } from "./zh-CN";
export type Locale = "zh-CN" | "en-US";

type Params = Record<string, string | number>;

const translations: Record<Locale, Record<string, string>> = {
  "zh-CN": zh,
  "en-US": en,
};

/**
 * Detect system locale. Returns "zh-CN" if system language is Chinese,
 * "en-US" otherwise.
 */
export function detectSystemLocale(): Locale {
  const lang = navigator.language || navigator.languages?.[0] || "en";
  return lang.startsWith("zh") ? "zh-CN" : "en-US";
}

/**
 * React hook that returns a translation function `t(key, params?)`.
 * Reads the current language from settingsStore.
 */
export function useT() {
  const language = useSettingsStore((s) => s.language);
  return useCallback(
    (key: string, params?: Params): string => {
      let text =
        translations[language]?.[key] ?? translations["en-US"]?.[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [language],
  );
}
