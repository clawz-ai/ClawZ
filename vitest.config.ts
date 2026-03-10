import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
      thresholds: {
        // ── Utility functions — target 90%+ ──
        "src/lib/bindings.ts": { statements: 90, branches: 90, functions: 90 },
        "src/lib/env.ts": { statements: 90, branches: 80, functions: 90 },
        // Pure function coverage limited by isTauriEnv() early returns in node env
        "src/lib/onboardingProgress.ts": { statements: 20, branches: 20, functions: 20 },
        // ── Stores — target 80%+ ──
        "src/stores/onboardingStore.ts": { statements: 80, branches: 80, functions: 80 },
        "src/stores/agentStore.ts": { statements: 80, branches: 80, functions: 80 },
        // appStore/settingsStore have Tauri plugin-store deps, lower threshold in node env
        "src/stores/appStore.ts": { statements: 60, branches: 0, functions: 60 },
        "src/stores/settingsStore.ts": { statements: 25, branches: 10, functions: 30 },
      },
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
