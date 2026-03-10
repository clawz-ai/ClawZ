/**
 * Scenario-based integration tests for the onboarding flow.
 *
 * Tests the state transitions that happen as a user walks through the
 * 5-step onboarding wizard. We mock at the Tauri invoke boundary and
 * drive the flow through store actions + progress helpers — this gives
 * us fast, deterministic coverage of the business logic without needing
 * a DOM or real Tauri backend.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useOnboardingStore } from "../../stores/onboardingStore";
import {
  ONBOARDING_STEPS,
  stepToRoute,
  getResumeStepId,
  type OnboardingStepId,
} from "../onboardingProgress";

// ── helpers ────────────────────────────────────────────────────────

/** Reset onboarding store to fresh state before each test */
beforeEach(() => {
  useOnboardingStore.setState({
    currentStep: 1,
    selectedModel: "openai",
    selectedModelId: "",
    apiKey: "",
    selectedChannels: [],
    selectedScenario: "default",
    selectedToolsProfile: "messaging",
  });
});

// ── Pure helpers ───────────────────────────────────────────────────

describe("stepToRoute", () => {
  it("maps welcome to /onboarding", () => {
    expect(stepToRoute("welcome")).toBe("/onboarding");
  });

  it("maps other steps to /onboarding/{step}", () => {
    expect(stepToRoute("model")).toBe("/onboarding/model");
    expect(stepToRoute("channel")).toBe("/onboarding/channel");
    expect(stepToRoute("scenario")).toBe("/onboarding/scenario");
    expect(stepToRoute("complete")).toBe("/onboarding/complete");
  });
});

describe("getResumeStepId", () => {
  it("returns welcome when no step completed", () => {
    expect(getResumeStepId(null)).toBe("welcome");
  });

  it("returns next step after last completed", () => {
    expect(getResumeStepId("welcome")).toBe("model");
    expect(getResumeStepId("model")).toBe("channel");
    expect(getResumeStepId("channel")).toBe("scenario");
    expect(getResumeStepId("scenario")).toBe("complete");
  });

  it("returns complete when last step is complete", () => {
    expect(getResumeStepId("complete")).toBe("complete");
  });

  it("returns welcome for unknown step", () => {
    expect(getResumeStepId("nonexistent" as OnboardingStepId)).toBe("welcome");
  });
});

describe("ONBOARDING_STEPS", () => {
  it("has exactly 5 steps", () => {
    expect(ONBOARDING_STEPS).toHaveLength(5);
  });

  it("starts with welcome and ends with complete", () => {
    expect(ONBOARDING_STEPS[0]).toBe("welcome");
    expect(ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]).toBe("complete");
  });
});

// ── Scenario: Happy path (full onboarding) ────────────────────────

describe("Scenario: Complete onboarding happy path", () => {
  it("walks through all steps with correct state transitions", () => {
    const store = useOnboardingStore;
    const { getState } = store;

    // Step 1: Welcome — user starts, no state changes needed
    expect(getState().currentStep).toBe(1);

    // Step 2: Model Config — user selects a provider and model
    getState().setModel("anthropic");
    expect(getState().selectedModel).toBe("anthropic");
    expect(getState().selectedModelId).toBe(""); // cleared on model change

    getState().setApiKey("sk-ant-test-key-123");
    expect(getState().apiKey).toBe("sk-ant-test-key-123");

    getState().setModelId("claude-opus-4-6");
    expect(getState().selectedModelId).toBe("claude-opus-4-6");

    // Step 3: Channel Connect — user toggles channels
    getState().toggleChannel("telegram");
    expect(getState().selectedChannels).toEqual(["telegram"]);

    getState().toggleChannel("discord");
    expect(getState().selectedChannels).toEqual(["telegram", "discord"]);

    // Step 4: Scenario Select — user picks a scenario and tools profile
    getState().setScenario("personal-assistant");
    expect(getState().selectedScenario).toBe("personal-assistant");

    getState().setToolsProfile("full");
    expect(getState().selectedToolsProfile).toBe("full");

    // Step 5: Complete — verify final state
    getState().setStep(5);
    const final = getState();
    expect(final.currentStep).toBe(5);
    expect(final.selectedModel).toBe("anthropic");
    expect(final.selectedModelId).toBe("claude-opus-4-6");
    expect(final.selectedChannels).toEqual(["telegram", "discord"]);
    expect(final.selectedScenario).toBe("personal-assistant");
    expect(final.selectedToolsProfile).toBe("full");
  });
});

// ── Scenario: Model switch mid-flow ───────────────────────────────

describe("Scenario: User switches model provider", () => {
  it("clears modelId when provider changes", () => {
    const { getState } = useOnboardingStore;

    // Initially select OpenAI with a model
    getState().setModel("openai");
    getState().setModelId("gpt-4o");
    expect(getState().selectedModelId).toBe("gpt-4o");

    // Switch to Anthropic — modelId should reset
    getState().setModel("anthropic");
    expect(getState().selectedModel).toBe("anthropic");
    expect(getState().selectedModelId).toBe("");
  });
});

// ── Scenario: Channel toggle on/off ──────────────────────────────

describe("Scenario: Channel selection toggle behavior", () => {
  it("adds and removes channels correctly", () => {
    const { getState } = useOnboardingStore;

    // Add telegram
    getState().toggleChannel("telegram");
    expect(getState().selectedChannels).toEqual(["telegram"]);

    // Add discord
    getState().toggleChannel("discord");
    expect(getState().selectedChannels).toEqual(["telegram", "discord"]);

    // Remove telegram
    getState().toggleChannel("telegram");
    expect(getState().selectedChannels).toEqual(["discord"]);

    // Remove discord — back to empty
    getState().toggleChannel("discord");
    expect(getState().selectedChannels).toEqual([]);
  });

  it("bulk sets channels", () => {
    const { getState } = useOnboardingStore;

    getState().setChannels(["slack", "wechat", "telegram"]);
    expect(getState().selectedChannels).toEqual(["slack", "wechat", "telegram"]);

    // Overwrite with new set
    getState().setChannels(["discord"]);
    expect(getState().selectedChannels).toEqual(["discord"]);
  });
});

// ── Scenario: Resume after partial onboarding ─────────────────────

describe("Scenario: Resume from persisted progress", () => {
  it("hydrates store with saved data", () => {
    const { getState } = useOnboardingStore;

    // Simulate loading persisted data
    getState().hydrate({
      selectedModel: "deepseek",
      selectedModelId: "deepseek-chat",
      selectedChannels: ["telegram", "slack"],
      selectedScenario: "coding-helper",
      selectedToolsProfile: "coding",
    });

    const state = getState();
    expect(state.selectedModel).toBe("deepseek");
    expect(state.selectedModelId).toBe("deepseek-chat");
    expect(state.selectedChannels).toEqual(["telegram", "slack"]);
    expect(state.selectedScenario).toBe("coding-helper");
    expect(state.selectedToolsProfile).toBe("coding");
  });

  it("hydrate preserves non-overridden fields", () => {
    const { getState } = useOnboardingStore;

    getState().setApiKey("my-key");
    getState().hydrate({ selectedModel: "openai" });

    // apiKey should be preserved
    expect(getState().apiKey).toBe("my-key");
    expect(getState().selectedModel).toBe("openai");
  });

  it("resume step calculation covers full lifecycle", () => {
    // Simulate: user completed up to "model", closed app, reopened
    const resumeStep = getResumeStepId("model");
    expect(resumeStep).toBe("channel");
    expect(stepToRoute(resumeStep)).toBe("/onboarding/channel");

    // Simulate: user completed everything
    const resumeFinal = getResumeStepId("complete");
    expect(resumeFinal).toBe("complete");
  });
});

// ── Scenario: Edge cases ──────────────────────────────────────────

describe("Scenario: Edge cases", () => {
  it("toggling same channel twice returns to original state", () => {
    const { getState } = useOnboardingStore;

    const before = [...getState().selectedChannels];
    getState().toggleChannel("line");
    getState().toggleChannel("line");
    expect(getState().selectedChannels).toEqual(before);
  });

  it("setStep can go backward (user navigates back)", () => {
    const { getState } = useOnboardingStore;

    getState().setStep(5);
    expect(getState().currentStep).toBe(5);

    getState().setStep(3);
    expect(getState().currentStep).toBe(3);
  });

  it("setting empty model clears selection", () => {
    const { getState } = useOnboardingStore;

    getState().setModel("openai");
    getState().setModelId("gpt-4o");
    getState().setModel("");
    expect(getState().selectedModel).toBe("");
    expect(getState().selectedModelId).toBe("");
  });
});
