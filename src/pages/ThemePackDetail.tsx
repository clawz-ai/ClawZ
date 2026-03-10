import { useState, useEffect, useMemo } from "react";
import { X, CheckCircle2, ArrowLeft, ChevronDown, FileText, Clock, Zap, AlertTriangle, Loader2, Download } from "lucide-react";
import Button from "../components/ui/Button";
import Tag from "../components/ui/Tag";
import { getScenarioTemplate, getLocalizedScenarioTemplate, getSingleScenario } from "../lib/scenarioTemplates";
import type { CronJobDef } from "../lib/scenarioTemplates";
import { useSettingsStore } from "../stores/settingsStore";
import {
  applyScenario,
  listAgents,
  createAgent,
  setToolsProfile,
  enableScenarioSkills,
  scheduleGatewayRestart,
  listSkills,
  upsertScenarioCronJobs,
  installSkillDeps,
  type AgentDetail,
  type SkillInfo,
} from "../lib/tauri";
import { useT } from "../lib/i18n";
import { exportScenarioJSON } from "../lib/exportScenario";

type ApplyTarget = "existing" | "new";

const RESERVED_NAMES = ["main", "default"];

/** Turn any string into a CLI-safe ASCII slug */
function toSlug(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "agent";
}

/** Generate a unique id, appending -2, -3 etc. if needed */
function uniqueId(base: string, existingIds: string[]): string {
  if (!RESERVED_NAMES.includes(base) && !existingIds.includes(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!RESERVED_NAMES.includes(candidate) && !existingIds.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

// ── Apply preview/summary types ──

interface ApplyPlan {
  soul: string;
  identity: string;
  heartbeat: string;
  name: string;
  emoji: string;
  toolsProfile: string;
  skills: string[];
  cronDefs: CronJobDef[];
}

interface SkillCheck {
  name: string;
  status: "ready" | "missing_deps" | "not_found";
  missingDeps: string[];
  installHints: Array<{ kind: string; label: string; command: string }>;
}

interface SkillResult {
  name: string;
  enabled: boolean;
  ready: boolean;
  missingDeps: string[];
  installHints: Array<{ kind: string; label: string; command: string }>;
}

interface ApplyResults {
  persona: boolean;
  cronTotal: number;
  cronSuccess: number;
  skills: SkillResult[];
  error?: string;
}

interface ThemePackDetailProps {
  pack: {
    id: string;
    emoji: string;
    name: string;
    desc: string;
    fullDesc?: string;
    tags: string[];
    skills?: string[];
    recommendedModel?: string;
    estimatedCost?: string;
  };
  onApplied?: () => void;
  onClose: () => void;
}

const CUSTOMIZE_TABS = [
  { key: "soul" as const, labelKey: "themepack.tabSoul", file: "SOUL.md" },
  { key: "identity" as const, labelKey: "themepack.tabIdentity", file: "IDENTITY.md" },
  { key: "heartbeat" as const, labelKey: "themepack.tabHeartbeat", file: "HEARTBEAT.md" },
];

// ── Apply Confirm Overlay ──

function ApplyConfirmOverlay({
  plan,
  skillChecks,
  phase,
  results,
  onConfirm,
  onCancel,
  onDone,
  onResultsUpdate,
}: {
  plan: ApplyPlan;
  skillChecks: SkillCheck[];
  phase: "preview" | "applying" | "done";
  results: ApplyResults | null;
  onConfirm: () => void;
  onCancel: () => void;
  onDone: () => void;
  onResultsUpdate: (updater: (prev: ApplyResults) => ApplyResults) => void;
}) {
  const t = useT();
  const hasSkills = plan.skills.length > 0;
  const hasCron = plan.cronDefs.length > 0;

  // Per-skill install state: "idle" | "installing" | "success" | "error"
  const [installStates, setInstallStates] = useState<Record<string, string>>({});

  const handleInstallDep = async (skill: SkillResult) => {
    if (!skill.installHints.length) return;
    setInstallStates((prev) => ({ ...prev, [skill.name]: "installing" }));
    try {
      // Run install commands sequentially
      for (const hint of skill.installHints) {
        await installSkillDeps([hint.command]);
      }
      setInstallStates((prev) => ({ ...prev, [skill.name]: "success" }));
      // Update the result to mark skill as ready
      onResultsUpdate((prev) => ({
        ...prev,
        skills: prev.skills.map((s) =>
          s.name === skill.name ? { ...s, ready: true, missingDeps: [] } : s,
        ),
      }));
    } catch (e) {
      console.warn(`[installSkillDep] ${skill.name} failed:`, e);
      setInstallStates((prev) => ({ ...prev, [skill.name]: "error" }));
    }
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-[var(--bg-main)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
        <div className="flex items-center gap-2.5">
          <span className="text-[28px]">{plan.emoji}</span>
          <span className="text-base font-semibold text-[var(--text-primary)]">
            {phase === "done" ? t("themepack.resultTitle") : t("themepack.confirmTitle")}
          </span>
        </div>
        {phase === "preview" && (
          <button
            onClick={onCancel}
            className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        {phase === "done" && results ? (
          /* ── Result Summary ── */
          <>
            {results.error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 dark:border-red-800 dark:bg-red-950">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-red-500" />
                <span className="text-[13px] text-red-700 dark:text-red-300">
                  {t("themepack.resultError", { error: results.error })}
                </span>
              </div>
            )}

            {results.persona && (
              <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-surface)] p-3.5">
                <CheckCircle2 size={16} className="flex-shrink-0 text-green-500" />
                <span className="text-[13px] text-[var(--text-primary)]">
                  {t("themepack.resultPersonaDone")}
                </span>
              </div>
            )}

            {results.cronTotal > 0 && (
              <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-surface)] p-3.5">
                {results.cronSuccess === results.cronTotal ? (
                  <CheckCircle2 size={16} className="flex-shrink-0 text-green-500" />
                ) : (
                  <AlertTriangle size={16} className="flex-shrink-0 text-amber-500" />
                )}
                <span className="text-[13px] text-[var(--text-primary)]">
                  {t("themepack.resultCronDone", {
                    success: String(results.cronSuccess),
                    total: String(results.cronTotal),
                  })}
                </span>
              </div>
            )}

            {results.skills.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg bg-[var(--bg-surface)] p-3.5">
                {results.skills.map((s) => {
                  const installState = installStates[s.name] ?? "idle";
                  return (
                    <div key={s.name} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2.5">
                        {s.enabled && s.ready ? (
                          <CheckCircle2 size={16} className="flex-shrink-0 text-green-500" />
                        ) : s.enabled && !s.ready ? (
                          <AlertTriangle size={16} className="flex-shrink-0 text-amber-500" />
                        ) : (
                          <AlertTriangle size={16} className="flex-shrink-0 text-red-500" />
                        )}
                        <span className="text-[13px] text-[var(--text-primary)]">{s.name}</span>
                        <span
                          className={`ml-auto text-[11px] ${
                            s.enabled && s.ready
                              ? "text-green-600"
                              : s.enabled
                                ? "text-amber-600"
                                : "text-red-600"
                          }`}
                        >
                          {s.enabled && s.ready
                            ? t("themepack.resultSkillReady")
                            : s.enabled
                              ? t("themepack.resultSkillNeedsDeps")
                              : t("themepack.resultSkillFail")}
                        </span>
                      </div>
                      {s.enabled && !s.ready && s.installHints.length > 0 && (
                        <div className="ml-[26px] flex flex-col gap-1.5">
                          {s.installHints.map((hint, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                              <Download size={11} className="flex-shrink-0 text-[var(--text-secondary)]" />
                              <code className="rounded bg-[var(--bg-main)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                                {hint.command}
                              </code>
                            </div>
                          ))}
                          <button
                            onClick={() => handleInstallDep(s)}
                            disabled={installState === "installing" || installState === "success"}
                            className={`mt-0.5 flex w-fit items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              installState === "success"
                                ? "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400"
                                : installState === "error"
                                  ? "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950 dark:text-red-400"
                                  : "bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20"
                            }`}
                          >
                            {installState === "installing" ? (
                              <><Loader2 size={11} className="animate-spin" /> {t("skill.installing")}</>
                            ) : installState === "success" ? (
                              <><CheckCircle2 size={11} /> {t("skill.installSuccess")}</>
                            ) : installState === "error" ? (
                              <><AlertTriangle size={11} /> {t("common.retry")}</>
                            ) : (
                              <><Download size={11} /> {t("skill.installDeps")}</>
                            )}
                          </button>
                        </div>
                      )}
                      {s.enabled && !s.ready && s.installHints.length === 0 && s.missingDeps.length > 0 && (
                        <span className="ml-[26px] text-[11px] text-[var(--text-secondary)]">
                          {t("themepack.resultManualHint", { deps: s.missingDeps.join(", ") })}
                        </span>
                      )}
                      {!s.enabled && (
                        <span className="ml-[26px] text-[11px] text-[var(--text-secondary)]">
                          {t("themepack.previewSkillNotFound")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          /* ── Preview Checklist ── */
          <>
            <span className="text-[13px] text-[var(--text-secondary)]">
              {t("themepack.confirmDesc")}
            </span>

            {/* Persona files */}
            <div className="flex items-start gap-3 rounded-lg bg-[var(--bg-surface)] p-3.5">
              <FileText size={16} className="mt-0.5 flex-shrink-0 text-[var(--primary)]" />
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-[var(--text-primary)]">
                  {t("themepack.previewPersona")}
                </span>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  SOUL.md, IDENTITY.md, HEARTBEAT.md
                </span>
              </div>
            </div>

            {/* Cron jobs */}
            {hasCron && (
              <div className="flex items-start gap-3 rounded-lg bg-[var(--bg-surface)] p-3.5">
                <Clock size={16} className="mt-0.5 flex-shrink-0 text-[var(--primary)]" />
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--text-primary)]">
                      {t("themepack.previewCron")}
                    </span>
                    <span className="rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[11px] text-[var(--primary)]">
                      {t("themepack.previewCronCount", { count: String(plan.cronDefs.length) })}
                    </span>
                  </div>
                  {plan.cronDefs.map((def, i) => (
                    <span key={i} className="text-[11px] text-[var(--text-secondary)]">
                      {def.name} — {def.schedule === "cron" ? def.value : `every ${def.value}`}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Skills */}
            {hasSkills && (
              <div className="flex items-start gap-3 rounded-lg bg-[var(--bg-surface)] p-3.5">
                <Zap size={16} className="mt-0.5 flex-shrink-0 text-[var(--primary)]" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">
                    {t("themepack.previewSkills")}
                  </span>
                  {skillChecks.map((sc) => (
                    <div key={sc.name} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-[var(--text-primary)]">{sc.name}</span>
                        <span
                          className={`text-[11px] ${
                            sc.status === "ready"
                              ? "text-green-600"
                              : sc.status === "missing_deps"
                                ? "text-amber-600"
                                : "text-[var(--text-secondary)]"
                          }`}
                        >
                          {sc.status === "ready"
                            ? t("themepack.previewSkillReady")
                            : sc.status === "missing_deps"
                              ? t("themepack.previewSkillMissing")
                              : t("themepack.previewSkillNotFound")}
                        </span>
                      </div>
                      {sc.status === "missing_deps" && sc.installHints.length > 0 && (
                        <div className="flex flex-col gap-0.5 pl-1">
                          {sc.installHints.map((hint, i) => (
                            <code key={i} className="rounded bg-[var(--bg-main)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                              {hint.command}
                            </code>
                          ))}
                        </div>
                      )}
                      {sc.status === "missing_deps" && sc.installHints.length === 0 && sc.missingDeps.length > 0 && (
                        <span className="pl-1 text-[10px] text-[var(--text-secondary)]">
                          {t("skill.needsInstall", { deps: sc.missingDeps.join(", ") })}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
        {phase === "preview" && (
          <>
            <Button variant="secondary" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button onClick={onConfirm}>{t("themepack.confirmApply")}</Button>
          </>
        )}
        {phase === "applying" && (
          <Button disabled>
            <Loader2 size={16} className="animate-spin" />
            {t("common.applying")}
          </Button>
        )}
        {phase === "done" && (
          <Button onClick={onDone}>
            <CheckCircle2 size={16} />
            {t("themepack.resultDone")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Apply Target Selector (shared between main view and customize view) ──

function ApplyTargetSelector({
  agents,
  applyTarget,
  setApplyTarget,
  selectedAgentId,
  setSelectedAgentId,
  newAgentName,
  setNewAgentName,
  newAgentSlug,
}: {
  agents: AgentDetail[];
  applyTarget: ApplyTarget;
  setApplyTarget: (v: ApplyTarget) => void;
  selectedAgentId: string;
  setSelectedAgentId: (v: string) => void;
  newAgentName: string;
  setNewAgentName: (v: string) => void;
  newAgentSlug?: string;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[13px] font-semibold text-[var(--text-primary)]">
        {t("themepack.applyTarget")}
      </span>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="radio"
          name="applyTarget"
          checked={applyTarget === "existing"}
          onChange={() => setApplyTarget("existing")}
          className="mt-0.5 accent-[var(--primary)]"
        />
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-[13px] text-[var(--text-primary)]">
            {t("themepack.targetExisting")}
          </span>
          {applyTarget === "existing" && (
            <div className="relative">
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 pr-8 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
              >
                <option value="">{t("themepack.selectAgent")}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.identity_emoji} {a.identity_name || a.id}
                    {a.is_default ? " (main)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
              />
            </div>
          )}
        </div>
      </label>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="radio"
          name="applyTarget"
          checked={applyTarget === "new"}
          onChange={() => setApplyTarget("new")}
          className="mt-0.5 accent-[var(--primary)]"
        />
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-[13px] text-[var(--text-primary)]">
            {t("themepack.targetNew")}
          </span>
          {applyTarget === "new" && (
            <>
              <input
                type="text"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder={t("themepack.newAgentPlaceholder")}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--primary)]"
              />
              {newAgentSlug && (
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {t("themepack.agentIdPreview", { id: newAgentSlug })}
                </span>
              )}
            </>
          )}
        </div>
      </label>
    </div>
  );
}

// ── Customize View ──

function CustomizeView({
  pack,
  onBack,
  agents,
  applyTarget,
  setApplyTarget,
  selectedAgentId,
  setSelectedAgentId,
  newAgentName,
  setNewAgentName,
  newAgentSlug,
  onStartApply,
  applyDisabled,
}: {
  pack: ThemePackDetailProps["pack"];
  onBack: () => void;
  agents: AgentDetail[];
  applyTarget: ApplyTarget;
  setApplyTarget: (v: ApplyTarget) => void;
  selectedAgentId: string;
  setSelectedAgentId: (v: string) => void;
  newAgentName: string;
  setNewAgentName: (v: string) => void;
  newAgentSlug: string;
  onStartApply: (overrides: { soul: string; identity: string; heartbeat: string }) => void;
  applyDisabled: boolean;
}) {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const [activeTab, setActiveTab] = useState(CUSTOMIZE_TABS[0].key);
  const [drafts, setDrafts] = useState({ soul: "", identity: "", heartbeat: "" });

  useEffect(() => {
    const tpl = getLocalizedScenarioTemplate(pack.id, language);
    const single = tpl ? getSingleScenario(tpl) : undefined;
    if (single) {
      setDrafts({ soul: single.soul, identity: single.identity, heartbeat: single.heartbeat });
    }
  }, [pack.id, language]);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onBack}
            className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="text-[28px]">{pack.emoji}</span>
          <div className="flex flex-col">
            <span className="text-base font-semibold text-[var(--text-primary)]">
              {t("themepack.customize", { name: pack.name })}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] px-6">
        {CUSTOMIZE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-[13px] transition-colors ${
              activeTab === tab.key
                ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <span className="flex items-center gap-1.5">
              {t(tab.labelKey)}
              <span className="text-[11px] font-normal text-[var(--text-secondary)]">
                {tab.file}
              </span>
            </span>
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="flex flex-1 flex-col overflow-hidden p-4">
        <textarea
          value={drafts[activeTab]}
          onChange={(e) =>
            setDrafts((prev) => ({ ...prev, [activeTab]: e.target.value }))
          }
          spellCheck={false}
          className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 font-mono text-[13px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
        />
      </div>

      {/* Apply target + Footer */}
      <div className="flex flex-col gap-3 border-t border-[var(--border)] px-6 py-4">
        <ApplyTargetSelector
          agents={agents}
          applyTarget={applyTarget}
          setApplyTarget={setApplyTarget}
          selectedAgentId={selectedAgentId}
          setSelectedAgentId={setSelectedAgentId}
          newAgentName={newAgentName}
          setNewAgentName={setNewAgentName}
          newAgentSlug={newAgentSlug}
        />

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onBack}>
            {t("common.back")}
          </Button>
          <Button
            disabled={applyDisabled}
            onClick={() => onStartApply(drafts)}
          >
            {t("themepack.applyCustom")}
          </Button>
        </div>
      </div>
    </>
  );
}

// ── Helpers: build plan & check skills ──

function buildCronDefs(templateId: string, locale?: string): CronJobDef[] {
  const tpl = locale
    ? getLocalizedScenarioTemplate(templateId, locale)
    : getScenarioTemplate(templateId);
  if (!tpl) return [];
  if (tpl.scenario.type === "single") return tpl.scenario.cron ?? [];
  const defs: CronJobDef[] = [];
  for (const role of tpl.scenario.agents) defs.push(...(role.cron ?? []));
  return defs;
}

async function checkSkills(skillNames: string[]): Promise<SkillCheck[]> {
  if (skillNames.length === 0) return [];
  let allSkills: SkillInfo[] = [];
  try {
    allSkills = await listSkills();
  } catch {
    return skillNames.map((name) => ({ name, status: "not_found" as const, missingDeps: [], installHints: [] }));
  }
  return skillNames.map((name) => {
    const found = allSkills.find((s) => s.name === name);
    if (!found) return { name, status: "not_found" as const, missingDeps: [], installHints: [] };
    if (found.missingDeps.length > 0)
      return { name, status: "missing_deps" as const, missingDeps: found.missingDeps, installHints: found.installHints ?? [] };
    return { name, status: "ready" as const, missingDeps: [], installHints: [] };
  });
}

// ── Main Component ──

export default function ThemePackDetail({
  pack,
  onApplied,
  onClose,
}: ThemePackDetailProps) {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const [customizing, setCustomizing] = useState(false);
  const [applyTarget, setApplyTarget] = useState<ApplyTarget>("existing");
  const [agents, setAgents] = useState<AgentDetail[]>([]);
  const [existingIds, setExistingIds] = useState<string[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [newAgentName, setNewAgentName] = useState("");

  const [appliedLocally, setAppliedLocally] = useState(false);

  // Overlay state
  const [overlay, setOverlay] = useState<{
    phase: "preview" | "applying" | "done";
    plan: ApplyPlan;
    skillChecks: SkillCheck[];
    results: ApplyResults | null;
  } | null>(null);

  useEffect(() => {
    listAgents().then((list) => {
      setAgents(list);
      setExistingIds(list.map((a) => a.id.toLowerCase()));
      const main = list.find((a) => a.is_default);
      if (main) setSelectedAgentId(main.id);
    }).catch(() => {});
  }, []);

  const newAgentSlug = newAgentName.trim() ? uniqueId(toSlug(newAgentName.trim()), existingIds) : "";

  const appliedScenarios = useSettingsStore((s) => s.appliedScenarios);
  const setAppliedScenario = useSettingsStore((s) => s.setAppliedScenario);

  const isAppliedToTarget = useMemo(() => {
    if (applyTarget === "new") return false;
    if (!selectedAgentId) return false;
    return appliedScenarios[selectedAgentId] === pack.id;
  }, [applyTarget, selectedAgentId, appliedScenarios, pack.id]);

  const applyDisabled =
    (applyTarget === "existing" && !selectedAgentId) ||
    (applyTarget === "new" && !newAgentName.trim());

  const resolveTargetAgentId = async (): Promise<string | undefined> => {
    if (applyTarget === "existing") return selectedAgentId || undefined;
    if (applyTarget === "new" && newAgentSlug) {
      const res = await createAgent(newAgentSlug);
      const created = res as { agentId?: string; id?: string };
      const createdId = created?.agentId || created?.id;
      if (createdId) return createdId;
      throw new Error(t("themepack.createAgentFailed"));
    }
    return undefined;
  };

  // ── Open preview overlay ──
  const startApply = async (overrides?: { soul: string; identity: string; heartbeat: string }) => {
    const tpl = getLocalizedScenarioTemplate(pack.id, language);
    if (!tpl) return;

    const single = getSingleScenario(tpl);
    const plan: ApplyPlan = {
      soul: overrides?.soul ?? single?.soul ?? "",
      identity: overrides?.identity ?? single?.identity ?? "",
      heartbeat: overrides?.heartbeat ?? single?.heartbeat ?? "",
      name: tpl.name,
      emoji: tpl.emoji,
      toolsProfile: tpl.toolsProfile,
      skills: tpl.skills,
      cronDefs: buildCronDefs(pack.id, language),
    };

    const skillChecks = await checkSkills(plan.skills);
    setOverlay({ phase: "preview", plan, skillChecks, results: null });
  };

  // ── Execute apply ──
  const confirmApply = async () => {
    if (!overlay) return;
    const { plan, skillChecks } = overlay;
    setOverlay((prev) => (prev ? { ...prev, phase: "applying" } : null));

    const results: ApplyResults = { persona: false, cronTotal: 0, cronSuccess: 0, skills: [] };

    try {
      const agentId = await resolveTargetAgentId();

      // 1. Write persona files
      await applyScenario(plan.soul, plan.identity, plan.heartbeat, plan.name, plan.emoji, agentId);
      results.persona = true;

      // 2. Set tools profile
      await setToolsProfile(plan.toolsProfile).catch(() => {});

      // 3. Install missing deps & enable skills
      for (const sc of skillChecks) {
        if (sc.status === "not_found") {
          results.skills.push({ name: sc.name, enabled: false, ready: false, missingDeps: [], installHints: sc.installHints });
          continue;
        }

        // Auto-install missing dependencies before enabling
        let depInstalled = sc.status === "ready";
        if (sc.status === "missing_deps" && sc.installHints.length > 0) {
          try {
            for (const hint of sc.installHints) {
              await installSkillDeps([hint.command]);
            }
            depInstalled = true;
          } catch (e) {
            console.warn(`[confirmApply] install deps for ${sc.name} failed:`, e);
          }
        }

        try {
          await enableScenarioSkills([sc.name]);
          results.skills.push({
            name: sc.name,
            enabled: true,
            ready: depInstalled,
            missingDeps: depInstalled ? [] : sc.missingDeps,
            installHints: sc.installHints,
          });
        } catch {
          results.skills.push({ name: sc.name, enabled: false, ready: false, missingDeps: sc.missingDeps, installHints: sc.installHints });
        }
      }

      // 4. Upsert cron jobs (create or update existing to avoid duplicates)
      results.cronTotal = plan.cronDefs.length;
      if (agentId && plan.cronDefs.length > 0) {
        const { created, updated } = await upsertScenarioCronJobs(plan.cronDefs, agentId);
        results.cronSuccess = created + updated;
      }

      // 5. Record applied scenario mapping
      const finalAgentId = agentId ?? selectedAgentId ?? "main";
      setAppliedScenario(finalAgentId, pack.id);

      // 6. Restart gateway
      scheduleGatewayRestart();
      onApplied?.();
      setAppliedLocally(true);
      // Re-fetch agents
      listAgents().then((list) => {
        setAgents(list);
        setExistingIds(list.map((a) => a.id.toLowerCase()));
      }).catch(() => {});
    } catch (e) {
      results.error = String(e);
    }

    setOverlay((prev) => (prev ? { ...prev, phase: "done", results } : null));
  };

  const closeOverlay = () => {
    setOverlay(null);
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Drawer */}
      <div className="slide-in-right fixed right-0 top-0 z-50 flex h-full w-[480px] flex-col border-l border-[var(--border)] bg-[var(--bg-main)] shadow-2xl">
        {/* Overlay (preview / applying / done) */}
        {overlay && (
          <ApplyConfirmOverlay
            plan={overlay.plan}
            skillChecks={overlay.skillChecks}
            phase={overlay.phase}
            results={overlay.results}
            onConfirm={confirmApply}
            onCancel={closeOverlay}
            onDone={closeOverlay}
            onResultsUpdate={(updater) =>
              setOverlay((prev) =>
                prev?.results ? { ...prev, results: updater(prev.results) } : prev,
              )
            }
          />
        )}

        {customizing ? (
          <CustomizeView
            pack={pack}
            onBack={() => setCustomizing(false)}
            agents={agents}
            applyTarget={applyTarget}
            setApplyTarget={setApplyTarget}
            selectedAgentId={selectedAgentId}
            setSelectedAgentId={setSelectedAgentId}
            newAgentName={newAgentName}
            setNewAgentName={setNewAgentName}
            newAgentSlug={newAgentSlug}
            onStartApply={(overrides) => startApply(overrides)}
            applyDisabled={applyDisabled}
          />
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
              <div className="flex items-center gap-2.5">
                <span className="text-[28px]">{pack.emoji}</span>
                <span className="text-xl font-semibold text-[var(--text-primary)]">
                  {pack.name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const tpl = getScenarioTemplate(pack.id);
                    if (tpl) exportScenarioJSON(tpl);
                  }}
                  title={t("themepack.export")}
                  className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--primary)] transition-colors"
                >
                  <Download size={18} />
                </button>
                <button
                  onClick={onClose}
                  className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex flex-1 flex-col gap-5 overflow-auto p-6">
              <div className="flex flex-wrap gap-1.5">
                {pack.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>

              <p className="text-sm leading-relaxed text-[var(--text-primary)]">
                {pack.fullDesc || pack.desc}
              </p>

              {/* Skills section */}
              {pack.skills && pack.skills.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                    {t("themepack.skills")}
                  </span>
                  <div className="flex flex-col gap-1">
                    {pack.skills.map((skill) => (
                      <div key={skill} className="flex items-center gap-2 py-1.5">
                        <div className="h-1.5 w-1.5 rounded-full bg-[var(--primary)]" />
                        <span className="text-[13px] text-[var(--text-secondary)]">{skill}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Info row */}
              {(pack.recommendedModel || pack.estimatedCost) && (
                <div className="flex gap-4">
                  {pack.recommendedModel && (
                    <div className="flex flex-1 flex-col gap-1 rounded-lg bg-[var(--bg-surface)] px-3.5 py-3">
                      <span className="text-[11px] text-[var(--text-secondary)]">
                        {t("themepack.recommendedModel")}
                      </span>
                      <span className="text-[13px] font-medium text-[var(--text-primary)]">
                        {pack.recommendedModel}
                      </span>
                    </div>
                  )}
                  {pack.estimatedCost && (
                    <div className="flex flex-1 flex-col gap-1 rounded-lg bg-[var(--bg-surface)] px-3.5 py-3">
                      <span className="text-[11px] text-[var(--text-secondary)]">
                        {t("themepack.estimatedCost")}
                      </span>
                      <span className="text-[13px] font-medium text-[var(--text-primary)]">
                        {pack.estimatedCost}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Chat preview */}
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {t("themepack.chatPreview")}
                </span>
                <div className="flex flex-col gap-2.5 rounded-lg bg-[var(--bg-surface)] p-3.5">
                  <div className="flex justify-end">
                    <div className="rounded-xl rounded-br-sm bg-[var(--primary)] px-3 py-2 text-[13px] text-white">
                      {t("themepack.chatUser")}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#EBF5FB] text-sm">
                      {pack.emoji}
                    </div>
                    <div className="rounded-xl rounded-bl-sm border border-[var(--border)] bg-[var(--bg-main)] px-3 py-2 text-[13px] leading-relaxed text-[var(--text-primary)]">
                      {t("themepack.chatBot", { name: pack.name })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Apply target */}
              <ApplyTargetSelector
                agents={agents}
                applyTarget={applyTarget}
                setApplyTarget={setApplyTarget}
                selectedAgentId={selectedAgentId}
                setSelectedAgentId={setSelectedAgentId}
                newAgentName={newAgentName}
                setNewAgentName={setNewAgentName}
                newAgentSlug={newAgentSlug}
              />
            </div>

            {/* Footer */}
            <div className="flex flex-col gap-2 border-t border-[var(--border)] px-6 py-4">
              {isAppliedToTarget || appliedLocally ? (
                <div className="flex justify-end">
                  <Button disabled>
                    <CheckCircle2 size={16} />
                    {t("themepack.applied")}
                  </Button>
                </div>
              ) : (
                <div className="flex justify-end gap-3">
                  <Button variant="secondary" onClick={() => setCustomizing(true)}>
                    {t("themepack.customizeApply")}
                  </Button>
                  <Button
                    disabled={applyDisabled}
                    onClick={() => startApply()}
                  >
                    {t("themepack.oneClick")}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
