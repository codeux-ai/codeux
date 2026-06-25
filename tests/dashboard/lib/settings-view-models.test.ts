import { describe, expect, it } from "vitest";
import {
  getProviderModelOptions,
  getProviderInstanceModelOptions,
  getOpenCodeConfiguredModel,
  getQwenConfiguredModel,
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
  createSystemProviderDraft,
  sortProviderConfigEntries,
  getSystemIntegrationProviders,
  getDefaultModelOptionLabel,
  getDefaultRouteOptionLabel,
  getProviderDisplayMetadata,
  getVirtualProviderDisplayMetadata,
} from "../../../dashboard/src/v2/lib/settings-view-models.js";
import type { SystemSettings, ProjectSettings, ExternalSettingsHints } from "../../../dashboard/src/types.js";

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

  it("includes claude-fable-5 in Claude model options", () => {
    expect(getProviderModelOptions("claude-code")).toEqual(expect.arrayContaining([
      { value: "claude-fable-5", label: "claude-fable-5" },
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

  it("prefills new Qwen and OpenCode custom endpoint settings for local Ollama", () => {
    expect(createSystemProviderDraft("qwen-code", "Qwen Ollama")).toMatchObject({
      apiKey: "",
      qwenBaseUrl: "http://127.0.0.1:11434/v1",
      qwenEnvKey: "OLLAMA_API_KEY",
      qwenModelId: "glm-4.7-flash",
      qwenProtocol: "openai",
    });
    expect(createSystemProviderDraft("opencode", "OpenCode Ollama")).toMatchObject({
      apiKey: "",
      openCodeProviderId: "ollama",
      openCodeModelId: "glm-4.7-flash",
      openCodeBaseUrl: "http://127.0.0.1:11434/v1",
      openCodeEnvKey: "OLLAMA_API_KEY",
    });
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
});
