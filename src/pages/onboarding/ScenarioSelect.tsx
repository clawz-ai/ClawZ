import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { Info, Loader2 } from "lucide-react";
import Button from "../../components/ui/Button";
import StepIndicator from "../../components/ui/StepIndicator";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { markStepCompleted, saveOnboardingData } from "../../lib/onboardingProgress";
import { getLocalizedScenarioTemplate, getSingleScenario, isMultiAgent, useLocalizedScenarios } from "../../lib/scenarioTemplates";
import type { CronJobDef } from "../../data/scenarios/schema";
import { applyScenario, enableScenarioSkills, startGateway, setToolsProfile, upsertScenarioCronJobs } from "../../lib/tauri";
import { useT } from "../../lib/i18n";

export default function ScenarioSelect() {
  const navigate = useNavigate();
  const t = useT();
  const { selectedScenario, setScenario, selectedToolsProfile, setToolsProfile: setStoreToolsProfile } = useOnboardingStore();
  const language = useSettingsStore((s) => s.language);
  const localizedScenarios = useLocalizedScenarios();

  const toolsProfiles = [
    { id: "minimal", label: t("onboarding.toolsMinimal"), desc: t("onboarding.toolsMinimalDesc") },
    { id: "coding", label: t("onboarding.toolsCoding"), desc: t("onboarding.toolsCodingDesc") },
    { id: "messaging", label: t("onboarding.toolsMessaging"), desc: t("onboarding.toolsMessagingDesc") },
    { id: "full", label: t("onboarding.toolsFull"), desc: t("onboarding.toolsFullDesc") },
  ];

  // Accent colors per scenario (RGB) for gradient backgrounds
  const SCENARIO_ACCENT: Record<string, [number, number, number]> = {
    default: [139, 92, 246],   // violet
    morning: [251, 146, 60],   // orange
    writer:  [20, 184, 166],   // teal
    email:   [59, 130, 246],   // blue
    ops:     [16, 185, 129],   // emerald
    debate:  [244, 63, 94],    // rose
  };

  const scenarios = localizedScenarios.map((s) => ({
    id: s.id,
    emoji: s.emoji,
    name: s.name,
    desc: s.description,
    isMulti: isMultiAgent(s),
  }));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [multiAgentTip, setMultiAgentTip] = useState<string | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Click outside to dismiss tooltip
  useEffect(() => {
    if (!multiAgentTip) return;
    const handler = (e: MouseEvent) => {
      if (tipRef.current && !tipRef.current.contains(e.target as Node)) {
        setMultiAgentTip(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [multiAgentTip]);

  return (
    <div className="flex w-[720px] flex-col items-center gap-6 rounded-[20px] bg-[var(--bg-main)] px-10 py-9">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
        {t("onboarding.scenarioTitle")}
      </h1>
      <p className="text-sm text-[var(--text-secondary)]">
        {t("onboarding.scenarioDesc")}
      </p>

      {/* Scenario Grid */}
      <div className="grid w-full grid-cols-3 gap-4">
        {scenarios.map((s) => {
          const [r, g, b] = SCENARIO_ACCENT[s.id] || [128, 128, 128];
          const isSelected = selectedScenario === s.id;
          return (
            <div key={s.id} className="relative">
              <button
                onClick={() => { if (!s.isMulti) setScenario(s.id); }}
                disabled={s.isMulti}
                className={`flex h-full w-full flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all ${
                  s.isMulti
                    ? "cursor-not-allowed border-transparent opacity-50"
                    : isSelected
                      ? "shadow-md"
                      : "border-transparent hover:shadow-sm"
                }`}
                style={{
                  background: isSelected
                    ? `linear-gradient(135deg, rgba(${r},${g},${b},0.22) 0%, rgba(${r},${g},${b},0.06) 100%)`
                    : `linear-gradient(135deg, rgba(${r},${g},${b},0.12) 0%, var(--bg-surface) 100%)`,
                  borderColor: isSelected ? `rgba(${r},${g},${b},0.5)` : undefined,
                }}
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-xl"
                  style={{ background: `rgba(${r},${g},${b},0.15)` }}
                >
                  {s.emoji}
                </div>
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {s.name}
                </span>
                <span className="text-xs text-[var(--text-secondary)]">
                  {s.desc}
                </span>
              </button>
              {s.isMulti && (
                <button
                  className="absolute right-2 top-2 rounded-full p-0.5 text-[var(--warning)] hover:bg-[var(--bg-surface)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMultiAgentTip(multiAgentTip === s.id ? null : s.id);
                  }}
                >
                  <Info size={14} />
                </button>
              )}
              {multiAgentTip === s.id && (
                <div
                  ref={tipRef}
                  className="absolute right-0 top-8 z-10 w-48 rounded-lg bg-[var(--bg-surface)] p-3 text-xs text-[var(--text-secondary)] shadow-lg ring-1 ring-[var(--border)]"
                >
                  {t("onboarding.scenarioMultiAgentHint")}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Tools Profile */}
      <div className="flex w-full flex-col gap-3">
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {t("onboarding.toolsProfile")}
        </span>
        <div className="flex gap-1 rounded-[10px] bg-[var(--bg-surface)] p-1">
          {toolsProfiles.map((tp) => (
            <button
              key={tp.id}
              onClick={() => setStoreToolsProfile(tp.id)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                selectedToolsProfile === tp.id
                  ? "bg-[var(--bg-main)] font-medium text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {tp.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--text-secondary)]">
          {toolsProfiles.find((tp) => tp.id === selectedToolsProfile)?.desc}
        </span>
      </div>

      {/* Buttons */}
      <div className="flex w-full items-center justify-between">
        <Button
          variant="secondary"
          onClick={() => navigate("/onboarding/channel")}
        >
          {t("common.prev")}
        </Button>
        <Button
          onClick={async () => {
            setError("");
            const template = getLocalizedScenarioTemplate(selectedScenario, language);
            const single = template ? getSingleScenario(template) : undefined;
            if (!template || !single) return;
            setApplying(true);
            try {
              await applyScenario(
                single.soul,
                single.identity,
                single.heartbeat,
                template.name,
                template.emoji,
              );
              await setToolsProfile(selectedToolsProfile);

              // Enable skills defined in the scenario
              if (template.skills.length > 0) {
                await enableScenarioSkills(template.skills).catch((e) =>
                  console.warn("[ScenarioSelect] enableScenarioSkills failed:", e),
                );
              }

              // Full gateway init — during onboarding the gateway has never been
              // installed. startGateway() sets gateway.mode, runs install, then start.
              // restartGateway() alone won't work because no service exists yet.
              await startGateway().catch((e) =>
                console.warn("[ScenarioSelect] startGateway failed:", e),
              );

              // Create cron jobs — retry up to 3 times with delay because
              // the gateway WS port needs time to become ready after restart.
              // upsertScenarioCronJobs never throws (catches per-job), so we
              // check the result count to decide whether to retry.
              const cronDefs: CronJobDef[] = single.cron ?? [];
              if (cronDefs.length > 0) {
                for (let attempt = 0; attempt < 3; attempt++) {
                  await new Promise((r) => setTimeout(r, 3000));
                  const { created, updated } = await upsertScenarioCronJobs(cronDefs, "main");
                  if (created + updated >= cronDefs.length) break;
                  console.warn(`[ScenarioSelect] cron attempt ${attempt + 1}: ${created + updated}/${cronDefs.length}`);
                }
              }

              await markStepCompleted("scenario");
              await saveOnboardingData({ selectedScenario, selectedToolsProfile });
              navigate("/onboarding/complete");
            } catch (e) {
              setError(String(e));
            } finally {
              setApplying(false);
            }
          }}
          disabled={!selectedScenario || applying}
        >
          {applying ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("common.applying")}
            </>
          ) : (
            t("common.next")
          )}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      <StepIndicator currentStep={4} totalSteps={5} completedSteps={[1, 2, 3]} />
    </div>
  );
}
