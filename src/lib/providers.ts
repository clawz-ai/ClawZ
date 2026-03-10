import type { ModelProvider } from "../types/provider";

export const MODEL_PROVIDERS: ModelProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    logo: "AI",
    brandColor: "#10A37F",
    authMethod: "both",
    oauthProviderId: "openai-codex",
    apiKeyPlaceholder: "sk-...",
    apiKeyHelpUrl: "https://platform.openai.com/api-keys",
    defaultModels: ["gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2", "gpt-5.2-codex", "gpt-5.1-codex", "gpt-5-mini", "gpt-4.1", "o4-mini", "o3-mini"],
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  {
    id: "claude",
    name: "Anthropic",
    logo: "C",
    brandColor: "#D97757",
    authMethod: "both",
    ocProviderId: "anthropic",
    oauthProviderId: "claude-cli",
    apiKeyPlaceholder: "sk-ant-...",
    apiKeyHelpUrl: "https://console.anthropic.com/settings/keys",
    defaultModels: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5-20251001"],
    defaultBaseUrl: "https://api.anthropic.com/v1",
  },
  {
    id: "minimax",
    name: "MiniMax",
    logo: "MM",
    brandColor: "#E8453C",
    authMethod: "both",
    oauthProviderId: "minimax-portal",
    apiKeyPlaceholder: "sk-...",
    apiKeyHelpUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    defaultModels: ["MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2"],
    defaultBaseUrl: "https://api.minimaxi.com/anthropic",
  },
  {
    id: "zhipu",
    name: "\u667A\u8C31 AI",
    nameEn: "Zhipu AI",
    logo: "\u667A",
    brandColor: "#3366FF",
    ocProviderId: "zai",
    authMethod: "api-key",
    apiKeyPlaceholder: "sk-...",
    apiKeyHelpUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    defaultModels: ["glm-5", "glm-4.7", "glm-4.7-flash", "glm-4.6", "glm-4.6v", "glm-4.5"],
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  {
    id: "qwen",
    name: "\u901A\u4E49\u5343\u95EE",
    nameEn: "Qwen",
    logo: "\u5343",
    brandColor: "#615DEC",
    ocProviderId: "qwen-portal",
    authMethod: "both",
    oauthProviderId: "qwen-portal",
    apiKeyPlaceholder: "sk-...",
    apiKeyHelpUrl: "https://dashscope.console.aliyun.com/apiKey",
    defaultModels: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-coder"],
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
];

// Hidden providers — uncomment to re-enable
// {
//   id: "deepseek", name: "DeepSeek", logo: "DS", brandColor: "#4D6BFE",
//   authMethod: "api-key", apiKeyPlaceholder: "sk-...",
//   apiKeyHelpUrl: "https://platform.deepseek.com/api_keys",
//   defaultModels: ["deepseek-v3.2", "deepseek-chat", "deepseek-reasoner"],
// },
// {
//   id: "moonshot", name: "Moonshot", logo: "M", brandColor: "#000000",
//   authMethod: "api-key", apiKeyPlaceholder: "sk-...",
//   apiKeyHelpUrl: "https://platform.moonshot.cn/console/api-keys",
//   defaultModels: ["kimi-k2.5", "moonshot-v1-128k", "moonshot-v1-32k"],
// },
// {
//   id: "volcengine", name: "豆包/火山", logo: "豆", brandColor: "#3370FF",
//   authMethod: "api-key", apiKeyPlaceholder: "输入 API Key...",
//   apiKeyHelpUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
//   defaultModels: ["doubao-seed-1-8-251228", "doubao-1.5-pro-32k", "doubao-lite-32k"],
// },
// {
//   id: "github-copilot", name: "GitHub Copilot", logo: "GH", brandColor: "#24292F",
//   authMethod: "oauth", oauthProviderId: "github-copilot",
// },

/** Locale-aware provider display name */
export function getProviderDisplayName(provider: ModelProvider, locale: string): string {
  if (locale.startsWith("zh")) return provider.name;
  return provider.nameEn ?? provider.name;
}

export const PROVIDER_MAP = Object.fromEntries(
  MODEL_PROVIDERS.map((p) => [p.id, p]),
);

/** Reverse map: openclaw.json provider key → ModelProvider */
export const OC_PROVIDER_MAP: Record<string, ModelProvider> = Object.fromEntries(
  MODEL_PROVIDERS.flatMap((p) => {
    const entries: [string, ModelProvider][] = [];
    if (p.ocProviderId) entries.push([p.ocProviderId, p]);
    if (p.oauthProviderId) entries.push([p.oauthProviderId, p]);
    return entries;
  }),
);
