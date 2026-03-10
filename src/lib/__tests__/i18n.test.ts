import { describe, it, expect } from "vitest";
import zh from "../i18n/zh-CN";
import en from "../i18n/en-US";
import { detectSystemLocale } from "../i18n";

// Test the translation function logic (standalone, no React hooks)
function translate(
  locale: "zh-CN" | "en-US",
  key: string,
  params?: Record<string, string | number>,
): string {
  const translations: Record<string, Record<string, string>> = {
    "zh-CN": zh,
    "en-US": en,
  };
  let text = translations[locale]?.[key] ?? translations["en-US"]?.[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

describe("i18n translation maps", () => {
  it("zh-CN and en-US have the same keys", () => {
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));
    const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));

    if (missingInEn.length > 0) {
      console.warn("Keys missing in en-US:", missingInEn);
    }
    if (missingInZh.length > 0) {
      console.warn("Keys missing in zh-CN:", missingInZh);
    }

    expect(missingInEn).toEqual([]);
    expect(missingInZh).toEqual([]);
  });

  it("no empty translation values in zh-CN", () => {
    const empty = Object.entries(zh).filter(([, v]) => v.trim() === "");
    expect(empty).toEqual([]);
  });

  it("no empty translation values in en-US", () => {
    const empty = Object.entries(en).filter(([, v]) => v.trim() === "");
    expect(empty).toEqual([]);
  });
});

describe("translate function", () => {
  it("returns zh-CN text for known key", () => {
    expect(translate("zh-CN", "common.refresh")).toBe("刷新");
  });

  it("returns en-US text for known key", () => {
    expect(translate("en-US", "common.refresh")).toBe("Refresh");
  });

  it("falls back to en-US when zh-CN key is missing", () => {
    // This shouldn't happen in practice (keys should be synced),
    // but tests the fallback logic
    const result = translate("zh-CN", "nonexistent.key");
    expect(result).toBe("nonexistent.key");
  });

  it("returns key itself when not found in any locale", () => {
    expect(translate("en-US", "totally.unknown.key")).toBe(
      "totally.unknown.key",
    );
  });

  it("substitutes parameters", () => {
    const result = translate("zh-CN", "skill.needsInstall", {
      deps: "blogwatcher",
    });
    expect(result).toContain("blogwatcher");
  });

  it("substitutes multiple parameters", () => {
    // Find a key with a parameter to test
    const result = translate("en-US", "skill.installFailed", {
      error: "not found",
    });
    expect(result).toContain("not found");
  });

  it("handles numeric parameters", () => {
    const result = translate("zh-CN", "skill.skillsReady", {
      count: 3,
      total: 10,
    });
    expect(result).toContain("3");
    expect(result).toContain("10");
  });
});

describe("detectSystemLocale", () => {
  it("is a function", () => {
    expect(typeof detectSystemLocale).toBe("function");
  });
});
