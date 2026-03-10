type StatusType = "success" | "warning" | "danger" | "idle";

interface StatusIndicatorProps {
  status: StatusType;
  label: string;
  className?: string;
}

const colors: Record<StatusType, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  idle: "var(--text-secondary)",
};

export default function StatusIndicator({
  status,
  label,
  className = "",
}: StatusIndicatorProps) {
  const color = colors[status];

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <div
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs font-medium" style={{ color }}>
        {label}
      </span>
    </div>
  );
}
