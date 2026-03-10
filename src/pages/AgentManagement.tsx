import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  RefreshCw,
  Loader2,
  Plus,
  Trash2,
  X,
  Clock,
  MessageSquare,
  ToggleLeft,
  ToggleRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ShieldCheck,
  Pencil,
  Info,
  Search,
} from "lucide-react";
import Header from "../components/layout/Header";
import Button from "../components/ui/Button";
import EmojiPicker from "../components/ui/EmojiPicker";
import AddProviderModal from "../components/model/AddProviderModal";
import AddChannelModal from "../components/channel/AddChannelModal";
import { ModelSearchSelect } from "../components/ui/ModelSearchSelect";
import {
  listAgents,
  getGatewayStatus,
  readOpenClawConfig,
  createAgent,
  deleteAgent,
  bindAgentChannel,
  unbindAgentChannel,
  listCronJobs,
  createCronJob,
  editCronJob,
  deleteCronJob,
  enableCronJob,
  disableCronJob,
  getCronRuns,
  computeUsageStats,
  readAgentPersona,
  applyScenario,
  listSelectableModels,
  setAgentModel,
  scheduleGatewayRestart,
  listSkills,
  setSkillEnabled,
  installSkillDeps,
  setToolsProfile,
  enableScenarioSkills,
  upsertScenarioCronJobs,
  type AgentDetail,
  type StatusData,
  type UsageStats,
  type ConfiguredModel,
  type SkillInfo,
} from "../lib/tauri";
import { useAppStore } from "../stores/appStore";
import { useSettingsStore } from "../stores/settingsStore";
import { SCENARIO_TEMPLATES, getSingleScenario, getScenarioTemplate, getLocalizedScenarioTemplate, getSingleAgentTemplates } from "../lib/scenarioTemplates";
import { CHANNEL_LOGOS } from "../lib/logos";
import { useT } from "../lib/i18n";
import type { AgentBinding, BindingMatch } from "../types/binding";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { parseBindingsFromConfig, toBindSpec, bindingDisplayText } from "../lib/bindings";

const detailTabs = [
  { key: "overview", labelKey: "agent.tabOverview" },
  { key: "persona", labelKey: "agent.tabPersona" },
  { key: "skills", labelKey: "agent.tabSkills" },
  { key: "cron", labelKey: "agent.tabCron" },
  { key: "stats", labelKey: "agent.tabStats" },
] as const;
type DetailTab = (typeof detailTabs)[number]["key"];

/** Try to resolve a friendly display name + emoji for an agent. */
function resolveAgentMeta(agent: AgentDetail) {
  // Prefer identity fields returned directly from the CLI
  if (agent.identity_name) {
    const tpl = SCENARIO_TEMPLATES.find((t) => t.name === agent.identity_name);
    if (tpl) return { name: tpl.name, emoji: tpl.emoji };
    return { name: agent.identity_name, emoji: agent.identity_emoji || "" };
  }
  const tpl = SCENARIO_TEMPLATES.find((t) => t.id === agent.id);
  if (tpl) return { name: tpl.name, emoji: tpl.emoji };
  return { name: agent.id, emoji: "" };
}

// ── Modals ──

function CreateAgentModal({
  onClose,
  onCreated,
  config,
}: {
  onClose: () => void;
  onCreated: () => void;
  config: Record<string, unknown> | null;
}) {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  type WizardStep = 1 | 2 | 3 | 4;
  const STEPS: { step: WizardStep; labelKey: string }[] = [
    { step: 1, labelKey: "agent.wizardStep1" },
    { step: 2, labelKey: "agent.wizardStep2" },
    { step: 3, labelKey: "agent.wizardStep3" },
    { step: 4, labelKey: "agent.wizardStep4" },
  ];
  const [step, setStep] = useState<WizardStep>(1);

  // Step 1: identity
  const singleTemplates = getSingleAgentTemplates();
  const [selectedTplId, setSelectedTplId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");

  // Step 2: model
  const [model, setModel] = useState("");
  const [availableModels, setAvailableModels] = useState<ConfiguredModel[]>([]);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [configuredProviderIds, setConfiguredProviderIds] = useState<string[]>([]);

  // Step 3: channel bindings
  interface BindingSelection { channel: string; accountId?: string }
  const [selectedBindings, setSelectedBindings] = useState<BindingSelection[]>([]);
  const [showAddChannel, setShowAddChannel] = useState(false);

  // Step 4: confirm
  const [workspace, setWorkspace] = useState("");
  const [showWorkspace, setShowWorkspace] = useState(false);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const RESERVED_NAMES = ["main", "default"];
  const [existingIds, setExistingIds] = useState<string[]>([]);
  /** Map of bindKey (channel or channel:accountId) → agentId for already-bound units */
  const [boundBindMap, setBoundBindMap] = useState<Record<string, string>>({});
  /** Live config snapshot — refreshed when sub-modals close */
  const [liveConfig, setLiveConfig] = useState(config);

  /** Turn any string into a CLI-safe ASCII slug */
  const toSlug = (s: string): string => {
    const tpl = selectedTplId
      ? singleTemplates.find((t) => t.id === selectedTplId)
      : null;
    if (tpl && s === tpl.name) return tpl.id;
    const slug = s
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || "agent";
  };

  /** Generate a unique id based on a slug, appending -2, -3, etc. if needed */
  const uniqueId = (base: string): string => {
    if (!RESERVED_NAMES.includes(base) && !existingIds.includes(base)) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base}-${i}`;
      if (!RESERVED_NAMES.includes(candidate) && !existingIds.includes(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  };

  // Derive channel info from live config
  const channelsConfig = (liveConfig?.channels ?? {}) as Record<string, Record<string, unknown>>;
  const enabledChannels = Object.entries(channelsConfig)
    .filter(([, v]) => v?.enabled === true)
    .map(([k]) => k);

  interface BindableUnit { channel: string; accountId?: string; key: string; label: string }
  const allBindableUnits: BindableUnit[] = [];
  for (const ch of enabledChannels) {
    const accounts = channelsConfig[ch]?.accounts as Record<string, Record<string, unknown>> | undefined;
    if (accounts && Object.keys(accounts).length > 0) {
      for (const acctId of Object.keys(accounts)) {
        const acct = accounts[acctId];
        const acctName = (acct?.name as string) || acctId;
        allBindableUnits.push({
          channel: ch,
          accountId: acctId,
          key: `${ch}:${acctId}`,
          label: acctId === "default" ? ch : `${ch} / ${acctName}`,
        });
      }
    } else {
      // Flat config = implicit "default" account (CLI always binds with accountId=default)
      allBindableUnits.push({ channel: ch, accountId: "default", key: `${ch}:default`, label: ch });
    }
  }
  // Filter out units already bound by other agents.
  // An account-specific unit (has accountId) is only blocked by its own specific
  // binding — NOT by a channel-level binding, because in OpenClaw account-specific
  // bindings take precedence over channel-level ones.
  const bindableUnits = allBindableUnits.filter((u) => {
    if (boundBindMap[u.key]) return false;
    if (!u.accountId && boundBindMap[u.channel]) return false;
    return true;
  });
  const configuredChannelIds = new Set(Object.keys(channelsConfig).filter((k) => channelsConfig[k]?.enabled === true));

  /** Refresh models list */
  const refreshModels = useCallback(() => {
    listSelectableModels()
      .then((models) => setAvailableModels(models))
      .catch(() => {});
  }, []);

  /** Refresh bindings map from config + agent list */
  const refreshBindings = useCallback((cfg: Record<string, unknown> | null) => {
    // Agent IDs from config (for reserved name check)
    listAgents()
      .then((agents) => setExistingIds(agents.map((a) => a.id.toLowerCase())))
      .catch(() => {});
    // Bindings from config — instant, no CLI calls
    const all = parseBindingsFromConfig(cfg);
    const map: Record<string, string> = {};
    for (const b of all) {
      if (!b.match.channel) continue;
      const key = b.match.accountId
        ? `${b.match.channel}:${b.match.accountId}`
        : b.match.channel;
      if (!map[key]) map[key] = b.agentId;
    }
    setBoundBindMap(map);
  }, []);

  /** Refresh config (channels + provider ids) + bindings.
   *  Returns a Promise that resolves once the config is loaded. */
  const refreshConfig = useCallback(async () => {
    try {
      const cfg = await readOpenClawConfig();
      setLiveConfig(cfg);
      const modelsSection = (cfg as Record<string, unknown>)?.models as Record<string, unknown> | undefined;
      if (modelsSection?.providers) {
        setConfiguredProviderIds(Object.keys(modelsSection.providers as Record<string, unknown>));
      }
      refreshBindings(cfg);
    } catch { /* ignore */ }
  }, [refreshBindings]);

  useEffect(() => {
    refreshModels();
    refreshConfig();
  }, [refreshModels, refreshConfig]);

  const selectTemplate = (tplId: string | null) => {
    setSelectedTplId(tplId);
    if (tplId) {
      const tpl = singleTemplates.find((t) => t.id === tplId);
      if (tpl) { setName(tpl.name); setEmoji(tpl.emoji); }
    } else {
      setName(""); setEmoji("");
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    const cliId = uniqueId(toSlug(name.trim()));
    setCreating(true);
    setError("");
    try {
      // Create agent WITHOUT --bind; we'll bind separately for better error handling
      const res = await createAgent(
        cliId,
        workspace.trim() || undefined,
        model || undefined,
        [], // bindings applied separately below
      );

      const created = res as { agentId?: string; id?: string };
      const createdId = created?.agentId || created?.id || cliId;

      // Apply persona
      const tpl = selectedTplId
        ? singleTemplates.find((t) => t.id === selectedTplId)
        : null;
      const scenario = tpl ? getSingleScenario(tpl) : undefined;
      if (scenario) {
        await applyScenario(
          scenario.soul, scenario.identity, scenario.heartbeat,
          name.trim(), emoji || "✨", createdId,
        );
      } else if (name.trim()) {
        const identity = `# IDENTITY.md\n\n- **Name:** ${name.trim()}\n- **Emoji:** ${emoji || "✨"}\n`;
        await applyScenario("", identity, "", name.trim(), emoji || "✨", createdId);
      }

      // Apply scenario extras: toolsProfile, skills, cron
      if (tpl && selectedTplId) {
        // Localized template for correct cron defs
        const localTpl = getLocalizedScenarioTemplate(selectedTplId, language);
        const localScenario = localTpl ? getSingleScenario(localTpl) : undefined;

        // Tools profile
        if (tpl.toolsProfile) {
          await setToolsProfile(tpl.toolsProfile).catch(() => {});
        }

        // Skills
        if (tpl.skills.length > 0) {
          await enableScenarioSkills(tpl.skills).catch(() => {});
        }

        // Cron jobs
        const cronDefs = localScenario?.cron ?? scenario?.cron ?? [];
        if (cronDefs.length > 0) {
          await upsertScenarioCronJobs(cronDefs, createdId).catch(() => {});
        }
      }

      // Bind channels separately — gives us per-binding error handling
      const bindFailures: string[] = [];
      if (selectedBindings.length > 0) {
        const results = await Promise.all(
          selectedBindings.map(async (b) => {
            const spec = b.accountId ? `${b.channel}:${b.accountId}` : b.channel;
            try {
              await bindAgentChannel(createdId, spec);
              return null;
            } catch (e) {
              return `${spec}: ${String(e)}`;
            }
          }),
        );
        bindFailures.push(...results.filter(Boolean) as string[]);
      }

      onCreated();
      if (bindFailures.length > 0) {
        // Agent created but some bindings failed — show warning, don't block
        setError(t("agent.bindConflict") + ": " + bindFailures.join("; "));
        // Still close after a short delay so user can see the warning
        setTimeout(onClose, 2500);
      } else {
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  // ── Step indicator ──
  const stepIndicator = (
    <div className="mb-5 flex gap-2">
      {STEPS.map(({ step: s, labelKey }) => (
        <div key={s} className="flex flex-1 flex-col gap-1">
          <div
            className={`h-1 rounded-full ${
              s <= step ? "bg-[var(--primary)]" : "bg-[var(--border)]"
            }`}
          />
          <span
            className={`text-[11px] ${
              s === step
                ? "font-medium text-[var(--primary)]"
                : "text-[var(--text-secondary)]"
            }`}
          >
            {t(labelKey)}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[540px] rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {t("agent.createAgent")}
          </h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
          >
            <X size={16} />
          </button>
        </div>

        {stepIndicator}

        {/* ── Step 1: Persona ── */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-[var(--text-secondary)]">
              {t("agent.wizardStep1Desc")}
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => selectTemplate(null)}
                className={`flex flex-none flex-col items-center gap-1 rounded-lg border px-4 py-3 transition-colors ${
                  selectedTplId === null
                    ? "border-[var(--primary)] bg-[var(--primary)]/10"
                    : "border-[var(--border)] hover:border-[var(--primary-light)]"
                }`}
              >
                <span className="text-xl">📄</span>
                <span className="whitespace-nowrap text-[12px] font-medium text-[var(--text-primary)]">
                  {t("agent.wizardBlankTemplate")}
                </span>
              </button>
              {singleTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => selectTemplate(tpl.id)}
                  className={`flex flex-none flex-col items-center gap-1 rounded-lg border px-4 py-3 transition-colors ${
                    selectedTplId === tpl.id
                      ? "border-[var(--primary)] bg-[var(--primary)]/10"
                      : "border-[var(--border)] hover:border-[var(--primary-light)]"
                  }`}
                >
                  <span className="text-xl">{tpl.emoji}</span>
                  <span className="whitespace-nowrap text-[12px] font-medium text-[var(--text-primary)]">
                    {tpl.name}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-[var(--text-secondary)]">
                  {t("agent.emojiLabel")}
                </label>
                <EmojiPicker value={emoji} onChange={setEmoji} />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-[11px] text-[var(--text-secondary)]">
                  {t("agent.name")} *
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("agent.namePlaceholder")}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Model ── */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-[var(--text-secondary)]">
              {t("agent.wizardStep2Desc")}
            </p>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-[var(--text-secondary)]">
                {t("agent.wizardModel")}
              </label>
              {availableModels.length > 0 ? (
                <ModelSearchSelect
                  models={availableModels}
                  value={model}
                  onChange={setModel}
                  placeholder={t("agent.wizardModelDefault")}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-center">
                  <p className="text-xs text-[var(--text-secondary)]">{t("agent.wizardNoModels")}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{t("agent.wizardNoModelsHint")}</p>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowAddProvider(true)}
              className="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-[var(--primary)]/40 px-3 py-1.5 text-xs text-[var(--primary)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary)]/5"
            >
              <Plus size={14} />
              {t("agent.wizardAddProvider")}
            </button>
          </div>
        )}

        {/* ── Step 3: Channel ── */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-[var(--text-secondary)]">
              {t("agent.wizardStep3Desc")}
            </p>

            {allBindableUnits.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-[var(--text-secondary)]">
                  {t("agent.wizardChannels")}
                </label>
                {bindableUnits.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {bindableUnits.map((unit) => {
                      const active = selectedBindings.some(
                        (b) => b.channel === unit.channel && (b.accountId ?? undefined) === unit.accountId,
                      );
                      return (
                        <button
                          key={unit.key}
                          onClick={() =>
                            setSelectedBindings((prev) =>
                              active
                                ? prev.filter((b) => !(b.channel === unit.channel && (b.accountId ?? undefined) === unit.accountId))
                                : [...prev, { channel: unit.channel, accountId: unit.accountId }],
                            )
                          }
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                            active
                              ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                              : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--primary-light)]"
                          }`}
                        >
                          {CHANNEL_LOGOS[unit.channel] && (
                            <img src={CHANNEL_LOGOS[unit.channel]} alt={unit.channel} className="h-3.5 w-3.5" />
                          )}
                          {unit.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddChannel(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--primary)]/40 px-3 py-2 text-xs text-[var(--primary)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary)]/5"
                  >
                    <Plus size={14} />
                    {t("agent.addAccountToBind")}
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-center">
                <p className="text-xs text-[var(--text-secondary)]">{t("agent.wizardNoChannels")}</p>
                <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{t("agent.wizardNoChannelsHint")}</p>
              </div>
            )}

            {bindableUnits.length > 0 && (
              <button
                onClick={() => setShowAddChannel(true)}
                className="flex items-center gap-1.5 self-start rounded-lg border border-dashed border-[var(--primary)]/40 px-3 py-1.5 text-xs text-[var(--primary)] transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary)]/5"
              >
                <Plus size={14} />
                {t("agent.wizardAddChannel")}
              </button>
            )}
          </div>
        )}

        {/* ── Step 4: Confirm ── */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <p className="text-[13px] text-[var(--text-secondary)]">
              {t("agent.wizardStep4Desc")}
            </p>

            {/* Summary */}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4">
              <div className="flex flex-col gap-3">
                {/* Persona */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-secondary)]">{t("agent.wizardSummaryPersona")}</span>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                    {emoji && <span>{emoji}</span>}
                    {name}
                  </span>
                </div>
                {/* Model */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--text-secondary)]">{t("agent.wizardSummaryModel")}</span>
                  <span className="text-sm text-[var(--text-primary)]">
                    {model || t("agent.wizardSummaryDefault")}
                  </span>
                </div>
                {/* Channels */}
                <div className="flex items-start justify-between">
                  <span className="text-xs text-[var(--text-secondary)]">{t("agent.wizardSummaryChannels")}</span>
                  {selectedBindings.length > 0 ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      {selectedBindings.map((b) => {
                        const key = b.accountId ? `${b.channel}:${b.accountId}` : b.channel;
                        const unit = allBindableUnits.find((u) => u.key === key);
                        return (
                          <span
                            key={key}
                            className="inline-flex items-center gap-1 rounded-md bg-[var(--bg-main)] px-2 py-0.5 text-[11px] text-[var(--text-primary)]"
                          >
                            {CHANNEL_LOGOS[b.channel] && (
                              <img src={CHANNEL_LOGOS[b.channel]} alt={b.channel} className="h-3 w-3" />
                            )}
                            {unit?.label ?? key}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-sm text-[var(--text-secondary)]">{t("agent.wizardSummaryNone")}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Workspace (collapsible) */}
            <div>
              <button
                onClick={() => setShowWorkspace(!showWorkspace)}
                className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {showWorkspace ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t("agent.wizardWorkspace")}
              </button>
              {showWorkspace && (
                <input
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder={t("agent.wizardWorkspaceHint")}
                  className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 font-mono text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
                />
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 text-xs text-[var(--danger)]">{error}</p>
        )}

        {/* Footer */}
        <div className="mt-6 flex justify-end gap-3">
          {step === 1 && (
            <>
              <Button variant="secondary" size="sm" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={() => setStep(2)} disabled={!name.trim()}>
                {t("common.next")} →
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setStep(1)}>
                ← {t("common.prev")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => { setModel(""); setStep(3); }}>
                {t("agent.wizardSkip")} →
              </Button>
              <Button size="sm" onClick={() => setStep(3)}>
                {t("common.next")} →
              </Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setStep(2)}>
                ← {t("common.prev")}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => { setSelectedBindings([]); setStep(4); }}>
                {t("agent.wizardSkip")} →
              </Button>
              <Button size="sm" onClick={() => setStep(4)}>
                {t("common.next")} →
              </Button>
            </>
          )}
          {step === 4 && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setStep(3)}>
                ← {t("common.prev")}
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={!name.trim() || creating}>
                {creating ? t("agent.creating") : t("agent.createAgent")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Sub-modals */}
      {showAddProvider && (
        <AddProviderModal
          onClose={() => setShowAddProvider(false)}
          onDone={(selectedModel) => {
            setShowAddProvider(false);
            if (selectedModel) setModel(selectedModel);
            refreshModels();
            refreshConfig();
          }}
          configuredProviderIds={configuredProviderIds}
        />
      )}
      {showAddChannel && (
        <AddChannelModal
          open
          onClose={() => setShowAddChannel(false)}
          onSuccess={async () => {
            await refreshConfig();
            setShowAddChannel(false);
          }}
          configuredIds={configuredChannelIds}
          channelConfigs={channelsConfig}
        />
      )}
    </div>
  );
}

// Schedule presets for quick selection
const SCHEDULE_PRESETS = [
  { labelKey: "agent.cronPresetEvery30m", type: "every", value: "30m" },
  { labelKey: "agent.cronPresetEvery1h", type: "every", value: "1h" },
  { labelKey: "agent.cronPresetEvery6h", type: "every", value: "6h" },
  { labelKey: "agent.cronPresetDaily9am", type: "cron", value: "0 9 * * *" },
  { labelKey: "agent.cronPresetDaily21pm", type: "cron", value: "0 21 * * *" },
  { labelKey: "agent.cronPresetWeekday9am", type: "cron", value: "0 9 * * 1-5" },
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CronJobModal({
  agentId,
  editJob,
  onClose,
  onSaved,
}: {
  agentId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editJob?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const isEdit = !!editJob;
  const [name, setName] = useState(editJob?.name || "");
  const [message, setMessage] = useState(
    editJob?.payload?.message || editJob?.message || "",
  );
  const [scheduleType, setScheduleType] = useState(
    editJob?.schedule?.kind === "every" || editJob?.every ? "every" : "cron",
  );
  const [scheduleValue, setScheduleValue] = useState(() => {
    // "cron" kind → use expr; "every" kind → convert everyMs back to human string
    if (editJob?.schedule?.expr) return editJob.schedule.expr;
    if (editJob?.schedule?.everyMs) {
      const ms = editJob.schedule.everyMs as number;
      if (ms >= 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
      if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
      if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
      return `${ms / 60_000}m`;
    }
    return editJob?.every || editJob?.cron || "";
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showCronHelp, setShowCronHelp] = useState(false);

  const applyPreset = (preset: (typeof SCHEDULE_PRESETS)[number]) => {
    setScheduleType(preset.type);
    setScheduleValue(preset.value);
  };

  const handleSave = async () => {
    if (!name.trim() || !message.trim() || !scheduleValue.trim()) return;
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        const jobId = editJob.id || editJob.jobId;
        await editCronJob(
          jobId,
          name.trim(),
          message.trim(),
          scheduleType,
          scheduleValue.trim(),
        );
      } else {
        await createCronJob(
          name.trim(),
          agentId,
          message.trim(),
          scheduleType,
          scheduleValue.trim(),
        );
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[520px] max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {isEdit ? t("agent.editCronJob") : t("agent.createCronJob")}
          </h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-[13px] text-[var(--text-secondary)]">
              {t("agent.cronName")} *
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("agent.cronNamePlaceholder")}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
            />
          </div>

          {/* Message */}
          <div>
            <label className="mb-1.5 block text-[13px] text-[var(--text-secondary)]">
              {t("agent.cronMessage")} *
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("agent.cronMessagePlaceholder")}
              rows={3}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)] resize-none"
            />
          </div>

          {/* Schedule presets */}
          <div>
            <label className="mb-1.5 block text-[13px] text-[var(--text-secondary)]">
              {t("agent.cronPresets")}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SCHEDULE_PRESETS.map((preset) => {
                const active = scheduleType === preset.type && scheduleValue === preset.value;
                return (
                  <button
                    key={preset.value}
                    onClick={() => applyPreset(preset)}
                    className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                      active
                        ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                        : "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
                    }`}
                  >
                    {t(preset.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Schedule type + value */}
          <div className="flex gap-3">
            <div className="w-[140px] shrink-0">
              <label className="mb-1.5 block text-[13px] text-[var(--text-secondary)]">
                {t("agent.cronScheduleType")}
              </label>
              <select
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
              >
                <option value="cron">{t("agent.cronScheduleCron")}</option>
                <option value="every">{t("agent.cronScheduleEvery")}</option>
              </select>
            </div>
            <div className="relative flex-1">
              <label className="mb-1.5 flex items-center gap-1 text-[13px] text-[var(--text-secondary)]">
                {t("agent.cronScheduleValue")} *
                {scheduleType === "cron" && (
                  <button
                    type="button"
                    onClick={() => setShowCronHelp((v) => !v)}
                    className="rounded p-0.5 text-[var(--text-secondary)] hover:text-[var(--primary)]"
                  >
                    <Info size={13} />
                  </button>
                )}
              </label>
              {showCronHelp && scheduleType === "cron" && (
                <>
                  {/* Backdrop: click to dismiss */}
                  <div className="fixed inset-0 z-10" onClick={() => setShowCronHelp(false)} />
                  <div className="absolute bottom-full left-0 z-20 mb-1 w-80 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] p-3 shadow-lg">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {t("agent.cronHelpTitle")}
                      </span>
                      <button onClick={() => setShowCronHelp(false)} className="rounded p-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                        <X size={12} />
                      </button>
                    </div>
                    <p className="mb-1.5 text-[11px] font-medium text-[var(--text-primary)]">{t("agent.cronHelpFormat")}</p>
                    <div className="mb-1.5 flex flex-col gap-0.5">
                      {([
                        ["0 9 * * *", "agent.cronHelpExample1"],
                        ["0 * * * *", "agent.cronHelpExample2"],
                        ["30 9 * * 1-5", "agent.cronHelpExample3"],
                        ["*/15 * * * *", "agent.cronHelpExample4"],
                        ["0 9,18 * * *", "agent.cronHelpExample5"],
                        ["0 10 1 * *", "agent.cronHelpExample6"],
                        ["0 8 * * 0", "agent.cronHelpExample7"],
                      ] as const).map(([expr, key]) => (
                        <button
                          key={expr}
                          onClick={() => { setScheduleValue(expr); setShowCronHelp(false); }}
                          className="flex items-center justify-between rounded px-2 py-1 text-left hover:bg-[var(--bg-surface)]"
                        >
                          <code className="text-[11px] font-semibold text-[var(--primary)]">{expr}</code>
                          <span className="text-[11px] text-[var(--text-primary)]">{t(key)}</span>
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-[var(--border)] pt-1.5">
                      <p className="text-[10px] leading-snug text-[var(--text-primary)]">{t("agent.cronHelpFields")}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--text-primary)]/70">{t("agent.cronHelpSpecial")}</p>
                    </div>
                  </div>
                </>
              )}
              <input
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
                placeholder={
                  scheduleType === "every"
                    ? "30m, 1h, 6h, 1d"
                    : "0 9 * * *"
                }
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
              />
              <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
                {scheduleType === "every"
                  ? t("agent.cronEveryHint")
                  : t("agent.cronCronHint")}
              </span>
            </div>
          </div>


          {error && (
            <p className="text-xs text-[var(--danger)]">{error}</p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={
              !name.trim() ||
              !message.trim() ||
              !scheduleValue.trim() ||
              saving
            }
          >
            {saving
              ? t("common.applying")
              : isEdit
                ? t("common.save")
                : t("agent.createCronJob")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Tab Components ──

function formatCost(cost: number, symbol: string): string {
  if (cost === 0) return `${symbol}0.00`;
  if (cost < 0.01) return `${symbol}${cost.toFixed(4)}`;
  return `${symbol}${cost.toFixed(2)}`;
}

/** Format token count: 1234 → "1,234", 12345 → "12.3k", 1234567 → "1.23M" */
function formatTokenCount(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function formatTokens(tokens: number): string {
  if (tokens === 0) return "0";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function OverviewTab({
  agent,
  status,
  config,
  usageStats,
  onModelChanged,
  onConfigChanged,
}: {
  agent: AgentDetail;
  status: StatusData | null;
  config: Record<string, unknown> | null;
  usageStats: UsageStats | null;
  onModelChanged?: () => void;
  onConfigChanged?: () => Promise<void>;
}) {
  const t = useT();
  const modelName =
    agent.model || status?.model?.name || status?.model?.id || t("common.notConfigured");

  const meta = resolveAgentMeta(agent);
  const scenarioName = meta.emoji ? `${meta.emoji} ${meta.name}` : meta.name;

  const channelsConfig = (config?.channels ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const enabledChannels = Object.entries(channelsConfig)
    .filter(([, v]) => v?.enabled === true)
    .map(([k]) => k);

  // Extract today's token usage from usage stats (local date, not UTC)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todayData = usageStats?.daily.find((d) => d.date === today);
  const todayTokens = todayData?.totalTokens ?? 0;

  // Per-agent model switching
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [availableModels, setAvailableModels] = useState<ConfiguredModel[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);

  const filteredModels = useMemo(() => {
    if (!modelSearch.trim()) return availableModels;
    const q = modelSearch.toLowerCase();
    return availableModels.filter(
      (m) => m.name.toLowerCase().includes(q) || m.key.toLowerCase().includes(q),
    );
  }, [availableModels, modelSearch]);

  useEffect(() => {
    if (modelMenuOpen && availableModels.length === 0) {
      listSelectableModels().then(setAvailableModels).catch(() => {});
    }
  }, [modelMenuOpen, availableModels.length]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelMenuOpen]);

  const handleSwitchModel = async (modelKey: string) => {
    setSwitchingModel(true);
    setModelMenuOpen(false);
    try {
      await setAgentModel(agent.id, modelKey);
      scheduleGatewayRestart();
      onModelChanged?.();
    } catch (e) {
      console.warn("setAgentModel failed:", e);
    } finally {
      setSwitchingModel(false);
    }
  };

  const infoCards = [
    {
      label: t("agent.runStatus"),
      value: status?.gateway?.running
        ? t("common.running")
        : t("common.stopped"),
      color: status?.gateway?.running ? "var(--success)" : "var(--danger)",
      dot: true,
    },
    { label: t("agent.todayTokens"), value: formatTokenCount(todayTokens) },
    {
      label: t("agent.runtime"),
      value: status?.gateway?.running
        ? (status.gateway.uptime || t("common.running"))
        : "—",
    },
  ];

  const tpl = SCENARIO_TEMPLATES.find((t) => t.name === meta.name);
  const single = tpl ? getSingleScenario(tpl) : undefined;
  const heartbeat = single?.heartbeat ?? "";
  let cronDisplay = t("common.none");
  const cronMatch = heartbeat.match(/每[天日].*?[\d:]+|每\s*\d+\s*小时/);
  if (cronMatch) cronDisplay = cronMatch[0];

  const configRows = [
    { label: "Agent ID", value: agent.id, mono: true },
    { label: t("agent.scenario"), value: scenarioName },
    {
      label: t("agent.workspace"),
      value: agent.workspace || t("agent.notSet"),
      mono: true,
    },
    { label: t("agent.cronTask"), value: cronDisplay },
    {
      label: t("agent.isDefault"),
      value: agent.is_default ? t("common.yes") : t("common.no"),
    },
    { label: t("agent.createdAt"), value: agent.created_at || "—" },
  ];

  // Bindings management
  const [bindings, setBindings] = useState<AgentBinding[]>([]);
  const [loadingBindings, setLoadingBindings] = useState(true);
  const [bindingBusy, setBindingBusy] = useState(false);
  const [bindMenuOpen, setBindMenuOpen] = useState(false);
  const bindMenuRef = useRef<HTMLDivElement>(null);
  const [bindError, setBindError] = useState("");
  const [showAddChannelInBind, setShowAddChannelInBind] = useState(false);

  // Bind keys occupied by OTHER agents — at account level (channel:accountId or channel)
  const [globalBoundKeys, setGlobalBoundKeys] = useState<Record<string, string>>({});

  // Bind keys already bound by the current agent
  const selfBoundKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const b of bindings) {
      if (!b.match.channel) continue;
      const key = b.match.accountId
        ? `${b.match.channel}:${b.match.accountId}`
        : b.match.channel;
      keys.add(key);
      // A channel-level binding covers all accounts
      if (!b.match.accountId) keys.add(b.match.channel);
    }
    return keys;
  }, [bindings]);

  // Build account-level bindable units (same logic as CreateAgentModal)
  interface BindableUnit { channel: string; accountId?: string; key: string; label: string }
  const allBindableUnits: BindableUnit[] = useMemo(() => {
    const units: BindableUnit[] = [];
    for (const ch of enabledChannels) {
      const accounts = channelsConfig[ch]?.accounts as Record<string, Record<string, unknown>> | undefined;
      if (accounts && Object.keys(accounts).length > 0) {
        for (const acctId of Object.keys(accounts)) {
          const acct = accounts[acctId];
          const acctName = (acct?.name as string) || acctId;
          units.push({
            channel: ch,
            accountId: acctId,
            key: `${ch}:${acctId}`,
            label: acctId === "default" ? ch : `${ch} / ${acctName}`,
          });
        }
      } else {
        // Flat config = implicit "default" account (CLI always binds with accountId=default)
        units.push({ channel: ch, accountId: "default", key: `${ch}:default`, label: ch });
      }
    }
    return units;
  }, [enabledChannels, channelsConfig]);

  // Filter: exclude units bound by other agents or already bound by this agent.
  // For OTHER agents: account-specific bindings take precedence, so a channel-level
  // binding by another agent doesn't block account-level units here.
  // For THIS agent: a channel-level self-binding covers all accounts — hide them.
  const unboundUnits = useMemo(() => allBindableUnits.filter((u) => {
    if (selfBoundKeys.has(u.key) || globalBoundKeys[u.key]) return false;
    // This agent's channel-level binding covers all accounts under it
    if (u.accountId && selfBoundKeys.has(u.channel)) return false;
    if (!u.accountId && (globalBoundKeys[u.channel] || selfBoundKeys.has(u.channel))) return false;
    return true;
  }), [allBindableUnits, selfBoundKeys, globalBoundKeys]);

  const loadBindings = useCallback(() => {
    setLoadingBindings(true);
    try {
      const all = parseBindingsFromConfig(config);
      const mine = all.filter((b) => b.agentId === agent.id);
      setBindings(mine);

      // Build global bound-keys map (other agents' bindings)
      const globalMap: Record<string, string> = {};
      for (const b of all) {
        if (b.agentId === agent.id || !b.match.channel) continue;
        const key = b.match.accountId
          ? `${b.match.channel}:${b.match.accountId}`
          : b.match.channel;
        if (!globalMap[key]) globalMap[key] = b.agentId;
      }
      setGlobalBoundKeys(globalMap);
    } catch {
      setBindings([]);
    } finally {
      setLoadingBindings(false);
    }
  }, [agent.id, config]);

  useEffect(() => {
    loadBindings();
  }, [loadBindings]);

  // Close bind menu on click outside
  useEffect(() => {
    if (!bindMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (bindMenuRef.current && !bindMenuRef.current.contains(e.target as Node)) {
        setBindMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [bindMenuOpen]);

  const handleBind = async (match: BindingMatch) => {
    setBindingBusy(true);
    setBindError("");
    try {
      const spec = toBindSpec(match);
      const raw = await bindAgentChannel(agent.id, spec);
      try {
        const result = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (result?.conflicts?.length) {
          const detail = result.conflicts
            .map((c: any) => typeof c === "string" ? c : `${bindingDisplayText(c.binding?.match ?? c)} → ${c.existingAgentId ?? "?"}`)
            .join("; ");
          setBindError(`${t("agent.bindConflict")}: ${detail}`);
          return;
        }
      } catch { /* not JSON, ignore */ }
      // Re-read config so bindings update from config source
      if (onConfigChanged) await onConfigChanged();
    } catch (e) {
      setBindError(String(e));
    } finally {
      setBindingBusy(false);
    }
  };

  const handleUnbind = async (binding: AgentBinding) => {
    setBindingBusy(true);
    try {
      const spec = toBindSpec(binding.match);
      await unbindAgentChannel(agent.id, spec);
      if (onConfigChanged) await onConfigChanged();
    } catch (e) {
      console.warn("unbind failed:", e);
    } finally {
      setBindingBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-4">
        {/* Model card with switcher */}
        <div
          ref={modelMenuRef}
          className="relative flex flex-1 flex-col gap-1 rounded-[10px] border border-[var(--border)] bg-[var(--bg-main)] px-4 py-3.5"
        >
          <span className="text-xs text-[var(--text-secondary)]">
            {t("agent.currentModel")}
          </span>
          <div className="flex items-center gap-1.5">
            {switchingModel ? (
              <Loader2 size={14} className="animate-spin text-[var(--primary)]" />
            ) : (
              <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                {modelName}
              </span>
            )}
            <button
              onClick={() => { setModelMenuOpen(!modelMenuOpen); setModelSearch(""); }}
              className="ml-auto shrink-0 rounded-md p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
              title={t("agent.switchModel")}
            >
              <Pencil size={12} />
            </button>
          </div>
          {modelMenuOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 w-80 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] shadow-lg">
              {availableModels.length === 0 ? (
                <div className="flex items-center justify-center py-4 text-sm text-[var(--text-secondary)]">
                  <Loader2 size={14} className="mr-2 animate-spin" /> {t("common.loading")}
                </div>
              ) : (
                <>
                  {/* Search input */}
                  <div className="border-b border-[var(--border)] px-3 py-2">
                    <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-surface)] px-2.5 py-1.5">
                      <Search size={14} className="shrink-0 text-[var(--text-secondary)]" />
                      <input
                        ref={modelSearchRef}
                        autoFocus
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder={t("model.searchPlaceholder")}
                        className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
                      />
                      {modelSearch && (
                        <button onClick={() => { setModelSearch(""); modelSearchRef.current?.focus(); }}>
                          <X size={12} className="text-[var(--text-secondary)]" />
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Model list */}
                  <div className="max-h-60 overflow-auto p-1">
                    {filteredModels.map((m) => {
                      const isCurrent = m.key === agent.model;
                      return (
                        <button
                          key={m.key}
                          onClick={() => !isCurrent && handleSwitchModel(m.key)}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                            isCurrent
                              ? "bg-[#EBF5FB] text-[var(--primary)]"
                              : "text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="font-medium">{m.name}</span>
                            <span className="text-xs text-[var(--text-secondary)]">{m.key}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {m.contextWindow > 0 && (
                              <span className="text-[10px] text-[var(--text-secondary)]">
                                {(m.contextWindow / 1000).toFixed(0)}K
                              </span>
                            )}
                            {isCurrent && <CheckCircle2 size={14} className="text-[var(--primary)]" />}
                          </div>
                        </button>
                      );
                    })}
                    {filteredModels.length === 0 && (
                      <div className="px-3 py-4 text-center text-sm text-[var(--text-secondary)]">
                        {t("model.noMatchingModels")}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Other info cards */}
        {infoCards.map((card) => (
          <div
            key={card.label}
            className="flex flex-1 flex-col gap-1 rounded-[10px] border border-[var(--border)] bg-[var(--bg-main)] px-4 py-3.5"
          >
            <span className="text-xs text-[var(--text-secondary)]">
              {card.label}
            </span>
            {card.dot ? (
              <div className="flex items-center gap-1.5">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: card.color }}
                />
                <span
                  className="text-sm font-medium"
                  style={{ color: card.color }}
                >
                  {card.value}
                </span>
              </div>
            ) : (
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {card.value}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {t("agent.basicInfo")}
        </span>
        <div className="flex flex-col gap-2.5">
          {configRows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between py-1.5"
            >
              <span className="text-[13px] text-[var(--text-secondary)]">
                {row.label}
              </span>
              <span
                className={`text-[13px] ${row.mono ? "font-mono text-xs" : "font-medium"} text-[var(--text-primary)]`}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bindings section */}
      {bindError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {bindError}
        </div>
      )}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t("agent.bindings")}
          </span>
          <div className="relative" ref={bindMenuRef}>
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              disabled={bindingBusy}
              onClick={() => setBindMenuOpen((v) => !v)}
            >
              {t("agent.addBinding")}
            </Button>
            {bindMenuOpen && (
              <div className="absolute right-0 top-full z-10 mt-1 min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--bg-main)] py-1 shadow-lg">
                {unboundUnits.length > 0 ? (
                  unboundUnits.map((unit) => (
                    <button
                      key={unit.key}
                      onClick={() => {
                        setBindMenuOpen(false);
                        handleBind({
                          channel: unit.channel,
                          ...(unit.accountId ? { accountId: unit.accountId } : {}),
                        });
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                    >
                      {CHANNEL_LOGOS[unit.channel] && (
                        <img
                          src={CHANNEL_LOGOS[unit.channel]}
                          alt={unit.channel}
                          className="h-4 w-4"
                        />
                      )}
                      {unit.label}
                    </button>
                  ))
                ) : (
                  <button
                    onClick={() => {
                      setBindMenuOpen(false);
                      setShowAddChannelInBind(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--primary)] hover:bg-[var(--bg-surface)]"
                  >
                    <Plus size={12} />
                    {t("agent.addAccountToBind")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {loadingBindings ? (
          <div className="flex items-center justify-center py-4">
            <Loader2
              size={16}
              className="animate-spin text-[var(--text-secondary)]"
            />
          </div>
        ) : bindings.length === 0 ? (
          <div className="py-3 text-center text-sm text-[var(--text-secondary)]">
            <p>{t("agent.noBindings")}</p>
            {agent.is_default && (
              <p className="mt-1.5 text-xs text-[var(--primary)]">
                {t("agent.defaultRouteHint")}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {bindings.map((binding) => {
              const displayText = bindingDisplayText(binding.match);
              const hasExtra = binding.match.accountId || binding.match.peer || binding.match.guildId || binding.match.teamId;
              return (
                <span
                  key={toBindSpec(binding.match)}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
                >
                  {CHANNEL_LOGOS[binding.match.channel] && (
                    <img
                      src={CHANNEL_LOGOS[binding.match.channel]}
                      alt={binding.match.channel}
                      className="h-3.5 w-3.5"
                    />
                  )}
                  <span className="flex flex-col leading-tight">
                    <span>{binding.match.channel}</span>
                    {hasExtra && (
                      <span className="text-[10px] text-[var(--text-secondary)]">
                        {displayText}
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => handleUnbind(binding)}
                    disabled={bindingBusy}
                    className="ml-1 rounded p-0.5 text-[var(--text-secondary)] hover:text-[var(--danger)]"
                  >
                    <X size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {showAddChannelInBind && (
        <AddChannelModal
          open
          onClose={() => setShowAddChannelInBind(false)}
          targetAgent={agent.id}
          onSuccess={async () => {
            setShowAddChannelInBind(false);
            await loadBindings();
          }}
          configuredIds={new Set(Object.keys(channelsConfig))}
          channelConfigs={channelsConfig}
        />
      )}
    </div>
  );
}

function PersonaTab({ agentId, onSaved }: { agentId: string; onSaved?: () => void }) {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const [drafts, setDrafts] = useState({ soul: "", identity: "", heartbeat: "" });
  const [personaName, setPersonaName] = useState("");
  const [personaEmoji, setPersonaEmoji] = useState("");
  /** Track which template was selected (null = manual edit / no template) */
  const [appliedTplId, setAppliedTplId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    soul: true,
    identity: false,
    heartbeat: false,
  });

  const singleTemplates = getSingleAgentTemplates();

  useEffect(() => {
    setLoading(true);
    readAgentPersona(agentId)
      .then((p) => {
        setDrafts({ soul: p.soul, identity: p.identity, heartbeat: p.heartbeat });
        setPersonaName(p.name);
        setPersonaEmoji(p.emoji);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [agentId]);

  const handleApplyTemplate = (tplId: string) => {
    const tpl = getLocalizedScenarioTemplate(tplId, language);
    const single = tpl ? getSingleScenario(tpl) : undefined;
    if (tpl && single) {
      setDrafts({ soul: single.soul, identity: single.identity, heartbeat: single.heartbeat });
      setPersonaName(tpl.name);
      setPersonaEmoji(tpl.emoji);
      setAppliedTplId(tplId);
      setResult(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      await applyScenario(
        drafts.soul,
        drafts.identity,
        drafts.heartbeat,
        personaName || "Agent",
        personaEmoji || "\uD83E\uDD16",
        agentId === "main" ? undefined : agentId,
      );

      // Apply scenario extras when a template was selected
      if (appliedTplId) {
        const tpl = getLocalizedScenarioTemplate(appliedTplId, language);
        const baseTpl = getScenarioTemplate(appliedTplId);
        const single = tpl ? getSingleScenario(tpl) : undefined;

        if (baseTpl?.toolsProfile) {
          await setToolsProfile(baseTpl.toolsProfile).catch(() => {});
        }
        if (baseTpl && baseTpl.skills.length > 0) {
          await enableScenarioSkills(baseTpl.skills).catch(() => {});
        }
        const cronDefs = single?.cron ?? [];
        if (cronDefs.length > 0) {
          await upsertScenarioCronJobs(cronDefs, agentId).catch(() => {});
        }
        setAppliedTplId(null);
      }

      setResult({ ok: true, msg: t("persona.saved") });
      onSaved?.();
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const toggleSection = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={20} className="animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  const sections: { key: "soul" | "identity" | "heartbeat"; labelKey: string }[] = [
    { key: "soul", labelKey: "persona.sectionSoul" },
    { key: "identity", labelKey: "persona.sectionIdentity" },
    { key: "heartbeat", labelKey: "persona.sectionHeartbeat" },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Template horizontal scroll cards */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-4">
        <span className="mb-2 block text-xs font-semibold text-[var(--text-primary)]">
          {t("persona.loadTemplate")}
        </span>
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {singleTemplates.map((tpl) => (
            <button
              key={tpl.id}
              onClick={() => handleApplyTemplate(tpl.id)}
              className="flex flex-shrink-0 flex-col items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2.5 transition-colors hover:border-[var(--primary)] hover:bg-[#EBF5FB]"
            >
              <span className="text-xl">{tpl.emoji}</span>
              <span className="whitespace-nowrap text-[11px] font-medium text-[var(--text-primary)]">
                {tpl.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Name & Identity */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-4">
        <span className="mb-2 block text-xs font-semibold text-[var(--text-primary)]">
          {t("persona.nameAndIdentity")}
        </span>
        <div className="flex items-center gap-3">
          <EmojiPicker value={personaEmoji} onChange={setPersonaEmoji} placeholder={"\uD83E\uDD16"} />
          <input
            type="text"
            value={personaName}
            onChange={(e) => setPersonaName(e.target.value)}
            placeholder={t("persona.namePlaceholder")}
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--primary)]"
          />
        </div>
      </div>

      {/* Collapsible SOUL / IDENTITY / HEARTBEAT sections */}
      {sections.map((section) => (
        <div
          key={section.key}
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-main)]"
        >
          <button
            onClick={() => toggleSection(section.key)}
            className="flex w-full items-center gap-2 px-4 py-3"
          >
            <ChevronDown
              size={14}
              className={`text-[var(--text-secondary)] transition-transform ${expanded[section.key] ? "" : "-rotate-90"}`}
            />
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {t(section.labelKey)}
            </span>
          </button>
          {expanded[section.key] && (
            <div className="border-t border-[var(--border)] p-3">
              <textarea
                value={drafts[section.key]}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [section.key]: e.target.value }))
                }
                spellCheck={false}
                rows={section.key === "soul" ? 14 : 8}
                className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
              />
            </div>
          )}
        </div>
      ))}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        {result ? (
          <p className={`text-xs ${result.ok ? "text-green-600" : "text-red-500"}`}>
            {result.msg}
          </p>
        ) : (
          <span />
        )}
        <Button onClick={handleSave} disabled={saving}>
          {saving ? t("common.applying") : t("persona.save")}
        </Button>
      </div>
    </div>
  );
}

function SkillsTab({ agentId: _agentId }: { agentId: string }) {
  const t = useT();
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [confirmSkill, setConfirmSkill] = useState<string | null>(null);
  const [installError, setInstallError] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    listSkills()
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await listSkills();
      setSkills(data);
    } catch {
      // keep existing list on refresh failure
    } finally {
      setRefreshing(false);
    }
  };

  const handleToggle = async (skill: SkillInfo) => {
    setToggling(skill.name);
    try {
      await setSkillEnabled(skill.name, !skill.enabled);
      setSkills((prev) =>
        prev.map((s) => (s.name === skill.name ? { ...s, enabled: !s.enabled } : s)),
      );
    } catch (e) {
      console.warn("toggle skill failed:", e);
    } finally {
      setToggling(null);
    }
  };

  const handleInstallDeps = (skill: SkillInfo) => {
    setInstallError((prev) => { const n = { ...prev }; delete n[skill.name]; return n; });
    setConfirmSkill(skill.name);
  };

  /** Get the best install command for a skill */
  const getInstallCommand = (skill: SkillInfo): string => {
    if (skill.installHints?.length > 0) {
      return skill.installHints[0].command;
    }
    // Fallback: bare brew install
    return `brew install ${skill.missingDeps.join(" ")}`;
  };

  const doInstallDeps = async (skill: SkillInfo) => {
    setConfirmSkill(null);
    setInstalling(skill.name);
    setInstallError((prev) => { const n = { ...prev }; delete n[skill.name]; return n; });
    try {
      const cmd = getInstallCommand(skill);
      await installSkillDeps([cmd]);
      reload();
    } catch (e) {
      setInstallError((prev) => ({ ...prev, [skill.name]: String(e) }));
    } finally {
      setInstalling(null);
    }
  };

  const q = searchQuery.toLowerCase();
  const matchesSearch = (s: SkillInfo) =>
    !q || s.name.toLowerCase().includes(q) || (s.description && s.description.toLowerCase().includes(q));
  const readySkills = skills.filter((s) => s.ready && matchesSearch(s)).sort((a, b) => +b.enabled - +a.enabled);
  const missingSkills = skills.filter((s) => !s.ready && matchesSearch(s));

  const sourceLabel = (source: string) => {
    switch (source) {
      case "workspace": return t("skill.sourceWorkspace");
      case "managed": return t("skill.sourceManaged");
      case "bundled": return t("skill.sourceBundled");
      default: return source;
    }
  };

  if (loading && skills.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-[var(--text-secondary)]">
        {t("common.loading")}
      </div>
    );
  }

  if (!loading && skills.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12">
        <span className="text-sm text-[var(--text-secondary)]">{t("skill.noSkills")}</span>
        <span className="text-xs text-[var(--text-secondary)]">{t("skill.noSkillsHint")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t("skill.available", { count: readySkills.length, total: skills.length })}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-surface)] hover:text-[var(--primary)]"
            title={t("common.refresh")}
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 py-2">
          <Search size={14} className="shrink-0 text-[var(--text-secondary)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("skill.searchPlaceholder")}
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
          />
        </div>
        <span className="text-[11px] text-[var(--text-secondary)]">
          {t("skill.globalHint")}
        </span>
      </div>

      {/* Ready skills */}
      {readySkills.length > 0 && (
        <div className="flex flex-col gap-1">
          {readySkills.map((skill) => (
            <div
              key={skill.name}
              className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-4 py-3"
            >
              <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{skill.name}</span>
                  <span className="shrink-0 rounded-md bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                    {sourceLabel(skill.source)}
                  </span>
                  {skill.source === "bundled" && (
                    <span className="shrink-0 flex items-center gap-0.5 text-[10px] text-[var(--success)]">
                      <ShieldCheck size={11} />
                      {t("skill.trusted")}
                    </span>
                  )}
                </div>
                {skill.description && (
                  <span className="text-xs leading-relaxed text-[var(--text-secondary)]">{skill.description}</span>
                )}
              </div>
              <button
                onClick={() => handleToggle(skill)}
                disabled={toggling === skill.name}
                className="mt-0.5 flex shrink-0 items-center gap-1.5 text-xs disabled:opacity-50"
              >
                <ToggleRight
                  size={20}
                  className={skill.enabled ? "text-[var(--success)]" : "hidden"}
                />
                <ToggleLeft
                  size={20}
                  className={skill.enabled ? "hidden" : "text-[var(--text-secondary)]"}
                />
                <span className={`w-10 ${skill.enabled ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}`}>
                  {skill.enabled ? t("skill.enabled") : t("skill.disabled")}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Missing deps skills */}
      {missingSkills.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            {t("skill.missingDeps")}
          </span>
          {missingSkills.map((skill) => (
            <div
              key={skill.name}
              className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-4 py-3 opacity-60"
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{skill.name}</span>
                  <span className="shrink-0 rounded-md bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                    {sourceLabel(skill.source)}
                  </span>
                  {skill.source === "bundled" && (
                    <span className="shrink-0 flex items-center gap-0.5 text-[10px] text-[var(--success)]">
                      <ShieldCheck size={11} />
                      {t("skill.trusted")}
                    </span>
                  )}
                </div>
                {skill.description && (
                  <span className="text-xs leading-relaxed text-[var(--text-secondary)]">
                    {skill.description}
                    {skill.homepage && (
                      <>
                        {" "}
                        <a
                          href={skill.homepage}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--primary)] hover:underline"
                          onClick={(e) => { e.preventDefault(); if (skill.homepage) shellOpen(skill.homepage); }}
                        >
                          {t("common.learnMore")}
                        </a>
                      </>
                    )}
                  </span>
                )}
                <span className="text-xs text-[var(--warning)]">
                  {t("skill.needsInstall", { deps: skill.missingDeps.join(", ") })}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <code
                    onClick={() => navigator.clipboard.writeText(getInstallCommand(skill))}
                    className="min-w-0 flex-1 cursor-pointer select-all overflow-x-auto whitespace-nowrap rounded bg-[var(--bg-surface)] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)] hover:ring-1 hover:ring-[var(--primary)]"
                    title={t("common.clickToCopy")}
                  >
                    {getInstallCommand(skill)}
                  </code>
                  {confirmSkill === skill.name ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => doInstallDeps(skill)}
                        className="rounded-md bg-[var(--primary)] px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
                      >
                        {t("common.confirm")}
                      </button>
                      <button
                        onClick={() => setConfirmSkill(null)}
                        className="rounded-md bg-[var(--bg-surface)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--border)]"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleInstallDeps(skill)}
                      disabled={installing === skill.name}
                      className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--primary)] px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {installing === skill.name ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                      {installing === skill.name ? t("skill.installing") : t("skill.installDeps")}
                    </button>
                  )}
                </div>
                {installError[skill.name] && installing !== skill.name && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-[var(--danger)]">
                      {t("skill.installFailed", { error: installError[skill.name] })}
                    </span>
                    {skill.homepage && (
                      <span className="text-[11px] text-[var(--text-secondary)]">
                        {t("skill.manualInstallHint")}{" "}
                        <a
                          href={skill.homepage}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--primary)] hover:underline"
                          onClick={(e) => { e.preventDefault(); if (skill.homepage) shellOpen(skill.homepage); }}
                        >
                          {skill.homepage}
                        </a>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CronTab({ agentId }: { agentId: string }) {
  const t = useT();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editingJob, setEditingJob] = useState<any>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [expandedRuns, setExpandedRuns] = useState<Record<string, any[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listCronJobs();
      // data may be { jobs: [...] } or a flat array
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allJobs: any[] = Array.isArray(data)
        ? data
        : Array.isArray((data as any)?.jobs)
          ? (data as any).jobs
          : [];
      // Filter jobs for this agent
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agentJobs = allJobs.filter(
        (j: any) => j.agentId === agentId || j.agent_id === agentId || j.agent === agentId,
      );
      setJobs(agentJobs);
    } catch (e) {
      console.warn("[CronTab] loadJobs failed:", e);
      setJobs([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleToggle = async (jobId: string, enabled: boolean) => {
    try {
      if (enabled) {
        await disableCronJob(jobId);
      } else {
        await enableCronJob(jobId);
      }
      await loadJobs();
    } catch (e) {
      console.warn("toggle cron failed:", e);
    }
  };

  const handleDelete = async (jobId: string) => {
    try {
      await deleteCronJob(jobId);
      setDeletingJobId(null);
      await loadJobs();
    } catch (e) {
      console.warn("delete cron failed:", e);
    }
  };

  const handleExpandRuns = async (jobId: string) => {
    if (expandedId === jobId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(jobId);
    if (!expandedRuns[jobId]) {
      try {
        const data = await getCronRuns(jobId);
        const runs = Array.isArray(data) ? data : [];
        setExpandedRuns((prev) => ({ ...prev, [jobId]: runs }));
      } catch {
        setExpandedRuns((prev) => ({ ...prev, [jobId]: [] }));
      }
    }
  };

  if (loading && jobs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2
          size={20}
          className="animate-spin text-[var(--text-secondary)]"
        />
      </div>
    );
  }

  if (error && jobs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <span className="text-sm text-[var(--danger)]">{error}</span>
        <Button variant="secondary" size="sm" onClick={loadJobs}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {t("agent.cronJobs")}
        </span>
        <div className="flex gap-2">
          <button
            onClick={loadJobs}
            disabled={loading}
            className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-main)] hover:text-[var(--primary)] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={`transition-transform ${loading ? "animate-spin" : ""}`} />
          </button>
          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            onClick={() => setShowCreate(true)}
          >
            {t("agent.createCronJob")}
          </Button>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] py-12">
          <Clock
            size={32}
            className="text-[var(--text-secondary)] opacity-40"
          />
          <p className="text-sm text-[var(--text-secondary)]">
            {t("agent.noCronJobs")}
          </p>
        </div>
      ) : jobs.length > 0 ? (
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {jobs.map((job: any) => {
            const jobId = job?.id || job?.jobId || String(Math.random());
            const jobName = job?.name || jobId;
            const enabled =
              job?.enabled !== false && job?.status !== "disabled";
            // schedule may be { kind, expr } or a flat string
            let schedule = "—";
            try {
              if (typeof job?.schedule === "object" && job.schedule !== null && job.schedule?.expr) {
                schedule = `${job.schedule.kind === "every" ? "every " : ""}${job.schedule.expr}`;
              } else if (typeof job?.schedule === "string") {
                schedule = job.schedule;
              } else {
                schedule = job?.cron || job?.every || "—";
              }
            } catch { /* defensive */ }
            // message may be nested under payload.message
            const jobMessage = job?.payload?.message || job?.message || "";
            const isExpanded = expandedId === jobId;
            const runs = expandedRuns[jobId];

            return (
              <div
                key={jobId}
                className="rounded-xl border border-[var(--border)] bg-[var(--bg-main)] overflow-hidden"
              >
                <div className="flex items-center gap-3 px-4 py-3 min-w-0">
                  <button
                    onClick={() => handleExpandRuns(jobId)}
                    className="rounded p-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </button>

                  <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {jobName}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] min-w-0">
                      <Clock size={10} className="shrink-0" />
                      <span>{schedule}</span>
                      {job.model && (
                        <>
                          <span className="text-[var(--border)]">·</span>
                          <span className="truncate">{job.model}</span>
                        </>
                      )}
                      {job.channel && (
                        <>
                          <span className="text-[var(--border)]">·</span>
                          <span>{job.channel}</span>
                        </>
                      )}
                    </div>
                    {jobMessage && (
                      <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                        <MessageSquare size={10} className="shrink-0 text-[var(--text-secondary)] opacity-50" />
                        <span className="text-[11px] text-[var(--text-secondary)] truncate min-w-0">
                          {jobMessage}
                        </span>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => setEditingJob(job)}
                    className="rounded p-1 text-[var(--text-secondary)] hover:text-[var(--primary)]"
                    title={t("agent.editCronJob")}
                  >
                    <Pencil size={13} />
                  </button>

                  <button
                    onClick={() => handleToggle(jobId, enabled)}
                    className="text-[var(--text-secondary)] hover:text-[var(--primary)]"
                    title={
                      enabled ? t("agent.cronDisable") : t("agent.cronEnable")
                    }
                  >
                    {enabled ? (
                      <ToggleRight size={20} className="text-[var(--primary)]" />
                    ) : (
                      <ToggleLeft size={20} />
                    )}
                  </button>

                  {deletingJobId === jobId ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(jobId)}
                        className="rounded px-2 py-0.5 text-[11px] font-medium text-white bg-[var(--danger)] hover:opacity-80"
                      >
                        {t("common.confirm")}
                      </button>
                      <button
                        onClick={() => setDeletingJobId(null)}
                        className="rounded px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingJobId(jobId)}
                      className="rounded p-1 text-[var(--text-secondary)] hover:text-[var(--danger)]"
                      title={t("agent.deleteCronJob")}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div className="border-t border-[var(--border)] px-4 py-3">
                    <span className="mb-2 block text-xs font-medium text-[var(--text-secondary)]">
                      {t("agent.cronRuns")}
                    </span>
                    {!runs ? (
                      <Loader2
                        size={14}
                        className="animate-spin text-[var(--text-secondary)]"
                      />
                    ) : runs.length === 0 ? (
                      <p className="text-xs text-[var(--text-secondary)]">
                        {t("agent.cronNoRuns")}
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {runs.slice(0, 10).map((run: any, i: number) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 text-xs"
                          >
                            <span className="text-[var(--text-secondary)]">
                              {run.startedAt || run.started_at || run.timestamp || "—"}
                            </span>
                            <span
                              className={
                                run.status === "success"
                                  ? "text-[var(--success)]"
                                  : run.status === "error"
                                    ? "text-[var(--danger)]"
                                    : "text-[var(--text-primary)]"
                              }
                            >
                              {run.status || "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {(showCreate || editingJob) && (
        <CronJobModal
          agentId={agentId}
          editJob={editingJob || undefined}
          onClose={() => { setShowCreate(false); setEditingJob(null); }}
          onSaved={loadJobs}
        />
      )}
    </div>
  );
}

function StatsTab({ usageStats }: { usageStats: UsageStats | null }) {
  const t = useT();
  const { currency, exchangeRate } = useSettingsStore();
  const costMultiplier = currency === "CNY" ? exchangeRate : 1;
  const costSymbol = currency === "CNY" ? "¥" : "$";

  const cards = [
    {
      label: t("agent.totalTokens"),
      value: usageStats ? formatTokens(usageStats.totalTokens) : "—",
    },
    {
      label: t("agent.totalCost"),
      value: usageStats ? formatCost(usageStats.totalCost * costMultiplier, costSymbol) : "—",
    },
    {
      label: t("agent.totalMessages"),
      value: usageStats ? usageStats.totalMessages.toString() : "—",
    },
    {
      label: t("agent.activeDays"),
      value: usageStats ? usageStats.activeDays.toString() : "—",
    },
  ];

  // Find max cost in daily for bar chart scaling
  const maxDailyCost = usageStats
    ? Math.max(...usageStats.daily.map((d) => d.estimatedCost), 0.001)
    : 1;

  return (
    <div className="flex flex-col gap-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="flex flex-col gap-1 rounded-[10px] border border-[var(--border)] bg-[var(--bg-main)] px-4 py-4"
          >
            <span className="text-xs text-[var(--text-secondary)]">
              {card.label}
            </span>
            <span className="text-lg font-semibold text-[var(--text-primary)]">
              {card.value}
            </span>
          </div>
        ))}
      </div>

      {/* Model breakdown */}
      {usageStats && usageStats.byModel.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t("agent.modelBreakdown")}
          </span>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2 text-[11px] font-medium text-[var(--text-secondary)]">
              <span className="flex-1">{t("agent.modelName")}</span>
              <span className="w-20 text-right">Tokens</span>
              <span className="w-20 text-right">{t("agent.cost")}</span>
              <span className="w-16 text-right">{t("agent.msgCount")}</span>
            </div>
            {usageStats.byModel.map((m) => (
              <div
                key={`${m.provider}/${m.model}`}
                className="flex items-center gap-2 py-2 text-[13px]"
              >
                <span className="flex-1 truncate text-[var(--text-primary)]">
                  {m.model}
                  <span className="ml-1.5 text-[11px] text-[var(--text-secondary)]">
                    {m.provider}
                  </span>
                </span>
                <span className="w-20 text-right font-mono text-xs text-[var(--text-secondary)]">
                  {formatTokens(m.totalTokens)}
                </span>
                <span className="w-20 text-right font-mono text-xs text-[var(--text-primary)]">
                  {formatCost(m.estimatedCost * costMultiplier, costSymbol)}
                </span>
                <span className="w-16 text-right font-mono text-xs text-[var(--text-secondary)]">
                  {m.messageCount}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily trend */}
      {usageStats && usageStats.daily.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t("agent.dailyTrend")}
          </span>
          <div className="flex items-end gap-1" style={{ height: 120 }}>
            {usageStats.daily.slice(-14).map((d) => {
              const pct = (d.estimatedCost / maxDailyCost) * 100;
              return (
                <div
                  key={d.date}
                  className="group relative flex flex-1 flex-col items-center"
                  style={{ height: "100%" }}
                >
                  <div className="flex flex-1 w-full items-end">
                    <div
                      className="w-full rounded-t bg-[var(--primary)] opacity-70 transition-opacity group-hover:opacity-100"
                      style={{
                        height: `${Math.max(pct, 2)}%`,
                        minHeight: 2,
                      }}
                    />
                  </div>
                  <span className="mt-1 text-[9px] text-[var(--text-secondary)]">
                    {d.date.slice(5)}
                  </span>
                  {/* Tooltip */}
                  <div className="pointer-events-none absolute bottom-full mb-1 hidden rounded bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-primary)] shadow-lg group-hover:block">
                    <div>{d.date}</div>
                    <div>{formatCost(d.estimatedCost * costMultiplier, costSymbol)}</div>
                    <div>{formatTokens(d.totalTokens)} tokens</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Estimated cost disclaimer */}
      <p className="text-center text-[11px] text-[var(--text-secondary)]">
        {t("agent.costDisclaimer")}
      </p>
    </div>
  );
}

// ── Main Page ──

export default function AgentManagement() {
  const t = useT();
  const cachedAgents = useAppStore((s) => s.agents);
  const cachedStatus = useAppStore((s) => s.status);
  const cachedConfig = useAppStore((s) => s.config);
  const storeSetAgents = useAppStore((s) => s.setAgents);
  const storeSetConfig = useAppStore((s) => s.setConfig);
  const storeSetStatus = useAppStore((s) => s.setStatus);

  const [agents, setAgents] = useState<AgentDetail[]>(cachedAgents ?? []);
  const [loading, setLoading] = useState(cachedAgents === null);
  const [selectedId, setSelectedId] = useState<string | null>(
    cachedAgents && cachedAgents.length > 0 ? cachedAgents[0].id : null,
  );
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [status, setStatus] = useState<StatusData | null>(cachedStatus);
  const [config, setConfig] = useState<Record<string, unknown> | null>(
    cachedConfig,
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AgentDetail | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);

  const loadAgents = async () => {
    // Fire independent requests — fast ones land first
    // Config: instant file read
    readOpenClawConfig()
      .then((cfg) => { setConfig(cfg); storeSetConfig(cfg); })
      .catch(() => {});
    // Usage stats are loaded per-agent via the selectedId effect below
    // Gateway status: slowest (~2.5s) — don't block on it
    getGatewayStatus()
      .then((sts) => { setStatus(sts); storeSetStatus(sts); })
      .catch(() => {});
    // Agent list: ~0.9s — this is what we actually wait for
    try {
      const list = await listAgents();
      setAgents(list);
      storeSetAgents(list);
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].id);
      }
    } catch (e) {
      console.warn("loadAgents failed:", e);
    } finally {
      setLoading(false);
    }
  };

  /** Lightweight config-only refresh (for bind/unbind mutations) */
  const refreshConfig = async () => {
    try {
      const cfg = await readOpenClawConfig();
      setConfig(cfg);
      storeSetConfig(cfg);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadAgents();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload usage stats per-agent when selection changes
  useEffect(() => {
    setUsageStats(null);
    if (!selectedId) return;
    computeUsageStats(selectedId)
      .then((usage) => setUsageStats(usage))
      .catch(() => setUsageStats(null));
  }, [selectedId]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteAgent(deleteTarget.id);
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      await loadAgents();
    } catch (e) {
      console.warn("deleteAgent failed:", e);
    } finally {
      setDeleting(false);
    }
  };

  const selected = agents.find((a) => a.id === selectedId);

  const renderTabContent = () => {
    if (!selected) return null;
    switch (activeTab) {
      case "overview":
        return (
          <OverviewTab agent={selected} status={status} config={config} usageStats={usageStats} onModelChanged={loadAgents} onConfigChanged={refreshConfig} />
        );
      case "persona":
        return <PersonaTab agentId={selected.id} onSaved={loadAgents} />;
      case "skills":
        return <SkillsTab agentId={selected.id} />;
      case "cron":
        return <CronTab agentId={selected.id} />;
      case "stats":
        return <StatsTab usageStats={usageStats} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Header title={t("agent.title")} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Agent List */}
        <div className="flex w-80 flex-col gap-2 border-r border-[var(--border)] bg-[var(--bg-main)] p-4">
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t("agent.list")}
              </span>
              <span className="min-w-[20px] rounded-full bg-[var(--bg-surface)] px-1.5 py-0.5 text-center text-[10px] font-medium text-[var(--text-secondary)]">
                {agents.length}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={async () => {
                  setRefreshing(true);
                  await loadAgents();
                  setRefreshing(false);
                }}
                disabled={refreshing}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-surface)] hover:text-[var(--primary)]"
                title={t("common.refresh")}
              >
                <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)] text-white shadow-sm transition-all hover:bg-[var(--secondary)] hover:shadow-md active:scale-95"
                title={t("agent.createAgent")}
              >
                <Plus size={14} strokeWidth={2.5} />
              </button>
            </div>
          </div>

          {loading && agents.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2
                size={20}
                className="animate-spin text-[var(--text-secondary)]"
              />
            </div>
          ) : agents.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
              {t("agent.noAgent")}
            </div>
          ) : (
            agents.map((agent) => {
              const isSelected = selectedId === agent.id;
              const meta = resolveAgentMeta(agent);
              const displayName = meta.emoji
                ? `${meta.emoji} ${meta.name}`
                : meta.name;
              const tpl = SCENARIO_TEMPLATES.find(
                (t) => t.name === meta.name,
              );
              const tplSingle = tpl ? getSingleScenario(tpl) : undefined;
              const desc = tplSingle
                ? tplSingle.identity.match(/\*\*Vibe:\*\*\s*(.+)/)?.[1] ?? agent.id
                : agent.id;
              return (
                <button
                  key={agent.id}
                  onClick={() => {
                    setSelectedId(agent.id);
                    setActiveTab("overview");
                  }}
                  className={`flex flex-col gap-1.5 rounded-[10px] p-3 text-left transition-colors ${
                    isSelected
                      ? "bg-[var(--primary)] text-white"
                      : "border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--primary-light)]"
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span
                      className={`text-sm font-medium ${isSelected ? "text-white" : "text-[var(--text-primary)]"}`}
                    >
                      {displayName}
                    </span>
                    <div className="flex items-center gap-1">
                      <div
                        className={`h-1.5 w-1.5 rounded-full ${
                          status?.gateway?.running
                            ? "bg-[#2ECC71]"
                            : "bg-[var(--warning)]"
                        }`}
                      />
                      <span
                        className={`text-[11px] ${isSelected ? "text-white/70" : "text-[var(--text-secondary)]"}`}
                      >
                        {status?.gateway?.running
                          ? t("common.running")
                          : t("common.stopped")}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`truncate text-xs ${isSelected ? "text-white/70" : "text-[var(--text-secondary)]"}`}
                  >
                    {desc}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Right: Agent Detail */}
        <div className="flex flex-1 flex-col bg-[var(--bg-surface)]">
          {selected ? (
            <>
              {/* Detail Header */}
              <div className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--bg-main)] px-6 py-5">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-[var(--text-primary)]">
                    {(() => {
                      const m = resolveAgentMeta(selected);
                      return m.emoji ? `${m.emoji} ${m.name}` : m.name;
                    })()}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      icon={Trash2}
                      size="sm"
                      onClick={() => setDeleteTarget(selected)}
                    >
                      {t("agent.deleteAgent")}
                    </Button>
                  </div>
                </div>
                <div className="flex">
                  {detailTabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`px-4 py-2 text-[13px] transition-colors ${
                        activeTab === tab.key
                          ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {t(tab.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Detail Body */}
              <div className="flex-1 overflow-auto p-6">
                {renderTabContent()}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
              {loading ? t("common.loading") : t("agent.selectAgent")}
            </div>
          )}
        </div>
      </div>

      {/* Create Agent Modal */}
      {showCreateModal && (
        <CreateAgentModal
          onClose={() => setShowCreateModal(false)}
          onCreated={loadAgents}
          config={config}
        />
      )}

      {/* Delete Confirm Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[400px] rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-6 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-[var(--text-primary)]">
              {t("agent.deleteAgent")}
            </h3>
            <p className="mb-5 text-sm text-[var(--text-secondary)]">
              {t("agent.deleteConfirm", { name: deleteTarget.id })}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDeleteTarget(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                style={{ backgroundColor: "var(--danger)" }}
              >
                {deleting ? t("agent.deleting") : t("agent.deleteAgent")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
