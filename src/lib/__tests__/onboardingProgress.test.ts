import { describe, it, expect } from "vitest";
import {
  ONBOARDING_STEPS,
  getResumeStepId,
  stepToRoute,
} from "../onboardingProgress";
import type { OnboardingStepId } from "../onboardingProgress";

describe("getResumeStepId", () => {
  it("returns 'welcome' when lastCompleted is null", () => {
    expect(getResumeStepId(null)).toBe("welcome");
  });

  it("returns next step after each completed step", () => {
    const expected: [OnboardingStepId, OnboardingStepId][] = [
      ["welcome", "model"],
      ["model", "channel"],
      ["channel", "scenario"],
      ["scenario", "complete"],
    ];
    for (const [completed, next] of expected) {
      expect(getResumeStepId(completed)).toBe(next);
    }
  });

  it("returns 'complete' when last step is already complete", () => {
    expect(getResumeStepId("complete")).toBe("complete");
  });
});

describe("stepToRoute", () => {
  it("maps 'welcome' to /onboarding", () => {
    expect(stepToRoute("welcome")).toBe("/onboarding");
  });

  it("maps other steps to /onboarding/<id>", () => {
    const cases: [OnboardingStepId, string][] = [
      ["model", "/onboarding/model"],
      ["channel", "/onboarding/channel"],
      ["scenario", "/onboarding/scenario"],
      ["complete", "/onboarding/complete"],
    ];
    for (const [step, route] of cases) {
      expect(stepToRoute(step)).toBe(route);
    }
  });
});

describe("ONBOARDING_STEPS", () => {
  it("has 5 steps in the correct order", () => {
    expect(ONBOARDING_STEPS).toEqual([
      "welcome",
      "model",
      "channel",
      "scenario",
      "complete",
    ]);
  });
});
