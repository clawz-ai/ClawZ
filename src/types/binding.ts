/** OpenClaw routing binding match structure */
export interface BindingMatch {
  channel: string;
  accountId?: string;
  peer?: {
    kind: "direct" | "group" | "channel";
    id: string;
  };
  guildId?: string;
  teamId?: string;
  roles?: string[];
}

/** A single routing binding */
export interface AgentBinding {
  agentId: string;
  match: BindingMatch;
  comment?: string;
  description?: string;
}

/** Result of bind/unbind operations */
export interface BindingResult {
  added?: AgentBinding[];
  updated?: AgentBinding[];
  skipped?: AgentBinding[];
  conflicts?: Array<{
    binding: AgentBinding;
    existingAgentId: string;
  }>;
  removed?: AgentBinding[];
}
