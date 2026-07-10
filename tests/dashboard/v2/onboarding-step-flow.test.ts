import { describe, expect, it } from "vitest";
import {
  createInitialOnboardingFlowState,
  getOnboardingStepsForMode,
  onboardingFlowReducer,
} from "../../../dashboard/src/v2/components/onboarding/use-onboarding-step-flow.js";

describe("Easy onboarding step flow", () => {
  it("includes the shared setup steps and keeps provider selection mutable", () => {
    expect(getOnboardingStepsForMode("EASY").map((step) => step.id)).toEqual([
      "mode",
      "installation",
      "introduction",
      "providers",
      "provider-setup",
      "git",
    ]);

    let state = onboardingFlowReducer(createInitialOnboardingFlowState(), {
      type: "select-experience-mode",
      mode: "EASY",
    });
    state = onboardingFlowReducer(state, { type: "set-selected-providers", providers: ["codex"] });
    state = onboardingFlowReducer(state, { type: "toggle-provider", provider: "codex" });
    expect(state.selectedProviders).toEqual([]);

    state = onboardingFlowReducer(state, { type: "toggle-provider", provider: "gemini" });
    expect(state.selectedProviders).toEqual(["gemini"]);
  });
});
