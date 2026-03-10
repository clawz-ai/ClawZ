import { useNavigate } from "react-router";
import Button from "../../components/ui/Button";
import StepIndicator from "../../components/ui/StepIndicator";
import { markStepCompleted } from "../../lib/onboardingProgress";
import logoFull from "../../assets/logo-full.png";
import { useT } from "../../lib/i18n";

export default function Welcome() {
  const t = useT();
  const navigate = useNavigate();

  return (
    <div className="flex w-[560px] flex-col items-center gap-8 rounded-[20px] bg-[var(--bg-main)] px-14 py-12">
      {/* Logo Area */}
      <div className="flex flex-col items-center gap-4">
        <img src={logoFull} alt="ClawZ" className="h-40" />
        <p className="w-[400px] text-center text-base text-[var(--text-secondary)]">
          {t("onboarding.welcomeSlogan")}
        </p>
      </div>

      {/* Step Indicator */}
      <StepIndicator currentStep={1} totalSteps={5} />

      {/* Buttons */}
      <div className="flex w-full flex-col items-center gap-3">
        <Button
          className="w-full py-3 text-base"
          onClick={async () => {
            await markStepCompleted("welcome");
            navigate("/onboarding/model");
          }}
        >
          {t("onboarding.startSetup")}
        </Button>
      </div>
    </div>
  );
}
