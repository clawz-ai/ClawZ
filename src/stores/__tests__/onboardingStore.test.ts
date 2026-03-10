import { describe, it, expect, beforeEach } from "vitest";
import { useOnboardingStore } from "../onboardingStore";

// Reset store state before each test
beforeEach(() => {
  useOnboardingStore.setState({
    currentStep: 1,
    selectedModel: "deepseek",
    apiKey: "",
    selectedChannels: [],
    selectedScenario: "",
  });
});

describe("onboardingStore", () => {
  it("has correct initial state", () => {
    const state = useOnboardingStore.getState();
    expect(state.currentStep).toBe(1);
    expect(state.selectedModel).toBe("deepseek");
    expect(state.apiKey).toBe("");
    expect(state.selectedChannels).toEqual([]);
    expect(state.selectedScenario).toBe("");
  });

  describe("setStep", () => {
    it("updates the current step", () => {
      useOnboardingStore.getState().setStep(3);
      expect(useOnboardingStore.getState().currentStep).toBe(3);
    });

    it("can go back to a previous step", () => {
      useOnboardingStore.getState().setStep(5);
      useOnboardingStore.getState().setStep(2);
      expect(useOnboardingStore.getState().currentStep).toBe(2);
    });
  });

  describe("setModel", () => {
    it("updates the selected model", () => {
      useOnboardingStore.getState().setModel("gpt-4");
      expect(useOnboardingStore.getState().selectedModel).toBe("gpt-4");
    });
  });

  describe("setApiKey", () => {
    it("stores the API key", () => {
      useOnboardingStore.getState().setApiKey("sk-test-123");
      expect(useOnboardingStore.getState().apiKey).toBe("sk-test-123");
    });

    it("can clear the API key", () => {
      useOnboardingStore.getState().setApiKey("sk-test-123");
      useOnboardingStore.getState().setApiKey("");
      expect(useOnboardingStore.getState().apiKey).toBe("");
    });
  });

  describe("toggleChannel", () => {
    it("adds a channel when not selected", () => {
      useOnboardingStore.getState().toggleChannel("wechat");
      expect(useOnboardingStore.getState().selectedChannels).toEqual([
        "wechat",
      ]);
    });

    it("removes a channel when already selected", () => {
      useOnboardingStore.getState().toggleChannel("wechat");
      useOnboardingStore.getState().toggleChannel("wechat");
      expect(useOnboardingStore.getState().selectedChannels).toEqual([]);
    });

    it("supports multiple channels", () => {
      useOnboardingStore.getState().toggleChannel("wechat");
      useOnboardingStore.getState().toggleChannel("slack");
      useOnboardingStore.getState().toggleChannel("discord");
      expect(useOnboardingStore.getState().selectedChannels).toEqual([
        "wechat",
        "slack",
        "discord",
      ]);
    });

    it("removes only the toggled channel", () => {
      useOnboardingStore.getState().toggleChannel("wechat");
      useOnboardingStore.getState().toggleChannel("slack");
      useOnboardingStore.getState().toggleChannel("discord");
      useOnboardingStore.getState().toggleChannel("slack");
      expect(useOnboardingStore.getState().selectedChannels).toEqual([
        "wechat",
        "discord",
      ]);
    });
  });

  describe("setScenario", () => {
    it("sets the selected scenario", () => {
      useOnboardingStore.getState().setScenario("morning-briefing");
      expect(useOnboardingStore.getState().selectedScenario).toBe(
        "morning-briefing",
      );
    });

    it("can change scenario", () => {
      useOnboardingStore.getState().setScenario("morning-briefing");
      useOnboardingStore.getState().setScenario("daily-reflection");
      expect(useOnboardingStore.getState().selectedScenario).toBe(
        "daily-reflection",
      );
    });
  });
});
