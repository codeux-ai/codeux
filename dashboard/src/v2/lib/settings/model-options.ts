import type {
  ProviderConfigId,
  ProviderId,
  ProjectProviderSettings,
  SystemProviderCredentialSettings,
  SystemSettings,
} from "../../../types.js";
import { getSystemIntegrationProviders } from "./provider-instances.js";

export interface ProviderModelOption {
  value: string;
  label: string;
}

export const AI_MODEL_CATALOG: Record<string, string[]> = {
  gemini: [
    "auto",
    "pro",
    "flash",
    "flash-lite",
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gemini-3.1-pro-preview-customtools",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it",
    "gemini-2.5-flash-base",
    "gemini-3-flash-base",
  ],
  "claude-code": [
    "default",
    "sonnet",
    "opus",
    "haiku",
    "sonnet[1m]",
    "opus[1m]",
    "opusplan",
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    "claude-sonnet-5",
    "claude-haiku-4-5-20251001",
    "claude-fable-5",
    "claude-mythos-5",
  ],
  codex: [
    "gpt-5.5",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.2-codex",
    "gpt-5.2",
    "gpt-5.1-codex-max",
    "gpt-5.1",
    "gpt-5.1-codex",
    "gpt-5-codex",
    "gpt-5-codex-mini",
    "gpt-5",
  ],
  "qwen-code": [
    "qwen3-coder-plus",
    "qwen3.5-plus",
    "qwen3-coder-next",
    "qwen3-max",
    "qwen3-max-2026-01-23",
    "qwen-plus",
    "qwen-max",
  ],
  opencode: [
    "anthropic/claude-sonnet-4-5",
    "anthropic/claude-opus-4-1",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-5",
    "openai/gpt-5-mini",
    "github-copilot/gpt-5",
    "openrouter/anthropic/claude-sonnet-4.5",
  ],
  antigravity: [
    "default",
    "gemini-3.5-flash",
    "gemini-3.1-pro-high",
    "gemini-3.1-pro-low",
    "gemini-3-flash",
    "claude-sonnet-4.6-thinking",
    "claude-opus-4.6-thinking",
    "gpt-oss-120b",
  ],
};

const PROVIDER_MODEL_LABEL_OVERRIDES: Partial<Record<ProviderId, Record<string, string>>> = {
  gemini: {
    pro: "pro (recent)",
    flash: "flash (recent)",
    "flash-lite": "flash-lite (recent)",
  },
};

export const getProviderModelOptions = (
  providerId: ProviderId,
): ProviderModelOption[] => {
  const labelOverrides = PROVIDER_MODEL_LABEL_OVERRIDES[providerId] || {};
  return (AI_MODEL_CATALOG[providerId] || []).map((model) => ({
    value: model,
    label: labelOverrides[model] || model,
  }));
};

export const getOpenCodeConfiguredModel = (
  provider: Pick<SystemProviderCredentialSettings, "openCodeAuthMode" | "openCodeProviderId" | "openCodeModelId"> | null | undefined,
  fallbackModel = "anthropic/claude-sonnet-4-5",
): string | null => {
  if (provider?.openCodeAuthMode !== "CUSTOM_PROVIDER") {
    return null;
  }
  const [fallbackProviderId, ...fallbackModelParts] = fallbackModel.split("/");
  const providerId = (provider.openCodeProviderId || fallbackProviderId || "custom").trim();
  const modelId = (provider.openCodeModelId || fallbackModelParts.join("/") || "model").trim();
  return `${providerId}/${modelId}`;
};

export const getQwenConfiguredModel = (
  provider: Pick<SystemProviderCredentialSettings, "qwenAuthMode" | "qwenModelId"> | null | undefined,
  fallbackModel = "glm-4.7-flash",
): string | null => {
  if (provider?.qwenAuthMode !== "MODEL_PROVIDER") {
    return null;
  }
  const fallback = fallbackModel === "custom/model" || fallbackModel === "local-model"
    ? "glm-4.7-flash"
    : fallbackModel;
  return (provider.qwenModelId || fallback || "glm-4.7-flash").trim();
};

export const getCustomEndpointConfiguredModel = (
  provider: Pick<SystemProviderCredentialSettings, "provider" | "mountAuth" | "customModel"> | null | undefined,
): string | null => {
  if (!provider || provider.mountAuth || (provider.provider !== "codex" && provider.provider !== "claude-code")) {
    return null;
  }
  return provider.customModel?.trim() || null;
};

export const getConfiguredProviderModel = (
  providerId: ProviderId,
  provider: SystemProviderCredentialSettings | null | undefined,
  fallbackModel?: string | null,
): string | null => {
  if (providerId === "codex" || providerId === "claude-code") {
    return getCustomEndpointConfiguredModel(provider);
  }
  if (providerId === "qwen-code") {
    return getQwenConfiguredModel(provider, fallbackModel || undefined);
  }
  if (providerId === "opencode") {
    return getOpenCodeConfiguredModel(provider, fallbackModel || undefined);
  }
  return null;
};

export const getProviderInstanceModelOptions = (
  providerConfigId: ProviderConfigId,
  provider: Pick<ProjectProviderSettings, "provider" | "model">,
  systemSettings: SystemSettings | null,
): ProviderModelOption[] => {
  const baseOptions = getProviderModelOptions(provider.provider);
  const systemProvider = getSystemIntegrationProviders(systemSettings)[providerConfigId];
  const configuredModel = getConfiguredProviderModel(provider.provider, systemProvider, provider.model);
  const selectedModels = [
    configuredModel,
    provider.model,
  ].filter((value): value is string => Boolean(value && value.trim().length > 0));

  const optionsByValue = new Map<string, ProviderModelOption>();
  for (const option of baseOptions) {
    optionsByValue.set(option.value, option);
  }
  for (const selectedModel of selectedModels) {
    if (!optionsByValue.has(selectedModel)) {
      optionsByValue.set(selectedModel, {
        value: selectedModel,
        label: configuredModel === selectedModel
          ? `${selectedModel} (configured)`
          : selectedModel,
      });
    }
  }
  return [...optionsByValue.values()];
};
