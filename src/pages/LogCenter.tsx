import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Search, Download, Pause, Play, RefreshCw, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import Header from "../components/layout/Header";
import { readGatewayLogs, readAppLogs, type LogEntry } from "../lib/tauri";
import { useT } from "../lib/i18n";

type LogLevel = "ALL" | "DEBUG" | "INFO" | "WARN" | "ERROR";
type LogTab = "gateway" | "app";

const ALL_SOURCES = "ALL";

const gatewayLevels: LogLevel[] = ["ALL", "INFO", "WARN", "ERROR"];
const appLevels: LogLevel[] = ["ALL", "DEBUG", "INFO", "WARN", "ERROR"];

const gatewaySourceFilterKeys = [ALL_SOURCES, "gateway", "agent", "skill", "cron"];
const appSourceFilterKeys = [ALL_SOURCES];

const levelColors: Record<string, string> = {
  INFO: "#5DADE2",
  WARN: "#F1C40F",
  ERROR: "#E74C3C",
  DEBUG: "#95A5A6",
};

/** Colors for level filter buttons — matches design spec */
const levelButtonStyles: Record<
  LogLevel,
  { active: string; inactive: string }
> = {
  ALL: {
    active:
      "border-[var(--primary)] bg-[#EBF5FB] text-[var(--primary)] font-medium",
    inactive:
      "border-[var(--border)] bg-[var(--bg-main)] text-[var(--text-secondary)]",
  },
  DEBUG: {
    active: "border-[#95A5A6] bg-[#F2F3F4] text-[#95A5A6] font-medium",
    inactive:
      "border-[var(--border)] bg-[var(--bg-main)] text-[var(--text-secondary)]",
  },
  INFO: {
    active: "border-[#5DADE2] bg-[#EBF5FB] text-[#5DADE2] font-medium",
    inactive:
      "border-[var(--border)] bg-[var(--bg-main)] text-[var(--text-secondary)]",
  },
  WARN: {
    active: "border-[#F1C40F] bg-[#FEF9E7] text-[#F1C40F] font-medium",
    inactive:
      "border-[var(--border)] bg-[var(--bg-main)] text-[var(--warning)]",
  },
  ERROR: {
    active: "border-[#E74C3C] bg-[#FDEDEC] text-[#E74C3C] font-medium",
    inactive:
      "border-[var(--border)] bg-[var(--bg-main)] text-[var(--danger)]",
  },
};

export default function LogCenter() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<LogTab>("gateway");
  const [gatewayLogs, setGatewayLogs] = useState<LogEntry[]>([]);
  const [appLogs, setAppLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLevel, setActiveLevel] = useState<LogLevel>("ALL");
  const [activeSource, setActiveSource] = useState(ALL_SOURCES);
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clearAfters, setClearAfters] = useState<Record<LogTab, string | null>>({ gateway: null, app: null });
  const [searchMatchIndex, setSearchMatchIndex] = useState(-1);
  const logRef = useRef<HTMLDivElement>(null);

  const logs = activeTab === "gateway" ? gatewayLogs : appLogs;
  const levels = activeTab === "gateway" ? gatewayLevels : appLevels;
  const sourceKeys =
    activeTab === "gateway" ? gatewaySourceFilterKeys : appSourceFilterKeys;

  const loadLogs = useCallback(async () => {
    try {
      const [gw, app] = await Promise.all([
        readGatewayLogs(300).catch(() => []),
        readAppLogs(300).catch(() => []),
      ]);
      setGatewayLogs(gw);
      setAppLogs(app);
    } catch (e) {
      console.warn("loadLogs failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
    const timer = setInterval(loadLogs, 5000);
    return () => clearInterval(timer);
  }, [loadLogs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadLogs();
    // Keep spinning for at least 600ms so the animation is visible
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleClear = () => {
    // Record the latest log timestamp as the clear-after boundary;
    // subsequent polls will keep fetching but display filters out older entries.
    // Use `||` (not `??`) because timestamp may be empty string.
    const latest = (logs.length > 0 && logs[logs.length - 1].timestamp) || new Date().toISOString();
    setClearAfters((prev) => ({ ...prev, [activeTab]: latest }));
  };

  const handleExport = async () => {
    if (filtered.length === 0) return;
    const text = filtered
      .map(
        (l) =>
          `${l.timestamp} ${l.level.padEnd(5)} [${l.source}] ${l.message}`,
      )
      .join("\n");
    try {
      const filePath = await save({
        defaultPath: `clawz-${activeTab}-logs-${new Date().toISOString().slice(0, 10)}.log`,
        filters: [{ name: "Log files", extensions: ["log", "txt"] }],
      });
      if (filePath) {
        await writeTextFile(filePath, text);
      }
    } catch (e) {
      console.warn("exportLogs: Tauri save failed, falling back to blob:", e);
      // Fall back to blob download
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clawz-${activeTab}-logs-${new Date().toISOString().slice(0, 10)}.log`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const clearAfter = clearAfters[activeTab];
  const filtered = useMemo(() => {
    const queryLower = searchQuery.toLowerCase();
    return logs.filter((log) => {
      if (clearAfter && log.timestamp <= clearAfter) return false;
      if (activeLevel !== "ALL" && log.level !== activeLevel) return false;
      if (
        activeSource !== ALL_SOURCES &&
        log.source.toLowerCase() !== activeSource.toLowerCase()
      )
        return false;
      if (
        searchQuery &&
        !log.message.toLowerCase().includes(queryLower)
      )
        return false;
      return true;
    });
  }, [logs, clearAfter, activeLevel, activeSource, searchQuery]);

  // Derive a fingerprint from the last log timestamp so scroll triggers
  // even when log count stays the same (e.g. 300 → 300 after poll).
  const lastTs = filtered.length > 0 ? filtered[filtered.length - 1].timestamp : "";

  useEffect(() => {
    if (autoScroll && logRef.current) {
      requestAnimationFrame(() => {
        if (logRef.current) {
          logRef.current.scrollTop = logRef.current.scrollHeight;
        }
      });
    }
  }, [lastTs, activeTab, autoScroll]);

  /** Highlight search query matches in a log message */
  const highlightMatch = (text: string): React.ReactNode => {
    if (!searchQuery) return text;
    const idx = text.toLowerCase().indexOf(searchQuery.toLowerCase());
    if (idx === -1) return text;
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + searchQuery.length);
    const after = text.slice(idx + searchQuery.length);
    return (
      <>
        {before}
        <mark className="rounded-sm bg-[#F1C40F40] text-inherit">{match}</mark>
        {typeof after === "string" && after.toLowerCase().includes(searchQuery.toLowerCase())
          ? highlightMatch(after)
          : after}
      </>
    );
  };

  const formatTime = (ts: string) => {
    if (!ts) return "";
    // Show YYYY-MM-DD HH:MM:SS
    const match = ts.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    return match ? `${match[1]} ${match[2]}` : ts.slice(0, 19);
  };

  // Reset search match navigation when query or filtered results change
  const matchCount = filtered.length;
  useEffect(() => {
    setSearchMatchIndex(-1);
  }, [searchQuery]);

  const scrollToMatch = useCallback((index: number) => {
    if (!logRef.current || index < 0) return;
    const row = logRef.current.querySelector(`[data-log-index="${index}"]`);
    if (row) {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, []);

  const handleSearchPrev = () => {
    if (matchCount === 0) return;
    setAutoScroll(false);
    const next = searchMatchIndex <= 0 ? matchCount - 1 : searchMatchIndex - 1;
    setSearchMatchIndex(next);
    scrollToMatch(next);
  };

  const handleSearchNext = () => {
    if (matchCount === 0) return;
    setAutoScroll(false);
    const next = searchMatchIndex >= matchCount - 1 ? 0 : searchMatchIndex + 1;
    setSearchMatchIndex(next);
    scrollToMatch(next);
  };

  const handleTabChange = (tab: LogTab) => {
    setActiveTab(tab);
    setActiveSource(ALL_SOURCES);
    setActiveLevel("ALL");
    setSearchMatchIndex(-1);
  };

  /** Return the display label for a source filter key */
  const sourceLabel = (key: string) =>
    key === ALL_SOURCES ? t("log.allSources") : key;

  return (
    <div className="flex h-full flex-col">
      <Header title={t("log.title")} />

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
        {/* Tab Row */}
        <div className="flex items-center gap-6 border-b border-[var(--border)]">
          {(
            [
              { key: "gateway", labelKey: "log.gatewayLogs" },
              { key: "app", labelKey: "log.appLogs" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={`pb-2.5 text-[13px] transition-colors ${
                activeTab === tab.key
                  ? "border-b-2 border-[var(--primary)] font-medium text-[var(--primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {/* Filter Row — level + source */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {levels.map((lv) => {
              const styles = levelButtonStyles[lv];
              return (
                <button
                  key={lv}
                  onClick={() => setActiveLevel(lv)}
                  className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                    activeLevel === lv ? styles.active : styles.inactive
                  }`}
                >
                  {lv}
                </button>
              );
            })}
          </div>

          {sourceKeys.length > 1 && (
            <>
              <div className="h-5 w-px bg-[var(--border)]" />
              <div className="flex gap-1">
                {sourceKeys.map((src) => (
                  <button
                    key={src}
                    onClick={() => setActiveSource(src)}
                    className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                      activeSource === src
                        ? "border-[var(--primary)] bg-[#EBF5FB] text-[var(--primary)]"
                        : "border-[var(--border)] bg-[var(--bg-main)] text-[var(--text-secondary)] hover:border-[var(--primary-light)]"
                    }`}
                  >
                    {sourceLabel(src)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Action Row — search + controls */}
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 py-2">
            <Search size={14} className="shrink-0 text-[var(--text-secondary)]" />
            <input
              type="text"
              placeholder={t("log.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (!searchQuery) return;
                if (e.key === "Enter") {
                  e.shiftKey ? handleSearchPrev() : handleSearchNext();
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
            />
            {searchQuery && (
              <>
                <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                  {matchCount > 0 && searchMatchIndex >= 0
                    ? `${searchMatchIndex + 1} / ${matchCount}`
                    : matchCount > 0
                      ? matchCount.toString()
                      : t("log.noMatch")}
                </span>
                <div className="flex shrink-0 items-center">
                  <button
                    onClick={handleSearchPrev}
                    disabled={matchCount === 0}
                    className="rounded p-0.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-30"
                    title={t("log.prevMatch")}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={handleSearchNext}
                    disabled={matchCount === 0}
                    className="rounded p-0.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-30"
                    title={t("log.nextMatch")}
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
              </>
            )}
          </div>

          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              autoScroll
                ? "border-[var(--primary)] bg-[#EBF5FB] text-[var(--primary)]"
                : "border-[var(--border)] bg-[var(--bg-main)] text-[var(--text-secondary)]"
            }`}
            title={autoScroll ? t("log.pauseScroll") : t("log.resumeScroll")}
          >
            {autoScroll ? <Pause size={14} /> : <Play size={14} />}
          </button>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--primary-light)] hover:text-[var(--primary)]"
          >
            <RefreshCw
              size={14}
              className={refreshing ? "animate-spin" : ""}
            />
            {t("common.refresh")}
          </button>

          <button
            onClick={handleClear}
            disabled={filtered.length === 0}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-40"
          >
            <Trash2 size={14} />
            {t("log.clear")}
          </button>

          <button
            onClick={handleExport}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--primary-light)] hover:text-[var(--primary)]"
          >
            <Download size={14} />
            {t("log.export")}
          </button>
        </div>

        {/* Log count */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">
            {activeLevel === "ALL" && activeSource === ALL_SOURCES && !searchQuery
              ? t("log.totalLogs", { total: logs.length })
              : t("log.filteredLogs", { filtered: filtered.length, total: logs.length })}
            {loading && ` (${t("common.loading")})`}
          </span>
        </div>

        {/* Log Stream */}
        <div
          ref={logRef}
          className="flex-1 overflow-auto rounded-[10px] bg-[#1A2332] p-4 font-mono text-xs leading-relaxed"
        >
          {filtered.map((log, i) => (
            <div
              key={i}
              data-log-index={i}
              className={`flex gap-2.5 py-1.5 ${
                log.level === "ERROR" ? "rounded bg-[#E74C3C15] px-2" : ""
              } ${searchQuery && i === searchMatchIndex ? "rounded bg-[#F1C40F20] ring-1 ring-[#F1C40F60]" : ""}`}
            >
              <span className="w-[145px] shrink-0 text-[#566573]">
                {formatTime(log.timestamp)}
              </span>
              <span
                style={{ color: levelColors[log.level] || "#ECF0F1" }}
                className="w-12 shrink-0"
              >
                {log.level.padEnd(5)}
              </span>
              <span className="w-20 shrink-0 text-[#95A5A6]">
                [{log.source}]
              </span>
              <span
                style={{
                  color:
                    log.level === "ERROR"
                      ? "#E74C3C"
                      : log.level === "WARN"
                        ? "#F1C40F"
                        : "#ECF0F1",
                }}
              >
                {highlightMatch(log.message)}
              </span>
            </div>
          ))}

          {filtered.length === 0 && !loading && (
            <div className="flex h-full items-center justify-center">
              <span className="text-[#566573]">
                {logs.length === 0 ? t("log.noLogs") : t("log.noMatch")}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
