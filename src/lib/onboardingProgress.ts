import { load, type Store } from "@tauri-apps/plugin-store";
import { isTauriEnv } from "./env";

/** Ordered onboarding step IDs — each matches a route segment under /onboarding */
export const ONBOARDING_STEPS = [
  "welcome",
  "model",
  "channel",
  "scenario",
  "complete",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

const STORE_FILE = "clawz-state.json";
const KEY_LAST_COMPLETED = "onboarding.lastCompletedStep";
const KEY_DATA = "onboarding.data";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { autoSave: true } as Parameters<typeof load>[1]);
  }
  return storePromise;
}

/** Convert a step ID to its route path */
export function stepToRoute(stepId: OnboardingStepId): string {
  return stepId === "welcome" ? "/onboarding" : `/onboarding/${stepId}`;
}

/** Given the last completed step, return which step to resume at */
export function getResumeStepId(
  lastCompleted: OnboardingStepId | null,
): OnboardingStepId {
  if (!lastCompleted) return "welcome";
  const idx = ONBOARDING_STEPS.indexOf(lastCompleted);
  if (idx === -1) return "welcome";
  if (idx >= ONBOARDING_STEPS.length - 1) return "complete";
  return ONBOARDING_STEPS[idx + 1];
}

/** Read the last completed step from persistent store */
export async function loadLastCompletedStep(): Promise<OnboardingStepId | null> {
  if (!isTauriEnv()) return null;
  try {
    const store = await getStore();
    const val = await store.get<string>(KEY_LAST_COMPLETED);
    if (val && (ONBOARDING_STEPS as readonly string[]).includes(val)) {
      return val as OnboardingStepId;
    }
    return null;
  } catch (e) {
    console.warn("loadLastCompletedStep failed:", e);
    return null;
  }
}

/** Mark a step as completed (only advances forward, never backward) */
export async function markStepCompleted(
  stepId: OnboardingStepId,
): Promise<void> {
  if (!isTauriEnv()) return;
  try {
    const store = await getStore();
    const current = await store.get<string>(KEY_LAST_COMPLETED);
    const currentIdx = current
      ? ONBOARDING_STEPS.indexOf(current as OnboardingStepId)
      : -1;
    const newIdx = ONBOARDING_STEPS.indexOf(stepId);
    if (newIdx > currentIdx) {
      await store.set(KEY_LAST_COMPLETED, stepId);
    }
  } catch (e) {
    console.warn("markStepCompleted failed:", e);
  }
}

/** Persist onboarding selections (model, channels, scenario) */
export async function saveOnboardingData(data: {
  selectedModel?: string;
  selectedModelId?: string;
  selectedChannels?: string[];
  selectedScenario?: string;
  selectedToolsProfile?: string;
}): Promise<void> {
  if (!isTauriEnv()) return;
  try {
    const store = await getStore();
    const existing =
      (await store.get<Record<string, unknown>>(KEY_DATA)) ?? {};
    await store.set(KEY_DATA, { ...existing, ...data });
  } catch (e) {
    console.warn("saveOnboardingData failed:", e);
  }
}

/** Clear all onboarding progress (used when openclaw is uninstalled) */
export async function resetOnboardingProgress(): Promise<void> {
  if (!isTauriEnv()) return;
  try {
    const store = await getStore();
    await store.delete(KEY_LAST_COMPLETED);
    await store.delete(KEY_DATA);
  } catch (e) {
    console.warn("resetOnboardingProgress failed:", e);
  }
}

/** Load persisted onboarding selections */
export async function loadOnboardingData(): Promise<{
  selectedModel?: string;
  selectedModelId?: string;
  selectedChannels?: string[];
  selectedScenario?: string;
  selectedToolsProfile?: string;
} | null> {
  if (!isTauriEnv()) return null;
  try {
    const store = await getStore();
    return (await store.get(KEY_DATA)) ?? null;
  } catch (e) {
    console.warn("loadOnboardingData failed:", e);
    return null;
  }
}
