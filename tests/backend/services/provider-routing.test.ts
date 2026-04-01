import { describe, expect, it } from "vitest";
import {
  ManualRoutingStrategy,
  OrchestratedRoutingStrategy,
  WeightedRoutingStrategy,
  chooseProviderForTask,
  resolveProviderForInvocation,
} from "../../../src/services/provider-routing.js";
import type { DashboardSettings, ProviderId, ProviderSettings, Subtask } from "../../../src/contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const buildProviders = (
  enabledProviders: Partial<Record<ProviderId, boolean>> = {},
): Record<ProviderId, ProviderSettings> => ({
  jules: { enabled: enabledProviders.jules ?? true, weight: 50, thinkingMode: "MEDIUM", model: "default", apiKey: "" },
  gemini: { enabled: enabledProviders.gemini ?? true, weight: 25, thinkingMode: "MEDIUM", model: "gemini-2.5-pro", apiKey: "g-key" },
  codex: { enabled: enabledProviders.codex ?? true, weight: 25, thinkingMode: "HIGH", model: "gpt-5.4", apiKey: "o-key" },
  "claude-code": { enabled: enabledProviders["claude-code"] ?? true, weight: 0, thinkingMode: "HIGH", model: "default", apiKey: "c-key" },
});

const mockSettings = (
  strategy: "MANUAL" | "WEIGHTED" | "ORCHESTRATOR",
  provider: ProviderId,
  enabledProviders: Partial<Record<ProviderId, boolean>> = {},
): DashboardSettings => ({
  ...DEFAULT_DASHBOARD_SETTINGS,
  aiProvider: {
    ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
    strategy,
    provider,
    providers: buildProviders(enabledProviders),
    invocationRouting: {
      ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting,
      task_coding: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting.task_coding,
        strategy,
      },
    },
  },
  workers: {
    ...DEFAULT_DASHBOARD_SETTINGS.workers,
    virtualWorkerProvider: "gemini",
    model: "gemini-2.5-flash",
  },
});

const mockTask = (overrides: Partial<Subtask> = {}): Subtask => ({
  id: "T-1",
  title: "Test Task",
  prompt: "Standard prompt for testing provider routing.",
  depends_on: [],
  is_independent: true,
  status: "PENDING",
  ...overrides,
});

describe("Provider Routing Logic", () => {
  describe("ManualRoutingStrategy", () => {
    const strategy = new ManualRoutingStrategy();

    it("chooses the manually selected provider if enabled", () => {
      const result = strategy.choose({
        strategy: "MANUAL",
        manualProvider: "gemini",
        providers: buildProviders(),
        enabledProviders: ["jules", "gemini"],
      }, mockTask());
      expect(result).toBe("gemini");
    });

    it("falls back to first enabled provider if selected one is disabled", () => {
      const result = strategy.choose({
        strategy: "MANUAL",
        manualProvider: "claude-code",
        providers: buildProviders({ "claude-code": false }),
        enabledProviders: ["jules"],
      }, mockTask());
      expect(result).toBe("jules");
    });
  });

  describe("WeightedRoutingStrategy", () => {
    const strategy = new WeightedRoutingStrategy();

    it("chooses based on weights and seed deterministically", () => {
      const task = mockTask({ id: "weighted-1" });
      const context = {
        strategy: "WEIGHTED" as const,
        manualProvider: null,
        providers: buildProviders(),
        enabledProviders: ["jules", "gemini"],
      };
      const result1 = strategy.choose(context, task);
      const result2 = strategy.choose(context, task);

      expect(result1).toBe(result2);
      expect(["jules", "gemini"]).toContain(result1);
    });

    it("respects zero weights", () => {
      const providers = buildProviders();
      providers.jules.weight = 0;
      providers.gemini.weight = 100;

      const result = strategy.choose({
        strategy: "WEIGHTED",
        manualProvider: null,
        providers,
        enabledProviders: ["jules", "gemini"],
      }, mockTask());
      expect(result).toBe("gemini");
    });
  });

  describe("OrchestratedRoutingStrategy", () => {
    const strategy = new OrchestratedRoutingStrategy();

    it("chooses claude-code for complex tasks", () => {
      const task = mockTask({ prompt: "Refactor the architecture of the system", depends_on: ["T-1", "T-2"] });
      const result = strategy.choose({
        strategy: "ORCHESTRATOR",
        manualProvider: null,
        providers: buildProviders(),
        enabledProviders: ["jules", "claude-code"],
      }, task);
      expect(result).toBe("claude-code");
    });

    it("chooses gemini for simple tasks", () => {
      const task = mockTask({ prompt: "Fix typo", depends_on: [] });
      const result = strategy.choose({
        strategy: "ORCHESTRATOR",
        manualProvider: null,
        providers: buildProviders(),
        enabledProviders: ["jules", "gemini"],
      }, task);
      expect(result).toBe("gemini");
    });

    it("treats missing dependency metadata as a simple task", () => {
      const task = {
        id: "T-2",
        title: "Loose task shape",
        prompt: "Fix typo",
        is_independent: true,
        status: "PENDING",
      } as Subtask;
      const result = strategy.choose({
        strategy: "ORCHESTRATOR",
        manualProvider: null,
        providers: buildProviders(),
        enabledProviders: ["jules", "gemini"],
      }, task);

      expect(result).toBe("gemini");
    });
  });

  describe("resolveProviderForInvocation", () => {
    it("uses worker profile defaults for dashboard replies", () => {
      const settings = mockSettings("MANUAL", "jules");

      const result = resolveProviderForInvocation(settings, {
        invocation: "dashboard_reply",
        task: mockTask({ prompt: "Reply to the dashboard thread" }),
        providerPool: ["gemini", "codex", "claude-code"],
      });

      expect(result.provider).toBe("gemini");
      expect(result.providers.gemini.model).toBe("gemini-2.5-flash");
    });

    it("uses worker profile defaults for clarification replies", () => {
      const settings = mockSettings("MANUAL", "codex");
      settings.aiProvider.invocationRouting.clarification_reply = {
        ...settings.aiProvider.invocationRouting.clarification_reply,
        profile: "WORKER",
        strategy: "MANUAL",
        provider: null,
      };

      const result = resolveProviderForInvocation(settings, {
        invocation: "clarification_reply",
        task: mockTask({ prompt: "Need clarification" }),
        providerPool: ["gemini", "codex", "claude-code"],
      });

      expect(result.provider).toBe("gemini");
      expect(result.providers.gemini.model).toBe("gemini-2.5-flash");
    });

    it("respects invocation-specific provider subsets and model overrides", () => {
      const settings = mockSettings("MANUAL", "jules");
      settings.aiProvider.invocationRouting.planning = {
        ...settings.aiProvider.invocationRouting.planning,
        profile: "GLOBAL",
        strategy: "MANUAL",
        provider: "codex",
        allowedProviders: ["codex"],
        providers: {
          codex: {
            model: "gpt-5.3-codex",
          },
        },
      };

      const result = resolveProviderForInvocation(settings, {
        invocation: "planning",
        task: mockTask({ prompt: "Plan the next sprint" }),
        providerPool: ["gemini", "codex", "claude-code"],
      });

      expect(result.enabledProviders).toEqual(["codex"]);
      expect(result.provider).toBe("codex");
      expect(result.providers.codex.model).toBe("gpt-5.3-codex");
    });
  });

  describe("chooseProviderForTask", () => {
    it("handles no enabled providers by returning jules", () => {
      const settings = mockSettings("MANUAL", "gemini", {
        jules: false,
        gemini: false,
        codex: false,
        "claude-code": false,
      });
      const result = chooseProviderForTask(settings, mockTask());
      expect(result).toBe("jules");
    });

    it("inherits the global weighted strategy for the default task route", () => {
      const settings = mockSettings("MANUAL", "gemini");
      settings.aiProvider.strategy = "WEIGHTED";
      settings.aiProvider.providers.jules.weight = 100;
      settings.aiProvider.providers.gemini.weight = 0;
      settings.aiProvider.providers.codex.weight = 0;
      settings.aiProvider.providers["claude-code"].weight = 0;

      expect(chooseProviderForTask(settings, mockTask())).toBe("jules");
    });

    it("keeps explicit task route overrides ahead of the global strategy", () => {
      const settings = mockSettings("MANUAL", "gemini");
      settings.aiProvider.strategy = "WEIGHTED";
      settings.aiProvider.invocationRouting.task_coding = {
        ...settings.aiProvider.invocationRouting.task_coding,
        strategy: "MANUAL",
        provider: "codex",
      };

      expect(chooseProviderForTask(settings, mockTask())).toBe("codex");
    });

    it("dispatches to the configured task strategy", () => {
      const settings = mockSettings("MANUAL", "gemini");
      expect(chooseProviderForTask(settings, mockTask())).toBe("gemini");

      settings.aiProvider.invocationRouting.task_coding.strategy = "WEIGHTED";
      settings.aiProvider.providers.jules.weight = 100;
      settings.aiProvider.providers.gemini.weight = 0;
      expect(chooseProviderForTask(settings, mockTask())).toBe("jules");
    });
  });
});
