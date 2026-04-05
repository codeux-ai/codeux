import type { ManageSprintOsArgs, ManagementResponseEnvelope } from "../contracts/internal-management-types.js";
import type { DashboardSettings, ProviderId } from "../contracts/app-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ManagementToolHandler } from "../mcp/management-tool-handler.js";
import type { StructuredProviderResponseService } from "./structured-provider-response-service.js";

export interface ChatManagementActionServiceDeps {
  structuredProviderResponseService: StructuredProviderResponseService;
  managementToolHandler: ManagementToolHandler;
  executionRepository: ExecutionRepository;
}

export interface ManagementActionProposedResult {
  replyMarkdown: string;
  action: ManageSprintOsArgs | null;
  approvalRequired: boolean;
  approvalMessage?: string;
  result?: unknown;
}

interface ParsedProviderManagementJSON {
  replyMarkdown: string;
  action: ManageSprintOsArgs | null;
}

export interface ProcessManagementActionArgs {
  projectId: string;
  provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
  model: string;
  apiKey: string;
  sessionId: string;
  settings: DashboardSettings;
  prompt: string;
}

export class ChatManagementActionService {
  constructor(private readonly deps: ChatManagementActionServiceDeps) {}

  async executeApprovedAction(projectId: string, provider: string, model: string, action: ManageSprintOsArgs): Promise<ManagementActionProposedResult> {
    const startedAt = new Date().toISOString();
    const execInvocationId = this.deps.executionRepository.createExecutionInvocation({
      projectId,
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
      const envelopeJson = await this.deps.managementToolHandler.handleManageSprintOs(approvedAction);
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
    const purpose = "dashboard_reply";
    const startedAt = new Date().toISOString();

    // Create execution invocation specifically to track the management action exchange
    const execInvocationId = this.deps.executionRepository.createExecutionInvocation({
      projectId: args.projectId,
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

    try {
      const response = await this.deps.structuredProviderResponseService.executeAndParse<ParsedProviderManagementJSON>({
        projectId: args.projectId,
        purpose,
        type: "worker_reply",
        provider: args.provider,
        prompt: args.prompt,
        model: args.model,
        apiKey: args.apiKey,
        sessionId: args.sessionId,
        workflowSettings: args.settings.cliWorkflow,
        repoPath: "/", // Fallback or dummy, the provider execution service might not need it for pure completion
        settings: args.settings,
        providerLabel: args.provider,
        invocationId: execInvocationId,
        parseFn: (bodyMarkdown: string) => {
          let jsonStr = bodyMarkdown;
          const jsonMatch = bodyMarkdown.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            jsonStr = jsonMatch[1];
          }
          const parsed = JSON.parse(jsonStr) as ParsedProviderManagementJSON;
          if (typeof parsed.replyMarkdown !== "string") {
            throw new Error("Missing or invalid 'replyMarkdown'");
          }
          return parsed;
        },
        buildRetryPrompt: (error: Error) => {
          return `Your response could not be parsed as valid JSON. Please return STRICT JSON with \`replyMarkdown\` and \`action\` fields.\nError: ${error.message}`;
        },
      });

      const parsed = response.parsed;

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

      const envelopeJson = await this.deps.managementToolHandler.handleManageSprintOs(parsed.action);
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
      this.deps.executionRepository.updateExecutionInvocation(execInvocationId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      throw err;
    }
  }
}
