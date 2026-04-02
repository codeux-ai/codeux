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
  };

  const mockSystemSettings: SystemSettings = {
    runtime: { nodeEnvironment: "development", dashboardPort: 5173, runtimeVersion: "1.0.0", dockerEngineConnected: true, osPlatform: "linux" },
    integrations: { julesApiKey: "", geminiApiKey: "sys-gemini", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
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
    cliWorkflow: { executionMode: "DOCKER", containerMountGeminiAuth: false, containerMountCodexAuth: true, containerMountClaudeCodeAuth: false } as any,
  } as any;

  it("isProviderAvailable checks system settings and hints", () => {
    expect(isProviderAvailable("jules", mockSystemSettings, mockHints)).toBe(true); // from hints
    expect(isProviderAvailable("gemini", mockSystemSettings, mockHints)).toBe(true); // from system
    expect(isProviderAvailable("codex", mockSystemSettings, mockHints)).toBe(false); // nowhere
  });

  it("getProviderAuthLabel prioritizes availability logic and docker mount flags", () => {
    // Jules available via hint
    expect(getProviderAuthLabel("jules", mockSystemSettings, mockHints, false, false)).toBe("API key");
    // Gemini available via system setting + docker mount enabled
    expect(getProviderAuthLabel("gemini", mockSystemSettings, mockHints, true, true)).toBe("Local auth + API key");
    // Codex NOT available via key, so it should be null even if mount is enabled
    expect(getProviderAuthLabel("codex", mockSystemSettings, mockHints, true, true)).toBeNull();
    // Claude NOT available via key, and docker mount NOT enabled
    expect(getProviderAuthLabel("claude-code", mockSystemSettings, mockHints, true, false)).toBeNull();
  });

  it("getEligibleProviders returns providers that are available AND enabled", () => {
    const eligible = getEligibleProviders(mockSystemSettings, mockProjectSettings, mockHints);
    // jules is available (hint) and enabled
    // gemini is available (system) but NOT enabled
    // codex is NOT available via key, but IS enabled
    // claude-code is NOT available via key, IS enabled
    expect(eligible).toEqual(["jules"]);
  });
});
