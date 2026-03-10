import { describe, it, expect } from "vitest";
import { RETIRED_MODELS, isRetiredModel } from "../retiredModels";

describe("retiredModels", () => {
  describe("RETIRED_MODELS set", () => {
    it("contains known retired Anthropic models", () => {
      expect(RETIRED_MODELS.has("anthropic/claude-3-5-haiku-20241022")).toBe(
        true,
      );
      expect(RETIRED_MODELS.has("anthropic/claude-3-opus-20240229")).toBe(true);
    });

    it("does not contain active models", () => {
      expect(RETIRED_MODELS.has("anthropic/claude-sonnet-4-20250514")).toBe(
        false,
      );
      expect(RETIRED_MODELS.has("openai/gpt-4o")).toBe(false);
    });

    it("all entries follow provider/model-id format", () => {
      for (const key of RETIRED_MODELS) {
        expect(key).toMatch(/^[a-z-]+\/.+$/);
      }
    });
  });

  describe("isRetiredModel()", () => {
    it("returns true for retired models", () => {
      expect(isRetiredModel("anthropic/claude-3-5-sonnet-20241022")).toBe(true);
    });

    it("returns false for active models", () => {
      expect(isRetiredModel("anthropic/claude-sonnet-4-20250514")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isRetiredModel("")).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(isRetiredModel("Anthropic/claude-3-opus-20240229")).toBe(false);
    });
  });
});
