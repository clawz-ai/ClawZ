import { describe, it, expect } from "vitest";
import { mergeSelectableModels, type ConfiguredModel } from "../tauri";

function model(key: string, available: boolean, name?: string): ConfiguredModel {
  return { key, name: name || key, available, contextWindow: 128000, input: "", local: false, tags: [], missing: false };
}

describe("mergeSelectableModels", () => {
  it("includes available catalog models", () => {
    const catalog = [model("openai/gpt-5", true), model("openai/gpt-4", true)];
    const result = mergeSelectableModels(catalog, []);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.key)).toEqual(["openai/gpt-5", "openai/gpt-4"]);
  });

  it("excludes unavailable catalog models", () => {
    const catalog = [model("openai/gpt-5", true), model("openai/old", false)];
    const result = mergeSelectableModels(catalog, []);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("openai/gpt-5");
  });

  it("includes configured models not in catalog", () => {
    const catalog = [model("openai/gpt-5", true)];
    const configured = [model("qwen-portal/qwen-max", false)];
    const result = mergeSelectableModels(catalog, configured);
    expect(result).toHaveLength(2);
    expect(result[1].key).toBe("qwen-portal/qwen-max");
    expect(result[1].available).toBe(true);
  });

  it("deduplicates: catalog takes priority over configured", () => {
    const catalogModel = model("openai/gpt-5", true, "GPT-5 (catalog)");
    const configuredModel = model("openai/gpt-5", false, "GPT-5 (configured)");
    const result = mergeSelectableModels([catalogModel], [configuredModel]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("GPT-5 (catalog)");
  });

  it("returns empty array when both inputs are empty", () => {
    expect(mergeSelectableModels([], [])).toEqual([]);
  });

  it("marks configured-only models as available=true", () => {
    const configured = [model("custom/model", false)];
    const result = mergeSelectableModels([], configured);
    expect(result[0].available).toBe(true);
  });

  it("deduplicates within catalog itself", () => {
    const catalog = [
      model("openai/gpt-5", true, "first"),
      model("openai/gpt-5", true, "duplicate"),
    ];
    const result = mergeSelectableModels(catalog, []);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("first");
  });
});
