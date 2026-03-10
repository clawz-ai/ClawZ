interface ProgressBarProps {
  percent: number;
  className?: string;
}

export default function ProgressBar({
  percent,
  className = "",
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div
      className={`h-2 w-full overflow-hidden rounded bg-[var(--bg-surface)] ${className}`}
    >
      <div
        className="h-full rounded bg-[var(--primary)] transition-all duration-300"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
