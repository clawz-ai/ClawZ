import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  X,
  ExternalLink,
} from "lucide-react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import ProviderLogo from "../ui/ProviderLogo";
import { ModelSearchSelect } from "../ui/ModelSearchSelect";
import {
  validateApiKey,
  configureProvider,
  startOAuthFlow,
  cancelOAuthFlow,
  scheduleGatewayRestart,
} from "../../lib/tauri";
import { MODEL_PROVIDERS, getProviderDisplayName } from "../../lib/providers";
import { useT } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { isTauriEnv, extractErrorMessage } from "../../lib/env";
import type { OAuthProgress } from "../../types/provider";

function isNativeOAuth(providerId: string): boolean {
  return ["openai", "claude", "qwen", "minimax"].includes(providerId);
}

function isDeviceCodeOAuth(providerId: string): boolean {
  return ["qwen", "minimax"].includes(providerId);
}

function openUrl(url: string) {
  if (isTauriEnv()) {
    open(url).catch(() => window.open(url, "_blank"));
  } else {
    window.open(url, "_blank");
  }
}

type AuthTab = "api-key" | "oauth";

export default function AddProviderModal({
  onClose,
  onDone,
  configuredProviderIds,
}: {
  onClose: () => void;
  /** Called after provider is saved. `selectedModel` is the model key chosen in the modal (if any). */
  onDone: (selectedModel?: string) => void;
  configuredProviderIds: string[];
}) {
  const t = useT();
  const language = useSettingsStore((s) => s.language);

  // Build a set of MODEL_PROVIDERS ids that are already configured
  const configuredSet = new Set(
    configuredProviderIds.flatMap((cid) => {
      const byOc = MODEL_PROVIDERS.find((p) => p.ocProviderId === cid);
      const byOauth = MODEL_PROVIDERS.find((p) => p.oauthProviderId === cid);
      const byId = MODEL_PROVIDERS.find((p) => p.id === cid);
      return [byOc?.id, byOauth?.id, byId?.id].filter(Boolean) as string[];
    }),
  );

  // Sort: unconfigured first, configured last
  const sortedProviders = [...MODEL_PROVIDERS].sort((a, b) => {
    const ac = configuredSet.has(a.id) ? 1 : 0;
    const bc = configuredSet.has(b.id) ? 1 : 0;
    return ac - bc;
  });
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [authTab, setAuthTab] = useState<AuthTab>("api-key");
  const [apiKey, setApiKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [availModels, setAvailModels] = useState<string[]>([]);

  // Validation
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // OAuth
  const [oauthRunning, setOauthRunning] = useState(false);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [oauthCode, setOauthCode] = useState<string | null>(null);
  const [oauthSuccess, setOauthSuccess] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  const provider = MODEL_PROVIDERS.find((p) => p.id === selectedProvider);

  // Reset on provider change
  useEffect(() => {
    setValidated(false);
    setValidationError(null);
    setCustomBaseUrl("");
    setApiKey("");
    setOauthSuccess(false);
    setOauthError(null);
    setOauthUrl(null);
    setOauthCode(null);
    setAvailModels([]);
    setSelectedModelId("");
    if (provider?.authMethod === "oauth") {
      setAuthTab("oauth");
    } else {
      setAuthTab("api-key");
    }
  }, [selectedProvider, provider?.authMethod]);

  useEffect(() => {
    if (oauthUrl) openUrl(oauthUrl);
  }, [oauthUrl]);

  useEffect(() => {
    if (!oauthSuccess || !provider || availModels.length) return;
    if (provider.defaultModels?.length) {
      setAvailModels(provider.defaultModels);
      setSelectedModelId(provider.defaultModels[0]);
    }
  }, [oauthSuccess, provider, availModels.length]);

  const handleValidate = async () => {
    if (!provider || !apiKey) return;
    setValidating(true);
    setValidationError(null);
    try {
      const result = await validateApiKey(provider.id, apiKey, customBaseUrl || undefined);
      if (result.success) {
        setValidated(true);
        const models = result.models?.length ? result.models : provider.defaultModels || [];
        setAvailModels(models);
        if (models.length) setSelectedModelId(models[0]);
      } else {
        setValidationError(result.error || "Validation failed");
      }
    } catch (err) {
      setValidationError(extractErrorMessage(err));
    } finally {
      setValidating(false);
    }
  };

  const handleOAuth = async () => {
    if (!provider?.oauthProviderId) return;
    setOauthRunning(true);
    setOauthError(null);
    setOauthSuccess(false);

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<OAuthProgress>("oauth-progress", (event) => {
        const p = event.payload;
        if (p.status === "device_code") {
          setOauthUrl(p.verification_url || null);
          setOauthCode(p.user_code || null);
        } else if (p.status === "waiting") {
          setOauthUrl(p.verification_url || null);
        } else if (p.status === "success") {
          setOauthSuccess(true);
          setOauthRunning(false);
        } else if (p.status === "error") {
          setOauthError(p.error || "OAuth failed");
          setOauthRunning(false);
        }
      });

      await startOAuthFlow(provider.id);
      setOauthSuccess(true);
    } catch (err) {
      const msg = extractErrorMessage(err);
      if (!msg.startsWith("TERMINAL_REQUIRED:") && msg !== "User cancelled authentication") {
        setOauthError(msg);
      }
    } finally {
      setOauthRunning(false);
      unlisten?.();
    }
  };

  const handleCancelOAuth = async () => {
    try { await cancelOAuthFlow(); } catch { /* ignore */ }
    setOauthRunning(false);
    setOauthUrl(null);
    setOauthCode(null);
  };

  const providerReady = (authTab === "api-key" && validated) || (authTab === "oauth" && oauthSuccess);
  const isReady = providerReady && !!selectedModelId;

  const handleSave = async () => {
    if (!provider) return;
    setSaving(true);
    try {
      if (isTauriEnv()) {
        await configureProvider(
          provider.id,
          authTab === "api-key" ? apiKey : undefined,
          selectedModelId || undefined,
          authTab === "oauth" ? "oauth" : "api_key",
          authTab === "api-key" && customBaseUrl ? customBaseUrl : undefined,
          false,
        );
        scheduleGatewayRestart();
      }
      onDone(selectedModelId || undefined);
    } catch (e) {
      setValidationError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="flex max-h-[80vh] w-[720px] flex-col rounded-2xl bg-[var(--bg-main)] shadow-xl">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t("model.providerSetup")}
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              {t("model.providerSetupDesc")}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-[var(--bg-surface)]">
            <X size={18} />
          </button>
        </div>

        {/* Content: provider list + config */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: provider list */}
          <div className="w-52 shrink-0 overflow-y-auto border-r border-[var(--border)] p-2">
            {sortedProviders.map((m) => {
              const isConfigured = configuredSet.has(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedProvider(m.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                    selectedProvider === m.id
                      ? "bg-[#EBF5FB] ring-1 ring-[var(--primary)]"
                      : "hover:bg-[var(--bg-surface)]"
                  }`}
                >
                  <ProviderLogo provider={m} size={26} />
                  <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">{getProviderDisplayName(m, language)}</span>
                  {isConfigured && (
                    <span className="shrink-0 rounded bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                      {t("model.configured")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right: auth config */}
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
            {!provider ? (
              <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
                {t("onboarding.selectProvider")}
              </div>
            ) : (
              <>
                {/* Provider header */}
                <div className="flex items-center gap-3">
                  <ProviderLogo provider={provider} size={36} />
                  <div>
                    <div className="text-base font-semibold text-[var(--text-primary)]">{getProviderDisplayName(provider, language)}</div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {provider.authMethod === "api-key" && "API Key"}
                      {provider.authMethod === "oauth" && "OAuth"}
                      {provider.authMethod === "both" && "API Key / OAuth"}
                    </div>
                  </div>
                </div>

                {/* Auth tabs */}
                {provider.authMethod === "both" && (
                  <div className="flex gap-1 rounded-lg bg-[var(--bg-surface)] p-1">
                    <button
                      onClick={() => setAuthTab("api-key")}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        authTab === "api-key"
                          ? "bg-[var(--bg-main)] text-[var(--text-primary)] shadow-sm"
                          : "text-[var(--text-secondary)]"
                      }`}
                    >
                      API Key
                    </button>
                    <button
                      onClick={() => setAuthTab("oauth")}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        authTab === "oauth"
                          ? "bg-[var(--bg-main)] text-[var(--text-primary)] shadow-sm"
                          : "text-[var(--text-secondary)]"
                      }`}
                    >
                      {t("onboarding.oauthLogin")}
                    </button>
                  </div>
                )}

                {/* API Key flow */}
                {authTab === "api-key" && provider.authMethod !== "oauth" && (
                  <>
                    {provider.defaultBaseUrl && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-[var(--text-secondary)]">
                          {t("onboarding.apiUrlHint")}
                        </label>
                        <input
                          type="text"
                          value={customBaseUrl}
                          onChange={(e) => { setCustomBaseUrl(e.target.value); setValidated(false); setAvailModels([]); }}
                          placeholder={provider.defaultBaseUrl}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/40 outline-none focus:ring-1 focus:ring-[var(--primary)]"
                        />
                      </div>
                    )}
                    <Input
                      label="API Key"
                      placeholder={provider.apiKeyPlaceholder || "Enter API Key..."}
                      value={apiKey}
                      onChange={(v) => { setApiKey(v); setValidated(false); setAvailModels([]); }}
                      type="password"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleValidate}
                        disabled={!apiKey || validating}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                          validated
                            ? "bg-[#E8F8F5] text-[var(--success)]"
                            : "bg-[var(--primary)] text-white hover:bg-[var(--secondary)]"
                        } ${!apiKey || validating ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        {validating ? (
                          <><Loader2 size={14} className="animate-spin" /> {t("common.verifying")}</>
                        ) : validated ? (
                          <><CheckCircle2 size={14} /> {t("common.verified")}</>
                        ) : (
                          t("onboarding.validateKey")
                        )}
                      </button>
                      {provider.apiKeyHelpUrl && (
                        <button
                          onClick={() => openUrl(provider.apiKeyHelpUrl!)}
                          className="ml-auto flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                        >
                          {t("onboarding.getApiKey")}
                          <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                    {validationError && (
                      <div className="flex items-start gap-2 rounded-lg bg-[#FDEDEC] px-3 py-2 text-xs text-[var(--danger)]">
                        <XCircle size={14} className="mt-0.5 shrink-0" />
                        <span>{validationError}</span>
                      </div>
                    )}
                  </>
                )}

                {/* OAuth flow */}
                {authTab === "oauth" && provider.authMethod !== "api-key" && (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    {provider.oauthProviderId && isNativeOAuth(provider.id) && (
                      <>
                        {!oauthRunning && !oauthSuccess && !oauthError && (
                          <Button onClick={handleOAuth}>{t("onboarding.oauthLogin")}</Button>
                        )}
                        {oauthRunning && (
                          <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-[var(--border)] p-4">
                            {isDeviceCodeOAuth(provider.id) && oauthUrl && oauthCode && (
                              <>
                                <p className="text-sm text-[var(--text-primary)]">{t("onboarding.oauthBrowserCode")}</p>
                                <span className="rounded-lg bg-[var(--bg-surface)] px-6 py-3 font-mono text-2xl font-bold tracking-widest text-[var(--primary)]">
                                  {oauthCode}
                                </span>
                                <button onClick={() => openUrl(oauthUrl!)} className="flex items-center gap-1 text-sm text-[var(--primary)] hover:underline">
                                  {t("onboarding.oauthOpenPage")} <ExternalLink size={14} />
                                </button>
                              </>
                            )}
                            {!isDeviceCodeOAuth(provider.id) && (
                              <p className="text-sm text-[var(--text-primary)]">{t("onboarding.oauthBrowserAuth")}</p>
                            )}
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                                <Loader2 size={12} className="animate-spin" />
                                {t("onboarding.oauthWaiting")}
                              </div>
                              <button onClick={handleCancelOAuth} className="rounded-md px-3 py-1 text-xs font-medium text-[var(--danger)] hover:bg-[#FDEDEC]">
                                {t("common.cancel")}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {provider.oauthProviderId && !isNativeOAuth(provider.id) && (
                      <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-[var(--border)] p-4">
                        <p className="text-sm text-[var(--text-primary)]">{t("onboarding.oauthRecommendKey")}</p>
                        <Button variant="secondary" onClick={() => setAuthTab("api-key")}>{t("onboarding.switchToApiKey")}</Button>
                      </div>
                    )}
                    {oauthSuccess && (
                      <div className="flex items-center gap-2 text-sm text-[var(--success)]">
                        <CheckCircle2 size={18} /> {t("onboarding.oauthSuccess")}
                      </div>
                    )}
                    {oauthError && (
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex items-center gap-2 text-sm text-[var(--danger)]">
                          <XCircle size={18} /> {oauthError}
                        </div>
                        <Button variant="secondary" onClick={handleOAuth}>{t("common.retry")}</Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Model selection */}
                {providerReady && availModels.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-[var(--text-secondary)]">
                      {t("model.selectModel")}
                    </label>
                    <ModelSearchSelect
                      models={availModels.map((m) => ({ key: m, name: m }))}
                      value={selectedModelId}
                      onChange={(v) => setSelectedModelId(v === "__custom__" ? "" : v)}
                      placeholder={t("model.selectModel")}
                      allowCustom
                    />
                    {!availModels.includes(selectedModelId) && (
                      <input
                        type="text"
                        value={selectedModelId}
                        onChange={(e) => setSelectedModelId(e.target.value)}
                        placeholder={t("onboarding.inputModelHint")}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--primary)]"
                        autoFocus
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={handleSave} disabled={!isReady || saving}>
            {saving ? (
              <><Loader2 size={14} className="animate-spin" /> {t("common.savingConfig")}</>
            ) : (
              t("common.confirm")
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
