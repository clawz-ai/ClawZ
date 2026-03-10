export type AuthMethod = "api-key" | "oauth" | "both";

export interface ModelProvider {
  id: string;
  name: string;
  /** English display name (falls back to `name` when absent) */
  nameEn?: string;
  logo: string;
  brandColor: string;
  authMethod: AuthMethod;
  /** The provider key used in openclaw.json (e.g. "qwen-portal" for qwen) */
  ocProviderId?: string;
  oauthProviderId?: string;
  apiKeyPlaceholder?: string;
  apiKeyHelpUrl?: string;
  defaultModels?: string[];
  /** Default API base URL — shown as placeholder when user can customize */
  defaultBaseUrl?: string;
}

export interface ValidateKeyResult {
  success: boolean;
  error?: string;
  models?: string[];
}

export interface OAuthProgress {
  status: "device_code" | "waiting" | "success" | "error";
  verification_url?: string;
  user_code?: string;
  error?: string;
}
