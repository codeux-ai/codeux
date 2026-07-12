import { describe, expect, it } from "vitest";
import { buildProviderSettingsOverride } from "../../../src/services/provider-settings-override.js";
import type { ProviderSettings } from "../../../src/contracts/app-types.js";

describe("buildProviderSettingsOverride", () => {
  it("should pass through all fields correctly including custom sub-fields", () => {
    const settings: ProviderSettings = {
      provider: "claude-code",
      name: "Claude Code",
      enabled: true,
      model: "claude-3",
      weight: 1,
      thinkingMode: { type: "disabled" },
      apiKey: "sk-test",
      maxConcurrentTasks: 3,
      mountAuth: false,
      authPath: "/some/path",
      providerConfigMode: "file",
      providerConfigPath: "/some/config.json",
      qwenAuthMode: "LOCAL_AUTH",
      qwenRegion: "international",
      qwenBaseUrl: "https://qwen.url",
      qwenEnvKey: "QWEN_TEST",
      qwenModelId: "qwen-test",
      qwenProtocol: "openai",
      qwenAdditionalModelProviders: [],
      openCodeAuthMode: "ENV_KEY",
      openCodeProviderId: "open",
      openCodeModelId: "oc-test",
      openCodeBaseUrl: "https://open.url",
      openCodeEnvKey: "OC_TEST",
      openCodePackage: "oc-pkg",
      customBaseUrl: "https://custom.url",
      customModel: "custom-claude",
    };

    const override = buildProviderSettingsOverride("resolved-model", settings);

    expect(override).toEqual({
      model: "resolved-model",
      thinkingMode: { type: "disabled" },
      apiKey: "",
      apiKeyCredentialRef: undefined,
      maxConcurrentTasks: 3,
      qwenAuthMode: "LOCAL_AUTH",
      qwenRegion: "international",
      qwenBaseUrl: "https://qwen.url",
      qwenEnvKey: "QWEN_TEST",
      qwenModelId: "qwen-test",
      qwenProtocol: "openai",
      qwenAdditionalModelProviders: [],
      openCodeAuthMode: "ENV_KEY",
      openCodeProviderId: "open",
      openCodeModelId: "oc-test",
      openCodeBaseUrl: "https://open.url",
      openCodeEnvKey: "OC_TEST",
      openCodePackage: "oc-pkg",
      providerMountAuth: false,
      providerAuthPath: "/some/path",
      providerConfigMode: "file",
      providerConfigPath: "/some/config.json",
      customBaseUrl: "https://custom.url",
      customModel: "custom-claude",
    });
  });

  it("clears API-key custom endpoint overrides when mounted auth is selected", () => {
    const settings: ProviderSettings = {
      provider: "codex",
      name: "Codex Primary",
      enabled: true,
      model: "gpt-5.5",
      weight: 1,
      thinkingMode: "HIGH",
      apiKey: "sk-local",
      maxConcurrentTasks: 4,
      mountAuth: true,
      authPath: "~/.code-ux/credentials/codex",
      providerConfigMode: "copyHost",
      providerConfigPath: "~/.codex/config.toml",
      customBaseUrl: "http://192.168.0.38:1234/v1",
      customModel: "local-model",
    };

    const override = buildProviderSettingsOverride("gpt-5.5", settings);

    expect(override.apiKey).toBe("");
    expect(override.customBaseUrl).toBeUndefined();
    expect(override.customModel).toBeUndefined();
    expect(override.providerMountAuth).toBe(true);
    expect(override.providerConfigMode).toBe("copyHost");
    expect(override.providerConfigPath).toBe("~/.codex/config.toml");
    expect(override.model).toBe("gpt-5.5");
  });
});
