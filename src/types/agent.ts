export interface Agent {
  id: string;
  name: string;
  description: string;
  status: "running" | "paused" | "stopped" | "error";
  scenario: string;
  model: string;
  created_at: string;
  last_active: string;
  trigger: string;
  output_channel: string;
}
