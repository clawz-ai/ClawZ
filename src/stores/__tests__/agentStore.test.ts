import { describe, it, expect, beforeEach } from "vitest";
import { useAgentStore } from "../agentStore";
import type { Agent } from "../../types/agent";

const mockAgents: Agent[] = [
  {
    id: "agent-1",
    name: "晨报助手",
    description: "每日自动整理晨报",
    status: "running",
    scenario: "morning-briefing",
    model: "deepseek-chat",
    created_at: "2025-01-01",
    last_active: "2025-01-02",
    trigger: "cron:0 8 * * *",
    output_channel: "wechat",
  },
  {
    id: "agent-2",
    name: "值班客服",
    description: "7×24 自动客服",
    status: "paused",
    scenario: "duty-customer-service",
    model: "qwen-turbo",
    created_at: "2025-01-03",
    last_active: "2025-01-04",
    trigger: "heartbeat:30m",
    output_channel: "slack",
  },
];

beforeEach(() => {
  useAgentStore.setState({
    agents: [],
    selectedId: null,
  });
});

describe("agentStore", () => {
  it("has correct initial state", () => {
    const state = useAgentStore.getState();
    expect(state.agents).toEqual([]);
    expect(state.selectedId).toBeNull();
  });

  describe("setAgents", () => {
    it("sets the agent list", () => {
      useAgentStore.getState().setAgents(mockAgents);
      expect(useAgentStore.getState().agents).toHaveLength(2);
      expect(useAgentStore.getState().agents[0].name).toBe("晨报助手");
    });

    it("replaces existing agents", () => {
      useAgentStore.getState().setAgents(mockAgents);
      useAgentStore.getState().setAgents([mockAgents[0]]);
      expect(useAgentStore.getState().agents).toHaveLength(1);
    });
  });

  describe("selectAgent", () => {
    it("selects an agent by id", () => {
      useAgentStore.getState().selectAgent("agent-1");
      expect(useAgentStore.getState().selectedId).toBe("agent-1");
    });

    it("can change selection", () => {
      useAgentStore.getState().selectAgent("agent-1");
      useAgentStore.getState().selectAgent("agent-2");
      expect(useAgentStore.getState().selectedId).toBe("agent-2");
    });
  });
});
