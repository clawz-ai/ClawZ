import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "../settingsStore";

beforeEach(() => {
  useSettingsStore.setState({
    currentModel: "deepseek-chat",
    theme: "light",
    language: "zh-CN",
  });
});

describe("settingsStore", () => {
  it("has correct initial state", () => {
    const state = useSettingsStore.getState();
    expect(state.currentModel).toBe("deepseek-chat");
    expect(state.theme).toBe("light");
    expect(state.language).toBe("zh-CN");
  });

  describe("setCurrentModel", () => {
    it("updates the model", () => {
      useSettingsStore.getState().setCurrentModel("gpt-4o");
      expect(useSettingsStore.getState().currentModel).toBe("gpt-4o");
    });
  });

  describe("setTheme", () => {
    it("switches to dark theme", () => {
      useSettingsStore.getState().setTheme("dark");
      expect(useSettingsStore.getState().theme).toBe("dark");
    });

    it("switches to system theme", () => {
      useSettingsStore.getState().setTheme("system");
      expect(useSettingsStore.getState().theme).toBe("system");
    });
  });

  describe("setLanguage", () => {
    it("switches to English", () => {
      useSettingsStore.getState().setLanguage("en-US");
      expect(useSettingsStore.getState().language).toBe("en-US");
    });
  });
});
