import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildDefaultProjectSettings,
  sanitizeProjectSettings,
  resolveDashboardSettings,
  sanitizeSystemSettings,
  resolveProjectSettings,
  resolveSprintProjectSettings,
} from "../../../src/services/settings-resolution-service.js";
import { ScopedEffectiveSettingsResolver } from "../../../src/repositories/settings-repository.js";
import { DEFAULT_DASHBOARD_SETTINGS, DEFAULT_SKILLS } from "../../../src/repositories/settings-defaults.js";
import { DEFAULT_INSTRUCTION_TEMPLATES } from "../../../src/instructions/instruction-template-catalog.js";
import type { SystemSettings, ProjectSettingsOverride } from "../../../src/contracts/settings-scope-types.js";

describe("Settings Resolution Service", () => {
  describe("Provider Pricing Normalization", () => {
    it("should default pricing to zero if not provided", () => {
      const systemSettings = sanitizeSystemSettings({ integrations: { providers: { jules: { provider: "jules" } } } } as any);
      expect(systemSettings.integrations.providers["jules"].pricing).toEqual({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
    });

    it("should preserve explicitly configured pricing", () => {
      const pricing = { inputTokens: 2, outputTokens: 10, cachedInputTokens: 1 };
      const systemSettings = sanitizeSystemSettings({ integrations: { providers: { jules: { provider: "jules", pricing } } } } as any);
      expect(systemSettings.integrations.providers["jules"].pricing).toEqual(pricing);
    });

    it("should pass pricing through dashboard provider settings resolution", () => {
      const pricing = { inputTokens: 3, outputTokens: 15, cachedInputTokens: 0 };
      const systemSettings = {
        runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
        integrations: { providers: { jules: { provider: "jules", pricing } }, githubToken: "" },
      };
      const systemSettingsMock = sanitizeSystemSettings(systemSettings as any);
      systemSettingsMock.integrations.providers["jules"].pricing = pricing;
      const dashboard = resolveDashboardSettings({ systemSettings: { ...systemSettingsMock, defaults: buildDefaultProjectSettings(), mcpTools: [], customMcpServers: [] } as any });
      expect(dashboard.settings.aiProvider.providers["jules"].pricing).toEqual(pricing);
    });
  });
  describe("buildDefaultProjectSettings", () => {
    it("should return a complete ProjectSettings with all required fields populated", () => {
      const settings = buildDefaultProjectSettings();
      expect(settings).toBeDefined();
      expect(settings.automationLevel).toBe(DEFAULT_DASHBOARD_SETTINGS.automationLevel);
      expect(settings.automationInterventions).toBeDefined();
      expect(settings.aiProvider).toBeDefined();
      expect(settings.git).toBeDefined();
      expect(settings.ciIntelligence).toBeDefined();
      expect(settings.sprintLoopSteps).toBeDefined();
      expect(settings.cliWorkflow).toBeDefined();
      expect(settings.sprintPreview).toBeDefined();
      expect(settings.workers).toBeDefined();
      expect(settings.agents).toBeDefined();
      expect(settings.skills).toBeDefined();
      expect(settings.memory).toBeDefined();
    });

    it("should have default provider entries existing", () => {
      const settings = buildDefaultProjectSettings();
      const providers = settings.aiProvider.providers;
      expect(providers.jules).toBeDefined();
      expect(providers.gemini).toBeDefined();
      expect(providers.codex).toBeDefined();
      expect(providers["claude-code"]).toBeDefined();
    });

    it("should include default skills and instruction templates", () => {
      const settings = buildDefaultProjectSettings();
      expect(settings.skills).toEqual(DEFAULT_SKILLS);
      expect(settings.agents.instructionTemplates).toEqual(DEFAULT_INSTRUCTION_TEMPLATES);
    });

    it("uses the updated CI, memory, and QA defaults", () => {
      const settings = buildDefaultProjectSettings();
      expect(settings.ciIntelligence.featurePrAutoMergeMode).toBe("ALWAYS");
      expect(settings.ciIntelligence.mainBranchAutoMergeMode).toBe("CREATE_PR");
      expect(settings.ciIntelligence.resolveMergeConflicts).toBe(true);
      expect(settings.ciIntelligence.resolveMainMergeConflicts).toBe(true);
      expect(settings.memory.enabled).toBe(true);
      expect(settings.agents.qualityAssurance.enabled).toBe(true);
    });
  });

  describe("sanitizeProjectSettings", () => {
    it("should return a valid ProjectSettings with defaults filled in given an empty input", () => {
      const settings = sanitizeProjectSettings({});
      expect(settings.automationLevel).toBe(DEFAULT_DASHBOARD_SETTINGS.automationLevel);
      expect(settings.aiProvider.provider).toBe(DEFAULT_DASHBOARD_SETTINGS.aiProvider.provider);
      expect(settings.skills.length).toBeGreaterThan(0);
      expect(settings.agents.instructionTemplates).toBeDefined();
    });

    it("should clamp invalid numeric values", () => {
      const input = {
        agents: {
          qualityAssurance: {
            maxTaskReviewRuns: -5,
          },
        },
      };
      const settings = sanitizeProjectSettings(input);
      expect(settings.agents.qualityAssurance.maxTaskReviewRuns).toBeGreaterThanOrEqual(0);
    });

    it("should drop unknown extra keys", () => {
      const input = {
        unknownKey: "value",
        agents: {
          someFakeAgent: true,
        },
      };
      const settings = sanitizeProjectSettings(input) as any;
      expect(settings.unknownKey).toBeUndefined();
      expect(settings.agents.someFakeAgent).toBeUndefined();
    });

    it("preserves valid appearance background image and pattern settings", () => {
      const settings = sanitizeProjectSettings({
        appearance: {
          backgroundMode: "STATIC",
          animatedBackground: "aurora-borealis",
          staticBackgroundColor: "#123456",
          backgroundImage: "data:image/jpeg;base64,abc123",
          backgroundPattern: "DOTS",
        },
      });

      expect(settings.appearance.backgroundMode).toBe("STATIC");
      expect(settings.appearance.animatedBackground).toBe("aurora-borealis");
      expect(settings.appearance.staticBackgroundColor).toBe("#123456");
      expect(settings.appearance.backgroundImage).toBe("data:image/jpeg;base64,abc123");
      expect(settings.appearance.backgroundPattern).toBe("DOTS");
    });

    it("normalizes invalid appearance background image and pattern settings", () => {
      const settings = sanitizeProjectSettings({
        appearance: {
          backgroundImage: "javascript:alert(1)",
          backgroundPattern: "SPIRAL",
        },
      });

      expect(settings.appearance.backgroundImage).toBe(null);
      expect(settings.appearance.backgroundPattern).toBe("NONE");
    });
  });

  describe("sanitizeSystemSettings", () => {
    it("should sanitize system settings appropriately", () => {
      const settings = sanitizeSystemSettings({});
      expect(settings).toBeDefined();
      expect(settings.runtime).toBeDefined();
      expect(settings.integrations).toBeDefined();
    });
  });

  describe("resolveDashboardSettings", () => {
    it("should return project settings as effective when no system settings override provided", () => {
      const baseProject = buildDefaultProjectSettings();
      const systemSettings: SystemSettings = {
        runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
        integrations: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", "claudeCodeApiKey": "", githubToken: "" },
        defaults: baseProject,
        mcpTools: [],
      };
      const resolved = resolveDashboardSettings({
        systemSettings,
        projectOverride: null,
      });
      expect(resolved.settings.automationLevel).toBe(baseProject.automationLevel);
      expect(resolved.settings.aiProvider.provider).toBe(baseProject.aiProvider.provider);
    });

    it("includes resolved appearance background image and pattern settings", () => {
      const baseProject = buildDefaultProjectSettings();
      baseProject.appearance.backgroundImage = "https://example.com/background.png";
      baseProject.appearance.backgroundPattern = "HEXAGONS";
      const systemSettings: SystemSettings = {
        runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
        integrations: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", "claudeCodeApiKey": "", githubToken: "" },
        defaults: baseProject,
        mcpTools: [],
      };
      const resolved = resolveDashboardSettings({
        systemSettings,
        projectOverride: null,
      });

      expect(resolved.settings.appearance.backgroundImage).toBe("https://example.com/background.png");
      expect(resolved.settings.appearance.backgroundPattern).toBe("HEXAGONS");
    });

    it("should include API key when system integration settings provide it", () => {
      const baseProject = buildDefaultProjectSettings();
      const systemSettings: SystemSettings = {
        runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
        integrations: { julesApiKey: "fake-jules-key", geminiApiKey: "", codexApiKey: "", "claudeCodeApiKey": "", githubToken: "fake-github-token" },
        defaults: baseProject,
        mcpTools: [],
      };
      const resolved = resolveDashboardSettings({
        systemSettings,
        projectOverride: null,
      });
      expect(resolved.settings.aiProvider.providers.jules?.apiKey).toBe("fake-jules-key");
      expect(resolved.settings.git.githubToken).toBe("fake-github-token");
    });

    it("preserves explicit project overrides for CI, memory, and QA settings", () => {
      const baseProject = buildDefaultProjectSettings();
      const systemSettings: SystemSettings = {
        runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
        integrations: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", "claudeCodeApiKey": "", githubToken: "" },
        defaults: baseProject,
        mcpTools: [],
      };

      const resolved = resolveDashboardSettings({
        systemSettings,
        projectOverride: {
          ciIntelligence: {
            featurePrAutoMergeMode: "OFF",
            mainBranchAutoMergeMode: "OFF",
            resolveMergeConflicts: false,
            resolveMainMergeConflicts: false,
          },
          memory: {
            enabled: false,
          },
          agents: {
            qualityAssurance: {
              enabled: false,
            },
          },
        },
      });

      expect(resolved.settings.ciIntelligence.featurePrAutoMergeMode).toBe("OFF");
      expect(resolved.settings.ciIntelligence.mainBranchAutoMergeMode).toBe("OFF");
      expect(resolved.settings.ciIntelligence.resolveMergeConflicts).toBe(false);
      expect(resolved.settings.ciIntelligence.resolveMainMergeConflicts).toBe(false);
      expect(resolved.settings.memory.enabled).toBe(false);
      expect(resolved.settings.agents.qualityAssurance.enabled).toBe(false);
    });

    it("enforces the system provider concurrency cap as a hard ceiling over project overrides", () => {
      const baseProject = buildDefaultProjectSettings();
      baseProject.aiProvider.providers.jules.maxConcurrentTasks = 15;
      const systemSettings: SystemSettings = {
        runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
        integrations: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", "claudeCodeApiKey": "", githubToken: "" },
        defaults: baseProject,
        mcpTools: [],
      };

      // A project override that tries to RAISE the cap above the system value is clamped down.
      const raised = resolveDashboardSettings({
        systemSettings,
        projectOverride: { aiProvider: { providers: { jules: { maxConcurrentTasks: 50 } } } } as unknown as ProjectSettingsOverride,
      });
      expect(raised.settings.aiProvider.providers.jules.maxConcurrentTasks).toBe(15);

      // A project override that LOWERS the cap below the system value is honored.
      const lowered = resolveDashboardSettings({
        systemSettings,
        projectOverride: { aiProvider: { providers: { jules: { maxConcurrentTasks: 5 } } } } as unknown as ProjectSettingsOverride,
      });
      expect(lowered.settings.aiProvider.providers.jules.maxConcurrentTasks).toBe(5);

      // A project requesting "unlimited" (0) is still bounded by the system cap.
      const unlimited = resolveDashboardSettings({
        systemSettings,
        projectOverride: { aiProvider: { providers: { jules: { maxConcurrentTasks: 0 } } } } as unknown as ProjectSettingsOverride,
      });
      expect(unlimited.settings.aiProvider.providers.jules.maxConcurrentTasks).toBe(15);
    });

    it("merges custom MCP servers and tool toggles across system and project scope", () => {
      const baseProject = buildDefaultProjectSettings();
      const systemSettings: SystemSettings = {
        runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
        integrations: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", "claudeCodeApiKey": "", githubToken: "" },
        defaults: baseProject,
        mcpTools: [],
        customMcpServers: [
          { id: "s1", name: "sys", url: "https://sys/mcp", enabled: true },
        ],
      } as unknown as SystemSettings;

      const projectOverride = {
        customMcpServers: [
          { id: "s1", name: "sys", url: "https://sys/mcp", enabled: false },
          { id: "p1", name: "proj", url: "https://proj/mcp", enabled: true },
        ],
        mcpTools: [
          { name: "manage_tasks", enabled: false },
        ],
      } as unknown as ProjectSettingsOverride;

      const resolved = resolveDashboardSettings({ systemSettings, projectOverride });

      const servers = resolved.settings.customMcpServers;
      expect(servers.find((s) => s.id === "s1")?.enabled).toBe(false);
      expect(servers.find((s) => s.id === "p1")?.enabled).toBe(true);

      expect(resolved.settings.mcpTools.find((t) => t.name === "manage_tasks")?.enabled).toBe(false);
      expect(resolved.settings.mcpTools.find((t) => t.name === "manage_projects")?.enabled).toBe(true);
    });
  });

  describe("resolveProjectSettings", () => {
    it("should resolve project settings", () => {
      const baseProject = buildDefaultProjectSettings();
      const systemSettings: SystemSettings = {
        runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
        integrations: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", "claudeCodeApiKey": "", githubToken: "" } as any,
        defaults: baseProject,
        mcpTools: [],
      };
      const settings = resolveProjectSettings(systemSettings, { automationLevel: "FULL" });
      expect(settings.automationLevel).toBe("FULL");
    });

    it("should preserve custom integrations from systemSettings", () => {
      const baseProject = buildDefaultProjectSettings();
      const customProviderId = "codex-custom-2";
      const systemSettings: SystemSettings = {
        runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
        integrations: {
          providers: {
            [customProviderId]: {
              provider: "codex",
              name: "Custom Codex 2",
              apiKey: "test-api-key",
              mountAuth: false,
              authPath: "",
            },
          },
          githubToken: "",
          jira: {
            host: "",
            email: "",
            apiToken: "",
            autoCloseLinkedIssues: false,
            defaultProject: "",
            closeTransitionName: "Done",
          },
        },
        defaults: baseProject,
        mcpTools: [],
      };
      const settings = resolveProjectSettings(systemSettings, {
        aiProvider: {
          providers: {
            [customProviderId]: {
              provider: "codex",
              name: "Custom Codex 2",
              enabled: true,
              model: "gpt-5.3-codex",
              weight: 50,
              thinkingMode: "HIGH",
              maxConcurrentTasks: 0,
            },
          },
        },
      });
      expect(settings.aiProvider.providers[customProviderId]).toBeDefined();
      expect(settings.aiProvider.providers[customProviderId]?.name).toBe("Custom Codex 2");
      expect(settings.aiProvider.providers[customProviderId]?.weight).toBe(50);
    });
  });

  describe("resolveSprintProjectSettings", () => {
    it("should resolve sprint settings", () => {
      const baseProject = buildDefaultProjectSettings();
      const systemSettings: SystemSettings = {
        runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
        integrations: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", "claudeCodeApiKey": "", githubToken: "" },
        defaults: baseProject,
        mcpTools: [],
      };
      const settings = resolveSprintProjectSettings(systemSettings, null, { automationLevel: "SEMI_AUTO" });
      expect(settings.automationLevel).toBe("SEMI_AUTO");
    });
  });

  describe("ScopedEffectiveSettingsResolver", () => {
    let mockRepo: any;
    let resolver: ScopedEffectiveSettingsResolver;
    let mockSystemSettings: SystemSettings;
    let mockProjectSettingsOverride: ProjectSettingsOverride;

    beforeEach(() => {
      mockSystemSettings = {
        runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
        integrations: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", "claudeCodeApiKey": "", githubToken: "" },
        defaults: buildDefaultProjectSettings(),
        mcpTools: [],
      };
      mockProjectSettingsOverride = {
        automationLevel: "FULL",
      };

      mockRepo = {
        getSystemSettings: vi.fn().mockReturnValue(mockSystemSettings),
        getProjectSettings: vi.fn().mockReturnValue(mockProjectSettingsOverride),
        getSprintSettings: vi.fn().mockReturnValue({}),
      };
      resolver = new ScopedEffectiveSettingsResolver(mockRepo);
    });

    it("should return effective settings when resolving with a project ID", () => {
      const resolved = resolver.resolveProjectDashboardSettings("proj-1");
      expect(resolved.settings.automationLevel).toBe("FULL");
      expect(mockRepo.getProjectSettings).toHaveBeenCalledWith("proj-1");
      expect(mockRepo.getSystemSettings).toHaveBeenCalledTimes(1);
    });

    it("should return cached result on consecutive calls with the same project ID", () => {
      const resolved1 = resolver.resolveProjectDashboardSettings("proj-1");
      const resolved2 = resolver.resolveProjectDashboardSettings("proj-1");

      expect(resolved1).toBe(resolved2);
      expect(mockRepo.getProjectSettings).toHaveBeenCalledTimes(1);
      expect(mockRepo.getSystemSettings).toHaveBeenCalledTimes(1);
    });
  });
});
