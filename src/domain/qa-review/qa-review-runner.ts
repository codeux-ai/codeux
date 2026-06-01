import type { StructuredAgentRequestService } from "../../services/structured-agent-request-service.js";
import type { NormalizedQaReviewResult, QaReviewError } from "./qa-review-types.js";
import { parseQaError } from "./qa-review-types.js";
import type { QaReviewRunRecord } from "../../repositories/qa-review-repository.js";
import type { ProviderId } from "../../contracts/app-types.js";

// Outcome types
export type QaReviewRunnerOutcome =
  | { status: "success"; review: NormalizedQaReviewResult }
  | { status: "error"; error: QaReviewError };

export interface QaReviewRunnerDependencies {
  structuredAgentRequestService: StructuredAgentRequestService;
}

export interface QaReviewRunnerArgs {
  projectId: string;
  sprintId: string | null;
  taskId?: string;
  sprintRunId?: string;
  taskRunId?: string;
  provider: ProviderId;
  model: string;
  apiKey: string;
  qwenAuthMode?: string;
  qwenRegion?: "china" | "international";
  qwenBaseUrl?: string;
  qwenEnvKey?: string;
  qwenModelId?: string;
  qwenProtocol?: string;
  qwenAdditionalModelProviders?: import("../../contracts/app-types.js").QwenModelProviderSettings[];
  openCodeAuthMode?: string;
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
  providerMountAuth?: boolean;
  providerAuthPath?: string;
  customBaseUrl?: string;
  customModel?: string;
  providerPrompt: string;
  repoPath: string | null;
  cwd?: string | null;
  workspaceSessionId?: string;
  settings: Record<string, unknown>;
  agentInstructions: string;
  onActivity?: () => void;
  runRecord: QaReviewRunRecord;
  parseFn: (text: string) => NormalizedQaReviewResult;
}

export class QaReviewRunner {
  constructor(private readonly deps: QaReviewRunnerDependencies) {}

  async runQaReview(args: QaReviewRunnerArgs): Promise<QaReviewRunnerOutcome> {
    try {
      const result = await this.deps.structuredAgentRequestService.executeRequest<NormalizedQaReviewResult>({
        projectId: args.projectId,
        sprintId: args.sprintId,
        taskId: args.taskId,
        sprintRunId: args.sprintRunId,
        taskRunId: args.taskRunId,
        purpose: "qa_review",
        type: "qa_review",
        provider: args.provider,
        model: args.model,
        apiKey: args.apiKey,
        qwenAuthMode: args.qwenAuthMode as any,
        qwenRegion: args.qwenRegion,
        qwenBaseUrl: args.qwenBaseUrl,
        qwenEnvKey: args.qwenEnvKey,
        qwenModelId: args.qwenModelId,
        qwenProtocol: args.qwenProtocol as any,
        qwenAdditionalModelProviders: args.qwenAdditionalModelProviders,
        openCodeAuthMode: args.openCodeAuthMode as any,
        openCodeProviderId: args.openCodeProviderId,
        openCodeModelId: args.openCodeModelId,
        openCodeBaseUrl: args.openCodeBaseUrl,
        openCodeEnvKey: args.openCodeEnvKey,
        openCodePackage: args.openCodePackage,
        providerMountAuth: args.providerMountAuth as any,
        providerAuthPath: args.providerAuthPath,
        customBaseUrl: args.customBaseUrl,
        customModel: args.customModel,
        providerPrompt: args.providerPrompt,
        repoPath: args.repoPath ?? "",
        cwd: args.cwd ?? undefined,
        workspaceSessionId: args.workspaceSessionId,
        settings: args.settings as any,
        parseFn: args.parseFn,
        buildRetryPrompt: (error) => [
          "Your previous response failed validation with this error:",
          error.message,
          "",
          "Please provide a valid JSON object matching the requested schema exactly.",
        ].join("\n"),
        providerLabel: "QA",
        sessionIdPrefix: "qa-review",
        systemRoutingMessage: args.agentInstructions.trim(),
        onActivity: args.onActivity,
        maxRetries: (args.settings as any)?.cliWorkflow?.maxParsingRetries as number | undefined,
      });

      return { status: "success", review: result.parsed };
    } catch (error) {
      return {
        status: "error",
        error: parseQaError(error),
      };
    }
  }
}
