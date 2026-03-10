import type { LucideIcon } from "lucide-react";

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

export default function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
        active
          ? "bg-[var(--bg-sidebar-hover)] font-medium text-[var(--text-sidebar-active)]"
          : "text-[var(--text-sidebar)] hover:bg-[var(--bg-sidebar-hover)] hover:text-[var(--text-sidebar-active)]"
      }`}
    >
      {active && (
        <div className="absolute -left-4 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r bg-[var(--primary-light)]" />
      )}
      <Icon size={20} />
      <span>{label}</span>
    </button>
  );
}
