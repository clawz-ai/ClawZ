import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  ExternalLink,
  CheckCircle2,
  XCircle,
  Terminal,
  Copy,
  Check,
  HelpCircle,
  Loader2,
} from "lucide-react";
import Button from "../../components/ui/Button";
import Input from "../../components/ui/Input";
import Drawer from "../../components/ui/Drawer";
import StepIndicator from "../../components/ui/StepIndicator";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { CHAT_CHANNELS, getChannelDisplayName, getChannelLogo, getChannelLoginNote, getFieldLabel, getFieldPlaceholder } from "../../lib/channels";
import { getChannelGuide } from "../../lib/channelGuides";
import { addChannel, installChannelPlugin, validateChannelCredentials, scheduleGatewayRestart } from "../../lib/tauri";
import { isTauriEnv, extractErrorMessage } from "../../lib/env";
import {
  markStepCompleted,
  saveOnboardingData,
} from "../../lib/onboardingProgress";
import type { ChatChannel } from "../../types/channel";
import { open } from "@tauri-apps/plugin-shell";
import { CHANNEL_LOGOS } from "../../lib/logos";
import { useT } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";

function ChannelLogo({
  channel,
  size = 32,
  locale,
}: {
  channel: ChatChannel;
  size?: number;
  locale: string;
}) {
  const svgSrc = CHANNEL_LOGOS[channel.id];
  if (svgSrc) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-lg"
        style={{
          width: size,
          height: size,
          backgroundColor: channel.brandColor + "18",
        }}
      >
        <img
          src={svgSrc}
          alt={channel.name}
          style={{ width: size * 0.6, height: size * 0.6 }}
        />
      </div>
    );
  }
  const logo = getChannelLogo(channel, locale);
  const fontSize = logo.length > 1 ? size * 0.36 : size * 0.45;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{
        width: size,
        height: size,
        backgroundColor: channel.brandColor,
        fontSize,
      }}
    >
      {logo}
    </div>
  );
}

function openUrl(url: string) {
  if (isTauriEnv()) {
    open(url).catch(() => window.open(url, "_blank"));
  } else {
    window.open(url, "_blank");
  }
}

/**
 * Render text with markdown-style links [text](url), images ![alt](url),
 * and inline code `code`.
 */
function RichText({ text }: { text: string }) {
  const t = useT();
  // Split on: ![alt](url), [text](url), `code`
  const parts = text.split(
    /(!\[[^\]]*\]\([^)]+\)|\[[^\]]*\]\([^)]+\)|`[^`]+`)/g,
  );
  return (
    <>
      {parts.map((part, i) => {
        // Image: ![alt](url)
        const imgMatch = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (imgMatch) {
          return (
            <img
              key={i}
              src={imgMatch[2]}
              alt={imgMatch[1]}
              className="my-2 max-w-full rounded-lg"
            />
          );
        }
        // Link: [text](url)
        const linkMatch = part.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return (
            <button
              key={i}
              onClick={() => openUrl(linkMatch[2])}
              className="inline text-[var(--primary)] hover:underline"
            >
              {linkMatch[1]}
            </button>
          );
        }
        // Inline code: `code`
        const codeMatch = part.match(/^`([^`]+)`$/);
        if (codeMatch) {
          const content = codeMatch[1];
          // Long code blocks (like JSON) render as a copyable block
          if (content.length > 80) {
            return (
              <code
                key={i}
                onClick={() => {
                  navigator.clipboard.writeText(content);
                }}
                className="mt-1 block cursor-pointer select-all break-all rounded bg-[var(--bg-main)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--text-primary)] hover:ring-1 hover:ring-[var(--primary)]"
                title={t("common.clickToCopy")}
              >
                {content}
              </code>
            );
          }
          return (
            <code
              key={i}
              className="rounded bg-[var(--bg-main)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-primary)]"
            >
              {content}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export default function ChannelConnect() {
  const navigate = useNavigate();
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const { setChannels } = useOnboardingStore();

  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [configuredChannels, setConfiguredChannels] = useState<Set<string>>(
    new Set(),
  );
  const [configError, setConfigError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionDone, setActionDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const channel = CHAT_CHANNELS.find((c) => c.id === activeChannel);
  const guide = activeChannel ? getChannelGuide(activeChannel, language) : undefined;

  // Reset field values when switching channels
  useEffect(() => {
    setFieldValues({});
    setConfigError(null);
    setCopied(false);
    setActionDone(false);
    setActionError(null);
  }, [activeChannel]);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
    setConfigError(null);
  }, []);

  const handleCopyCommand = useCallback((cmd: string) => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  const handleMarkLogin = useCallback(() => {
    if (!channel) return;
    setConfiguredChannels((prev) => new Set(prev).add(channel.id));
  }, [channel]);

  const handleMarkNative = useCallback(() => {
    if (!channel) return;
    setConfiguredChannels((prev) => new Set(prev).add(channel.id));
  }, [channel]);

  // Check if required fields are filled
  const hasRequiredFields =
    channel?.fields?.every((f) => fieldValues[f.key]?.trim()) ?? false;

  // Validate credentials and save channel config. Throws on failure.
  const saveChannelWithValidation = useCallback(async () => {
    if (!channel || !hasRequiredFields) return;
    const config: Record<string, string> = {};
    for (const field of channel.fields || []) {
      const val = fieldValues[field.key]?.trim();
      if (val) config[field.key] = val;
    }
    if (isTauriEnv()) {
      await validateChannelCredentials(channel.id, config);
      if (channel.plugin) {
        await installChannelPlugin(channel.plugin);
      }
      const allowFrom = (fieldValues["__allowFrom"] || "")
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await addChannel(channel.id, config, allowFrom);
      scheduleGatewayRestart();
    }
    setConfiguredChannels((prev) => new Set(prev).add(channel.id));
  }, [channel, hasRequiredFields, fieldValues]);

  // Button handler wrapper with loading state
  const handleSaveChannel = useCallback(async () => {
    setValidating(true);
    setConfigError(null);
    try {
      await saveChannelWithValidation();
    } catch (err) {
      setConfigError(extractErrorMessage(err));
    } finally {
      setValidating(false);
    }
  }, [saveChannelWithValidation]);

  // Guide action: save channel config + start gateway (for feishu event subscription)
  // Note: saveChannelWithValidation() already calls scheduleGatewayRestart(),
  // so no need for a separate startGateway() call.
  const handleGuideAction = useCallback(async () => {
    if (!channel || !hasRequiredFields) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await saveChannelWithValidation();
      setActionDone(true);
    } catch (err) {
      setActionError(extractErrorMessage(err));
    } finally {
      setActionLoading(false);
    }
  }, [channel, hasRequiredFields, saveChannelWithValidation]);

  const authLabel = (type: string) => {
    switch (type) {
      case "token":
        return "Token";
      case "multi-field":
        return t("onboarding.authBadgeConfig");
      case "login":
        return t("onboarding.authBadgeScan");
      case "native":
        return t("onboarding.authBadgeNative");
      default:
        return "";
    }
  };

  return (
    <div className="flex w-[760px] flex-col items-center gap-5 rounded-[20px] bg-[var(--bg-main)] px-10 py-8">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
        {t("onboarding.channelTitle")}
      </h1>
      <p className="text-sm text-[var(--text-secondary)]">
        {t("onboarding.channelDesc")}
      </p>

      {/* Main content: left list + right config */}
      <div className="flex w-full gap-4" style={{ minHeight: 280 }}>
        {/* Channel list — scrollable */}
        <div
          className="flex w-[240px] shrink-0 flex-col gap-1.5 overflow-y-auto rounded-xl border border-[var(--border)] p-2"
          style={{ maxHeight: 340 }}
        >
          {CHAT_CHANNELS.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setActiveChannel(ch.id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                activeChannel === ch.id
                  ? "bg-[#EBF5FB] ring-1 ring-[var(--primary)]"
                  : "hover:bg-[var(--bg-surface)]"
              }`}
            >
              <ChannelLogo channel={ch} size={28} locale={language} />
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {getChannelDisplayName(ch, language)}
                </span>
                <span className="text-[10px] text-[var(--text-secondary)]">
                  {authLabel(ch.authType)}
                </span>
              </div>
              {configuredChannels.has(ch.id) && (
                <CheckCircle2
                  size={14}
                  className="shrink-0 text-[var(--success)]"
                />
              )}
            </button>
          ))}
        </div>

        {/* Right: channel config */}
        <div
          className="flex flex-1 flex-col gap-4 overflow-y-auto rounded-xl bg-[var(--bg-surface)] p-5"
          style={{ maxHeight: 340 }}
        >
          {!channel ? (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
              {t("onboarding.channelSelect")}
            </div>
          ) : (
            <>
              {/* Channel header */}
              <div className="flex items-center gap-3">
                <ChannelLogo channel={channel} size={36} locale={language} />
                <div className="flex-1">
                  <div className="text-base font-semibold text-[var(--text-primary)]">
                    {getChannelDisplayName(channel, language)}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {channel.authType === "token" && t("onboarding.authToken")}
                    {channel.authType === "multi-field" && t("onboarding.authMultiField")}
                    {channel.authType === "login" && t("onboarding.authLogin")}
                    {channel.authType === "native" && t("onboarding.authNative")}
                  </div>
                </div>
                {configuredChannels.has(channel.id) && (
                  <span className="flex items-center gap-1 text-xs text-[var(--success)]">
                    <CheckCircle2 size={12} />
                    {t("common.configured")}
                  </span>
                )}
                {/* Guide button */}
                {guide && (
                  <button
                    onClick={() => setGuideOpen(true)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--primary)] hover:bg-[var(--bg-main)]"
                    title={t("common.viewGuide")}
                  >
                    <HelpCircle size={14} />
                    {t("onboarding.guide")}
                  </button>
                )}
              </div>

              {/* Token / multi-field config */}
              {(channel.authType === "token" ||
                channel.authType === "multi-field") && (
                <>
                  {channel.fields?.map((field) => (
                    <Input
                      key={field.key}
                      label={getFieldLabel(field, language)}
                      placeholder={getFieldPlaceholder(field, language)}
                      value={fieldValues[field.key] || ""}
                      onChange={(v) => handleFieldChange(field.key, v)}
                      type={field.secret ? "password" : "text"}
                      className="w-full"
                    />
                  ))}

                  {/* Allow list — who can DM the bot (hidden for feishu, which uses platform-level access control) */}
                  {channel.id !== "feishu" && (
                    <div className="flex flex-col gap-1">
                      <Input
                        label={t("onboarding.allowUsers")}
                        placeholder={t("onboarding.allowUsersPlaceholder")}
                        value={fieldValues["__allowFrom"] || ""}
                        onChange={(v) => handleFieldChange("__allowFrom", v)}
                        className="w-full"
                      />
                      <p className="text-[11px] text-[var(--text-secondary)]">
                        {t("onboarding.allowUsersHint")}
                      </p>
                    </div>
                  )}

                  {!configuredChannels.has(channel.id) ? (
                    <Button
                      variant="primary"
                      onClick={handleSaveChannel}
                      disabled={!hasRequiredFields || validating}
                    >
                      {validating ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          {t("common.verifying")}
                        </>
                      ) : (
                        t("onboarding.saveConfig")
                      )}
                    </Button>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-[var(--success)]">
                      <CheckCircle2 size={12} />
                      {t("common.configured")}
                    </span>
                  )}

                  {channel.helpUrl && (
                    <div className="flex items-center">
                      <button
                        onClick={() => openUrl(channel.helpUrl!)}
                        className="flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
                      >
                        {t("onboarding.getCredentials")}
                        <ExternalLink size={12} />
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Interactive login (WhatsApp etc.) */}
              {channel.authType === "login" && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                    <Terminal size={16} />
                    {getChannelLoginNote(channel, language) || t("onboarding.terminalLogin")}
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-main)] p-3">
                    <code className="flex-1 text-xs text-[var(--text-primary)]">
                      openclaw channels login --channel {channel.id}
                    </code>
                    <button
                      onClick={() =>
                        handleCopyCommand(
                          `openclaw channels login --channel ${channel.id}`,
                        )
                      }
                      className="shrink-0 rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--primary)]"
                      title={t("common.copyCommand")}
                    >
                      {copied ? (
                        <Check size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {t("onboarding.terminalLoginDone")}
                  </p>
                  {!configuredChannels.has(channel.id) ? (
                    <Button variant="secondary" onClick={handleMarkLogin}>
                      <CheckCircle2 size={14} />
                      {t("onboarding.terminalConfirm")}
                    </Button>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-[var(--success)]">
                      <CheckCircle2 size={12} />
                      {t("onboarding.markedLogin")}
                    </span>
                  )}
                </div>
              )}

              {/* Native (iMessage) */}
              {channel.authType === "native" && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-[var(--text-secondary)]">
                    {channel.id === "imessage"
                      ? t("onboarding.imessageDesc")
                      : t("onboarding.nativeDesc")}
                  </p>
                  {!configuredChannels.has(channel.id) ? (
                    <Button variant="secondary" onClick={handleMarkNative}>
                      {t("onboarding.enable", { name: getChannelDisplayName(channel, language) })}
                    </Button>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-[var(--success)]">
                      <CheckCircle2 size={12} />
                      {t("common.configured")}
                    </span>
                  )}
                </div>
              )}

              {/* Error */}
              {configError && (
                <div
                  ref={(el) => { el?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }}
                  className="flex items-start gap-2 rounded-lg bg-[#FDEDEC] px-3 py-2 text-xs text-[var(--danger)]"
                >
                  <XCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{configError}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Summary */}
      {configuredChannels.size > 0 && (
        <div className="flex w-full items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span>{t("onboarding.configuredList")}</span>
          {Array.from(configuredChannels).map((id) => {
            const ch = CHAT_CHANNELS.find((c) => c.id === id);
            return ch ? (
              <span
                key={id}
                className="rounded-full bg-[#E8F8F5] px-2 py-0.5 text-[var(--success)]"
              >
                {getChannelDisplayName(ch, language)}
              </span>
            ) : null;
          })}
        </div>
      )}

      {/* Buttons */}
      <div className="flex w-full items-center justify-between">
        <Button
          variant="secondary"
          onClick={() => navigate("/onboarding/model")}
        >
          {t("common.prev")}
        </Button>
        <Button
          onClick={async () => {
            setSaving(true);
            setSaveError(null);
            try {
              const channels = Array.from(configuredChannels);
              setChannels(channels);
              await markStepCompleted("channel");
              await saveOnboardingData({ selectedChannels: channels });
              navigate("/onboarding/scenario");
            } catch (err) {
              setSaveError(extractErrorMessage(err));
            } finally {
              setSaving(false);
            }
          }}
          disabled={configuredChannels.size === 0 || saving}
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

      {/* Save error */}
      {saveError && (
        <div className="flex w-full items-start gap-2 rounded-lg bg-[#FDEDEC] px-4 py-2.5 text-xs text-[var(--danger)]">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      <StepIndicator currentStep={3} totalSteps={5} completedSteps={[1, 2]} />

      {/* Guide Drawer */}
      <Drawer
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title={guide?.title}
      >
        {guide && (
          <div className="flex flex-col gap-5">
            {/* Intro */}
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              <RichText text={guide.intro} />
            </p>

            {/* Steps */}
            <div className="flex flex-col gap-4">
              {guide.steps.map((step, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    <RichText text={step.content} />
                  </p>
                  {step.action && (
                    <div className="flex flex-col gap-1.5">
                      {!hasRequiredFields && (
                        <p className="text-xs text-[var(--text-secondary)]">
                          {t("onboarding.guideFillFirst")}
                        </p>
                      )}
                      <button
                        onClick={handleGuideAction}
                        disabled={!hasRequiredFields || actionLoading || actionDone}
                        className={`flex items-center gap-1.5 self-start rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                          actionDone
                            ? "bg-[#E8F8F5] text-[var(--success)]"
                            : "bg-[var(--primary)] text-white hover:bg-[var(--secondary)]"
                        } ${!hasRequiredFields || actionLoading ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        {actionLoading ? (
                          <>
                            <Loader2 size={14} className="animate-spin" />
                            {t("onboarding.guideConfiguring")}
                          </>
                        ) : actionDone ? (
                          <>
                            <CheckCircle2 size={14} />
                            {t("onboarding.guideConfigDone")}
                          </>
                        ) : (
                          step.action.label
                        )}
                      </button>
                      {actionError && (
                        <p className="text-xs text-[var(--danger)]">{actionError}</p>
                      )}
                      {step.afterAction && (
                        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                          <RichText text={step.afterAction} />
                        </p>
                      )}
                    </div>
                  )}
                  {step.image && (
                    <img
                      src={step.image}
                      alt={step.title}
                      onClick={() => setZoomedImage(step.image!)}
                      className="mt-1 max-w-full cursor-zoom-in rounded-lg border border-[var(--border)] transition-opacity hover:opacity-80"
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Tips */}
            {guide.tips && guide.tips.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg bg-[var(--bg-surface)] p-4">
                <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                  {t("onboarding.guideNotes")}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {guide.tips.map((tip, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs leading-relaxed text-[var(--text-secondary)]"
                    >
                      <span className="mt-1 block h-1 w-1 shrink-0 rounded-full bg-[var(--text-secondary)]" />
                      <RichText text={tip} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* External link — point to OpenClaw docs */}
            {guide.docUrl && (
              <button
                onClick={() => openUrl(guide.docUrl!)}
                className="flex items-center gap-1.5 self-start text-sm text-[var(--primary)] hover:underline"
              >
                {t("onboarding.guideDocs")}
                <ExternalLink size={14} />
              </button>
            )}
          </div>
        )}
      </Drawer>

      {/* Image lightbox */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setZoomedImage(null)}
        >
          <img
            src={zoomedImage}
            alt=""
            className="max-h-[90vh] max-w-[90vw] cursor-zoom-out rounded-xl shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
