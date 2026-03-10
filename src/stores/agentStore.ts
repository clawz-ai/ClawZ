import { create } from "zustand";
import type { Agent } from "../types/agent";

interface AgentState {
  agents: Agent[];
  selectedId: string | null;
  setAgents: (agents: Agent[]) => void;
  selectAgent: (id: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  selectedId: null,
  setAgents: (agents) => set({ agents }),
  selectAgent: (id) => set({ selectedId: id }),
}));
