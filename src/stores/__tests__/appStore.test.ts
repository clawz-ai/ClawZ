import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "../appStore";

// Mock tauri module to avoid real IPC calls
vi.mock("../../lib/tauri", () => ({
  readOpenClawConfig: vi.fn().mockResolvedValue({ gateway: { port: 18789 } }),
}));

beforeEach(() => {
  useAppStore.setState({
    status: null,
    statusStale: false,
    onboarded: false,
    agents: null,
    config: null,
    modelsStatus: null,
    catalogModels: null,
  });
});

describe("appStore", () => {
  it("has correct initial state", () => {
    const state = useAppStore.getState();
    expect(state.status).toBeNull();
    expect(state.onboarded).toBe(false);
    expect(state.agents).toBeNull();
    expect(state.config).toBeNull();
    expect(state.modelsStatus).toBeNull();
    expect(state.catalogModels).toBeNull();
  });

  describe("setStatus", () => {
    it("updates status data and clears stale flag", () => {
      useAppStore.setState({ statusStale: true });
      useAppStore.getState().setStatus({
        gateway: { running: true, url: "ws://127.0.0.1:18789", uptime: "" },
        model: { id: "deepseek-chat", name: "deepseek-chat", context_tokens: 128000 },
        agents: { count: 1, list: ["main"] },
        channels: { configured: ["telegram"], enabled: ["telegram"] },
        security: { critical: 0, warnings: 0, info: 0, findings: [] },
        sessions: { total: 5 },
      });

      const state = useAppStore.getState();
      expect(state.status?.gateway.running).toBe(true);
      expect(state.status?.model.id).toBe("deepseek-chat");
      expect(state.status?.agents.count).toBe(1);
      expect(state.statusStale).toBe(false);
    });
  });

  describe("setOnboarded", () => {
    it("sets onboarded to true", () => {
      useAppStore.getState().setOnboarded(true);
      expect(useAppStore.getState().onboarded).toBe(true);
    });

    it("can toggle onboarded back to false", () => {
      useAppStore.getState().setOnboarded(true);
      useAppStore.getState().setOnboarded(false);
      expect(useAppStore.getState().onboarded).toBe(false);
    });
  });

  describe("agents", () => {
    it("setAgents updates agent list", () => {
      const agents = [
        { id: "main", name: "main", bindings: 1, isDefault: true },
      ] as any;
      useAppStore.getState().setAgents(agents);
      expect(useAppStore.getState().agents).toEqual(agents);
    });
  });

  describe("config", () => {
    it("setConfig updates config snapshot", () => {
      const config = { gateway: { port: 18789 } };
      useAppStore.getState().setConfig(config);
      expect(useAppStore.getState().config).toEqual(config);
    });

    it("refreshConfig fetches and stores config", async () => {
      const result = await useAppStore.getState().refreshConfig();
      expect(result).toEqual({ gateway: { port: 18789 } });
      expect(useAppStore.getState().config).toEqual({ gateway: { port: 18789 } });
    });
  });

  describe("model cache", () => {
    it("setModelsStatus caches models status", () => {
      const data = { providers: {} };
      useAppStore.getState().setModelsStatus(data);
      expect(useAppStore.getState().modelsStatus).toEqual(data);
    });

    it("setCatalogModels caches model list", () => {
      const models = [{ id: "gpt-4o", name: "GPT-4o" }] as any;
      useAppStore.getState().setCatalogModels(models);
      expect(useAppStore.getState().catalogModels).toEqual(models);
    });
  });
});
