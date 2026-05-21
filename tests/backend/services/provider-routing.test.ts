import { describe, expect, it } from "vitest";
import {
  ManualRoutingStrategy,
  AgentRoutingStrategy,
  resolveWorkerModelForProvider,
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
  "qwen-code": { enabled: enabledProviders["qwen-code"] ?? false, weight: 0, thinkingMode: "HIGH", model: "qwen3-coder-plus", apiKey: "q-key" },
  opencode: { enabled: enabledProviders.opencode ?? false, weight: 0, thinkingMode: "HIGH", model: "anthropic/claude-sonnet-4-5", apiKey: "opencode-key" },
});

const mockSettings = (
  strategy: "MANUAL" | "WEIGHTED" | "AGENT",
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
  git: {
    ...DEFAULT_DASHBOARD_SETTINGS.git,
    githubMode: "REMOTE",
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

  describe("AgentRoutingStrategy", () => {
    const strategy = new AgentRoutingStrategy();

    it("chooses the configured agent provider when it is eligible", () => {
      const task = mockTask({ prompt: "Refactor the architecture of the system" });
      const result = strategy.choose({
        strategy: "AGENT",
        manualProvider: null,
        agentProvider: "claude-code",
        providers: buildProviders(),
        enabledProviders: ["jules", "claude-code"],
      }, task);
      expect(result).toBe("claude-code");
    });

    it("falls back to the route manual provider when the agent has no provider", () => {
      const task = mockTask({ prompt: "Fix typo", depends_on: [] });
      const result = strategy.choose({
        strategy: "AGENT",
        manualProvider: "gemini",
        agentProvider: null,
        providers: buildProviders(),
        enabledProviders: ["jules", "gemini"],
      }, task);
      expect(result).toBe("gemini");
    });

    it("falls back when the agent provider is outside the eligible pool", () => {
      const task = {
        id: "T-2",
        title: "Loose task shape",
        prompt: "Fix typo",
        is_independent: true,
        status: "PENDING",
      } as Subtask;
      const result = strategy.choose({
        strategy: "AGENT",
        manualProvider: "jules",
        agentProvider: "codex",
        providers: buildProviders(),
        enabledProviders: ["jules", "gemini"],
      }, task);

      expect(result).toBe("jules");
    });
  });

  describe("resolveProviderForInvocation", () => {
  it("filters out jules when githubMode is LOCAL", () => {
    const settings = mockSettings("AGENT", "jules", { jules: true, gemini: true });
    settings.git.githubMode = "LOCAL";
    const result = resolveProviderForInvocation(settings, {
      invocation: "task_coding",
      task: mockTask(),
    });
    // jules is explicitly disabled because LOCAL mode, so it should fallback to the next provider
    expect(result.provider).not.toBe("jules");
    expect(result.enabledProviders).not.toContain("jules");
    expect(result.enabledProviders).toContain("gemini");
  });
    it("uses an agent provider and model when the route strategy is Agent", () => {
      const settings = mockSettings("AGENT", "jules", { gemini: true, opencode: false });
      settings.aiProvider.invocationRouting.dashboard_reply = {
        ...settings.aiProvider.invocationRouting.dashboard_reply,
        profile: "WORKER",
        strategy: "AGENT",
        provider: null,
        allowedProviders: [],
        providers: {},
      };

      const result = resolveProviderForInvocation(settings, {
        invocation: "dashboard_reply",
        task: mockTask({ prompt: "Reply to the dashboard thread" }),
        providerPool: ["gemini", "codex", "claude-code", "qwen-code", "opencode"],
        agentProvider: {
          providerConfigId: "opencode",
          model: "openai/gpt-5",
        },
      });

      expect(result.provider).toBe("opencode");
      expect(result.providerConfigId).toBe("opencode");
      expect(result.enabledProviders).toContain("opencode");
      expect(result.providers.opencode.model).toBe("openai/gpt-5");
    });
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

    it("falls back to the selected provider model when the worker model belongs to another provider", () => {
      const settings = mockSettings("MANUAL", "jules");
      settings.workers.virtualWorkerProvider = "gemini";
      settings.workers.model = "gpt-5.3-codex";

      const result = resolveProviderForInvocation(settings, {
        invocation: "planning",
        task: mockTask({ prompt: "Plan the next sprint" }),
        providerPool: ["gemini", "codex", "claude-code"],
      });

      expect(result.provider).toBe("gemini");
      expect(result.providers.gemini.model).toBe("gemini-2.5-pro");
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

    it("treats a manually selected route provider as eligible even when the base provider is disabled", () => {
      const settings = mockSettings("MANUAL", "jules", { gemini: true, opencode: false });
      settings.aiProvider.invocationRouting.dashboard_reply = {
        ...settings.aiProvider.invocationRouting.dashboard_reply,
        profile: "WORKER",
        strategy: "MANUAL",
        provider: "opencode",
        allowedProviders: [],
        providers: {
          opencode: {
            model: "openai/gpt-5",
          },
        },
      };

      const result = resolveProviderForInvocation(settings, {
        invocation: "dashboard_reply",
        task: mockTask({ prompt: "Reply to the dashboard thread" }),
        providerPool: ["gemini", "codex", "claude-code", "qwen-code", "opencode"],
      });

      expect(result.provider).toBe("opencode");
      expect(result.providerConfigId).toBe("opencode");
      expect(result.enabledProviders).toContain("opencode");
      expect(result.providers.opencode.model).toBe("openai/gpt-5");
    });

    it("respects an explicit disabled override for the manually selected route provider", () => {
      const settings = mockSettings("MANUAL", "jules", { gemini: true, opencode: false });
      settings.aiProvider.invocationRouting.dashboard_reply = {
        ...settings.aiProvider.invocationRouting.dashboard_reply,
        profile: "WORKER",
        strategy: "MANUAL",
        provider: "opencode",
        allowedProviders: [],
        providers: {
          opencode: {
            enabled: false,
          },
        },
      };

      const result = resolveProviderForInvocation(settings, {
        invocation: "dashboard_reply",
        task: mockTask({ prompt: "Reply to the dashboard thread" }),
        providerPool: ["gemini", "codex", "claude-code", "qwen-code", "opencode"],
      });

      expect(result.provider).toBe("gemini");
      expect(result.enabledProviders).not.toContain("opencode");
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

    it("ignores the legacy global strategy and uses the route strategy", () => {
      const settings = mockSettings("MANUAL", "gemini");
      settings.aiProvider.strategy = "WEIGHTED";
      settings.aiProvider.providers.jules.weight = 100;
      settings.aiProvider.providers.gemini.weight = 0;
      settings.aiProvider.providers.codex.weight = 0;
      settings.aiProvider.providers["claude-code"].weight = 0;

      expect(chooseProviderForTask(settings, mockTask())).toBe("gemini");
    });

    it("keeps explicit task route overrides independent of the legacy global strategy", () => {
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

  describe("resolveWorkerModelForProvider", () => {
    it("keeps a valid worker override for the selected provider", () => {
      expect(resolveWorkerModelForProvider("gemini", "gemini-2.5-flash", "gemini-2.5-pro")).toBe("gemini-2.5-flash");
    });

    it("ignores an incompatible worker override", () => {
      expect(resolveWorkerModelForProvider("claude-code", "gpt-5.3-codex", "opus")).toBe("opus");
    });
  });
});
