import { buildProviderSettingsOverride } from "./provider-settings-override.js";
import {
  buildProviderPrompt,
  DEFAULT_CLI_WORKFLOW_SETTINGS,
  buildWorkerBranchPrefix,
  buildWorkerBranch
} from "./cli-workflow-utils.js";
import { GitStatusQueryClient } from "../infrastructure/git/git-status-query-client.js";
import { findRecoverableWorkerBranch } from "../infrastructure/git/local-merge.js";
import { resolveRepositoryHost, selectHostToken } from "../infrastructure/git/repository-host-resolver.js";
import { parseOpenPrs, parseMergedPrs } from "../infrastructure/git/git-status-mappers.js";
import { extractJsonFromText } from "../domain/llm/json-extraction.js";
import { StructuredAgentRequestService } from "./structured-agent-request-service.js";
import { StructuredProviderResponseService } from "./structured-provider-response-service.js";
import { WorkspaceManager } from "../infrastructure/providers/cli/workspace-manager.js";
import {
  buildInvocationGitPolicy,
  buildInvocationSnapshotCheckout,
  buildProviderInvocationWorkspaceOptions,
  InvocationWorkspacePreparer,
} from "../infrastructure/providers/cli/invocation-workspace-preparer.js";
import { WorkspaceArtifactService } from "../infrastructure/providers/cli/workspace-artifact-service.js";
import { PrService } from "../infrastructure/providers/cli/pr-service.js";
import type { IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { ProviderExecutionService, resolveEffectiveModel } from "./provider-execution-service.js";
import { ProviderConcurrencyService } from "./provider-concurrency-service.js";
import type { DashboardSettings, DashboardSettingsScope, DockerContainer, ProviderId, Subtask } from "../contracts/app-types.js";
import type { ProviderInvocationUsageRecord, TaskRunRecord } from "../contracts/execution-types.js";
import type { ExecutionInvocationRecord } from "../contracts/invocation-types.js";
import type { TaskPriority } from "../contracts/project-management-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { GuardrailService } from "./guardrail-service.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import { QaReviewRepository, type QaReviewRunRecord, type QaReviewTriggerType } from "../repositories/qa-review-repository.js";
import type { TaskService } from "./task-service.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { Logger } from "../shared/logging/logger.js";
import { runCommandStrict } from "./cli-process-runner.js";
import { buildGitHttpAuthEnvForRepoWithFallbacks, type GitHttpAuthOptions } from "./git-http-auth.js";
import { resolveAgentMemoryInstructions } from "./agent-memory-instructions.js";
import { buildRelevantMemoryInjectionContext } from "./memory-injection-context.js";
import { formatTaskPrTitle } from "../domain/git/task-pr-title-template.js";
import { buildTaskPrComposerInput } from "../domain/sprint/composer/task-pr-input-builder.js";
import { composeTaskPrBody } from "../domain/sprint/composer/pr-description-composer.js";
import type { MemoryService } from "./memory-service.js";
import type { SkillService } from "./skill-service.js";
import type { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import { syncRemoteBranchIfAvailable } from "./git-branch-sync-service.js";
import {
  evaluateQaReviewBudget,
  isPendingQaContinuation,
  isRecoveredStaleQaRun,
  QA_INFRA_FAILURE_GRACE,
} from "../domain/qa-review/qa-review-budget.js";
import { isQaReviewCancellationError, parseQaError } from "../domain/qa-review/qa-review-types.js";
import { normalizeQaReviewResult } from "../domain/qa-review/qa-review-result-normalizer.js";
import type { NormalizedQaReviewResult } from "../domain/qa-review/qa-review-types.js";


import { resolveReviewBranch } from "../domain/qa-review/qa-review-branch-resolution.js";
import { determineTaskReviewIntent } from "../domain/qa-review/task-review-outcome.js";
import { resolveRunningQaRunRecoveryDecision } from "../domain/qa-review/qa-review-stale-run.js";
import { clearMergeProjectionForRerun, MERGE_PROJECTION_RESET } from "../domain/sprint/task-reset-state.js";
import { buildQaReviewRequests, resolveTaskTriggerType, type BuiltQaReviewRequest } from "../domain/qa-review/qa-review-request-builder.js";
import { buildSprintQaSnapshot, evaluateSprintQaReviewCycleDecision, shouldRunSprintQaReview } from "../domain/qa-review/sprint-qa-snapshot.js";
import type { SprintRunLifecycleService } from "./sprint-run-lifecycle-service.js";
import type { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import type { ProjectAttentionItemRecord } from "../contracts/project-attention-types.js";
import {
  buildTaskCodingOutcomeInstructions,
  parseTaskExecutionOutcomeFromProviderOutput,
  type TaskExecutionOutcome,
} from "../domain/sprint/task-execution-outcome.js";
import { workerClarificationAgentMcpAccess } from "./agent-mcp-access.js";

type CliQaProvider = Exclude<ProviderId, "jules">;

const SPRINT_RUN_KEEPALIVE_MS = 30_000;
const QA_TASK_LIST_TOKEN_THRESHOLD = 100_000;
const QA_TOKEN_ESTIMATE_CHARACTERS_PER_TOKEN = 4;

interface QaFixContinuationResult {
  applied: boolean;
  mode: "jules" | "cli" | "none";
  noProgress: boolean;
  blocker: string | null;
}

interface CliQaFollowUpResult {
  producedMergeWork: boolean;
  providerOutcome: TaskExecutionOutcome;
}

export interface TaskQaReviewOutcome {
  reviewed: boolean;
  reopenedTask: boolean;
  mergeBlocked: boolean;
  reportText: string;
}

export interface SprintQaReviewOutcome {
  reviewed: boolean;
  blockedCompletion: boolean;
  mergeBlocked: boolean;
  reportText: string;
}

import { type TaskQaMergeGateStatus, computeTaskMergeGateStatus } from "../domain/qa-review/task-merge-gate-status.js";
export type { TaskQaMergeGateStatus };

interface QualityAssuranceServiceDependencies {
  projectManagementRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  guardrailService: GuardrailService;
  sessionTracking: SessionTrackingRepository;
  qaReviewRepository: QaReviewRepository;
  taskService: TaskService;
  agentPresetSyncService: AgentPresetSyncService;
  providerRunner: IProviderRunner;
  providerConcurrencyService: ProviderConcurrencyService;
  getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings;
  getGithubToken: () => string | undefined;
  sendSessionMessage: (sessionId: string, prompt: string) => Promise<unknown>;
  logger?: Logger;
  memoryService?: MemoryService;
  skillService?: SkillService;
  agentPresetRepository?: AgentPresetRepository;
  getMcpConnectionInfo?: () => McpConnectionInfo | null;
  structuredAgentRequestService?: StructuredAgentRequestService;
  dockerService?: Pick<{ listContainers: () => Promise<DockerContainer[]> }, "listContainers">;
  sprintRunLifecycleService?: Pick<SprintRunLifecycleService, "updateRun">;
  projectAttentionService?: Pick<ProjectAttentionService, "listActiveProjectItems" | "openItem">;
}

export class QualityAssuranceService {
  private readonly workspaceManager = new WorkspaceManager();
  private readonly invocationWorkspacePreparer = new InvocationWorkspacePreparer(this.workspaceManager);
  private readonly workspaceArtifactService = new WorkspaceArtifactService(this.workspaceManager);

  private readonly prService = new PrService();

  private readonly providerExecutionService: ProviderExecutionService;
  private readonly structuredAgentRequestService: StructuredAgentRequestService;
  private readonly activeQaContinuationRunIds = new Set<string>();

  constructor(private readonly deps: QualityAssuranceServiceDependencies) {
    this.providerExecutionService = new ProviderExecutionService({
      executionRepository: deps.executionRepository,
      providerRunner: deps.providerRunner,
      providerConcurrencyService: deps.providerConcurrencyService,
      logger: deps.logger,
      sessionTracking: deps.sessionTracking,
      getGithubToken: deps.getGithubToken,
      getMcpConnectionInfo: deps.getMcpConnectionInfo,
      skillService: deps.skillService,
      agentPresetRepository: deps.agentPresetRepository,
      getDashboardSettings: deps.getDashboardSettings,
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

  private async syncRemoteBranchesIfNeeded(
    repoPath: string,
    branch: string | undefined,
    scope: DashboardSettingsScope,
    contextLabel: string,
  ): Promise<void> {
    const settings = this.deps.getDashboardSettings(scope);
    if (settings.git.githubMode !== "REMOTE") {
      return;
    }

    try {
      await syncRemoteBranchIfAvailable(repoPath, branch, {
        githubToken: settings.git.githubToken,
        gitlabToken: settings.git.gitlabToken,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const branchLabel = branch?.trim() || settings.git.defaultBranch || "the requested branch";
      throw new Error(`Failed to refresh origin before ${contextLabel} on ${branchLabel}: ${message}`);
    }
  }

  async reviewCompletedTask(args: {
    projectId: string;
    sprintId: string;
    sprintRunId?: string;
    repoPath: string;
    task: Subtask;
    subtasks: Subtask[];
  }): Promise<TaskQaReviewOutcome> {
    const taskId = args.task.record_id?.trim();
    if (!taskId) {
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }

    const scope = {
      projectId: args.projectId,
      sprintId: args.sprintId,
    };
    const settings = this.deps.getDashboardSettings(scope);
    const qaSettings = settings.agents.qualityAssurance;
    if (!qaSettings.enabled) {
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }

    const existingRuns = this.deps.qaReviewRepository.countTaskRuns(taskId);
    const decisiveRuns = this.deps.qaReviewRepository.countDecisiveTaskRuns(taskId);
    const latestRun = this.deps.qaReviewRepository.getLatestTaskRun(taskId);
    const previousTaskCycleRuns = this.deps.qaReviewRepository.listLatestTaskCycleRuns(taskId);
    const taskRun = this.resolveTaskRunForSubtask(args.task, args.sprintRunId);
    const project = this.deps.projectManagementRepository.getProject(args.projectId);
    const sprint = this.deps.projectManagementRepository.getSprint(args.sprintId);
    if (!project || !sprint) {
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }
    const sprintFeatureBranch = sprint.featureBranch?.trim()
      || `${settings.git.featureBranchPrefix || "feature/"}sprint-${sprint.number ?? 0}`;

    const pendingTaskContinuation = previousTaskCycleRuns.find((run) => this.isPendingTaskQaContinuation(run)) ?? null;
    if (pendingTaskContinuation) {
      return await this.continuePendingTaskQaRun({
        run: pendingTaskContinuation,
        task: args.task,
        taskRun,
        repoPath: args.repoPath,
        featureBranch: sprintFeatureBranch,
        scope,
        decisiveRuns,
        maxTaskReviewRuns: qaSettings.maxTaskReviewRuns,
      });
    }

    const triggerType = resolveTaskTriggerType(args.task, qaSettings);
    const triggerSettings = triggerType === "completed_task_without_pr"
      ? qaSettings.completedTaskWithoutPr
      : qaSettings.taskCompletion;
    const configuredReviewerCount = Math.max(1, triggerSettings.agentPresetIds?.length || 0);
    const latestCycleHasChangesRequest = previousTaskCycleRuns.some((run) => (
      run.status === "completed" && run.outcome === "changes_requested"
    ));
    const latestCycleHasCompletedReviewer = previousTaskCycleRuns.some((run) => run.status === "completed");
    const recoveringPartialReviewerCycle = previousTaskCycleRuns.length > 0
      && !latestCycleHasChangesRequest
      && (
        previousTaskCycleRuns.length < configuredReviewerCount
        || previousTaskCycleRuns.some((run) => run.status === "running" || run.status === "cancelled")
        || (latestCycleHasCompletedReviewer && previousTaskCycleRuns.some((run) => run.status === "failed" || run.status === "errored"))
        || triggerSettings.agentPresetIds?.some((presetId) => (
          !previousTaskCycleRuns.some((run) => run.agentPresetId === presetId)
        ))
      );
    const requestExistingRuns = recoveringPartialReviewerCycle ? Math.max(0, existingRuns - 1) : existingRuns;
    const requestDecisiveRuns = recoveringPartialReviewerCycle
      && previousTaskCycleRuns.some((run) => run.status === "completed")
      ? Math.max(0, decisiveRuns - 1)
      : decisiveRuns;

    const requests = await buildQaReviewRequests({
      task: args.task,
      taskRun,
      project,
      sprint,
      sprintRunId: args.sprintRunId || null,
      settings,
      budgetArgs: {
        existingRuns: requestExistingRuns,
        decisiveRuns: requestDecisiveRuns,
        latestRun,
      },
      resolveAgent: (projectId, agentPresetId) =>
        this.deps.agentPresetSyncService.resolveTargetedQualityAssuranceAgent(projectId, agentPresetId),
    });

    if (requests.length === 0) {
      const budget = evaluateQaReviewBudget({
        existingRuns,
        decisiveRuns,
        maxTaskReviewRuns: qaSettings.maxTaskReviewRuns,
        latestRun,
      });
      if (!budget.allowed) {
        await this.cleanupCliWorkspaceIfNeeded(args.task, args.repoPath, scope);
      }
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }

    const effectiveRequests = recoveringPartialReviewerCycle
      ? requests.filter((request) => {
        return !previousTaskCycleRuns.some((run) => (
          run.agentPresetId === request.agentPresetId && run.status === "completed"
        ));
      })
      : requests;
    if (effectiveRequests.length === 0) {
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }
    const effectiveTriggerType = effectiveRequests[0]!.triggerType;
    const runIndex = recoveringPartialReviewerCycle
      ? previousTaskCycleRuns[0]!.runIndex
      : existingRuns + 1;

    const runs = effectiveRequests.map((request) => {
      // Resume a reviewer only while filling an interrupted partial cycle. Once
      // that cycle produced a decisive verdict, the next cycle must inspect a
      // fresh snapshot of the worker branch. Reusing an older cancelled run here
      // can preserve its pre-follow-up workspace and request the same fix again
      // even though the coding continuation already published it.
      const resumeFromRun = recoveringPartialReviewerCycle
        ? this.findResumableQaReviewerRun(previousTaskCycleRuns, request.agentPresetId)
        : null;
      const run = this.deps.qaReviewRepository.createRun({
        ...request.runPayload,
        runIndex,
        payload: {
          ...(request.runPayload.payload || {}),
          runIndex,
          reviewDispatchStatus: "pending",
        },
      });
      // Signal that the task has entered the QA stage so the live view advances
      // from coding-completed → QA and starts timing the review immediately
      // (the review itself can take minutes). Persisting the QA_PENDING indicator
      // makes the stage tag, boat race and stats reflect QA for the whole review,
      // not just the event-derived stage timeline.
      this.appendTaskEvent(taskRun, "qa_review_started", {
        triggerType: effectiveTriggerType,
        qaReviewRunId: run.id,
        runIndex,
        agentPresetId: request.agentPresetId,
        agentName: request.agentName,
      });
      return { request, run, resumeFromRun };
    });
    this.setTaskQaPending(args.task, true);

    // Resolve which branch QA should check out. In LOCAL git mode the worker
    // branch is the only record of a code-complete task's work, and that metadata
    // is routinely cleared from the task/run during the re-dispatch + settlement
    // cycle. When it is missing we must recover it from local refs before falling
    // back to the (usually empty) feature branch - otherwise the QA snapshot is
    // checked out on the feature branch, every review wrongly reports the work
    // missing, and the QA-gated merge never lands (the LOCAL-mode stuck-sprint bug).
    const resolvedBranchResult = await resolveReviewBranch(
      {
        task: args.task,
        taskRun,
        repoPath: args.repoPath,
        featureBranch: sprintFeatureBranch,
        githubMode: settings.git.githubMode,
      },
      {
        findRecoverableWorkerBranch,
        logger: this.deps.logger,
      }
    );
    const reviewBranch = resolvedBranchResult.reviewBranch;

    if (resolvedBranchResult.recoveredWorkerBranch) {
      args.task.worker_branch = resolvedBranchResult.recoveredWorkerBranch;
      if (taskRun && !taskRun.workerBranch) {
        taskRun.workerBranch = resolvedBranchResult.recoveredWorkerBranch;
        try {
          this.deps.executionRepository.updateTaskRun(taskRun.id, { workerBranch: resolvedBranchResult.recoveredWorkerBranch });
        } catch (err) {
          this.deps.logger?.warn?.(`Failed to backfill recovered worker branch on task run: ${err}`);
        }
      }
    }

    const reviewResults: Array<{
      request: BuiltQaReviewRequest;
      run: QaReviewRunRecord;
      intentOutcome: ReturnType<typeof determineTaskReviewIntent>;
      resolvedReview?: NormalizedQaReviewResult;
      caughtError?: unknown;
    }> = [];

    for (const { request, run, resumeFromRun } of runs) {
      let resolvedReview: NormalizedQaReviewResult | undefined;
      let caughtError: unknown;

      try {
        this.deps.qaReviewRepository.updateRun(run.id, {
          payload: {
            ...this.getLatestQaRunPayload(run),
            reviewDispatchStatus: "running",
          },
        });
        resolvedReview = await this.runReview({
          triggerType: request.triggerType,
          scope,
          projectName: project.name,
          sprintGoal: sprint.goal || "",
          repoPath: args.repoPath,
          agentInstructions: request.agentInstructions,
          subtasks: args.subtasks,
          currentTask: args.task,
          taskRun,
          sprintRunId: args.sprintRunId || null,
          agentPresetId: request.agentPresetId,
          qaRun: run,
          resumeFromRun,
          reviewBranch,
          baseBranch: sprintFeatureBranch,
        });
      } catch (e) {
        caughtError = e;
      }

      const intentOutcome = determineTaskReviewIntent({
        triggerType: request.triggerType,
        review: resolvedReview,
        error: caughtError,
        existingRuns,
        maxTaskReviewRuns: qaSettings.maxTaskReviewRuns,
      });

      if (intentOutcome.intent === "pass") {
        this.deps.qaReviewRepository.updateRun(run.id, {
          status: "completed",
          outcome: "pass",
          summaryMarkdown: intentOutcome.summary,
          payload: {
            ...this.getLatestQaRunPayload(run),
            ...resolvedReview!.raw,
          },
          finishedAt: new Date().toISOString(),
        });
        this.appendTaskEvent(taskRun, "qa_review_passed", {
          triggerType: request.triggerType,
          summary: intentOutcome.summary,
          findings: resolvedReview!.findings,
          qaReviewRunId: run.id,
          agentPresetId: request.agentPresetId,
          agentName: request.agentName,
        });
        reviewResults.push({ request, run, intentOutcome, resolvedReview });
        continue;
      }

      if (intentOutcome.intent === "changes_requested") {
        const qaDecisionFinishedAt = new Date().toISOString();

        this.deps.qaReviewRepository.updateRun(run.id, {
          status: "completed",
          outcome: "changes_requested",
          summaryMarkdown: intentOutcome.summary,
          fixInstructions: intentOutcome.fixInstructions,
          payload: {
            ...this.getLatestQaRunPayload(run),
            ...resolvedReview!.raw,
            continuationKey: `qa-followup:${run.id}`,
            continuationStatus: intentOutcome.fixInstructions ? "pending" : "skipped",
          },
          finishedAt: qaDecisionFinishedAt,
        });
        this.appendTaskEvent(taskRun, "qa_review_changes_requested", {
          triggerType: request.triggerType,
          summary: intentOutcome.summary,
          findings: resolvedReview!.findings,
          fixInstructions: intentOutcome.fixInstructions,
          qaReviewRunId: run.id,
          agentPresetId: request.agentPresetId,
          agentName: request.agentName,
        });
        reviewResults.push({ request, run, intentOutcome, resolvedReview });
        continue;
      }

      // Handle retryable_failure and fatal_failure
      const qaError = intentOutcome.error;
      if (qaError.code === "CANCELLED" || isQaReviewCancellationError(caughtError || qaError)) {
        this.deps.qaReviewRepository.updateRun(run.id, {
          status: "cancelled",
          summaryMarkdown: qaError.message,
          payload: {
            ...this.getLatestQaRunPayload(run),
            error_code: qaError.code,
          },
          finishedAt: new Date().toISOString(),
        });
        this.appendTaskEvent(taskRun, "qa_review_cancelled", {
          triggerType: request.triggerType,
          error: qaError.message,
          error_code: qaError.code,
          qaReviewRunId: run.id,
          agentPresetId: request.agentPresetId,
          agentName: request.agentName,
        });
        this.deps.logger?.info("Task QA review cancelled", {
          projectId: args.projectId,
          sprintId: args.sprintId,
          taskId,
          triggerType: request.triggerType,
          agentPresetId: request.agentPresetId,
          agentName: request.agentName,
          error: qaError.message,
          error_code: qaError.code,
        });
        reviewResults.push({ request, run, intentOutcome, caughtError });
        continue;
      }

      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "failed",
        summaryMarkdown: qaError.message,
        payload: {
          ...this.getLatestQaRunPayload(run),
          error_code: qaError.code,
        },
        finishedAt: new Date().toISOString(),
      });
      this.appendTaskEvent(taskRun, "qa_review_failed", {
        triggerType: request.triggerType,
        error: qaError.message,
        error_code: qaError.code,
        qaReviewRunId: run.id,
        agentPresetId: request.agentPresetId,
        agentName: request.agentName,
      });
      this.deps.logger?.warn("Task QA review failed", {
        projectId: args.projectId,
        sprintId: args.sprintId,
        taskId,
        triggerType: request.triggerType,
        agentPresetId: request.agentPresetId,
        agentName: request.agentName,
        error: qaError.message,
        error_code: qaError.code,
      });
      reviewResults.push({ request, run, intentOutcome, caughtError });
    }

    const changesRequested = reviewResults.find((result) => result.intentOutcome.intent === "changes_requested");
    if (changesRequested && changesRequested.intentOutcome.intent === "changes_requested") {
      const changesIntent = changesRequested.intentOutcome;
      return await this.continuePendingTaskQaRun({
        run: this.deps.qaReviewRepository.getRun(changesRequested.run.id) || changesRequested.run,
        task: args.task,
        taskRun,
        repoPath: args.repoPath,
        featureBranch: sprintFeatureBranch,
        scope,
        decisiveRuns: decisiveRuns + 1,
        maxTaskReviewRuns: qaSettings.maxTaskReviewRuns,
        findings: changesRequested.resolvedReview!.findings,
      });
    }

    const failedReview = reviewResults.find((result) => result.intentOutcome.intent !== "pass");
    if (failedReview) {
      // Drop the QA_PENDING indicator; the merge gate re-derives the blocked
      // state from the failed run on the next cycle.
      this.setTaskQaPending(args.task, false);
      if (failedReview.intentOutcome.intent === "pass" || failedReview.intentOutcome.intent === "changes_requested") {
        return { reviewed: false, reopenedTask: false, mergeBlocked: true, reportText: "" };
      }
      const qaError = failedReview.intentOutcome.error;
      return {
        reviewed: false,
        reopenedTask: false,
        mergeBlocked: failedReview.intentOutcome.intent !== "fatal_failure",
        reportText: qaError.code === "CANCELLED"
          ? ""
          : renderQaReviewFailedReport(args.task.id, failedReview.caughtError || qaError),
      };
    }

    // QA cleared — drop the QA_PENDING indicator so the merge gate can
    // recompute the task's resting stage (CI / automerge / completed).
    this.setTaskQaPending(args.task, false);
    await this.cleanupCliWorkspaceIfNeeded(args.task, args.repoPath, scope);
    const passSummary = reviewResults
      .flatMap((result) => result.intentOutcome.intent === "pass" ? [result.intentOutcome.summary] : [])
      .join("\n\n");
    return {
      reviewed: true,
      reopenedTask: false,
      mergeBlocked: false,
      reportText: renderQaPassReport(args.task.id, passSummary),
    };
  }

  async reconcileRunningTaskQaReviews(args: {
    projectId: string;
    sprintId: string;
    tasks: Subtask[];
  }): Promise<void> {
    const taskIds = args.tasks
      .map((task) => task.record_id?.trim())
      .filter((taskId): taskId is string => Boolean(taskId));
    const snapshots = this.deps.qaReviewRepository.listTaskReviewSnapshots(taskIds);
    const runningRuns = [...snapshots.values()]
      .flatMap((snapshot) => snapshot.latestCycleRuns)
      .filter((run): run is QaReviewRunRecord => Boolean(run && run.status === "running"));

    if (runningRuns.length === 0) {
      return;
    }

    const activeContainerSessionIds = await this.listActiveContainerSessionIds();
    for (const run of runningRuns) {
      this.reconcileRunningQaRun(run, { activeContainerSessionIds });
    }
  }

  async reviewSprintCompletion(args: {
    projectId: string;
    sprintId: string;
    sprintRunId: string;
    repoPath: string;
    subtasks: Subtask[];
  }): Promise<SprintQaReviewOutcome> {
    const scope = {
      projectId: args.projectId,
      sprintId: args.sprintId,
    };
    const settings = this.deps.getDashboardSettings(scope);
    const qaSettings = settings.agents.qualityAssurance;
    if (!qaSettings.enabled || !qaSettings.sprintCompletion.enabled) {
      return { reviewed: false, blockedCompletion: false, mergeBlocked: false, reportText: "" };
    }

    const project = this.deps.projectManagementRepository.getProject(args.projectId);
    const sprint = this.deps.projectManagementRepository.getSprint(args.sprintId);
    if (!project || !sprint) {
      return { reviewed: false, blockedCompletion: false, mergeBlocked: false, reportText: "" };
    }

    const activeHumanHandoff = this.findActiveSprintQaHumanHandoff(args.projectId, args.sprintId);
    if (activeHumanHandoff) {
      return {
        reviewed: false,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: activeHumanHandoff.summaryMarkdown,
      };
    }

    const sprintFeatureBranch = sprint.featureBranch?.trim()
      || `${settings.git.featureBranchPrefix || "feature/"}sprint-${sprint.number ?? 0}`;

    const historicalLatestRuns = this.deps.qaReviewRepository
      .listLatestSprintCycleRuns(args.sprintId)
      .map((run) => this.reconcileRunningQaRun(run))
      .filter((run): run is QaReviewRunRecord => Boolean(run));
    const latestRuns = historicalLatestRuns.filter((run) => run.sprintRunId === args.sprintRunId);
    const latestRun = latestRuns[0] ?? null;
    const maxRuns = qaSettings.maxSprintReviewRuns;
    const pendingSprintContinuation = latestRuns.find((run) => isPendingQaContinuation(run)) ?? null;

    if (pendingSprintContinuation) {
      return await this.continuePendingSprintQaRun({
        run: pendingSprintContinuation,
        repoPath: args.repoPath,
        subtasks: args.subtasks,
        featureBranch: sprintFeatureBranch,
        scope,
        maxRuns,
      });
    }

    const sprintPresetIds = Array.isArray(qaSettings.sprintCompletion.agentPresetIds)
      && qaSettings.sprintCompletion.agentPresetIds.length > 0
      ? qaSettings.sprintCompletion.agentPresetIds
      : [null];
    const latestCycleHasChangesRequest = latestRuns.some((run) => (
      run.status === "completed" && run.outcome === "changes_requested"
    ));
    const latestCycleHasCompletedReviewer = latestRuns.some((run) => run.status === "completed");
    const potentiallyRecoveringPartialReviewerCycle = latestRuns.length > 0
      && !latestCycleHasChangesRequest
      && (
        latestRuns.length < sprintPresetIds.length
        || latestRuns.some((run) => run.status === "running" || run.status === "cancelled")
        || (latestCycleHasCompletedReviewer && latestRuns.some((run) => run.status === "failed" || run.status === "errored"))
        || sprintPresetIds.some((presetId) => presetId !== null && !latestRuns.some((run) => run.agentPresetId === presetId))
      );

    const currentTaskSnapshot = buildSprintQaSnapshot(args.subtasks);
    const latestTaskUpdatedAt = this.getLatestSprintTaskUpdatedAt(args.projectId, args.sprintId);
    const shouldRunReview = shouldRunSprintQaReview({
      latestRun,
      latestTaskUpdatedAtMs: latestTaskUpdatedAt,
      currentSubtasks: args.subtasks,
      currentTaskSnapshot,
      isRecoveredStaleRun: latestRuns.some((run) => isRecoveredStaleQaRun(run)),
    });

    const sprintQaDecision = evaluateSprintQaReviewCycleDecision({
      latestRuns,
      maxSprintReviewRuns: maxRuns,
      shouldRunReview,
    });

    if (!potentiallyRecoveringPartialReviewerCycle && sprintQaDecision.action === "skip_review") {
      return { reviewed: false, blockedCompletion: false, mergeBlocked: false, reportText: "" };
    }

    if (!potentiallyRecoveringPartialReviewerCycle && sprintQaDecision.action === "block_completion") {
      this.openSprintQaHumanHandoffIfTerminal({
        projectId: args.projectId,
        sprintId: args.sprintId,
        sprintRunId: args.sprintRunId,
        latestRuns,
        maxRuns,
      });
      return {
        reviewed: false,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: latestRun ? renderSprintQaPendingReport(latestRun) : "",
      };
    }

    const sprintAgents = await Promise.all(sprintPresetIds.map((configuredAgentPresetId) => (
      this.deps.agentPresetSyncService.resolveTargetedQualityAssuranceAgent(
        args.projectId,
        configuredAgentPresetId,
      )
    )));
    const recoveringPartialReviewerCycle = latestRuns.length > 0
      && !latestCycleHasChangesRequest
      && sprintAgents.some((agent) => {
        const agentRuns = latestRuns.filter((run) => run.agentPresetId === agent.id);
        if (agentRuns.some((run) => run.status === "completed")) {
          return false;
        }
        return agentRuns.length === 0
          || agentRuns.some((run) => run.status === "running" || run.status === "cancelled")
          || (latestCycleHasCompletedReviewer && agentRuns.some((run) => run.status === "failed" || run.status === "errored"));
      });
    if (!recoveringPartialReviewerCycle && sprintQaDecision.action === "skip_review") {
      return { reviewed: false, blockedCompletion: false, mergeBlocked: false, reportText: "" };
    }
    if (!recoveringPartialReviewerCycle && sprintQaDecision.action === "block_completion") {
      this.openSprintQaHumanHandoffIfTerminal({
        projectId: args.projectId,
        sprintId: args.sprintId,
        sprintRunId: args.sprintRunId,
        latestRuns,
        maxRuns,
      });
      return {
        reviewed: false,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: latestRun ? renderSprintQaPendingReport(latestRun) : "",
      };
    }

    const latestHistoricalRunIndex = historicalLatestRuns.reduce((maxRunIndex, run) => {
      return Math.max(maxRunIndex, typeof run.runIndex === "number" ? run.runIndex : 0);
    }, 0);
    const runIndex = recoveringPartialReviewerCycle
      ? latestRuns[0]!.runIndex
      : Math.max(latestRun?.runIndex || 0, latestHistoricalRunIndex) + 1;
    const sprintReviewResults: Array<{
      agentPresetId: string;
      agentName: string;
      run: QaReviewRunRecord;
      review?: NormalizedQaReviewResult;
      error?: unknown;
    }> = recoveringPartialReviewerCycle
      ? latestRuns.flatMap((run) => {
        if (run.status !== "completed" || run.outcome !== "pass") {
          return [];
        }
        return [{
          agentPresetId: run.agentPresetId || "",
          agentName: run.agentName || "QA",
          run,
          review: this.restoreSprintQaReview(run),
        }];
      })
      : [];

    const agentsToRun = recoveringPartialReviewerCycle
      ? sprintAgents.filter((agent) => {
        return !latestRuns.some((run) => run.agentPresetId === agent.id && run.status === "completed");
      })
      : sprintAgents;
    const preparedSprintRuns = agentsToRun.map((agent) => {
      const resumeFromRun = recoveringPartialReviewerCycle
        ? this.findResumableQaReviewerRun(latestRuns, agent.id)
        : null;
      const run = this.deps.qaReviewRepository.createRun({
        projectId: args.projectId,
        sprintId: args.sprintId,
        sprintRunId: args.sprintRunId,
        triggerType: "sprint_completion",
        runIndex,
        agentPresetId: agent.id,
        agentName: agent.name,
        payload: {
          sprintRunId: args.sprintRunId,
          taskSnapshot: currentTaskSnapshot,
          agentPresetId: agent.id,
          agentName: agent.name,
          reviewDispatchStatus: "pending",
        },
      });
      return { agent, run, resumeFromRun };
    });

    for (const { agent, run, resumeFromRun } of preparedSprintRuns) {
      try {
        this.deps.qaReviewRepository.updateRun(run.id, {
          payload: {
            ...this.getLatestQaRunPayload(run),
            reviewDispatchStatus: "running",
          },
        });
        const memoryInstructions = resolveAgentMemoryInstructions(
          agent,
          settings.memory?.workerLearningsInstruction
        );
        const agentInstructions = agent.instructionMarkdown + (memoryInstructions ? `\n\n### Memory Capture Instructions\n${memoryInstructions}` : "");

        const review = await this.runReview({
          triggerType: "sprint_completion",
          scope,
          projectName: project.name,
          sprintGoal: sprint.goal || "",
          repoPath: args.repoPath,
          agentInstructions,
          subtasks: args.subtasks,
          currentTask: null,
          taskRun: null,
          sprintRunId: args.sprintRunId,
          agentPresetId: agent.id,
          qaRun: run,
          resumeFromRun,
          // Sprint QA reviews the integrated base branch (where all task work is
          // merged), falling back to the configured default branch.
          reviewBranch: sprintFeatureBranch,
          baseBranch: settings.git.defaultBranch,
        });

        if (review.verdict === "pass") {
          this.deps.qaReviewRepository.updateRun(run.id, {
            status: "completed",
            outcome: "pass",
            summaryMarkdown: review.summary,
            payload: {
              ...this.getLatestQaRunPayload(run),
              ...review.raw,
              taskSnapshot: currentTaskSnapshot,
            },
            finishedAt: new Date().toISOString(),
          });
          sprintReviewResults.push({ agentPresetId: agent.id, agentName: agent.name, run, review });
          continue;
        }

        this.deps.qaReviewRepository.updateRun(run.id, {
          status: "completed",
          outcome: "changes_requested",
          targetTaskKey: review.targetTaskKey,
          summaryMarkdown: review.summary,
          fixInstructions: review.fixInstructions,
          payload: {
            ...this.getLatestQaRunPayload(run),
            ...review.raw,
            taskSnapshot: currentTaskSnapshot,
          },
          finishedAt: new Date().toISOString(),
        });
        sprintReviewResults.push({ agentPresetId: agent.id, agentName: agent.name, run, review });
      } catch (error) {
        const qaError = parseQaError(error);
        this.deps.qaReviewRepository.updateRun(run.id, {
          status: qaError.code === "CANCELLED" || isQaReviewCancellationError(error) ? "cancelled" : "failed",
          summaryMarkdown: qaError.message,
          payload: {
            ...this.getLatestQaRunPayload(run),
            error_code: qaError.code,
          },
          finishedAt: new Date().toISOString(),
        });
        const logPayload = {
          projectId: args.projectId,
          sprintId: args.sprintId,
          sprintRunId: args.sprintRunId,
          agentPresetId: agent.id,
          agentName: agent.name,
          error: qaError.message,
          error_code: qaError.code,
        };
        if (qaError.code === "CANCELLED" || isQaReviewCancellationError(error)) {
          this.deps.logger?.info("Sprint QA review cancelled", logPayload);
        } else {
          this.deps.logger?.warn("Sprint QA review failed", logPayload);
        }
        sprintReviewResults.push({ agentPresetId: agent.id, agentName: agent.name, run, error });
      }
    }

    const changesRequested = sprintReviewResults.find((result) => result.review?.verdict === "changes_requested");
    if (changesRequested?.review) {
      const review = changesRequested.review;
      const targetTask = review.targetTaskKey
        ? args.subtasks.find((task) => task.id === review.targetTaskKey) ?? null
        : null;
      const targetTaskRun = targetTask ? this.resolveTaskRunForSubtask(targetTask, args.sprintRunId) : null;
      const fixInstructions = review.fixInstructions;
      const canContinueTargetTask = Boolean(targetTask && !this.isMergedSubtask(targetTask));
      // Reserve the final configured review as a verification/handoff cycle.
      // Creating more automatic work at the cap leaves no budget to verify it
      // and previously trapped the sprint in an invisible heartbeat loop.
      const canApplyAutomaticFollowUp = runIndex < maxRuns;
      this.deps.qaReviewRepository.updateRun(changesRequested.run.id, {
        targetTaskKey: targetTask?.id || review.targetTaskKey,
        targetSessionId: targetTask?.session_id || null,
        targetProvider: targetTask?.provider || null,
        payload: {
          ...this.getLatestQaRunPayload(changesRequested.run),
          ...review.raw,
          continuationKey: `sprint-qa-followup:${changesRequested.run.id}`,
          continuationStatus: canApplyAutomaticFollowUp && targetTask && fixInstructions && canContinueTargetTask
            ? "pending"
            : "skipped",
          continuationTaskRunId: targetTaskRun?.id || null,
          continuationSkippedReason: !canApplyAutomaticFollowUp
            ? "sprint_qa_retry_budget_exhausted"
            : targetTask && fixInstructions && !canContinueTargetTask
              ? "target_task_already_merged"
              : undefined,
          automaticFollowUpSuppressedReason: canApplyAutomaticFollowUp
            ? undefined
            : "sprint_qa_retry_budget_exhausted",
          taskSnapshot: currentTaskSnapshot,
        },
        finishedAt: new Date().toISOString(),
      });

      if (canApplyAutomaticFollowUp && targetTask && fixInstructions && canContinueTargetTask) {
        return await this.continuePendingSprintQaRun({
          run: this.deps.qaReviewRepository.getRun(changesRequested.run.id) || changesRequested.run,
          repoPath: args.repoPath,
          subtasks: args.subtasks,
          featureBranch: sprintFeatureBranch,
          scope,
          maxRuns,
          review,
        });
      }

      const createdFollowUpTasks = canApplyAutomaticFollowUp
        ? this.createSprintFollowUpTasks({
          projectId: args.projectId,
          sprintId: args.sprintId,
          targetTask,
          fixInstructions,
          review,
          existingSubtasks: args.subtasks,
          sourceRunId: changesRequested.run.id,
        })
        : [];
      this.deps.qaReviewRepository.updateRun(changesRequested.run.id, {
        payload: {
          ...this.getLatestQaRunPayload(changesRequested.run),
          continued: false,
          continuationMode: "none",
          createdFollowUpTaskKeys: createdFollowUpTasks.map((task) => task.taskKey),
        },
      });

      if (!canApplyAutomaticFollowUp) {
        const terminalLatestRuns = this.deps.qaReviewRepository
          .listLatestSprintCycleRuns(args.sprintId)
          .filter((run) => run.sprintRunId === args.sprintRunId);
        this.openSprintQaHumanHandoffIfTerminal({
          projectId: args.projectId,
          sprintId: args.sprintId,
          sprintRunId: args.sprintRunId,
          latestRuns: terminalLatestRuns,
          maxRuns,
        });
      }

      return {
        reviewed: true,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: renderSprintQaChangesRequestedReport(
          review.summary,
          targetTask?.id || review.targetTaskKey,
          false,
          createdFollowUpTasks.map((task) => task.taskKey),
        ) + (!canApplyAutomaticFollowUp ? renderSprintQaBudgetExhaustedReport(maxRuns) : ""),
      };
    }

    const failedReview = sprintReviewResults.find((result) => result.error);
    if (failedReview) {
      return {
        reviewed: false,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: failedReview.error ? renderSprintQaFailedReport(failedReview.error) : "",
      };
    }

    const passSummary = sprintReviewResults
      .map((result) => result.review?.summary)
      .filter((summary): summary is string => Boolean(summary))
      .join("\n\n");
    return {
      reviewed: true,
      blockedCompletion: false,
      mergeBlocked: false,
      reportText: renderSprintQaPassReport(passSummary),
    };
  }

  private findActiveSprintQaHumanHandoff(
    projectId: string,
    sprintId: string,
  ): ProjectAttentionItemRecord | null {
    const service = this.deps.projectAttentionService;
    if (!service) {
      return null;
    }

    return service.listActiveProjectItems(projectId).find((item) => (
      item.sprintId === sprintId
      && item.taskId === null
      && item.ownerType === "human"
      && item.attentionType === "human_escalation_required"
      && item.payload?.sourceAttentionType === "qa_review"
      && item.payload?.qaScope === "sprint"
    )) ?? null;
  }

  private openSprintQaHumanHandoffIfTerminal(args: {
    projectId: string;
    sprintId: string;
    sprintRunId: string;
    latestRuns: QaReviewRunRecord[];
    maxRuns: number;
  }): void {
    const service = this.deps.projectAttentionService;
    const latestRun = args.latestRuns[0] ?? null;
    if (!service || !latestRun) {
      return;
    }

    const allTerminal = args.latestRuns.every((run) => run.status !== "running");
    const terminalFailure = args.latestRuns.find((run) => (
      run.status === "failed" || run.status === "errored" || run.status === "cancelled"
    )) ?? null;
    const retryBudgetExhausted = latestRun.runIndex >= args.maxRuns;
    if (!allTerminal || !retryBudgetExhausted) {
      return;
    }

    const reason = terminalFailure
      ? "terminal_review_failure"
      : "retry_budget_exhausted";
    const latestReviewDetail = terminalFailure?.summaryMarkdown?.trim()
      || latestRun.summaryMarkdown?.trim()
      || "Sprint QA did not produce a passing verdict.";
    const lastProviderError = terminalFailure ? latestReviewDetail : null;
    const errorCode = terminalFailure?.payload?.error_code;
    const attempts = latestRun.runIndex;

    service.openItem({
      projectId: args.projectId,
      sprintId: args.sprintId,
      // Keep this handoff sprint-scoped rather than run-scoped. A runtime
      // restart may recover or replace the run, but it must not duplicate or
      // bypass the unresolved human gate.
      sprintRunId: null,
      taskId: null,
      attentionType: "human_escalation_required",
      severity: "high",
      ownerType: "human",
      title: "Sprint QA requires human attention",
      summaryMarkdown: [
        "Sprint completion remains blocked because QA could not produce a passing verdict.",
        `Attempts: ${attempts}/${args.maxRuns}.`,
        `Reason: ${reason}.`,
        `${terminalFailure ? "Latest provider error" : "Latest QA result"}: ${latestReviewDetail}`,
        "Resolve this handoff after correcting the provider or reviewing the result to reset sprint QA and allow one fresh review cycle.",
      ].join("\n\n"),
      payload: {
        sourceAttentionType: "qa_review",
        qaScope: "sprint",
        qaReason: reason,
        attempts,
        maxAttempts: args.maxRuns,
        runsUsed: attempts,
        maxRuns: args.maxRuns,
        lastProviderError,
        latestQaSummary: latestRun.summaryMarkdown?.trim() || null,
        lastProviderErrorCode: typeof errorCode === "string" ? errorCode : null,
        latestQaRunId: terminalFailure?.id ?? latestRun.id,
        sprintRunId: args.sprintRunId,
      },
    });
  }

  getTaskMergeGateStatus(args: {
    projectId: string;
    sprintId: string;
    task: Subtask;
  }): TaskQaMergeGateStatus {
    const taskId = args.task.record_id?.trim();

    const scope = { projectId: args.projectId, sprintId: args.sprintId };
    const settings = this.deps.getDashboardSettings(scope);
    const qaSettings = settings.agents.qualityAssurance;
    const triggerType = resolveTaskTriggerType(args.task, qaSettings);

    const isReviewRequired = taskId && qaSettings.enabled && triggerType;

    const latestRun = isReviewRequired
      ? this.reconcileRunningQaRun(this.deps.qaReviewRepository.getLatestTaskRun(taskId))
      : null;
    const runsUsed = isReviewRequired
      ? this.deps.qaReviewRepository.countTaskRuns(taskId)
      : 0;
    const decisiveRuns = isReviewRequired
      ? this.deps.qaReviewRepository.countDecisiveTaskRuns(taskId)
      : 0;

    return computeTaskMergeGateStatus({
      taskId: taskId || null,
      triggerType,
      qaSettings,
      latestRun,
      runsUsed,
      decisiveRuns,
    });
  }

  getTaskMergeGateStatuses(args: {
    projectId: string;
    sprintId: string;
    tasks: Subtask[];
  }): Map<string, TaskQaMergeGateStatus> {
    const settings = this.deps.getDashboardSettings({ projectId: args.projectId, sprintId: args.sprintId });
    const qaSettings = settings.agents.qualityAssurance;
    const taskIds = args.tasks
      .map((task) => task.record_id?.trim())
      .filter((taskId): taskId is string => Boolean(taskId));
    const snapshots = this.deps.qaReviewRepository.listTaskReviewSnapshots(taskIds);
    const statuses = new Map<string, TaskQaMergeGateStatus>();

    for (const task of args.tasks) {
      const taskId = task.record_id?.trim();
      if (!taskId) {
        continue;
      }
      const triggerType = resolveTaskTriggerType(task, qaSettings);
      const isReviewRequired = Boolean(qaSettings.enabled && triggerType);
      const snapshot = snapshots.get(taskId);
      const latestRun = isReviewRequired && snapshot?.latestRun
        ? this.reconcileRunningQaRun(snapshot.latestRun)
        : null;
      statuses.set(taskId, computeTaskMergeGateStatus({
        taskId,
        triggerType,
        qaSettings,
        latestRun,
        runsUsed: isReviewRequired ? snapshot?.runsUsed ?? 0 : 0,
        decisiveRuns: isReviewRequired ? snapshot?.decisiveRuns ?? 0 : 0,
      }));
    }

    return statuses;
  }

  private findResumableQaReviewerRun(
    runs: QaReviewRunRecord[],
    agentPresetId: string | null,
  ): QaReviewRunRecord | null {
    return runs.find((run) => (
      run.agentPresetId === agentPresetId
      && (run.status === "cancelled" || run.status === "failed")
      && typeof run.payload?.reviewLogicalSessionId === "string"
      && run.payload.reviewLogicalSessionId.trim().length > 0
    )) || null;
  }

  private getLatestQaRunPayload(run: QaReviewRunRecord): Record<string, unknown> {
    const repository = this.deps.qaReviewRepository as Partial<QaReviewRepository>;
    const persistedRun = typeof repository.getRun === "function"
      ? repository.getRun(run.id)
      : null;
    return persistedRun?.payload || run.payload || {};
  }

  private async runReview(args: {
    triggerType: QaReviewTriggerType;
    scope: DashboardSettingsScope;
    projectName: string;
    sprintGoal: string;
    repoPath: string;
    agentInstructions: string;
    subtasks: Subtask[];
    currentTask: Subtask | null;
    taskRun: TaskRunRecord | null;
    sprintRunId: string | null;
    agentPresetId: string | null;
    qaRun?: QaReviewRunRecord;
    resumeFromRun?: QaReviewRunRecord | null;
    reviewBranch: string | undefined;
    baseBranch: string;
  }): Promise<NormalizedQaReviewResult> {
    return await this.withSprintRunKeepAlive(args.sprintRunId, args.scope.sprintId, async () => {
      await this.syncRemoteBranchesIfNeeded(
        args.repoPath,
        args.reviewBranch,
        args.scope,
        "running QA review",
      );

      const pseudoTask: Subtask = args.currentTask || {
        id: "SPRINT",
        title: "Sprint completion review",
        prompt: args.sprintGoal,
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
      };
      const settings = this.deps.getDashboardSettings(args.scope);
      const requestedResume = settings.restartInvocationPolicy === "continue" && Boolean(args.resumeFromRun);
      const candidateResumePayload = requestedResume ? args.resumeFromRun?.payload : null;
      const route = this.deps.taskService.resolveInvocationProvider("qa_review", pseudoTask, {
        scope: args.scope,
        cliOnly: true,
      });
      const savedProviderConfigId = typeof candidateResumePayload?.reviewProviderConfigId === "string"
        ? candidateResumePayload.reviewProviderConfigId
        : null;
      const savedProvider = typeof candidateResumePayload?.reviewProvider === "string"
        ? candidateResumePayload.reviewProvider as CliQaProvider
        : null;
      const hasSavedRoute = Boolean(
        requestedResume
        && savedProviderConfigId
        && savedProvider
        && route.providers[savedProviderConfigId],
      );
      const provider = hasSavedRoute ? savedProvider! : route.provider as CliQaProvider;
      const providerConfigId = hasSavedRoute
        ? savedProviderConfigId!
        : route.providerConfigId || route.provider;
      const providerSettings = route.providers[providerConfigId];
      const canResume = requestedResume && hasSavedRoute;
      const resumePayload = canResume ? candidateResumePayload : null;
      const savedModel = typeof resumePayload?.reviewModel === "string" && resumePayload.reviewModel.trim()
        ? resumePayload.reviewModel
        : providerSettings.model;

      const memoryContext = args.agentPresetId
        ? await this.buildMemoryContext(args.scope.projectId!, args.scope.sprintId || null, args.agentPresetId, args.sprintGoal)
        : undefined;
      const prompt = this.buildReviewPrompt({
        ...args,
        memoryContext,
      });
      const providerPrompt = buildProviderPrompt(prompt, providerSettings.thinkingMode, provider);
      const workflowSettings = {
        ...DEFAULT_CLI_WORKFLOW_SETTINGS,
        ...settings.cliWorkflow,
      };
      const gitPolicy = buildInvocationGitPolicy({
        githubMode: settings.git.githubMode,
        defaultBranch: settings.git.defaultBranch,
        githubToken: settings.git.githubToken,
        gitlabToken: settings.git.gitlabToken,
      });
      const savedLogicalSessionId = typeof resumePayload?.reviewLogicalSessionId === "string"
        ? resumePayload.reviewLogicalSessionId.trim()
        : "";
      const logicalSessionId = savedLogicalSessionId
        || `${args.qaRun ? "cli-" : ""}qa-review-${provider}-${args.qaRun?.id || Date.now().toString(36)}`;
      const previousProviderInvocation = canResume
        && typeof this.deps.executionRepository.getLatestProviderInvocationUsageBySession === "function"
        ? this.deps.executionRepository.getLatestProviderInvocationUsageBySession(logicalSessionId, "qa_review")
        : null;
      const savedNativeSessionId = typeof resumePayload?.reviewNativeSessionId === "string"
        ? resumePayload.reviewNativeSessionId.trim()
        : "";
      const continueSessionId = canResume
        ? previousProviderInvocation?.nativeSessionId
          || savedNativeSessionId
          || (provider === "claude-code" || provider === "codex" ? null : logicalSessionId)
        : null;
      const continueSessionWithoutNativeId = canResume
        && provider === "codex"
        && !continueSessionId;
      const openCodeBaselineRawUsageJson = provider === "opencode"
        ? previousProviderInvocation?.rawUsageJson
          || (resumePayload?.reviewOpenCodeBaselineRawUsageJson as Record<string, unknown> | null | undefined)
          || null
        : null;
      const snapshotSessionId = typeof resumePayload?.reviewSnapshotSessionId === "string"
        && resumePayload.reviewSnapshotSessionId.trim()
        ? resumePayload.reviewSnapshotSessionId
        : `${logicalSessionId}-workspace`;
      const workspaceSessionId = typeof resumePayload?.reviewWorkspaceSessionId === "string"
        && resumePayload.reviewWorkspaceSessionId.trim()
        ? resumePayload.reviewWorkspaceSessionId
        : snapshotSessionId;
      const existingReviewInvocationId = typeof args.qaRun?.payload?.reviewExecutionInvocationId === "string"
        ? args.qaRun.payload.reviewExecutionInvocationId
        : null;
      const reviewExecutionInvocationId = existingReviewInvocationId
        || (args.qaRun && typeof this.deps.executionRepository.createExecutionInvocation === "function"
          ? this.deps.executionRepository.createExecutionInvocation({
            projectId: args.scope.projectId!,
            sprintId: args.scope.sprintId || null,
            taskId: args.taskRun?.taskId || null,
            sprintRunId: args.sprintRunId,
            taskRunId: args.taskRun?.id || null,
            type: "qa_review",
            provider,
            model: savedModel,
            startedAt: new Date().toISOString(),
          }).id
          : undefined);
      if (args.qaRun) {
        this.deps.qaReviewRepository.updateRun(args.qaRun.id, {
          payload: {
            ...this.getLatestQaRunPayload(args.qaRun),
            reviewLogicalSessionId: logicalSessionId,
            reviewSnapshotSessionId: snapshotSessionId,
            reviewWorkspaceSessionId: workspaceSessionId,
            reviewProvider: provider,
            reviewProviderConfigId: providerConfigId,
            reviewModel: savedModel,
            reviewExecutionInvocationId,
            reviewContinuationSourceRunId: canResume ? args.resumeFromRun?.id : undefined,
          },
        });
      }
      if (typeof this.deps.sessionTracking.createSession === "function") {
        for (const trackedSessionId of new Set([logicalSessionId, workspaceSessionId])) {
          this.deps.sessionTracking.createSession({
            id: trackedSessionId,
            provider,
            taskId: args.taskRun?.taskId || undefined,
            title: args.currentTask ? `QA review: ${args.currentTask.title}` : "Sprint QA review",
            prompt,
            state: "RUNNING",
            featureBranch: args.baseBranch,
            workerBranch: args.reviewBranch,
            repoPath: args.repoPath,
          });
        }
      }
      let releaseSnapshotHelperReservation: (() => void) | null = null;
      try {
      let snapshotWorkspace = args.repoPath;
      let shouldCleanupSnapshot = false;
      if (workflowSettings.executionMode === "DOCKER") {
        const invocationWorkspace = buildProviderInvocationWorkspaceOptions({
          workflowSettings,
          gitPolicy,
          branch: args.reviewBranch,
          fallbackBranch: args.baseBranch,
          useDefaultBranch: false,
        });
        const plannedSnapshotWorkspace = this.workspaceManager.buildWorktreePath(
          args.repoPath,
          `${snapshotSessionId}-snapshot`,
          "DOCKER",
        );
        releaseSnapshotHelperReservation = this.workspaceManager.reserveWorkspaceHelper(
          plannedSnapshotWorkspace,
        );
        snapshotWorkspace = await this.invocationWorkspacePreparer.createSnapshotWorkspace({
          repoPath: args.repoPath,
          sessionId: snapshotSessionId,
          checkout: invocationWorkspace.snapshotCheckout,
          gitPolicy: invocationWorkspace.gitPolicy,
          reuseExisting: canResume,
        });
        shouldCleanupSnapshot = true;
      } else if (args.reviewBranch) {
        // QA must inspect the requested worker/feature branch in HOST mode too.
        // The visible repository normally remains on the default branch, which
        // otherwise turns every QA check into a false missing-file rejection.
        const savedSnapshotWorkspace = typeof resumePayload?.reviewSnapshotWorkspace === "string"
          ? resumePayload.reviewSnapshotWorkspace
          : "";
        snapshotWorkspace = canResume && savedSnapshotWorkspace
          && await this.workspaceManager.workspaceExists(savedSnapshotWorkspace)
          ? savedSnapshotWorkspace
          : await this.invocationWorkspacePreparer.createHostSnapshotWorkspace({
            repoPath: args.repoPath,
            sessionId: snapshotSessionId,
            checkout: buildInvocationSnapshotCheckout(gitPolicy, {
              branch: args.reviewBranch,
              fallbackBranch: args.baseBranch,
              useDefaultBranch: false,
            }),
            gitPolicy,
          });
        shouldCleanupSnapshot = true;
      }
      if (args.qaRun) {
        this.deps.qaReviewRepository.updateRun(args.qaRun.id, {
          payload: {
            ...this.getLatestQaRunPayload(args.qaRun),
            reviewSnapshotWorkspace: snapshotWorkspace,
          },
        });
      }

      let result;
      try {
        result = await this.structuredAgentRequestService.executeRequest<NormalizedQaReviewResult>({
          projectId: args.scope.projectId!,
          sprintId: args.scope.sprintId,
          taskId: args.taskRun?.taskId,
          sprintRunId: args.sprintRunId,
          taskRunId: args.taskRun?.id,
          purpose: "qa_review",
          type: "qa_review",
          provider,
          ...buildProviderSettingsOverride(savedModel, providerSettings),
          providerPrompt,
          repoPath: args.repoPath,
          cwd: snapshotWorkspace,
          workspaceSessionId,
          settings: {
            ...settings,
            cliWorkflow: workflowSettings,
          },
          parseFn: (text) => normalizeQaReviewResult(text),
          buildRetryPrompt: (error) => [
            "Your previous response failed validation with this error:",
            error.message,
            "",
            "Please provide a valid JSON object matching the requested schema exactly.",
          ].join("\n"),
          providerLabel: "QA",
          sessionIdPrefix: "qa-review",
          logicalSessionId,
          continueSessionId,
          continueSessionWithoutNativeId,
          openCodeBaselineRawUsageJson,
          invocationId: reviewExecutionInvocationId,
          systemRoutingMessage: args.agentInstructions.trim(),
          agentMcpAccess: args.agentPresetId
            ? this.deps.agentPresetRepository?.getAgentPreset(args.agentPresetId)?.mcpAccess ?? null
            : undefined,
          mcpAgentId: args.agentPresetId,
          onActivity: () => {
            this.touchSprintRunHeartbeat(args.sprintRunId, args.scope.sprintId);
          },
        });
        if (args.qaRun) {
          this.deps.qaReviewRepository.updateRun(args.qaRun.id, {
            payload: {
              ...this.getLatestQaRunPayload(args.qaRun),
              reviewNativeSessionId: result.nativeSessionId,
              reviewOpenCodeBaselineRawUsageJson: result.openCodeBaselineRawUsageJson || openCodeBaselineRawUsageJson,
            },
          });
        }
      } finally {
        if (settings.memory?.enabled && settings.memory.autoCaptureSprint && this.deps.memoryService && result) {
          const memoryCaptureWorkspace = shouldCleanupSnapshot ? snapshotWorkspace : args.repoPath;
          if (memoryCaptureWorkspace) {
            await this.deps.memoryService.captureMemoriesFromWorktree(
              args.scope.projectId!,
              args.scope.sprintId || undefined,
              args.agentPresetId || null,
              memoryCaptureWorkspace,
              result.invocationId,
            );
          }
        }
        if (shouldCleanupSnapshot && result) {
          await this.workspaceManager.removeWorktree(args.repoPath, snapshotWorkspace).catch(() => undefined);
        }
        if (result) {
          for (const trackedSessionId of new Set([logicalSessionId, workspaceSessionId])) {
            this.deps.sessionTracking.updateSession?.(trackedSessionId, { state: "COMPLETED" });
          }
        }
      }

      return result.parsed;
      } catch (error) {
        for (const trackedSessionId of new Set([logicalSessionId, workspaceSessionId])) {
          this.deps.sessionTracking.updateSession?.(trackedSessionId, { state: "FAILED" });
        }
        this.failPreDispatchQaExecutionInvocation(reviewExecutionInvocationId, error);
        throw parseQaError(error);
      } finally {
        releaseSnapshotHelperReservation?.();
      }
    });
  }

  private failPreDispatchQaExecutionInvocation(
    invocationId: string | undefined,
    error: unknown,
  ): void {
    if (!invocationId) {
      return;
    }
    const repository = this.deps.executionRepository as Partial<ExecutionRepository>;
    if (
      typeof repository.getExecutionInvocation !== "function"
      || typeof repository.updateExecutionInvocation !== "function"
    ) {
      return;
    }
    const invocation = repository.getExecutionInvocation(invocationId);
    if (
      !invocation
      || (invocation.status !== "running" && invocation.status !== "paused")
      || invocation.providerInvocationId
    ) {
      return;
    }
    repository.updateExecutionInvocation(invocationId, {
      status: isQaReviewCancellationError(error) ? "cancelled" : "failed",
      finishedAt: new Date().toISOString(),
      errorMessage: parseQaError(error).message,
    });
  }

  private reconcileRunningQaRun(
    run: QaReviewRunRecord | null,
    options: { activeContainerSessionIds?: ReadonlySet<string> } = {},
  ): QaReviewRunRecord | null {
    if (!run || run.status !== "running") {
      return run;
    }

    const latestInvocation = this.findLatestQaExecutionInvocation(run);
    const providerInvocation = latestInvocation ? this.resolveProviderInvocationUsage(latestInvocation) : null;
    const recoveryDecision = resolveRunningQaRunRecoveryDecision({
      run,
      latestInvocation,
      providerInvocation,
      activeContainerSessionIds: options.activeContainerSessionIds,
    });
    if (recoveryDecision.action === "keep_running") {
      return run;
    }

    if (latestInvocation && recoveryDecision.shouldCancelExecutionInvocation) {
      this.deps.executionRepository.updateExecutionInvocation(latestInvocation.id, {
        status: "cancelled",
        finishedAt: recoveryDecision.finishedAt,
        errorMessage: null,
      });
      this.deps.executionRepository.appendExecutionInvocationMessage(latestInvocation.id, {
        role: "system",
        contentMarkdown: recoveryDecision.summaryMarkdown,
        metadata: {
          recovery: "qa_runtime_reconcile",
          qaRunId: run.id,
        },
        createdAt: recoveryDecision.finishedAt,
      });

      if (providerInvocation && recoveryDecision.shouldCancelProviderInvocation) {
        this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
          status: "cancelled",
          finishedAt: recoveryDecision.finishedAt,
          durationMs: this.calculateProviderInvocationDurationMs(providerInvocation, recoveryDecision.finishedAt),
        });
      }
    }

    return this.deps.qaReviewRepository.updateRun(run.id, {
      status: "cancelled",
      summaryMarkdown: recoveryDecision.summaryMarkdown,
      payload: {
        ...this.getLatestQaRunPayload(run),
        reviewNativeSessionId: providerInvocation?.nativeSessionId || run.payload?.reviewNativeSessionId,
        reviewOpenCodeBaselineRawUsageJson: providerInvocation?.rawUsageJson
          || run.payload?.reviewOpenCodeBaselineRawUsageJson,
      },
      finishedAt: recoveryDecision.finishedAt,
    });
  }

  private findLatestQaExecutionInvocation(run: QaReviewRunRecord): ExecutionInvocationRecord | null {
    const executionRepository = this.deps.executionRepository as Partial<ExecutionRepository>;
    const correlatedInvocationId = typeof run.payload?.reviewExecutionInvocationId === "string"
      ? run.payload.reviewExecutionInvocationId
      : null;
    if (correlatedInvocationId && typeof executionRepository.getExecutionInvocation === "function") {
      const correlatedInvocation = executionRepository.getExecutionInvocation(correlatedInvocationId);
      if (correlatedInvocation?.type === "qa_review") {
        return correlatedInvocation;
      }
    }
    if (typeof executionRepository.listExecutionInvocations !== "function") {
      return null;
    }

    const invocations = run.taskRunId
      ? executionRepository.listExecutionInvocations({
          projectId: run.projectId,
          taskRunId: run.taskRunId,
          limit: 20,
        })
      : run.sprintRunId
        ? executionRepository.listExecutionInvocations({
            projectId: run.projectId,
            sprintRunId: run.sprintRunId,
            limit: 20,
          })
        : [];

    return invocations.find((invocation) => (
      invocation.type === "qa_review"
      && Date.parse(invocation.startedAt) >= Date.parse(run.startedAt)
    )) || null;
  }

  private resolveProviderInvocationUsage(invocation: ExecutionInvocationRecord): ProviderInvocationUsageRecord | null {
    if (!invocation.providerInvocationId) {
      return null;
    }
    return this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId);
  }

  private async listActiveContainerSessionIds(): Promise<ReadonlySet<string> | undefined> {
    if (!this.deps.dockerService?.listContainers) {
      return undefined;
    }
    const containers = await this.deps.dockerService.listContainers().catch(() => []);
    return new Set(
      containers
        .map((container) => container.labels?.["code-ux.session-id"]?.trim())
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    );
  }

  private calculateProviderInvocationDurationMs(invocation: ProviderInvocationUsageRecord, finishedAt: string): number {
    const startedAtMs = Date.parse(invocation.startedAt);
    const finishedAtMs = Date.parse(finishedAt);
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
      return invocation.durationMs || 0;
    }
    return Math.max(0, finishedAtMs - startedAtMs);
  }

  private async withSprintRunKeepAlive<T>(
    sprintRunId: string | null,
    sprintId: string | null | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    if (!sprintRunId || !sprintId) {
      return await action();
    }

    this.touchSprintRunHeartbeat(sprintRunId, sprintId);
    const timer = setInterval(() => {
      this.touchSprintRunHeartbeat(sprintRunId, sprintId);
    }, SPRINT_RUN_KEEPALIVE_MS);
    timer.unref?.();

    try {
      return await action();
    } finally {
      clearInterval(timer);
      this.touchSprintRunHeartbeat(sprintRunId, sprintId);
    }
  }

  private touchSprintRunHeartbeat(sprintRunId: string | null, sprintId: string | null | undefined): void {
    if (!sprintRunId || !sprintId) {
      return;
    }

    const executionRepository = this.deps.executionRepository as Partial<ExecutionRepository>;
    if (
      typeof executionRepository.getSprintRun !== "function"
      || typeof executionRepository.updateSprintRun !== "function"
    ) {
      return;
    }

    const sprintRun = executionRepository.getSprintRun(sprintRunId);
    if (!sprintRun || sprintRun.status !== "running") {
      return;
    }

    const now = new Date().toISOString();
    if (this.deps.sprintRunLifecycleService) {
      this.deps.sprintRunLifecycleService.updateRun(sprintRunId, {
        lastHeartbeatAt: now,
      });
    }
  }

  private buildReviewPrompt(args: {
    triggerType: QaReviewTriggerType;
    projectName: string;
    sprintGoal: string;
    agentInstructions: string;
    memoryContext?: string;
    subtasks: Subtask[];
    currentTask: Subtask | null;
  }): string {
    const isTaskLevelReview = args.triggerType === "task_completion" || args.triggerType === "completed_task_without_pr";
    const reviewScopeInstructions = buildReviewScopeInstructions(args.triggerType, args.currentTask);
    const currentTaskSection = args.currentTask
      ? [
        isTaskLevelReview ? "## CURRENT TASK UNDER REVIEW" : "## CURRENT TASK",
        `Task key: ${args.currentTask.id}`,
        `Title: ${args.currentTask.title}`,
        `Status: ${args.currentTask.status || "unknown"}`,
        `Provider: ${args.currentTask.provider || "unknown"}`,
        `Worker branch: ${args.currentTask.worker_branch || "none"}`,
        `PR URL: ${args.currentTask.pr_url || "none"}`,
        `Depends on: ${args.currentTask.depends_on.length > 0 ? args.currentTask.depends_on.join(", ") : "none"}`,
        "",
        "Prompt:",
        args.currentTask.prompt,
        "",
        "Recent activity excerpts:",
        this.renderActivityExcerpt(args.currentTask),
      ]
      : [
        "## CURRENT TASK",
        "No single task is preselected. If fixes are required, choose the best target task from the sprint task list and return its task key in `targetTaskKey`.",
      ];
    const sprintTaskContextSection = isTaskLevelReview
      ? this.buildTaskReviewSiblingContext(args.subtasks, args.currentTask)
      : this.buildSprintReviewTaskContext(args.subtasks);

    return [
      "## QUALITY ASSURANCE AGENT INSTRUCTIONS",
      args.agentInstructions.trim(),
      args.memoryContext?.trim() || "",
      "",
      "## REVIEW MODE",
      `Trigger: ${args.triggerType}`,
      triggerReviewModeDescription(args.triggerType),
      "",
      "## REVIEW SCOPE",
      reviewScopeInstructions,
      "",
      "## PROJECT CONTEXT",
      `Project: ${args.projectName}`,
      `Sprint goal: ${args.sprintGoal || "No sprint goal provided."}`,
      "",
      ...sprintTaskContextSection,
      "",
      ...currentTaskSection,
      "",
      "## REQUIRED OUTPUT",
      "Return JSON only.",
      "Use this exact shape:",
      "{",
      '  "verdict": "pass" | "changes_requested",',
      '  "summary": "short markdown summary",',
      '  "findings": ["finding 1", "finding 2"],',
      '  "fixInstructions": "direct instructions for the coding session" | null,',
      '  "targetTaskKey": "T01" | null,',
      '  "shouldHavePr": true | false | null,',
      '  "followUpTasks": [',
      "    {",
      '      "title": "follow-up task title",',
      '      "promptMarkdown": "full task instructions",',
      '      "description": "optional short description" | null,',
      '      "dependsOnTaskKeys": ["T01"],',
      '      "priority": "high" | "medium" | "low"',
      "    }",
      "  ]",
      "}",
      "",
      "Rules:",
      "- `summary` must be concise and factual.",
      "- If `verdict` is `changes_requested`, `fixInstructions` must tell the coding session exactly what to fix next.",
      "- For task-level reviews, review only the current task and return `targetTaskKey` as the current task key when changes are required.",
      "- For task-level reviews, keep `followUpTasks` empty unless this prompt explicitly asks you to create follow-up sprint tasks.",
      "- For sprint completion reviews, set `targetTaskKey` to the best unmerged task to continue when changes are required.",
      "- For sprint completion reviews, use `followUpTasks` when the required work should become new sprint tasks instead of only resuming one existing session.",
      "- For sprint completion reviews, if the best target task is already merged, keep the merged task as `targetTaskKey` for traceability but put the repair in `followUpTasks` so Code UX does not reopen a settled branch.",
      "- Every `followUpTasks[].promptMarkdown` entry must contain the full task instructions, not just a short summary.",
      "- For `completed_task_without_pr`, set `shouldHavePr` explicitly.",
      "- Do not include prose outside the JSON object.",
    ].join("\n");
  }

  private buildTaskReviewSiblingContext(subtasks: Subtask[], currentTask: Subtask | null): string[] {
    const completedSiblingTitles = subtasks
      .filter((task) => task.id !== currentTask?.id && task.status?.trim().toLowerCase() === "completed")
      .map((task) => `- ${task.title}`);
    return [
      "## PREVIOUSLY COMPLETED SPRINT TASKS (TITLES ONLY)",
      completedSiblingTitles.length > 0
        ? completedSiblingTitles.join("\n")
        : "- No other sprint tasks have completed.",
    ];
  }

  private buildSprintReviewTaskContext(subtasks: Subtask[]): string[] {
    const sprintTaskList = subtasks.map((task) => (
      `- [${task.status || "unknown"}] ${task.id}: ${task.title} | provider=${task.provider || "unknown"} | branch=${task.worker_branch || "none"} | pr=${task.pr_url || "none"}`
    )).join("\n");
    const taskContextInputs = subtasks.map((task) => {
      const instruction = task.prompt || "No task instruction provided.";
      const sectionWithoutInstruction = this.renderFullTaskContextSection(task, "");
      return { task, instruction, sectionWithoutInstruction };
    });
    const fullTaskContextCharacters = sprintTaskList.length
      + Math.max(0, taskContextInputs.length - 1) * 2
      + taskContextInputs.reduce(
        (total, input) => total + input.sectionWithoutInstruction.length + input.instruction.length,
        0,
      );
    const estimatedFullTaskContextTokens = Math.ceil(
      fullTaskContextCharacters / QA_TOKEN_ESTIMATE_CHARACTERS_PER_TOKEN,
    );
    const shortenTaskInstructions = estimatedFullTaskContextTokens > QA_TASK_LIST_TOKEN_THRESHOLD;
    const taskContextPolicy = shortenTaskInstructions
      ? [
        `Context policy: the full sprint task context is approximately ${estimatedFullTaskContextTokens.toLocaleString("en-US")} tokens, exceeding the 100,000-token threshold.`,
        "Every task remains listed in order, but each task instruction below contains only its first half.",
        "Use the visible first half of each task instruction together with repository and validation evidence.",
        "Recent activity excerpts are not shortened.",
      ].join("\n")
      : "";
    const fullTaskContextSections = taskContextInputs.map(({ task, instruction }) => {
      if (!shortenTaskInstructions) {
        return this.renderFullTaskContextSection(task, instruction);
      }
      const firstHalf = instruction.slice(0, Math.ceil(instruction.length / 2));
      return this.renderFullTaskContextSection(task, firstHalf);
    });
    return [
      "## SPRINT TASKS",
      sprintTaskList,
      "",
      "## FULL TASK INSTRUCTIONS",
      taskContextPolicy,
      "",
      fullTaskContextSections.join("\n\n"),
    ];
  }

  private renderFullTaskContextSection(task: Subtask, instruction: string): string {
    return [
      `### ${task.id}: ${task.title}`,
      `Status: ${task.status || "unknown"}`,
      `Provider: ${task.provider || "unknown"}`,
      `Worker branch: ${task.worker_branch || "none"}`,
      `PR URL: ${task.pr_url || "none"}`,
      `Depends on: ${task.depends_on.length > 0 ? task.depends_on.join(", ") : "none"}`,
      "",
      "Instruction:",
      instruction,
      "",
      "Recent activity excerpts:",
      this.renderActivityExcerpt(task),
    ].join("\n");
  }

  private renderActivityExcerpt(task: Subtask): string {
    const activities = Array.isArray(task.activities) ? task.activities.slice(-8) : [];
    if (activities.length === 0) {
      return "- No recent activity captured.";
    }

    return activities.map((entry) => {
      const message = entry.agentMessaged?.agentMessage
        || entry.userMessaged?.userMessage
        || entry.progressUpdated?.description
        || entry.description
        || "No summary";
      return `- ${message}`;
    }).join("\n");
  }

  /**
   * Determine which branch a task-level QA review should check out. Prefers the
   * recorded worker branch (on the task or its latest run); in LOCAL mode, when
   * that evidence was lost, recovers the most recent `task/<prefix>-*` branch that
   * carries commits ahead of the feature branch so QA reviews the real work
   * instead of the empty feature branch. Backfills the recovered branch onto the
   * task/run so the downstream fix path and merge gate agree. Falls back to the
   * feature branch only when no worker branch with actual work can be found (e.g.
   * the task genuinely produced no changes).
   */
  private resolveTaskRunForSubtask(task: Subtask, sprintRunId?: string): TaskRunRecord | null {
    const taskId = task.record_id?.trim();
    if (!taskId) {
      return null;
    }
    if (task.session_id) {
      const bySession = this.deps.executionRepository.getLatestTaskRunBySessionId(task.session_id);
      if (bySession) {
        return bySession;
      }
    }
    return this.deps.executionRepository.getLatestTaskRun(taskId, sprintRunId);
  }

  private appendTaskEvent(taskRun: TaskRunRecord | null, eventType: string, payload: Record<string, unknown>): void {
    if (!taskRun) {
      return;
    }
    this.deps.executionRepository.appendTaskRunEvent(taskRun.id, eventType, "system", payload);
  }

  /**
   * Marks (or clears) a task as awaiting QA so the live tag, boat race and stats
   * reflect the QA stage while a review is in flight. Updates the in-memory task
   * (used by the merge gate later in the same cycle) and persists the indicator.
   */
  private setTaskQaPending(task: Subtask, pending: boolean): void {
    const indicator = pending ? "QA_PENDING" : undefined;
    task.merge_indicator = indicator;
    if (task.record_id) {
      this.deps.projectManagementRepository.updateTask(task.record_id, {
        mergeIndicator: indicator ?? null,
      });
    }
  }

  private async continuePendingSprintQaRun(args: {
    run: QaReviewRunRecord;
    repoPath: string;
    subtasks: Subtask[];
    featureBranch: string;
    scope: DashboardSettingsScope;
    maxRuns: number;
    review?: NormalizedQaReviewResult;
  }): Promise<SprintQaReviewOutcome> {
    const targetTask = args.run.targetTaskKey
      ? args.subtasks.find((task) => task.id === args.run.targetTaskKey) ?? null
      : null;
    const review = args.review || this.restoreSprintQaReview(args.run);
    if (!targetTask || !args.run.fixInstructions?.trim() || this.isMergedSubtask(targetTask)) {
      this.deps.qaReviewRepository.updateRun(args.run.id, {
        payload: {
          ...this.getLatestQaRunPayload(args.run),
          continuationStatus: "skipped",
          continuationSkippedReason: !targetTask
            ? "target_task_missing"
            : this.isMergedSubtask(targetTask)
              ? "target_task_already_merged"
              : "fix_instructions_missing",
        },
      });
      return {
        reviewed: true,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: renderSprintQaChangesRequestedReport(
          args.run.summaryMarkdown || review.summary,
          args.run.targetTaskKey,
          false,
          [],
        ),
      };
    }

    if (this.activeQaContinuationRunIds.has(args.run.id)) {
      return {
        reviewed: false,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: renderSprintQaChangesRequestedReport(
          args.run.summaryMarkdown || review.summary,
          targetTask.id,
          false,
          [],
        ),
      };
    }

    if (targetTask.record_id) {
      clearMergeProjectionForRerun(targetTask);
      this.deps.projectManagementRepository.updateTask(targetTask.record_id, {
        status: "coding_completed",
        isMerged: false,
        mergeIndicator: "QA_PENDING",
      });
    }
    targetTask.status = "CODING_COMPLETED";
    targetTask.is_merged = false;
    targetTask.merge_indicator = "QA_PENDING";
    targetTask.intervention_owner = undefined;
    targetTask.intervention_hint = undefined;

    const payload = this.getLatestQaRunPayload(args.run);
    const storedAttemptCount = payload.continuationAttemptCount;
    const previousAttemptCount = typeof storedAttemptCount === "number" && Number.isFinite(storedAttemptCount)
      ? Math.max(0, Math.trunc(storedAttemptCount))
      : 0;
    const continuationAttemptCount = payload.continuationStatus === "running" && previousAttemptCount > 0
      ? previousAttemptCount
      : previousAttemptCount + 1;
    const continuationStartedAt = payload.continuationStatus === "running"
      && typeof payload.continuationStartedAt === "string"
      && payload.continuationStartedAt.trim()
      ? payload.continuationStartedAt
      : new Date().toISOString();
    this.deps.qaReviewRepository.updateRun(args.run.id, {
      payload: {
        ...payload,
        continuationKey: typeof payload.continuationKey === "string"
          ? payload.continuationKey
          : `sprint-qa-followup:${args.run.id}`,
        continuationStatus: "running",
        continuationAttemptCount,
        continuationStartedAt,
        continuationError: undefined,
      },
    });

    const taskRunId = typeof payload.continuationTaskRunId === "string"
      ? payload.continuationTaskRunId
      : null;
    const executionRepository = this.deps.executionRepository as Partial<ExecutionRepository>;
    const targetTaskRun = taskRunId && typeof executionRepository.getTaskRun === "function"
      ? executionRepository.getTaskRun(taskRunId)
      : this.resolveTaskRunForSubtask(targetTask, args.run.sprintRunId || undefined);

    this.activeQaContinuationRunIds.add(args.run.id);
    let continued: QaFixContinuationResult;
    try {
      continued = await this.requestFixesForTask({
        task: targetTask,
        taskRun: targetTaskRun,
        repoPath: args.repoPath,
        featureBranch: args.featureBranch,
        scope: args.scope,
        prompt: args.run.fixInstructions,
        qaContinuationRunId: args.run.id,
      });
    } catch (error) {
      const failedAt = new Date().toISOString();
      const retryBudgetExhausted = continuationAttemptCount >= QA_INFRA_FAILURE_GRACE;
      this.deps.qaReviewRepository.updateRun(args.run.id, {
        payload: {
          ...this.getLatestQaRunPayload(args.run),
          continued: false,
          continuationMode: "failed",
          continuationStatus: retryBudgetExhausted ? "failed" : "pending",
          continuationAttemptCount,
          continuationError: error instanceof Error ? error.message : String(error),
          continuationFailedAt: failedAt,
          continuationSettledAt: retryBudgetExhausted ? failedAt : undefined,
          followUpNoProgress: retryBudgetExhausted,
        },
      });
      if (targetTask.record_id) {
        clearMergeProjectionForRerun(targetTask);
        this.deps.projectManagementRepository.updateTask(targetTask.record_id, {
          status: "coding_completed",
          isMerged: false,
          mergeIndicator: "QA_PENDING",
        });
      }
      targetTask.status = "CODING_COMPLETED";
      targetTask.is_merged = false;
      targetTask.merge_indicator = "QA_PENDING";
      targetTask.intervention_owner = undefined;
      targetTask.intervention_hint = undefined;
      throw error;
    } finally {
      this.activeQaContinuationRunIds.delete(args.run.id);
    }

    const createdFollowUpTasks = this.createSprintFollowUpTasks({
      projectId: args.run.projectId,
      sprintId: args.run.sprintId,
      targetTask,
      fixInstructions: args.run.fixInstructions,
      review,
      existingSubtasks: args.subtasks,
      sourceRunId: args.run.id,
    });
    this.deps.qaReviewRepository.updateRun(args.run.id, {
      payload: {
        ...this.getLatestQaRunPayload(args.run),
        continued: continued.applied,
        continuationMode: continued.mode,
        continuationStatus: continued.noProgress
          ? "no_progress"
          : continued.applied
            ? "completed"
            : "skipped",
        continuationSettledAt: new Date().toISOString(),
        continuationError: undefined,
        followUpNoProgress: continued.noProgress,
        followUpBlocker: continued.blocker,
        createdFollowUpTaskKeys: createdFollowUpTasks.map((task) => task.taskKey),
      },
    });

    if (continued.applied && targetTask.record_id) {
      clearMergeProjectionForRerun(targetTask);
      this.deps.projectManagementRepository.updateTask(targetTask.record_id, {
        status: "coding_completed",
        isMerged: false,
        mergeIndicator: "QA_PENDING",
      });
      targetTask.status = "CODING_COMPLETED";
      targetTask.is_merged = false;
      targetTask.merge_indicator = "QA_PENDING";
    }

    return {
      reviewed: true,
      blockedCompletion: true,
      mergeBlocked: true,
      reportText: renderSprintQaChangesRequestedReport(
        args.run.summaryMarkdown || review.summary,
        targetTask.id,
        continued.applied,
        createdFollowUpTasks.map((task) => task.taskKey),
      ) + (args.run.runIndex >= args.maxRuns ? renderSprintQaBudgetExhaustedReport(args.maxRuns) : ""),
    };
  }

  private restoreSprintQaReview(run: QaReviewRunRecord): NormalizedQaReviewResult {
    try {
      return normalizeQaReviewResult(JSON.stringify(run.payload || {}));
    } catch {
      return {
        verdict: "changes_requested",
        summary: run.summaryMarkdown || "Sprint QA requested follow-up work.",
        findings: [],
        fixInstructions: run.fixInstructions,
        targetTaskKey: run.targetTaskKey,
        shouldHavePr: null,
        followUpTasks: [],
        raw: run.payload || {},
      };
    }
  }

  private isPendingTaskQaContinuation(run: QaReviewRunRecord): boolean {
    return isPendingQaContinuation(run);
  }

  private async continuePendingTaskQaRun(args: {
    run: QaReviewRunRecord;
    task: Subtask;
    taskRun: TaskRunRecord | null;
    repoPath: string;
    featureBranch: string;
    scope: DashboardSettingsScope;
    decisiveRuns: number;
    maxTaskReviewRuns: number;
    findings?: string[];
  }): Promise<TaskQaReviewOutcome> {
    const persistedRun = this.deps.qaReviewRepository.getRun(args.run.id) || args.run;
    if (persistedRun.payload?.continuationStatus === "awaiting_provider") {
      return this.reconcileAwaitingProviderTaskQaRun({
        ...args,
        run: persistedRun,
      });
    }

    if (this.activeQaContinuationRunIds.has(args.run.id)) {
      return {
        reviewed: false,
        reopenedTask: false,
        mergeBlocked: true,
        reportText: renderQaChangesRequestedReport(
          args.task.id,
          args.run.summaryMarkdown || "QA requested follow-up changes.",
          false,
        ),
      };
    }

    if (this.isLaterTaskRunStillActive(args.run, args.taskRun)) {
      return {
        reviewed: false,
        reopenedTask: false,
        mergeBlocked: true,
        reportText: renderQaChangesRequestedReport(
          args.task.id,
          args.run.summaryMarkdown || "QA requested follow-up changes.",
          false,
        ),
      };
    }

    if (this.hasCompletedSameSessionQaFollowUp(
      args.run,
      args.taskRun,
      args.run.targetSessionId?.trim() || args.task.session_id,
    )) {
      const reconciledAt = new Date().toISOString();
      this.deps.qaReviewRepository.updateRun(args.run.id, {
        payload: {
          ...(this.deps.qaReviewRepository.getRun(args.run.id)?.payload || args.run.payload || {}),
          continuationKey: typeof args.run.payload?.continuationKey === "string"
            ? args.run.payload.continuationKey
            : `qa-followup:${args.run.id}`,
          continuationStatus: "completed",
          continuationMode: "cli",
          continuationSettledAt: reconciledAt,
          continuationReconciled: true,
          continued: true,
          followUpNoProgress: false,
          followUpBlocker: null,
          postExhaustionVerificationEligible: args.decisiveRuns === args.maxTaskReviewRuns,
        },
      });
      if (args.task.record_id) {
        clearMergeProjectionForRerun(args.task);
        this.deps.projectManagementRepository.updateTask(args.task.record_id, {
          status: "coding_completed",
          isMerged: false,
          mergeIndicator: "QA_PENDING",
        });
      }
      args.task.status = "CODING_COMPLETED";
      args.task.merge_indicator = "QA_PENDING";
      return {
        reviewed: true,
        reopenedTask: true,
        mergeBlocked: true,
        reportText: renderQaChangesRequestedReport(
          args.task.id,
          args.run.summaryMarkdown || "QA requested follow-up changes.",
          true,
        ),
      };
    }

    // A legacy failure may already have projected this task back to pending or
    // running ordinary coding. Re-establish the durable QA stage before the
    // provider side effect so a concurrent snapshot/restart cannot redispatch it
    // as unrelated task work while this handoff is in flight.
    if (args.task.record_id) {
      this.deps.projectManagementRepository.updateTask(args.task.record_id, {
        status: "coding_completed",
        isMerged: false,
        mergeIndicator: "QA_PENDING",
      });
    }
    args.task.status = "CODING_COMPLETED";
    args.task.is_merged = false;
    args.task.merge_indicator = "QA_PENDING";
    args.task.intervention_owner = undefined;
    args.task.intervention_hint = undefined;

    this.activeQaContinuationRunIds.add(args.run.id);
    const continuationKey = typeof args.run.payload?.continuationKey === "string"
      ? args.run.payload.continuationKey
      : `qa-followup:${args.run.id}`;
    const latestPayload = (): Record<string, unknown> => (
      this.deps.qaReviewRepository.getRun(args.run.id)?.payload || args.run.payload || {}
    );
    const checkpointPayload = latestPayload();
    const storedAttemptCount = checkpointPayload.continuationAttemptCount;
    const previousAttemptCount = typeof storedAttemptCount === "number" && Number.isFinite(storedAttemptCount)
      ? Math.max(0, Math.trunc(storedAttemptCount))
      : checkpointPayload.continuationStatus === "failed"
        ? 1
        : 0;
    // A process restart leaves the durable row at `running`. Resuming that same
    // logical/native provider turn must not consume another failure allowance;
    // only a fresh dispatch from pending/failed starts a new bounded attempt.
    const continuationAttemptCount = checkpointPayload.continuationStatus === "running"
      && previousAttemptCount > 0
      ? previousAttemptCount
      : previousAttemptCount + 1;
    const continuationStartedAt = checkpointPayload.continuationStatus === "running"
      && typeof checkpointPayload.continuationStartedAt === "string"
      && checkpointPayload.continuationStartedAt.trim()
      ? checkpointPayload.continuationStartedAt
      : new Date().toISOString();

    this.deps.qaReviewRepository.updateRun(args.run.id, {
      payload: {
        ...checkpointPayload,
        continuationKey,
        continuationStatus: "running",
        continuationAttemptCount,
        continuationStartedAt,
        continuationError: undefined,
        followUpNoProgress: false,
        followUpBlocker: null,
      },
    });

    let continued: QaFixContinuationResult;
    try {
      const executionRepository = this.deps.executionRepository as Partial<ExecutionRepository>;
      const continuationTaskRun = args.run.taskRunId && typeof executionRepository.getTaskRun === "function"
        ? executionRepository.getTaskRun(args.run.taskRunId) || args.taskRun
        : args.taskRun;
      const continuationSessionId = args.run.targetSessionId?.trim() || args.task.session_id;
      const continuationTask = continuationSessionId && continuationSessionId !== args.task.session_id
        ? { ...args.task, session_id: continuationSessionId }
        : args.task;
      continued = args.run.fixInstructions?.trim()
        ? await this.requestFixesForTask({
            task: continuationTask,
            taskRun: continuationTaskRun,
            repoPath: args.repoPath,
            featureBranch: args.featureBranch,
            scope: args.scope,
            prompt: args.run.fixInstructions,
            qaContinuationRunId: args.run.id,
          })
        : { applied: false, mode: "none", noProgress: false, blocker: null };
    } catch (error) {
      const continuationError = error instanceof Error ? error.message : String(error);
      const retryBudgetExhausted = continuationAttemptCount >= QA_INFRA_FAILURE_GRACE;
      const failedAt = new Date().toISOString();
      this.deps.qaReviewRepository.updateRun(args.run.id, {
        payload: {
          ...latestPayload(),
          continued: false,
          continuationMode: "failed",
          continuationStatus: retryBudgetExhausted ? "failed" : "pending",
          continuationAttemptCount,
          continuationError,
          continuationFailedAt: failedAt,
          continuationSettledAt: retryBudgetExhausted ? failedAt : undefined,
          followUpNoProgress: retryBudgetExhausted,
          followUpBlocker: retryBudgetExhausted ? continuationError : null,
        },
      });
      if (args.task.record_id) {
        this.deps.projectManagementRepository.updateTask(args.task.record_id, {
          status: "coding_completed",
          isMerged: false,
          mergeIndicator: "QA_PENDING",
        });
      }
      args.task.status = "CODING_COMPLETED";
      args.task.is_merged = false;
      args.task.merge_indicator = "QA_PENDING";
      args.task.intervention_owner = undefined;
      args.task.intervention_hint = undefined;
      throw error;
    } finally {
      this.activeQaContinuationRunIds.delete(args.run.id);
    }

    const awaitingHostedProvider = continued.applied && continued.mode === "jules";
    const continuationStatus = continued.noProgress
      ? "no_progress"
      : awaitingHostedProvider
        ? "awaiting_provider"
        : continued.applied
        ? "completed"
        : "skipped";
    const postExhaustionVerificationEligible = continued.applied
      && args.decisiveRuns === args.maxTaskReviewRuns;
    const continuationUpdatedAt = new Date().toISOString();
    this.deps.qaReviewRepository.updateRun(args.run.id, {
      payload: {
        ...latestPayload(),
        continued: continued.applied,
        continuationMode: continued.mode,
        continuationStatus,
        continuationDispatchedAt: awaitingHostedProvider ? continuationUpdatedAt : undefined,
        continuationSettledAt: awaitingHostedProvider ? undefined : continuationUpdatedAt,
        continuationError: undefined,
        followUpNoProgress: continued.noProgress,
        followUpBlocker: continued.blocker,
        postExhaustionVerificationEligible,
      },
    });

    const taskId = args.task.record_id?.trim();
    if (taskId) {
      if (continued.noProgress) {
        this.deps.projectManagementRepository.updateTask(taskId, {
          status: "coding_completed",
          mergeIndicator: null,
        });
        args.task.status = "CODING_COMPLETED";
      } else if (awaitingHostedProvider) {
        clearMergeProjectionForRerun(args.task);
        this.deps.projectManagementRepository.updateTask(taskId, {
          status: "in_progress",
          isMerged: false,
          mergeIndicator: "QA_PENDING",
        });
        args.task.status = "RUNNING";
        args.task.merge_indicator = "QA_PENDING";
      } else if (continued.applied) {
        clearMergeProjectionForRerun(args.task);
        this.deps.projectManagementRepository.updateTask(taskId, {
          status: "coding_completed",
          isMerged: false,
          mergeIndicator: "QA_PENDING",
        });
        args.task.status = "CODING_COMPLETED";
        args.task.merge_indicator = "QA_PENDING";
      } else {
        this.deps.projectManagementRepository.updateTask(taskId, {
          status: "pending",
          ...MERGE_PROJECTION_RESET,
        });
        args.task.status = "PENDING";
      }
      if (!continued.applied) {
        clearMergeProjectionForRerun(args.task);
      }
    }

    this.appendTaskEvent(args.taskRun, "qa_review_changes_requested", {
      triggerType: args.run.triggerType,
      summary: args.run.summaryMarkdown,
      findings: args.findings || [],
      fixInstructions: args.run.fixInstructions,
      qaReviewRunId: args.run.id,
      continued: continued.applied,
      continuationMode: continued.mode,
      continuationStatus,
      followUpNoProgress: continued.noProgress,
      followUpBlocker: continued.blocker,
      postExhaustionVerificationEligible,
      agentPresetId: args.run.agentPresetId,
      agentName: args.run.agentName,
    });

    return {
      reviewed: true,
      reopenedTask: true,
      mergeBlocked: true,
      reportText: renderQaChangesRequestedReport(
        args.task.id,
        args.run.summaryMarkdown || "QA requested follow-up changes.",
        continued.applied,
      ),
    };
  }

  private reconcileAwaitingProviderTaskQaRun(args: {
    run: QaReviewRunRecord;
    task: Subtask;
    taskRun: TaskRunRecord | null;
  }): TaskQaReviewOutcome {
    const executionRepository = this.deps.executionRepository as Partial<ExecutionRepository>;
    const taskRun = args.run.taskRunId && typeof executionRepository.getTaskRun === "function"
      ? executionRepository.getTaskRun(args.run.taskRunId) || args.taskRun
      : args.taskRun;
    const payload = this.deps.qaReviewRepository.getRun(args.run.id)?.payload || args.run.payload || {};
    const continuationStartedAt = typeof payload.continuationStartedAt === "string"
      ? Date.parse(payload.continuationStartedAt)
      : Number.NaN;
    const taskRunFinishedAt = taskRun?.finishedAt ? Date.parse(taskRun.finishedAt) : Number.NaN;
    const expectedSessionId = args.run.targetSessionId?.trim() || args.task.session_id?.trim();
    const sessionMatches = !expectedSessionId
      || !taskRun?.sessionId
      || taskRun.sessionId === expectedSessionId;
    const completedAfterDispatch = taskRun?.state === "COMPLETED"
      && sessionMatches
      && Number.isFinite(continuationStartedAt)
      && Number.isFinite(taskRunFinishedAt)
      && taskRunFinishedAt > continuationStartedAt;

    if (completedAfterDispatch) {
      const reconciledAt = taskRun?.finishedAt || new Date().toISOString();
      this.deps.qaReviewRepository.updateRun(args.run.id, {
        payload: {
          ...payload,
          continuationStatus: "completed",
          continuationMode: "jules",
          continuationSettledAt: reconciledAt,
          continuationReconciled: true,
          continued: true,
          followUpNoProgress: false,
          followUpBlocker: null,
        },
      });
      if (args.task.record_id) {
        clearMergeProjectionForRerun(args.task);
        this.deps.projectManagementRepository.updateTask(args.task.record_id, {
          status: "coding_completed",
          isMerged: false,
          mergeIndicator: "QA_PENDING",
        });
      }
      args.task.status = "CODING_COMPLETED";
      args.task.is_merged = false;
      args.task.merge_indicator = "QA_PENDING";
      return {
        reviewed: true,
        reopenedTask: true,
        mergeBlocked: true,
        reportText: renderQaChangesRequestedReport(
          args.task.id,
          args.run.summaryMarkdown || "QA requested follow-up changes.",
          true,
        ),
      };
    }

    // API acceptance only proves that Jules queued the same-session follow-up.
    // Keep the task in progress and retain the durable awaiting checkpoint so
    // a process restart observes the provider run instead of resending it.
    if (
      args.task.status !== "RUNNING"
      || args.task.is_merged === true
      || args.task.merge_indicator !== "QA_PENDING"
    ) {
      if (args.task.record_id) {
        clearMergeProjectionForRerun(args.task);
        this.deps.projectManagementRepository.updateTask(args.task.record_id, {
          status: "in_progress",
          isMerged: false,
          mergeIndicator: "QA_PENDING",
        });
      }
      args.task.status = "RUNNING";
      args.task.is_merged = false;
      args.task.merge_indicator = "QA_PENDING";
    }
    return {
      reviewed: false,
      reopenedTask: false,
      mergeBlocked: true,
      reportText: renderQaChangesRequestedReport(
        args.task.id,
        args.run.summaryMarkdown || "QA requested follow-up changes.",
        false,
      ),
    };
  }

  private isLaterTaskRunAfterQaVerdict(run: QaReviewRunRecord, taskRun: TaskRunRecord | null): boolean {
    if (!taskRun || !run.taskRunId || taskRun.id === run.taskRunId) {
      return false;
    }
    const qaFinishedAt = Date.parse(run.finishedAt || run.startedAt);
    const taskRunStartedAt = Date.parse(taskRun.startedAt || "");
    return !Number.isFinite(qaFinishedAt)
      || !Number.isFinite(taskRunStartedAt)
      || taskRunStartedAt > qaFinishedAt;
  }

  private isLaterTaskRunStillActive(run: QaReviewRunRecord, taskRun: TaskRunRecord | null): boolean {
    return this.isLaterTaskRunAfterQaVerdict(run, taskRun)
      && taskRun?.state !== "COMPLETED"
      && taskRun?.state !== "FAILED";
  }

  private hasCompletedSameSessionQaFollowUp(
    run: QaReviewRunRecord,
    taskRun: TaskRunRecord | null,
    taskSessionId: string | undefined,
  ): boolean {
    if (this.isLaterTaskRunAfterQaVerdict(run, taskRun) && taskRun?.state === "COMPLETED") {
      const qaFinishedAt = Date.parse(run.finishedAt || run.startedAt);
      const taskRunFinishedAt = Date.parse(taskRun.finishedAt || "");
      if (Number.isFinite(taskRunFinishedAt)
        && (!Number.isFinite(qaFinishedAt) || taskRunFinishedAt > qaFinishedAt)) {
        return true;
      }
    }
    // A completed provider invocation is not a durable publication checkpoint:
    // the runtime can still exit after the provider committed in its workspace
    // but before that patch reached the host worker branch. Only a later task run
    // that fully settled can reconcile the handoff without re-entering the
    // publication path; same-run continuations must reuse their saved baseline.
    void taskSessionId;
    return false;
  }

  private async requestFixesForTask(args: {
    task: Subtask;
    taskRun: TaskRunRecord | null;
    repoPath: string;
    featureBranch: string;
    scope: DashboardSettingsScope;
    prompt: string;
    qaContinuationRunId?: string;
  }): Promise<QaFixContinuationResult> {
    const provider = args.task.provider;
    const sessionId = args.task.session_id?.trim();
    if (!provider || !sessionId) {
      return { applied: false, mode: "none", noProgress: false, blocker: null };
    }

    const followUpPrompt = [
      "Quality assurance review found follow-up work before this task can be considered done.",
      "",
      args.prompt.trim(),
    ].join("\n");

    if (provider === "jules") {
      await this.deps.sendSessionMessage(sessionId, followUpPrompt);
      return { applied: true, mode: "jules", noProgress: false, blocker: null };
    }

    const result = await this.continueCliTaskSession({
      provider,
      sessionId,
      task: args.task,
      taskRun: args.taskRun,
      repoPath: args.repoPath,
      featureBranch: args.featureBranch,
      scope: args.scope,
      followUpPrompt,
      qaContinuationRunId: args.qaContinuationRunId,
    });
    return {
      applied: result.producedMergeWork,
      mode: "cli",
      noProgress: !result.producedMergeWork,
      blocker: result.providerOutcome.kind === "blocked" ? result.providerOutcome.blocker : null,
    };
  }

  private resolveQaFollowUpProviderRecovery(args: {
    invocation: ProviderInvocationUsageRecord | null;
    payload: Record<string, unknown> | null;
    provider: CliQaProvider;
    task: Subtask;
    taskRun: TaskRunRecord | null;
  }): { invocation: ProviderInvocationUsageRecord; providerOutcome: TaskExecutionOutcome } | null {
    const { invocation, payload } = args;
    if (
      !invocation
      || !payload
      || payload.continuationStatus !== "running"
      || invocation.status !== "completed"
      || invocation.provider !== args.provider
      || invocation.purpose !== "task_coding"
    ) {
      return null;
    }

    const expectedTaskRunId = args.taskRun?.id?.trim();
    if (expectedTaskRunId && invocation.taskRunId !== expectedTaskRunId) {
      return null;
    }
    const expectedTaskId = args.taskRun?.taskId?.trim() || args.task.record_id?.trim();
    if (expectedTaskId && invocation.taskId && invocation.taskId !== expectedTaskId) {
      return null;
    }

    const checkpointedInvocationId = typeof payload.continuationProviderInvocationId === "string"
      ? payload.continuationProviderInvocationId.trim()
      : "";
    const explicitlyCheckpointed = payload.continuationProviderStatus === "completed"
      && checkpointedInvocationId === invocation.id;
    const baselineRecordedAt = typeof payload.continuationWorkspaceBaseRecordedAt === "string"
      ? Date.parse(payload.continuationWorkspaceBaseRecordedAt)
      : Number.NaN;
    const invocationCompletedAt = Date.parse(invocation.finishedAt || invocation.updatedAt);
    const completedAfterBaseline = Number.isFinite(baselineRecordedAt)
      && Number.isFinite(invocationCompletedAt)
      && invocationCompletedAt >= baselineRecordedAt;
    if (!explicitlyCheckpointed && !completedAfterBaseline) {
      return null;
    }

    const outcomeKind = payload.continuationProviderOutcomeKind;
    const blocker = typeof payload.continuationProviderBlocker === "string"
      ? payload.continuationProviderBlocker.trim()
      : "";
    const providerOutcome: TaskExecutionOutcome = explicitlyCheckpointed && outcomeKind === "completed"
      ? { kind: "completed", blocker: null }
      : explicitlyCheckpointed && outcomeKind === "blocked"
        ? {
            kind: "blocked",
            blocker: blocker || "The coding agent reported an external blocker without a specific reason.",
          }
        : { kind: "unknown", blocker: null };

    return { invocation, providerOutcome };
  }

  private async continueCliTaskSession(args: {
    provider: CliQaProvider;
    sessionId: string;
    task: Subtask;
    taskRun: TaskRunRecord | null;
    repoPath: string;
    featureBranch: string;
    scope: DashboardSettingsScope;
    followUpPrompt: string;
    qaContinuationRunId?: string;
  }): Promise<CliQaFollowUpResult> {
    const settings = this.deps.getDashboardSettings(args.scope);
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...settings.cliWorkflow,
    };
    const gitAuth: GitHttpAuthOptions = {
      githubToken: settings.git.githubToken,
      gitlabToken: settings.git.gitlabToken,
    };
    const gitPolicy = buildInvocationGitPolicy({
      githubMode: settings.git.githubMode,
      defaultBranch: settings.git.defaultBranch,
      githubToken: settings.git.githubToken,
      gitlabToken: settings.git.gitlabToken,
    });
    const workspaceTaskId = args.taskRun?.taskId || args.task.record_id;
    const recordedWorkspaceTarget = workspaceTaskId
      && typeof this.deps.executionRepository.getLatestTaskWorkspaceResumeTarget === "function"
      ? this.deps.executionRepository.getLatestTaskWorkspaceResumeTarget(
        workspaceTaskId,
        args.taskRun?.sprintRunId || undefined,
      )
      : null;
    const knownWorkerBranch = args.task.worker_branch?.trim()
      || args.taskRun?.workerBranch?.trim()
      || null;
    const durableWorkspaceTarget = recordedWorkspaceTarget
      && (!recordedWorkspaceTarget.provider || recordedWorkspaceTarget.provider === args.provider)
      && (!knownWorkerBranch
        || !recordedWorkspaceTarget.workerBranch
        || recordedWorkspaceTarget.workerBranch === knownWorkerBranch)
      ? recordedWorkspaceTarget
      : null;
    const workspaceSessionId = durableWorkspaceTarget?.sessionId || args.sessionId;
    const {
      worktreePath,
      hasPreservedWorkspace,
      currentBranch: resolvedWorkspaceBranch,
    } = await this.invocationWorkspacePreparer.resolveContinuationWorkspace({
      repoPath: args.repoPath,
      sessionId: workspaceSessionId,
      executionMode: workflowSettings.executionMode,
      worktreePath: durableWorkspaceTarget?.worktreePath,
    });
    let workerBranch = args.task.worker_branch?.trim()
      || args.taskRun?.workerBranch?.trim()
      || resolvedWorkspaceBranch
      || undefined;
    let isRecovered = Boolean(workerBranch);

    if (!workerBranch) {
      const prUrl = args.task.pr_url?.trim() || args.taskRun?.prUrl?.trim();
      if (prUrl) {
        try {
          const client = new GitStatusQueryClient(args.repoPath);
          const remoteRes = await client.gitRemoteUrl("origin", settings.git.githubToken);
          const remoteUrl = remoteRes.ok ? remoteRes.stdout.trim() : null;
          const { provider, hostDomain, repoTarget } = resolveRepositoryHost(remoteUrl);
          const hostTokens = {
            githubToken: settings.git.githubToken,
            gitlabToken: settings.git.gitlabToken,
          };
          const effectiveToken = selectHostToken(provider, hostTokens);
          client.setProvider(provider, hostDomain, repoTarget, Boolean(effectiveToken));

          const openRes = await client.ghPrListOpen(effectiveToken);
          if (openRes.ok) {
            const { data } = parseOpenPrs(openRes.stdout);
            const match = data.find(p => p.url?.trim() === prUrl);
            if (match && match.headRefName) {
              workerBranch = match.headRefName;
              isRecovered = true;
            }
          }
          if (!workerBranch) {
            const mergedRes = await client.ghPrListMerged(effectiveToken);
            if (mergedRes.ok) {
              const { data } = parseMergedPrs(mergedRes.stdout);
              const match = data.find(p => p.url?.trim() === prUrl);
              if (match && match.headRefName) {
                workerBranch = match.headRefName;
                isRecovered = true;
              }
            }
          }
        } catch (err) {
          this.deps.logger?.warn?.(`Failed to recover worker branch from PR metadata: ${err}`);
        }
      }
    }

    if (!workerBranch) {
      if (args.featureBranch && args.task?.id && args.provider) {
        const prefix = buildWorkerBranchPrefix(args.featureBranch, args.task.id, args.provider);
        try {
          const gitAllRes = await runCommandStrict("git", ["branch", "-a", "--list", `*${prefix}*`], args.repoPath);
          if (gitAllRes.ok) {
            const branches = gitAllRes.stdout
              .split("\n")
              .map(b => b.replace(/^\*?\s*/, "").trim())
              .filter(Boolean);
            const localMatch = branches.find(b => !b.startsWith("remotes/"));
            if (localMatch) {
              workerBranch = localMatch;
              isRecovered = true;
            } else {
              const remoteMatch = branches.find(b => b.startsWith("remotes/origin/"));
              if (remoteMatch) {
                workerBranch = remoteMatch.replace("remotes/origin/", "");
                isRecovered = true;
              }
            }
          }
        } catch (err) {
          this.deps.logger?.warn?.(`Failed to recover worker branch from git branch listing: ${err}`);
        }
      }
    }

    if (!workerBranch) {
      if (args.featureBranch?.trim() && args.task?.id?.trim() && args.provider) {
        try {
          workerBranch = buildWorkerBranch(args.featureBranch, args.task.id, args.provider);
        } catch (err) {
          this.deps.logger?.warn?.(`Failed to build deterministic worker branch: ${err}`);
        }
      }
    }

    if (!workerBranch) {
      const workspaceState = hasPreservedWorkspace
        ? `resume workspace ${worktreePath} does not expose a current branch`
        : `resume workspace is missing for session ${args.sessionId}`;
      throw new Error(
        `Cannot continue CLI QA fixes for ${args.task.id}: worker branch metadata is missing and ${workspaceState}.`,
      );
    }

    // Persist recovered worker-branch metadata back to the task run and project-management task when available
    if (workerBranch && isRecovered) {
      if (args.task.worker_branch !== workerBranch) {
        args.task.worker_branch = workerBranch;
      }
      if (args.taskRun && args.taskRun.workerBranch !== workerBranch) {
        args.taskRun.workerBranch = workerBranch;
        if (args.taskRun.id) {
          try {
            this.deps.executionRepository.updateTaskRun(args.taskRun.id, { workerBranch });
          } catch (err) {
            this.deps.logger?.warn?.(`Failed to update taskRun workerBranch: ${err}`);
          }
        }
      }
    }

    try {
      await this.syncRemoteBranchesIfNeeded(
        args.repoPath,
        workerBranch,
        args.scope,
        "continuing QA follow-up",
      );

      if (!hasPreservedWorkspace) {
        await this.invocationWorkspacePreparer.prepareWorktree({
          repoPath: args.repoPath,
          worktreePath,
          workerBranch,
          featureBranch: args.featureBranch,
          resumeSessionId: workspaceSessionId,
          allowExistingWorkerBranch: true,
          gitAuth,
          gitPolicy,
        });
      } else {
        await this.syncExistingCliFollowUpWorkspace(worktreePath, workerBranch, args.repoPath, gitAuth);
      }
    } catch (prepareError) {
      if (!isRecovered) {
        const workspaceState = hasPreservedWorkspace
          ? `resume workspace ${worktreePath} does not expose a current branch`
          : `resume workspace is missing for session ${args.sessionId}`;
        throw new Error(
          `Cannot continue CLI QA fixes for ${args.task.id}: worker branch metadata is missing and ${workspaceState}.`,
        );
      }
      throw prepareError;
    }

    const requestedCodingAgentId = args.task.agentPresetId
      || (settings.agents.routing.taskCoding.mode === "MANUAL"
        ? settings.agents.routing.taskCoding.agentPresetId
        : null);
    const workerAgent = typeof this.deps.agentPresetSyncService.resolveTargetedCodingAgent === "function"
      ? await this.deps.agentPresetSyncService.resolveTargetedCodingAgent(
        args.scope.projectId!,
        requestedCodingAgentId,
      ).catch(() => null)
      : await this.deps.agentPresetSyncService.getOptionalWorkerAgentForRepoPath(args.repoPath).catch(() => null);
    const workerInstructions = workerAgent?.instructionMarkdown?.trim() || "";
    const workerMemoryInstructions = resolveAgentMemoryInstructions(
      workerAgent || {},
      settings.memory?.workerLearningsInstruction,
    );
    const workerMemoryContext = workerAgent?.id
      ? await this.buildMemoryContext(args.scope.projectId!, args.scope.sprintId || null, workerAgent.id, args.followUpPrompt)
      : undefined;
    const outcomeInstructions = buildTaskCodingOutcomeInstructions({
      projectId: args.scope.projectId,
      sprintId: args.scope.sprintId,
      taskId: args.taskRun?.taskId || args.task.record_id || args.task.id,
      sprintRunId: args.taskRun?.sprintRunId,
      dispatchId: args.taskRun?.dispatchId,
      taskRunId: args.taskRun?.id,
      sessionId: args.sessionId,
    });
    const promptBody = [
      workerInstructions
        ? `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerInstructions}`
        : "",
      workerMemoryContext?.trim() || "",
      "## ORIGINAL SUBTASK",
      args.task.prompt,
      "",
      "## QA FOLLOW-UP",
      args.followUpPrompt,
      outcomeInstructions,
      workerMemoryInstructions
        ? `## LEARNINGS CAPTURE (Required)\n\n${workerMemoryInstructions}`
        : "",
    ].filter(Boolean).join("\n\n");
    const workspaceGuidance = await this.workspaceManager.buildWorkspaceGuidance(args.followUpPrompt, worktreePath);
    let followUpProviderSettings = settings.aiProvider.providers[args.provider];
    if (typeof this.deps.taskService?.resolveInvocationProvider === "function") {
      try {
        const route = this.deps.taskService.resolveInvocationProvider("task_coding", args.task, {
          scope: args.scope,
          cliOnly: true,
        });
        const providerConfigId = this.deps.taskService.resolveProviderConfigIdForProvider(route, args.provider);
        if (route.providers[providerConfigId]) {
          followUpProviderSettings = route.providers[providerConfigId];
        }
      } catch (error) {
        this.deps.logger?.warn("Failed to resolve follow-up provider via taskService routing", { error });
      }
    }

    const effectiveModel = resolveEffectiveModel({
      provider: args.provider,
      model: followUpProviderSettings.model,
      providerMountAuth: followUpProviderSettings.mountAuth,
      customModel: followUpProviderSettings.customModel,
      qwenAuthMode: followUpProviderSettings.qwenAuthMode,
      qwenModelId: followUpProviderSettings.qwenModelId,
      openCodeAuthMode: followUpProviderSettings.openCodeAuthMode,
      openCodeProviderId: followUpProviderSettings.openCodeProviderId,
      openCodeModelId: followUpProviderSettings.openCodeModelId,
    });

    const providerPrompt = buildProviderPrompt(`${promptBody}\n\n${workspaceGuidance}`, followUpProviderSettings.thinkingMode, args.provider);
    const previousInvocation = this.resolveQaCodingInvocation({
      provider: args.provider,
      logicalSessionId: args.sessionId,
      workspaceSessionId,
      workspaceTaskRunId: durableWorkspaceTarget?.taskRunId || args.taskRun?.id || null,
    });
    let persistedContinuationPayload = args.qaContinuationRunId
      ? this.deps.qaReviewRepository.getRun(args.qaContinuationRunId)?.payload ?? null
      : null;
    const persistedWorkspaceBaseRef = typeof persistedContinuationPayload?.continuationWorkspaceBaseRef === "string"
      ? persistedContinuationPayload.continuationWorkspaceBaseRef.trim()
      : "";
    const initialHead = persistedWorkspaceBaseRef
      || (await this.runWorkspaceCommand(worktreePath, "git", ["rev-parse", "HEAD"])).stdout.trim();
    if (persistedWorkspaceBaseRef) {
      await this.runWorkspaceCommand(worktreePath, "git", ["rev-parse", "--verify", `${persistedWorkspaceBaseRef}^{commit}`]);
    } else if (args.qaContinuationRunId) {
      const run = this.deps.qaReviewRepository.getRun(args.qaContinuationRunId);
      if (run) {
        this.deps.qaReviewRepository.updateRun(run.id, {
          payload: {
            ...(run.payload || {}),
            continuationWorkspaceBaseRef: initialHead,
            continuationWorkspaceBaseRecordedAt: new Date().toISOString(),
          },
        });
        persistedContinuationPayload = this.deps.qaReviewRepository.getRun(run.id)?.payload || run.payload;
      }
    }
    // The shared QA coding path is also used by sprint-completion handoffs.
    // Persist the verification-ready projection immediately before dispatch so
    // a hard process exit cannot expose this task as ordinary pending/running
    // coding, regardless of which QA scope initiated the continuation.
    if (args.task.record_id) {
      clearMergeProjectionForRerun(args.task);
      this.deps.projectManagementRepository.updateTask(args.task.record_id, {
        status: "coding_completed",
        isMerged: false,
        mergeIndicator: "QA_PENDING",
      });
    }
    args.task.status = "CODING_COMPLETED";
    args.task.is_merged = false;
    args.task.merge_indicator = "QA_PENDING";
    args.task.intervention_owner = undefined;
    args.task.intervention_hint = undefined;
    this.deps.sessionTracking.updateSession(args.sessionId, { state: "RUNNING" });
    const recoveredProvider = this.resolveQaFollowUpProviderRecovery({
      invocation: previousInvocation,
      payload: persistedContinuationPayload,
      provider: args.provider,
      task: args.task,
      taskRun: args.taskRun,
    });
    let providerOutcome: TaskExecutionOutcome;
    if (recoveredProvider) {
      providerOutcome = recoveredProvider.providerOutcome;
      this.deps.sessionTracking.appendActivity(args.sessionId, {
        originator: "system",
        description: "Recovered completed QA follow-up work after restart; continuing with Git finalization without invoking the coding agent again.",
      });
      this.appendTaskEvent(args.taskRun, "qa_followup_provider_completion_recovered", {
        provider: args.provider,
        workerBranch,
        recoveredProviderInvocationId: recoveredProvider.invocation.id,
        recoveredProviderFinishedAt: recoveredProvider.invocation.finishedAt,
      });
      if (args.qaContinuationRunId) {
        const run = this.deps.qaReviewRepository.getRun(args.qaContinuationRunId);
        if (run) {
          this.deps.qaReviewRepository.updateRun(run.id, {
            payload: {
              ...(run.payload || {}),
              continuationProviderStatus: "completed",
              continuationProviderInvocationId: recoveredProvider.invocation.id,
              continuationProviderCompletedAt: recoveredProvider.invocation.finishedAt
                || recoveredProvider.invocation.updatedAt,
              continuationProviderRecovered: true,
            },
          });
        }
      }
    } else {
      this.deps.sessionTracking.appendActivity(args.sessionId, {
        originator: "system",
        description: "Quality assurance requested a follow-up implementation pass.",
      });
      const result = await this.providerExecutionService.executeProvider({
        projectId: args.scope.projectId!,
        sprintId: args.scope.sprintId,
        taskId: args.taskRun?.taskId,
        taskRunId: args.taskRun?.id,
        sprintRunId: args.taskRun?.sprintRunId,
        dispatchId: args.taskRun?.dispatchId,
        purpose: "task_coding",
        type: "cli_task_followup",
        provider: args.provider,
        prompt: providerPrompt,
        cwd: worktreePath,
        ...buildProviderSettingsOverride(effectiveModel, followUpProviderSettings),
        sessionId: args.sessionId,
        workspaceSessionId,
        workflowSettings,
        repoPath: args.repoPath,
        workspaceLifecycle: "continue",
        continueSessionId: previousInvocation?.nativeSessionId
          || (args.provider === "claude-code" || args.provider === "codex" ? null : args.sessionId),
        continueSessionWithoutNativeId: args.provider === "codex"
          && Boolean(previousInvocation)
          && !previousInvocation?.nativeSessionId,
        allowFreshSessionFallback: true,
        // opencode's `export <sessionID>` is cumulative for the whole session, so
        // this follow-up (which resumes the same session) needs the prior
        // invocation's raw snapshot as a baseline to subtract out — otherwise it
        // would re-report every earlier turn's tokens too. See
        // execute-provider-stage.ts for the analogous first-pass wiring.
        openCodeBaselineRawUsageJson: args.provider === "opencode" ? (previousInvocation?.rawUsageJson ?? null) : null,
        agentMcpAccess: workerAgent?.id
          ? workerClarificationAgentMcpAccess(workerAgent.mcpAccess)
          : undefined,
        mcpAgentId: workerAgent?.id ?? null,
      });

      if (!result.ok) {
        this.deps.sessionTracking.updateSession(args.sessionId, { state: "FAILED" });
        throw new Error(result.stderr || result.stdout || "CLI QA follow-up failed.");
      }
      providerOutcome = parseTaskExecutionOutcomeFromProviderOutput({
        conversation: result.usageTelemetry.conversation,
        text: result.text,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      if (args.qaContinuationRunId) {
        const run = this.deps.qaReviewRepository.getRun(args.qaContinuationRunId);
        if (run) {
          const completedInvocation = this.deps.executionRepository
            .getLatestProviderInvocationUsageBySession(args.sessionId, "task_coding");
          this.deps.qaReviewRepository.updateRun(run.id, {
            payload: {
              ...(run.payload || {}),
              continuationProviderStatus: "completed",
              continuationProviderInvocationId: completedInvocation?.status === "completed"
                ? completedInvocation.id
                : undefined,
              continuationProviderCompletedAt: completedInvocation?.status === "completed"
                ? completedInvocation.finishedAt || completedInvocation.updatedAt
                : new Date().toISOString(),
              continuationProviderOutcomeKind: providerOutcome.kind,
              continuationProviderBlocker: providerOutcome.kind === "blocked"
                ? providerOutcome.blocker
                : null,
              continuationProviderRecovered: false,
            },
          });
        }
      }
    }

    if (settings.memory?.enabled && settings.memory.autoCaptureSprint) {
      await this.captureMemoriesFromWorkspace(
        args.scope.projectId!,
        args.scope.sprintId || undefined,
        workerAgent?.id || null,
        worktreePath,
        args.taskRun?.id || args.sessionId,
      );
    }

    const patchText = await this.workspaceArtifactService.exportBinaryPatch(worktreePath, initialHead);
    const applyResult = await this.workspaceArtifactService.applyPatchToBranch({
      repoPath: args.repoPath,
      baseRef: initialHead,
      workerBranch,
      patchText,
      commitMessage: `fix(task ${args.task.id}): address qa review via ${args.provider}`,
      gitAuth,
      gitIdentity: workflowSettings.containerMountGitConfig
        ? undefined
        : {
          name: workflowSettings.containerGitUserName,
          email: workflowSettings.containerGitUserEmail,
      },
      githubMode: settings.git.githubMode,
      allowExistingWorkerBranch: true,
    });

    let hasUnpushed = applyResult.hasChanges;
    let hasAhead = applyResult.hasChanges;
    if (!applyResult.hasChanges) {
      hasUnpushed = await this.prService.hasUnpushedCommits(args.repoPath, workerBranch, args.featureBranch);
      hasAhead = await this.prService.hasWorkerBranchCommitsAgainstFeature(args.repoPath, workerBranch, args.featureBranch);
      if (hasUnpushed && settings.git.githubMode !== "LOCAL") {
        const pushEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(args.repoPath, gitAuth);
        await runCommandStrict(
          "git",
          ["push", "-u", "origin", `refs/heads/${workerBranch}:refs/heads/${workerBranch}`],
          args.repoPath,
          pushEnv ?? process.env,
        );
      }
    }

    // Existing commits/PR state prove that the task has merge work, but they do
    // not prove that this follow-up addressed the latest QA request. Only a
    // patch produced from this invocation counts as continuation progress.
    const previouslyPublishedFromBaseline = !applyResult.hasChanges
      && await this.workerBranchAdvancedFromBaseline(args.repoPath, workerBranch, initialHead);
    const producedMergeWork = applyResult.hasChanges || previouslyPublishedFromBaseline;

    let prUrl = args.task.pr_url || args.taskRun?.prUrl || null;
    if (hasUnpushed || hasAhead) {
      if (settings.git.autoCreatePr && settings.git.githubMode !== "LOCAL") {
        const sprint = args.task.sprint_id ? this.deps.projectManagementRepository.getSprint(args.task.sprint_id) : null;
        const composerInput = buildTaskPrComposerInput({
          projectId: args.scope.projectId!,
          task: args.task,
          sprint,
          provider: args.provider,
          featureBranch: args.featureBranch,
          workerBranch,
          taskRun: args.taskRun ?? null,
          aiProviderSettings: settings.aiProvider,
          sections: settings.git.prDescription.task,
          sectionOrder: settings.git.prDescription.taskSectionOrder,
          executionRepository: this.deps.executionRepository,
        });
        prUrl = (await this.prService.resolveOrCreateFeaturePr(
          {
            taskId: args.task.id,
            provider: args.provider,
            title: formatTaskPrTitle({
              scheme: settings.git.taskPrTitleScheme,
              sprintKeyPrefix: settings.git.sprintKeyPrefix,
              sprint: sprint ?? (args.task.sprint_id ? { id: args.task.sprint_id } : null),
              task: {
                id: args.task.record_id ?? args.task.id,
                taskKey: args.task.id,
                title: args.task.title,
              },
              provider: args.provider,
            }),
            body: composeTaskPrBody(composerInput),
            featureBranch: args.featureBranch,
            workerBranch,
          },
          args.repoPath,
          this.deps.getGithubToken(),
        )) ?? null;
      }
    }

    this.deps.sessionTracking.updateSession(args.sessionId, {
      state: "COMPLETED",
      prUrl: prUrl || undefined,
    });
    if (args.taskRun?.id) {
      // A failed QA continuation can mark the original coding run/dispatch
      // terminal-failed. Once a same-session continuation succeeds, clear that
      // stale projection before terminal sprint evaluation; otherwise the
      // healthy task can still make the whole sprint fail in this cycle.
      this.deps.executionRepository.updateTaskRun(args.taskRun.id, {
        state: "COMPLETED",
      });
      args.taskRun.state = "COMPLETED";
      const executionRepository = this.deps.executionRepository as Partial<ExecutionRepository>;
      if (args.taskRun.dispatchId && typeof executionRepository.updateTaskDispatch === "function") {
        executionRepository.updateTaskDispatch(args.taskRun.dispatchId, {
          status: "completed",
          errorMessage: null,
        });
      }
    }
    if (!producedMergeWork) {
      const blocker = providerOutcome.kind === "blocked" ? providerOutcome.blocker : null;
      this.appendTaskEvent(args.taskRun, "qa_followup_no_progress", {
        provider: args.provider,
        workerBranch,
        blocker,
      });
      args.task.worker_branch = workerBranch;
      args.task.pr_url = prUrl || undefined;
      this.deps.projectManagementRepository.updateTask(args.task.record_id!, {
        status: "coding_completed",
        mergeIndicator: null,
      });
      args.task.status = "CODING_COMPLETED";
      args.task.merge_indicator = undefined;
      if (args.taskRun?.id) {
        args.taskRun.workerBranch = workerBranch;
        args.taskRun.prUrl = prUrl;
        this.deps.executionRepository.updateTaskRun(args.taskRun.id, {
          workerBranch,
          prUrl,
        });
      }
      return { producedMergeWork: false, providerOutcome };
    }
    args.task.worker_branch = workerBranch;
    args.task.pr_url = prUrl || undefined;
    args.task.status = "CODING_COMPLETED";
    args.task.is_merged = false;
    args.task.merge_indicator = undefined;
    if (args.taskRun?.id) {
      args.taskRun.workerBranch = workerBranch;
      args.taskRun.prUrl = prUrl;
      this.deps.executionRepository.updateTaskRun(args.taskRun.id, {
        workerBranch,
        prUrl,
      });
    }
    this.deps.projectManagementRepository.updateTask(args.task.record_id!, {
      status: "coding_completed",
      isMerged: false,
      mergeIndicator: null,
    });
    return { producedMergeWork: true, providerOutcome };
  }

  private resolveQaCodingInvocation(args: {
    provider: CliQaProvider;
    logicalSessionId: string;
    workspaceSessionId: string;
    workspaceTaskRunId: string | null;
  }): ProviderInvocationUsageRecord | null {
    const sessionIds = Array.from(new Set([
      args.logicalSessionId.trim(),
      args.workspaceSessionId.trim(),
    ].filter(Boolean)));
    const candidates = sessionIds
      .map((sessionId) => (
        this.deps.executionRepository.getLatestProviderInvocationUsageBySession(
          sessionId,
          "task_coding",
        )
      ))
      .filter((invocation): invocation is ProviderInvocationUsageRecord => (
        invocation !== null && invocation.provider === args.provider
      ));
    if (candidates.length === 0) {
      return null;
    }
    const byNewest = (left: ProviderInvocationUsageRecord, right: ProviderInvocationUsageRecord) => (
      Date.parse(right.finishedAt || right.updatedAt || right.startedAt)
      - Date.parse(left.finishedAt || left.updatedAt || left.startedAt)
    );
    const exactTaskRun = args.workspaceTaskRunId
      ? candidates
          .filter((invocation) => invocation.taskRunId === args.workspaceTaskRunId)
          .sort(byNewest)[0]
      : null;
    if (exactTaskRun) {
      return exactTaskRun;
    }
    const workspaceOwned = candidates
      .filter((invocation) => (
        invocation.sessionId.replace(/^sessions\//, "") === args.workspaceSessionId.replace(/^sessions\//, "")
      ))
      .sort(byNewest)[0];
    return workspaceOwned || candidates.sort(byNewest)[0] || null;
  }

  private async cleanupCliWorkspaceIfNeeded(task: Subtask, repoPath: string, scope: DashboardSettingsScope): Promise<void> {
    if (task.provider !== "gemini" && task.provider !== "codex" && task.provider !== "claude-code") {
      return;
    }
    const sessionId = task.session_id?.trim();
    if (!sessionId) {
      return;
    }
    const settings = this.deps.getDashboardSettings(scope);
    if (!settings.cliWorkflow.cleanupWorktreeOnSuccess) {
      return;
    }

    const worktreePath = await this.workspaceManager.resolveResumeWorktreePath(
      repoPath,
      sessionId,
      settings.cliWorkflow.executionMode,
    ).catch(() => undefined);
    if (!worktreePath) {
      return;
    }
    await this.workspaceManager.removeWorktree(repoPath, worktreePath).catch(() => undefined);
  }

  private async syncExistingCliFollowUpWorkspace(
    worktreePath: string,
    workerBranch: string,
    repoPath: string,
    gitAuth: GitHttpAuthOptions,
  ): Promise<void> {
    const currentBranch = await this.workspaceManager.resolveCurrentBranch(worktreePath);
    if (currentBranch !== workerBranch) {
      await this.runWorkspaceCommand(worktreePath, "git", ["checkout", workerBranch]);
      const checkedOutBranch = await this.workspaceManager.resolveCurrentBranch(worktreePath);
      if (checkedOutBranch !== workerBranch) {
        throw new Error(
          `Cannot continue CLI QA fixes: workspace ${worktreePath} is on '${checkedOutBranch || "unknown"}' instead of '${workerBranch}'.`,
        );
      }
    }

    // The original task committed and pushed its work to origin/<workerBranch> via a
    // host-side commit-tree/update-ref that never advanced this resumed workspace's
    // HEAD (docker-volume workspaces are independent clones the host ref update cannot
    // reach), so its branch is still parked on the original start ref. Re-point it at
    // the pushed tip so the follow-up diff is computed against the real branch head and
    // the resulting commit fast-forwards on push instead of being rejected as a
    // non-fast-forward.
    await this.workspaceManager
      .fastForwardResumedWorkspace(worktreePath, workerBranch, repoPath, gitAuth)
      .catch(() => undefined);
  }

  private async runWorkspaceCommand(worktreePath: string, command: string, args: string[], env?: NodeJS.ProcessEnv) {
    if (worktreePath.startsWith("docker-volume://")) {
      return this.workspaceManager.runWorkspaceCommand(worktreePath, command, args, { env });
    }
    return runCommandStrict(command, args, worktreePath, env ?? process.env);
  }

  private async workerBranchAdvancedFromBaseline(
    repoPath: string,
    workerBranch: string,
    baselineRef: string,
  ): Promise<boolean> {
    try {
      const currentHead = (await runCommandStrict(
        "git",
        ["rev-parse", `refs/heads/${workerBranch}`],
        repoPath,
      )).stdout.trim();
      if (!currentHead || currentHead === baselineRef) {
        return false;
      }
      await runCommandStrict(
        "git",
        ["merge-base", "--is-ancestor", baselineRef, currentHead],
        repoPath,
      );
      return true;
    } catch {
      return false;
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
      const raw = await this.workspaceManager.readWorkspaceFile(worktreePath, ".task-learnings.md");
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

  private async buildMemoryContext(projectId: string, sprintId: string | null, agentPresetId: string, query: string): Promise<string | undefined> {
    const memoryService = this.deps.memoryService;
    if (!memoryService) {
      return undefined;
    }

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


  private getLatestSprintTaskUpdatedAt(projectId: string, sprintId: string): number {
    const timestamps = this.deps.projectManagementRepository.listTasks(projectId, sprintId)
      .map((task) => Date.parse(task.updatedAt))
      .filter((value) => Number.isFinite(value));
    return timestamps.length > 0 ? Math.max(...timestamps) : 0;
  }

  private isMergedSubtask(task: Subtask): boolean {
    return task.is_merged === true
      || task.merge_indicator === "MERGED"
      || task.merge_indicator === "AUTOMERGE";
  }

  private createSprintFollowUpTasks(args: {
    projectId: string;
    sprintId: string;
    targetTask: Subtask | null;
    fixInstructions: string | null;
    review: NormalizedQaReviewResult;
    existingSubtasks: Subtask[];
    sourceRunId: string;
  }) {
    const existing = this.deps.projectManagementRepository
      .listTasks(args.projectId, args.sprintId)
      .filter((task) => task.sourceType === "qa_review" && task.sourcePath === args.sourceRunId);
    if (existing.length > 0) {
      return existing;
    }

    const tasksToCreate = args.review.followUpTasks.length > 0
      ? args.review.followUpTasks
      : (!args.targetTask && !args.fixInstructions)
        ? []
        : [{
          title: args.targetTask ? `QA follow-up for ${args.targetTask.id}` : "Sprint QA follow-up",
          promptMarkdown: args.fixInstructions || args.review.summary,
          description: args.review.summary,
          dependsOnTaskKeys: [] as string[],
          priority: "high" as TaskPriority,
        }];

    if (tasksToCreate.length === 0) {
      return [];
    }

    const dependencyTaskIdByKey = new Map(
      args.existingSubtasks
        .filter((task) => typeof task.record_id === "string" && task.record_id.trim().length > 0)
        .map((task) => [task.id, task.record_id!.trim()]),
    );

    return tasksToCreate.map((taskInput) => this.deps.projectManagementRepository.createTask(args.projectId, {
      sprintId: args.sprintId,
      title: taskInput.title,
      promptMarkdown: taskInput.promptMarkdown,
      description: taskInput.description || args.review.summary,
      status: "pending",
      priority: taskInput.priority,
      dependsOnTaskIds: taskInput.dependsOnTaskKeys
        .map((taskKey) => dependencyTaskIdByKey.get(taskKey))
        .filter((taskId): taskId is string => typeof taskId === "string"),
      isIndependent: taskInput.dependsOnTaskKeys.length === 0,
      sourceType: "qa_review",
      sourcePath: args.sourceRunId,
    }));
  }
}

function buildReviewScopeInstructions(triggerType: QaReviewTriggerType, currentTask: Subtask | null): string {
  if (triggerType === "sprint_completion") {
    return [
      "- This is a full sprint review. Evaluate the combined sprint outcome against the sprint goal and all task instructions.",
      "- You may request fixes for cross-task integration issues, missing sprint deliverables, or regressions that affect the completed sprint.",
      "- Use `targetTaskKey` or `followUpTasks` to route required work according to the output rules.",
    ].join("\n");
  }

  const currentTaskKey = currentTask?.id || "the current task";
  const dependencyList = currentTask?.depends_on?.length ? currentTask.depends_on.join(", ") : "none";

  return [
    `- This is a single-task QA review. The only task under review is ${currentTaskKey}.`,
    "- `PREVIOUSLY COMPLETED SPRINT TASKS` contains title-only historical context. Those sibling tasks are not deliverables for this review.",
    "- The complete current-task details, prompt, dependencies, and recent activity are provided in `CURRENT TASK UNDER REVIEW`.",
    "- Assume the current workspace/branch contains only the current task's changes on top of its base branch. Independent sibling tasks may be completed in separate branches or PRs and may be absent here.",
    "- A task-level review must pass when the current task satisfies its own prompt, even if other completed sprint tasks are not present in this branch.",
    "- Do not request changes because files, commits, PRs, or behavior from other completed sibling tasks are missing from this branch.",
    "- Do not tell the coding session to implement, restore, or modify another task's scope.",
    "- Compare the implementation against the current task prompt, its declared scope, and regressions directly introduced by the current task.",
    `- Current task dependencies: ${dependencyList}. Use dependencies only to understand the current task contract; do not require unrelated sibling task deliverables.`,
    "- If changes are required, write `fixInstructions` only for the current task's coding session and set `targetTaskKey` to the current task key.",
  ].join("\n");
}

function triggerReviewModeDescription(triggerType: QaReviewTriggerType): string {
  switch (triggerType) {
    case "completed_task_without_pr":
      return "Review a completed task with no PR and decide whether a PR should exist.";
    case "sprint_completion":
      return "Review the full sprint for integration quality before final completion.";
    case "task_completion":
    default:
      return "Review a completed task for correctness, completeness, and integration quality.";
  }
}

function renderQaPassReport(taskKey: string, summary: string): string {
  return `\nQA passed for \`${taskKey}\`: ${summary}\n`;
}

function renderQaChangesRequestedReport(taskKey: string, summary: string, continued: boolean): string {
  return `\nQA requested follow-up for \`${taskKey}\`${continued ? " and resumed the task session" : ""}: ${summary}\n`;
}

function renderQaReviewFailedReport(taskKey: string, error: unknown): string {
  const summary = error instanceof Error ? error.message : String(error);
  return `\nQA review failed for \`${taskKey}\` and must retry before merge: ${summary}\n`;
}

function renderSprintQaPassReport(summary: string): string {
  return `\nSprint QA passed: ${summary}\n`;
}

function renderSprintQaChangesRequestedReport(
  summary: string,
  targetTaskKey: string | null,
  continued: boolean,
  createdTaskKeys: string[],
): string {
  const target = targetTaskKey ? ` Target task: \`${targetTaskKey}\`.` : "";
  const created = createdTaskKeys.length > 0
    ? ` Created follow-up tasks: ${createdTaskKeys.map((taskKey) => `\`${taskKey}\``).join(", ")}.`
    : "";
  return `\nSprint QA requested follow-up${continued ? " and resumed the selected task session." : "."}${target}${created} ${summary}\n`;
}

function renderSprintQaPendingReport(run: QaReviewRunRecord): string {
  const summary = run.summaryMarkdown?.trim();
  if (run.status === "running") {
    return "\nSprint QA is still running. Main merge remains blocked until the review finishes.\n";
  }
  if (run.outcome === "changes_requested") {
    return `\nSprint QA is still waiting on follow-up work before merge.${summary ? ` ${summary}` : ""}\n`;
  }
  return `\nSprint QA must be retried before merge.${summary ? ` ${summary}` : ""}\n`;
}

function renderSprintQaBudgetExhaustedReport(maxRuns: number): string {
  return `\nSprint QA used all ${maxRuns} configured review cycles. No additional automatic follow-up tasks were created; human review is required.\n`;
}

function renderSprintQaFailedReport(error: unknown): string {
  const summary = error instanceof Error ? error.message : String(error);
  return `\nSprint QA failed and blocked merge: ${summary}\n`;
}
