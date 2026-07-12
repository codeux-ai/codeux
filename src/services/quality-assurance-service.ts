import { randomUUID } from "node:crypto";
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
import { withResolvedGitSettingsCredentials } from "./credentials/git-settings-credential-resolver.js";
import { evaluateQaReviewBudget, isRecoveredStaleQaRun } from "../domain/qa-review/qa-review-budget.js";
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
  settingsCredentialResolver?: import("./credentials/settings-credential-resolver.js").SettingsCredentialResolver;
}

export class QualityAssuranceService {
  private readonly workspaceManager = new WorkspaceManager();
  private readonly invocationWorkspacePreparer: InvocationWorkspacePreparer;
  private readonly workspaceArtifactService = new WorkspaceArtifactService(this.workspaceManager);

  private readonly prService = new PrService();

  private readonly providerExecutionService: ProviderExecutionService;
  private readonly structuredAgentRequestService: StructuredAgentRequestService;

  constructor(private readonly deps: QualityAssuranceServiceDependencies) {
    this.invocationWorkspacePreparer = new InvocationWorkspacePreparer(
      this.workspaceManager,
      deps.settingsCredentialResolver,
    );
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
      settingsCredentialResolver: deps.settingsCredentialResolver,
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
      await withResolvedGitSettingsCredentials({
        resolver: this.deps.settingsCredentialResolver,
        projectId: scope.projectId,
        repoPath,
        consumer: "git.qa.remote-refresh",
        git: settings.git,
      }, async (auth) => await syncRemoteBranchIfAvailable(repoPath, branch, auth));
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
    const taskRun = this.resolveTaskRunForSubtask(args.task, args.sprintRunId);

    const requests = await buildQaReviewRequests({
      task: args.task,
      taskRun,
      project: this.deps.projectManagementRepository.getProject(args.projectId) || null,
      sprint: this.deps.projectManagementRepository.getSprint(args.sprintId) || null,
      sprintRunId: args.sprintRunId || null,
      settings,
      budgetArgs: {
        existingRuns,
        decisiveRuns,
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

    const project = this.deps.projectManagementRepository.getProject(args.projectId);
    const sprint = this.deps.projectManagementRepository.getSprint(args.sprintId);
    if (!project || !sprint) {
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }

    const triggerType = requests[0]!.triggerType;
    const sprintFeatureBranch = requests[0]!.sprintFeatureBranch;
    const runIndex = existingRuns + 1;

    const runs = requests.map((request) => {
      const run = this.deps.qaReviewRepository.createRun(request.runPayload);
      // Signal that the task has entered the QA stage so the live view advances
      // from coding-completed → QA and starts timing the review immediately
      // (the review itself can take minutes). Persisting the QA_PENDING indicator
      // makes the stage tag, boat race and stats reflect QA for the whole review,
      // not just the event-derived stage timeline.
      this.appendTaskEvent(taskRun, "qa_review_started", {
        triggerType: request.triggerType,
        qaReviewRunId: run.id,
        runIndex,
        agentPresetId: request.agentPresetId,
        agentName: request.agentName,
      });
      return { request, run };
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

    for (const { request, run } of runs) {
      let resolvedReview: NormalizedQaReviewResult | undefined;
      let caughtError: unknown;

      try {
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
            ...run.payload,
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
            ...run.payload,
            ...resolvedReview!.raw,
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
            ...run.payload,
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
          ...run.payload,
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
      const qaDecisionFinishedAt = new Date().toISOString();
      let continued: QaFixContinuationResult;
      try {
        continued = changesIntent.fixInstructions
          ? await this.requestFixesForTask({
            task: args.task,
            taskRun,
            repoPath: args.repoPath,
            featureBranch: sprintFeatureBranch,
            scope,
            prompt: changesIntent.fixInstructions,
          })
          : { applied: false, mode: "none" as const, noProgress: false, blocker: null };
      } catch (error) {
        this.deps.qaReviewRepository.updateRun(changesRequested.run.id, {
          payload: {
            ...changesRequested.run.payload,
            ...changesRequested.resolvedReview!.raw,
            continued: false,
            continuationMode: "failed",
            continuationError: error instanceof Error ? error.message : String(error),
          },
          finishedAt: qaDecisionFinishedAt,
        });
        throw error;
      }

      this.deps.qaReviewRepository.updateRun(changesRequested.run.id, {
        payload: {
          ...changesRequested.run.payload,
          ...changesRequested.resolvedReview!.raw,
          continued: continued.applied,
          continuationMode: continued.mode,
          followUpNoProgress: continued.noProgress,
          followUpBlocker: continued.blocker,
          postExhaustionVerificationEligible: continued.applied
            && decisiveRuns + 1 === qaSettings.maxTaskReviewRuns,
        },
        finishedAt: qaDecisionFinishedAt,
      });

      if (continued.noProgress) {
        this.deps.projectManagementRepository.updateTask(taskId, {
          status: "coding_completed",
          mergeIndicator: null,
        });
        args.task.status = "CODING_COMPLETED";
      } else if (continued.applied) {
        this.deps.projectManagementRepository.updateTask(taskId, {
          status: "in_progress",
          ...MERGE_PROJECTION_RESET,
        });
        args.task.status = "RUNNING";
      } else {
        this.deps.projectManagementRepository.updateTask(taskId, {
          status: "pending",
          ...MERGE_PROJECTION_RESET,
        });
        args.task.status = "PENDING";
      }
      // Re-entering the coding stage: drop any stale CI / QA / MERGED indicator.
      clearMergeProjectionForRerun(args.task);

      this.appendTaskEvent(taskRun, "qa_review_changes_requested", {
        triggerType: changesRequested.request.triggerType,
        summary: changesIntent.summary,
        findings: changesRequested.resolvedReview!.findings,
        fixInstructions: changesIntent.fixInstructions,
        qaReviewRunId: changesRequested.run.id,
        continued: continued.applied,
        continuationMode: continued.mode,
        followUpNoProgress: continued.noProgress,
        followUpBlocker: continued.blocker,
        postExhaustionVerificationEligible: continued.applied
          && decisiveRuns + 1 === qaSettings.maxTaskReviewRuns,
        agentPresetId: changesRequested.request.agentPresetId,
        agentName: changesRequested.request.agentName,
      });

      return {
        reviewed: true,
        reopenedTask: true,
        mergeBlocked: true,
        reportText: renderQaChangesRequestedReport(args.task.id, changesIntent.summary, continued.applied),
      };
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
    const runningRuns = args.tasks
      .map((task) => task.record_id?.trim())
      .filter((taskId): taskId is string => Boolean(taskId))
      .flatMap((taskId) => this.deps.qaReviewRepository.listLatestTaskCycleRuns(taskId))
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

    if (sprintQaDecision.action === "skip_review") {
      return { reviewed: false, blockedCompletion: false, mergeBlocked: false, reportText: "" };
    }

    if (sprintQaDecision.action === "block_completion") {
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

    const sprintPresetIds = Array.isArray(qaSettings.sprintCompletion.agentPresetIds)
      && qaSettings.sprintCompletion.agentPresetIds.length > 0
      ? qaSettings.sprintCompletion.agentPresetIds
      : [null];
    const latestHistoricalRunIndex = historicalLatestRuns.reduce((maxRunIndex, run) => {
      return Math.max(maxRunIndex, typeof run.runIndex === "number" ? run.runIndex : 0);
    }, 0);
    const runIndex = Math.max(latestRun?.runIndex || 0, latestHistoricalRunIndex) + 1;
    const sprintReviewResults: Array<{
      agentPresetId: string;
      agentName: string;
      run: QaReviewRunRecord;
      review?: NormalizedQaReviewResult;
      error?: unknown;
    }> = [];

    for (const configuredAgentPresetId of sprintPresetIds) {
      const agent = await this.deps.agentPresetSyncService.resolveTargetedQualityAssuranceAgent(
        args.projectId,
        configuredAgentPresetId,
      );
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
        },
      });

      try {
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
              ...run.payload,
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
            ...run.payload,
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
            ...run.payload,
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
      const continued = canApplyAutomaticFollowUp && targetTask && fixInstructions && canContinueTargetTask
        ? await this.requestFixesForTask({
          task: targetTask,
          taskRun: targetTaskRun,
          repoPath: args.repoPath,
          featureBranch: sprintFeatureBranch,
          scope,
          prompt: fixInstructions,
        })
        : { applied: false, mode: "none" as const };
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
        targetTaskKey: targetTask?.id || review.targetTaskKey,
        targetSessionId: targetTask?.session_id || null,
        targetProvider: targetTask?.provider || null,
        payload: {
          ...changesRequested.run.payload,
          ...review.raw,
          continued: continued.applied,
          continuationMode: continued.mode,
          continuationSkippedReason: !canApplyAutomaticFollowUp
            ? "sprint_qa_retry_budget_exhausted"
            : targetTask && fixInstructions && !canContinueTargetTask
              ? "target_task_already_merged"
              : undefined,
          automaticFollowUpSuppressedReason: canApplyAutomaticFollowUp
            ? undefined
            : "sprint_qa_retry_budget_exhausted",
          createdFollowUpTaskKeys: createdFollowUpTasks.map((task) => task.taskKey),
          taskSnapshot: currentTaskSnapshot,
        },
        finishedAt: new Date().toISOString(),
      });

      if (continued.applied && targetTask?.record_id) {
        this.deps.projectManagementRepository.updateTask(targetTask.record_id, {
          status: "in_progress",
          ...MERGE_PROJECTION_RESET,
        });
        targetTask.status = "RUNNING";
        // Re-entering the coding stage: drop any stale CI / QA / MERGED indicator.
        clearMergeProjectionForRerun(targetTask);
      }

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
          continued.applied,
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
      const route = this.deps.taskService.resolveInvocationProvider("qa_review", pseudoTask, {
        scope: args.scope,
        cliOnly: true,
      });
      const provider = route.provider as CliQaProvider;
      const providerConfigId = route.providerConfigId || route.provider;
      const providerSettings = route.providers[providerConfigId];

      const memoryContext = args.agentPresetId
        ? await this.buildMemoryContext(args.scope.projectId!, args.scope.sprintId || null, args.agentPresetId, args.sprintGoal)
        : undefined;
      const prompt = this.buildReviewPrompt({
        ...args,
        memoryContext,
      });
      const providerPrompt = buildProviderPrompt(prompt, providerSettings.thinkingMode, provider);
      const settings = this.deps.getDashboardSettings(args.scope);
      const workflowSettings = {
        ...DEFAULT_CLI_WORKFLOW_SETTINGS,
        ...settings.cliWorkflow,
      };
      const gitPolicy = buildInvocationGitPolicy({
        githubMode: settings.git.githubMode,
        defaultBranch: settings.git.defaultBranch,
        projectId: args.scope.projectId,
        workspaceId: `${args.scope.projectId || "project"}-qa-snapshot`,
        githubToken: settings.git.githubToken,
        gitlabToken: settings.git.gitlabToken,
        githubTokenCredentialRef: settings.git.githubTokenCredentialRef,
        gitlabTokenCredentialRef: settings.git.gitlabTokenCredentialRef,
      });
      const snapshotSessionId = `qa-review-${provider}-${randomUUID()}`;
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
        snapshotWorkspace = await this.invocationWorkspacePreparer.createSnapshotWorkspace({
          repoPath: args.repoPath,
          sessionId: snapshotSessionId,
          checkout: invocationWorkspace.snapshotCheckout,
          gitPolicy: invocationWorkspace.gitPolicy,
        });
        shouldCleanupSnapshot = true;
      } else if (args.reviewBranch) {
        // QA must inspect the requested worker/feature branch in HOST mode too.
        // The visible repository normally remains on the default branch, which
        // otherwise turns every QA check into a false missing-file rejection.
        snapshotWorkspace = await this.invocationWorkspacePreparer.createHostSnapshotWorkspace({
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
          ...buildProviderSettingsOverride(providerSettings.model, providerSettings),
          providerPrompt,
          repoPath: args.repoPath,
          cwd: snapshotWorkspace,
          workspaceSessionId: `${args.scope.projectId || "project"}-qa-snapshot`,
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
          systemRoutingMessage: args.agentInstructions.trim(),
          agentMcpAccess: args.agentPresetId
            ? this.deps.agentPresetRepository?.getAgentPreset(args.agentPresetId)?.mcpAccess ?? null
            : undefined,
          mcpAgentId: args.agentPresetId,
          onActivity: () => {
            this.touchSprintRunHeartbeat(args.sprintRunId, args.scope.sprintId);
          },
        });
      } catch (error) {
        throw parseQaError(error);
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
        if (shouldCleanupSnapshot) {
          await this.workspaceManager.removeWorktree(args.repoPath, snapshotWorkspace).catch(() => undefined);
        }
      }

      return result.parsed;
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
      finishedAt: recoveryDecision.finishedAt,
    });
  }

  private findLatestQaExecutionInvocation(run: QaReviewRunRecord): ExecutionInvocationRecord | null {
    const executionRepository = this.deps.executionRepository as Partial<ExecutionRepository>;
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
    const fullTaskInstructionsHeading = isTaskLevelReview
      ? "## FULL TASK INSTRUCTIONS (SPRINT CONTEXT; ONLY CURRENT TASK IS UNDER REVIEW)"
      : "## FULL TASK INSTRUCTIONS";
    const fullTaskContextSections = args.subtasks.map((task) => [
      `### ${task.id}: ${task.title}`,
      `Status: ${task.status || "unknown"}`,
      `Provider: ${task.provider || "unknown"}`,
      `Worker branch: ${task.worker_branch || "none"}`,
      `PR URL: ${task.pr_url || "none"}`,
      `Depends on: ${task.depends_on.length > 0 ? task.depends_on.join(", ") : "none"}`,
      "",
      "Instruction:",
      task.prompt || "No task instruction provided.",
      "",
      "Recent activity excerpts:",
      this.renderActivityExcerpt(task),
    ].join("\n"));

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
      "## SPRINT TASKS",
      args.subtasks.map((task) => (
        `- [${task.status || "unknown"}] ${task.id}: ${task.title} | provider=${task.provider || "unknown"} | branch=${task.worker_branch || "none"} | pr=${task.pr_url || "none"}`
      )).join("\n"),
      "",
      fullTaskInstructionsHeading,
      fullTaskContextSections.join("\n\n"),
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

  private async requestFixesForTask(args: {
    task: Subtask;
    taskRun: TaskRunRecord | null;
    repoPath: string;
    featureBranch: string;
    scope: DashboardSettingsScope;
    prompt: string;
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
    });
    return {
      applied: result.producedMergeWork,
      mode: "cli",
      noProgress: !result.producedMergeWork,
      blocker: result.providerOutcome.kind === "blocked" ? result.providerOutcome.blocker : null,
    };
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
  }, resolvedGitAuth?: GitHttpAuthOptions): Promise<CliQaFollowUpResult> {
    const settings = this.deps.getDashboardSettings(args.scope);
    if (!resolvedGitAuth && settings.git.githubMode === "REMOTE") {
      return await withResolvedGitSettingsCredentials({
        resolver: this.deps.settingsCredentialResolver,
        projectId: args.scope.projectId,
        workspaceId: args.sessionId,
        repoPath: args.repoPath,
        consumer: "git.qa.continuation",
        git: settings.git,
      }, async (auth) => await this.continueCliTaskSession(args, auth));
    }
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...settings.cliWorkflow,
    };
    const gitAuth: GitHttpAuthOptions = {
      githubToken: resolvedGitAuth?.githubToken ?? settings.git.githubToken,
      gitlabToken: resolvedGitAuth?.gitlabToken ?? settings.git.gitlabToken,
    };
    const gitPolicy = buildInvocationGitPolicy({
      githubMode: settings.git.githubMode,
      defaultBranch: settings.git.defaultBranch,
      projectId: args.scope.projectId,
      workspaceId: args.sessionId,
      githubToken: gitAuth.githubToken,
      gitlabToken: gitAuth.gitlabToken,
    });
    const {
      worktreePath,
      hasPreservedWorkspace,
      currentBranch: resolvedWorkspaceBranch,
    } = await this.invocationWorkspacePreparer.resolveContinuationWorkspace({
      repoPath: args.repoPath,
      sessionId: args.sessionId,
      executionMode: workflowSettings.executionMode,
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
          const remoteRes = await client.gitRemoteUrl("origin", gitAuth.githubToken || undefined);
          const remoteUrl = remoteRes.ok ? remoteRes.stdout.trim() : null;
          const { provider, hostDomain, repoTarget } = resolveRepositoryHost(remoteUrl);
          const hostTokens = {
            githubToken: gitAuth.githubToken,
            gitlabToken: gitAuth.gitlabToken,
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
    const previousInvocation = this.deps.executionRepository.getLatestProviderInvocationUsageBySession(args.sessionId, "task_coding");
    const initialHead = (await this.runWorkspaceCommand(worktreePath, "git", ["rev-parse", "HEAD"])).stdout.trim();
    this.deps.sessionTracking.updateSession(args.sessionId, { state: "RUNNING" });
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
      workflowSettings,
      repoPath: args.repoPath,
      continueSessionId: previousInvocation?.nativeSessionId || (args.provider === "claude-code" ? null : args.sessionId),
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
      this.deps.projectManagementRepository.updateTask(args.task.record_id!, {
        status: "pending",
      });
      this.deps.sessionTracking.updateSession(args.sessionId, { state: "FAILED" });
      throw new Error(result.stderr || result.stdout || "CLI QA follow-up failed.");
    }
    const providerOutcome = parseTaskExecutionOutcomeFromProviderOutput({
      conversation: result.usageTelemetry.conversation,
      text: result.text,
      stdout: result.stdout,
      stderr: result.stderr,
    });

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
    const producedMergeWork = applyResult.hasChanges;

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
          gitAuth,
        )) ?? null;
      }
    }

    this.deps.sessionTracking.updateSession(args.sessionId, {
      state: "COMPLETED",
      prUrl: prUrl || undefined,
    });
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
      await this.runWorkspaceCommand(worktreePath, "git", ["checkout", workerBranch]).catch(() => undefined);
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
    "- Treat `SPRINT TASKS` and non-current entries in `FULL TASK INSTRUCTIONS` as context only, not as deliverables for this review.",
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
