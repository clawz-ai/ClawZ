import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Sun, Moon, Monitor, CheckCircle2, AlertTriangle, Loader2, Download, Upload, Globe, Info, ExternalLink } from "lucide-react";
import Header from "../components/layout/Header";
import { useSettingsStore, type CurrencyUnit } from "../stores/settingsStore";
import { VERSION_DISPLAY, BUILD_HASH } from "../lib/buildInfo";
import { useAppStore } from "../stores/appStore";
import {
  readOpenClawConfig,
  getGatewayStatus,
  uninstallOpenClaw,
  exportConfig,
  precheckBackup,
  importConfig,
  scheduleGatewayRestart,
  setConfigValue,
  getTrustedSources,
  setTrustedSources,
  type StatusData,
  type BackupPrecheck,
} from "../lib/tauri";
import { save, open } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";

import { resetOnboardingProgress } from "../lib/onboardingProgress";
import { useT } from "../lib/i18n";
import logoFull from "../assets/logo-full.png";

const AVAILABLE_LANGUAGES: { key: string; native: string; english: string; region: string }[] = [
  { key: "zh-CN", native: "简体中文", english: "Chinese (Simplified)", region: "CN" },
  { key: "en-US", native: "English", english: "English", region: "US" },
  // To add a new language: add an entry here + create src/lib/i18n/{locale}.ts + register in src/lib/i18n/index.ts
];

function LanguageTab() {
  const t = useT();
  const { language, setLanguage } = useSettingsStore();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--text-secondary)]">
        {t("settings.languageHint")}
      </p>
      <div className="flex flex-col gap-2">
        {AVAILABLE_LANGUAGES.map((lang) => {
          const active = language === lang.key;
          return (
            <button
              key={lang.key}
              onClick={() => setLanguage(lang.key as import("../lib/i18n").Locale)}
              className={`flex items-center gap-4 rounded-xl border px-5 py-4 text-left transition-colors ${
                active
                  ? "border-[var(--primary)] bg-[#EBF5FB]"
                  : "border-[var(--border)] bg-[var(--bg-main)] hover:border-[var(--primary-light)]"
              }`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg-surface)]">
                <Globe size={18} className={active ? "text-[var(--primary)]" : "text-[var(--text-secondary)]"} />
              </div>
              <div className="flex flex-1 flex-col">
                <span className={`text-sm font-medium ${active ? "text-[var(--primary)]" : "text-[var(--text-primary)]"}`}>
                  {lang.native}
                </span>
                <span className="text-xs text-[var(--text-secondary)]">
                  {lang.english}
                </span>
              </div>
              {active && <CheckCircle2 size={16} className="text-[var(--primary)]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AppearanceTab() {
  const t = useT();
  const { theme, setTheme } = useSettingsStore();

  const themes = [
    { key: "light" as const, labelKey: "settings.themeLight", icon: Sun },
    { key: "dark" as const, labelKey: "settings.themeDark", icon: Moon },
    { key: "system" as const, labelKey: "settings.themeSystem", icon: Monitor },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {t("settings.theme")}
        </span>
        <div className="flex gap-3">
          {themes.map((item) => (
            <button
              key={item.key}
              onClick={() => setTheme(item.key)}
              className={`flex flex-1 flex-col items-center gap-2 rounded-xl border p-4 transition-colors ${
                theme === item.key
                  ? "border-[var(--primary)] bg-[#EBF5FB]"
                  : "border-[var(--border)] bg-[var(--bg-main)] hover:border-[var(--primary-light)]"
              }`}
            >
              <item.icon
                size={20}
                className={
                  theme === item.key
                    ? "text-[var(--primary)]"
                    : "text-[var(--text-secondary)]"
                }
              />
              <span
                className={`text-xs font-medium ${
                  theme === item.key
                    ? "text-[var(--primary)]"
                    : "text-[var(--text-primary)]"
                }`}
              >
                {t(item.labelKey)}
              </span>
              {theme === item.key && (
                <CheckCircle2 size={14} className="text-[var(--primary)]" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AboutTab({ config }: { config: Record<string, unknown> | null }) {
  const t = useT();
  const navigate = useNavigate();
  const { setOnboarded } = useAppStore();
  const meta = (config?.meta ?? {}) as Record<string, unknown>;
  const version = (meta.lastTouchedVersion as string) ?? t("common.unknown");

  const [removeData, setRemoveData] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const canUninstall = confirmText === "UNINSTALL";

  const handleUninstall = async () => {
    if (!canUninstall) return;
    setUninstalling(true);
    try {
      await uninstallOpenClaw(removeData);
      await resetOnboardingProgress();
      // Clear all local caches so reinstall starts fresh
      localStorage.removeItem("clawz_status_cache");
      await useSettingsStore.getState().resetSettings();
      setOnboarded(false);
      navigate("/onboarding", { replace: true });
    } catch (e) {
      console.warn("Uninstall failed:", e);
      alert(`${t("settings.uninstallFailed")} ${e}`);
    } finally {
      setUninstalling(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] py-8">
        <img src={logoFull} alt="ClawZ" className="h-28" />
        <span className="text-sm text-[var(--text-secondary)]">
          {t("settings.aboutSlogan")}
        </span>
        <span className="text-xs text-[var(--text-secondary)]">{VERSION_DISPLAY}</span>
      </div>
      <div className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--bg-main)]">
        {[
          { label: t("settings.framework"), value: "Tauri 2.0" },
          { label: t("settings.openclawVersion"), value: version },
          { label: "Build", value: BUILD_HASH },
          { label: t("settings.license"), value: "MIT" },
        ].map((item, i, arr) => (
          <div
            key={i}
            className={`flex items-center justify-between px-5 py-3 ${
              i < arr.length - 1 ? "border-b border-[var(--border)]" : ""
            }`}
          >
            <span className="text-sm text-[var(--text-secondary)]">
              {item.label}
            </span>
            <span className="text-sm text-[var(--text-primary)]">
              {item.value}
            </span>
          </div>
        ))}
      </div>

      {/* Danger Zone */}
      <div className="flex flex-col gap-4 rounded-xl border border-[var(--danger)] bg-[var(--bg-main)] p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-[var(--danger)]" />
          <span className="text-sm font-semibold text-[var(--danger)]">
            {t("settings.dangerZone")}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {t("settings.uninstall")}
          </span>
          <span className="text-xs text-[var(--text-secondary)]">
            {t("settings.uninstallDesc")}
          </span>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-[var(--bg-surface)] px-3 py-2">
          <Info size={13} className="mt-0.5 shrink-0 text-[var(--text-secondary)]" />
          <span className="text-xs text-[var(--text-secondary)]">
            {t("settings.uninstallBackupNote")}
          </span>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={removeData}
            onChange={(e) => setRemoveData(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)] accent-[var(--danger)]"
          />
          <span className="text-sm text-[var(--text-primary)]">
            {t("settings.removeData")}
          </span>
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-[var(--text-secondary)]">
            {t("settings.confirmUninstall")} <span className="font-mono font-semibold text-[var(--danger)]">UNINSTALL</span> {t("settings.confirmUninstallSuffix")}
          </span>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="UNINSTALL"
            className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--danger)]"
          />
        </div>

        <button
          onClick={handleUninstall}
          disabled={!canUninstall || uninstalling}
          className={`flex w-fit items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors ${
            canUninstall && !uninstalling
              ? "bg-[var(--danger)] hover:opacity-90"
              : "cursor-not-allowed bg-[var(--border)]"
          }`}
        >
          {uninstalling ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("settings.uninstalling")}
            </>
          ) : (
            t("settings.uninstall")
          )}
        </button>
      </div>
    </div>
  );
}

function SecurityTab({
  config,
  status,
}: {
  config: Record<string, unknown> | null;
  status: StatusData | null;
}) {
  const t = useT();
  const gatewayConfig = (config?.gateway ?? {}) as Record<string, unknown>;
  const bind = (gatewayConfig.bind as string) ?? "";
  const localOnly = bind === "loopback" || gatewayConfig.localOnly === true;
  const authConfig = (gatewayConfig.auth ?? {}) as Record<string, unknown>;
  const hasAuth = authConfig.mode === "token" && !!authConfig.token;

  const items = [
    {
      label: t("settings.bindAddress"),
      value: localOnly ? t("settings.localOnly") : t("settings.public"),
      desc: localOnly ? t("settings.bindDescLocal") : t("settings.bindDescPublic"),
      enabled: localOnly,
    },
    {
      label: t("settings.auth"),
      value: hasAuth ? t("settings.authEnabled") : t("settings.authNotSet"),
      desc: hasAuth ? t("settings.authDescEnabled") : t("settings.authDescNotSet"),
      enabled: hasAuth,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-main)] px-5 py-4"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {item.label}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              {item.value}
            </span>
            <span className="mt-0.5 text-[11px] text-[var(--text-secondary)] opacity-70">
              {item.desc}
            </span>
          </div>
          <div
            className={`flex h-6 w-11 items-center rounded-full px-0.5 ${
              item.enabled ? "bg-[var(--primary)]" : "bg-[var(--border)]"
            }`}
          >
            <div
              className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                item.enabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </div>
        </div>
      ))}

      {status && status.security.findings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t("settings.securityAudit")}
          </span>
          <div className="flex gap-3 text-xs">
            <span className="text-[var(--danger)]">
              {status.security.critical} {t("dashboard.critical")}
            </span>
            <span className="text-[var(--warning)]">
              {status.security.warnings} {t("dashboard.warnings")}
            </span>
            <span className="text-[var(--text-secondary)]">
              {status.security.info} Info
            </span>
          </div>
          <div className="mt-1 flex flex-col gap-1">
            {status.security.findings.map((f, i) => (
              <span
                key={i}
                className={`text-xs ${
                  f.startsWith("[critical]")
                    ? "text-[var(--danger)]"
                    : f.startsWith("[warning]")
                      ? "text-[var(--warning)]"
                      : "text-[var(--text-secondary)]"
                }`}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CurrencyTab() {
  const t = useT();
  const { currency, setCurrency, exchangeRate, setExchangeRate } =
    useSettingsStore();
  const [rateInput, setRateInput] = useState(exchangeRate.toString());

  const units: { key: CurrencyUnit; labelKey: string; symbol: string }[] = [
    { key: "CNY", labelKey: "settings.currencyCNY", symbol: "¥" },
    { key: "USD", labelKey: "settings.currencyUSD", symbol: "$" },
  ];

  const handleRateChange = (val: string) => {
    setRateInput(val);
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      setExchangeRate(num);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {t("settings.currencyUnit")}
        </span>
        <div className="flex gap-3">
          {units.map((u) => (
            <button
              key={u.key}
              onClick={() => setCurrency(u.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm transition-colors ${
                currency === u.key
                  ? "border-[var(--primary)] bg-[#EBF5FB] font-medium text-[var(--primary)]"
                  : "border-[var(--border)] bg-[var(--bg-main)] text-[var(--text-secondary)] hover:border-[var(--primary-light)]"
              }`}
            >
              <span className="text-base">{u.symbol}</span>
              {t(u.labelKey)}
              {currency === u.key && (
                <CheckCircle2 size={14} className="text-[var(--primary)]" />
              )}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          {t("settings.currencyHint")}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {t("settings.exchangeRate")}
        </span>
        <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] px-5 py-4">
          <span className="text-sm text-[var(--text-secondary)]">1 USD =</span>
          <input
            type="text"
            inputMode="decimal"
            value={rateInput}
            onChange={(e) => handleRateChange(e.target.value)}
            className="w-24 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-center text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">CNY</span>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          {t("settings.exchangeHint")}
        </p>
      </div>
    </div>
  );
}

function BackupTab() {
  const t = useT();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<{ path: string; info: BackupPrecheck } | null>(null);

  const handleExport = async () => {
    setMessage(null);
    const destPath = await save({
      title: t("settings.backupBtn"),
      defaultPath: `clawz-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: "ClawZ Backup", extensions: ["zip"] }],
    });
    if (!destPath) return;
    setExporting(true);
    try {
      const path = await exportConfig(destPath);
      setMessage({ type: "success", text: t("settings.backupSuccess", { path }) });
    } catch (e) {
      setMessage({ type: "error", text: t("settings.backupFailed", { error: String(e) }) });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    setMessage(null);
    setPendingImport(null);
    const srcPath = await open({
      title: t("settings.restoreBtn"),
      filters: [{ name: "ClawZ Backup", extensions: ["zip"] }],
      multiple: false,
      directory: false,
    });
    if (!srcPath) return;
    try {
      const info = await precheckBackup(srcPath);
      if (info.backupVersion && info.localVersion && info.backupVersion > info.localVersion) {
        setPendingImport({ path: srcPath, info });
        return;
      }
      await doImport(srcPath);
    } catch (e) {
      setMessage({ type: "error", text: t("settings.restoreFailed", { error: String(e) }) });
    }
  };

  const doImport = async (srcPath: string) => {
    setImporting(true);
    setPendingImport(null);
    try {
      await importConfig(srcPath);
      scheduleGatewayRestart();
      setMessage({ type: "success", text: t("settings.restoreSuccess") });
    } catch (e) {
      setMessage({ type: "error", text: t("settings.restoreFailed", { error: String(e) }) });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Export */}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
        <div className="flex items-center gap-2">
          <Download size={16} className="text-[var(--primary)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t("settings.backupTitle")}
          </span>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          {t("settings.backupDesc")}
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          {t("settings.backupIncludes")}
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex w-fit items-center gap-2 rounded-lg bg-[var(--primary)] px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {exporting ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("settings.exporting")}
            </>
          ) : (
            <>
              <Download size={14} />
              {t("settings.backupBtn")}
            </>
          )}
        </button>
      </div>

      {/* Import */}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
        <div className="flex items-center gap-2">
          <Upload size={16} className="text-[var(--primary)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t("settings.restoreTitle")}
          </span>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          {t("settings.restoreDesc")}
        </p>
        <p className="text-xs text-[var(--warning)]">
          {t("settings.restoreWarn")}
        </p>
        <button
          onClick={handleImport}
          disabled={importing}
          className="flex w-fit items-center gap-2 rounded-lg border border-[var(--primary)] px-5 py-2 text-sm font-medium text-[var(--primary)] transition-opacity hover:bg-[#EBF5FB] disabled:opacity-50"
        >
          {importing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("settings.importing")}
            </>
          ) : (
            <>
              <Upload size={14} />
              {t("settings.restoreBtn")}
            </>
          )}
        </button>
      </div>

      {/* Version Compatibility Warning */}
      {pendingImport && (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--warning)] bg-[var(--bg-main)] p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-[var(--warning)]" />
            <span className="text-sm font-semibold text-[var(--warning)]">
              {t("settings.versionMismatch")}
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            {t("settings.versionMismatchDesc", {
              backupVer: pendingImport.info.backupVersion,
              localVer: pendingImport.info.localVersion,
            })}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => doImport(pendingImport.path)}
              disabled={importing}
              className="flex items-center gap-2 rounded-lg bg-[var(--warning)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {importing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t("settings.importing")}
                </>
              ) : (
                t("settings.importAnyway")
              )}
            </button>
            <button
              onClick={() => setPendingImport(null)}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-[var(--success)]/10 text-[var(--success)]"
              : "bg-[var(--danger)]/10 text-[var(--danger)]"
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}

function InfoTip({ text, anchor = "top" }: { text: string; anchor?: "top" | "bottom" }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const handle = () => setOpen(false);
    document.addEventListener("click", handle);
    return () => document.removeEventListener("click", handle);
  }, [open]);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="ml-1 inline-flex cursor-pointer text-[var(--text-secondary)] hover:text-[var(--primary)] transition-colors"
      >
        <Info size={14} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute left-6 z-50 w-72 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-xs leading-relaxed text-[var(--text-secondary)] shadow-lg ${
            anchor === "bottom" ? "bottom-0" : "top-0"
          }`}
        >
          {text.split("\n").map((line, i) => (
            <p key={i} className={i > 0 ? "mt-1.5" : ""}>{line}</p>
          ))}
        </div>
      )}
    </span>
  );
}

function AdvancedTab({ config, onConfigRefresh }: { config: Record<string, unknown> | null; onConfigRefresh: () => Promise<void> }) {
  const t = useT();
  const agentsDefaults = ((config?.agents ?? {}) as Record<string, unknown>).defaults as Record<string, unknown> | undefined;
  const subagentsDefaults = (agentsDefaults?.subagents ?? {}) as Record<string, unknown>;
  const compactionDefaults = (agentsDefaults?.compaction ?? {}) as Record<string, unknown>;
  const toolsConfig = (config?.tools ?? {}) as Record<string, unknown>;
  const sessionConfig = (config?.session ?? {}) as Record<string, unknown>;
  const messagesConfig = (config?.messages ?? {}) as Record<string, unknown>;

  const initMaxConcurrent = String(agentsDefaults?.maxConcurrent ?? "");
  const initSubMaxConcurrent = String(subagentsDefaults?.maxConcurrent ?? "");
  const initCompaction = String(compactionDefaults?.mode ?? "default");
  const initToolsProfile = String(toolsConfig?.profile ?? "full");
  const initDmScope = String(sessionConfig?.dmScope ?? "per-channel-peer");
  const initAckReaction = String(messagesConfig?.ackReactionScope ?? "group-mentions");

  const [maxConcurrent, setMaxConcurrent] = useState(initMaxConcurrent);
  const [subMaxConcurrent, setSubMaxConcurrent] = useState(initSubMaxConcurrent);
  const [compaction, setCompaction] = useState(initCompaction);
  const [toolsProfile, setToolsProfile] = useState(initToolsProfile);
  const [dmScope, setDmScope] = useState(initDmScope);
  const [ackReaction, setAckReaction] = useState(initAckReaction);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Skill sources (merged from SkillSourcesTab)
  const [trustedSources, setTrustedSourcesState] = useState<Set<string>>(new Set(["bundled"]));
  const [skillSourcesLoaded, setSkillSourcesLoaded] = useState(false);

  useEffect(() => {
    getTrustedSources()
      .then((sources) => setTrustedSourcesState(new Set(sources)))
      .catch(() => {})
      .finally(() => setSkillSourcesLoaded(true));
  }, []);

  const toggleSource = async (source: string) => {
    setTrustedSourcesState((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        if (next.size <= 1) return prev;
        next.delete(source);
      } else {
        next.add(source);
      }
      setTrustedSources([...next]).catch(() => {});
      return next;
    });
  };

  const skillSources = [
    { key: "bundled", labelKey: "settings.skillSourceBundled", hintKey: "settings.skillSourceBundledHint" },
    { key: "managed", labelKey: "settings.skillSourceManaged", hintKey: "settings.skillSourceManagedHint" },
    { key: "workspace", labelKey: "settings.skillSourceWorkspace", hintKey: "settings.skillSourceWorkspaceHint" },
  ];

  const handleSaveAll = async () => {
    setSaving(true);
    setMessage(null);
    try {
      // Only save fields that differ from the config snapshot
      const entries: [string, string][] = [];
      if (maxConcurrent && maxConcurrent !== initMaxConcurrent) entries.push(["agents.defaults.maxConcurrent", maxConcurrent]);
      if (subMaxConcurrent && subMaxConcurrent !== initSubMaxConcurrent) entries.push(["agents.defaults.subagents.maxConcurrent", subMaxConcurrent]);
      if (compaction !== initCompaction) entries.push(["agents.defaults.compaction.mode", compaction]);
      if (toolsProfile !== initToolsProfile) entries.push(["tools.profile", toolsProfile]);
      if (dmScope !== initDmScope) entries.push(["session.dmScope", dmScope]);
      if (ackReaction !== initAckReaction) entries.push(["messages.ackReactionScope", ackReaction]);

      if (entries.length === 0) {
        setMessage({ type: "success", text: t("settings.advancedNoChanges") });
        setSaving(false);
        return;
      }

      for (const [path, value] of entries) {
        await setConfigValue(path, value);
      }
      await onConfigRefresh();
      setMessage({ type: "success", text: t("settings.advancedSaved") });
    } catch (e) {
      setMessage({ type: "error", text: t("settings.advancedSaveFailed", { error: String(e) }) });
    } finally {
      setSaving(false);
    }
  };

  const selectClass = "w-full h-10 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)]";
  const inputClass = "w-24 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--primary)] text-center";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-secondary)]">
          {t("settings.advancedDesc")}
        </p>
        <button
          onClick={handleSaveAll}
          disabled={saving}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              {t("settings.advancedSaving")}
            </>
          ) : (
            t("settings.advancedSaveBtn")
          )}
        </button>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-[var(--success)]/10 text-[var(--success)]"
              : "bg-[var(--danger)]/10 text-[var(--danger)]"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Gateway Dashboard */}
      <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-main)] px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {t("settings.gatewayDashboard")}
          </span>
          <span className="text-xs text-[var(--text-secondary)]">
            {t("settings.gatewayDashboardHint")}
          </span>
        </div>
        <button
          onClick={() => {
            const gw = (config?.gateway ?? {}) as Record<string, unknown>;
            const port = gw.port ?? 18789;
            const auth = (gw.auth ?? {}) as Record<string, unknown>;
            const token = auth.token ?? "";
            const url = `http://127.0.0.1:${port}/#token=${token}`;
            shellOpen(url).catch(() => window.open(url, "_blank"));
          }}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
        >
          <ExternalLink size={14} />
          {t("settings.openDashboard")}
        </button>
      </div>

      {/* Number inputs */}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {t("settings.maxConcurrent")}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              {t("settings.maxConcurrentHint")}
            </span>
          </div>
          <input
            type="number"
            min={1}
            max={50}
            value={maxConcurrent}
            onChange={(e) => setMaxConcurrent(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="border-t border-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {t("settings.subagentMaxConcurrent")}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              {t("settings.subagentMaxConcurrentHint")}
            </span>
          </div>
          <input
            type="number"
            min={1}
            max={50}
            value={subMaxConcurrent}
            onChange={(e) => setSubMaxConcurrent(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Select inputs */}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {t("settings.compactionMode")}
            <InfoTip text={t("settings.compactionInfo")} />
          </span>
          <select
            value={compaction}
            onChange={(e) => setCompaction(e.target.value)}
            className={selectClass}
          >
            <option value="default">{t("settings.compactionDefault")}</option>
            <option value="safeguard">{t("settings.compactionSafeguard")}</option>
          </select>
        </div>

        <div className="border-t border-[var(--border)]" />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {t("settings.toolsProfile")}
            <InfoTip text={t("settings.toolsProfileInfo")} />
          </span>
          <div className="flex gap-2">
            {["minimal", "coding", "messaging", "full"].map((p) => (
              <button
                key={p}
                onClick={() => setToolsProfile(p)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  toolsProfile === p
                    ? "border-[var(--primary)] bg-[#EBF5FB] text-[var(--primary)]"
                    : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--primary-light)]"
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* DM & Ack */}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {t("settings.dmScope")}
            <InfoTip text={t("settings.dmScopeInfo")} />
          </span>
          <select
            value={dmScope}
            onChange={(e) => setDmScope(e.target.value)}
            className={selectClass}
          >
            <option value="main">{t("settings.dmScopeMain")}</option>
            <option value="per-peer">{t("settings.dmScopePerPeer")}</option>
            <option value="per-channel-peer">{t("settings.dmScopePerChannelPeer")}</option>
            <option value="per-account-channel-peer">{t("settings.dmScopePerAccountChannelPeer")}</option>
          </select>
        </div>

        <div className="border-t border-[var(--border)]" />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {t("settings.ackReactionScope")}
            <InfoTip text={t("settings.ackReactionInfo")} anchor="bottom" />
          </span>
          <select
            value={ackReaction}
            onChange={(e) => setAckReaction(e.target.value)}
            className={selectClass}
          >
            <option value="group-mentions">{t("settings.ackReactionGroupMentions")}</option>
            <option value="group-all">{t("settings.ackReactionGroupAll")}</option>
            <option value="direct">{t("settings.ackReactionDirect")}</option>
            <option value="all">{t("settings.ackReactionAll")}</option>
            <option value="off">{t("settings.ackReactionOff")}</option>
            <option value="none">{t("settings.ackReactionNone")}</option>
          </select>
        </div>
      </div>

      {/* Skill Sources */}
      {skillSourcesLoaded && (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
          <div className="flex flex-col gap-0.5 mb-1">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {t("settings.tabSkillSources")}
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">
              {t("settings.skillSourcesDesc")}
            </span>
          </div>
          {skillSources.map((src, i) => (
            <div key={src.key}>
              {i > 0 && <div className="mb-3 border-t border-[var(--border)]" />}
              <button
                onClick={() => toggleSource(src.key)}
                className="flex w-full items-center justify-between text-left"
              >
                <div className="flex flex-col gap-0.5">
                  <span className={`text-xs ${trustedSources.has(src.key) ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                    {t(src.labelKey)}
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)]">{t(src.hintKey)}</span>
                </div>
                <div
                  className={`flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                    trustedSources.has(src.key) ? "bg-[var(--primary)]" : "bg-[var(--border)]"
                  }`}
                >
                  <div
                    className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      trustedSources.has(src.key) ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </div>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const settingsTabs = [
  { key: "advanced", labelKey: "settings.tabAdvanced" },
  { key: "security", labelKey: "settings.tabSecurity" },
  { key: "currency", labelKey: "settings.tabCurrency" },
  { key: "language", labelKey: "settings.tabLanguage" },
  { key: "appearance", labelKey: "settings.tabAppearance" },
  { key: "backup", labelKey: "settings.tabBackup" },
  { key: "about", labelKey: "settings.tabAbout" },
];

export default function Settings() {
  const t = useT();
  const [activeTab, setActiveTab] = useState("advanced");
  const cachedStatus = useAppStore((s) => s.status);
  const cachedConfig = useAppStore((s) => s.config);
  const storeSetStatus = useAppStore((s) => s.setStatus);
  const storeSetConfig = useAppStore((s) => s.setConfig);
  const [config, setConfig] = useState<Record<string, unknown> | null>(cachedConfig);
  const [status, setStatus] = useState<StatusData | null>(cachedStatus);

  const { loadSettings } = useSettingsStore();

  useEffect(() => {
    Promise.all([
      readOpenClawConfig().catch(() => null),
      getGatewayStatus().catch(() => null),
      loadSettings(),
    ]).then(([cfg, sts]) => {
      if (cfg) { setConfig(cfg); storeSetConfig(cfg); }
      if (sts) { setStatus(sts); storeSetStatus(sts); }
    });
  }, [loadSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderContent = () => {
    switch (activeTab) {
      case "appearance":
        return <AppearanceTab />;
      case "language":
        return <LanguageTab />;
      case "currency":
        return <CurrencyTab />;
      case "security":
        return <SecurityTab config={config} status={status} />;
      case "advanced":
        return <AdvancedTab config={config} onConfigRefresh={async () => {
          const cfg = await readOpenClawConfig().catch(() => null);
          if (cfg) { setConfig(cfg); storeSetConfig(cfg); }
        }} />;
      case "backup":
        return <BackupTab />;
      case "about":
        return <AboutTab config={config} />;
      default:
        return null;
    }
  };

  const activeLabel = settingsTabs.find((tab) => tab.key === activeTab)?.labelKey ?? "";

  return (
    <div className="flex h-full flex-col">
      <Header title={t("settings.title")} />

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-[200px] flex-col gap-0.5 border-r border-[var(--border)] bg-[var(--bg-main)] px-3 py-5">
          {settingsTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-4 py-2.5 text-left text-[13px] transition-colors ${
                activeTab === tab.key
                  ? "bg-[#EBF5FB] font-medium text-[var(--primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
              }`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-auto px-8 py-6">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {t(activeLabel)}
          </h2>
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
