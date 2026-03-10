import { useNavigate } from "react-router";
import { CheckCircle2, Rocket } from "lucide-react";
import StepIndicator from "../../components/ui/StepIndicator";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useAppStore } from "../../stores/appStore";
import { markStepCompleted } from "../../lib/onboardingProgress";
import { getLocalizedScenarioTemplate } from "../../lib/scenarioTemplates";
import { PROVIDER_MAP, getProviderDisplayName } from "../../lib/providers";
import { CHANNEL_MAP, getChannelDisplayName } from "../../lib/channels";
import { useT } from "../../lib/i18n";

export default function Complete() {
  const navigate = useNavigate();
  const t = useT();
  const { selectedModel, selectedChannels, selectedScenario } =
    useOnboardingStore();
  const language = useSettingsStore((s) => s.language);
  const { setOnboarded } = useAppStore();

  const scenarioTemplate = selectedScenario
    ? getLocalizedScenarioTemplate(selectedScenario, language)
    : undefined;
  const scenarioDisplayName = scenarioTemplate?.name;

  const handleStart = async () => {
    await markStepCompleted("complete");
    setOnboarded(true);
    navigate("/");
  };

  const summary = [
    {
      label: t("onboarding.summaryModel"),
      value: PROVIDER_MAP[selectedModel]
        ? getProviderDisplayName(PROVIDER_MAP[selectedModel], language)
        : selectedModel,
    },
    {
      label: t("onboarding.summaryChannel"),
      value:
        selectedChannels.map((c) => CHANNEL_MAP[c] ? getChannelDisplayName(CHANNEL_MAP[c], language) : c).join(language.startsWith("zh") ? "、" : ", ") || t("onboarding.notSelected"),
    },
    {
      label: t("onboarding.summaryScenario"),
      value: scenarioDisplayName || selectedScenario || t("onboarding.notSelected"),
    },
  ];

  return (
    <div className="flex w-[560px] flex-col items-center gap-7 rounded-[20px] bg-[var(--bg-main)] p-12">
      {/* Celebration */}
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#27AE6018]">
        <CheckCircle2 size={40} className="text-[var(--success)]" />
      </div>
      <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
        {t("onboarding.completeTitle")}
      </h1>
      <p className="text-[15px] text-[var(--text-secondary)]">
        {t("onboarding.completeDesc")}
      </p>

      {/* Summary */}
      <div className="flex w-full flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]">
        {summary.map((item, i) => (
          <div
            key={item.label}
            className={`flex items-center justify-between px-5 py-3 ${
              i < summary.length - 1 ? "border-b border-[var(--border)]" : ""
            }`}
          >
            <span className="text-sm text-[var(--text-secondary)]">
              {item.label}
            </span>
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {item.value}
            </span>
          </div>
        ))}
      </div>

      {/* CTA Button */}
      <button
        onClick={handleStart}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--primary)] text-base font-medium text-[var(--text-white)] transition-colors hover:bg-[var(--secondary)]"
      >
        <Rocket size={18} />
        {t("onboarding.startUsing")}
      </button>

      <StepIndicator
        currentStep={5}
        totalSteps={5}
        completedSteps={[1, 2, 3, 4, 5]}
      />
    </div>
  );
}
