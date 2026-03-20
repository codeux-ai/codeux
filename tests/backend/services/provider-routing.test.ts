import { describe, it, expect } from "vitest";
import { 
  chooseProviderForTask, 
  ManualRoutingStrategy, 
  WeightedRoutingStrategy, 
  OrchestratedRoutingStrategy 
} from "../../../src/services/provider-routing.js";
import type { DashboardSettings, Subtask, ProviderId } from "../../../src/contracts/app-types.js";

const mockSettings = (
  strategy: "MANUAL" | "WEIGHTED" | "ORCHESTRATOR", 
  provider: ProviderId,
  enabledProviders: Record<ProviderId, boolean> = { jules: true, gemini: true, codex: true, "claude-code": true }
): DashboardSettings => ({
  aiProvider: {
    strategy,
    provider,
    providers: {
      jules: { enabled: !!enabledProviders.jules, weight: 50, thinkingMode: "MEDIUM", model: "default", apiKey: "" },
      gemini: { enabled: !!enabledProviders.gemini, weight: 25, thinkingMode: "MEDIUM", model: "default", apiKey: "" },
      codex: { enabled: !!enabledProviders.codex, weight: 25, thinkingMode: "HIGH", model: "gpt-4o", apiKey: "" },
      "claude-code": { enabled: !!enabledProviders["claude-code"], weight: 0, thinkingMode: "HIGH", model: "default", apiKey: "" },
    },
  },
} as any);

const mockTask = (overrides: Partial<Subtask> = {}): Subtask => ({
  id: "T-1",
  title: "Test Task",
  prompt: "Standard prompt for testing provider routing.",
  depends_on: [],
  is_independent: true,
  ...overrides,
});

describe("Provider Routing Logic", () => {
  describe("ManualRoutingStrategy", () => {
    const strategy = new ManualRoutingStrategy();

    it("chooses the manually selected provider if enabled", () => {
      const settings = mockSettings("MANUAL", "gemini");
      const result = strategy.choose(settings, mockTask(), ["jules", "gemini"]);
      expect(result).toBe("gemini");
    });

    it("falls back to first enabled provider if selected one is disabled", () => {
      const settings = mockSettings("MANUAL", "claude-code", { "claude-code": false, jules: true });
      const result = strategy.choose(settings, mockTask(), ["jules"]);
      expect(result).toBe("jules");
    });
  });

  describe("WeightedRoutingStrategy", () => {
    const strategy = new WeightedRoutingStrategy();

    it("chooses based on weights and seed (deterministic)", () => {
      const settings = mockSettings("WEIGHTED", "jules");
      const task = mockTask({ id: "weighted-1" });
      const result1 = strategy.choose(settings, task, ["jules", "gemini"]);
      const result2 = strategy.choose(settings, task, ["jules", "gemini"]);
      
      expect(result1).toBe(result2);
      expect(["jules", "gemini"]).toContain(result1);
    });

    it("respects zero weights", () => {
      const settings = mockSettings("WEIGHTED", "jules");
      settings.aiProvider.providers.jules.weight = 0;
      settings.aiProvider.providers.gemini.weight = 100;
      
      const result = strategy.choose(settings, mockTask(), ["jules", "gemini"]);
      expect(result).toBe("gemini");
    });
  });

  describe("OrchestratedRoutingStrategy", () => {
    const strategy = new OrchestratedRoutingStrategy();

    it("chooses claude-code for complex tasks", () => {
      const settings = mockSettings("ORCHESTRATOR", "jules");
      const task = mockTask({ prompt: "Refactor the architecture of the system", depends_on: ["T-1", "T-2"] });
      const result = strategy.choose(settings, task, ["jules", "claude-code"]);
      expect(result).toBe("claude-code");
    });

    it("chooses codex for complex tasks if claude-code is disabled", () => {
      const settings = mockSettings("ORCHESTRATOR", "jules");
      const task = mockTask({ prompt: "Refactor the architecture of the system", depends_on: ["T-1", "T-2"] });
      const result = strategy.choose(settings, task, ["jules", "codex"]);
      expect(result).toBe("codex");
    });

    it("chooses gemini for simple tasks", () => {
      const settings = mockSettings("ORCHESTRATOR", "jules");
      const task = mockTask({ prompt: "Fix typo", depends_on: [] });
      const result = strategy.choose(settings, task, ["jules", "gemini"]);
      expect(result).toBe("gemini");
    });

    it("falls back to jules if no other rules match", () => {
      const settings = mockSettings("ORCHESTRATOR", "jules");
      const task = mockTask({ prompt: "A moderately complex task but not enough for claude", depends_on: [] });
      const result = strategy.choose(settings, task, ["jules", "gemini", "claude-code"]);
      // "A moderately complex task but not enough for claude" is 51 chars, so it's < 260 -> simplePrompt.
      // Wait, let's make it > 260 to avoid gemini.
      task.prompt = "A moderately complex task but not enough for claude".repeat(10); 
      // length is ~510, > 260 but < 800. No complex keywords.
      const res = strategy.choose(settings, task, ["jules", "gemini", "claude-code"]);
      expect(res).toBe("jules");
    });
  });

  describe("chooseProviderForTask (Main Export)", () => {
    it("handles no enabled providers by returning jules", () => {
      const settings = mockSettings("MANUAL", "gemini", { jules: false, gemini: false, codex: false, "claude-code": false });
      const result = chooseProviderForTask(settings, mockTask());
      expect(result).toBe("jules");
    });

    it("dispatches to the correct strategy", () => {
      const settings = mockSettings("MANUAL", "gemini");
      expect(chooseProviderForTask(settings, mockTask())).toBe("gemini");
      
      settings.aiProvider.strategy = "WEIGHTED";
      settings.aiProvider.providers.jules.weight = 100;
      settings.aiProvider.providers.gemini.weight = 0;
      expect(chooseProviderForTask(settings, mockTask())).toBe("jules");
    });
  });
});
