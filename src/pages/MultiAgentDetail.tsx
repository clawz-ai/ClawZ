import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  X,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Check,
  Loader2,
  Circle,
  Download,
} from "lucide-react";
import Button from "../components/ui/Button";
import { ModelSearchSelect } from "../components/ui/ModelSearchSelect";
import Tag from "../components/ui/Tag";
import type {
  ScenarioTemplate,
  MultiAgentScenario,
  AgentRole,
} from "../lib/scenarioTemplates";
import {
  applyScenario,
  createAgent,
  listSelectableModels,
  readOpenClawConfig,
  bindAgentChannel,
  restartGateway,
  setToolsProfile,
  enableScenarioSkills,
  listSkills,
  installSkillDeps,
  type ConfiguredModel,
  type SkillInfo,
} from "../lib/tauri";
import { useT } from "../lib/i18n";
import { exportScenarioJSON } from "../lib/exportScenario";
import { CHANNEL_LOGOS } from "../lib/logos";
import { parseBindingsFromConfig } from "../lib/bindings";

interface MultiAgentDetailProps {
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
  template: ScenarioTemplate;
  onClose: () => void;
}

// ── Agent Role Card (collapsible preview) ──

function AgentRoleCard({
  role,
  expanded,
  onToggle,
}: {
  role: AgentRole;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{role.emoji}</span>
          <div className="flex flex-col items-start">
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">
              {role.name}
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              {t("themepack.role")}: {role.role}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {role.recommendedModel && (
            <span className="text-[11px] text-[var(--text-secondary)]">
              {role.recommendedModel}
            </span>
          )}
          {expanded ? (
            <ChevronUp size={14} className="text-[var(--text-secondary)]" />
          ) : (
            <ChevronDown size={14} className="text-[var(--text-secondary)]" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
              SOUL.md
            </span>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-[var(--bg-main)] p-2.5 font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
              {role.soul.slice(0, 300)}
              {role.soul.length > 300 ? "..." : ""}
            </pre>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-[var(--text-secondary)]">
              IDENTITY.md
            </span>
            <pre className="max-h-20 overflow-auto whitespace-pre-wrap rounded bg-[var(--bg-main)] p-2.5 font-mono text-[11px] leading-relaxed text-[var(--text-primary)]">
              {role.identity}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Orchestration Architecture Diagram ──

function OrchestrationDiagram({ agents }: { agents: AgentRole[] }) {
  if (agents.length !== 2) return null;
  const [a, b] = agents;
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg bg-[var(--bg-surface)] px-6 py-5">
      <div className="flex w-full items-start justify-around">
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl">{a.emoji}</span>
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            {a.name}
          </span>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {a.soul.match(/^#.*?\n\n(.+)/m)?.[1]?.slice(0, 20) || a.role}
          </span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl">{b.emoji}</span>
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            {b.name}
          </span>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {b.soul.match(/^#.*?\n\n(.+)/m)?.[1]?.slice(0, 20) || b.role}
          </span>
        </div>
      </div>
      <svg
        viewBox="0 0 200 40"
        className="h-10 w-48 text-[var(--text-secondary)]"
      >
        <line
          x1="50"
          y1="5"
          x2="100"
          y2="35"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <line
          x1="150"
          y1="5"
          x2="100"
          y2="35"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
      </svg>
      <span className="text-[13px] font-medium text-[var(--primary)]">
        {">"} User Decision
      </span>
    </div>
  );
}

// ── Deploy Step Item ──

type StepStatus = "pending" | "running" | "done" | "error";

function DeployStepItem({
  label,
  status,
}: {
  label: string;
  status: StepStatus;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      {status === "done" && (
        <Check size={16} className="text-green-600" />
      )}
      {status === "running" && (
        <Loader2 size={16} className="animate-spin text-[var(--primary)]" />
      )}
      {status === "pending" && (
        <Circle size={16} className="text-[var(--text-secondary)]" />
      )}
      {status === "error" && (
        <X size={16} className="text-red-500" />
      )}
      <span
        className={`text-[13px] ${
          status === "done"
            ? "text-green-600"
            : status === "error"
              ? "text-red-500"
              : status === "running"
                ? "font-medium text-[var(--text-primary)]"
                : "text-[var(--text-secondary)]"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

// ── Main Component ──

type WizardPhase = "overview" | "step1" | "step2" | "step3" | "deploying" | "done";

interface BindingSelection { channel: string; accountId?: string }

interface AgentConfig {
  name: string;
  emoji: string;
  model: string;
  workspace: string;
}

export default function MultiAgentDetail({
  pack,
  template,
  onClose,
}: MultiAgentDetailProps) {
  const t = useT();
  const navigate = useNavigate();
  const scenario = template.scenario as MultiAgentScenario;

  // Overview state
  const [expandedRole, setExpandedRole] = useState<string | null>(
    scenario.agents[0]?.role ?? null,
  );

  // Wizard state
  const [phase, setPhase] = useState<WizardPhase>("overview");
  const [agentConfigs, setAgentConfigs] = useState<AgentConfig[]>(() =>
    scenario.agents.map((a) => ({
      name: a.name,
      emoji: a.emoji,
      model: "",  // empty = use system default model
      workspace: "",
    })),
  );
  const [sameModel, setSameModel] = useState(true);

  // Available models & account-level bindable units
  const [availableModels, setAvailableModels] = useState<ConfiguredModel[]>([]);
  interface BindableUnit { channel: string; accountId: string; key: string; label: string }
  const [bindableUnits, setBindableUnits] = useState<BindableUnit[]>([]);
  /** Keys already bound by existing agents (channel:accountId → agentId) */
  const [existingBoundKeys, setExistingBoundKeys] = useState<Record<string, string>>({});

  // Route assignments: map from bindable unit key → agent index (-1 = unassigned)
  const [routeAssignments, setRouteAssignments] = useState<Record<string, number>>({});

  // Deploy state
  interface DeployStep {
    label: string;
    status: StepStatus;
  }
  const [deploySteps, setDeploySteps] = useState<DeployStep[]>([]);
  const [deployError, setDeployError] = useState("");

  useEffect(() => {
    listSelectableModels()
      .then((models) => setAvailableModels(models))
      .catch(() => {});
    readOpenClawConfig()
      .then((cfg) => {
        // Build bindable units from channel config
        const channels = (cfg?.channels ?? {}) as Record<string, Record<string, unknown>>;
        const units: BindableUnit[] = [];
        for (const [chId, ch] of Object.entries(channels)) {
          if (ch?.enabled !== true) continue;
          const accounts = ch?.accounts as Record<string, Record<string, unknown>> | undefined;
          if (accounts && Object.keys(accounts).length > 0) {
            for (const acctId of Object.keys(accounts)) {
              const acct = accounts[acctId];
              const acctName = (acct?.name as string) || acctId;
              units.push({
                channel: chId,
                accountId: acctId,
                key: `${chId}:${acctId}`,
                label: acctId === "default" ? chId : `${chId} / ${acctName}`,
              });
            }
          } else {
            units.push({ channel: chId, accountId: "default", key: `${chId}:default`, label: chId });
          }
        }
        setBindableUnits(units);

        // Parse existing bindings from config (instant, no per-agent CLI calls)
        const allBindings = parseBindingsFromConfig(cfg);
        const map: Record<string, string> = {};
        for (const b of allBindings) {
          if (!b.match.channel) continue;
          const key = b.match.accountId
            ? `${b.match.channel}:${b.match.accountId}`
            : `${b.match.channel}:default`;
          if (!map[key]) map[key] = b.agentId;
        }
        setExistingBoundKeys(map);
      })
      .catch(() => {});
  }, []);

  const updateAgentConfig = (
    idx: number,
    patch: Partial<AgentConfig>,
  ) => {
    setAgentConfigs((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      // Propagate if "same" is checked
      if (patch.model && sameModel) {
        for (let i = 0; i < next.length; i++) {
          next[i] = { ...next[i], model: patch.model };
        }
      }
      return next;
    });
  };

  /** Assign a bindable unit to an agent (or unassign with -1) */
  const assignRoute = (unitKey: string, agentIdx: number) => {
    setRouteAssignments((prev) => {
      const next = { ...prev };
      if (agentIdx < 0) {
        delete next[unitKey];
      } else {
        next[unitKey] = agentIdx;
      }
      return next;
    });
  };

  /** Build bindings per agent from routeAssignments (used at deploy time) */
  const buildAgentBindings = (): BindingSelection[][] => {
    const result: BindingSelection[][] = agentConfigs.map(() => []);
    for (const [unitKey, agentIdx] of Object.entries(routeAssignments)) {
      if (agentIdx < 0 || agentIdx >= agentConfigs.length) continue;
      const unit = bindableUnits.find((u) => u.key === unitKey);
      if (!unit) continue;
      result[agentIdx].push({ channel: unit.channel, accountId: unit.accountId });
    }
    return result;
  };

  // ── Deploy execution ──

  const runDeploy = async () => {
    setPhase("deploying");
    setDeployError("");

    // Resolve bindings from route assignments
    const perAgentBindings = buildAgentBindings();

    // Build step list
    const steps: DeployStep[] = [];
    for (let i = 0; i < agentConfigs.length; i++) {
      const cfg = agentConfigs[i];
      steps.push({
        label: t("themepack.deployStepCreate", { name: cfg.name }),
        status: "pending",
      });
      steps.push({
        label: t("themepack.deployStepPersona", { name: cfg.name }),
        status: "pending",
      });
      for (const b of perAgentBindings[i]) {
        const spec = b.accountId ? `${b.channel}:${b.accountId}` : b.channel;
        steps.push({
          label: t("themepack.deployStepChannel", {
            name: cfg.name,
            channel: spec,
          }),
          status: "pending",
        });
      }
    }
    steps.push({
      label: t("themepack.deployStepGateway"),
      status: "pending",
    });
    setDeploySteps([...steps]);

    let stepIdx = 0;
    const mark = (status: StepStatus) => {
      steps[stepIdx] = { ...steps[stepIdx], status };
      setDeploySteps([...steps]);
    };

    // Build CLI-safe agent IDs from role names (ASCII slug)
    const usedIds = new Set<string>(["main", "default"]);
    const agentCliIds: string[] = scenario.agents.map((a) => {
      // Prefer role (ASCII) over name (may be CJK)
      const base = a.role
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") || "agent";
      let id = base;
      let n = 2;
      while (usedIds.has(id)) { id = `${base}-${n++}`; }
      usedIds.add(id);
      return id;
    });

    try {
      for (let i = 0; i < scenario.agents.length; i++) {
        const role = scenario.agents[i];
        const cfg = agentConfigs[i];
        const bindings = perAgentBindings[i];
        const cliId = agentCliIds[i];

        // Create agent (retry with timestamp suffix on name conflict)
        mark("running");
        let agentId = cliId;
        try {
          const res = await createAgent(
            cliId,
            cfg.workspace.trim() || undefined,
            cfg.model || undefined,
          );
          const created = res as { id?: string };
          agentId = created?.id || cliId;
        } catch (createErr) {
          const msg = String(createErr).toLowerCase();
          if (msg.includes("already exists") || msg.includes("reserved")) {
            const fallbackId = `${cliId}-${Date.now().toString(36)}`;
            const res = await createAgent(
              fallbackId,
              cfg.workspace.trim() || undefined,
              cfg.model || undefined,
            );
            const created = res as { id?: string };
            agentId = created?.id || fallbackId;
          } else {
            throw createErr;
          }
        }
        mark("done");
        stepIdx++;

        // Apply persona
        mark("running");
        await applyScenario(
          role.soul,
          role.identity,
          role.heartbeat,
          cfg.name,
          cfg.emoji,
          agentId,
        );
        mark("done");
        stepIdx++;

        // Bind channels
        for (const b of bindings) {
          mark("running");
          if (agentId) {
            const spec = b.accountId ? `${b.channel}:${b.accountId}` : b.channel;
            await bindAgentChannel(agentId, spec);
          }
          mark("done");
          stepIdx++;
        }
      }

      // Set tools profile and enable skills
      await setToolsProfile(template.toolsProfile).catch((e) =>
        console.warn("setToolsProfile:", e),
      );
      if (template.skills.length > 0) {
        // Auto-install missing skill dependencies before enabling
        try {
          const allSkills: SkillInfo[] = await listSkills();
          for (const skillName of template.skills) {
            const info = allSkills.find((s) => s.name === skillName);
            if (info && info.missingDeps.length > 0 && info.installHints?.length) {
              for (const hint of info.installHints) {
                await installSkillDeps([hint.command]).catch((e) =>
                  console.warn(`install dep for ${skillName}:`, e),
                );
              }
            }
          }
        } catch (e) {
          console.warn("skill dep install:", e);
        }
        await enableScenarioSkills(template.skills).catch((e) =>
          console.warn("enableScenarioSkills:", e),
        );
      }

      // Restart gateway
      mark("running");
      await restartGateway();
      mark("done");

      setPhase("done");
    } catch (e) {
      mark("error");
      setDeployError(String(e));
    }
  };

  const totalSteps = deploySteps.length;
  const doneSteps = deploySteps.filter((s) => s.status === "done").length;
  const percent = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

  // ── Wizard step indicator ──

  const stepTitles = [
    t("themepack.wizardStep1Title"),
    t("themepack.wizardStep2Title"),
    t("themepack.wizardStep3Title"),
  ];

  const currentStepNum =
    phase === "step1" ? 1 : phase === "step2" ? 2 : phase === "step3" ? 3 : 0;

  // ── Render ──

  const renderOverview = () => (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
        <div className="flex items-center gap-2.5">
          <span className="text-[28px]">{pack.emoji}</span>
          <div className="flex flex-col">
            <span className="text-xl font-semibold text-[var(--text-primary)]">
              {pack.name}
            </span>
            <span className="rounded-md text-[11px] font-medium text-[var(--primary)]">
              {t("themepack.multiAgentBadge")} · {scenario.agents.length}{" "}
              Agents
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => exportScenarioJSON(template)}
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

        {/* Orchestration diagram */}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            {t("themepack.orchestration")}
          </span>
          <OrchestrationDiagram agents={scenario.agents} />
          <p className="rounded-lg bg-[var(--bg-surface)] p-3.5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
            {scenario.orchestration}
          </p>
        </div>

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

        {/* Agent Roles */}
        <div className="flex flex-col gap-2.5">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">
            {t("themepack.agentRoles")}
          </span>
          {scenario.agents.map((role) => (
            <AgentRoleCard
              key={role.role}
              role={role}
              expanded={expandedRole === role.role}
              onToggle={() =>
                setExpandedRole((prev) =>
                  prev === role.role ? null : role.role,
                )
              }
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end border-t border-[var(--border)] px-6 py-4">
        <Button onClick={() => setPhase("step1")}>
          {t("themepack.deployAll")}
        </Button>
      </div>
    </>
  );

  const renderWizardHeader = () => (
    <div className="flex flex-col gap-3 border-b border-[var(--border)] px-6 py-5">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-[var(--text-primary)]">
          {t("themepack.wizardStepOf", {
            name: pack.name,
            current: String(currentStepNum),
            total: "3",
          })}
        </span>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
        >
          <X size={20} />
        </button>
      </div>
      {/* Step indicators */}
      <div className="flex gap-2">
        {stepTitles.map((title, i) => (
          <div key={i} className="flex flex-1 flex-col gap-1">
            <div
              className={`h-1 rounded-full ${
                i + 1 <= currentStepNum
                  ? "bg-[var(--primary)]"
                  : "bg-[var(--border)]"
              }`}
            />
            <span
              className={`text-[11px] ${
                i + 1 === currentStepNum
                  ? "font-medium text-[var(--primary)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderStep1 = () => (
    <>
      {renderWizardHeader()}
      <div className="flex flex-1 flex-col gap-5 overflow-auto p-6">
        {agentConfigs.map((cfg, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4"
          >
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">
              Agent {i + 1}
            </span>
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {t("themepack.agentEmoji")}
                </span>
                <input
                  type="text"
                  value={cfg.emoji}
                  onChange={(e) =>
                    updateAgentConfig(i, { emoji: e.target.value })
                  }
                  className="w-12 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-center text-lg outline-none focus:border-[var(--primary)]"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {t("themepack.agentName")}
                </span>
                <input
                  type="text"
                  value={cfg.name}
                  onChange={(e) =>
                    updateAgentConfig(i, { name: e.target.value })
                  }
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--text-secondary)]">
                {t("themepack.agentWorkDir")}
              </span>
              <input
                type="text"
                value={cfg.workspace}
                onChange={(e) =>
                  updateAgentConfig(i, { workspace: e.target.value })
                }
                placeholder={t("themepack.workspacePlaceholder")}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--primary)]"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
        <Button variant="secondary" onClick={() => setPhase("overview")}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => setPhase("step2")}>
          {t("common.next")} &rarr;
        </Button>
      </div>
    </>
  );

  const renderStep2 = () => (
    <>
      {renderWizardHeader()}
      <div className="flex flex-1 flex-col gap-5 overflow-auto p-6">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={sameModel}
            onChange={(e) => {
              setSameModel(e.target.checked);
              if (e.target.checked && agentConfigs[0]?.model) {
                setAgentConfigs((prev) =>
                  prev.map((c) => ({ ...c, model: prev[0].model })),
                );
              }
            }}
            className="accent-[var(--primary)]"
          />
          <span className="text-[13px] text-[var(--text-primary)]">
            {t("themepack.sameModelForAll")}
          </span>
        </label>

        {sameModel ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-[var(--text-secondary)]">
              {t("themepack.selectModel")}
            </span>
            <ModelSelect
              models={availableModels}
              value={agentConfigs[0]?.model ?? ""}
              onChange={(v) => updateAgentConfig(0, { model: v })}
            />
          </div>
        ) : (
          agentConfigs.map((cfg, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                {cfg.emoji} {cfg.name}
              </span>
              <ModelSelect
                models={availableModels}
                value={cfg.model}
                onChange={(v) => updateAgentConfig(i, { model: v })}
              />
            </div>
          ))
        )}
      </div>
      <div className="flex justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
        <Button variant="secondary" onClick={() => setPhase("step1")}>
          &larr; {t("common.prev")}
        </Button>
        <Button onClick={() => setPhase("step3")}>
          {t("common.next")} &rarr;
        </Button>
      </div>
    </>
  );

  // Filter out already-bound units & group by channel for Step 3
  const freeUnits = bindableUnits.filter((u) => !existingBoundKeys[u.key]);
  const unitsByChannel = freeUnits.reduce<Record<string, BindableUnit[]>>((acc, u) => {
    (acc[u.channel] ??= []).push(u);
    return acc;
  }, {});

  const renderStep3 = () => (
    <>
      {renderWizardHeader()}
      <div className="flex flex-1 flex-col gap-5 overflow-auto p-6">
        <p className="text-[13px] text-[var(--text-secondary)]">
          {t("themepack.routeAssignment")}
        </p>

        {freeUnits.length === 0 ? (
          <p className="text-[13px] italic text-[var(--text-secondary)]">
            {bindableUnits.length === 0 ? t("channel.noChannel") : t("agent.allChannelsBound")}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {Object.entries(unitsByChannel).map(([channelId, units]) => (
              <div
                key={channelId}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4"
              >
                {/* Channel header */}
                <div className="mb-2.5 flex items-center gap-2">
                  {CHANNEL_LOGOS[channelId] && (
                    <img src={CHANNEL_LOGOS[channelId]} alt={channelId} className="h-4 w-4" />
                  )}
                  <span className="text-[13px] font-semibold capitalize text-[var(--text-primary)]">
                    {channelId}
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    {t("themepack.accountsAvailable", { count: String(units.length) })}
                  </span>
                  {bindableUnits.filter((u) => u.channel === channelId && existingBoundKeys[u.key]).length > 0 && (
                    <span className="text-[10px] text-[var(--text-secondary)]">
                      ({bindableUnits.filter((u) => u.channel === channelId && existingBoundKeys[u.key]).length} {t("themepack.alreadyBound")})
                    </span>
                  )}
                </div>

                {/* Per-account route assignment */}
                <div className="flex flex-col gap-2">
                  {units.map((unit) => {
                    const assignedIdx = routeAssignments[unit.key] ?? -1;
                    return (
                      <div
                        key={unit.key}
                        className="flex items-center justify-between rounded-lg bg-[var(--bg-main)] px-3 py-2"
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-[var(--text-primary)]">
                            {unit.accountId === "default"
                              ? t("agent.bindAccountDefault")
                              : unit.accountId}
                          </span>
                          {unit.accountId !== "default" && (
                            <span className="text-[10px] text-[var(--text-secondary)]">
                              {unit.key}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-[var(--text-secondary)]">→</span>
                          <select
                            value={assignedIdx}
                            onChange={(e) => assignRoute(unit.key, parseInt(e.target.value, 10))}
                            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
                          >
                            <option value={-1}>{t("themepack.unassigned")}</option>
                            {agentConfigs.map((cfg, i) => (
                              <option key={i} value={i}>
                                {cfg.emoji} {cfg.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Hint */}
            <div className="flex items-start gap-1.5 rounded-lg bg-[var(--bg-surface)] px-3 py-2">
              <Circle size={6} className="mt-1 shrink-0 text-[var(--primary)]" />
              <span className="text-[11px] text-[var(--text-secondary)]">
                {t("themepack.routeHint")}
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
        <Button variant="secondary" onClick={() => setPhase("step2")}>
          &larr; {t("common.prev")}
        </Button>
        <Button onClick={runDeploy}>{t("themepack.startDeploy")}</Button>
      </div>
    </>
  );

  const renderDeploying = () => (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
        <span className="text-base font-semibold text-[var(--text-primary)]">
          {t("themepack.deploying")}
        </span>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
        >
          <X size={20} />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        {deploySteps.map((step, i) => (
          <DeployStepItem key={i} label={step.label} status={step.status} />
        ))}
        {deployError && (
          <p className="mt-2 text-sm text-red-500">{deployError}</p>
        )}
      </div>
      {/* Progress bar */}
      <div className="border-t border-[var(--border)] px-6 py-4">
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--border)]">
          <div
            className="h-full rounded-full bg-[var(--primary)] transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="mt-1 block text-right text-[11px] text-[var(--text-secondary)]">
          {percent}%
        </span>
      </div>
    </>
  );

  const renderDone = () => (
    <>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-5">
        <span className="text-base font-semibold text-[var(--text-primary)]">
          {t("themepack.deployComplete")}
        </span>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
        >
          <X size={20} />
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <CheckCircle2 size={48} className="text-green-600" />
        <p className="text-lg font-semibold text-[var(--text-primary)]">
          {t("themepack.deploySuccess", {
            count: String(scenario.agents.length),
          })}
        </p>
        <Button
          onClick={() => {
            onClose();
            navigate("/agents");
          }}
        >
          {t("themepack.goToAgentManagement")}
        </Button>
      </div>
    </>
  );

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Drawer */}
      <div className="slide-in-right fixed right-0 top-0 z-50 flex h-full w-[520px] flex-col border-l border-[var(--border)] bg-[var(--bg-main)] shadow-2xl">
        {phase === "overview" && renderOverview()}
        {phase === "step1" && renderStep1()}
        {phase === "step2" && renderStep2()}
        {phase === "step3" && renderStep3()}
        {phase === "deploying" && renderDeploying()}
        {phase === "done" && renderDone()}
      </div>
    </>
  );
}

// ── Utility sub-components ──

function ModelSelect({
  models,
  value,
  onChange,
}: {
  models: ConfiguredModel[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <ModelSearchSelect
      models={models}
      value={value}
      onChange={onChange}
      placeholder="—"
    />
  );
}

