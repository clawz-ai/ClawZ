interface Tab {
  key: string;
  label: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeKey: string;
  onChange: (key: string) => void;
  className?: string;
}

export default function TabBar({
  tabs,
  activeKey,
  onChange,
  className = "",
}: TabBarProps) {
  return (
    <div
      className={`inline-flex gap-1 rounded-[10px] bg-[var(--bg-surface)] p-1 ${className}`}
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`rounded-lg px-4 py-1.5 text-[13px] transition-colors ${
            activeKey === tab.key
              ? "bg-[var(--bg-card)] font-medium text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
