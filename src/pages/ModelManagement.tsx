import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  ChevronDown,
  X,
  Pencil,
  Search,
} from "lucide-react";
import Header from "../components/layout/Header";
import Button from "../components/ui/Button";
import ProviderLogo from "../components/ui/ProviderLogo";
import Input from "../components/ui/Input";
import AddProviderModal from "../components/model/AddProviderModal";
import { ModelSearchSelect } from "../components/ui/ModelSearchSelect";
import {
  getModelsStatus,
  setDefaultModel,
  addModelFallback,
  removeModelFallback,
  removeProvider,
  readOpenClawConfig,
  configureProvider,
  scheduleGatewayRestart,
  listSelectableModels,
  type ConfiguredModel,
} from "../lib/tauri";
import { MODEL_PROVIDERS, PROVIDER_MAP, OC_PROVIDER_MAP, getProviderDisplayName } from "../lib/providers";
import { PROVIDER_LOGOS } from "../lib/logos";
import { useT } from "../lib/i18n";
import { extractErrorMessage } from "../lib/env";
import { isRetiredModel } from "../lib/retiredModels";
import { useAppStore } from "../stores/appStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { ModelProvider } from "../types/provider";

// ── Types ──

interface ProviderConfig {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  auth?: string;
  models?: { id: string; name: string; contextWindow?: number; cost?: Record<string, number> }[];
}

interface ModelsStatusData {
  defaultModel: string;
  fallbacks: string[];
  auth?: {
    providers?: { provider: string; profiles?: { count: number; apiKey: number; oauth: number } }[];
  };
}

// ── Helpers ──

function getProviderMeta(providerId: string): ModelProvider | undefined {
  return PROVIDER_MAP[providerId] || OC_PROVIDER_MAP[providerId] || MODEL_PROVIDERS.find((p) => p.id === providerId);
}

// ── Main Page ──

export default function ModelManagement() {
  const t = useT();
  // Bootstrap from appStore cache — avoids full reload on every navigation
  const cachedConfig = useAppStore((s) => s.config);
  const storeSetConfig = useAppStore((s) => s.setConfig);
  const cachedModelsStatus = useAppStore((s) => s.modelsStatus);
  const storeSetModelsStatus = useAppStore((s) => s.setModelsStatus);
  const cachedCatalogModels = useAppStore((s) => s.catalogModels);
  const storeSetCatalogModels = useAppStore((s) => s.setCatalogModels);

  const initProviders = (() => {
    const m = (cachedConfig?.models as Record<string, unknown> | undefined)?.providers;
    return (m ?? {}) as Record<string, ProviderConfig>;
  })();

  // Only show full-page loading on first ever visit (no cache at all)
  const hasCache = Object.keys(initProviders).length > 0 || cachedModelsStatus !== null;
  const [loading, setLoading] = useState(!hasCache);
  const [refreshing, setRefreshing] = useState(false);

  // Data — initialise from store cache for instant render
  const [modelsStatus, setModelsStatus] = useState<ModelsStatusData | null>(
    cachedModelsStatus as ModelsStatusData | null
  );
  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfig>>(initProviders);
  const [catalogModels, setCatalogModels] = useState<ConfiguredModel[]>(cachedCatalogModels ?? []);

  // UI state
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [addingFallback, setAddingFallback] = useState(false);
  const [fallbackInput, setFallbackInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchAll = useCallback(() => Promise.allSettled([
    readOpenClawConfig().then((config) => {
      const modelsSection = (config as Record<string, unknown>)?.models as Record<string, unknown> | undefined;
      if (modelsSection?.providers) {
        setProviderConfigs(modelsSection.providers as Record<string, ProviderConfig>);
      }
      storeSetConfig(config);
    }),
    listSelectableModels().then((models) => {
      setCatalogModels(models);
      storeSetCatalogModels(models);
    }),
    getModelsStatus().then((status) => {
      if (status) {
        setModelsStatus(status as unknown as ModelsStatusData);
        storeSetModelsStatus(status as unknown as Record<string, unknown>);
      }
    }),
  ]), [storeSetConfig, storeSetModelsStatus, storeSetCatalogModels]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  useEffect(() => {
    if (hasCache) {
      // Cached data is already in state — render immediately, refresh silently in background
      fetchAll();
    } else {
      // First visit: wait for data before showing page
      fetchAll().then(() => setLoading(false));
    }
  // fetchAll is stable (useCallback with stable deps); hasCache is constant for this mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSetDefault = async (model: string) => {
    setSwitchingModel(true);
    setActionError(null);
    try {
      await setDefaultModel(model);
      scheduleGatewayRestart();
      await fetchAll();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    } finally {
      setSwitchingModel(false);
    }
  };

  const handleAddFallback = async () => {
    if (!fallbackInput.trim()) return;
    setActionError(null);
    try {
      await addModelFallback(fallbackInput.trim());
      setFallbackInput("");
      setAddingFallback(false);
      await fetchAll();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    }
  };

  const handleRemoveFallback = async (model: string) => {
    setActionError(null);
    try {
      await removeModelFallback(model);
      await fetchAll();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    }
  };

  const handleRemoveProvider = async (provider: string) => {
    if (!confirm(t("model.removeConfirm"))) return;
    setActionError(null);
    try {
      await removeProvider(provider);
      scheduleGatewayRestart();
      await fetchAll();
    } catch (e) {
      setActionError(extractErrorMessage(e));
    }
  };

  const defaultModel = modelsStatus?.defaultModel || "";
  const fallbacks = modelsStatus?.fallbacks || [];
  const authProviders = modelsStatus?.auth?.providers || [];

  // Merge provider IDs from models.providers config AND auth.providers (for built-in OAuth providers)
  const providerIds = (() => {
    const ids = new Set(Object.keys(providerConfigs));
    for (const ap of authProviders) {
      if (ap.provider && ap.profiles?.count && ap.profiles.count > 0) {
        ids.add(ap.provider);
      }
    }
    return Array.from(ids);
  })();

  // Derive switchable models from the CLI catalog (available=true only)
  const switchableModels: { key: string; name: string; provider: string; contextWindow: number }[] =
    catalogModels.map((m) => {
      const slashIdx = m.key.indexOf("/");
      const provider = slashIdx > 0 ? m.key.slice(0, slashIdx) : "";
      return { key: m.key, name: m.name, provider, contextWindow: m.contextWindow };
    });

  const getAuthStatus = (providerId: string) => {
    const ap = authProviders.find((a) => a.provider === providerId);
    return ap && ap.profiles && ap.profiles.count > 0;
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <Header title={t("model.title")} />
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header title={t("model.title")} />

      <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
        {/* Error banner */}
        {actionError && (
          <div className="flex items-center gap-2 rounded-lg bg-[#FDEDEC] px-4 py-2 text-sm text-[var(--danger)]">
            <XCircle size={14} />
            <span className="flex-1">{actionError}</span>
            <button onClick={() => setActionError(null)}><X size={14} /></button>
          </div>
        )}

        {/* Default Model */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {t("model.defaultModel")}
            </span>
            <Button variant="secondary" size="sm" onClick={refresh}>
              {refreshing
                ? <><Loader2 size={14} className="animate-spin" /> {t("common.refreshing")}</>
                : <><RefreshCw size={14} /> {t("common.refresh")}</>
              }
            </Button>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <DefaultModelDisplay model={defaultModel} />
            <ModelSwitcher
              current={defaultModel}
              models={switchableModels}
              switching={switchingModel}
              onSwitch={handleSetDefault}
              t={t}
            />
          </div>
          {defaultModel && isRetiredModel(defaultModel) && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
              <XCircle size={14} className="shrink-0" />
              {t("model.retiredWarning")}
            </div>
          )}
        </div>

        {/* Configured Providers */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {t("model.providers")}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setShowAddProvider(true)}>
              <Plus size={14} /> {t("model.addProvider")}
            </Button>
          </div>

          {providerIds.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border)] py-8 text-center text-sm text-[var(--text-secondary)]">
              {t("model.noProviders")}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {providerIds.map((pid) => (
                <ProviderCard
                  key={pid}
                  providerId={pid}
                  config={providerConfigs[pid] || {}}
                  isAuthed={getAuthStatus(pid)}
                  defaultModel={defaultModel}
                  catalogModels={catalogModels}
                  onEdit={() => setEditingProvider(pid)}
                  onRemove={() => handleRemoveProvider(pid)}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>

        {/* Fallbacks */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {t("model.fallbacks")}
              </span>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {t("model.fallbacksHint")}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setAddingFallback(true)}>
              <Plus size={14} /> {t("model.addFallback")}
            </Button>
          </div>

          {fallbacks.length === 0 && !addingFallback ? (
            <div className="mt-3 text-sm text-[var(--text-secondary)]">
              {t("model.noFallbacks")}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {fallbacks.map((fb, i) => (
                <div key={fb} className="flex items-center justify-between rounded-lg bg-[var(--bg-surface)] px-3 py-2">
                  <span className="text-sm text-[var(--text-primary)]">
                    <span className="mr-2 text-xs text-[var(--text-secondary)]">#{i + 1}</span>
                    {fb}
                  </span>
                  <button
                    onClick={() => handleRemoveFallback(fb)}
                    className="text-xs text-[var(--danger)] hover:underline"
                  >
                    {t("model.removeFallback")}
                  </button>
                </div>
              ))}
            </div>
          )}

          {addingFallback && (() => {
            const usedKeys = new Set([defaultModel, ...fallbacks]);
            const candidates = switchableModels.filter((m) => !usedKeys.has(m.key) && !isRetiredModel(m.key));
            return (
              <div className="mt-3 flex items-center gap-2">
                <ModelSearchSelect
                  models={candidates}
                  value={fallbackInput}
                  onChange={setFallbackInput}
                  placeholder={t("model.selectModel")}
                  className="flex-1"
                />
                <Button size="sm" onClick={handleAddFallback} disabled={!fallbackInput}>
                  {t("common.confirm")}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => { setAddingFallback(false); setFallbackInput(""); }}>
                  {t("common.cancel")}
                </Button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Add Provider Modal */}
      {showAddProvider && (
        <AddProviderModal
          onClose={() => setShowAddProvider(false)}
          onDone={() => { setShowAddProvider(false); refresh(); }}
          configuredProviderIds={providerIds}
        />
      )}

      {/* Edit Provider Modal */}
      {editingProvider && (
        <EditProviderModal
          providerId={editingProvider}
          config={providerConfigs[editingProvider] || {}}
          onClose={() => setEditingProvider(null)}
          onDone={() => { setEditingProvider(null); refresh(); }}
          t={t}
        />
      )}
    </div>
  );
}

// ── Default Model Display ──

function DefaultModelDisplay({ model }: { model: string }) {
  const parts = model.split("/");
  const providerId = parts.length > 1 ? parts[0] : "";
  const modelId = parts.length > 1 ? parts.slice(1).join("/") : model;
  const meta = getProviderMeta(providerId);
  const logo = PROVIDER_LOGOS[providerId];

  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg"
        style={{ backgroundColor: meta ? meta.brandColor + "18" : "#EBF5FB" }}
      >
        {logo ? (
          <img src={logo} alt={providerId} className="h-6 w-6" />
        ) : meta ? (
          <ProviderLogo provider={meta} size={40} />
        ) : (
          <span className="text-lg">&#x1F9E0;</span>
        )}
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-[var(--text-primary)]">{modelId}</span>
        <span className="text-xs text-[var(--text-secondary)]">{model}</span>
      </div>
    </div>
  );
}

// ── Model Switcher (dropdown) ──

interface SwitchableModel {
  key: string;
  name: string;
  provider: string;
  contextWindow: number;
}

function ModelSwitcher({
  current,
  models,
  switching,
  onSwitch,
  t,
}: {
  current: string;
  models: SwitchableModel[];
  switching: boolean;
  onSwitch: (m: string) => void;
  t: ReturnType<typeof useT>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    // Exclude retired models from selection
    const active = models.filter((m) => !isRetiredModel(m.key));
    if (!search.trim()) return active;
    const q = search.toLowerCase();
    return active.filter(
      (m) => m.name.toLowerCase().includes(q) || m.key.toLowerCase().includes(q),
    );
  }, [models, search]);

  // Group by provider for easier browsing
  const grouped = useMemo(() => {
    const map = new Map<string, SwitchableModel[]>();
    for (const m of filtered) {
      const list = map.get(m.provider) || [];
      list.push(m);
      map.set(m.provider, list);
    }
    return map;
  }, [filtered]);

  if (switching) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
        <Loader2 size={14} className="animate-spin" />
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => { setIsOpen(!isOpen); setSearch(""); }}
        className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-main)]"
      >
        {t("model.switchModel")}
        <ChevronDown size={14} />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-80 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] shadow-lg">
            {/* Search input */}
            <div className="border-b border-[var(--border)] px-3 py-2">
              <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-surface)] px-2.5 py-1.5">
                <Search size={14} className="shrink-0 text-[var(--text-secondary)]" />
                <input
                  ref={inputRef}
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("model.searchPlaceholder")}
                  className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
                />
                {search && (
                  <button onClick={() => { setSearch(""); inputRef.current?.focus(); }}>
                    <X size={12} className="text-[var(--text-secondary)]" />
                  </button>
                )}
              </div>
            </div>

            {/* Model list */}
            <div className="max-h-72 overflow-auto p-1">
              {[...grouped.entries()].map(([provider, items]) => (
                <div key={provider}>
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                    {provider}
                  </div>
                  {items.map((m) => (
                    <button
                      key={m.key}
                      onClick={() => { onSwitch(m.key); setIsOpen(false); }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        m.key === current
                          ? "bg-[#EBF5FB] text-[var(--primary)]"
                          : "text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{m.name}</span>
                        <span className="text-xs text-[var(--text-secondary)]">{m.key}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {m.contextWindow > 0 && (
                          <span className="text-[10px] text-[var(--text-secondary)]">
                            {(m.contextWindow / 1000).toFixed(0)}K
                          </span>
                        )}
                        {m.key === current && <CheckCircle2 size={14} className="text-[var(--primary)]" />}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-[var(--text-secondary)]">
                  {search ? t("model.noMatchingModels") : t("model.noProviders")}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Provider Card ──

function ProviderCard({
  providerId,
  config,
  isAuthed,
  defaultModel,
  onEdit,
  onRemove,
  catalogModels,
  t,
}: {
  providerId: string;
  config: ProviderConfig;
  isAuthed: boolean | undefined;
  defaultModel: string;
  catalogModels: ConfiguredModel[];
  onEdit: () => void;
  onRemove: () => void;
  t: ReturnType<typeof useT>;
}) {
  const meta = getProviderMeta(providerId);
  const language = useSettingsStore((s) => s.language);
  // Show models from CLI catalog for this provider, fall back to openclaw.json models
  const displayModels = useMemo(() => {
    const providerModels = catalogModels.filter((m) => m.key.startsWith(providerId + "/"));
    return providerModels.length > 0
      ? providerModels.map((m) => ({ id: m.key.slice(providerId.length + 1), name: m.name }))
      : (config.models || []).map((m) => ({ id: m.id, name: m.name || m.id }));
  }, [catalogModels, providerId, config.models]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {meta ? (
            <ProviderLogo provider={meta} size={36} />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EBF5FB] text-sm font-bold">
              {providerId.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {meta ? getProviderDisplayName(meta, language) : providerId}
            </span>
            <span className={`text-xs ${isAuthed ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}`}>
              {isAuthed ? (
                <span className="flex items-center gap-1"><CheckCircle2 size={10} /> {t("model.authConfigured")}</span>
              ) : (
                t("model.authNotConfigured")
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
            title={t("model.editProvider")}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onRemove}
            className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[#FDEDEC] hover:text-[var(--danger)]"
            title={t("model.removeProvider")}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Details */}
      <div className="mt-3 flex flex-col gap-1.5 text-xs text-[var(--text-secondary)]">
        {config.baseUrl && (
          <div className="flex gap-2">
            <span className="w-16 shrink-0 text-right">{t("model.apiUrl")}</span>
            <span className="font-mono text-[var(--text-primary)] break-all">{config.baseUrl}</span>
          </div>
        )}
        {config.api && (
          <div className="flex gap-2">
            <span className="w-16 shrink-0 text-right">{t("model.apiProtocol")}</span>
            <span className="text-[var(--text-primary)]">{config.api}</span>
          </div>
        )}
        {displayModels.length > 0 && (
          <div className="flex gap-2">
            <span className="w-16 shrink-0 text-right">{t("model.models")}</span>
            <div className="flex flex-wrap gap-1">
              {displayModels.map((m) => (
                <span
                  key={m.id}
                  className={`rounded-md px-2 py-0.5 ${
                    defaultModel === `${providerId}/${m.id}`
                      ? "bg-[#EBF5FB] text-[var(--primary)] font-medium"
                      : "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                  }`}
                >
                  {m.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Edit Provider Modal ──

function EditProviderModal({
  providerId,
  config,
  onClose,
  onDone,
  t,
}: {
  providerId: string;
  config: ProviderConfig;
  onClose: () => void;
  onDone: () => void;
  t: ReturnType<typeof useT>;
}) {
  const meta = getProviderMeta(providerId);
  const language = useSettingsStore((s) => s.language);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(config.baseUrl || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await configureProvider(
        providerId,
        apiKey || undefined,
        undefined,
        "api_key",
        baseUrl || undefined,
        false, // Don't change default model when editing provider
      );
      scheduleGatewayRestart();
      onDone();
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[480px] rounded-2xl bg-[var(--bg-main)] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-3">
            {meta && <ProviderLogo provider={meta} size={28} />}
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t("model.editProvider")} - {meta ? getProviderDisplayName(meta, language) : providerId}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-[var(--bg-surface)]">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-secondary)]">{t("model.apiUrl")}</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={meta?.defaultBaseUrl || "https://api.example.com/v1"}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
          </div>

          <Input
            label="API Key"
            placeholder={meta?.apiKeyPlaceholder || "Enter new API Key (leave empty to keep current)"}
            value={apiKey}
            onChange={setApiKey}
            type="password"
          />
          <p className="text-xs text-[var(--text-secondary)]">
            {t("model.apiProtocol")}: {config.api || "auto"}
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-[#FDEDEC] px-3 py-2 text-xs text-[var(--danger)]">
              <XCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={handleSave} disabled={saving}>
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
