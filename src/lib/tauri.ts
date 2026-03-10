import { invoke } from "@tauri-apps/api/core";

export interface EnvCheckItem {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface GatewayInfo {
  running: boolean;
  url: string;
  uptime: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  context_tokens: number;
}

export interface AgentsInfo {
  count: number;
  list: string[];
}

export interface ChannelsInfo {
  configured: string[];
  enabled: string[];
}

export interface SecurityInfo {
  critical: number;
  warnings: number;
  info: number;
  findings: string[];
}

export interface SessionsInfo {
  total: number;
}

export interface StatusData {
  gateway: GatewayInfo;
  model: ModelInfo;
  agents: AgentsInfo;
  channels: ChannelsInfo;
  security: SecurityInfo;
  sessions: SessionsInfo;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

export interface AgentDetail {
  id: string;
  workspace: string;
  bindings: number;
  is_default: boolean;
  identity_name: string;
  identity_emoji: string;
  agent_dir: string;
  created_at: string;
  model: string;
}

export interface SystemInfo {
  os_version: string;
  arch: string;
  memory_gb: number;
}

/** Write a log entry to the Tauri app log file. */
export function appLog(level: "info" | "warn" | "error", message: string): void {
  invoke("frontend_log", { level, message }).catch(() => {});
}

export async function runEnvCheck(): Promise<EnvCheckItem[]> {
  return invoke("run_env_check");
}

export async function getGatewayStatus(): Promise<StatusData> {
  return invoke("get_gateway_status");
}

export async function startGateway(): Promise<string> {
  return invoke("start_gateway");
}

export async function stopGateway(): Promise<string> {
  return invoke("stop_gateway");
}

export async function restartGateway(): Promise<string> {
  return invoke("restart_gateway");
}

// Debounced gateway restart — coalesces rapid config changes
let _restartTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleGatewayRestart(delayMs = 2000): void {
  if (_restartTimer) clearTimeout(_restartTimer);
  _restartTimer = setTimeout(() => {
    _restartTimer = null;
    restartGateway().catch((e) => console.warn("Gateway restart failed:", e));
  }, delayMs);
}

export async function runDoctor(): Promise<string> {
  return invoke("run_doctor");
}

export async function getSystemInfo(): Promise<SystemInfo> {
  return invoke("get_system_info");
}

export type InstallStatus = "installed" | "not_installed" | "stale_dir";

export async function checkOpenClawInstalled(): Promise<InstallStatus> {
  return invoke("check_openclaw_installed");
}

export async function renameStaleOpenclawDir(): Promise<string> {
  return invoke("rename_stale_openclaw_dir");
}

export async function autoFixEnv(itemName: string): Promise<string> {
  return invoke("auto_fix_env", { itemName });
}

export interface InstallProgress {
  step: number;
  total: number;
  label: string;
  status: "running" | "done" | "error";
  percent: number;
  message: string;
  command: string;
}

export async function installOpenClaw(): Promise<string> {
  return invoke("install_openclaw");
}

export async function uninstallOpenClaw(removeData: boolean): Promise<string> {
  return invoke("uninstall_openclaw", { removeData });
}

// --- Model commands ---

import type { ValidateKeyResult } from "../types/provider";

export async function validateApiKey(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<ValidateKeyResult> {
  return invoke("validate_api_key", { providerId, apiKey, baseUrl });
}

export async function configureProvider(
  providerId: string,
  apiKey?: string,
  selectedModel?: string,
  authMode?: string,
  baseUrl?: string,
  setDefault?: boolean,
): Promise<string> {
  return invoke("configure_provider", { providerId, apiKey, selectedModel, authMode, baseUrl, setDefault });
}

export async function startOAuthFlow(providerId: string): Promise<string> {
  return invoke("start_oauth_flow", { providerId });
}

export async function cancelOAuthFlow(): Promise<string> {
  return invoke("cancel_oauth_flow");
}

export async function fetchProviderModels(providerId: string): Promise<string[]> {
  return invoke("fetch_provider_models", { providerId });
}

// --- Channel commands ---

export async function addChannel(
  channelId: string,
  config: Record<string, string>,
  allowFrom: string[] = [],
): Promise<string> {
  return invoke("add_channel", { channelId, config, allowFrom });
}

export async function disableChannel(
  channelId: string,
): Promise<string> {
  return invoke("disable_channel", { channelId });
}

export async function removeChannelAccount(
  channelId: string,
  accountId: string,
): Promise<string> {
  return invoke("remove_channel_account", { channelId, accountId });
}

export async function installChannelPlugin(
  plugin: string,
): Promise<string> {
  return invoke("install_channel_plugin", { plugin });
}

export async function validateChannelCredentials(
  channelId: string,
  config: Record<string, string>,
): Promise<string> {
  return invoke("validate_channel_credentials", { channelId, config });
}

// --- Config commands ---

export async function readOpenClawConfig(): Promise<Record<string, unknown>> {
  return invoke("read_openclaw_config");
}

// --- Log commands ---

export async function readGatewayLogs(limit: number): Promise<LogEntry[]> {
  return invoke("read_gateway_logs", { limit });
}

export async function readAppLogs(limit: number): Promise<LogEntry[]> {
  return invoke("read_app_logs", { limit });
}

// --- Agent commands ---

export async function listAgents(): Promise<AgentDetail[]> {
  return invoke("list_agents");
}

export async function createAgent(
  name: string,
  workspace?: string,
  model?: string,
  bindings?: string[],
): Promise<unknown> {
  return invoke("create_agent", { name, workspace, model, bindings: bindings ?? [] });
}

export async function deleteAgent(agentId: string): Promise<string> {
  return invoke("delete_agent", { agentId });
}

export async function getAgentBindings(agentId: string): Promise<unknown> {
  return invoke("get_agent_bindings", { agentId });
}

export async function bindAgentChannel(agentId: string, bindingSpec: string): Promise<string> {
  return invoke("bind_agent_channel", { agentId, bindingSpec });
}

export async function unbindAgentChannel(agentId: string, bindingSpec: string): Promise<string> {
  return invoke("unbind_agent_channel", { agentId, bindingSpec });
}

export async function setAgentModel(agentId: string, model: string): Promise<string> {
  return invoke("set_agent_model", { agentId, model });
}

export async function listChannelAccounts(channelId: string): Promise<Record<string, unknown>> {
  return invoke("list_channel_accounts", { channelId });
}

export async function listAgentSessions(agentId: string): Promise<unknown> {
  return invoke("list_agent_sessions", { agentId });
}

// --- Config commands (advanced) ---

export async function setConfigValue(path: string, value: string): Promise<string> {
  return invoke("set_config_value", { path, value });
}

// --- Cron commands ---

/** Shape returned by `openclaw cron list --json` */
export interface CronJobEntry {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  schedule: { kind: string; expr?: string; everyMs?: number };
  payload?: { message?: string };
}

export async function listCronJobs(): Promise<{ jobs?: CronJobEntry[] }> {
  const raw = await invoke<string>("list_cron_jobs");
  try {
    return JSON.parse(raw);
  } catch {
    return { jobs: [] };
  }
}

export async function createCronJob(
  name: string,
  agentId: string,
  message: string,
  scheduleType: string,
  scheduleValue: string,
  model?: string,
  thinking?: string,
  channel?: string,
): Promise<unknown> {
  return invoke("create_cron_job", { name, agentId, message, scheduleType, scheduleValue, model, thinking, channel });
}

export async function editCronJob(
  jobId: string,
  name?: string,
  message?: string,
  scheduleType?: string,
  scheduleValue?: string,
  model?: string,
  thinking?: string,
  channel?: string,
): Promise<unknown> {
  return invoke("edit_cron_job", { jobId, name, message, scheduleType, scheduleValue, model, thinking, channel });
}

export async function deleteCronJob(jobId: string): Promise<string> {
  return invoke("delete_cron_job", { jobId });
}

export async function enableCronJob(jobId: string): Promise<string> {
  return invoke("enable_cron_job", { jobId });
}

export async function disableCronJob(jobId: string): Promise<string> {
  return invoke("disable_cron_job", { jobId });
}

export async function getCronRuns(jobId: string): Promise<unknown> {
  const raw = await invoke<string>("get_cron_runs", { jobId });
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Create or update cron jobs for a scenario.
 * If a job with the same name already exists for the given agent, it is
 * updated (edit) instead of duplicated. Returns { created, updated } counts.
 */
export async function upsertScenarioCronJobs(
  defs: Array<{ name: string; message: string; schedule: string; value: string }>,
  agentId: string,
): Promise<{ created: number; updated: number }> {
  if (defs.length === 0) return { created: 0, updated: 0 };

  // Fetch existing jobs once
  let existingJobs: CronJobEntry[] = [];
  try {
    const data = await listCronJobs();
    existingJobs = data?.jobs ?? [];
  } catch {
    // If listing fails, fall back to create-only
  }

  // Index existing jobs by (agentId, name) for O(1) lookup
  const existingByName = new Map<string, CronJobEntry>();
  for (const job of existingJobs) {
    if (job.agentId === agentId) {
      existingByName.set(job.name, job);
    }
  }

  let created = 0;
  let updated = 0;

  for (const def of defs) {
    const existing = existingByName.get(def.name);
    try {
      if (existing) {
        // Update existing job with new schedule and message
        await editCronJob(existing.id, def.name, def.message, def.schedule, def.value);
        updated++;
      } else {
        await createCronJob(def.name, agentId, def.message, def.schedule, def.value);
        created++;
      }
    } catch (e) {
      console.warn(`[upsertScenarioCronJobs] failed "${def.name}":`, e);
    }
  }

  return { created, updated };
}

// --- Usage commands ---

export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  estimatedCost: number;
  messageCount: number;
}

export interface ModelUsage {
  provider: string;
  model: string;
  totalTokens: number;
  estimatedCost: number;
  messageCount: number;
}

export interface UsageStats {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalTokens: number;
  totalCost: number;
  totalMessages: number;
  activeDays: number;
  daily: DailyUsage[];
  byModel: ModelUsage[];
}

export async function computeUsageStats(agentId?: string): Promise<UsageStats> {
  return invoke("compute_usage_stats", { agentId: agentId ?? null });
}

// --- Backup commands ---

export async function exportConfig(destPath: string): Promise<string> {
  return invoke("export_config", { destPath });
}

export interface BackupPrecheck {
  backupVersion: string;
  localVersion: string;
  exportedAt: string;
}

export async function precheckBackup(srcPath: string): Promise<BackupPrecheck> {
  return invoke("precheck_backup", { srcPath });
}

export async function importConfig(srcPath: string): Promise<string> {
  return invoke("import_config", { srcPath });
}

// --- Model management commands ---

export interface ConfiguredModel {
  key: string;
  name: string;
  input: string;
  contextWindow: number;
  local: boolean;
  available: boolean;
  tags: string[];
  missing: boolean;
}

export interface ConfiguredModelList {
  count: number;
  models: ConfiguredModel[];
}

export async function getModelsStatus(): Promise<Record<string, unknown>> {
  return invoke("get_models_status");
}

export async function listConfiguredModels(): Promise<ConfiguredModelList> {
  return invoke("list_configured_models");
}

/** List all models from the full catalog; each has `available` flag based on provider auth. */
export async function listAllAvailableModels(): Promise<ConfiguredModelList> {
  return invoke("list_all_available_models");
}

/**
 * Pure merge: catalog models (available=true) + configured models (always included).
 * Custom providers (e.g. qwen-portal) may not appear in the catalog at all,
 * so we always include explicitly configured models regardless of `available` flag.
 */
export function mergeSelectableModels(
  catalogModels: ConfiguredModel[],
  configuredModels: ConfiguredModel[],
): ConfiguredModel[] {
  const seen = new Set<string>();
  const result: ConfiguredModel[] = [];

  for (const m of catalogModels) {
    if (m.available && !seen.has(m.key)) {
      seen.add(m.key);
      result.push(m);
    }
  }

  for (const m of configuredModels) {
    if (!seen.has(m.key)) {
      seen.add(m.key);
      result.push({ ...m, available: true });
    }
  }

  return result;
}

/** Fetch and merge catalog + configured models into a unified selectable list. */
export async function listSelectableModels(): Promise<ConfiguredModel[]> {
  const [catalog, configured] = await Promise.all([
    listAllAvailableModels().catch(() => ({ count: 0, models: [] as ConfiguredModel[] })),
    listConfiguredModels().catch(() => ({ count: 0, models: [] as ConfiguredModel[] })),
  ]);

  return mergeSelectableModels(catalog.models, configured.models);
}

export async function setDefaultModel(model: string): Promise<string> {
  return invoke("set_default_model", { model });
}

export async function addModelFallback(model: string): Promise<string> {
  return invoke("add_model_fallback", { model });
}

export async function removeModelFallback(model: string): Promise<string> {
  return invoke("remove_model_fallback", { model });
}

export async function removeProvider(provider: string): Promise<string> {
  return invoke("remove_provider", { provider });
}

// --- Scenario commands ---

export async function setToolsProfile(profile: string): Promise<string> {
  return invoke("set_tools_profile", { profile });
}

export interface AgentPersona {
  soul: string;
  identity: string;
  heartbeat: string;
  name: string;
  emoji: string;
}

export async function applyScenario(
  soul: string,
  identity: string,
  heartbeat: string,
  name: string,
  emoji: string,
  agentId?: string,
): Promise<string> {
  return invoke("apply_scenario", { soul, identity, heartbeat, name, emoji, agentId });
}

export async function readAgentPersona(agentId?: string): Promise<AgentPersona> {
  return invoke("read_agent_persona", { agentId });
}

export async function enableScenarioSkills(skills: string[]): Promise<string> {
  return invoke("enable_scenario_skills", { skills });
}

export interface SkillInstallHint {
  kind: string;
  label: string;
  command: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  source: "bundled" | "workspace" | "managed";
  ready: boolean;
  enabled: boolean;
  missingDeps: string[];
  trusted: boolean;
  homepage?: string;
  installHints: SkillInstallHint[];
}

export async function listSkills(agentId?: string): Promise<SkillInfo[]> {
  return invoke("list_skills", { agentId: agentId ?? null });
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<string> {
  return invoke("set_skill_enabled", { name, enabled });
}

export async function setTrustedSources(sources: string[]): Promise<string> {
  return invoke("set_trusted_sources", { sources });
}

export async function getTrustedSources(): Promise<string[]> {
  return invoke("get_trusted_sources");
}

export async function installSkillDeps(deps: string[]): Promise<string> {
  return invoke("install_skill_deps", { deps });
}
