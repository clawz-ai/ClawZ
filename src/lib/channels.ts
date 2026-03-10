import type { ChatChannel, ChannelField } from "../types/channel";

export const CHAT_CHANNELS: ChatChannel[] = [
  {
    id: "telegram",
    name: "Telegram",
    logo: "TG",
    brandColor: "#26A5E4",
    authType: "token",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        placeholder: "123456:ABC-DEF...",
        secret: true,
      },
    ],
    helpUrl: "https://core.telegram.org/bots#botfather",
  },
  {
    id: "discord",
    name: "Discord",
    logo: "DC",
    brandColor: "#5865F2",
    authType: "token",
    fields: [
      {
        key: "token",
        label: "Bot Token",
        placeholder: "MTk4NjIy...",
        secret: true,
      },
    ],
    helpUrl: "https://discord.com/developers/applications",
  },
  {
    id: "feishu",
    name: "飞书",
    nameEn: "Feishu (Lark)",
    logo: "飞",
    logoEn: "FS",
    brandColor: "#3370FF",
    authType: "multi-field",
    fields: [
      {
        key: "appId",
        label: "App ID",
        placeholder: "cli_xxx...",
      },
      {
        key: "appSecret",
        label: "App Secret",
        placeholder: "输入飞书 App Secret...",
        placeholderEn: "Enter Feishu App Secret...",
        secret: true,
      },
    ],
    helpUrl: "https://open.feishu.cn/app",
    plugin: "@openclaw/feishu",
  },
];

// --- Hidden channels (to be enabled later) ---
export const HIDDEN_CHANNELS: ChatChannel[] = [
  {
    id: "slack",
    name: "Slack",
    logo: "SL",
    brandColor: "#4A154B",
    authType: "multi-field",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        placeholder: "xoxb-...",
        secret: true,
      },
      {
        key: "appToken",
        label: "App Token",
        placeholder: "xapp-...",
        secret: true,
      },
    ],
    helpUrl: "https://api.slack.com/apps",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    logo: "WA",
    brandColor: "#25D366",
    authType: "login",
    loginNote: "请在终端运行以下命令，扫描 QR 码完成登录：",
    loginNoteEn: "Run the following command in terminal, scan the QR code to log in:",
  },
  {
    id: "signal",
    name: "Signal",
    logo: "SG",
    brandColor: "#3A76F0",
    authType: "multi-field",
    fields: [
      {
        key: "account",
        label: "手机号码",
        labelEn: "Phone Number",
        placeholder: "+8613800138000",
      },
      {
        key: "httpUrl",
        label: "Signal CLI HTTP URL",
        placeholder: "http://127.0.0.1:8080",
      },
    ],
  },
  {
    id: "imessage",
    name: "iMessage",
    logo: "iM",
    brandColor: "#34C759",
    authType: "native",
  },
  {
    id: "msteams",
    name: "MS Teams",
    logo: "MT",
    brandColor: "#6264A7",
    authType: "multi-field",
    fields: [
      {
        key: "appId",
        label: "App ID",
        placeholder: "Azure Bot App ID...",
      },
      {
        key: "appPassword",
        label: "App Password",
        placeholder: "Azure Bot App Password...",
        secret: true,
      },
    ],
    plugin: "@openclaw/msteams",
  },
  {
    id: "matrix",
    name: "Matrix",
    logo: "MX",
    brandColor: "#0DBD8B",
    authType: "multi-field",
    fields: [
      {
        key: "homeserver",
        label: "Homeserver URL",
        placeholder: "https://matrix.org",
      },
      {
        key: "userId",
        label: "User ID",
        placeholder: "@bot:matrix.org",
      },
      {
        key: "password",
        label: "密码",
        labelEn: "Password",
        placeholder: "输入密码...",
        placeholderEn: "Enter password...",
        secret: true,
      },
    ],
    plugin: "@openclaw/matrix",
  },
  {
    id: "googlechat",
    name: "Google Chat",
    logo: "GC",
    brandColor: "#00AC47",
    authType: "multi-field",
    fields: [
      {
        key: "serviceAccount",
        label: "Service Account JSON",
        placeholder: '粘贴 GCP Service Account JSON 内容...',
        placeholderEn: "Paste GCP Service Account JSON content...",
        secret: true,
      },
      {
        key: "audience",
        label: "Audience",
        placeholder: "Project Number 或 App URL",
        placeholderEn: "Project Number or App URL",
      },
    ],
  },
  {
    id: "mattermost",
    name: "Mattermost",
    logo: "MM",
    brandColor: "#0058CC",
    authType: "token",
    fields: [
      {
        key: "token",
        label: "Bot Token",
        placeholder: "输入 Mattermost Bot Token...",
        placeholderEn: "Enter Mattermost Bot Token...",
        secret: true,
      },
    ],
    plugin: "@openclaw/mattermost",
  },
  {
    id: "line",
    name: "LINE",
    logo: "LN",
    brandColor: "#06C755",
    authType: "token",
    fields: [
      {
        key: "token",
        label: "Channel Access Token",
        placeholder: "输入 LINE Channel Access Token...",
        placeholderEn: "Enter LINE Channel Access Token...",
        secret: true,
      },
    ],
    helpUrl: "https://developers.line.biz/console/",
    plugin: "@openclaw/line",
  },
  {
    id: "nostr",
    name: "Nostr",
    logo: "NS",
    brandColor: "#8B5CF6",
    authType: "token",
    fields: [
      {
        key: "privateKey",
        label: "Private Key",
        placeholder: "nsec1...",
        secret: true,
      },
    ],
    plugin: "@openclaw/nostr",
  },
  {
    id: "irc",
    name: "IRC",
    logo: "IR",
    brandColor: "#6B7280",
    authType: "multi-field",
    fields: [
      {
        key: "host",
        label: "服务器地址",
        labelEn: "Server Address",
        placeholder: "irc.libera.chat",
      },
      {
        key: "nick",
        label: "昵称",
        labelEn: "Nickname",
        placeholder: "my-bot",
      },
    ],
  },
];

/** Locale-aware channel display name */
export function getChannelDisplayName(channel: ChatChannel, locale: string): string {
  if (locale.startsWith("zh")) return channel.name;
  return channel.nameEn ?? channel.name;
}

/** Locale-aware fallback text logo */
export function getChannelLogo(channel: ChatChannel, locale: string): string {
  if (locale.startsWith("zh")) return channel.logo;
  return channel.logoEn ?? channel.logo;
}

/** Locale-aware login note */
export function getChannelLoginNote(channel: ChatChannel, locale: string): string | undefined {
  if (locale.startsWith("zh")) return channel.loginNote;
  return channel.loginNoteEn ?? channel.loginNote;
}

/** Locale-aware field label */
export function getFieldLabel(field: ChannelField, locale: string): string {
  if (locale.startsWith("zh")) return field.label;
  return field.labelEn ?? field.label;
}

/** Locale-aware field placeholder */
export function getFieldPlaceholder(field: ChannelField, locale: string): string {
  if (locale.startsWith("zh")) return field.placeholder ?? "";
  return field.placeholderEn ?? field.placeholder ?? "";
}

export const CHANNEL_MAP = Object.fromEntries(
  [...CHAT_CHANNELS, ...HIDDEN_CHANNELS].map((c) => [c.id, c]),
);

/**
 * Maps each channel to its primary identity field key — the field that
 * uniquely identifies a bot instance within that channel.
 */
export const CHANNEL_IDENTITY_FIELD: Record<string, string> = {
  telegram: "botToken",
  discord: "token",
  slack: "botToken",
  feishu: "appId",
  signal: "account",
  msteams: "appId",
  matrix: "userId",
  googlechat: "serviceAccount",
  mattermost: "token",
  line: "token",
  nostr: "privateKey",
  irc: "nick",
};

/**
 * Check if a token value is already used by an existing account in the same channel.
 * Returns the account ID of the duplicate, or null if no duplicate found.
 */
export function findDuplicateTokenAccount(
  channelId: string,
  identityFieldKey: string,
  newValue: string,
  channelConfigs: Record<string, Record<string, unknown>>,
): string | null {
  const channelCfg = channelConfigs[channelId];
  if (!channelCfg) return null;

  const accounts = channelCfg.accounts as Record<string, Record<string, unknown>> | undefined;
  if (!accounts) return null;

  const trimmedNew = newValue.trim();
  if (!trimmedNew) return null;

  for (const [accountId, accountCfg] of Object.entries(accounts)) {
    const existing = String(accountCfg?.[identityFieldKey] ?? "").trim();
    if (existing && existing === trimmedNew) {
      return accountId;
    }
  }
  return null;
}
