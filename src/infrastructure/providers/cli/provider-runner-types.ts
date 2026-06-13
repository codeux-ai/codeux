import type { ProviderId, CliWorkflowSettings, QwenModelProviderSettings, CustomMcpServer } from "../../../contracts/app-types.js";
import type { McpConnectionInfo } from "../../../contracts/mcp-connection-types.js";
import type { CommandResult } from "../../../services/cli-process-runner.js";
import type { ProviderUsageTelemetry } from "./provider-usage.js";

export type ProviderCommandSpec = (model: string, prompt: string) => { command: string; args: string[] };

export interface ProviderRunResult extends CommandResult {
  usageTelemetry: ProviderUsageTelemetry;
  nativeSessionId: string | null;
  text?: string;
}

export type CliProviderId = Extract<ProviderId, "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity">;

export interface ProviderRunInput {
  provider: CliProviderId;
  prompt: string;
  cwd: string;
  model: string;
  apiKey: string;
  qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
  qwenRegion?: "china" | "international";
  qwenBaseUrl?: string;
  qwenEnvKey?: string;
  qwenModelId?: string;
  qwenProtocol?: "openai" | "anthropic" | "gemini";
  qwenAdditionalModelProviders?: QwenModelProviderSettings[];
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
  providerMountAuth?: boolean;
  providerAuthPath?: string;
  /** Override the default API endpoint for providers that support it.
   *  Sets ANTHROPIC_BASE_URL (claude-code) or OPENAI_BASE_URL (codex). */
  customBaseUrl?: string;
  /** Override the model identifier sent to the CLI for providers that support a custom
   *  base URL (claude-code, codex). Used when routing through a gateway such as OpenRouter
   *  whose model slugs differ from the built-in preset names. */
  customModel?: string;
  sessionId: string;
  workspaceSessionId?: string;
  workflowSettings: CliWorkflowSettings;
  repoPath: string;
  githubToken?: string;
  gitlabToken?: string;
  signal?: AbortSignal;
  onActivity: (desc: string, originator?: string) => void;
  onTelemetry?: (telemetry: ProviderUsageTelemetry) => void;
  /** Pass a previous nativeSessionId to continue an existing CLI session.
   *  Claude Code: uses --resume. Gemini: adds --resume. Codex: uses exec resume --last.
   *  Qwen Code uses project-scoped --continue because Code UX logical ids are not Qwen saved-session ids. */
  continueSessionId?: string | null;
  /** MCP server connection info for injecting management tools into the CLI provider. */
  mcpConnection?: McpConnectionInfo | null;
  /** User-defined custom MCP servers injected into the CLI provider alongside code_ux. */
  customMcpServers?: CustomMcpServer[];
}
