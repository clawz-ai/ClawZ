import { useEffect, useCallback, useState } from "react";
import { useNavigate } from "react-router";
import {
  Bot,
  Link2,
  Coins,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Square,
  Play,
  Sparkles,
  Stethoscope,
  ScrollText,
  Loader2,
} from "lucide-react";
import Header from "../components/layout/Header";
import StatusIndicator from "../components/ui/StatusIndicator";
import { useAppStore } from "../stores/appStore";
import { useSettingsStore } from "../stores/settingsStore";
import { getGatewayStatus, startGateway, stopGateway, runDoctor, computeUsageStats, listAgents, readOpenClawConfig } from "../lib/tauri";
import { useT } from "../lib/i18n";

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: React.ReactNode;
  iconBg: string;
  onClick?: () => void;
  active?: boolean;
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--border)] ${className}`}
    />
  );
}

function StatCard({ icon, label, value, sub, iconBg, onClick, active, loading }: StatCardProps & { loading?: boolean }) {
  return (
    <div
      onClick={onClick}
      className={`flex flex-1 flex-col gap-3 rounded-xl border bg-[var(--bg-main)] p-5 ${
        active
          ? "border-[var(--danger)]"
          : "border-[var(--border)]"
      } ${onClick ? "cursor-pointer transition-shadow hover:shadow-md" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-[var(--text-secondary)]">{label}</span>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: iconBg }}
        >
          {icon}
        </div>
      </div>
      {loading ? (
        <>
          <Skeleton className="h-9 w-12" />
          <Skeleton className="h-3 w-24" />
        </>
      ) : (
        <>
          <span className="text-3xl font-bold text-[var(--text-primary)]">
            {value}
          </span>
          <span className="text-xs text-[var(--text-secondary)]">
            {sub}
          </span>
        </>
      )}
    </div>
  );
}

/** Format token count — consistent with CostDashboard.formatNumber */
function formatTokenCount(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

/** Parse backend uptime like "3d12h", "5h30m", "10m" into localized string */
function formatUptime(raw: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!raw) return "";
  const d = raw.match(/(\d+)d/);
  const h = raw.match(/(\d+)h/);
  const m = raw.match(/(\d+)m/);
  const parts: string[] = [];
  if (d) parts.push(t("time.days", { n: d[1] }));
  if (h) parts.push(t("time.hours", { n: h[1] }));
  if (m) parts.push(t("time.minutes", { n: m[1] }));
  return parts.join(" ") || raw;
}

interface QuickActionProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  desc: string;
  onClick?: () => void;
}

function QuickAction({ icon, iconBg, title, desc, onClick }: QuickActionProps) {
  return (
    <div
      onClick={onClick}
      className="flex flex-1 cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] px-5 py-4 transition-shadow hover:shadow-md"
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]"
        style={{ backgroundColor: iconBg }}
      >
        {icon}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {title}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">{desc}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const t = useT();
  const status = useAppStore((s) => s.status);
  const statusStale = useAppStore((s) => s.statusStale);
  const setStatus = useAppStore((s) => s.setStatus);
  const setAgents = useAppStore((s) => s.setAgents);
  const setConfig = useAppStore((s) => s.setConfig);
  const currency = useSettingsStore((s) => s.currency);
  const exchangeRate = useSettingsStore((s) => s.exchangeRate);
  const loadCurrencySettings = useSettingsStore((s) => s.loadCurrencySettings);
  const costMultiplier = currency === "CNY" ? exchangeRate : 1;
  const costSymbol = currency === "CNY" ? "¥" : "$";
  const [toggling, setToggling] = useState(false);
  const [doctorOutput, setDoctorOutput] = useState<string | null>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [showFindings, setShowFindings] = useState(false);
  const [todayCost, setTodayCost] = useState<number | null>(null);
  const [costChange, setCostChange] = useState<number | null>(null);
  const [todayTokens, setTodayTokens] = useState<number | null>(null);
  const [tokenChange, setTokenChange] = useState<number | null>(null);
  const [showCost, setShowCost] = useState(false);

  const handleRunDoctor = async () => {
    setDoctorLoading(true);
    setDoctorOutput(null);
    try {
      const output = await runDoctor();
      setDoctorOutput(output);
    } catch (e) {
      setDoctorOutput(t("dashboard.doctorFailed", { error: String(e) }));
    } finally {
      setDoctorLoading(false);
    }
  };

  // Fire independent requests — each updates the store as soon as it resolves.
  // Fast calls (config read) land first; slow CLI calls fill in later.
  const refreshStatus = useCallback(() => {
    // 1. Config (instant — pure file read)
    readOpenClawConfig()
      .then((cfg) => { if (cfg) setConfig(cfg); })
      .catch(() => {});
    // 2. Agent list (~0.9s)
    listAgents()
      .then((agents) => setAgents(agents))
      .catch(() => {});
    // 3. Gateway status (~2.5s — the slowest)
    getGatewayStatus()
      .then((data) => setStatus(data))
      .catch((e) => console.warn("refreshStatus failed:", e));
  }, [setStatus, setAgents, setConfig]);

  useEffect(() => {
    refreshStatus();
    const timer = setInterval(refreshStatus, 10000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    loadCurrencySettings();
    computeUsageStats()
      .then((stats) => {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const todayData = stats.daily.find((d) => d.date === today);
        const cost = todayData?.estimatedCost ?? 0;
        const tokens = todayData?.totalTokens ?? 0;
        setTodayCost(cost);
        setTodayTokens(tokens);

        // Compare with yesterday
        const yd = new Date(now);
        yd.setDate(yd.getDate() - 1);
        const yesterday = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, "0")}-${String(yd.getDate()).padStart(2, "0")}`;
        const yesterdayData = stats.daily.find((d) => d.date === yesterday);
        if (yesterdayData && yesterdayData.estimatedCost > 0) {
          setCostChange(
            ((cost - yesterdayData.estimatedCost) / yesterdayData.estimatedCost) * 100,
          );
        } else {
          setCostChange(null);
        }
        if (yesterdayData && yesterdayData.totalTokens > 0) {
          setTokenChange(
            ((tokens - yesterdayData.totalTokens) / yesterdayData.totalTokens) * 100,
          );
        } else {
          setTokenChange(null);
        }
      })
      .catch(() => {
        setTodayCost(0);
        setTodayTokens(0);
      });
  }, []);

  const handleToggleGateway = async () => {
    setToggling(true);
    try {
      if (status?.gateway.running) {
        await stopGateway();
      } else {
        await startGateway();
      }
      // Wait for gateway to settle, then poll until state changes
      await new Promise((r) => setTimeout(r, 2000));
      await refreshStatus();
    } catch (e) {
      console.error("Gateway operation failed:", e);
    } finally {
      setToggling(false);
    }
  };

  const running = status?.gateway.running ?? false;
  const modelName = status?.model.name || status?.model.id || t("common.notConfigured");
  const uptimeRaw = status?.gateway.uptime || "";
  const uptime = formatUptime(uptimeRaw, t);
  const agentCount = status?.agents.count ?? 0;
  const agentSub = status?.agents.list.length
    ? status.agents.list.join(", ")
    : t("dashboard.noAgent");
  const channelCount = status?.channels.enabled.length ?? 0;
  const channelSub = status?.channels.enabled.length
    ? status.channels.enabled.join(", ")
    : t("dashboard.noChannel");
  const securityIssues =
    (status?.security.critical ?? 0) + (status?.security.warnings ?? 0);
  const securitySub = status
    ? t("dashboard.securitySub", { critical: status.security.critical, warnings: status.security.warnings })
    : t("common.unknown");

  return (
    <div className="flex h-full flex-col">
      <Header title={t("dashboard.title")} />

      <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
        {/* Status Bar */}
        <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-main)] px-5 py-3.5">
          <div className="flex items-center gap-4">
            {!status ? (
              <>
                <Skeleton className="h-4 w-32" />
                <div className="h-4 w-px bg-[var(--border)]" />
                <Skeleton className="h-4 w-24" />
                <div className="h-4 w-px bg-[var(--border)]" />
                <Skeleton className="h-4 w-20" />
              </>
            ) : (
              <>{statusStale && <Loader2 size={14} className="animate-spin text-[var(--text-secondary)]" />}
                <StatusIndicator
                  status={running ? "success" : "idle"}
                  label={running ? t("dashboard.gatewayRunning") : t("dashboard.gatewayStopped")}
                />
                <div className="h-4 w-px bg-[var(--border)]" />
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {modelName}
                </span>
                <div className="h-4 w-px bg-[var(--border)]" />
                <span className="text-[13px] text-[var(--text-secondary)]">
                  {running ? t("dashboard.apiOk") : t("dashboard.apiDisconnected")}
                </span>
                {uptime && (
                  <>
                    <div className="h-4 w-px bg-[var(--border)]" />
                    <span className="text-[13px] text-[var(--text-secondary)]">
                      {t("dashboard.uptime", { time: uptime })}
                    </span>
                  </>
                )}
              </>
            )}
          </div>
          {(() => {
            const ToggleIcon = toggling ? Loader2 : running ? Square : Play;
            const ringColor = toggling ? "var(--border)" : running ? "#E74C3C" : "#27AE60";
            const textColor = toggling ? "var(--text-primary)" : running ? "#E74C3C" : "#27AE60";
            return (
              <button
                onClick={handleToggleGateway}
                disabled={toggling || !status}
                style={{
                  boxShadow: `inset 0 0 0 1px ${ringColor}`,
                  color: textColor,
                  backgroundColor: "transparent",
                }}
                className={`appearance-none inline-flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-shadow ${
                  toggling || !status ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:shadow-md"
                }`}
              >
                <ToggleIcon size={16} className={toggling ? "animate-spin" : ""} />
                {toggling
                  ? running
                    ? t("dashboard.stopping")
                    : t("dashboard.starting")
                  : running
                    ? t("dashboard.stopService")
                    : t("dashboard.startService")}
              </button>
            );
          })()}
        </div>

        {/* Stats Cards */}
        <div className="flex gap-4">
          <StatCard
            icon={<Bot size={16} className="text-[var(--primary)]" />}
            iconBg="#EBF5FB"
            label="Agent"
            value={String(agentCount)}
            sub={agentSub}
            loading={!status}
          />
          <StatCard
            icon={<Link2 size={16} className="text-[var(--success)]" />}
            iconBg="#E8F8F5"
            label={t("dashboard.channels")}
            value={String(channelCount)}
            sub={channelSub}
            loading={!status}
          />
          <StatCard
            icon={<Coins size={16} className="text-[var(--warning)]" />}
            iconBg="#FEF5E7"
            label={showCost ? t("dashboard.todayCost") : t("dashboard.todayToken")}
            value={
              showCost
                ? todayCost !== null ? `${costSymbol}${(todayCost * costMultiplier).toFixed(2)}` : ""
                : todayTokens !== null ? formatTokenCount(todayTokens) : ""
            }
            sub={(() => {
              const change = showCost ? costChange : tokenChange;
              return change !== null ? (
                <span className={`flex items-center gap-1 ${change >= 0 ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>
                  {change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {change >= 0 ? "+" : ""}{change.toFixed(0)}% {t("dashboard.vsYesterday")}
                </span>
              ) : (
                t("dashboard.noComparison")
              );
            })()}
            onClick={() => setShowCost((v) => !v)}
            loading={todayCost === null}
          />
          <StatCard
            icon={
              <ShieldCheck size={16} className="text-[var(--danger)]" />
            }
            iconBg="#FDEDEC"
            label={t("dashboard.security")}
            value={String(securityIssues)}
            sub={securitySub}
            onClick={
              status?.security.findings.length
                ? () => setShowFindings((v) => !v)
                : undefined
            }
            active={showFindings}
            loading={!status}
          />
        </div>

        {/* Security Findings */}
        {showFindings && status?.security.findings.length ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t("dashboard.securityDetail")}
              </span>
              <button
                onClick={() => setShowFindings(false)}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {t("common.close")}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {status.security.findings.map((finding, i) => {
                const isCritical = finding.startsWith("[critical]") || finding.startsWith("[CRITICAL]");
                const isWarn = finding.startsWith("[warn]") || finding.startsWith("[WARN]");
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-2.5 rounded-lg px-3.5 py-2.5 ${
                      isCritical
                        ? "bg-[#FDEDEC]"
                        : isWarn
                          ? "bg-[#FEF5E7]"
                          : "bg-[var(--bg-surface)]"
                    }`}
                  >
                    <div
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        isCritical
                          ? "bg-[var(--danger)]"
                          : isWarn
                            ? "bg-[var(--warning)]"
                            : "bg-[var(--text-secondary)]"
                      }`}
                    />
                    <span className="text-[13px] text-[var(--text-primary)]">
                      {finding}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Quick Actions */}
        <div className="flex gap-4">
          <QuickAction
            icon={<Sparkles size={18} className="text-[var(--primary)]" />}
            iconBg="#EBF5FB"
            title={t("dashboard.explore")}
            desc={t("dashboard.exploreDesc")}
            onClick={() => navigate("/workshop")}
          />
          <QuickAction
            icon={
              doctorLoading ? (
                <Loader2 size={18} className="animate-spin text-[var(--success)]" />
              ) : (
                <Stethoscope size={18} className="text-[var(--success)]" />
              )
            }
            iconBg="#E8F8F5"
            title={doctorLoading ? t("dashboard.doctorRunning") : t("dashboard.doctorRun")}
            desc={t("dashboard.doctorDesc")}
            onClick={doctorLoading ? undefined : handleRunDoctor}
          />
          <QuickAction
            icon={<ScrollText size={18} className="text-[var(--warning)]" />}
            iconBg="#FEF5E7"
            title={t("dashboard.viewLogs")}
            desc={t("dashboard.viewLogsDesc")}
            onClick={() => navigate("/logs")}
          />
        </div>

        {/* Doctor Output */}
        {doctorOutput !== null && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t("dashboard.doctorResult")}
              </span>
              <button
                onClick={() => setDoctorOutput(null)}
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {t("common.close")}
              </button>
            </div>
            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--bg-surface)] p-4 font-mono text-xs text-[var(--text-primary)]">
              {doctorOutput}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
