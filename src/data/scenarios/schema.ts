/** Scenario package standard schema — version 1 */

export type ToolsProfile = "minimal" | "coding" | "messaging" | "full";

export interface CronJobDef {
  name: string;
  message: string;
  /** "cron" for cron expression, "every" for fixed interval */
  schedule: "cron" | "every";
  value: string;
}

export interface SingleAgentScenario {
  type: "single";
  soul: string;
  identity: string;
  heartbeat: string;
  cron?: CronJobDef[];
}

export interface AgentRole {
  role: string;
  name: string;
  emoji: string;
  soul: string;
  identity: string;
  heartbeat: string;
  recommendedModel?: string;
  cron?: CronJobDef[];
}

export interface MultiAgentScenario {
  type: "multi";
  orchestration: string;
  agents: AgentRole[];
}

/** Locale overrides for translatable fields in a scenario package. */
export interface ScenarioLocaleOverrides {
  name?: string;
  description?: string;
  tags?: string[];
  /** Single-agent persona overrides */
  soul?: string;
  identity?: string;
  heartbeat?: string;
  /** Multi-agent overrides */
  orchestration?: string;
  agents?: Array<{
    name?: string;
    soul?: string;
    identity?: string;
    heartbeat?: string;
  }>;
  /** Cron job display name / message overrides (same order as scenario.cron) */
  cron?: Array<{
    name?: string;
    message?: string;
  }>;
}

export interface ScenarioPackage {
  /** Schema version — always 1 for now */
  version: 1;
  id: string;
  name: string;
  emoji: string;
  /** Author identifier, e.g. "clawz-official" or GitHub username */
  author: string;
  /** Short description shown on the scenario card */
  description: string;
  /** Tags for filtering */
  tags: string[];
  /** Skills to enable when applying */
  skills: string[];
  toolsProfile: ToolsProfile;
  scenario: SingleAgentScenario | MultiAgentScenario;
  /** Recommended channels to bind */
  channels?: string[];
  /** Locale overrides keyed by locale code (e.g. "en-US") */
  locales?: Record<string, ScenarioLocaleOverrides>;
}
