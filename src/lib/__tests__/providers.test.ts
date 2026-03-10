import { describe, it, expect } from "vitest";
import { MODEL_PROVIDERS, PROVIDER_MAP, OC_PROVIDER_MAP } from "../providers";

describe("PROVIDER_MAP", () => {
  it("maps provider id to ModelProvider", () => {
    expect(PROVIDER_MAP.openai).toBeDefined();
    expect(PROVIDER_MAP.openai.name).toBe("OpenAI");
  });

  it("includes all MODEL_PROVIDERS entries", () => {
    for (const p of MODEL_PROVIDERS) {
      expect(PROVIDER_MAP[p.id]).toBe(p);
    }
  });
});

describe("OC_PROVIDER_MAP", () => {
  it("maps ocProviderId to ModelProvider", () => {
    const claude = MODEL_PROVIDERS.find((p) => p.id === "claude");
    expect(claude?.ocProviderId).toBe("anthropic");
    expect(OC_PROVIDER_MAP["anthropic"]).toBe(claude);
  });

  it("maps oauthProviderId to ModelProvider", () => {
    const openai = MODEL_PROVIDERS.find((p) => p.id === "openai");
    expect(openai?.oauthProviderId).toBe("openai-codex");
    expect(OC_PROVIDER_MAP["openai-codex"]).toBe(openai);
  });

  it("maps claude oauthProviderId", () => {
    const claude = MODEL_PROVIDERS.find((p) => p.id === "claude");
    expect(claude?.oauthProviderId).toBe("claude-cli");
    expect(OC_PROVIDER_MAP["claude-cli"]).toBe(claude);
  });

  it("maps minimax oauthProviderId", () => {
    const minimax = MODEL_PROVIDERS.find((p) => p.id === "minimax");
    expect(minimax?.oauthProviderId).toBe("minimax-portal");
    expect(OC_PROVIDER_MAP["minimax-portal"]).toBe(minimax);
  });

  it("all providers with ocProviderId or oauthProviderId are in the map", () => {
    for (const p of MODEL_PROVIDERS) {
      if (p.ocProviderId) {
        expect(OC_PROVIDER_MAP[p.ocProviderId]).toBe(p);
      }
      if (p.oauthProviderId) {
        expect(OC_PROVIDER_MAP[p.oauthProviderId]).toBe(p);
      }
    }
  });
});
