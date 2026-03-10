import { useState, useEffect, useMemo } from "react";
import { CheckCircle2, RefreshCw, Plus, Power, PowerOff, Trash2, Users, Loader2 } from "lucide-react";
import Header from "../components/layout/Header";
import Button from "../components/ui/Button";
import AddChannelModal from "../components/channel/AddChannelModal";
import { disableChannel, removeChannelAccount, setConfigValue, scheduleGatewayRestart } from "../lib/tauri";
import { CHANNEL_MAP, getChannelDisplayName } from "../lib/channels";
import { CHANNEL_LOGOS } from "../lib/logos";
import { useT } from "../lib/i18n";
import { useAppStore } from "../stores/appStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { AgentBinding } from "../types/binding";
import { parseBindingsFromConfig, bindingDisplayText } from "../lib/bindings";

export default function ChannelManagement() {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const cachedConfig = useAppStore((s) => s.config);
  const refreshConfig = useAppStore((s) => s.refreshConfig);
  const [config, setConfig] = useState<Record<string, unknown> | null>(cachedConfig);
  const [loading, setLoading] = useState(cachedConfig === null);
  const [refreshing, setRefreshing] = useState(false);
  const [allBindings, setAllBindings] = useState<AgentBinding[]>(() => parseBindingsFromConfig(cachedConfig));
  const [bindingsLoading, setBindingsLoading] = useState(cachedConfig === null);
  const [showAddModal, setShowAddModal] = useState(false);
  /** When set, opens AddChannelModal in add-account mode for this channel */
  const [addAccountChannelId, setAddAccountChannelId] = useState<string | null>(null);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [removingAccount, setRemovingAccount] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const data = await refreshConfig();
      if (data) {
        setConfig(data);
        setAllBindings(parseBindingsFromConfig(data));
      }
    } catch (e) {
      console.warn("loadConfig failed:", e);
    } finally {
      setLoading(false);
      setBindingsLoading(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const channelsConfig = (config?.channels ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const channelIds = Object.keys(channelsConfig);
  const configuredIds = new Set(channelIds);

  // Pre-index bindings by channel+account to avoid O(N*M) nested filters in render
  const bindingIndex = useMemo(() => {
    const byChannel = new Map<string, AgentBinding[]>();
    const byChannelAccount = new Map<string, AgentBinding[]>();
    for (const b of allBindings) {
      const ch = b.match.channel;
      if (!byChannel.has(ch)) byChannel.set(ch, []);
      byChannel.get(ch)!.push(b);
      const acctKey = `${ch}:${b.match.accountId || "default"}`;
      if (!byChannelAccount.has(acctKey)) byChannelAccount.set(acctKey, []);
      byChannelAccount.get(acctKey)!.push(b);
    }
    return { byChannel, byChannelAccount };
  }, [allBindings]);

  const [enablingId, setEnablingId] = useState<string | null>(null);

  const handleEnable = async (id: string) => {
    setEnablingId(id);
    try {
      await setConfigValue(`channels.${id}.enabled`, "true");
      scheduleGatewayRestart();
      await refresh();
    } catch (e) {
      console.warn("enable failed:", e);
    } finally {
      setEnablingId(null);
    }
  };

  const handleDisable = async (id: string) => {
    setDisablingId(id);
    try {
      await disableChannel(id);
      scheduleGatewayRestart();
      refresh();
    } catch (e) {
      console.warn("disable failed:", e);
    } finally {
      setDisablingId(null);
    }
  };

  const handleRemoveAccount = async (channelId: string, accountId: string) => {
    const key = `${channelId}:${accountId}`;
    setRemovingAccount(key);
    try {
      await removeChannelAccount(channelId, accountId);
      scheduleGatewayRestart();
      refresh();
    } catch (e) {
      console.warn("remove account failed:", e);
    } finally {
      setRemovingAccount(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Header title={t("channel.title")} />

      <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
        <div className="flex justify-end gap-2">
          <Button variant="primary" icon={Plus} onClick={() => setShowAddModal(true)}>
            {t("channel.add")}
          </Button>
          <Button variant="secondary" onClick={refresh} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
            {t("common.refresh")}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-[var(--text-secondary)]">
            {t("common.loading")}
          </div>
        ) : channelIds.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] px-5 py-8">
            <span className="text-sm text-[var(--text-secondary)]">
              {t("channel.noChannel")}
            </span>
            <Button variant="primary" icon={Plus} onClick={() => setShowAddModal(true)}>
              {t("channel.add")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {channelIds.map((id) => {
              const ch = channelsConfig[id];
              const isEnabled = ch?.enabled === true;
              const displayName = CHANNEL_MAP[id] ? getChannelDisplayName(CHANNEL_MAP[id], language) : id;
              const logo = CHANNEL_LOGOS[id];
              const channelBindings = bindingIndex.byChannel.get(id) || [];
              const accounts = ch?.accounts as Record<string, Record<string, unknown>> | undefined;
              const accountIds = accounts ? Object.keys(accounts) : [];

              return (
                <div
                  key={id}
                  className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] px-5 py-4"
                >
                  {/* Channel header row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {logo && (
                        <img src={logo} alt={id} className="h-5 w-5" />
                      )}
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {displayName}
                      </span>
                      {accountIds.length > 0 && (
                        <span className="flex items-center gap-1 rounded-md bg-[var(--bg-surface)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                          <Users size={10} />
                          {accountIds.length} {t("channel.accounts")}
                        </span>
                      )}
                      <span
                        className={`text-xs ${isEnabled ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}`}
                      >
                        {isEnabled ? t("channel.enabled") : t("channel.disabled")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isEnabled && (
                        <CheckCircle2
                          size={14}
                          className="text-[var(--success)]"
                        />
                      )}
                      <button
                        onClick={() => setAddAccountChannelId(id)}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--primary)] hover:bg-[var(--bg-surface)]"
                        title={t("channel.addAccount")}
                      >
                        <Plus size={12} />
                        {t("channel.addAccountShort")}
                      </button>
                      {isEnabled ? (
                        <button
                          onClick={() => handleDisable(id)}
                          disabled={disablingId === id}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--danger)] disabled:opacity-50"
                          title={t("channel.disable")}
                        >
                          <PowerOff size={12} />
                          {t("channel.disable")}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleEnable(id)}
                          disabled={enablingId === id}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--primary)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
                        >
                          {enablingId === id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Power size={12} />
                          )}
                          {t("channel.reEnable")}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Account details */}
                  {accountIds.length > 0 && (
                    <div className="flex flex-col gap-1.5 pl-8">
                      {accountIds.map((acctId) => {
                        const acct = accounts![acctId];
                        const acctEnabled = acct?.enabled !== false;
                        const acctName = (acct?.name as string) || acctId;
                        const acctBindings = bindingIndex.byChannelAccount.get(`${id}:${acctId}`) || [];
                        const removeKey = `${id}:${acctId}`;
                        return (
                          <div
                            key={acctId}
                            className="flex items-center justify-between rounded-lg bg-[var(--bg-surface)] px-3 py-1.5"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-[var(--text-primary)]">
                                {acctName}
                              </span>
                              {acctId !== acctName && (
                                <span className="text-[10px] text-[var(--text-secondary)]">
                                  ({acctId})
                                </span>
                              )}
                              {acctEnabled && (
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
                              )}
                              {bindingsLoading ? (
                                <Loader2 size={10} className="animate-spin text-[var(--text-secondary)]" />
                              ) : (
                                acctBindings.map((b) => (
                                  <span
                                    key={b.agentId}
                                    className="rounded bg-[var(--bg-main)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
                                  >
                                    {b.agentId}
                                  </span>
                                ))
                              )}
                            </div>
                            <button
                              onClick={() => handleRemoveAccount(id, acctId)}
                              disabled={removingAccount === removeKey}
                              className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-main)] hover:text-[var(--danger)] disabled:opacity-50"
                              title={t("channel.removeAccount")}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Bindings (if no accounts structure — legacy flat config) */}
                  {accountIds.length === 0 && bindingsLoading && (
                    <div className="flex items-center gap-1.5 pl-1">
                      <Loader2 size={12} className="animate-spin text-[var(--text-secondary)]" />
                      <span className="text-[11px] text-[var(--text-secondary)]">{t("common.loading")}</span>
                    </div>
                  )}
                  {accountIds.length === 0 && !bindingsLoading && channelBindings.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pl-1">
                      {channelBindings.map((b) => (
                        <span
                          key={`${b.agentId}-${bindingDisplayText(b.match)}`}
                          className="rounded-md bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
                        >
                          {b.agentId}
                          {(b.match.accountId || b.match.peer || b.match.guildId || b.match.teamId) && (
                            <span className="ml-1 text-[var(--text-secondary)]/60">
                              ({bindingDisplayText(b.match)})
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AddChannelModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={refresh}
        configuredIds={configuredIds}
        channelConfigs={channelsConfig}
      />

      {/* Add-account modal — narrower, no channel list */}
      {addAccountChannelId && (
        <AddChannelModal
          open
          onClose={() => setAddAccountChannelId(null)}
          onSuccess={async () => {
            await refresh();
            setAddAccountChannelId(null);
          }}
          configuredIds={configuredIds}
          channelConfigs={channelsConfig}
          preselectedChannelId={addAccountChannelId}
        />
      )}
    </div>
  );
}
