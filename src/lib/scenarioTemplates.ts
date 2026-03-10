/**
 * Scenario templates — thin bridge layer.
 *
 * Scenario data now lives in JSON files under `src/data/scenarios/`.
 * This file re-exports them with backward-compatible types and helpers
 * so existing pages don't need to change their imports.
 */

import { useMemo } from "react";
import { builtinScenarios } from "../data/scenarios";
import type {
  ScenarioPackage,
  CronJobDef,
} from "../data/scenarios/schema";
import { useSettingsStore } from "../stores/settingsStore";
import { upsertScenarioCronJobs } from "./tauri";

// ── Re-export schema types under legacy names ──

export type {
  SingleAgentScenario,
  MultiAgentScenario,
  AgentRole,
  ToolsProfile,
  CronJobDef,
  ScenarioPackage,
} from "../data/scenarios/schema";

/** Backward-compatible alias */
export type ScenarioTemplate = ScenarioPackage;

// ── The canonical scenario list ──

export const SCENARIO_TEMPLATES: ScenarioPackage[] = builtinScenarios;

// ── Helper accessors ──

export function getSingleScenario(
  tpl: ScenarioPackage,
): Extract<ScenarioPackage["scenario"], { type: "single" }> | undefined {
  return tpl.scenario.type === "single" ? tpl.scenario : undefined;
}

export function isSingleAgent(tpl: ScenarioPackage): boolean {
  return tpl.scenario.type === "single";
}

export function isMultiAgent(tpl: ScenarioPackage): boolean {
  return tpl.scenario.type === "multi";
}

export function getScenarioTemplate(id: string): ScenarioPackage | undefined {
  return SCENARIO_TEMPLATES.find((t) => t.id === id);
}

/** Get a localized scenario template by id. */
export function getLocalizedScenarioTemplate(
  id: string,
  locale: string,
): ScenarioPackage | undefined {
  const tpl = getScenarioTemplate(id);
  return tpl ? localizeScenario(tpl, locale) : undefined;
}

/** Get only single-agent templates (for Agent detail persona tab). */
export function getSingleAgentTemplates(): ScenarioPackage[] {
  return SCENARIO_TEMPLATES.filter((t) => t.scenario.type === "single");
}

/**
 * React hook: returns all scenarios localized to the user's current language.
 */
export function useLocalizedScenarios(): ScenarioPackage[] {
  const language = useSettingsStore((s) => s.language);
  return useMemo(
    () => SCENARIO_TEMPLATES.map((s) => localizeScenario(s, language)),
    [language],
  );
}

/**
 * React hook: returns all unique tags from localized scenarios.
 */
export function useLocalizedTags(): string[] {
  const language = useSettingsStore((s) => s.language);
  return useMemo(() => getAllTags(language), [language]);
}

/**
 * Create or update cron jobs defined in a scenario for the given agent.
 * Uses upsert to avoid duplicates when re-applying a scenario.
 */
export async function applyScenarioCron(
  scenario: ScenarioPackage,
  agentId: string,
): Promise<void> {
  let cronDefs: CronJobDef[] = [];
  if (scenario.scenario.type === "single") {
    cronDefs = scenario.scenario.cron ?? [];
  } else {
    for (const role of scenario.scenario.agents) {
      cronDefs.push(...(role.cron ?? []));
    }
  }
  await upsertScenarioCronJobs(cronDefs, agentId);
}

/**
 * Return a deep copy of the scenario with locale overrides applied.
 * Falls back to the base (Chinese) when no override exists for a field.
 * The `locales` key itself is preserved so export still works.
 */
export function localizeScenario(
  pkg: ScenarioPackage,
  locale: string,
): ScenarioPackage {
  // Base locale (zh-CN) — no transformation needed
  if (locale === "zh-CN" || !pkg.locales?.[locale]) return pkg;

  const ov = pkg.locales[locale];
  const out: ScenarioPackage = {
    ...pkg,
    name: ov.name ?? pkg.name,
    description: ov.description ?? pkg.description,
    tags: ov.tags ?? pkg.tags,
  };

  if (pkg.scenario.type === "single") {
    out.scenario = {
      ...pkg.scenario,
      soul: ov.soul ?? pkg.scenario.soul,
      identity: ov.identity ?? pkg.scenario.identity,
      heartbeat: ov.heartbeat ?? pkg.scenario.heartbeat,
      cron: pkg.scenario.cron?.map((c, i) => ({
        ...c,
        name: ov.cron?.[i]?.name ?? c.name,
        message: ov.cron?.[i]?.message ?? c.message,
      })),
    };
  } else {
    // Flat cron index across all agents (ov.cron is a flat array)
    let cronIdx = 0;
    out.scenario = {
      ...pkg.scenario,
      orchestration: ov.orchestration ?? pkg.scenario.orchestration,
      agents: pkg.scenario.agents.map((agent, i) => ({
        ...agent,
        name: ov.agents?.[i]?.name ?? agent.name,
        soul: ov.agents?.[i]?.soul ?? agent.soul,
        identity: ov.agents?.[i]?.identity ?? agent.identity,
        heartbeat: ov.agents?.[i]?.heartbeat ?? agent.heartbeat,
        cron: agent.cron?.map((c) => {
          const ci = cronIdx++;
          return {
            ...c,
            name: ov.cron?.[ci]?.name ?? c.name,
            message: ov.cron?.[ci]?.message ?? c.message,
          };
        }),
      })),
    };
  }

  return out;
}

/** Collect all unique tags from all scenarios (optionally localized). */
export function getAllTags(locale?: string): string[] {
  const tagSet = new Set<string>();
  for (const s of SCENARIO_TEMPLATES) {
    const localized = locale ? localizeScenario(s, locale) : s;
    for (const tag of localized.tags) tagSet.add(tag);
  }
  return Array.from(tagSet);
}
