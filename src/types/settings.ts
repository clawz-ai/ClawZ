export interface ModelProvider {
  id: string;
  name: string;
  model: string;
  api_key_set: boolean;
  status: "connected" | "disconnected" | "error";
}

export interface ChannelConfig {
  id: string;
  name: string;
  type: string;
  connected: boolean;
}

export interface AppSettings {
  current_model: ModelProvider;
  channels: ChannelConfig[];
  theme: "light" | "dark" | "system";
  language: "zh-CN" | "en-US";
}
