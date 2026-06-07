import type { ProviderConfigId, SystemSettings } from "../../types.js";

export type SystemProviderConfig = SystemSettings["integrations"]["providers"][ProviderConfigId];

export const qwenAuthModeOptions = [
  { value: "LOCAL_AUTH", label: "Local auth", hint: "Copy ~/.qwen OAuth cache" },
  { value: "ALIBABA_CODING_PLAN", label: "Coding Plan", hint: "Alibaba Cloud key + region" },
  { value: "MODEL_PROVIDER", label: "Custom endpoint", hint: "modelProviders settings" },
];

export const qwenProtocolOptions = [
  { value: "openai", label: "OpenAI-compatible" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
];

export const qwenRegionOptions = [
  { value: "international", label: "International" },
  { value: "china", label: "China" },
];

export const openCodeAuthModeOptions = [
  { value: "LOCAL_AUTH", label: "Local auth", hint: "Copy auth.json cache" },
  { value: "ENV_KEY", label: "Provider key", hint: "Built-in OpenCode provider" },
  { value: "CUSTOM_PROVIDER", label: "Custom endpoint", hint: "OpenAI-compatible config" },
];

export const getQwenEndpointForRegion = (region: string | undefined): string => (
  region === "china"
    ? "https://coding.dashscope.aliyuncs.com/v1"
    : "https://coding-intl.dashscope.aliyuncs.com/v1"
);

export const maskSecret = (value: string): string => value.trim() ? "********" : "";

export const rewriteDockerLoopbackUrl = (rawUrl: string, dockerExecutionEnabled: boolean): string => {
  if (!dockerExecutionEnabled) {
    return rawUrl;
  }
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1" || url.hostname === "[::1]") {
      url.hostname = "host.docker.internal";
      return url.toString();
    }
  } catch {
    return rawUrl;
  }
  return rawUrl;
};

export const splitOpenCodeModel = (model: string): { providerId: string; modelId: string } => {
  const [providerId, ...modelParts] = (model || "anthropic/claude-sonnet-4-5").split("/");
  return {
    providerId: providerId || "anthropic",
    modelId: modelParts.join("/") || "claude-sonnet-4-5",
  };
};

export const buildQwenSettingsPreview = (
  provider: SystemProviderConfig,
  model: string,
  dockerExecutionEnabled: boolean,
): string => {
  const authMode = provider.qwenAuthMode || "MODEL_PROVIDER";
  const envKey = authMode === "ALIBABA_CODING_PLAN"
    ? "BAILIAN_CODING_PLAN_API_KEY"
    : provider.qwenEnvKey || "OLLAMA_API_KEY";
  const baseUrl = authMode === "ALIBABA_CODING_PLAN"
    ? getQwenEndpointForRegion(provider.qwenRegion)
    : provider.qwenBaseUrl || "http://127.0.0.1:11434/v1";
  const protocol = provider.qwenProtocol || "openai";
  const modelId = authMode === "MODEL_PROVIDER"
    ? (provider.qwenModelId || (model === "custom/model" || model === "local-model" ? "glm-4.7-flash" : model) || "glm-4.7-flash")
    : model || "qwen3-coder-plus";
  const primaryProvider = {
    id: modelId,
    name: provider.name,
    baseUrl: rewriteDockerLoopbackUrl(baseUrl, dockerExecutionEnabled),
    description: authMode === "ALIBABA_CODING_PLAN" ? "Qwen via Alibaba Cloud Coding Plan" : "Qwen custom model provider",
    envKey,
  };
  const additional = (provider.qwenAdditionalModelProviders || []).map((entry) => ({
    id: entry.id,
    name: entry.name || entry.id,
    baseUrl: rewriteDockerLoopbackUrl(entry.baseUrl, dockerExecutionEnabled),
    description: entry.description,
    envKey: entry.envKey,
  }));
  return JSON.stringify({
    modelProviders: {
      [protocol]: [primaryProvider, ...additional],
    },
    env: {
      [envKey]: maskSecret(provider.apiKey),
      ...Object.fromEntries((provider.qwenAdditionalModelProviders || []).map((entry) => [entry.envKey, maskSecret(entry.apiKey)])),
    },
    security: {
      auth: {
        selectedType: protocol,
      },
    },
    model: {
      name: modelId,
    },
    ...(authMode === "ALIBABA_CODING_PLAN" ? { codingPlan: { region: provider.qwenRegion || "international" } } : {}),
  }, null, 2);
};

export const buildOpenCodeConfigPreview = (
  provider: SystemProviderConfig,
  model: string,
  dockerExecutionEnabled: boolean,
): string => {
  const authMode = provider.openCodeAuthMode || "ENV_KEY";
  const modelParts = splitOpenCodeModel(model);
  const providerId = provider.openCodeProviderId || modelParts.providerId;
  const modelId = provider.openCodeModelId || modelParts.modelId;
  const selectedModel = authMode === "CUSTOM_PROVIDER" ? `${providerId}/${modelId}` : model || `${providerId}/${modelId}`;
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    model: selectedModel,
    autoupdate: false,
    permission: "allow",
  };
  if (authMode === "ENV_KEY") {
    config.provider = {
      [providerId]: {
        options: {
          apiKey: "{env:OPENCODE_API_KEY}",
        },
      },
    };
  }
  if (authMode === "CUSTOM_PROVIDER") {
    config.provider = {
      [providerId]: {
        npm: provider.openCodePackage || "@ai-sdk/openai-compatible",
        name: providerId,
        options: {
          baseURL: rewriteDockerLoopbackUrl(provider.openCodeBaseUrl || "http://127.0.0.1:11434/v1", dockerExecutionEnabled),
          apiKey: "{env:OPENCODE_API_KEY}",
        },
        models: {
          [modelId]: { name: modelId },
        },
      },
    };
  }
  return JSON.stringify({
    ...config,
    env: {
      [provider.openCodeEnvKey || "OLLAMA_API_KEY"]: maskSecret(provider.apiKey),
      OPENCODE_API_KEY: maskSecret(provider.apiKey),
    },
  }, null, 2);
};
