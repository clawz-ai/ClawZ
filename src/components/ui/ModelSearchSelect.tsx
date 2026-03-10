import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, X, ChevronDown, CheckCircle2 } from "lucide-react";
import { useT } from "../../lib/i18n";

export interface ModelOption {
  key: string;
  name: string;
  provider?: string;
  contextWindow?: number;
}

interface Props {
  models: ModelOption[];
  value: string;
  onChange: (key: string) => void;
  /** Text shown when value is empty */
  placeholder?: string;
  /** Show "Custom Model" option at the bottom */
  allowCustom?: boolean;
  className?: string;
}

export function ModelSearchSelect({
  models,
  value,
  onChange,
  placeholder,
  allowCustom,
  className = "",
}: Props) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownMaxH = 300; // search bar (~48) + max-h-60 (240) + padding
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openAbove = spaceBelow < dropdownMaxH && spaceAbove > spaceBelow;
    setDropdownStyle({
      position: "fixed",
      left: rect.left,
      width: rect.width,
      zIndex: 50,
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + 4, maxHeight: spaceAbove }
        : { top: rect.bottom + 4, maxHeight: spaceBelow }),
    });
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.key.toLowerCase().includes(q),
    );
  }, [models, search]);

  // Group by provider when provider info is available
  const hasProviders = models.some((m) => m.provider);
  const grouped = useMemo(() => {
    if (!hasProviders) return null;
    const map = new Map<string, ModelOption[]>();
    for (const m of filtered) {
      const p = m.provider || "";
      const list = map.get(p) || [];
      list.push(m);
      map.set(p, list);
    }
    return map;
  }, [filtered, hasProviders]);

  // Determine display text for trigger button
  const selected = models.find((m) => m.key === value);
  const isCustom = allowCustom && value && !selected;
  const displayText = selected
    ? selected.name
    : isCustom
      ? t("onboarding.customModel")
      : placeholder || t("model.selectModel");

  const handleSelect = (key: string) => {
    onChange(key);
    setIsOpen(false);
    setSearch("");
  };

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, updatePosition]);

  const renderItem = (m: ModelOption) => (
    <button
      key={m.key}
      onClick={() => handleSelect(m.key)}
      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        m.key === value
          ? "bg-[#EBF5FB] text-[var(--primary)]"
          : "text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
      }`}
    >
      <div className="flex flex-col">
        <span className="font-medium">{m.name}</span>
        {m.name !== m.key && (
          <span className="text-xs text-[var(--text-secondary)]">{m.key}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {m.contextWindow != null && m.contextWindow > 0 && (
          <span className="text-[10px] text-[var(--text-secondary)]">
            {(m.contextWindow / 1000).toFixed(0)}K
          </span>
        )}
        {m.key === value && (
          <CheckCircle2 size={14} className="text-[var(--primary)]" />
        )}
      </div>
    </button>
  );

  const dropdown = isOpen ? createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={() => {
          setIsOpen(false);
          setSearch("");
        }}
      />
      <div
        style={dropdownStyle}
        className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-main)] shadow-lg"
      >
        {/* Search input */}
        <div className="border-b border-[var(--border)] px-3 py-2">
          <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-surface)] px-2.5 py-1.5">
            <Search
              size={14}
              className="shrink-0 text-[var(--text-secondary)]"
            />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("model.searchPlaceholder")}
              className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  inputRef.current?.focus();
                }}
              >
                <X size={12} className="text-[var(--text-secondary)]" />
              </button>
            )}
          </div>
        </div>

        {/* Model list */}
        <div className="min-h-0 flex-1 overflow-auto p-1">
          {grouped
            ? [...grouped.entries()].map(([provider, items]) => (
                <div key={provider}>
                  {provider && (
                    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                      {provider}
                    </div>
                  )}
                  {items.map(renderItem)}
                </div>
              ))
            : filtered.map(renderItem)}

          {/* Custom model option */}
          {allowCustom && !search && (
            <button
              onClick={() => handleSelect("__custom__")}
              className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                isCustom
                  ? "bg-[#EBF5FB] text-[var(--primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
              }`}
            >
              {t("onboarding.customModel")}
            </button>
          )}

          {filtered.length === 0 && !allowCustom && (
            <div className="px-3 py-4 text-center text-sm text-[var(--text-secondary)]">
              {search
                ? t("model.noMatchingModels")
                : t("model.noProviders")}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  ) : null;

  return (
    <div className={className}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          setSearch("");
        }}
        className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] outline-none hover:bg-[var(--bg-main)] focus:border-[var(--primary)]"
      >
        <span
          className={
            selected ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
          }
        >
          {displayText}
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 text-[var(--text-secondary)]"
        />
      </button>

      {dropdown}
    </div>
  );
}
