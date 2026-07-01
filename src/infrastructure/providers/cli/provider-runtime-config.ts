import type { CustomMcpServer, QwenModelProviderSettings } from "../../../contracts/app-types.js";
import type { McpConnectionInfo } from "../../../contracts/mcp-connection-types.js";
import { enabledCustomServersFor } from "./provider-command-specs.js";

export interface OpenCodeRuntimeSettings {
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
  customMcpServers?: CustomMcpServer[];
}

export interface QwenRuntimeSettings {
  qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
  qwenRegion?: "china" | "international";
  qwenBaseUrl?: string;
  qwenEnvKey?: string;
  qwenModelId?: string;
  qwenProtocol?: "openai" | "anthropic" | "gemini";
  qwenAdditionalModelProviders?: QwenModelProviderSettings[];
}

export function buildQwenRuntimeConfig(
  model: string,
  config: QwenRuntimeSettings | undefined,
  conn: McpConnectionInfo | null,
  rewriteDockerLoopbackUrls: boolean,
  rewriteLoopbackUrlForDocker: (url: string, enabled: boolean) => string,
  openAiLogDir?: string,
): string {
  const authMode = config?.qwenAuthMode || "LOCAL_AUTH";
  const protocol = config?.qwenProtocol || "openai";
  const envKey = authMode === "ALIBABA_CODING_PLAN"
    ? "BAILIAN_CODING_PLAN_API_KEY"
    : config?.qwenEnvKey || "OLLAMA_API_KEY";
  const baseUrl = authMode === "ALIBABA_CODING_PLAN"
    ? config?.qwenRegion === "china"
      ? "https://coding.dashscope.aliyuncs.com/v1"
      : "https://coding-intl.dashscope.aliyuncs.com/v1"
    : authMode === "MODEL_PROVIDER"
      ? config?.qwenBaseUrl || "http://127.0.0.1:11434/v1"
      : config?.qwenBaseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const selectedModel = authMode === "MODEL_PROVIDER"
    ? (config?.qwenModelId || (model === "custom/model" || model === "local-model" ? "glm-4.7-flash" : model) || "glm-4.7-flash").trim()
    : model && model !== "default"
      ? model
      : "qwen3-coder-plus";
  const headers: Record<string, string> = {};
  if (conn?.authToken) {
    headers.Authorization = `Bearer ${conn.authToken}`;
  }
  if (conn?.agentId) {
    headers["X-Code-Ux-Agent"] = conn.agentId;
  }

  const modelConfig: Record<string, unknown> = {
    name: selectedModel,
    enableOpenAILogging: true,
  };
  const runtimeConfig: Record<string, unknown> = {
    security: {
      auth: {
        selectedType: authMode === "LOCAL_AUTH" ? "qwen-oauth" : protocol,
      },
    },
    memory: {
      enableManagedAutoMemory: false,
      enableManagedAutoDream: false,
    },
    model: modelConfig,
  };
  if (openAiLogDir) {
    modelConfig.openAILoggingDir = openAiLogDir;
    runtimeConfig.openAILoggingDir = openAiLogDir;
  }

  if (authMode !== "LOCAL_AUTH") {
    runtimeConfig.modelProviders = {
      [protocol]: [
        {
          id: selectedModel,
          name: config?.qwenModelId || selectedModel,
          baseUrl: rewriteLoopbackUrlForDocker(baseUrl, rewriteDockerLoopbackUrls),
          description: authMode === "ALIBABA_CODING_PLAN" ? "Qwen via Alibaba Cloud Coding Plan" : "Qwen custom model provider",
          envKey,
        },
        ...(config?.qwenAdditionalModelProviders || []).map((entry) => ({
          id: entry.id,
          name: entry.name || entry.id,
          baseUrl: rewriteLoopbackUrlForDocker(entry.baseUrl, rewriteDockerLoopbackUrls),
          description: entry.description,
          envKey: entry.envKey,
        })),
      ],
    };
  }

  if (conn) {
    runtimeConfig.mcpServers = {
      code_ux: {
        httpUrl: rewriteLoopbackUrlForDocker(conn.url, rewriteDockerLoopbackUrls),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      },
    };
  }

  return JSON.stringify(runtimeConfig);
}

export function buildOpenCodeRuntimeConfig(
  model: string,
  config: OpenCodeRuntimeSettings | undefined,
  conn: McpConnectionInfo | null,
  rewriteDockerLoopbackUrls: boolean,
  rewriteLoopbackUrlForDocker: (url: string, enabled: boolean) => string,
): string {
  const authMode = config?.openCodeAuthMode || "LOCAL_AUTH";
  const providerId = (config?.openCodeProviderId || model.split("/")[0] || (authMode === "CUSTOM_PROVIDER" ? "ollama" : "anthropic")).trim();
  const modelId = (config?.openCodeModelId || model.split("/").slice(1).join("/") || (authMode === "CUSTOM_PROVIDER" ? "glm-4.7-flash" : "claude-sonnet-4-5")).trim();
  const selectedModel = authMode === "CUSTOM_PROVIDER"
    ? `${providerId}/${modelId}`
    : model && model !== "default"
      ? model
      : `${providerId}/${modelId}`;
  const runtimeConfig: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    model: selectedModel,
    autoupdate: false,
    permission: "allow",
  };

  if (authMode === "ENV_KEY") {
    runtimeConfig.provider = {
      [providerId]: {
        options: {
          apiKey: "{env:OPENCODE_API_KEY}",
        },
      },
    };
  } else if (authMode === "CUSTOM_PROVIDER") {
    runtimeConfig.provider = {
      [providerId]: {
        npm: config?.openCodePackage || "@ai-sdk/openai-compatible",
        name: providerId,
        options: {
          baseURL: rewriteLoopbackUrlForDocker(config?.openCodeBaseUrl || "http://127.0.0.1:11434/v1", rewriteDockerLoopbackUrls),
          apiKey: "{env:OPENCODE_API_KEY}",
        },
        models: {
          [modelId]: {
            name: modelId,
          },
        },
      },
    };
  }

  const mcpServers: Record<string, unknown> = {};
  if (conn) {
    const headers: Record<string, string> = {};
    if (conn.authToken) {
      headers.Authorization = `Bearer ${conn.authToken}`;
    }
    if (conn.agentId) {
      headers["X-Code-Ux-Agent"] = conn.agentId;
    }
    mcpServers.code_ux = {
      type: "remote",
      url: rewriteLoopbackUrlForDocker(conn.url, rewriteDockerLoopbackUrls),
      enabled: true,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }

  const applicableCustomServers = enabledCustomServersFor(config?.customMcpServers, "opencode");
  for (const server of applicableCustomServers) {
    if (server.transport === "stdio") {
      mcpServers[server.name] = {
        type: "local",
        command: [server.command || "", ...(server.args || [])],
        enabled: true,
        ...(server.env && Object.keys(server.env).length > 0 ? { environment: server.env } : {}),
      };
    } else {
      mcpServers[server.name] = {
        type: "remote",
        url: rewriteLoopbackUrlForDocker(server.url || "", rewriteDockerLoopbackUrls),
        enabled: true,
        ...(server.headers && Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}),
      };
    }
  }

  if (Object.keys(mcpServers).length > 0) {
    runtimeConfig.mcp = mcpServers;
  }

  return JSON.stringify(runtimeConfig);
}
