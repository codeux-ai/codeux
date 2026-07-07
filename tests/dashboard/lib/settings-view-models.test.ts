import { describe, expect, it } from "vitest";
import {
  dashboardSettingsToProjectSettings,
  cloneProjectSettings,
  cloneSystemSettings,
  getProviderModelOptions,
  getProviderInstanceModelOptions,
  getOpenCodeConfiguredModel,
  getQwenConfiguredModel,
  getFieldSource,
  getFieldSourceLabel,
  providerSupportsModelSelection,
  providerSupportsThinkingMode,
  getProviderThinkingModeLabel,
  getProviderThinkingModeOptions,
  isProviderAvailable,
  getProviderAuthLabel,
  getProviderInstanceAuthLabel,
  getEligibleProviders,
  sourceLabel,
  thinkingModeOptions,
  providerLabels,
  createProjectProviderDraft,
  createSystemProviderDraft,
  sortProviderConfigEntries,
  getSystemIntegrationProviders,
  getDefaultModelOptionLabel,
  getDefaultRouteOptionLabel,
  getProviderDisplayMetadata,
  getVirtualProviderDisplayMetadata,
  applyExternalHintsToSystemSettings,
  formatModelPrice,
  getRelevantModelPricingRefs,
  normalizeModelPricingOverrideId,
  normalizeModelPricingOverrides,
  TASK_PR_TITLE_TOKEN_LABELS,
  getTaskPrTitleSchemeOptions,
  dashboardExperienceModeOptions,
  getDashboardExperienceModeDescription,
  getDashboardExperienceModeLabel,
  isEasyExperienceMode,
  isExpertExperienceMode,
  isStandardExperienceMode,
  normalizeDashboardExperienceMode,
} from "../../../dashboard/src/v2/lib/settings-view-models.js";
import type { SystemSettings, ProjectSettings, ExternalSettingsHints, DashboardSettings } from "../../../dashboard/src/types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

describe("sortProviderConfigEntries", () => {
  it("keeps the primary first and orders added instances by creation, not by name", () => {
    const entries: Array<[string, { provider: "gemini"; name: string }]> = [
      // Intentionally out of order with names that would sort differently than creation.
      ["gemini-zzzz1111-aaaaa", { provider: "gemini", name: "Aardvark" }],
      ["gemini", { provider: "gemini", name: "Gemini Primary" }],
      ["gemini-mmmm0000-bbbbb", { provider: "gemini", name: "Zebra" }],
    ];
    const sorted = sortProviderConfigEntries(entries).map(([id]) => id);
    expect(sorted).toEqual([
      "gemini", // seeded primary always leads
      "gemini-mmmm0000-bbbbb", // earlier base36 timestamp
      "gemini-zzzz1111-aaaaa", // later base36 timestamp
    ]);
  });

  it("is stable: renaming an instance does not change its position", () => {
    const before: Array<[string, { provider: "codex"; name: string }]> = [
      ["codex", { provider: "codex", name: "Codex Primary" }],
      ["codex-aaaa1111-x", { provider: "codex", name: "Codex 2" }],
    ];
    const after: Array<[string, { provider: "codex"; name: string }]> = [
      ["codex", { provider: "codex", name: "Codex Primary" }],
      ["codex-aaaa1111-x", { provider: "codex", name: "Renamed To Top" }],
    ];
    expect(sortProviderConfigEntries(before).map(([id]) => id))
      .toEqual(sortProviderConfigEntries(after).map(([id]) => id));
  });
});

describe("settings view model source helpers", () => {
  it("exposes dashboard experience mode labels, descriptions, and helpers", () => {
    expect(dashboardExperienceModeOptions.map((option) => option.label)).toEqual(["Easy", "Standard", "Expert"]);
    expect(normalizeDashboardExperienceMode("STANDARD")).toBe("STANDARD");
    expect(normalizeDashboardExperienceMode("standart")).toBe("EXPERT");
    expect(getDashboardExperienceModeLabel("STANDARD")).toBe("Standard");
    expect(getDashboardExperienceModeDescription("EASY")).toContain("Simplified");
    expect(isEasyExperienceMode("EASY")).toBe(true);
    expect(isStandardExperienceMode("STANDARD")).toBe(true);
    expect(isExpertExperienceMode("EXPERT")).toBe(true);
  });

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

  it("distinguishes inherited, overridden, and mixed project section sources", () => {
    expect(getFieldSource({}, "git.defaultBranch")).toBe("system");
    expect(getFieldSource({ "git.defaultBranch": "project" }, "git.defaultBranch")).toBe("project");
    expect(getFieldSource({
      "git.defaultBranch": "project",
      "git.autoCreatePr": "system",
    }, "git")).toBe("mixed");
  });

  it("provides thinking mode options", () => {
    expect(thinkingModeOptions).toEqual(expect.arrayContaining([
      { value: "none", label: "None" },
      { value: "minimal", label: "Minimal" },
      { value: "xhigh", label: "Extra High" },
      { value: "max", label: "Max" },
    ]));
    expect(thinkingModeOptions.some((option) => option.value === "SMALL")).toBe(false);
  });

  it("provides provider-specific thinking mode options and labels", () => {
    expect(getProviderThinkingModeOptions("jules")).toEqual([]);
    expect(getProviderThinkingModeOptions("codex")).toEqual([
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra High" },
    ]);
    expect(getProviderThinkingModeOptions("antigravity")).toEqual([
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ]);
    expect(getProviderThinkingModeLabel("codex", "HIGH")).toBe("High");
    expect(getProviderThinkingModeLabel("opencode", "none")).toBe("None");
  });

  it("provides provider labels", () => {
    expect(providerLabels.jules).toBe("Jules");
    expect(providerLabels.gemini).toBe("Gemini");
  });

  it("provides task PR title scheme placeholder metadata", () => {
    expect(Object.keys(TASK_PR_TITLE_TOKEN_LABELS)).toEqual([
      "sprint_tag",
      "sprint_key",
      "sprint_number",
      "sprint_title",
      "task_key",
      "task_title",
      "provider",
    ]);
    expect(getTaskPrTitleSchemeOptions()).toEqual([
      { value: "{sprint_tag}", label: "Sprint Tag" },
      { value: "{sprint_key}", label: "Sprint Key" },
      { value: "{sprint_number}", label: "Sprint Number" },
      { value: "{sprint_title}", label: "Sprint Title" },
      { value: "{task_key}", label: "Task Key" },
      { value: "{task_title}", label: "Task Title" },
      { value: "{provider}", label: "Provider" },
    ]);
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

  it("includes claude-fable-5 in Claude model options", () => {
    expect(getProviderModelOptions("claude-code")).toEqual(expect.arrayContaining([
      { value: "claude-fable-5", label: "claude-fable-5" },
    ]));
  });

  it("includes new Codex models while keeping gpt-5.5 as the first option", () => {
    const options = getProviderModelOptions("codex");

    expect(options[0]).toEqual({ value: "gpt-5.5", label: "gpt-5.5" });
    expect(options).toEqual(expect.arrayContaining([
      { value: "gpt-5.6-sol", label: "gpt-5.6-sol" },
      { value: "gpt-5.6-terra", label: "gpt-5.6-terra" },
      { value: "gpt-5.6-luna", label: "gpt-5.6-luna" },
    ]));
  });

  it("adds configured OpenCode custom endpoint models to instance model options", () => {
    const systemSettings = {
      integrations: {
        providers: {
          "opencode-ollama": {
            provider: "opencode",
            name: "Ollama",
            apiKey: "mykey",
            mountAuth: false,
            authPath: "~/.local/share/opencode",
            openCodeAuthMode: "CUSTOM_PROVIDER",
            openCodeProviderId: "ollama",
            openCodeModelId: "glm-4.7-flash",
            openCodeBaseUrl: "http://127.0.0.1:11434/v1",
            openCodeEnvKey: "ANTHROPIC_API_KEY",
            openCodePackage: "@ai-sdk/openai-compatible",
          },
        },
      },
    } as SystemSettings;

    expect(getOpenCodeConfiguredModel(systemSettings.integrations.providers["opencode-ollama"], "custom/model")).toBe("ollama/glm-4.7-flash");
    expect(getProviderModelOptions("opencode").some((option) => option.value === "custom/model")).toBe(false);
    expect(getProviderInstanceModelOptions(
      "opencode-ollama",
      { provider: "opencode", model: "custom/model" },
      systemSettings,
    )).toEqual(expect.arrayContaining([
      { value: "ollama/glm-4.7-flash", label: "ollama/glm-4.7-flash (configured)" },
      { value: "custom/model", label: "custom/model" },
    ]));
  });

  it("adds configured Qwen custom endpoint models to instance model options", () => {
    const systemSettings = {
      integrations: {
        providers: {
          "qwen-ollama": {
            provider: "qwen-code",
            name: "Qwen Ollama",
            apiKey: "mykey",
            mountAuth: false,
            authPath: "~/.qwen",
            qwenAuthMode: "MODEL_PROVIDER",
            qwenRegion: "international",
            qwenBaseUrl: "http://127.0.0.1:11434/v1",
            qwenEnvKey: "OLLAMA_API_KEY",
            qwenModelId: "glm-4.7-flash",
            qwenProtocol: "openai",
            qwenAdditionalModelProviders: [],
          },
        },
      },
    } as SystemSettings;

    expect(getQwenConfiguredModel(systemSettings.integrations.providers["qwen-ollama"], "custom/model")).toBe("glm-4.7-flash");
    expect(getProviderModelOptions("qwen-code").some((option) => option.value === "local-model")).toBe(false);
    expect(getProviderInstanceModelOptions(
      "qwen-ollama",
      { provider: "qwen-code", model: "custom/model" },
      systemSettings,
    )).toEqual(expect.arrayContaining([
      { value: "glm-4.7-flash", label: "glm-4.7-flash (configured)" },
      { value: "custom/model", label: "custom/model" },
    ]));
  });

  it("adds configured Codex and Claude custom endpoint models to instance model options", () => {
    const systemSettings = {
      integrations: {
        providers: {
          "codex-local": {
            provider: "codex",
            name: "Codex Local",
            apiKey: "mykey",
            mountAuth: false,
            authPath: "",
            customBaseUrl: "http://127.0.0.1:11434/v1",
            customModel: "openai/gpt-oss-local",
          },
          "claude-local": {
            provider: "claude-code",
            name: "Claude Local",
            apiKey: "mykey",
            mountAuth: false,
            authPath: "",
            customBaseUrl: "http://127.0.0.1:11434/v1",
            customModel: "anthropic/claude-local",
          },
        },
      },
    } as SystemSettings;

    expect(getProviderInstanceModelOptions(
      "codex-local",
      { provider: "codex", model: "gpt-5.5" },
      systemSettings,
    )).toEqual(expect.arrayContaining([
      { value: "openai/gpt-oss-local", label: "openai/gpt-oss-local (configured)" },
    ]));
    expect(getProviderInstanceModelOptions(
      "claude-local",
      { provider: "claude-code", model: "default" },
      systemSettings,
    )).toEqual(expect.arrayContaining([
      { value: "anthropic/claude-local", label: "anthropic/claude-local (configured)" },
    ]));
  });

  it("prefills new Qwen and OpenCode custom endpoint settings for local Ollama", () => {
    expect(createSystemProviderDraft("qwen-code", "Qwen Ollama")).toMatchObject({
      apiKey: "",
      providerConfigMode: "copyHost",
      providerConfigPath: "~/.qwen/settings.json",
      qwenBaseUrl: "http://127.0.0.1:11434/v1",
      qwenEnvKey: "OLLAMA_API_KEY",
      qwenModelId: "glm-4.7-flash",
      qwenProtocol: "openai",
    });
    expect(createSystemProviderDraft("opencode", "OpenCode Ollama")).toMatchObject({
      apiKey: "",
      providerConfigMode: "copyHost",
      providerConfigPath: "~/.config/opencode/opencode.json",
      openCodeProviderId: "ollama",
      openCodeModelId: "glm-4.7-flash",
      openCodeBaseUrl: "http://127.0.0.1:11434/v1",
      openCodeEnvKey: "OLLAMA_API_KEY",
    });
  });

  it("defaults new provider instances to provider-supported thinking modes", () => {
    expect(createProjectProviderDraft("codex", "Codex Staging").thinkingMode).toBe("high");
    expect(createProjectProviderDraft("opencode", "OpenCode Staging").thinkingMode).toBe("high");
    expect(createProjectProviderDraft("antigravity", "Antigravity Staging").thinkingMode).toBe("high");
    expect(createProjectProviderDraft("jules", "Jules Primary").thinkingMode).toBe("MEDIUM");
  });

  it("defaults provider config files only for CLI providers that support them", () => {
    expect(createSystemProviderDraft("codex", "Codex Primary")).toMatchObject({
      providerConfigMode: "copyHost",
      providerConfigPath: "~/.codex/config.toml",
    });
    expect(createSystemProviderDraft("jules", "Jules Primary")).toMatchObject({
      providerConfigMode: "none",
      providerConfigPath: "",
    });
    expect(createSystemProviderDraft("mockup-cli", "Mockup CLI")).toMatchObject({
      providerConfigMode: "none",
      providerConfigPath: "",
    });
  });
});

describe("model pricing view model helpers", () => {
  it("normalizes stale custom override ids without overwriting canonical overrides", () => {
    expect(normalizeModelPricingOverrideId("custom/google/gemma")).toBe("google/gemma");
    expect(normalizeModelPricingOverrideId("custom/local-model")).toBe("custom/local-model");

    expect(normalizeModelPricingOverrides({
      "google/gemma": { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
      "custom/google/gemma": { inputTokens: 3, outputTokens: 4, cachedInputTokens: 0 },
    })).toEqual({
      "google/gemma": { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
    });
  });

  it("formats missing and configured token pricing consistently", () => {
    expect(formatModelPrice(undefined)).toBe("No published pricing");
    expect(formatModelPrice({ inputTokens: 1, outputTokens: 2, cachedInputTokens: 0.5 })).toBe("$1/M in • $2/M out • $0.5/M cached");
  });

  it("keeps enabled project defaults visible as relevant pricing refs", () => {
    const refs = getRelevantModelPricingRefs({
      integrations: {
        providers: {
          codex: { provider: "codex", name: "Codex Primary", apiKey: "", mountAuth: false, authPath: "" },
        },
      },
      defaults: {
        aiProvider: {
          providers: {
            codex: {
              provider: "codex",
              name: "Codex Primary",
              enabled: true,
              model: "gpt-5.5",
              weight: 1,
              thinkingMode: "HIGH",
              maxConcurrentTasks: 0,
            },
          },
        },
      },
    } as SystemSettings, [{
      id: "openai/gpt-5.5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5.5",
      modelName: "GPT-5.5",
      cost: { inputTokens: 1, outputTokens: 2, cachedInputTokens: 0 },
    }], {});

    expect(refs.get("openai/gpt-5.5")?.usedBy).toEqual([
      { id: "codex", label: "Codex Primary", provider: "codex" },
    ]);
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
    runtime: { dashboardPort: 5173, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
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
    expect(getProviderAuthLabel("gemini", mockSystemSettings, mockHints, true)).toBe("Auth mount enabled");
    // Codex local auth should not surface as an active auth source by itself
    expect(getProviderAuthLabel("codex", mockSystemSettings, mockHints, false)).toBeNull();
    // Claude can still surface an active auth mount in Docker mode without an API key
    expect(getProviderAuthLabel("claude-code", mockSystemSettings, mockHints, true)).toBe("Auth mount enabled");
  });

  it("returns no auth display for an invalid provider config id", () => {
    expect(getProviderInstanceAuthLabel("missing-provider", mockSystemSettings, true)).toBeNull();
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

describe("external hint project override helpers", () => {
  it("fills only inherited empty provider keys from external hints", () => {
    const settings = {
      runtime: { dashboardPort: 5173, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
      integrations: {
        providers: {
          jules: { provider: "jules", name: "Jules Primary", apiKey: "", mountAuth: false, authPath: "" },
          gemini: { provider: "gemini", name: "Gemini Primary", apiKey: "project-gemini", mountAuth: false, authPath: "~/.gemini" },
        },
        githubToken: "",
      },
      defaults: DEFAULT_DASHBOARD_SETTINGS as ProjectSettings,
      mcpTools: [],
      customMcpServers: [],
      modelPricing: { overrides: {} },
    } as SystemSettings;
    const hints: ExternalSettingsHints = {
      env: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
      settingsJson: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
      resolved: {
        julesApiKey: "hint-jules",
        geminiApiKey: "hint-gemini",
        codexApiKey: "",
        claudeCodeApiKey: "",
        githubToken: "hint-gh",
      },
      providerAvailability: {},
    };

    const next = applyExternalHintsToSystemSettings(settings, hints);

    expect(next.integrations.providers.jules.apiKey).toBe("hint-jules");
    expect(next.integrations.providers.gemini.apiKey).toBe("project-gemini");
    expect(next.integrations.githubToken).toBe("hint-gh");
  });
});

describe("provider settings sanitization", () => {
  it("sanitizes SystemProviderConfig/provider settings mutually exclusively", () => {
    const systemSettings = {
      integrations: {
        providers: {
          "codex": {
            provider: "codex",
            name: "Codex Primary",
            apiKey: "stale-key",
            authType: "localAuth",
            mountAuth: true,
            authPath: "~/.codex",
            customBaseUrl: "https://custom.api",
            customModel: "gpt-custom",
          },
        },
      },
    } as any;

    const providers = getSystemIntegrationProviders(systemSettings);
    const codex = providers["codex"];
    expect(codex.apiKey).toBe("");
    expect(codex.customBaseUrl).toBe("");
    expect(codex.customModel).toBe("");
    expect(codex.mountAuth).toBe(true);
  });

  it("normalizes provider config mode/path combinations like the backend", () => {
    const systemSettings = {
      integrations: {
        providers: {
          "codex-empty-file": {
            provider: "codex",
            name: "Codex Empty File",
            apiKey: "",
            authType: "apiKey",
            mountAuth: false,
            authPath: "",
            providerConfigMode: "file",
            providerConfigPath: "   ",
          },
          "codex-custom-file": {
            provider: "codex",
            name: "Codex Custom File",
            apiKey: "",
            authType: "apiKey",
            mountAuth: false,
            authPath: "",
            providerConfigMode: "file",
            providerConfigPath: "~/configs/codex.toml",
          },
          "gemini-none": {
            provider: "gemini",
            name: "Gemini No Config",
            apiKey: "",
            authType: "apiKey",
            mountAuth: false,
            authPath: "",
            providerConfigMode: "none",
            providerConfigPath: "~/.gemini/settings.json",
          },
          "mockup-cli": {
            provider: "mockup-cli",
            name: "Mockup CLI",
            apiKey: "",
            authType: "apiKey",
            mountAuth: false,
            authPath: "",
            providerConfigMode: "copyHost",
            providerConfigPath: "~/.mockup/config.json",
          },
        },
      },
    } as any;

    const providers = getSystemIntegrationProviders(systemSettings);

    expect(providers["codex-empty-file"]).toMatchObject({
      providerConfigMode: "copyHost",
      providerConfigPath: "~/.codex/config.toml",
    });
    expect(providers["codex-custom-file"]).toMatchObject({
      providerConfigMode: "file",
      providerConfigPath: "~/configs/codex.toml",
    });
    expect(providers["gemini-none"]).toMatchObject({
      providerConfigMode: "none",
      providerConfigPath: "",
    });
    expect(providers["mockup-cli"]).toMatchObject({
      providerConfigMode: "none",
      providerConfigPath: "",
    });
  });
});

describe("provider display metadata helpers", () => {
  it("uses configured provider instance names, icon provider ids, and effective models", () => {
    const systemSettings = {
      integrations: {
        providers: {
          "codex-staging": {
            provider: "codex",
            name: "Codex Credentials",
            apiKey: "key",
            mountAuth: false,
            authPath: "~/.codex",
          },
        },
      },
      defaults: {
        aiProvider: {
          providers: {
            "codex-staging": {
              provider: "codex",
              name: "Codex Staging",
              enabled: true,
              model: "gpt-5.4",
              weight: 50,
              thinkingMode: "HIGH",
            },
          },
        },
      },
    } as SystemSettings;

    expect(getVirtualProviderDisplayMetadata(systemSettings)).toEqual([
      {
        providerConfigId: "codex-staging",
        provider: "codex",
        displayLabel: "Codex Staging",
        iconProviderId: "codex",
        effectiveModel: "gpt-5.4",
      },
    ]);
  });

  it("falls back to default provider config names when settings are unavailable", () => {
    const providers = getVirtualProviderDisplayMetadata(null);

    expect(providers.map((provider) => provider.provider)).toEqual([
      "gemini",
      "codex",
      "claude-code",
      "qwen-code",
      "opencode",
      "antigravity",
    ]);
    expect(providers.find((provider) => provider.provider === "codex")?.displayLabel).toBe("Codex Primary");
    expect(providers.find((provider) => provider.provider === "antigravity")?.displayLabel).toBe("Antigravity Primary");
  });

  it("formats default route and model labels when defaults resolve", () => {
    const metadata = getProviderDisplayMetadata(null, "codex", "gpt-5.5");

    expect(getDefaultRouteOptionLabel(metadata)).toBe("Default Route (Codex Primary)");
    expect(getDefaultModelOptionLabel(metadata)).toBe("Default Model (gpt-5.5)");
    expect(getDefaultRouteOptionLabel(null)).toBe("Default Route");
    expect(getDefaultModelOptionLabel(null)).toBe("Default Model");
  });

  it("falls back to the provider base model for invalid worker model defaults", () => {
    const metadata = getProviderDisplayMetadata(null, "codex", "gemini-3-pro-preview");

    expect(metadata?.effectiveModel).toBe("gpt-5.5");
    expect(getDefaultModelOptionLabel(metadata)).toBe("Default Model (gpt-5.5)");
  });

  it("displays Codex custom endpoint models instead of catalog defaults", () => {
    const systemSettings = {
      integrations: {
        providers: {
          "codex-local": {
            provider: "codex",
            name: "Codex Local",
            apiKey: "key",
            mountAuth: false,
            authPath: "",
            customBaseUrl: "http://127.0.0.1:11434/v1",
            customModel: "openai/gpt-oss-local",
          },
        },
      },
      defaults: {
        aiProvider: {
          providers: {
            "codex-local": {
              provider: "codex",
              name: "Codex Local",
              enabled: true,
              model: "gpt-5.5",
              weight: 50,
              thinkingMode: "HIGH",
            },
          },
        },
      },
    } as SystemSettings;

    const metadata = getProviderDisplayMetadata(systemSettings, "codex-local");

    expect(metadata?.effectiveModel).toBe("openai/gpt-oss-local");
    expect(getDefaultModelOptionLabel(metadata)).toBe("Default Model (openai/gpt-oss-local)");
  });

  it("displays Claude custom endpoint models instead of default", () => {
    const systemSettings = {
      integrations: {
        providers: {
          "claude-local": {
            provider: "claude-code",
            name: "Claude Local",
            apiKey: "key",
            mountAuth: false,
            authPath: "",
            customBaseUrl: "http://127.0.0.1:11434/v1",
            customModel: "anthropic/claude-local",
          },
        },
      },
      defaults: {
        aiProvider: {
          providers: {
            "claude-local": {
              provider: "claude-code",
              name: "Claude Local",
              enabled: true,
              model: "default",
              weight: 50,
              thinkingMode: "HIGH",
            },
          },
        },
      },
    } as SystemSettings;

    const metadata = getProviderDisplayMetadata(systemSettings, "claude-local");

    expect(metadata?.effectiveModel).toBe("anthropic/claude-local");
    expect(getDefaultModelOptionLabel(metadata)).toBe("Default Model (anthropic/claude-local)");
  });

  it("ignores stale custom model fields for mounted local-auth providers", () => {
    const systemSettings = {
      integrations: {
        providers: {
          "codex-mounted": {
            provider: "codex",
            name: "Codex Mounted",
            apiKey: "",
            authType: "localAuth",
            mountAuth: true,
            authPath: "~/.codex",
            customBaseUrl: "http://127.0.0.1:11434/v1",
            customModel: "openai/stale-local",
          },
        },
      },
      defaults: {
        aiProvider: {
          providers: {
            "codex-mounted": {
              provider: "codex",
              name: "Codex Mounted",
              enabled: true,
              model: "gpt-5.5",
              weight: 50,
              thinkingMode: "HIGH",
            },
          },
        },
      },
    } as SystemSettings;

    const metadata = getProviderDisplayMetadata(systemSettings, "codex-mounted");

    expect(metadata?.effectiveModel).toBe("gpt-5.5");
  });

  it("displays Qwen and OpenCode configured custom endpoint models", () => {
    const systemSettings = {
      integrations: {
        providers: {
          "qwen-ollama": {
            provider: "qwen-code",
            name: "Qwen Ollama",
            apiKey: "key",
            mountAuth: false,
            authPath: "",
            qwenAuthMode: "MODEL_PROVIDER",
            qwenModelId: "glm-4.7-flash",
          },
          "opencode-ollama": {
            provider: "opencode",
            name: "OpenCode Ollama",
            apiKey: "key",
            mountAuth: false,
            authPath: "",
            openCodeAuthMode: "CUSTOM_PROVIDER",
            openCodeProviderId: "ollama",
            openCodeModelId: "glm-4.7-flash",
          },
        },
      },
      defaults: {
        aiProvider: {
          providers: {
            "qwen-ollama": {
              provider: "qwen-code",
              name: "Qwen Ollama",
              enabled: true,
              model: "custom/model",
              weight: 50,
              thinkingMode: "HIGH",
            },
            "opencode-ollama": {
              provider: "opencode",
              name: "OpenCode Ollama",
              enabled: true,
              model: "custom/model",
              weight: 50,
              thinkingMode: "HIGH",
            },
          },
        },
      },
    } as SystemSettings;

    expect(getProviderDisplayMetadata(systemSettings, "qwen-ollama")?.effectiveModel).toBe("glm-4.7-flash");
    expect(getProviderDisplayMetadata(systemSettings, "opencode-ollama")?.effectiveModel).toBe("ollama/glm-4.7-flash");
  });
});


describe("settings cloning helpers", () => {
  const createMockQualityAssurance = () => ({
    enabled: true,
    maxTaskReviewRuns: 2,
    maxSprintReviewRuns: 3,
    exhaustionPolicy: "STOP" as const,
    taskCompletion: { strategy: "ALWAYS" as const, agentPresetIds: ["qa-task"], agentPresetId: "qa-task" },
    sprintCompletion: { strategy: "ALWAYS" as const, agentPresetIds: ["qa-sprint", "qa-peer"], agentPresetId: "qa-sprint" },
    completedTaskWithoutPr: { strategy: "CREATE_PR" as const, agentPresetIds: [], agentPresetId: null },
  });

  const createMockImporterSettings = () => ({
    enabled: false,
    apiToken: "",
    apiSecret: "",
    baseUrl: "",
    workspaceId: "",
    teamId: "",
    teamKey: "",
    projectId: "",
    databaseId: "",
    boardId: "",
    documentId: "",
    fileKey: "",
    defaultSearchLimit: 25,
  });

  const createMockProjectSettings = (): ProjectSettings => ({
    appearance: { experienceMode: "STANDARD", theme: "system" },
    automationLevel: "FULL",
    automationInterventions: {},
    aiProvider: {
      provider: "jules",
      strategy: "MANUAL",
      providers: {},
      invocationRouting: {},
    },
    techstack: { applicationKind: null, selectedTechstackId: null },
    git: { githubMode: "app", githubToken: "", defaultBranch: "main", autoCreatePr: false, autoCloseLinkedIssues: false, deleteMergedBranches: false, featureBranchPrefix: "", sprintBranchScheme: "FLAT", sprintKeyPrefix: "", taskPrTitleScheme: "({sprint_tag}) {task_title}" },
    jira: { host: "h", email: "e", apiToken: "t", autoTransitionLinkedIssuesOnImport: true, importTransitionName: "In Work", autoCloseLinkedIssues: false, defaultProject: "P", closeTransitionName: "Done" },
    notion: createMockImporterSettings(),
    asana: createMockImporterSettings(),
    linear: createMockImporterSettings(),
    miro: createMockImporterSettings(),
    lucid: createMockImporterSettings(),
    figma: createMockImporterSettings(),
    mural: createMockImporterSettings(),
    ciIntelligence: {},
    guardrails: { onLimitAction: "WARN", defaultLimitOverrides: [], limitOverrides: [], jobConfigOverrides: [], jobs: { task_coding: {}, ci_fix: {}, merge_conflict: {}, clarification_reply: {}, planning: {}, remediation: {} } as any },
    sprintLoopSteps: { apply: { type: "apply" }, pr: { type: "pr" }, runTests: { type: "test" } },
    cliWorkflow: { executionMode: "HOST" },
    sprintPreview: { enabled: false },
    workers: { allowParallelJobs: false },
    agents: {
      saveToProjectDirectory: false,
      routing: {
        planning: { strategy: "DEFAULT" },
        taskCoding: { strategy: "DEFAULT", orchestratorAgentPresetIds: ["a", "b"] },
        ciFix: { strategy: "DEFAULT" },
        mergeConflict: { strategy: "DEFAULT" },
        dashboardReply: { strategy: "DEFAULT" },
        clarificationReply: { strategy: "DEFAULT" },
      },
      instructionTemplates: {},
      qualityAssurance: createMockQualityAssurance(),
      selfReflection: {
        planning: {
          enabled: false,
          criteria: [
            { id: "correctness", label: "Correctness", prompt: "Check correctness.", threshold: 0.8 },
          ],
          maxImprovementAttempts: 1,
        },
        qualityAssurance: {
          enabled: false,
          criteria: [
            { id: "security", label: "Security", prompt: "Check security.", threshold: 0.85 },
          ],
          maxImprovementAttempts: 1,
        },
      },
    },
    skills: [{ id: "skill1", enabled: true }],
    mcpTools: [{ serverName: "s1", toolName: "t1", enabled: true }],
    customMcpServers: [{ serverName: "s1", command: "cmd", args: [], env: { "FOO": "bar" }, headers: { "X-Auth": "abc" }, providers: [] }],
    memory: { enabled: true, embeddingModel: null, externalEmbedding: { baseUrl: "", apiKey: "", model: "", dimensions: null }, autoCaptureSprint: true, autoCaptureAgent: true, autoPromote: false, promotionThreshold: 5, maxSprintMemories: 10, maxProjectMemories: 20, mapMaxEdgesPerNode: 5, workerLearningsInstruction: "" },
  } as ProjectSettings);

  const createMockDashboardSettings = (): DashboardSettings => {
    const p = createMockProjectSettings();
    return { ...p, uiState: {} } as any;
  };

  it("cloneProjectSettings deep clones nested objects and isolates mutations", () => {
    const original = createMockProjectSettings();
    const clone = cloneProjectSettings(original);

    // Verify equality
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);

    // Mutate clone
    clone.appearance.experienceMode = "EASY";
    clone.memory.enabled = false;
    clone.memory.autoCaptureSprint = false;
    clone.jira.host = "new-host";
    clone.notion.databaseId = "mutated-database";
    clone.figma.fileKey = "mutated-file";
    clone.agents.qualityAssurance.enabled = false;
    clone.agents.qualityAssurance.taskCompletion.strategy = "NEVER";
    clone.agents.qualityAssurance.sprintCompletion.agentPresetIds.push("qa-extra");
    clone.agents.selfReflection.planning.criteria[0]!.threshold = 0.1;
    clone.agents.routing.taskCoding.orchestratorAgentPresetIds.push("c");
    clone.git.taskPrTitleScheme = "{task_key}: {task_title}";
    clone.customMcpServers![0].headers!["X-New"] = "123";
    clone.customMcpServers![0].env!["BAZ"] = "qux";
    clone.mcpTools![0].enabled = false;
    clone.skills[0].enabled = false;

    // Verify original is untouched
    expect(original.appearance.experienceMode).toBe("STANDARD");
    expect(original.memory.enabled).toBe(true);
    expect(original.memory.autoCaptureSprint).toBe(true);
    expect(original.jira.host).toBe("h");
    expect(original.notion.databaseId).toBe("");
    expect(original.figma.fileKey).toBe("");
    expect(original.agents.qualityAssurance.enabled).toBe(true);
    expect(original.agents.qualityAssurance.taskCompletion.strategy).toBe("ALWAYS");
    expect(original.agents.qualityAssurance.sprintCompletion.agentPresetIds).toEqual(["qa-sprint", "qa-peer"]);
    expect(original.agents.selfReflection.planning.criteria[0]!.threshold).toBe(0.8);
    expect(original.agents.routing.taskCoding.orchestratorAgentPresetIds).toEqual(["a", "b"]);
    expect(original.git.taskPrTitleScheme).toBe("({sprint_tag}) {task_title}");
    expect(original.customMcpServers![0].headers!["X-New"]).toBeUndefined();
    expect(original.customMcpServers![0].env!["BAZ"]).toBeUndefined();
    expect(original.mcpTools![0].enabled).toBe(true);
    expect(original.skills[0].enabled).toBe(true);
  });

  it("dashboardSettingsToProjectSettings deep clones nested objects and isolates mutations", () => {
    const original = createMockDashboardSettings();
    const clone = dashboardSettingsToProjectSettings(original);

    expect(clone).not.toBe(original);

    // Mutate clone
    clone.appearance.experienceMode = "EASY";
    clone.memory.enabled = false;
    clone.jira.host = "new-host";
    clone.asana.workspaceId = "mutated-workspace";
    clone.mural.boardId = "mutated-mural";
    clone.agents.qualityAssurance.enabled = false;
    clone.agents.qualityAssurance.sprintCompletion.agentPresetIds.push("qa-extra");
    clone.agents.selfReflection.qualityAssurance.criteria.push({ id: "scope_control", label: "Scope control", prompt: "Stay scoped.", threshold: 0.8 });
    clone.agents.routing.taskCoding.orchestratorAgentPresetIds.push("c");
    clone.git.taskPrTitleScheme = "{provider}: {task_title}";
    clone.customMcpServers![0].headers!["X-New"] = "123";

    // Verify original is untouched
    expect(original.appearance.experienceMode).toBe("STANDARD");
    expect(original.memory.enabled).toBe(true);
    expect(original.jira.host).toBe("h");
    expect(original.asana.workspaceId).toBe("");
    expect(original.mural.boardId).toBe("");
    expect(original.agents.qualityAssurance.enabled).toBe(true);
    expect(original.agents.qualityAssurance.sprintCompletion.agentPresetIds).toEqual(["qa-sprint", "qa-peer"]);
    expect(original.agents.selfReflection.qualityAssurance.criteria).toHaveLength(1);
    expect(original.agents.routing.taskCoding.orchestratorAgentPresetIds).toEqual(["a", "b"]);
    expect(original.git.taskPrTitleScheme).toBe("({sprint_tag}) {task_title}");
    expect(original.customMcpServers![0].headers!["X-New"]).toBeUndefined();
  });

  it("cloneSystemSettings deep clones nested objects and isolates mutations", () => {
    const original: SystemSettings = {
      runtime: {} as any,
      integrations: {
        githubToken: "gh",
        gitlabToken: "gl",
        jira: { host: "h", email: "e", apiToken: "t", autoTransitionLinkedIssuesOnImport: true, importTransitionName: "In Work", autoCloseLinkedIssues: false, defaultProject: "P", closeTransitionName: "Done" },
        notion: createMockImporterSettings(),
        asana: createMockImporterSettings(),
        linear: createMockImporterSettings(),
        miro: createMockImporterSettings(),
        lucid: createMockImporterSettings(),
        figma: createMockImporterSettings(),
        mural: createMockImporterSettings(),
        providers: {
          "p1": { provider: "jules", name: "Jules", apiKey: "key", mountAuth: false, authPath: "" }
        }
      },
      techstackCatalog: {
        defaultTechstackId: "code-ux-internal",
        entries: [
          {
            id: "code-ux-internal",
            label: "Code UX Stack",
            items: [
              { id: "preact", label: "Preact" },
              { id: "tanstack-router", label: "TanStack Router" },
              { id: "gsap", label: "GSAP" },
              { id: "three-js", label: "Three.js" },
              { id: "lucide-icons", label: "Lucide Icons" },
            ],
          },
        ],
      },
      defaults: createMockProjectSettings(),
      mcpTools: [{ serverName: "s1", toolName: "t1", enabled: true }],
      customMcpServers: [],
      modelPricing: { overrides: {} },
    };

    const clone = cloneSystemSettings(original);

    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);

    // Mutate clone
    clone.integrations.jira!.host = "mutated";
    clone.integrations.notion.databaseId = "mutated-database";
    clone.integrations.lucid.documentId = "mutated-document";
    clone.integrations.providers["p1"].apiKey = "mutated-key";
    clone.defaults.memory.enabled = false;
    clone.defaults.git.taskPrTitleScheme = "{task_title}";
    clone.mcpTools[0].enabled = false;

    // Verify original is untouched
    expect(original.integrations.jira!.host).toBe("h");
    expect(original.integrations.notion.databaseId).toBe("");
    expect(original.integrations.lucid.documentId).toBe("");
    expect(original.integrations.providers["p1"].apiKey).toBe("key");
    expect(original.defaults.memory.enabled).toBe(true);
    expect(original.defaults.git.taskPrTitleScheme).toBe("({sprint_tag}) {task_title}");
    expect(original.mcpTools[0].enabled).toBe(true);
  });
});
