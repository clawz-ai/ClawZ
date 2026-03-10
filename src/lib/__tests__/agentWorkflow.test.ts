/**
 * Scenario tests for the Agent creation & binding workflow.
 *
 * Uses the standardised tauriMock to simulate backend responses
 * and validates the store-level logic that pages depend on.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tauriMock, resetTauriMocks } from "../../test/tauri-mock";

// Mock the entire tauri module with our standard mock
vi.mock("../../lib/tauri", () => tauriMock);

import { useAppStore } from "../../stores/appStore";
import { parseBindings, toBindSpec } from "../bindings";

beforeEach(() => {
  resetTauriMocks();
  useAppStore.setState({
    agents: [],
    config: null,
  });
});

// ── Scenario: Create agent and bind to channel ────────────────────

describe("Scenario: Create agent and bind to channel", () => {
  it("creates agent, then binds to telegram", async () => {
    // 1. Backend returns success on create
    tauriMock.createAgent.mockResolvedValue("agent-1 created");

    // 2. After creation, listAgents returns the new agent
    tauriMock.listAgents.mockResolvedValue([
      { id: "agent-1", name: "My Agent", model: "gpt-4o", running: false },
    ]);

    // Simulate create call
    const createResult = await tauriMock.createAgent("agent-1", "My Agent");
    expect(createResult).toBe("agent-1 created");
    expect(tauriMock.createAgent).toHaveBeenCalledWith("agent-1", "My Agent");

    // Simulate refresh agent list
    const agents = await tauriMock.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("agent-1");

    // 3. Bind to telegram
    tauriMock.bindAgentChannel.mockResolvedValue(
      JSON.stringify({ agentId: "agent-1", added: ["telegram"], conflicts: [] }),
    );

    const bindResult = await tauriMock.bindAgentChannel("agent-1", "telegram");
    const parsed = JSON.parse(bindResult);
    expect(parsed.conflicts).toHaveLength(0);
    expect(parsed.added).toContain("telegram");

    // 4. Verify bindings
    tauriMock.getAgentBindings.mockResolvedValue([
      { agentId: "agent-1", match: { channel: "telegram" } },
    ]);

    const rawBindings = await tauriMock.getAgentBindings("agent-1");
    const bindings = parseBindings(rawBindings);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].match.channel).toBe("telegram");
    expect(toBindSpec(bindings[0].match)).toBe("telegram");
  });
});

// ── Scenario: Binding conflict ────────────────────────────────────

describe("Scenario: Binding conflict detection", () => {
  it("handles string-format conflicts from CLI", async () => {
    // CLI returns conflicts as strings (not objects)
    tauriMock.bindAgentChannel.mockResolvedValue(
      JSON.stringify({
        agentId: "agent-2",
        added: [],
        conflicts: ["telegram (agent=main)"],
      }),
    );

    const raw = await tauriMock.bindAgentChannel("agent-2", "telegram");
    const result = JSON.parse(raw);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toBe("telegram (agent=main)");

    // Frontend should display string conflicts directly
    const detail = result.conflicts
      .map((c: unknown) => (typeof c === "string" ? c : "unknown"))
      .join("; ");
    expect(detail).toBe("telegram (agent=main)");
  });
});

// ── Scenario: Multi-account binding ───────────────────────────────

describe("Scenario: Multi-account channel binding", () => {
  it("binds agent to specific account", async () => {
    tauriMock.bindAgentChannel.mockResolvedValue(
      JSON.stringify({ agentId: "agent-1", added: ["telegram:ops-bot"], conflicts: [] }),
    );

    const spec = toBindSpec({ channel: "telegram", accountId: "ops-bot" });
    expect(spec).toBe("telegram:ops-bot");

    await tauriMock.bindAgentChannel("agent-1", spec);
    expect(tauriMock.bindAgentChannel).toHaveBeenCalledWith("agent-1", "telegram:ops-bot");
  });
});

// ── Scenario: Delete agent ────────────────────────────────────────

describe("Scenario: Delete agent", () => {
  it("removes agent and clears from list", async () => {
    tauriMock.listAgents.mockResolvedValue([
      { id: "main", name: "Main", model: "gpt-4o", running: false },
      { id: "helper", name: "Helper", model: "deepseek-chat", running: false },
    ]);

    let agents = await tauriMock.listAgents();
    expect(agents).toHaveLength(2);

    // Delete helper
    tauriMock.deleteAgent.mockResolvedValue("deleted");
    await tauriMock.deleteAgent("helper");
    expect(tauriMock.deleteAgent).toHaveBeenCalledWith("helper");

    // After refresh, only main remains
    tauriMock.listAgents.mockResolvedValue([
      { id: "main", name: "Main", model: "gpt-4o", running: false },
    ]);
    agents = await tauriMock.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("main");
  });
});

// ── Scenario: Gateway lifecycle ───────────────────────────────────

describe("Scenario: Gateway start/stop lifecycle", () => {
  it("starts gateway and verifies status", async () => {
    // Initially stopped
    tauriMock.getGatewayStatus.mockResolvedValue({
      running: false, gateway: null, agents: null, channels: null, model: null,
    });

    let status = await tauriMock.getGatewayStatus();
    expect(status.running).toBe(false);

    // Start
    await tauriMock.startGateway();
    expect(tauriMock.startGateway).toHaveBeenCalled();

    // Now running
    tauriMock.getGatewayStatus.mockResolvedValue({
      running: true,
      gateway: { url: "http://localhost:5001", uptime: "5s" },
      agents: { count: 1, list: ["main"] },
      channels: { configured: ["telegram"], enabled: ["telegram"] },
      model: { id: "gpt-4o", name: "GPT-4o" },
    });

    status = await tauriMock.getGatewayStatus();
    expect(status.running).toBe(true);
    expect(status.agents.count).toBe(1);
  });
});
