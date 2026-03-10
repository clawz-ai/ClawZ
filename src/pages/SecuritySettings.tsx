import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import Header from "../components/layout/Header";
import Button from "../components/ui/Button";
import {
  getGatewayStatus,
  readOpenClawConfig,
  type StatusData,
} from "../lib/tauri";
import { useT } from "../lib/i18n";
import { useAppStore } from "../stores/appStore";

export default function SecuritySettings() {
  const t = useT();
  const cachedStatus = useAppStore((s) => s.status);
  const cachedConfig = useAppStore((s) => s.config);
  const storeSetStatus = useAppStore((s) => s.setStatus);
  const storeSetConfig = useAppStore((s) => s.setConfig);

  const [status, setStatus] = useState<StatusData | null>(cachedStatus);
  const [config, setConfig] = useState<Record<string, unknown> | null>(cachedConfig);
  const [loading, setLoading] = useState(cachedStatus === null && cachedConfig === null);

  const loadData = async () => {
    // Config is instant — fire independently
    readOpenClawConfig()
      .then((cfg) => {
        setConfig(cfg);
        storeSetConfig(cfg);
      })
      .catch(() => {});
    try {
      const statusData = await getGatewayStatus();
      setStatus(statusData);
      storeSetStatus(statusData);
    } catch (e) {
      console.warn("loadData failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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
    <div className="flex h-full flex-col">
      <Header title={t("settings.tabSecurity")} />

      <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
        <div className="flex justify-end">
          <Button variant="secondary" icon={RefreshCw} onClick={loadData}>
            {t("common.refresh")}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--text-secondary)]">
            {t("common.loading")}
          </div>
        ) : (
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
                    item.enabled
                      ? "bg-[var(--primary)]"
                      : "bg-[var(--border)]"
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
                    {status.security.critical} {t("settings.critical")}
                  </span>
                  <span className="text-[var(--warning)]">
                    {status.security.warnings} {t("settings.warnings")}
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {status.security.info} {t("settings.info")}
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
        )}
      </div>
    </div>
  );
}
