import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { RefreshCw, Coins, Hash, CalendarDays, MessageSquare } from "lucide-react";
import Header from "../components/layout/Header";
import { computeUsageStats } from "../lib/tauri";
import type { UsageStats, DailyUsage } from "../lib/tauri";
import { useSettingsStore } from "../stores/settingsStore";
import { useT } from "../lib/i18n";

type Period = "7d" | "30d" | "all";
type ChartMode = "tokens" | "cost";

function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function formatCost(n: number, symbol: string): string {
  if (n >= 1) return symbol + n.toFixed(2);
  if (n >= 0.01) return symbol + n.toFixed(3);
  if (n > 0) return symbol + n.toFixed(4);
  return symbol + "0.00";
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-1 items-center gap-3 rounded-xl bg-[var(--bg-card)] p-4 shadow-sm">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-light)]/10">
        <Icon size={20} className="text-[var(--primary)]" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[var(--text-secondary)]">{label}</p>
        <p className="text-lg font-semibold text-[var(--text-primary)]">{value}</p>
        {sub && <p className="text-[11px] text-[var(--text-tertiary)]">{sub}</p>}
      </div>
    </div>
  );
}

function BarChart({ data, mode, costMultiplier, costSymbol, noDataLabel }: { data: DailyUsage[]; mode: ChartMode; costMultiplier: number; costSymbol: string; noDataLabel: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgW, setSvgW] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSvgW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-[var(--text-secondary)]">
        {noDataLabel}
      </div>
    );
  }

  const maxVal = Math.max(
    ...data.map((d) => (mode === "tokens" ? d.totalTokens : d.estimatedCost * costMultiplier)),
    1,
  );
  const barWidth = Math.max(12, Math.min(40, 600 / data.length - 4));
  const axisW = 40;
  const barsGroupW = data.length * (barWidth + 4);
  const barsStartX = svgW > 0
    ? Math.max(axisW, axisW + (svgW - axisW - barsGroupW) / 2)
    : axisW;
  const chartH = 180;
  const padTop = 20;
  const padBottom = 28;
  const barArea = chartH - padTop - padBottom;

  return (
    <div ref={containerRef} className="overflow-x-auto">
      {svgW > 0 && (
        <svg width={svgW} height={chartH} className="block">
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const y = padTop + barArea * (1 - f);
            const label = mode === "tokens" ? formatNumber(maxVal * f) : formatCost(maxVal * f, costSymbol);
            return (
              <g key={f}>
                <line
                  x1={36}
                  x2={svgW}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth={0.5}
                  strokeDasharray={f === 0 ? "0" : "3,3"}
                />
                <text
                  x={34}
                  y={y + 3}
                  textAnchor="end"
                  fill="var(--text-tertiary)"
                  fontSize={9}
                >
                  {label}
                </text>
              </g>
            );
          })}
          {/* Bars */}
          {data.map((d, i) => {
            const val = mode === "tokens" ? d.totalTokens : d.estimatedCost * costMultiplier;
            const h = (val / maxVal) * barArea;
            const x = barsStartX + i * (barWidth + 4);
            const y = padTop + barArea - h;
            const dateLabel = d.date.slice(5); // MM-DD
            return (
              <g key={d.date}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(h, 1)}
                  rx={3}
                  fill="var(--primary)"
                  opacity={0.85}
                />
                <title>
                  {d.date}: {mode === "tokens" ? formatNumber(val) + " tokens" : formatCost(val, costSymbol)}
                </title>
                {data.length <= 31 && (
                  <text
                    x={x + barWidth / 2}
                    y={chartH - 6}
                    textAnchor="middle"
                    fill="var(--text-tertiary)"
                    fontSize={8}
                  >
                    {dateLabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function ModelTable({
  data,
  costMultiplier,
  costSymbol,
}: {
  data: UsageStats["byModel"];
  costMultiplier: number;
  costSymbol: string;
}) {
  if (data.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl bg-[var(--bg-card)] shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-secondary)]">
            <th className="px-4 py-2.5 font-medium">Provider</th>
            <th className="px-4 py-2.5 font-medium">Model</th>
            <th className="px-4 py-2.5 font-medium text-right">Messages</th>
            <th className="px-4 py-2.5 font-medium text-right">Tokens</th>
            <th className="px-4 py-2.5 font-medium text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {data.map((m) => (
            <tr
              key={`${m.provider}/${m.model}`}
              className="border-b border-[var(--border)] last:border-0"
            >
              <td className="px-4 py-2.5 text-[var(--text-secondary)]">{m.provider}</td>
              <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{m.model}</td>
              <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">
                {m.messageCount.toLocaleString()}
              </td>
              <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">
                {formatNumber(m.totalTokens)}
              </td>
              <td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)]">
                {formatCost(m.estimatedCost * costMultiplier, costSymbol)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-[var(--border)] ${className ?? ""}`}
    />
  );
}

export default function CostDashboard() {
  const t = useT();
  const { currency, exchangeRate, loadCurrencySettings } = useSettingsStore();
  const costMultiplier = currency === "CNY" ? exchangeRate : 1;
  const costSymbol = currency === "CNY" ? "¥" : "$";

  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("30d");
  const [chartMode, setChartMode] = useState<ChartMode>("tokens");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await computeUsageStats();
      setStats(data);
    } catch (e) {
      console.error("Failed to load usage stats:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCurrencySettings();
    load();
  }, [load, loadCurrencySettings]);

  const filteredDaily = useMemo(() => {
    if (!stats) return [];
    if (period === "all") return stats.daily;
    const days = period === "7d" ? 7 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    return stats.daily.filter((d) => d.date >= cutoffStr);
  }, [stats, period]);

  const periodStats = useMemo(() => {
    if (filteredDaily.length === 0)
      return { tokens: 0, cost: 0, messages: 0, days: 0 };
    return {
      tokens: filteredDaily.reduce((s, d) => s + d.totalTokens, 0),
      cost: filteredDaily.reduce((s, d) => s + d.estimatedCost, 0),
      messages: filteredDaily.reduce((s, d) => s + d.messageCount, 0),
      days: filteredDaily.length,
    };
  }, [filteredDaily]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setTimeout(() => setRefreshing(false), 600);
  };

  const periods: { key: Period; label: string }[] = [
    { key: "7d", label: t("cost.7d") },
    { key: "30d", label: t("cost.30d") },
    { key: "all", label: t("cost.all") },
  ];

  return (
    <div className="flex h-full flex-col">
      <Header title={t("cost.title")} />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Controls */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex gap-1 rounded-lg bg-[var(--bg-card)] p-1 shadow-sm">
            {periods.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  period === p.key
                    ? "bg-[var(--primary)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--primary-light)] hover:text-[var(--primary)]"
          >
            <RefreshCw
              size={14}
              className={refreshing ? "animate-spin" : ""}
            />
            {t("common.refresh")}
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-20 flex-1" />
              ))}
            </div>
            <Skeleton className="h-52" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="mb-5 flex gap-4">
              <StatCard
                icon={Hash}
                label={t("cost.totalTokens")}
                value={formatNumber(periodStats.tokens)}
                sub={t("cost.inputOutput", { input: formatNumber(filteredDaily.reduce((s, d) => s + d.inputTokens, 0)), output: formatNumber(filteredDaily.reduce((s, d) => s + d.outputTokens, 0)) })}
              />
              <StatCard
                icon={Coins}
                label={t("cost.estimatedCost")}
                value={formatCost(periodStats.cost * costMultiplier, costSymbol)}
              />
              <StatCard
                icon={CalendarDays}
                label={t("cost.activeDays")}
                value={periodStats.days.toString()}
              />
              <StatCard
                icon={MessageSquare}
                label={t("cost.messages")}
                value={periodStats.messages.toLocaleString()}
              />
            </div>

            {/* Chart */}
            <div className="mb-5 rounded-xl bg-[var(--bg-card)] p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  {t("cost.dailyUsage")}
                </h3>
                <div className="flex gap-1">
                  {(["tokens", "cost"] as ChartMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setChartMode(m)}
                      className={`rounded-md border px-3 py-1 text-xs transition-colors ${
                        chartMode === m
                          ? "border-[var(--primary)] bg-[#EBF5FB] font-medium text-[var(--primary)]"
                          : "border-[var(--border)] bg-[var(--bg-main)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {m === "tokens" ? "Tokens" : t("cost.costLabel")}
                    </button>
                  ))}
                </div>
              </div>
              <BarChart data={filteredDaily} mode={chartMode} costMultiplier={costMultiplier} costSymbol={costSymbol} noDataLabel={t("cost.noData")} />
            </div>

            {/* Model breakdown */}
            {stats && stats.byModel.length > 0 && (
              <div className="mb-5">
                <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                  {t("cost.modelBreakdown")}
                </h3>
                <ModelTable data={stats.byModel} costMultiplier={costMultiplier} costSymbol={costSymbol} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
