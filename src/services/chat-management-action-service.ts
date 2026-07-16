import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../contracts/internal-management-types.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { AgentMcpAccessConfig } from "../contracts/agent-preset-types.js";
import type { DashboardSettings, ProviderConfigMode, ProviderId, QwenModelProviderSettings, ThinkingMode } from "../contracts/app-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ManagementToolHandler } from "../mcp/management-tool-handler.js";
import type { StructuredProviderResponseService } from "./structured-provider-response-service.js";
import type { ProviderExecutionService } from "./provider-execution-service.js";
import type { SnapshotCheckout } from "../infrastructure/providers/cli/workspace-manager.js";
import type { InvocationWorkspaceGitPolicy } from "../infrastructure/providers/cli/invocation-workspace-preparer.js";
import {
  AGENT_RESPONSE_ANIMATIONS,
  AGENT_RESPONSE_EFFECT_MAX_CAPTION_LENGTH,
  AGENT_RESPONSE_EFFECT_MAX_DURATION_MS,
  AGENT_RESPONSE_EFFECT_MIN_DURATION_MS,
  AGENT_RESPONSE_EMOTIONS,
  type AgentResponseEffect,
  type PromptSuggestion,
} from "../contracts/connection-chat-types.js";
import { findAllJsonCandidates } from "../domain/llm/json-extraction.js";

export interface ChatManagementActionServiceDeps {
  structuredProviderResponseService: StructuredProviderResponseService;
  providerExecutionService: ProviderExecutionService;
  managementToolHandler: ManagementToolHandler;
  executionRepository: ExecutionRepository;
}

export interface ManagementActionProposedResult {
  replyMarkdown: string;
  action: ManageCodeUxArgs | null;
  approvalRequired: boolean;
  approvalMessage?: string;
  result?: unknown;
  nativeSessionId?: string | null;
  promptSuggestions?: PromptSuggestion[];
  agentEffect?: AgentResponseEffect;
}

interface ParsedProviderManagementJSON {
  replyMarkdown: string;
  action: ManageCodeUxArgs | null;
  promptSuggestions?: PromptSuggestion[];
  agentEffect?: AgentResponseEffect;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const MAX_PROMPT_SUGGESTIONS = 6;

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizePromptSuggestions(value: unknown): PromptSuggestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const suggestions: PromptSuggestion[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const label = trimmedString(item.label);
    const prompt = trimmedString(item.prompt);
    if (!label || !prompt) {
      continue;
    }

    const suggestion: PromptSuggestion = { label, prompt };
    const icon = trimmedString(item.icon);
    if (icon) {
      suggestion.icon = icon;
    }
    const id = trimmedString(item.id);
    if (id) {
      suggestion.id = id;
    }
    suggestions.push(suggestion);

    if (suggestions.length >= MAX_PROMPT_SUGGESTIONS) {
      break;
    }
  }

  return suggestions;
}

const supportedAgentEmotions = new Set<string>(AGENT_RESPONSE_EMOTIONS);
const supportedAgentAnimations = new Set<string>(AGENT_RESPONSE_ANIMATIONS);

export function sanitizeAgentResponseEffect(value: unknown): AgentResponseEffect | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const emotion = value.emotion;
  const animation = value.animation;
  const durationMs = value.durationMs;
  if (
    typeof emotion !== "string"
    || !supportedAgentEmotions.has(emotion)
    || typeof animation !== "string"
    || !supportedAgentAnimations.has(animation)
    || typeof durationMs !== "number"
    || !Number.isSafeInteger(durationMs)
    || durationMs < AGENT_RESPONSE_EFFECT_MIN_DURATION_MS
    || durationMs > AGENT_RESPONSE_EFFECT_MAX_DURATION_MS
  ) {
    return undefined;
  }

  const effect: AgentResponseEffect = {
    emotion: emotion as AgentResponseEffect["emotion"],
    animation: animation as AgentResponseEffect["animation"],
    durationMs,
  };
  if (value.caption !== undefined) {
    if (typeof value.caption !== "string") {
      return undefined;
    }
    const caption = value.caption.trim();
    if (!caption || caption.length > AGENT_RESPONSE_EFFECT_MAX_CAPTION_LENGTH) {
      return undefined;
    }
    effect.caption = caption;
  }
  return effect;
}

function parseNativeAgentEffect(markdown: string): { replyMarkdown: string; agentEffect?: AgentResponseEffect } {
  let agentEffect: AgentResponseEffect | undefined;
  const replyMarkdown = markdown.replace(
    /^```codeux:agent[^\n]*\n([\s\S]*?)^```[ \t]*$/gm,
    (fence, rawJson: string) => {
      try {
        const parsed = JSON.parse(rawJson) as unknown;
        const sanitized = sanitizeAgentResponseEffect(parsed);
        if (sanitized) {
          agentEffect ??= sanitized;
          return "";
        }
      } catch {
        // Preserve malformed effect payloads below as readable JSON markdown.
      }
      return fence.replace(/^```codeux:agent[^\n]*/, "```json");
    },
  ).replace(/\n{3,}/g, "\n\n").trim();

  return { replyMarkdown, ...(agentEffect ? { agentEffect } : {}) };
}

export const parseProviderManagementJson = (bodyMarkdown: string, depth = 0): ParsedProviderManagementJSON => {
  if (depth > 2) {
    throw new Error("Missing or invalid 'replyMarkdown'");
  }

  for (const candidate of findAllJsonCandidates(bodyMarkdown)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;

      if (isRecord(parsed) && typeof parsed.replyMarkdown === "string") {
        const rawSuggestions = Array.isArray(parsed.promptSuggestions)
          ? parsed.promptSuggestions
          : parsed.suggestions;
        const promptSuggestions = sanitizePromptSuggestions(rawSuggestions);
        const agentEffect = sanitizeAgentResponseEffect(parsed.agentEffect);
        return {
          replyMarkdown: parsed.replyMarkdown,
          action: isRecord(parsed.action) ? parsed.action as unknown as ManageCodeUxArgs : null,
          ...(promptSuggestions.length > 0 ? { promptSuggestions } : {}),
          ...(agentEffect ? { agentEffect } : {}),
        };
      }

      if (isRecord(parsed) && typeof parsed.response === "string") {
        return parseProviderManagementJson(parsed.response, depth + 1);
      }
    } catch {
      // Keep scanning; provider output can include bootstrap logs around the JSON payload.
    }
  }

  throw new Error("Missing or invalid 'replyMarkdown'");
};

export interface ProcessManagementActionArgs {
  projectId: string;
  provider: Exclude<ProviderId, "jules">;
  model: string;
  thinkingMode?: ThinkingMode;
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
  providerConfigMode?: ProviderConfigMode;
  providerConfigPath?: string;
  customBaseUrl?: string;
  customModel?: string;
  sessionId: string;
  continueSessionId?: string | null;
  /** Continue the workspace-local provider conversation without treating the
   *  logical dashboard thread id as a native provider session id. */
  continueSessionWithoutNativeId?: boolean;
  /** Baseline for opencode's cumulative session export, when `continueSessionId`
   *  resumes an earlier chat turn's session. See chat-thread-runtime-service.ts. */
  openCodeBaselineRawUsageJson?: Record<string, unknown> | null;
  settings: DashboardSettings;
  prompt: string;
  repoPath: string;
  snapshotCheckout?: SnapshotCheckout;
  gitPolicy?: InvocationWorkspaceGitPolicy;
  workspaceLifecycle?: "fresh" | "continue";
  mcpConnection?: McpConnectionInfo | null;
  /** Per-agent MCP access for the responding agent; undefined = not agent-scoped. */
  agentMcpAccess?: AgentMcpAccessConfig | null;
  /** Responding agent preset id, for code_ux gateway tool enforcement. */
  mcpAgentId?: string | null;
  /** Aborts the in-flight provider invocation (and any pending concurrency wait) when a newer chat message supersedes this turn. */
  signal?: AbortSignal;
}

export class ChatManagementActionService {
  constructor(private readonly deps: ChatManagementActionServiceDeps) {}

  private isExecutionInvocationActiveForFinalize(invocationId: string): boolean {
    if (typeof this.deps.executionRepository.getExecutionInvocation !== "function") {
      return true;
    }
    const current = this.deps.executionRepository.getExecutionInvocation(invocationId);
    return current?.status !== "cancelled";
  }

  async executeApprovedAction(projectId: string, provider: string, model: string, action: ManageCodeUxArgs): Promise<ManagementActionProposedResult> {
    const startedAt = new Date().toISOString();
    const execInvocationId = this.deps.executionRepository.createExecutionInvocation({
      projectId,
      skipValidation: true,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      taskRunId: null,
      attentionItemId: null,
      type: "worker_reply",
      provider,
      model,
      startedAt,
    }).id;

    try {
      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
        role: "system",
        contentMarkdown: `Executing user-approved management action: ${JSON.stringify(action, null, 2)}`,
      });

      const approvedAction = { ...action, approval: { confirmed: true } };
      const envelopeJson = await this.deps.managementToolHandler.handleManageCodeUx(approvedAction);
      const envelopeText = envelopeJson.content[0].text;
      const envelope = JSON.parse(envelopeText) as ManagementResponseEnvelope;

      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
        role: "system",
        contentMarkdown: `Action result: ${JSON.stringify(envelope, null, 2)}`,
      });

      this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
        status: "completed",
        finishedAt: new Date().toISOString(),
      });

      return {
        replyMarkdown: "_Approved action execution completed._",
        action: approvedAction,
        approvalRequired: false,
        result: envelope.result,
      };
    } catch (err: unknown) {
      this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      throw err;
    }
  }

  async processManagementAction(args: ProcessManagementActionArgs): Promise<ManagementActionProposedResult> {
    if (args.mcpConnection) {
      return this.processWithNativeMcp(args);
    }
    return this.processWithJsonParsing(args);
  }

  private async processWithNativeMcp(args: ProcessManagementActionArgs): Promise<ManagementActionProposedResult> {
    const startedAt = new Date().toISOString();
    const execInvocationId = this.deps.executionRepository.createExecutionInvocation({
      projectId: args.projectId,
      skipValidation: true,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      taskRunId: null,
      attentionItemId: null,
      type: "worker_reply",
      provider: args.provider,
      model: args.model,
      startedAt,
    }).id;

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
      role: "user",
      contentMarkdown: args.prompt,
    });

    try {
      const result = await this.deps.providerExecutionService.executeProvider({
        projectId: args.projectId,
        purpose: "dashboard_reply",
        type: "worker_reply",
        provider: args.provider,
        prompt: args.prompt,
        model: args.model,
        thinkingMode: args.thinkingMode,
        apiKey: args.apiKey,
        qwenAuthMode: args.qwenAuthMode,
        qwenRegion: args.qwenRegion,
        qwenBaseUrl: args.qwenBaseUrl,
        qwenEnvKey: args.qwenEnvKey,
        qwenModelId: args.qwenModelId,
        qwenProtocol: args.qwenProtocol,
        qwenAdditionalModelProviders: args.qwenAdditionalModelProviders,
        openCodeAuthMode: args.openCodeAuthMode,
        openCodeProviderId: args.openCodeProviderId,
        openCodeModelId: args.openCodeModelId,
        openCodeBaseUrl: args.openCodeBaseUrl,
        openCodeEnvKey: args.openCodeEnvKey,
        openCodePackage: args.openCodePackage,
        providerMountAuth: args.providerMountAuth,
        providerAuthPath: args.providerAuthPath,
        providerConfigMode: args.providerConfigMode,
        providerConfigPath: args.providerConfigPath,
        customBaseUrl: args.customBaseUrl,
        customModel: args.customModel,
        sessionId: args.sessionId,
        continueSessionId: args.continueSessionId,
        continueSessionWithoutNativeId: args.continueSessionWithoutNativeId,
        openCodeBaselineRawUsageJson: args.openCodeBaselineRawUsageJson,
        workflowSettings: args.settings.cliWorkflow,
        repoPath: args.repoPath,
        snapshotCheckout: args.snapshotCheckout,
        gitPolicy: args.gitPolicy,
        workspaceLifecycle: args.workspaceLifecycle,
        invocationId: execInvocationId,
        trackPromptInInvocation: false,
        finalizeExecutionInvocation: false,
        expectTextOutput: true,
        mcpConnection: args.mcpConnection,
        customMcpServers: args.settings.customMcpServers,
        agentMcpAccess: args.agentMcpAccess,
        mcpAgentId: args.mcpAgentId,
        signal: args.signal,
      });

      const replyText = (result.text?.trim() || result.stdout || "").trim();
      const parsedReply = parseNativeAgentEffect(replyText || "_No response._");

      if ((result.usageTelemetry.conversation?.length ?? 0) === 0) {
        this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
          role: "assistant",
          contentMarkdown: replyText || "_No response from provider._",
        });
      }

      if (this.isExecutionInvocationActiveForFinalize(execInvocationId)) {
        this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
          status: args.signal?.aborted ? "cancelled" : (result.ok ? "completed" : "failed"),
          finishedAt: new Date().toISOString(),
        });
      }

      if (!result.ok) {
        throw new Error(`Virtual ${args.provider} worker failed: ${result.stderr || result.stdout}`);
      }

      return {
        replyMarkdown: parsedReply.replyMarkdown || "_No response._",
        action: null,
        approvalRequired: false,
        nativeSessionId: result.nativeSessionId,
        ...(parsedReply.agentEffect ? { agentEffect: parsedReply.agentEffect } : {}),
      };
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      const wasCancelled = Boolean(args.signal?.aborted);
      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
        role: "system",
        contentMarkdown: wasCancelled ? "Superseded by a newer chat message." : `Error: ${errMessage}`,
      });
      if (this.isExecutionInvocationActiveForFinalize(execInvocationId)) {
        this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
          status: wasCancelled ? "cancelled" : "failed",
          finishedAt: new Date().toISOString(),
        });
      }
      throw err;
    }
  }

  private async processWithJsonParsing(args: ProcessManagementActionArgs): Promise<ManagementActionProposedResult> {
    const purpose = "dashboard_reply";
    const startedAt = new Date().toISOString();

    // Create execution invocation specifically to track the management action exchange
    const execInvocationId = this.deps.executionRepository.createExecutionInvocation({
      projectId: args.projectId,
      skipValidation: true,
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      taskRunId: null,
      attentionItemId: null,
      type: "worker_reply",
      provider: args.provider,
      model: args.model,
      startedAt,
    }).id;

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
      role: "user",
      contentMarkdown: args.prompt,
    });

    try {
      const response = await this.deps.structuredProviderResponseService.executeAndParse<ParsedProviderManagementJSON>({
        projectId: args.projectId,
        purpose,
        type: "worker_reply",
        provider: args.provider,
        prompt: args.prompt,
        model: args.model,
        apiKey: args.apiKey,
        qwenAuthMode: args.qwenAuthMode,
        qwenRegion: args.qwenRegion,
        qwenBaseUrl: args.qwenBaseUrl,
        qwenEnvKey: args.qwenEnvKey,
        qwenModelId: args.qwenModelId,
        qwenProtocol: args.qwenProtocol,
        qwenAdditionalModelProviders: args.qwenAdditionalModelProviders,
        openCodeAuthMode: args.openCodeAuthMode,
        openCodeProviderId: args.openCodeProviderId,
        openCodeModelId: args.openCodeModelId,
        openCodeBaseUrl: args.openCodeBaseUrl,
        openCodeEnvKey: args.openCodeEnvKey,
        openCodePackage: args.openCodePackage,
        providerMountAuth: args.providerMountAuth,
        providerAuthPath: args.providerAuthPath,
        providerConfigMode: args.providerConfigMode,
        providerConfigPath: args.providerConfigPath,
        customBaseUrl: args.customBaseUrl,
        customModel: args.customModel,
        sessionId: args.sessionId,
        continueSessionId: args.continueSessionId,
        continueSessionWithoutNativeId: args.continueSessionWithoutNativeId,
        openCodeBaselineRawUsageJson: args.openCodeBaselineRawUsageJson,
        workflowSettings: args.settings.cliWorkflow,
        repoPath: args.repoPath,
        snapshotCheckout: args.snapshotCheckout,
        gitPolicy: args.gitPolicy,
        workspaceLifecycle: args.workspaceLifecycle,
        settings: args.settings,
        providerLabel: args.provider,
        invocationId: execInvocationId,
        trackPromptInInvocation: false,
        finalizeExecutionInvocation: false,
        parseFn: (bodyMarkdown: string) => {
          return parseProviderManagementJson(bodyMarkdown);
        },
        buildRetryPrompt: (error: Error) => {
          return `Your response could not be parsed as valid JSON. Please return STRICT JSON with \`replyMarkdown\`, \`action\`, and optional \`suggestions\` fields.\nError: ${error.message}`;
        },
        signal: args.signal,
      });

      const parsed = response.parsed;

      if (!response.hasStructuredConversation) {
        this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
          role: "assistant",
          contentMarkdown: response.bodyMarkdown || parsed.replyMarkdown,
        });
      }

      if (!parsed.action || !parsed.action.domain || !parsed.action.action) {
        // No action proposed, just a reply
        if (this.isExecutionInvocationActiveForFinalize(execInvocationId)) {
          this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
            status: "completed",
            finishedAt: new Date().toISOString(),
          });
        }
        return {
          replyMarkdown: parsed.replyMarkdown,
          action: null,
          approvalRequired: false,
          nativeSessionId: response.nativeSessionId,
          ...(parsed.promptSuggestions?.length ? { promptSuggestions: parsed.promptSuggestions } : {}),
          ...(parsed.agentEffect ? { agentEffect: parsed.agentEffect } : {}),
        };
      }

      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
        role: "system",
        contentMarkdown: `Action proposed: ${JSON.stringify(parsed.action, null, 2)}`,
      });

      const envelopeJson = await this.deps.managementToolHandler.handleManageCodeUx(parsed.action);
      // The envelope is returned as a stringified JSON in the content array from the tool handler
      const envelopeText = envelopeJson.content[0].text;
      const envelope = JSON.parse(envelopeText) as ManagementResponseEnvelope;

      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
        role: "system",
        contentMarkdown: `Action result: ${JSON.stringify(envelope, null, 2)}`,
      });

      if (this.isExecutionInvocationActiveForFinalize(execInvocationId)) {
        this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
      }

      return {
        replyMarkdown: parsed.replyMarkdown,
        action: parsed.action,
        approvalRequired: !!envelope.approvalRequired,
        approvalMessage: envelope.approvalMessage,
        result: envelope.result,
        nativeSessionId: response.nativeSessionId,
        ...(parsed.promptSuggestions?.length ? { promptSuggestions: parsed.promptSuggestions } : {}),
        ...(parsed.agentEffect ? { agentEffect: parsed.agentEffect } : {}),
      };

    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      const wasCancelled = Boolean(args.signal?.aborted);
      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
        role: "system",
        contentMarkdown: wasCancelled ? "Superseded by a newer chat message." : `Error: ${errMessage}`,
      });
      if (this.isExecutionInvocationActiveForFinalize(execInvocationId)) {
        this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
          status: wasCancelled ? "cancelled" : "failed",
          finishedAt: new Date().toISOString(),
        });
      }
      throw err;
    }
  }
}
