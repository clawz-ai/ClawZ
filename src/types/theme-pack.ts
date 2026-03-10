export interface ThemePack {
  id: string;
  name: string;
  emoji: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
  skills: string[];
  cron?: string;
  heartbeat?: string;
  recommended_model: string;
  estimated_monthly_cost: {
    min: number;
    max: number;
    currency: string;
  };
  preview_dialog: {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
}
