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
      mountAuth: true,
      authPath: "/some/path",
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
      apiKey: "sk-test",
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
      providerMountAuth: true,
      providerAuthPath: "/some/path",
      customBaseUrl: "https://custom.url",
      customModel: "custom-claude",
    });
  });
});
