import { randomUUID } from "crypto";
import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";
import type { MemoryService } from "./memory-service.js";
import type { CliWorkflowSettings, DashboardSettings, DesignGuidanceSettings, ProviderId, QwenModelProviderSettings, Subtask } from "../contracts/app-types.js";
import type {
  TaskExecutorType,
  TaskPriority,
  ImprovePromptInput,
  PlanSprintOptions,
  PlanningOverrides,
} from "../contracts/project-management-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { ExecutionControlService } from "./execution-control-service.js";
import type { Logger } from "../shared/logging/logger.js";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS } from "./cli-workflow-utils.js";
import { buildReadFileRetryPrompt, isReadFileNotFoundToolError } from "./cli-workflow-text-utils.js";
import { ProviderRunner, type IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";
import { WorkspaceManager, type SnapshotCheckout } from "../infrastructure/providers/cli/workspace-manager.js";
import {
  buildInvocationGitPolicy,
  buildInvocationSnapshotCheckout,
  InvocationWorkspacePreparer,
} from "../infrastructure/providers/cli/invocation-workspace-preparer.js";
import { resolveAgentMemoryInstructions } from "./agent-memory-instructions.js";
import { resolveProviderForInvocation } from "./provider-routing.js";
import { parsePlannedSprintReply, PlanningParseError } from "./planning-json-extractor.js";
import { extractJsonFromText } from "../domain/llm/json-extraction.js";
import type { PlannedSprintPayload, PlannedTaskDraft } from "../contracts/project-management-types.js";
import { persistPlannedTasks } from "./planning-task-persistence.js";
import { buildPlanningExecutionPlanMessage } from "./planning-execution-plan-message.js";
import { ProviderExecutionService, resolveEffectiveModel } from "./provider-execution-service.js";
import { StructuredAgentRequestService, type StructuredAgentRequestResult } from "./structured-agent-request-service.js";
import { ProviderInvocationCancelledError, StructuredProviderResponseService } from "./structured-provider-response-service.js";
import { waitUntil } from "../shared/polling/wait-until.js";
import { LEARNINGS_FILENAME } from "../contracts/memory-types.js";
import * as PlanningPromptBuilder from "./planning-prompt-builder.js";
import { buildRelevantMemoryInjectionContext } from "./memory-injection-context.js";
import { getDesignGuidanceCatalog } from "../domain/settings/design-guidance-catalog.js";
import { resolveEffectiveDashboardSettings } from "./settings-resolution-service.js";

interface PlanningAgentServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  connectionChatRepository: ConnectionChatRepository;
  executionRepository?: ExecutionRepository;
  settingsRepository: SettingsRepository;
  agentPresetSyncService: AgentPresetSyncService;
  executionControlService: ExecutionControlService;
  memoryService?: MemoryService;
  providerRunner?: IProviderRunner;
  logger?: Logger;
  providerExecutionService?: ProviderExecutionService;
  structuredAgentRequestService?: StructuredAgentRequestService;
}

interface ImprovePromptResult {
  goal: string;
  invocationId: string;
  agentId: string;
  workerConnectionId: null;
}

export interface PlanSprintResult {
  ok: true;
  invocationId: string;
  agentId: string;
  createdTaskIds: string[];
  started: boolean;
}

interface PlanSprintPreconditions {
  project: NonNullable<ReturnType<ProjectManagementRepository["getProject"]>>;
  sprint: NonNullable<ReturnType<ProjectManagementRepository["getSprint"]>>;
}

interface PlanningResultContext {
  provider: Exclude<ProviderId, "jules">;
  sessionId: string;
  workflowSettings: CliWorkflowSettings;
  providerSettings: {
    model: string;
    apiKey: string;
    thinkingMode?: unknown;
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
    customBaseUrl?: string;
    customModel?: string;
  };
  memoryCaptureWorkspacePath: string;
  cleanupWorkspace?: () => Promise<void>;
}

export type PlanningInvocationRestartMode = "retry_full_prompt" | "continue_session";

function isExecutionInvocationActiveForFinalize(
  executionRepository: PlanningAgentServiceDeps["executionRepository"],
  invocationId: string | undefined,
): boolean {
  if (!invocationId) {
    return false;
  }
  if (typeof executionRepository?.getExecutionInvocation !== "function") {
    return true;
  }
  const current = executionRepository?.getExecutionInvocation(invocationId);
  return current?.status !== "cancelled";
}

function finalizePlanningInvocationError(
  executionRepository: PlanningAgentServiceDeps["executionRepository"],
  invocationId: string | undefined,
  error: unknown,
): void {
  if (!invocationId || !isExecutionInvocationActiveForFinalize(executionRepository, invocationId)) {
    return;
  }
  executionRepository?.updateExecutionInvocation(invocationId, {
    status: error instanceof ProviderInvocationCancelledError ? "cancelled" : "failed",
    errorMessage: error instanceof Error ? error.message : String(error),
    finishedAt: new Date().toISOString(),
  });
}

interface PlanningContinuationContext {
  promptOverride?: string;
  provider: Exclude<ProviderId, "jules">;
  continueSessionId: string;
  logicalSessionId: string;
  openCodeBaselineRawUsageJson?: Record<string, unknown> | null;
  requireExistingSession?: boolean;
}

interface PersistedPlanSprintRequest {
  kind: "plan_sprint";
  autoStart: boolean;
  replan: boolean;
  sprintRunId?: string;
  planningAgentPresetId?: string;
  quicksprintTemplateId?: string;
  overrides?: PlanningOverrides;
}

export class PlanningAgentService {
  private readonly providerRunner: IProviderRunner;
  private readonly providerExecutionService: ProviderExecutionService;
  private readonly structuredAgentRequestService: StructuredAgentRequestService;
  private readonly workspaceManager = new WorkspaceManager();
  private readonly invocationWorkspacePreparer = new InvocationWorkspacePreparer(this.workspaceManager);

  constructor(private readonly deps: PlanningAgentServiceDeps) {
    this.providerRunner = deps.providerRunner || new ProviderRunner(new DockerRunner());
    this.providerExecutionService = deps.providerExecutionService || new ProviderExecutionService({
      executionRepository: deps.executionRepository,
      providerRunner: this.providerRunner,
      logger: deps.logger,
      getDashboardSettings: ({ projectId, sprintId }) => (
        projectId
          ? resolveEffectiveDashboardSettings(deps.settingsRepository, projectId, sprintId).settings
          : deps.settingsRepository.getDefaultDashboardSettings()
      ),
    });

    if (deps.structuredAgentRequestService) {
      this.structuredAgentRequestService = deps.structuredAgentRequestService;
    } else {
      const structuredProviderResponseService = new StructuredProviderResponseService({
        providerExecutionService: this.providerExecutionService,
        executionRepository: deps.executionRepository,
        logger: deps.logger,
      });
      this.structuredAgentRequestService = new StructuredAgentRequestService({
        executionRepository: deps.executionRepository,
        structuredProviderResponseService,
        logger: deps.logger,
      });
    }
  }

  async improveSprintPrompt(projectId: string, input: ImprovePromptInput, signal?: AbortSignal): Promise<ImprovePromptResult> {
    const project = this.requireProject(projectId);
    const runtime = this.resolvePlanningRuntime(projectId, input.overrides);
    const planningAgentPresetId = input.overrides?.planningAgentPresetId
      || input.planningAgentPresetId
      || runtime.settings.agents?.routing?.planning?.agentPresetId
      || undefined;
    const planningAgent = await this.deps.agentPresetSyncService.resolveTargetedPlanningAgent(
      projectId,
      planningAgentPresetId,
    );
    const invocation = this.deps.executionRepository?.createExecutionInvocation({
      projectId,
      skipValidation: true,
      sprintId: null,
      type: "planning",
      status: "running",
      provider: runtime.settings.workers.virtualWorkerProvider,
      systemPrompt: null,
      agentPresetId: planningAgent.id,
    });

    const memoryContext = await this.buildMemoryContext(projectId, null, planningAgent.id, input.goal);
    const learningsInstruction = (runtime.settings.memory?.enabled && runtime.settings.memory?.autoCaptureSprint)
      ? resolveAgentMemoryInstructions(planningAgent, runtime.settings.memory?.workerLearningsInstruction)
      : undefined;

    const prompt = PlanningPromptBuilder.buildImprovePrompt({
      projectName: project.name,
      planningAgent,
      sprintName: input.name,
      goal: input.goal,
      designGuidance: this.resolveEffectiveDesignGuidance(runtime.settings.designGuidance, input.overrides),
      memoryContext,
      learningsInstruction,
    });

    const isMemoryCaptureEnabled = !!learningsInstruction;

    if (invocation) {
      this.deps.executionRepository?.appendExecutionInvocationMessage(invocation.id, {
        role: "user",
        contentMarkdown: prompt,
      });
    }

    signal?.throwIfAborted();
    let payload: { goal?: string };
    let cleanupWorkspace: (() => Promise<void>) | undefined;
    try {
      const virtualResult = await this.runVirtualPlanningRequest({
        projectId,
        sprintId: null,
        invocationId: invocation?.id,
        repoPath: project.baseDir,
        settings: runtime.settings,
        rawPrompt: prompt,
        overrides: input.overrides,
        fallbackBranch: runtime.settings.git.defaultBranch || project.defaultBranch,
        signal,
        parseFn: (bodyMarkdown) => this.parseJsonReply<{ goal?: string }>(bodyMarkdown),
        buildRetryPrompt: (lastError) => [
          "Your previous output could not be parsed as valid JSON.",
          `Parse error: ${lastError.message}`,
          "",
          "Please output ONLY valid JSON.",
          "- Output raw JSON only — no markdown fences, no commentary, no prose before or after."
        ].join("\n"),
      });
      payload = virtualResult.parsed;
      cleanupWorkspace = virtualResult.cleanupWorkspace;

      if (invocation && isExecutionInvocationActiveForFinalize(this.deps.executionRepository, invocation.id)) {
        this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
      }

      if (isMemoryCaptureEnabled) {
        await this.captureMemoriesFromWorkspace(
          projectId,
          undefined,
          planningAgent.id,
          virtualResult.memoryCaptureWorkspacePath,
          invocation?.id || ""
        );
      }
    } catch (error) {
//

      finalizePlanningInvocationError(this.deps.executionRepository, invocation?.id, error);
      throw error;
    }

    const goal = String(payload.goal || "").trim();
    if (!goal) {
      throw new Error("Planning agent reply did not include an improved sprint prompt.");
    }
    await cleanupWorkspace?.().catch(() => undefined);

    this.captureDecisionMemory(projectId, null, planningAgent.id,
      `Sprint goal refined: "${input.goal.trim().slice(0, 100)}" → "${goal.slice(0, 100)}"`,
      0.7,
    );

    return {
      goal,
      invocationId: invocation?.id || "",
      agentId: planningAgent.id,
      workerConnectionId: null,
    };
  }

  async restartInvocation(invocationId: string, mode: PlanningInvocationRestartMode = "retry_full_prompt", signal?: AbortSignal): Promise<PlanSprintResult> {
    const invocation = this.deps.executionRepository?.getExecutionInvocation(invocationId);
    if (!invocation) {
      throw new Error(`Execution invocation not found: ${invocationId}`);
    }
    if (invocation.status !== "failed" && invocation.status !== "cancelled") {
      throw new Error("Only failed or cancelled planning invocations can be restarted.");
    }
    if (invocation.type !== "planning") {
      throw new Error(`Invocation type "${invocation.type}" does not support manual restart yet.`);
    }
    if (!invocation.sprintId) {
      throw new Error("Failed planning invocation is not linked to a sprint.");
    }
    const providerUsage = invocation.providerInvocationId
      ? this.deps.executionRepository?.getProviderInvocationUsage(invocation.providerInvocationId)
      : null;
    if (!providerUsage) {
      throw new Error("Failed planning invocation is not linked to provider session metadata.");
    }
    const continueSessionId = providerUsage.nativeSessionId || (providerUsage.provider === "claude-code" ? null : providerUsage.sessionId);
    if (!continueSessionId) {
      throw new Error("Failed planning invocation does not have a resumable provider session id.");
    }

    this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
      preservedAt: invocation.preservedAt || new Date().toISOString(),
    });

    const continuationProvider = this.requirePlanningContinuationProvider(providerUsage.provider);
    return await this.runPlanSprint(invocation.projectId, invocation.sprintId, {
      autoStart: false,
      replan: true,
      planningAgentPresetId: invocation.agentPresetId || undefined,
      overrides: {
        virtualProvider: continuationProvider,
        ...(providerUsage.model || invocation.model
          ? { virtualModel: providerUsage.model || invocation.model || undefined }
          : {}),
      },
    }, signal, {
      provider: continuationProvider,
      continueSessionId,
      logicalSessionId: providerUsage.sessionId,
      openCodeBaselineRawUsageJson: providerUsage.provider === "opencode" ? providerUsage.rawUsageJson : null,
      promptOverride: mode === "continue_session" ? "continue_session" : undefined,
      requireExistingSession: true,
    });
  }

  /**
   * Reissues a sprint-planning request interrupted by a runtime restart. When
   * provider session metadata survived, the new invocation continues that
   * native conversation with the complete original planning instructions. A
   * request interrupted before provider linkage can be reissued from durable
   * input because no provider conversation existed yet.
   */
  async recoverInterruptedInvocation(
    invocationId: string,
    mode: PlanningInvocationRestartMode = "continue_session",
  ): Promise<PlanSprintResult> {
    const invocation = this.deps.executionRepository?.getExecutionInvocation(invocationId);
    if (!invocation) {
      throw new Error(`Execution invocation not found: ${invocationId}`);
    }
    if (invocation.status !== "failed" && invocation.status !== "cancelled") {
      throw new Error("Only failed or cancelled planning invocations can be recovered.");
    }
    if (invocation.type !== "planning" || !invocation.sprintId) {
      throw new Error("Only sprint-linked planning invocations support automatic restart recovery.");
    }

    const options = this.readPersistedPlanSprintRequest(invocation.id, invocation.projectId, invocation.sprintId);
    const providerUsage = invocation.providerInvocationId
      ? this.deps.executionRepository?.getProviderInvocationUsage(invocation.providerInvocationId)
      : null;
    const continueSessionId = providerUsage
      ? providerUsage.nativeSessionId || (providerUsage.provider === "claude-code" ? null : providerUsage.sessionId)
      : null;
    if (mode === "continue_session" && providerUsage && !continueSessionId) {
      throw new Error(
        `Interrupted ${providerUsage.provider} planning invocation does not have a resumable provider session id. Refusing to start a fresh session.`,
      );
    }
    const continuationProvider = providerUsage
      ? this.requirePlanningContinuationProvider(providerUsage.provider)
      : null;
    const continuation: PlanningContinuationContext | undefined = mode === "continue_session" && providerUsage && continueSessionId && continuationProvider
      ? {
          provider: continuationProvider,
          continueSessionId,
          logicalSessionId: providerUsage.sessionId,
          openCodeBaselineRawUsageJson: providerUsage.provider === "opencode" ? providerUsage.rawUsageJson : null,
          promptOverride: "continue_session",
          requireExistingSession: true,
        }
      : undefined;
    const recoveredAt = new Date().toISOString();
    this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
      preservedAt: invocation.preservedAt || recoveredAt,
    });
    this.deps.executionRepository?.appendExecutionInvocationMessage(invocation.id, {
      role: "system",
      contentMarkdown: continuation
        ? "Runtime restart interrupted this planning request. Code UX is continuing it in the preserved provider session."
        : "Runtime restart interrupted this planning request before a resumable provider session was persisted. Code UX is reissuing the complete request.",
      metadata: {
        recovery: "startup_planning_request_resumed",
        continuationMode: continuation ? "continue_session" : "retry_full_prompt",
      },
      createdAt: recoveredAt,
    });

    const recoveredOptions: PlanSprintOptions = continuation
      ? {
          ...options,
          planningAgentPresetId: options.planningAgentPresetId || invocation.agentPresetId || undefined,
          overrides: {
            ...options.overrides,
            virtualProvider: continuation.provider,
            ...(providerUsage?.model || invocation.model
              ? { virtualModel: providerUsage?.model || invocation.model || undefined }
              : {}),
          },
        }
      : options;

    return await this.runPlanSprint(
      invocation.projectId,
      invocation.sprintId,
      recoveredOptions,
      undefined,
      continuation,
    );
  }

  async planSprint(projectId: string, sprintId: string, options: PlanSprintOptions, signal?: AbortSignal): Promise<PlanSprintResult> {
    return await this.runPlanSprint(projectId, sprintId, options, signal);
  }

  startPlanSprint(projectId: string, sprintId: string, options: PlanSprintOptions): Promise<PlanSprintResult> {
    const preconditions = this.validatePlanSprintPreconditions(projectId, sprintId, options);
    return this.runPlanSprint(projectId, sprintId, options, undefined, undefined, preconditions);
  }

  private async runPlanSprint(
    projectId: string,
    sprintId: string,
    options: PlanSprintOptions,
    signal?: AbortSignal,
    continuation?: PlanningContinuationContext,
    preconditions?: PlanSprintPreconditions,
  ): Promise<PlanSprintResult> {
    const { project, sprint } = preconditions
      ?? this.validatePlanSprintPreconditions(projectId, sprintId, options);
    const runtime = this.resolvePlanningRuntime(projectId, options.overrides);
    const planningAgentPresetId = options.overrides?.planningAgentPresetId
      || options.planningAgentPresetId
      || runtime.settings.agents?.routing?.planning?.agentPresetId
      || undefined;
    const planningAgent = await this.deps.agentPresetSyncService.resolveTargetedPlanningAgent(
      projectId,
      planningAgentPresetId,
    );
    const invocation = this.deps.executionRepository?.createExecutionInvocation({
      projectId,
      skipValidation: true,
      sprintId,
      type: "planning",
      status: "running",
      provider: runtime.settings.workers.virtualWorkerProvider,
      systemPrompt: null,
      agentPresetId: planningAgent.id,
    });

    signal?.throwIfAborted();
    const memoryContext = await this.buildMemoryContext(projectId, sprintId, planningAgent.id, sprint.goal);
    const learningsInstruction = (runtime.settings.memory?.enabled && runtime.settings.memory?.autoCaptureSprint)
      ? resolveAgentMemoryInstructions(planningAgent, runtime.settings.memory?.workerLearningsInstruction)
      : undefined;
    const codingAgentRoster = await this.resolveCodingAgentRoster(projectId, runtime.settings, options.overrides);
    const allowedAgentPresetIds = codingAgentRoster.map((agent) => agent.id);
    const manualCodingAgent = await this.resolveManualCodingAgent(projectId, runtime.settings, options.overrides);

    const fullPlanningPrompt = PlanningPromptBuilder.buildPlanPrompt({
      projectName: project.name,
      planningAgent,
      codingAgentRoster,
      sprintNumber: sprint.number,
      sprintName: sprint.name,
      canSetSprintTitle: sprint.isGeneratedName,
      goal: sprint.goal,
      designGuidance: this.resolveEffectiveDesignGuidance(runtime.settings.designGuidance, options.overrides),
      memoryContext,
      learningsInstruction,
    });
    const prompt = continuation?.promptOverride
      ? this.buildPlanningContinuationPrompt(fullPlanningPrompt)
      : fullPlanningPrompt;

    const isMemoryCaptureEnabled = !!learningsInstruction;

    if (invocation) {
      this.deps.executionRepository?.appendExecutionInvocationMessage(invocation.id, {
        role: "user",
        contentMarkdown: prompt,
        metadata: {
          planningRequest: this.buildPersistedPlanSprintRequest(options),
        },
      });
    }

    let payload: PlannedSprintPayload;
    let cleanupWorkspace: (() => Promise<void>) | undefined;
    let planningSelfReflection: StructuredAgentRequestResult<PlannedSprintPayload>["selfReflection"] | undefined;
    try {
      const virtualResult = await this.runVirtualPlanningRequest({
        projectId,
        sprintId,
        invocationId: invocation?.id,
        repoPath: project.baseDir,
        settings: runtime.settings,
        rawPrompt: prompt,
        overrides: options.overrides,
        preferredBranch: sprint.featureBranch || undefined,
        fallbackBranch: runtime.settings.git.defaultBranch || project.defaultBranch,
        continuation,
        signal,
        parseFn: (bodyMarkdown) => parsePlannedSprintReply(bodyMarkdown, { allowedAgentPresetIds }),
        buildRetryPrompt: (lastError) => [
          "Your previous output could not be parsed as valid JSON.",
          `Parse error: ${lastError.message}`,
          "",
          "Please output ONLY the valid JSON sprint definition. Requirements:",
          "- Output raw JSON only — no markdown fences, no commentary, no prose before or after.",
          "- Ensure all string values are properly escaped (especially quotes and newlines inside promptMarkdown).",
          "- Use the exact schema from the original instructions: {\"goal\":\"...\",\"tasks\":[...]}, with optional top-level \"title\" only when allowed by those instructions."
        ].join("\n"),
      });
      payload = virtualResult.parsed;
      cleanupWorkspace = virtualResult.cleanupWorkspace;
      planningSelfReflection = virtualResult.selfReflection;

      if (invocation && isExecutionInvocationActiveForFinalize(this.deps.executionRepository, invocation.id)) {
        this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
      }

      if (isMemoryCaptureEnabled) {
        await this.captureMemoriesFromWorkspace(
          projectId,
          sprintId,
          planningAgent.id,
          virtualResult.memoryCaptureWorkspacePath,
          invocation?.id || ""
        );
      }
    } catch (error) {
      if (error instanceof PlanningParseError && options.sprintRunId) {
        this.deps.executionRepository?.appendSprintRunEvent(
          options.sprintRunId,
          "planning_parse_failure_blocked",
          "system",
          { reason: error.reason, attempts: error.attempts, rawResponse: error.rawContent }
        );
      }

      finalizePlanningInvocationError(this.deps.executionRepository, invocation?.id, error);
      throw error;
    }

    if (options.replan) {
      this.deps.projectManagementRepository.deleteTasksBySprint(sprintId);
    }

    const sprintUpdate: { name?: string; goal?: string } = {};
    const plannedTitle = payload.title?.trim();
    if (plannedTitle && sprint.isGeneratedName) {
      sprintUpdate.name = plannedTitle;
    }
    if (payload.goal && payload.goal.trim() && payload.goal.trim() !== sprint.goal.trim()) {
      sprintUpdate.goal = payload.goal.trim();
    }
    if (Object.keys(sprintUpdate).length > 0) {
      this.deps.projectManagementRepository.updateSprint(sprint.id, sprintUpdate);
    }
    const finalSprintName = sprintUpdate.name || sprint.name;
    const finalSprintGoal = sprintUpdate.goal || sprint.goal;

    const { createdTaskIds } = persistPlannedTasks(
      projectId,
      sprintId,
      payload.tasks,
      this.deps.projectManagementRepository,
      { defaultAgentPresetId: manualCodingAgent?.id || null },
    );

    if (invocation && isExecutionInvocationActiveForFinalize(this.deps.executionRepository, invocation.id)) {
      this.deps.executionRepository?.appendExecutionInvocationMessage(
        invocation.id,
        buildPlanningExecutionPlanMessage({
          invocationId: invocation.id,
          projectId,
          sprintId,
          sprintNumber: sprint.number,
          sprintName: finalSprintName,
          goal: finalSprintGoal,
          tasks: payload.tasks,
          createdTaskIds,
        }),
      );
    }

    const titles: string[] = [];
    for (const t of payload.tasks) {
      titles.push(t.title);
    }
    const taskTitles = titles.join(", ");
    this.captureDecisionMemory(projectId, sprintId, planningAgent.id,
      `Sprint planned with ${payload.tasks.length} tasks: ${taskTitles.slice(0, 200)}. Goal: ${(sprint.goal || "").slice(0, 100)}`,
      0.8,
    );

    const shouldAutoStart = this.shouldAutoStartPlannedSprint(options.autoStart === true, planningSelfReflection);
    if (shouldAutoStart) {
      await this.deps.executionControlService.orchestrateSprint(projectId, sprintId);
    }
    await cleanupWorkspace?.().catch(() => undefined);

    return {
      ok: true,
      invocationId: invocation?.id || "",
      agentId: planningAgent.id,
      createdTaskIds,
      started: shouldAutoStart,
    };
  }

  private shouldAutoStartPlannedSprint(
    requested: boolean,
    selfReflection: StructuredAgentRequestResult<unknown>["selfReflection"] | undefined,
  ): boolean {
    if (!requested) {
      return false;
    }
    if (!selfReflection || !selfReflection.enabled) {
      return true;
    }
    return selfReflection.finalDecision === "passed";
  }

  private buildPlanningContinuationPrompt(fullPlanningPrompt: string): string {
    return [
      "Continue the previous planning attempt in this same provider session.",
      "Use the original planning instructions below as the complete source of truth while continuing this conversation.",
      "",
      "Output the complete valid JSON sprint definition now. Requirements:",
      "- Output raw JSON only — no markdown fences, no commentary, no prose before or after.",
      "- Use the exact schema from the original planning instructions: {\"goal\":\"...\",\"tasks\":[...]}, with optional top-level \"title\" only when allowed by those instructions.",
      "- Include the full final task list, not a partial diff or summary.",
      "",
      "## Original Planning Instructions",
      fullPlanningPrompt,
    ].join("\n");
  }

  private buildPersistedPlanSprintRequest(options: PlanSprintOptions): PersistedPlanSprintRequest {
    return {
      kind: "plan_sprint",
      autoStart: options.autoStart === true,
      replan: options.replan === true,
      ...(options.sprintRunId ? { sprintRunId: options.sprintRunId } : {}),
      ...(options.planningAgentPresetId ? { planningAgentPresetId: options.planningAgentPresetId } : {}),
      ...(options.quicksprintTemplateId ? { quicksprintTemplateId: options.quicksprintTemplateId } : {}),
      ...(options.overrides ? { overrides: options.overrides } : {}),
    };
  }

  private readPersistedPlanSprintRequest(
    invocationId: string,
    projectId: string,
    sprintId: string,
  ): PlanSprintOptions {
    const messages = this.deps.executionRepository?.listExecutionInvocationMessages(invocationId) || [];
    const raw = messages
      .map((message) => message.metadata?.planningRequest)
      .find((value) => value && typeof value === "object") as Record<string, unknown> | undefined;
    const existingTasks = this.deps.projectManagementRepository.listTasks(projectId, sprintId);
    if (!raw || raw.kind !== "plan_sprint") {
      return {
        autoStart: false,
        replan: existingTasks.length > 0,
      };
    }
    return {
      autoStart: raw.autoStart === true,
      replan: raw.replan === true || existingTasks.length > 0,
      sprintRunId: typeof raw.sprintRunId === "string" ? raw.sprintRunId : undefined,
      planningAgentPresetId: typeof raw.planningAgentPresetId === "string" ? raw.planningAgentPresetId : undefined,
      quicksprintTemplateId: typeof raw.quicksprintTemplateId === "string" ? raw.quicksprintTemplateId : undefined,
      overrides: raw.overrides && typeof raw.overrides === "object"
        ? raw.overrides as PlanningOverrides
        : undefined,
    };
  }

  private requirePlanningContinuationProvider(provider: string): Exclude<ProviderId, "jules"> {
    switch (provider) {
      case "gemini":
      case "codex":
      case "claude-code":
      case "qwen-code":
      case "opencode":
      case "antigravity":
      case "mockup-cli":
        return provider;
      default:
        throw new Error(`Provider ${provider} does not support provider-native sprint-planning continuation.`);
    }
  }

  private resolvePlanningRuntime(projectId: string, overrides?: PlanningOverrides): {
    mode: "VIRTUAL";
    settings: DashboardSettings;
    connection: null;
  } {
    const settings = this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;

    if (overrides?.virtualProvider) {
      return {
        mode: "VIRTUAL",
        settings: {
          ...settings,
          workers: {
            ...settings.workers,
            executionMode: "VIRTUAL",
            virtualWorkerProvider: overrides.virtualProvider,
          },
        },
        connection: null,
      };
    }

    return {
      mode: "VIRTUAL",
      settings,
      connection: null,
    };
  }

  private resolveEffectiveDesignGuidance(
    persisted: DesignGuidanceSettings,
    overrides?: PlanningOverrides,
  ): DesignGuidanceSettings {
    const selection = overrides?.designGuidance;
    if (!selection) {
      return persisted;
    }
    const catalog = getDesignGuidanceCatalog(persisted);
    const hasTechStack = catalog.techStacks.some((entry) => entry.id === selection.selectedTechStackId);
    const hasStyleguide = catalog.styleguides.some((entry) => entry.id === selection.selectedStyleguideId);
    if (!hasTechStack || !hasStyleguide) {
      throw new Error("Planning design guidance selection is not available in the effective catalog.");
    }
    return {
      ...persisted,
      selectedTechStackId: selection.selectedTechStackId,
      selectedStyleguideId: selection.selectedStyleguideId,
    };
  }

  private getTaskCodingRoutingMode(settings: DashboardSettings, overrides?: PlanningOverrides): "MANUAL" | "ORCHESTRATOR" {
    return overrides?.agentRoutingMode || settings.agents?.routing?.taskCoding?.mode || "MANUAL";
  }

  private async resolveManualCodingAgent(
    projectId: string,
    settings: DashboardSettings,
    overrides?: PlanningOverrides,
  ): Promise<AgentPresetRecord | null> {
    if (this.getTaskCodingRoutingMode(settings, overrides) !== "MANUAL") {
      return null;
    }
    const agentPresetId = overrides?.workerAgentPresetId || settings.agents?.routing?.taskCoding?.agentPresetId || null;
    if (!agentPresetId) {
      return null;
    }
    return await this.deps.agentPresetSyncService.resolveTargetedCodingAgent(projectId, agentPresetId);
  }

  private async resolveCodingAgentRoster(projectId: string, settings: DashboardSettings, overrides?: PlanningOverrides): Promise<AgentPresetRecord[]> {
    const routing = settings.agents?.routing?.taskCoding;
    if (!routing || this.getTaskCodingRoutingMode(settings, overrides) !== "ORCHESTRATOR") {
      return [];
    }

    const selectedIds = new Set(routing.orchestratorAgentPresetIds);
    if (selectedIds.size === 0) {
      return [];
    }

    const presets = await this.deps.agentPresetSyncService.listAgentPresets(projectId);
    return presets.filter((preset) => selectedIds.has(preset.id));
  }

  private async runVirtualPlanningRequest<T>(args: {
    projectId: string;
    sprintId: string | null;
    invocationId?: string;
    repoPath: string;
    settings: DashboardSettings;
    rawPrompt: string;
    overrides?: PlanningOverrides;
    preferredBranch?: string;
    fallbackBranch?: string | null;
    signal?: AbortSignal;
    parseFn: (bodyMarkdown: string) => T;
    buildRetryPrompt: (lastError: Error) => string;
    continuation?: PlanningContinuationContext;
  }): Promise<StructuredAgentRequestResult<T> & PlanningResultContext> {
    const routingTask: Subtask = {
      id: args.sprintId || "planning",
      title: "Planning request",
      prompt: args.rawPrompt,
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };
    const planningAgent = await this.deps.agentPresetSyncService.resolveTargetedPlanningAgent(
      args.projectId,
      args.settings.agents?.routing?.planning?.agentPresetId || undefined,
    ).catch(() => null);
    const route = resolveProviderForInvocation(args.settings, {
      invocation: "planning",
      task: routingTask,
      providerPool: ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"],
      agentProvider: planningAgent
        ? {
          providerConfigId: planningAgent.providerConfigId,
          model: planningAgent.model,
        }
        : null,
    });
    const virtualProviderOverride = args.overrides?.virtualProvider;
    const providerConfigId = virtualProviderOverride
      ? Object.entries(route.providers).find(([candidateConfigId, candidate]) => (
        candidateConfigId === virtualProviderOverride || candidate.provider === virtualProviderOverride
      ))?.[0] || route.providerConfigId
      : route.providerConfigId;
    const baseProviderSettings = route.providers[providerConfigId];
    if (!baseProviderSettings) {
      throw new Error(`Virtual worker provider "${providerConfigId}" is not configured. Check AI Provider settings.`);
    }
    const providerSettings = { ...baseProviderSettings };
    const provider = providerSettings.provider as Exclude<ProviderId, "jules">;

    if (args.continuation && args.continuation.provider !== provider) {
      throw new Error(
        `Planning continuation provider changed from ${args.continuation.provider} to ${provider}. Refusing to start a fresh provider session.`,
      );
    }

    if (args.overrides?.virtualModel) {
      providerSettings.model = args.overrides.virtualModel;
    }

    const effectiveModel = resolveEffectiveModel({
      provider,
      model: providerSettings.model,
      providerMountAuth: providerSettings.mountAuth,
      customModel: providerSettings.customModel,
      qwenAuthMode: providerSettings.qwenAuthMode,
      qwenModelId: providerSettings.qwenModelId,
      openCodeAuthMode: providerSettings.openCodeAuthMode,
      openCodeProviderId: providerSettings.openCodeProviderId,
      openCodeModelId: providerSettings.openCodeModelId,
    });

    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...args.settings.cliWorkflow,
    };
    const providerPrompt = buildProviderPrompt(args.rawPrompt, providerSettings.thinkingMode, provider);
    const systemRoutingMessage = `Planning request routed through virtual ${this.getProviderLabel(provider)} worker (model: ${effectiveModel}).`;

    // Reflect the resolved route on the invocation record *before* the snapshot
    // workspace is provisioned. The invocation was created upstream with the
    // default virtual-worker provider as a placeholder; correcting it here means
    // the dashboard shows the real provider/model immediately instead of lagging
    // behind container startup (which can take tens of seconds) until
    // executeRequest finally runs.
    if (args.invocationId) {
      this.deps.executionRepository?.updateExecutionInvocation(args.invocationId, {
        provider,
        model: effectiveModel,
      });
    }

    let snapshotWorkspace = args.repoPath;
    let cleanupWorkspace: (() => Promise<void>) | undefined;
    if (workflowSettings.executionMode === "DOCKER") {
      const workspaceSessionId = this.buildPlanningWorkspaceSessionId(args.projectId, args.sprintId);
      const snapshotCheckout = await this.resolvePlanningSnapshotCheckout({
        repoPath: args.repoPath,
        settings: args.settings,
        preferredBranch: args.preferredBranch,
        fallbackBranch: args.fallbackBranch,
      });
      const shouldReuseSnapshot = Boolean(args.continuation);
      const gitPolicy = buildInvocationGitPolicy({
        githubMode: args.settings.git.githubMode,
        defaultBranch: args.settings.git.defaultBranch,
        githubToken: args.settings.git.githubToken,
        gitlabToken: args.settings.git.gitlabToken,
      });
      snapshotWorkspace = shouldReuseSnapshot
        ? await this.invocationWorkspacePreparer.createSnapshotWorkspace({
          repoPath: args.repoPath,
          sessionId: workspaceSessionId,
          checkout: snapshotCheckout,
          reuseExisting: true,
          gitPolicy,
        })
        : await this.invocationWorkspacePreparer.createSnapshotWorkspace({
          repoPath: args.repoPath,
          sessionId: workspaceSessionId,
          checkout: snapshotCheckout,
          // Planning only reads the current tree to draft tasks; it never needs the repo's other
          // (often thousands of) accumulated branches, so seed just the checkout branch.
          workspaceOptions: { singleBranch: true },
          gitPolicy,
        });
      cleanupWorkspace = async () => {
        await this.workspaceManager.removeWorktree(args.repoPath, snapshotWorkspace).catch(() => undefined);
      };
    }

    try {
      const result = await this.structuredAgentRequestService.executeRequest<T>({
        projectId: args.projectId,
        sprintId: args.sprintId,
        purpose: "planning",
        type: "planning",
        provider,
        model: effectiveModel,
        thinkingMode: providerSettings.thinkingMode,
        apiKey: providerSettings.apiKey,
        maxConcurrentTasks: providerSettings.maxConcurrentTasks,
        qwenAuthMode: providerSettings.qwenAuthMode,
        qwenRegion: providerSettings.qwenRegion,
        qwenBaseUrl: providerSettings.qwenBaseUrl,
        qwenEnvKey: providerSettings.qwenEnvKey,
        qwenModelId: providerSettings.qwenModelId,
        qwenProtocol: providerSettings.qwenProtocol,
        qwenAdditionalModelProviders: providerSettings.qwenAdditionalModelProviders,
        openCodeAuthMode: providerSettings.openCodeAuthMode,
        openCodeProviderId: providerSettings.openCodeProviderId,
        openCodeModelId: providerSettings.openCodeModelId,
        openCodeBaseUrl: providerSettings.openCodeBaseUrl,
        openCodeEnvKey: providerSettings.openCodeEnvKey,
        openCodePackage: providerSettings.openCodePackage,
        providerMountAuth: providerSettings.mountAuth,
        providerAuthPath: providerSettings.authPath,
        providerConfigMode: providerSettings.providerConfigMode,
        providerConfigPath: providerSettings.providerConfigPath,
        customBaseUrl: providerSettings.customBaseUrl,
        customModel: providerSettings.customModel,
        providerPrompt: args.rawPrompt,
        repoPath: args.repoPath,
        cwd: snapshotWorkspace,
        workspaceSessionId: `${args.projectId}-planning-snapshot`,
        settings: {
          ...args.settings,
          cliWorkflow: workflowSettings,
        },
        parseFn: args.parseFn,
        buildRetryPrompt: args.buildRetryPrompt,
        providerLabel: this.getProviderLabel(provider),
        sessionIdPrefix: "planning",
        logicalSessionId: args.continuation?.logicalSessionId,
        continueSessionId: args.continuation?.continueSessionId,
        allowFreshSessionFallback: args.continuation?.requireExistingSession !== true,
        openCodeBaselineRawUsageJson: args.continuation?.openCodeBaselineRawUsageJson,
        invocationId: args.invocationId,
        systemRoutingMessage,
        agentMcpAccess: planningAgent?.mcpAccess ?? null,
        mcpAgentId: planningAgent?.id ?? null,
        githubToken: args.settings.git.githubToken,
        signal: args.signal,
        onActivity: (description, originator) => {
          this.deps.logger?.debug("Virtual planning worker activity", {
            projectId: args.projectId,
            invocationId: args.invocationId,
            provider,
            originator: originator || "system",
            descriptionChars: description.length,
          });
        },
      });

      return {
        ...result,
        provider,
        sessionId: result.sessionId,
        workflowSettings,
        memoryCaptureWorkspacePath: snapshotWorkspace,
        cleanupWorkspace,
        providerSettings: {
          model: providerSettings.model,
          apiKey: providerSettings.apiKey,
          qwenAuthMode: providerSettings.qwenAuthMode,
          qwenRegion: providerSettings.qwenRegion,
          qwenBaseUrl: providerSettings.qwenBaseUrl,
          qwenEnvKey: providerSettings.qwenEnvKey,
          qwenModelId: providerSettings.qwenModelId,
          qwenProtocol: providerSettings.qwenProtocol,
          qwenAdditionalModelProviders: providerSettings.qwenAdditionalModelProviders,
          openCodeAuthMode: providerSettings.openCodeAuthMode,
          openCodeProviderId: providerSettings.openCodeProviderId,
          openCodeModelId: providerSettings.openCodeModelId,
          openCodeBaseUrl: providerSettings.openCodeBaseUrl,
          openCodeEnvKey: providerSettings.openCodeEnvKey,
          openCodePackage: providerSettings.openCodePackage,
          customBaseUrl: providerSettings.customBaseUrl,
          customModel: providerSettings.customModel,
          thinkingMode: providerSettings.thinkingMode,
        },
      };
    } catch (error) {
      if (args.invocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(args.invocationId, {
          status: "failed",
          finishedAt: new Date().toISOString(),
        });
      }
      await cleanupWorkspace?.().catch(() => undefined);
      throw error;
    }
  }


  private parseJsonReply<T>(bodyMarkdown: string): T {
    const extraction = extractJsonFromText(bodyMarkdown);
    if (extraction.success) {
      return extraction.data as T;
    }

    this.deps.logger?.warn("Failed to parse Planning agent reply", {
      bodyMarkdown,
      error: extraction.error.message,
    });
    throw new Error("Planning agent reply was not valid JSON.");
  }

  private getProviderLabel(provider: ProviderId): string {
    switch (provider) {
      case "gemini":
        return "Gemini";
      case "claude-code":
        return "Claude Code";
      case "qwen-code":
        return "Qwen Code";
      case "opencode":
        return "OpenCode";
      case "codex":
      default:
        return "Codex";
    }
  }

  private buildPlanningWorkspaceSessionId(projectId: string, sprintId: string | null): string {
    return `planning-${projectId}-${sprintId || "project"}`;
  }

  private async resolvePlanningSnapshotCheckout(args: {
    repoPath: string;
    settings: DashboardSettings;
    preferredBranch?: string;
    fallbackBranch?: string | null;
  }): Promise<SnapshotCheckout | undefined> {
    if (args.settings.git.githubMode !== "REMOTE") {
      return undefined;
    }

    return buildInvocationSnapshotCheckout(buildInvocationGitPolicy({
      githubMode: args.settings.git.githubMode,
      defaultBranch: args.fallbackBranch?.trim() || args.settings.git.defaultBranch,
      githubToken: args.settings.git.githubToken,
      gitlabToken: args.settings.git.gitlabToken,
    }), {
      branch: args.preferredBranch,
    });
  }

  private async buildMemoryContext(projectId: string, sprintId: string | null, agentPresetId: string, query: string): Promise<string | undefined> {
    const memoryService = this.deps.memoryService;
    if (!memoryService) return undefined;

    try {
      return (await buildRelevantMemoryInjectionContext(memoryService, {
        projectId,
        sprintId,
        agentPresetId,
        query,
        tokenBudget: 1_800,
      })).markdown;
    } catch {
      return undefined;
    }
  }

  private async captureMemoriesFromWorkspace(
    projectId: string,
    sprintId: string | undefined,
    agentPresetId: string | null,
    worktreePath: string,
    originId: string,
  ): Promise<number> {
    if (!this.deps.memoryService) {
      return 0;
    }
    if (worktreePath.startsWith("docker-volume://")) {
      const raw = await this.workspaceManager.readWorkspaceFile(worktreePath, LEARNINGS_FILENAME);
      if (!raw) {
        return 0;
      }
      return await this.deps.memoryService.captureMemoriesFromContent(
        projectId,
        sprintId,
        agentPresetId,
        raw,
        originId,
      );
    }
    return await this.deps.memoryService.captureMemoriesFromWorktree(
      projectId,
      sprintId,
      agentPresetId,
      worktreePath,
      originId,
    );
  }

  private captureDecisionMemory(
    projectId: string,
    sprintId: string | null,
    agentPresetId: string,
    content: string,
    strength: number,
  ): void {
    this.deps.memoryService?.createMemory(projectId, {
      scope: "sprint",
      sprintId,
      agentPresetId,
      content,
      category: "decision",
      strength,
      source: {
        type: "auto_capture",
        originType: "planning_agent",
        agent: "planning",
      },
    }).catch((err) => {
      this.deps.logger?.warn("Failed to capture planning decision memory", {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private requireProject(projectId: string): NonNullable<ReturnType<ProjectManagementRepository["getProject"]>> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private validatePlanSprintPreconditions(
    projectId: string,
    sprintId: string,
    options: PlanSprintOptions,
  ): PlanSprintPreconditions {
    const project = this.requireProject(projectId);
    const sprint = this.requireSprint(projectId, sprintId);
    const existingTasks = this.deps.projectManagementRepository.listTasks(projectId, sprintId);
    if (existingTasks.length > 0 && !options.replan) {
      throw new Error(`Sprint ${sprint.name} already has ${existingTasks.length} task(s). Clear or edit them before running Planning agent.`);
    }
    return { project, sprint };
  }

  private requireSprint(
    projectId: string,
    sprintId: string,
  ): NonNullable<ReturnType<ProjectManagementRepository["getSprint"]>> {
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error(`Sprint not found in project: ${sprintId}`);
    }
    return sprint;
  }
}
