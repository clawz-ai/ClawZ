interface StepIndicatorProps {
  totalSteps?: number;
  currentStep: number;
  completedSteps?: number[];
}

export default function StepIndicator({
  totalSteps = 7,
  currentStep,
  completedSteps = [],
}: StepIndicatorProps) {
  return (
    <div className="flex items-center">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isCompleted = completedSteps.includes(step);
        const isLast = step === totalSteps;

        return (
          <div key={step} className="flex items-center">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                isActive || isCompleted
                  ? "bg-[var(--primary)] text-[var(--text-white)]"
                  : "bg-[var(--bg-surface)] text-[var(--text-secondary)]"
              }`}
            >
              {isCompleted && !isActive ? "\u2713" : step}
            </div>
            {!isLast && (
              <div
                className={`mx-1 h-0.5 w-10 ${
                  isCompleted
                    ? "bg-[var(--primary)]"
                    : "bg-[var(--border)]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
