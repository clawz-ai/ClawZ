import type { LucideIcon } from "lucide-react";

interface ButtonProps {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
  icon?: LucideIcon;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  children,
  onClick,
  disabled,
  className = "",
  style,
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-lg font-medium transition-colors";

  const sizes = {
    sm: "gap-1.5 px-3 py-1.5 text-[13px]",
    md: "gap-2 px-6 py-2.5 text-sm",
  };

  const variants = {
    primary: disabled
      ? "bg-[var(--primary)] text-[var(--text-white)] opacity-50 cursor-not-allowed"
      : "bg-[var(--primary)] text-[var(--text-white)] hover:bg-[var(--secondary)]",
    secondary: disabled
      ? "border border-[var(--border)] bg-transparent text-[var(--text-primary)] cursor-not-allowed opacity-50"
      : "border border-[var(--border)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-surface)]",
    danger: disabled
      ? "border border-[var(--danger)]/30 bg-transparent text-[var(--danger)] cursor-not-allowed opacity-50"
      : "border border-[var(--danger)]/30 bg-transparent text-[var(--danger)] hover:bg-[var(--danger)]/10",
  };

  const iconSize = size === "sm" ? 14 : 16;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      style={style}
    >
      {Icon && <Icon size={iconSize} />}
      {children}
    </button>
  );
}
