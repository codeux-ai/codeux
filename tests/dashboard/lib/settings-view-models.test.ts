import { describe, expect, it } from "vitest";
import {
  getProviderModelOptions,
  getFieldSource,
  getFieldSourceLabel,
  providerSupportsModelSelection,
  providerSupportsThinkingMode,
  isProviderAvailable,
  getProviderAuthLabel,
  getEligibleProviders,
  sourceLabel,
  thinkingModeOptions,
  providerLabels,
} from "../../../dashboard/src/v2/lib/settings-view-models.js";
import type { SystemSettings, ProjectSettings, ExternalSettingsHints } from "../../../dashboard/src/types.js";

describe("settings view model source helpers", () => {
  it("returns the direct field source when a leaf path is present", () => {
    expect(getFieldSource({
      "git.defaultBranch": "project",
      "git.githubMode": "system",
    }, "git.defaultBranch")).toBe("project");
  });

  it("falls back to section source when the exact path is not flattened separately", () => {
    expect(getFieldSource({
      skills: "project",
    }, "skills")).toBe("project");
  });

  it("formats project-scope source labels", () => {
    expect(getFieldSourceLabel("project", "project")).toBe("Project override");
    expect(getFieldSourceLabel("system", "project")).toBeNull();
    expect(getFieldSourceLabel("mixed", "project")).toBeNull();
  });

  it("formats sprint-scope source labels", () => {
    expect(getFieldSourceLabel("sprint", "sprint")).toBe("Sprint override");
    expect(getFieldSourceLabel("project", "sprint")).toBeNull();
    expect(getFieldSourceLabel("system", "sprint")).toBeNull();
  });

  it("formats basic source labels", () => {
    expect(sourceLabel("project")).toBe("Project override");
    expect(sourceLabel("sprint")).toBe("Sprint override");
    expect(sourceLabel("mixed")).toBe("Mixed sources");
    expect(sourceLabel("system")).toBe("Inherited");
  });

  it("provides thinking mode options", () => {
    expect(thinkingModeOptions).toHaveLength(3);
    expect(thinkingModeOptions[0]).toEqual({ value: "SMALL", label: "Small" });
  });

  it("provides provider labels", () => {
    expect(providerLabels.jules).toBe("Jules");
    expect(providerLabels.gemini).toBe("Gemini");
  });

  it("marks Jules model and thinking controls as unsupported", () => {
    expect(providerSupportsModelSelection("jules")).toBe(false);
    expect(providerSupportsThinkingMode("jules")).toBe(false);
    expect(providerSupportsModelSelection("gemini")).toBe(true);
    expect(providerSupportsThinkingMode("codex")).toBe(true);
  });

  it("adds recent labels to Gemini alias model options", () => {
    expect(getProviderModelOptions("gemini")).toEqual(expect.arrayContaining([
      { value: "pro", label: "pro (recent)" },
      { value: "flash", label: "flash (recent)" },
      { value: "flash-lite", label: "flash-lite (recent)" },
      { value: "gemini-2.5-pro", label: "gemini-2.5-pro" },
    ]));
  });
});

describe("provider availability helpers", () => {
  const mockHints: ExternalSettingsHints = {
    env: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
    settingsJson: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
    resolved: {
      julesApiKey: "hint-jules",
      geminiApiKey: "",
      codexApiKey: "",
      claudeCodeApiKey: "",
      githubToken: "",
    },
    providerAvailability: {
      jules: { hasApiKey: true, hasLocalAuth: false },
      gemini: { hasApiKey: false, hasLocalAuth: false },
      codex: { hasApiKey: false, hasLocalAuth: true },
      claudeCode: { hasApiKey: false, hasLocalAuth: false },
    },
  };

  const mockSystemSettings: SystemSettings = {
    runtime: { dashboardPort: 5173, enableDebugLogFile: false },
    integrations: {
      providers: {
        jules: { provider: "jules", name: "Jules Primary", apiKey: "", mountAuth: false, authPath: "" },
        gemini: { provider: "gemini", name: "Gemini Primary", apiKey: "sys-gemini", mountAuth: true, authPath: "~/.gemini" },
        codex: { provider: "codex", name: "Codex Primary", apiKey: "", mountAuth: false, authPath: "~/.codex" },
        "claude-code": { provider: "claude-code", name: "Claude Primary", apiKey: "", mountAuth: true, authPath: "~/.claude" },
      },
      githubToken: "",
    },
    defaults: {} as any,
    mcpTools: [],
  };

  const mockProjectSettings: ProjectSettings = {
    aiProvider: {
      provider: "jules",
      strategy: "MANUAL",
      providers: {
        jules: { enabled: true, model: "auto", weight: 1, thinkingMode: "SMALL" },
        gemini: { enabled: false, model: "auto", weight: 1, thinkingMode: "SMALL" },
        codex: { enabled: true, model: "auto", weight: 1, thinkingMode: "SMALL" },
        "claude-code": { enabled: true, model: "auto", weight: 1, thinkingMode: "SMALL" },
      },
      invocationRouting: {} as any,
    },
    cliWorkflow: { executionMode: "DOCKER", containerMountGeminiAuth: false, containerMountCodexAuth: true, containerMountClaudeCodeAuth: true } as any,
  } as any;

  it("isProviderAvailable checks API keys and auth mounts, but not unmounted local auth", () => {
    expect(isProviderAvailable("jules", mockSystemSettings, mockHints)).toBe(true); // from hints
    expect(isProviderAvailable("gemini", mockSystemSettings, mockHints)).toBe(true); // from system
    expect(isProviderAvailable("codex", mockSystemSettings, mockHints)).toBe(false); // local auth alone should not count
    expect(isProviderAvailable("claude-code", mockSystemSettings, mockHints)).toBe(true); // from per-instance mount config
  });

  it("getProviderAuthLabel reflects API keys and docker mount flags only", () => {
    // Jules available via hint
    expect(getProviderAuthLabel("jules", mockSystemSettings, mockHints, false)).toBe("API key");
    // Gemini available via system setting + per-instance mount enabled
    expect(getProviderAuthLabel("gemini", mockSystemSettings, mockHints, true)).toBe("Auth mount + API key");
    // Codex local auth should not surface as an active auth source by itself
    expect(getProviderAuthLabel("codex", mockSystemSettings, mockHints, false)).toBeNull();
    // Claude can still surface an active auth mount in Docker mode without an API key
    expect(getProviderAuthLabel("claude-code", mockSystemSettings, mockHints, true)).toBe("Auth mount enabled");
  });

  it("getEligibleProviders returns providers that are available AND enabled", () => {
    const eligible = getEligibleProviders(mockSystemSettings, {
      ...mockProjectSettings,
      cliWorkflow: {
        ...mockProjectSettings.cliWorkflow,
        containerMountCodexAuth: false,
      },
    }, mockHints);
    // jules is available (hint) and enabled
    // gemini is available (system) but NOT enabled
    // codex local auth alone should not activate it
    // claude-code is activated via auth mount and enabled
    expect(eligible).toEqual(["jules", "claude-code"]);
  });
});
