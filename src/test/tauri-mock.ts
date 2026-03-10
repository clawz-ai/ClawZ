/**
 * Standardised Tauri mock helpers for Vitest.
 *
 * Usage (at the top of any test file that imports from "../lib/tauri"):
 *
 *   import { tauriMock } from "../../test/tauri-mock";
 *
 *   vi.mock("../../lib/tauri", () => tauriMock);
 *
 *   // Override specific commands per-test:
 *   vi.mocked(tauriMock.runEnvCheck).mockResolvedValue([
 *     { name: "Node.js", status: "pass", message: "v22.0.0" },
 *   ]);
 *
 * All functions return sensible defaults (empty arrays, success strings, etc.)
 * so tests only need to override what they care about.
 */
import { vi } from "vitest";

// ── Default return values ─────────────────────────────────────────

const emptyArr: never[] = [];
const ok = "ok";

export const tauriMock = {
  // env & system
  appLog: vi.fn(),
  runEnvCheck: vi.fn().mockResolvedValue(emptyArr),
  autoFixEnv: vi.fn().mockResolvedValue(ok),
  getSystemInfo: vi.fn().mockResolvedValue({
    os: "macOS", arch: "aarch64", version: "15.3", hostname: "test",
  }),

  // gateway
  getGatewayStatus: vi.fn().mockResolvedValue({
    running: false, gateway: null, agents: null, channels: null, model: null,
  }),
  startGateway: vi.fn().mockResolvedValue(ok),
  stopGateway: vi.fn().mockResolvedValue(ok),
  restartGateway: vi.fn().mockResolvedValue(ok),
  scheduleGatewayRestart: vi.fn(),
  runDoctor: vi.fn().mockResolvedValue(ok),

  // install
  checkOpenClawInstalled: vi.fn().mockResolvedValue("installed"),
  renameStaleOpenclawDir: vi.fn().mockResolvedValue(ok),
  installOpenClaw: vi.fn().mockResolvedValue(ok),
  uninstallOpenClaw: vi.fn().mockResolvedValue(ok),

  // model
  validateApiKey: vi.fn().mockResolvedValue({ valid: true }),
  configureProvider: vi.fn().mockResolvedValue(ok),
  startOAuthFlow: vi.fn().mockResolvedValue(ok),
  cancelOAuthFlow: vi.fn().mockResolvedValue(ok),
  fetchProviderModels: vi.fn().mockResolvedValue([]),
  listAllAvailableModels: vi.fn().mockResolvedValue({ count: 0, models: [] }),
  listConfiguredModels: vi.fn().mockResolvedValue({ count: 0, models: [] }),

  // channel
  addChannel: vi.fn().mockResolvedValue(ok),
  disableChannel: vi.fn().mockResolvedValue(ok),
  removeChannelAccount: vi.fn().mockResolvedValue(ok),
  installChannelPlugin: vi.fn().mockResolvedValue(ok),
  validateChannelCredentials: vi.fn().mockResolvedValue(ok),

  // config
  readOpenClawConfig: vi.fn().mockResolvedValue({}),
  setConfigValue: vi.fn().mockResolvedValue(ok),

  // logs
  readGatewayLogs: vi.fn().mockResolvedValue([]),
  readAppLogs: vi.fn().mockResolvedValue([]),

  // agents
  listAgents: vi.fn().mockResolvedValue([]),
  createAgent: vi.fn().mockResolvedValue(ok),
  deleteAgent: vi.fn().mockResolvedValue(ok),
  getAgentBindings: vi.fn().mockResolvedValue([]),
  bindAgentChannel: vi.fn().mockResolvedValue(ok),
  unbindAgentChannel: vi.fn().mockResolvedValue(ok),
  listChannelAccounts: vi.fn().mockResolvedValue({}),
  listAgentSessions: vi.fn().mockResolvedValue([]),

  // cron
  listCronJobs: vi.fn().mockResolvedValue({ jobs: [] }),
  createCronJob: vi.fn().mockResolvedValue(ok),
  editCronJob: vi.fn().mockResolvedValue(ok),
  deleteCronJob: vi.fn().mockResolvedValue(ok),
  enableCronJob: vi.fn().mockResolvedValue(ok),
  disableCronJob: vi.fn().mockResolvedValue(ok),
  getCronRuns: vi.fn().mockResolvedValue([]),

  // usage
  computeUsageStats: vi.fn().mockResolvedValue({ totalTokens: 0, totalCost: 0, byModel: {} }),

  // scenario / skills
  readAgentPersona: vi.fn().mockResolvedValue(""),
  applyScenario: vi.fn().mockResolvedValue(ok),
  setToolsProfile: vi.fn().mockResolvedValue(ok),
  enableScenarioSkills: vi.fn().mockResolvedValue(ok),
  listSkills: vi.fn().mockResolvedValue([]),
  setSkillEnabled: vi.fn().mockResolvedValue(ok),
  installSkillDeps: vi.fn().mockResolvedValue(ok),
  getTrustedSources: vi.fn().mockResolvedValue(["bundled"]),
  setTrustedSources: vi.fn().mockResolvedValue(ok),

  // backup
  exportConfig: vi.fn().mockResolvedValue(ok),
  importConfig: vi.fn().mockResolvedValue(ok),
};

/** Reset all mocks to their default resolved values (call in afterEach). */
export function resetTauriMocks(): void {
  for (const fn of Object.values(tauriMock)) {
    if (typeof fn === "function" && "mockClear" in fn) {
      (fn as ReturnType<typeof vi.fn>).mockClear();
    }
  }
}
