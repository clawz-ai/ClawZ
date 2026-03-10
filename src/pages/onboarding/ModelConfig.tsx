import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import {
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import StepIndicator from "../../components/ui/StepIndicator";
import { ModelSearchSelect } from "../../components/ui/ModelSearchSelect";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { MODEL_PROVIDERS, getProviderDisplayName } from "../../lib/providers";
import {
  validateApiKey,
  configureProvider,
  startOAuthFlow,
  cancelOAuthFlow,
  scheduleGatewayRestart,
  listSelectableModels,
} from "../../lib/tauri";
import { isTauriEnv, extractErrorMessage } from "../../lib/env";
import {
  markStepCompleted,
  saveOnboardingData,
} from "../../lib/onboardingProgress";
import type { OAuthProgress } from "../../types/provider";
import ProviderLogo from "../../components/ui/ProviderLogo";
import { useT } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";

type AuthTab = "api-key" | "oauth";

function openUrl(url: string) {
  if (isTauriEnv()) {
    open(url).catch(() => window.open(url, "_blank"));
  } else {
    window.open(url, "_blank");
  }
}

/** Whether this provider supports native in-app OAuth */
function isNativeOAuth(providerId: string): boolean {
  return ["openai", "claude", "qwen", "minimax"].includes(providerId);
}

/** Whether the OAuth flow uses device code (show code to user) vs PKCE (browser redirect) */
function isDeviceCodeOAuth(providerId: string): boolean {
  return ["qwen", "minimax"].includes(providerId);
}


export default function ModelConfig() {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const navigate = useNavigate();
  const {
    selectedModel,
    selectedModelId,
    apiKey,
    setModel,
    setModelId,
    setApiKey,
  } = useOnboardingStore();

  const [authTab, setAuthTab] = useState<AuthTab>("api-key");
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");

  // OAuth state
  const [oauthRunning, setOauthRunning] = useState(false);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [oauthCode, setOauthCode] = useState<string | null>(null);
  const [oauthSuccess, setOauthSuccess] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  // Model selection
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const provider = MODEL_PROVIDERS.find((p) => p.id === selectedModel);

  // Reset state when provider changes
  useEffect(() => {
    setValidated(false);
    setValidationError(null);
    setCustomBaseUrl("");

    setOauthSuccess(false);
    setOauthError(null);
    setOauthUrl(null);
    setOauthCode(null);
    setAvailableModels([]);
    setModelId("");
    if (provider?.authMethod === "oauth") {
      setAuthTab("oauth");
    } else {
      setAuthTab("api-key");
    }
  }, [selectedModel, provider?.authMethod, setModelId]);

  // Auto-open browser when OAuth verification URL is received
  useEffect(() => {
    if (oauthUrl) {
      openUrl(oauthUrl);
    }
  }, [oauthUrl]);

  // Populate model list after OAuth success — try CLI catalog first, fall back to defaults
  useEffect(() => {
    if (!oauthSuccess || !provider || availableModels.length) return;
    (async () => {
      let models: string[] = [];
      if (isTauriEnv()) {
        try {
          const selectable = await listSelectableModels();
          const providerPrefix = (provider.ocProviderId || provider.id) + "/";
          models = selectable
            .filter((m) => m.key.startsWith(providerPrefix))
            .map((m) => m.key);
        } catch { /* fall through */ }
      }
      if (!models.length && provider.defaultModels?.length) {
        models = provider.defaultModels;
      }
      if (models.length) {
        setAvailableModels(models);
        setModelId(models[0]);
      }
    })();
  }, [oauthSuccess, provider, availableModels.length, setModelId]);

  const handleValidate = useCallback(async () => {
    if (!provider || !apiKey) return;
    setValidating(true);
    setValidationError(null);
    setValidated(false);

    try {
      const result = await validateApiKey(provider.id, apiKey, customBaseUrl || undefined);
      if (result.success) {
        setValidated(true);
        // Register provider so CLI catalog knows about it
        if (isTauriEnv()) {
          await configureProvider(
            provider.id,
            apiKey,
            undefined,
            "api_key",
            customBaseUrl || undefined,
          ).catch(() => {});
        }
        // Fetch real model catalog from CLI, fall back to hardcoded defaults
        let models: string[] = [];
        if (isTauriEnv()) {
          try {
            const selectable = await listSelectableModels();
            const providerPrefix = (provider.ocProviderId || provider.id) + "/";
            models = selectable
              .filter((m) => m.key.startsWith(providerPrefix))
              .map((m) => m.key);
          } catch { /* fall through to defaults */ }
        }
        if (!models.length) {
          models = result.models?.length
            ? result.models
            : provider.defaultModels || [];
        }
        setAvailableModels(models);
        if (models.length) {
          setModelId(models[0]);
        }
      } else {
        setValidationError(result.error || t("onboarding.validationFailed"));
      }
    } catch (err) {
      setValidationError(extractErrorMessage(err));
    } finally {
      setValidating(false);
    }
  }, [provider, apiKey, customBaseUrl, setModelId]);

  const handleOAuth = useCallback(async () => {
    if (!provider?.oauthProviderId) return;
    setOauthRunning(true);
    setOauthError(null);
    setOauthSuccess(false);
    setOauthUrl(null);
    setOauthCode(null);

    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<OAuthProgress>(
        "oauth-progress",
        (event) => {
          const p = event.payload;
          if (p.status === "device_code") {
            setOauthUrl(p.verification_url || null);
            setOauthCode(p.user_code || null);
          } else if (p.status === "waiting") {
            // PKCE flow: browser opened, waiting for callback
            setOauthUrl(p.verification_url || null);
          } else if (p.status === "success") {
            setOauthSuccess(true);
            setOauthRunning(false);
          } else if (p.status === "error") {
            setOauthError(p.error || t("onboarding.oauthFailed"));
            setOauthRunning(false);
          }
        },
      );

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
  }, [provider]);

  const handleCancelOAuth = useCallback(async () => {
    try {
      await cancelOAuthFlow();
    } catch (e) {
      console.warn("cancelOAuthFlow failed:", e);
    }
    setOauthRunning(false);
    setOauthUrl(null);
    setOauthCode(null);
  }, []);

  const handleBrowserValidate = useCallback(() => {
    setValidating(true);
    setTimeout(() => {
      setValidating(false);
      setValidated(true);
      if (provider?.defaultModels?.length) {
        setAvailableModels(provider.defaultModels);
        setModelId(provider.defaultModels[0]);
      }
    }, 1000);
  }, [provider, setModelId]);

  // OAuth-only providers (e.g. GitHub Copilot) skip model selection
  const needsModelSelection = provider?.authMethod !== "oauth";

  const providerReady =
    (authTab === "api-key" && validated) ||
    (authTab === "oauth" && oauthSuccess);

  const isReady = providerReady && (!needsModelSelection || !!selectedModelId);

  const authBadgeText = (method: string) => {
    switch (method) {
      case "api-key":
        return "Key";
      case "oauth":
        return "OAuth";
      case "both":
        return "Key/OAuth";
      default:
        return "";
    }
  };

  return (
    <div className="flex w-[760px] flex-col items-center gap-5 rounded-[20px] bg-[var(--bg-main)] px-10 py-8">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
        {t("onboarding.modelTitle")}
      </h1>
      <p className="text-sm text-[var(--text-secondary)]">
        {t("onboarding.modelDesc")}
      </p>

      {/* Main content: left list + right config */}
      <div className="flex w-full gap-4" style={{ minHeight: 280 }}>
        {/* Provider list — scrollable */}
        <div
          className="flex w-[240px] shrink-0 flex-col gap-1.5 overflow-y-auto rounded-xl border border-[var(--border)] p-2"
          style={{ maxHeight: 340 }}
        >
          {MODEL_PROVIDERS.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setModel(m.id);
                setValidated(false);
              }}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                selectedModel === m.id
                  ? "bg-[#EBF5FB] ring-1 ring-[var(--primary)]"
                  : "hover:bg-[var(--bg-surface)]"
              }`}
            >
              <ProviderLogo provider={m} size={28} />
              <div className="flex flex-col">
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {getProviderDisplayName(m, language)}
                </span>
                <span className="text-[10px] text-[var(--text-secondary)]">
                  {authBadgeText(m.authMethod)}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Right: auth config */}
        <div
          className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-xl bg-[var(--bg-surface)] p-5"
          style={{ maxHeight: 340 }}
        >
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
                  <div className="text-base font-semibold text-[var(--text-primary)]">
                    {getProviderDisplayName(provider, language)}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {provider.authMethod === "api-key" && t("onboarding.authApiKey")}
                    {provider.authMethod === "oauth" && t("onboarding.authOAuth")}
                    {provider.authMethod === "both" && t("onboarding.authBoth")}
                  </div>
                </div>
              </div>

              {/* Tabs for "both" providers */}
              {provider.authMethod === "both" && (
                <div className="flex gap-1 rounded-lg bg-[var(--bg-main)] p-1">
                  <button
                    onClick={() => setAuthTab("api-key")}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      authTab === "api-key"
                        ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    API Key
                  </button>
                  <button
                    onClick={() => setAuthTab("oauth")}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      authTab === "oauth"
                        ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {t("onboarding.oauthLogin")}
                  </button>
                </div>
              )}

              {/* API Key tab */}
              {authTab === "api-key" && provider.authMethod !== "oauth" && (
                <>
                  {/* Custom base URL for third-party relay/proxy */}
                  {provider.defaultBaseUrl && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-[var(--text-secondary)]">
                        {t("onboarding.apiUrlHint")}
                      </label>
                      <input
                        type="text"
                        value={customBaseUrl}
                        onChange={(e) => {
                          setCustomBaseUrl(e.target.value);
                          setValidated(false);
                          setValidationError(null);
                          setAvailableModels([]);
                          setModelId("");
                        }}
                        placeholder={provider.defaultBaseUrl}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/40 outline-none focus:ring-1 focus:ring-[var(--primary)]"
                      />
                    </div>
                  )}

                  <Input
                    label="API Key"
                    placeholder={
                      provider.apiKeyPlaceholder || t("onboarding.apiKeyPlaceholder")
                    }
                    value={apiKey}
                    onChange={(v) => {
                      setApiKey(v);
                      setValidated(false);
                      setValidationError(null);

                      setAvailableModels([]);
                      setModelId("");
                    }}
                    type="password"
                    className="w-full"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={
                        isTauriEnv() ? handleValidate : handleBrowserValidate
                      }
                      disabled={!apiKey || validating}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                        validated
                          ? "bg-[#E8F8F5] text-[var(--success)]"
                          : "bg-[var(--primary)] text-white hover:bg-[var(--secondary)]"
                      } ${!apiKey || validating ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      {validating ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          {t("common.verifying")}
                        </>
                      ) : validated ? (
                        <>
                          <CheckCircle2 size={14} />
                          {t("common.verified")}
                        </>
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
                    <div
                      ref={(el) => { el?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}
                      className="flex items-start gap-2 rounded-lg bg-[#FDEDEC] px-3 py-2 text-xs text-[var(--danger)]"
                    >
                      <XCircle size={14} className="mt-0.5 shrink-0" />
                      <span>{validationError}</span>
                    </div>
                  )}
                </>
              )}

              {/* OAuth tab */}
              {authTab === "oauth" && provider.authMethod !== "api-key" && (
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                  {/* Native OAuth flow (GitHub Copilot / OpenAI) */}
                  {provider.oauthProviderId &&
                    isNativeOAuth(provider.id) && (
                      <>
                        {!oauthRunning && !oauthSuccess && !oauthError && (
                          <Button
                            onClick={
                              isTauriEnv()
                                ? handleOAuth
                                : () => {
                                    setOauthRunning(true);
                                    setTimeout(() => {
                                      setOauthSuccess(true);
                                      setOauthRunning(false);
                                    }, 2000);
                                  }
                            }
                          >
                            {t("onboarding.oauthLogin")}
                          </Button>
                        )}

                        {oauthRunning && (
                          <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-[var(--border)] p-4">
                            {/* Device code flow (GitHub): show code + verification URL */}
                            {isDeviceCodeOAuth(provider.id) && oauthUrl && oauthCode && (
                              <>
                                <p className="text-sm text-[var(--text-primary)]">
                                  {t("onboarding.oauthBrowserCode")}
                                </p>
                                <span className="rounded-lg bg-[var(--bg-main)] px-6 py-3 font-mono text-2xl font-bold tracking-widest text-[var(--primary)]">
                                  {oauthCode}
                                </span>
                                <button
                                  onClick={() => openUrl(oauthUrl!)}
                                  className="flex items-center gap-1 text-sm text-[var(--primary)] hover:underline"
                                >
                                  {t("onboarding.oauthOpenPage")}
                                  <ExternalLink size={14} />
                                </button>
                              </>
                            )}

                            {/* PKCE flow (OpenAI): just waiting for browser redirect */}
                            {!isDeviceCodeOAuth(provider.id) && (
                              <p className="text-sm text-[var(--text-primary)]">
                                {t("onboarding.oauthBrowserAuth")}
                              </p>
                            )}

                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                                <Loader2 size={12} className="animate-spin" />
                                {t("onboarding.oauthWaiting")}
                              </div>
                              <button
                                onClick={handleCancelOAuth}
                                className="rounded-md px-3 py-1 text-xs font-medium text-[var(--danger)] hover:bg-[#FDEDEC] transition-colors"
                              >
                                {t("common.cancel")}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                  {/* Non-native OAuth providers: recommend API Key */}
                  {provider.oauthProviderId &&
                    !isNativeOAuth(provider.id) && (
                      <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-[var(--border)] p-4">
                        <p className="text-sm text-[var(--text-primary)]">
                          {t("onboarding.oauthRecommendKey")}
                        </p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {t("onboarding.oauthSwitchHint")}
                        </p>
                        <Button
                          variant="secondary"
                          onClick={() => setAuthTab("api-key")}
                        >
                          {t("onboarding.switchToApiKey")}
                        </Button>
                      </div>
                    )}

                  {/* Success state */}
                  {oauthSuccess && (
                    <div className="flex items-center gap-2 text-sm text-[var(--success)]">
                      <CheckCircle2 size={18} />
                      {t("onboarding.oauthSuccess")}
                    </div>
                  )}

                  {/* Error state */}
                  {oauthError && (
                    <div className="flex flex-col items-center gap-2">
                      <div className="flex items-center gap-2 text-sm text-[var(--danger)]">
                        <XCircle size={18} />
                        {oauthError}
                      </div>
                      <Button variant="secondary" onClick={handleOAuth}>
                        {t("common.retry")}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Model selection — shown after auth is ready */}
              {providerReady &&
                needsModelSelection &&
                availableModels.length > 0 && (
                  <div
                    ref={(el) => { el?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}
                    className="flex flex-col gap-1.5"
                  >
                    <label className="text-xs font-medium text-[var(--text-secondary)]">
                      {t("onboarding.selectModel")}
                    </label>
                    <ModelSearchSelect
                      models={availableModels.map((m) => ({ key: m, name: m }))}
                      value={selectedModelId}
                      onChange={(v) => {
                        if (v === "__custom__") {
                          setModelId("");
                        } else {
                          setModelId(v);
                        }
                      }}
                      placeholder={t("onboarding.selectModel")}
                      allowCustom
                    />
                    {/* Custom model input */}
                    {!availableModels.includes(selectedModelId) && (
                      <input
                        ref={(el) => { el?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}
                        type="text"
                        value={selectedModelId}
                        onChange={(e) => setModelId(e.target.value)}
                        placeholder={t("onboarding.inputModelHint")}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/40 outline-none focus:ring-1 focus:ring-[var(--primary)]"
                        autoFocus
                      />
                    )}
                  </div>
                )}
            </>
          )}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex w-full items-center justify-between">
        <Button
          variant="secondary"
          onClick={() => navigate("/onboarding/install")}
        >
          {t("common.prev")}
        </Button>
        <Button
          onClick={async () => {
            setSaving(true);
            try {
              // Auto-configure on next step
              if (provider && isTauriEnv()) {
                try {
                  await configureProvider(
                    provider.id,
                    authTab === "api-key" ? apiKey : undefined,
                    selectedModelId || undefined,
                    authTab === "oauth" ? "oauth" : "api_key",
                    authTab === "api-key" && customBaseUrl ? customBaseUrl : undefined,
                  );
                  scheduleGatewayRestart();
                } catch (e) {
                  console.warn("configureProvider failed:", e);
                }
              }
              await markStepCompleted("model");
              await saveOnboardingData({ selectedModel, selectedModelId });
              navigate("/onboarding/channel");
            } finally {
              setSaving(false);
            }
          }}
          disabled={!selectedModel || !isReady || saving}
        >
          {saving ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("common.savingConfig")}
            </>
          ) : (
            t("common.next")
          )}
        </Button>
      </div>

      <StepIndicator currentStep={2} totalSteps={5} completedSteps={[1]} />
    </div>
  );
}
