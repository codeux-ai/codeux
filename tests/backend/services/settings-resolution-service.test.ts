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
        runtime: { dashboardPort: 4444, enableDebugLogFile: false, consoleLogLevel: "standard" },
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
        runtime: { dashboardPort: 4444, enableDebugLogFile: false, consoleLogLevel: "standard" },
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
        runtime: { dashboardPort: 4444, enableDebugLogFile: false, consoleLogLevel: "standard" },
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
  });

  describe("resolveProjectSettings", () => {
    it("should resolve project settings", () => {
      const baseProject = buildDefaultProjectSettings();
      const systemSettings: SystemSettings = {
        runtime: { dashboardPort: 4444, enableDebugLogFile: false, consoleLogLevel: "standard" },
        integrations: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", "claudeCodeApiKey": "", githubToken: "" },
        defaults: baseProject,
        mcpTools: [],
      };
      const settings = resolveProjectSettings(systemSettings, { automationLevel: "FULL" });
      expect(settings.automationLevel).toBe("FULL");
    });
  });

  describe("resolveSprintProjectSettings", () => {
    it("should resolve sprint settings", () => {
      const baseProject = buildDefaultProjectSettings();
      const systemSettings: SystemSettings = {
        runtime: { dashboardPort: 4444, enableDebugLogFile: false, consoleLogLevel: "standard" },
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
        runtime: { dashboardPort: 4444, enableDebugLogFile: false, consoleLogLevel: "standard" },
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
