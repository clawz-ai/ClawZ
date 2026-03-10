export type ChannelAuthType = "token" | "multi-field" | "login" | "native";

export interface ChannelField {
  key: string; // maps to the openclaw.json config key (e.g. "botToken")
  label: string;
  /** English label (falls back to `label` when absent) */
  labelEn?: string;
  placeholder?: string;
  /** English placeholder (falls back to `placeholder` when absent) */
  placeholderEn?: string;
  secret?: boolean;
}

export interface ChannelAccount {
  id: string;
  label?: string;
  isDefault?: boolean;
}

export interface ChatChannel {
  id: string; // openclaw channel id
  name: string;
  /** English display name (falls back to `name` when absent) */
  nameEn?: string;
  logo: string;
  /** English fallback text logo (falls back to `logo` when absent) */
  logoEn?: string;
  brandColor: string;
  authType: ChannelAuthType;
  fields?: ChannelField[];
  loginNote?: string; // instruction for interactive login channels
  /** English login note (falls back to `loginNote` when absent) */
  loginNoteEn?: string;
  helpUrl?: string;
  plugin?: string; // plugin package name, e.g. "@openclaw/feishu" — needs install
  accounts?: ChannelAccount[]; // multi-account support
}
