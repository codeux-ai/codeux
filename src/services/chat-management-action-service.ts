import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../contracts/internal-management-types.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { AgentMcpAccessConfig } from "../contracts/agent-preset-types.js";
import type { DashboardSettings, ProviderId, QwenModelProviderSettings } from "../contracts/app-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ManagementToolHandler } from "../mcp/management-tool-handler.js";
import type { StructuredProviderResponseService } from "./structured-provider-response-service.js";
import type { ProviderExecutionService } from "./provider-execution-service.js";

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
}

interface ParsedProviderManagementJSON {
  replyMarkdown: string;
  action: ManageCodeUxArgs | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const stripJsonLanguagePrefix = (value: string): string => {
  return value.trim().replace(/^json\s*\n/i, "").trim();
};

const extractJsonObjectCandidates = (value: string): string[] => {
  const candidates: string[] = [];
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }

    if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && startIndex >= 0) {
        candidates.push(value.slice(startIndex, index + 1));
        startIndex = -1;
      }
    }
  }

  return candidates;
};

const buildJsonCandidates = (bodyMarkdown: string): string[] => {
  const candidates: string[] = [];
  const pushCandidate = (candidate: string): void => {
    const trimmed = candidate.trim();
    if (trimmed && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
    const stripped = stripJsonLanguagePrefix(candidate);
    if (stripped && stripped !== trimmed && !candidates.includes(stripped)) {
      candidates.push(stripped);
    }
  };

  pushCandidate(bodyMarkdown);

  const fencedJsonPattern = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencedJsonPattern.exec(bodyMarkdown)) !== null) {
    pushCandidate(match[1] || "");
  }

  for (const candidate of extractJsonObjectCandidates(bodyMarkdown)) {
    pushCandidate(candidate);
  }

  return candidates;
};

const parseProviderManagementJson = (bodyMarkdown: string, depth = 0): ParsedProviderManagementJSON => {
  if (depth > 2) {
    throw new Error("Missing or invalid 'replyMarkdown'");
  }

  for (const candidate of buildJsonCandidates(bodyMarkdown)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;

      if (isRecord(parsed) && typeof parsed.replyMarkdown === "string") {
        return {
          replyMarkdown: parsed.replyMarkdown,
          action: isRecord(parsed.action) ? parsed.action as unknown as ManageCodeUxArgs : null,
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
  customBaseUrl?: string;
  customModel?: string;
  codexWireApi?: "chat" | "responses";
  sessionId: string;
  settings: DashboardSettings;
  prompt: string;
  repoPath: string;
  mcpConnection?: McpConnectionInfo | null;
  /** Per-agent MCP access for the responding agent; undefined = not agent-scoped. */
  agentMcpAccess?: AgentMcpAccessConfig | null;
  /** Responding agent preset id, for code_ux gateway tool enforcement. */
  mcpAgentId?: string | null;
}

export class ChatManagementActionService {
  constructor(private readonly deps: ChatManagementActionServiceDeps) {}

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
        customBaseUrl: args.customBaseUrl,
        customModel: args.customModel,
        codexWireApi: args.codexWireApi,
        sessionId: args.sessionId,
        workflowSettings: args.settings.cliWorkflow,
        repoPath: args.repoPath,
        invocationId: execInvocationId,
        trackPromptInInvocation: false,
        trackAssistantInInvocation: false,
        finalizeExecutionInvocation: false,
        expectTextOutput: true,
        mcpConnection: args.mcpConnection,
        customMcpServers: args.settings.customMcpServers,
        agentMcpAccess: args.agentMcpAccess,
        mcpAgentId: args.mcpAgentId,
      });

      const replyText = (result.text?.trim() || result.stdout || "").trim();

      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
        role: "assistant",
        contentMarkdown: replyText || "_No response from provider._",
      });

      this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
        status: result.ok ? "completed" : "failed",
        finishedAt: new Date().toISOString(),
      });

      if (!result.ok) {
        throw new Error(`Virtual ${args.provider} worker failed: ${result.stderr || result.stdout}`);
      }

      return {
        replyMarkdown: replyText || "_No response._",
        action: null,
        approvalRequired: false,
      };
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
        role: "system",
        contentMarkdown: `Error: ${errMessage}`,
      });
      this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
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
        customBaseUrl: args.customBaseUrl,
        customModel: args.customModel,
        codexWireApi: args.codexWireApi,
        sessionId: args.sessionId,
        workflowSettings: args.settings.cliWorkflow,
        repoPath: args.repoPath,
        settings: args.settings,
        providerLabel: args.provider,
        invocationId: execInvocationId,
        trackPromptInInvocation: false,
        trackAssistantInInvocation: false,
        finalizeExecutionInvocation: false,
        parseFn: (bodyMarkdown: string) => {
          return parseProviderManagementJson(bodyMarkdown);
        },
        buildRetryPrompt: (error: Error) => {
          return `Your response could not be parsed as valid JSON. Please return STRICT JSON with \`replyMarkdown\` and \`action\` fields.\nError: ${error.message}`;
        },
      });

      const parsed = response.parsed;

      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
        role: "assistant",
        contentMarkdown: response.bodyMarkdown || parsed.replyMarkdown,
      });

      if (!parsed.action || !parsed.action.domain || !parsed.action.action) {
        // No action proposed, just a reply
        this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
        return {
          replyMarkdown: parsed.replyMarkdown,
          action: null,
          approvalRequired: false,
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

      this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
        status: "completed",
        finishedAt: new Date().toISOString(),
      });

      return {
        replyMarkdown: parsed.replyMarkdown,
        action: parsed.action,
        approvalRequired: !!envelope.approvalRequired,
        approvalMessage: envelope.approvalMessage,
        result: envelope.result,
      };

    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocationId, {
        role: "system",
        contentMarkdown: `Error: ${errMessage}`,
      });
      this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      throw err;
    }
  }
}
