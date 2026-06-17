import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS } from "./cli-workflow-utils.js";
import { extractJsonFromText } from "../domain/llm/json-extraction.js";
import { StructuredAgentRequestService } from "./structured-agent-request-service.js";
import { StructuredProviderResponseService } from "./structured-provider-response-service.js";
import { WorkspaceManager } from "../infrastructure/providers/cli/workspace-manager.js";
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
import type { MemoryService } from "./memory-service.js";
import { syncRemoteBranchIfAvailable } from "./git-branch-sync-service.js";
import {
  QA_INFRA_FAILURE_GRACE,
  RECOVERED_STALE_QA_SUMMARY_PREFIX,
  evaluateQaReviewBudget,
  isRecoveredStaleQaRun
} from "../domain/qa-review/qa-review-budget.js";

import { parseQaError, type QaReviewError } from "../domain/qa-review/qa-review-types.js";
import { normalizeQaReviewResult } from "../domain/qa-review/qa-review-result-normalizer.js";
import type { NormalizedQaReviewResult } from "../domain/qa-review/qa-review-types.js";

import { clearMergeProjectionForRerun, MERGE_PROJECTION_RESET } from "../domain/sprint/task-reset-state.js";

type CliQaProvider = Exclude<ProviderId, "jules">;

const SPRINT_RUN_KEEPALIVE_MS = 30_000;
const SPRINT_LEASE_EXTENSION_MS = 5 * 60 * 1000;
const QA_RUN_START_TIMEOUT_MS = 60_000;
/**
 * How many extra QA attempts beyond `maxTaskReviewRuns` we tolerate when the
 * reviewer keeps failing for infrastructure reasons (auth/config/container).
 * Infra failures don't consume the verdict budget (see
 * {@link QaReviewRepository.countDecisiveTaskRuns}), but a permanently broken
 * reviewer must still stop retrying eventually and escalate the task to a human
 * (QA_REVIEW_FAILED) rather than loop forever or — worse — fail open.
 */

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

export interface TaskQaMergeGateStatus {
  mergeAllowed: boolean;
  reason: "not_required" | "pending_review" | "review_running" | "passed" | "changes_requested" | "review_failed" | "retries_exhausted";
  summary: string;
  latestRun: QaReviewRunRecord | null;
  runsUsed: number;
  maxRuns: number;
}

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
  structuredAgentRequestService?: StructuredAgentRequestService;
  dockerService?: Pick<{ listContainers: () => Promise<DockerContainer[]> }, "listContainers">;
}

export class QualityAssuranceService {
  private readonly workspaceManager = new WorkspaceManager();
  private readonly workspaceArtifactService = new WorkspaceArtifactService(this.workspaceManager);

  private readonly prService = new PrService();

  private readonly providerExecutionService: ProviderExecutionService;
  private readonly structuredAgentRequestService: StructuredAgentRequestService;

  constructor(private readonly deps: QualityAssuranceServiceDependencies) {
    this.providerExecutionService = new ProviderExecutionService({
      executionRepository: deps.executionRepository,
      providerRunner: deps.providerRunner,
      providerConcurrencyService: deps.providerConcurrencyService,
      logger: deps.logger,
      sessionTracking: deps.sessionTracking,
      getGithubToken: deps.getGithubToken,
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

    const triggerType = this.resolveTaskTriggerType(args.task, qaSettings);
    if (!triggerType) {
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }

    const existingRuns = this.deps.qaReviewRepository.countTaskRuns(taskId);
    const decisiveRuns = this.deps.qaReviewRepository.countDecisiveTaskRuns(taskId);
    const latestRun = this.deps.qaReviewRepository.getLatestTaskRun(taskId);
    // The budget is spent once we have enough real verdicts, or once total
    // attempts (including reviewer infra crashes) hit the infra ceiling. Until
    // then, keep retrying — a reviewer that crashed on auth/config produced no
    // verdict and the task still needs reviewing before it can merge.
    const budget = evaluateQaReviewBudget({
      existingRuns,
      decisiveRuns,
      maxTaskReviewRuns: qaSettings.maxTaskReviewRuns,
      latestRun,
    });
    if (!budget.allowed) {
      await this.cleanupCliWorkspaceIfNeeded(args.task, args.repoPath, scope);
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }

    // Separate per-task QA guardrail (independent of the QA agent's own maxTaskReviewRuns).
    const qaGuardrail = this.deps.guardrailService.evaluateQa(scope, taskId);
    if (!qaGuardrail.allowed && qaGuardrail.action !== "WARN_ONLY") {
      await this.cleanupCliWorkspaceIfNeeded(args.task, args.repoPath, scope);
      this.deps.logger?.info("QA review skipped: guardrail cap reached", {
        taskId,
        count: qaGuardrail.count,
        cap: qaGuardrail.cap,
      });
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }

    const taskRun = this.resolveTaskRunForSubtask(args.task, args.sprintRunId);
    const project = this.deps.projectManagementRepository.getProject(args.projectId);
    const sprint = this.deps.projectManagementRepository.getSprint(args.sprintId);
    if (!project || !sprint) {
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }

    const sprintFeatureBranch = sprint.featureBranch?.trim()
      || `${settings.git.featureBranchPrefix || "feature/"}sprint-${sprint.number ?? 0}`;

    const agentPresetId = triggerType === "completed_task_without_pr"
      ? qaSettings.completedTaskWithoutPr.agentPresetId
      : qaSettings.taskCompletion.agentPresetId;
    const agent = await this.deps.agentPresetSyncService.resolveTargetedQualityAssuranceAgent(args.projectId, agentPresetId);

    const memoryInstructions = resolveAgentMemoryInstructions(
      agent,
      settings.memory?.workerLearningsInstruction
    );
    let agentInstructions = agent.instructionMarkdown + (memoryInstructions ? `\n\n### Memory Capture Instructions\n${memoryInstructions}` : "");

    const run = this.deps.qaReviewRepository.createRun({
      projectId: args.projectId,
      sprintId: args.sprintId,
      sprintRunId: args.sprintRunId || null,
      taskId,
      taskRunId: taskRun?.id || null,
      triggerType,
      runIndex: existingRuns + 1,
      agentPresetId: agent.id,
      agentName: agent.name,
      targetTaskKey: args.task.id,
      targetSessionId: args.task.session_id || null,
      targetProvider: args.task.provider || null,
      payload: {
        taskKey: args.task.id,
        runIndex: existingRuns + 1,
      },
    });

    // Record the QA invocation against the per-task guardrail ledger.
    this.deps.guardrailService.record(scope, taskId, "qa_review");

    // Signal that the task has entered the QA stage so the live view advances
    // from coding-completed → QA and starts timing the review immediately
    // (the review itself can take minutes). Persisting the QA_PENDING indicator
    // makes the stage tag, boat race and stats reflect QA for the whole review,
    // not just the event-derived stage timeline.
    this.appendTaskEvent(taskRun, "qa_review_started", {
      triggerType,
      qaReviewRunId: run.id,
      runIndex: existingRuns + 1,
    });
    this.setTaskQaPending(args.task, true);

    try {
      const review = await this.runReview({
        triggerType,
        scope,
        projectName: project.name,
        sprintGoal: sprint.goal || "",
        repoPath: args.repoPath,
        agentInstructions: agentInstructions,
        subtasks: args.subtasks,
        currentTask: args.task,
        taskRun,
        sprintRunId: args.sprintRunId || null,
        agentPresetId: agent.id,
        // Task QA reviews the task's own feature/worker branch, falling back to
        // the sprint base branch when the worker branch metadata is missing.
        reviewBranch: args.task.worker_branch?.trim()
          || taskRun?.workerBranch?.trim()
          || sprintFeatureBranch,
        baseBranch: sprintFeatureBranch,
      });

      if (review.verdict === "pass" || (triggerType === "completed_task_without_pr" && review.shouldHavePr === false)) {
        this.deps.qaReviewRepository.updateRun(run.id, {
          status: "completed",
          outcome: "pass",
          summaryMarkdown: review.summary,
          payload: review.raw,
          finishedAt: new Date().toISOString(),
        });
        this.appendTaskEvent(taskRun, "qa_review_passed", {
          triggerType,
          summary: review.summary,
          findings: review.findings,
          qaReviewRunId: run.id,
        });
        // QA cleared — drop the QA_PENDING indicator so the merge gate can
        // recompute the task's resting stage (CI / automerge / completed).
        this.setTaskQaPending(args.task, false);
        await this.cleanupCliWorkspaceIfNeeded(args.task, args.repoPath, scope);
        return {
          reviewed: true,
          reopenedTask: false,
          mergeBlocked: false,
          reportText: renderQaPassReport(args.task.id, review.summary),
        };
      }

      const fixInstructions = review.fixInstructions
        || (triggerType === "completed_task_without_pr" && review.shouldHavePr
          ? "A feature PR is still required for this task. Ensure the branch contains the intended changes, push any missing commits, and create or update the feature PR so Code UX can track the work correctly."
          : null);

      const continued = fixInstructions
        ? await this.requestFixesForTask({
          task: args.task,
          taskRun,
          repoPath: args.repoPath,
          featureBranch: sprintFeatureBranch,
          scope,
          prompt: fixInstructions,
        })
        : { applied: false, mode: "none" as const };

      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "completed",
        outcome: "changes_requested",
        summaryMarkdown: review.summary,
        fixInstructions,
        payload: {
          ...review.raw,
          continued: continued.applied,
          continuationMode: continued.mode,
        },
        finishedAt: new Date().toISOString(),
      });

      if (continued.applied) {
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
        triggerType,
        summary: review.summary,
        findings: review.findings,
        fixInstructions,
        qaReviewRunId: run.id,
        continued: continued.applied,
        continuationMode: continued.mode,
      });

      return {
        reviewed: true,
        reopenedTask: true,
        mergeBlocked: true,
        reportText: renderQaChangesRequestedReport(args.task.id, review.summary, continued.applied),
      };
    } catch (error) {
      const qaError = parseQaError(error);
      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "failed",
        summaryMarkdown: qaError.message,
        payload: {
          error_code: qaError.code,
        },
        finishedAt: new Date().toISOString(),
      });
      this.appendTaskEvent(taskRun, "qa_review_failed", {
        triggerType,
        error: qaError.message,
        error_code: qaError.code,
        qaReviewRunId: run.id,
      });
      // Drop the QA_PENDING indicator; the merge gate re-derives the blocked
      // state from the failed run on the next cycle.
      this.setTaskQaPending(args.task, false);
      this.deps.logger?.warn("Task QA review failed", {
        projectId: args.projectId,
        sprintId: args.sprintId,
        taskId,
        triggerType,
        error: qaError.message,
        error_code: qaError.code,
      });
      return {
        reviewed: false,
        reopenedTask: false,
        mergeBlocked: qaError.isRetryable && (existingRuns + 1 < qaSettings.maxTaskReviewRuns),
        reportText: renderQaReviewFailedReport(args.task.id, error),
      };
    }
  }

  async reconcileRunningTaskQaReviews(args: {
    projectId: string;
    sprintId: string;
    tasks: Subtask[];
  }): Promise<void> {
    const runningRuns = args.tasks
      .map((task) => task.record_id?.trim())
      .filter((taskId): taskId is string => Boolean(taskId))
      .map((taskId) => this.deps.qaReviewRepository.getLatestTaskRun(taskId))
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

    const sprintFeatureBranch = sprint.featureBranch?.trim()
      || `${settings.git.featureBranchPrefix || "feature/"}sprint-${sprint.number ?? 0}`;

    const latestRun = this.reconcileRunningQaRun(this.deps.qaReviewRepository.getLatestSprintRun(args.sprintId));
    const maxRuns = qaSettings.maxTaskReviewRuns;
    const latestTaskSnapshot = readSprintQaSnapshot(latestRun);
    const currentTaskSnapshot = buildSprintQaSnapshot(args.subtasks);
    const latestTaskUpdatedAt = this.getLatestSprintTaskUpdatedAt(args.projectId, args.sprintId);
    const latestRunFinishedAtMs = latestRun?.finishedAt ? Date.parse(latestRun.finishedAt) : Number.NaN;
    const hasTaskUpdatesSinceLatestRun = latestRun
      ? !Number.isFinite(latestRunFinishedAtMs) || latestTaskUpdatedAt > latestRunFinishedAtMs
      : true;
    const hasMeaningfulChangesSinceLatestRun = latestRun
      ? (latestTaskSnapshot
        ? latestTaskSnapshot !== currentTaskSnapshot
        : hasTaskUpdatesSinceLatestRun)
      : true;
    const recoveredStaleLatestRun = isRecoveredStaleQaRun(latestRun);
    // Only count the budget as exhausted when the latest run actually produced a
    // verdict (`completed`) at/over the cap. A reviewer that crashed for infra
    // reasons (`failed`) yielded no judgement and must not let the sprint settle
    // as reviewed — fall through so it is retried or held instead.
    const retriesExhausted = typeof latestRun?.runIndex === "number"
      && latestRun.runIndex >= maxRuns
      && latestRun.status === "completed";

    if (latestRun?.status === "running") {
      return {
        reviewed: false,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: renderSprintQaPendingReport(latestRun),
      };
    }
    if (latestRun?.outcome === "pass") {
      return { reviewed: false, blockedCompletion: false, mergeBlocked: false, reportText: "" };
    }
    if (retriesExhausted) {
      return { reviewed: false, blockedCompletion: false, mergeBlocked: false, reportText: "" };
    }
    if (
      (latestRun?.outcome === "changes_requested" || latestRun?.status === "failed")
      && !hasMeaningfulChangesSinceLatestRun
      && !recoveredStaleLatestRun
    ) {
      return {
        reviewed: false,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: renderSprintQaPendingReport(latestRun),
      };
    }

    const agent = await this.deps.agentPresetSyncService.resolveTargetedQualityAssuranceAgent(
      args.projectId,
      qaSettings.sprintCompletion.agentPresetId,
    );
    const run = this.deps.qaReviewRepository.createRun({
      projectId: args.projectId,
      sprintId: args.sprintId,
      sprintRunId: args.sprintRunId,
      triggerType: "sprint_completion",
      runIndex: (latestRun?.runIndex || 0) + 1,
      agentPresetId: agent.id,
      agentName: agent.name,
      payload: {
        sprintRunId: args.sprintRunId,
        taskSnapshot: currentTaskSnapshot,
      },
    });

    try {
      const memoryInstructions = resolveAgentMemoryInstructions(
        agent,
        settings.memory?.workerLearningsInstruction
      );
      let agentInstructions = agent.instructionMarkdown + (memoryInstructions ? `\n\n### Memory Capture Instructions\n${memoryInstructions}` : "");

      const review = await this.runReview({
        triggerType: "sprint_completion",
        scope,
        projectName: project.name,
        sprintGoal: sprint.goal || "",
        repoPath: args.repoPath,
        agentInstructions: agentInstructions,
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
            ...review.raw,
            taskSnapshot: currentTaskSnapshot,
          },
          finishedAt: new Date().toISOString(),
        });
        return {
          reviewed: true,
          blockedCompletion: false,
          mergeBlocked: false,
          reportText: renderSprintQaPassReport(review.summary),
        };
      }

      const targetTask = review.targetTaskKey
        ? args.subtasks.find((task) => task.id === review.targetTaskKey) ?? null
        : null;
      const targetTaskRun = targetTask ? this.resolveTaskRunForSubtask(targetTask, args.sprintRunId) : null;
      const fixInstructions = review.fixInstructions;
      const continued = targetTask && fixInstructions
        ? await this.requestFixesForTask({
          task: targetTask,
          taskRun: targetTaskRun,
          repoPath: args.repoPath,
          featureBranch: sprintFeatureBranch,
          scope,
          prompt: fixInstructions,
        })
        : { applied: false, mode: "none" as const };
      const createdFollowUpTasks = this.createSprintFollowUpTasks({
        projectId: args.projectId,
        sprintId: args.sprintId,
        targetTask,
        fixInstructions,
        review,
        existingSubtasks: args.subtasks,
        sourceRunId: run.id,
      });

      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "completed",
        outcome: "changes_requested",
        targetTaskKey: targetTask?.id || review.targetTaskKey,
        targetSessionId: targetTask?.session_id || null,
        targetProvider: targetTask?.provider || null,
        summaryMarkdown: review.summary,
        fixInstructions,
        payload: {
          ...review.raw,
          continued: continued.applied,
          continuationMode: continued.mode,
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

      return {
        reviewed: true,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: renderSprintQaChangesRequestedReport(
          review.summary,
          targetTask?.id || review.targetTaskKey,
          continued.applied,
          createdFollowUpTasks.map((task) => task.taskKey),
        ),
      };
    } catch (error) {
      const qaError = parseQaError(error);
      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "failed",
        summaryMarkdown: qaError.message,
        payload: {
          error_code: qaError.code,
        },
        finishedAt: new Date().toISOString(),
      });
      this.deps.logger?.warn("Sprint QA review failed", {
        projectId: args.projectId,
        sprintId: args.sprintId,
        sprintRunId: args.sprintRunId,
        error: qaError.message,
        error_code: qaError.code,
      });
      return {
        reviewed: false,
        blockedCompletion: true,
        mergeBlocked: qaError.isRetryable,
        reportText: renderSprintQaFailedReport(error),
      };
    }
  }

  getTaskMergeGateStatus(args: {
    projectId: string;
    sprintId: string;
    task: Subtask;
  }): TaskQaMergeGateStatus {
    const taskId = args.task.record_id?.trim();
    if (!taskId) {
      return {
        mergeAllowed: true,
        reason: "not_required",
        summary: "",
        latestRun: null,
        runsUsed: 0,
        maxRuns: 0,
      };
    }

    const scope = { projectId: args.projectId, sprintId: args.sprintId };
    const settings = this.deps.getDashboardSettings(scope);
    const qaSettings = settings.agents.qualityAssurance;
    const triggerType = this.resolveTaskTriggerType(args.task, qaSettings);
    if (!qaSettings.enabled || !triggerType) {
      return {
        mergeAllowed: true,
        reason: "not_required",
        summary: "",
        latestRun: null,
        runsUsed: 0,
        maxRuns: qaSettings.maxTaskReviewRuns,
      };
    }

    const latestRun = this.reconcileRunningQaRun(this.deps.qaReviewRepository.getLatestTaskRun(taskId));
    const runsUsed = this.deps.qaReviewRepository.countTaskRuns(taskId);
    const maxRuns = qaSettings.maxTaskReviewRuns;

    if (latestRun?.status === "running") {
      return {
        mergeAllowed: false,
        reason: "review_running",
        summary: latestRun.summaryMarkdown || "QA review is still running.",
        latestRun,
        runsUsed,
        maxRuns,
      };
    }

    if (latestRun?.outcome === "pass") {
      return {
        mergeAllowed: true,
        reason: "passed",
        summary: latestRun.summaryMarkdown || "QA review passed.",
        latestRun,
        runsUsed,
        maxRuns,
      };
    }

    if (latestRun?.outcome === "changes_requested") {
      return {
        mergeAllowed: false,
        reason: "changes_requested",
        summary: latestRun.summaryMarkdown || "QA requested follow-up fixes.",
        latestRun,
        runsUsed,
        maxRuns,
      };
    }

    const recoveredStaleLatestRun = isRecoveredStaleQaRun(latestRun);

    // Only runs that produced a real verdict (pass / changes_requested) spend
    // the review budget. Reviewer crashes (missing auth, container/parse
    // failures) are infra noise that produced no judgement, so they are retried
    // — bounded by an infra ceiling so a permanently broken reviewer still
    // stops and escalates instead of looping or failing open.
    const decisiveRuns = this.deps.qaReviewRepository.countDecisiveTaskRuns(taskId);
    const infraCeiling = maxRuns + QA_INFRA_FAILURE_GRACE;

    // Fail CLOSED on exhaustion. A genuine pass returns above, so reaching here
    // means QA never affirmatively cleared the task. Never let an exhausted gate
    // allow the merge/settle — that is exactly what silently shipped tasks with
    // no PR. Hold the merge; the orchestrator escalates the task to a human.
    if (decisiveRuns >= maxRuns || runsUsed >= infraCeiling) {
      return {
        mergeAllowed: false,
        reason: "retries_exhausted",
        summary: latestRun?.summaryMarkdown
          || `QA could not clear this task (${decisiveRuns}/${maxRuns} verdicts, ${runsUsed} attempts) — human attention required.`,
        latestRun,
        runsUsed,
        maxRuns,
      };
    }

    if (latestRun?.status === "failed" && recoveredStaleLatestRun) {
      return {
        mergeAllowed: false,
        reason: "review_failed",
        summary: latestRun.summaryMarkdown || "QA review failed and must be retried before merge.",
        latestRun,
        runsUsed,
        maxRuns,
      };
    }

    if (latestRun?.status === "failed") {
      return {
        mergeAllowed: false,
        reason: "review_failed",
        summary: latestRun.summaryMarkdown || "QA review failed and must be retried before merge.",
        latestRun,
        runsUsed,
        maxRuns,
      };
    }

    return {
      mergeAllowed: false,
      reason: "pending_review",
      summary: "QA review is required before merge.",
      latestRun,
      runsUsed,
      maxRuns,
    };
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
        ? this.buildMemoryContext(args.scope.projectId!, args.scope.sprintId || null, args.agentPresetId)
        : undefined;
      const prompt = this.buildReviewPrompt({
        ...args,
        memoryContext,
      });
      const providerPrompt = buildProviderPrompt(prompt, providerSettings.thinkingMode);
      const settings = this.deps.getDashboardSettings(args.scope);
      const workflowSettings = {
        ...DEFAULT_CLI_WORKFLOW_SETTINGS,
        ...settings.cliWorkflow,
      };
      let snapshotWorkspace = args.repoPath;
      let shouldCleanupSnapshot = false;
      if (workflowSettings.executionMode === "DOCKER") {
        try {
          snapshotWorkspace = await this.workspaceManager.createSnapshotWorkspace(
            args.repoPath,
            `qa-review-${provider}-${Date.now().toString(36)}`,
            { branch: args.reviewBranch, fallbackBranch: args.baseBranch },
          );
          shouldCleanupSnapshot = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.deps.logger?.warn("Failed to create QA snapshot workspace, falling back to repository path", {
            projectId: args.scope.projectId,
            sprintId: args.scope.sprintId,
            repoPath: args.repoPath,
            error: message,
          });
        }
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
          model: providerSettings.model,
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
          customBaseUrl: providerSettings.customBaseUrl,
          customModel: providerSettings.customModel,
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
    const staleRunningInvocationReason = latestInvocation
      ? this.resolveStaleRunningQaInvocationReason(latestInvocation, options.activeContainerSessionIds)
      : null;
    if ((latestInvocation?.status === "running" || latestInvocation?.status === "paused") && !staleRunningInvocationReason) {
      return run;
    }

    const runStartedAtMs = Date.parse(run.startedAt);
    const ageMs = Number.isFinite(runStartedAtMs) ? Date.now() - runStartedAtMs : 0;
    if (!latestInvocation && ageMs < QA_RUN_START_TIMEOUT_MS) {
      return run;
    }

    const finishedAt = latestInvocation?.finishedAt || new Date().toISOString();
    const summaryMarkdown = staleRunningInvocationReason
      || (latestInvocation
        ? `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation ${latestInvocation.status}. Code UX will retry the review.`
        : `${RECOVERED_STALE_QA_SUMMARY_PREFIX} that never started its backing invocation. Code UX will retry the review.`);

    if (latestInvocation && (latestInvocation.status === "running" || latestInvocation.status === "paused")) {
      this.deps.executionRepository.updateExecutionInvocation(latestInvocation.id, {
        status: "failed",
        finishedAt,
        errorMessage: summaryMarkdown,
      });
      this.deps.executionRepository.appendExecutionInvocationMessage(latestInvocation.id, {
        role: "system",
        contentMarkdown: summaryMarkdown,
        metadata: {
          recovery: "qa_runtime_reconcile",
          qaRunId: run.id,
        },
        createdAt: finishedAt,
      });

      const providerInvocation = this.resolveProviderInvocationUsage(latestInvocation);
      if (providerInvocation?.status === "running") {
        this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
          status: "failed",
          finishedAt,
          durationMs: this.calculateProviderInvocationDurationMs(providerInvocation, finishedAt),
        });
      }
    }

    return this.deps.qaReviewRepository.updateRun(run.id, {
      status: "failed",
      summaryMarkdown,
      finishedAt,
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

  private resolveStaleRunningQaInvocationReason(
    invocation: ExecutionInvocationRecord,
    activeContainerSessionIds?: ReadonlySet<string>,
  ): string | null {
    if (invocation.status !== "running" && invocation.status !== "paused") {
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation ${invocation.status}. Code UX will retry the review.`;
    }

    const referenceAt = Date.parse(invocation.lastMessageAt || invocation.startedAt);
    const ageMs = Number.isFinite(referenceAt) ? Date.now() - referenceAt : 0;
    const providerInvocation = this.resolveProviderInvocationUsage(invocation);
    if (!providerInvocation) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation stayed running without provider runtime linkage. Code UX will retry the review.`;
    }

    if (providerInvocation.status !== "running") {
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing provider invocation ${providerInvocation.status}. Code UX will retry the review.`;
    }

    if (
      providerInvocation.executionMode === "DOCKER"
      && activeContainerSessionIds
      && !activeContainerSessionIds.has(providerInvocation.sessionId)
    ) {
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after its Docker container disappeared for session ${providerInvocation.sessionId}. Code UX will retry the review.`;
    }

    return null;
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
      || typeof executionRepository.getLease !== "function"
      || typeof executionRepository.renewLease !== "function"
    ) {
      return;
    }

    const sprintRun = executionRepository.getSprintRun(sprintRunId);
    if (!sprintRun || sprintRun.status !== "running") {
      return;
    }

    const now = new Date().toISOString();
    executionRepository.updateSprintRun(sprintRunId, {
      lastHeartbeatAt: now,
    });

    const lease = executionRepository.getLease("sprint", sprintId);
    if (!lease) {
      return;
    }

    try {
      executionRepository.renewLease({
        scopeType: "sprint",
        scopeId: sprintId,
        leaseToken: lease.leaseToken,
        expiresAt: new Date(Date.now() + SPRINT_LEASE_EXTENSION_MS).toISOString(),
      });
    } catch (error) {
      this.deps.logger?.warn("Failed to renew sprint lease during QA review", {
        sprintRunId,
        sprintId,
        error: error instanceof Error ? error.message : String(error),
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
      "- For sprint completion reviews, set `targetTaskKey` to the best task to continue when changes are required.",
      "- For sprint completion reviews, use `followUpTasks` when the required work should become new sprint tasks instead of only resuming one existing session.",
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
  }): Promise<{ applied: boolean; mode: "jules" | "cli" | "none" }> {
    const provider = args.task.provider;
    const sessionId = args.task.session_id?.trim();
    if (!provider || !sessionId) {
      return { applied: false, mode: "none" };
    }

    const followUpPrompt = [
      "Quality assurance review found follow-up work before this task can be considered done.",
      "",
      args.prompt.trim(),
    ].join("\n");

    if (provider === "jules") {
      await this.deps.sendSessionMessage(sessionId, followUpPrompt);
      return { applied: true, mode: "jules" };
    }

    await this.continueCliTaskSession({
      provider,
      sessionId,
      task: args.task,
      taskRun: args.taskRun,
      repoPath: args.repoPath,
      featureBranch: args.featureBranch,
      scope: args.scope,
      followUpPrompt,
    });
    return { applied: true, mode: "cli" };
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
  }): Promise<void> {
    const settings = this.deps.getDashboardSettings(args.scope);
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...settings.cliWorkflow,
    };
    const resumeWorkspacePath = await this.workspaceManager.resolveResumeWorktreePath(
      args.repoPath,
      args.sessionId,
      workflowSettings.executionMode,
    );
    const hasPreservedWorkspace = Boolean(resumeWorkspacePath);
    const worktreePath = resumeWorkspacePath
      || this.workspaceManager.buildWorktreePath(args.repoPath, args.sessionId, workflowSettings.executionMode);
    const resolvedWorkspaceBranch = hasPreservedWorkspace
      ? await this.workspaceManager.resolveCurrentBranch(worktreePath)
      : null;
    const workerBranch = args.task.worker_branch?.trim()
      || args.taskRun?.workerBranch?.trim()
      || resolvedWorkspaceBranch
      || undefined;
    if (!workerBranch) {
      const workspaceState = hasPreservedWorkspace
        ? `resume workspace ${worktreePath} does not expose a current branch`
        : `resume workspace is missing for session ${args.sessionId}`;
      throw new Error(
        `Cannot continue CLI QA fixes for ${args.task.id}: worker branch metadata is missing and ${workspaceState}.`,
      );
    }

    await this.syncRemoteBranchesIfNeeded(
      args.repoPath,
      workerBranch,
      args.scope,
      "continuing QA follow-up",
    );

    const gitAuth: GitHttpAuthOptions = {
      githubToken: settings.git.githubToken,
      gitlabToken: settings.git.gitlabToken,
    };

    if (!hasPreservedWorkspace) {
      await this.workspaceManager.prepareWorktree(args.repoPath, worktreePath, workerBranch, args.featureBranch, undefined, gitAuth);
    } else {
      await this.syncExistingCliFollowUpWorkspace(worktreePath, workerBranch, args.repoPath, gitAuth);
    }

    const workerAgent = await this.deps.agentPresetSyncService.getOptionalWorkerAgentForRepoPath(args.repoPath);
    const workerInstructions = workerAgent?.instructionMarkdown?.trim() || "";
    const workerMemoryInstructions = resolveAgentMemoryInstructions(
      workerAgent || {},
      settings.memory?.workerLearningsInstruction,
    );
    const workerMemoryContext = workerAgent?.id
      ? this.buildMemoryContext(args.scope.projectId!, args.scope.sprintId || null, workerAgent.id)
      : undefined;
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
      customModel: followUpProviderSettings.customModel,
      qwenAuthMode: followUpProviderSettings.qwenAuthMode,
      qwenModelId: followUpProviderSettings.qwenModelId,
      openCodeAuthMode: followUpProviderSettings.openCodeAuthMode,
      openCodeProviderId: followUpProviderSettings.openCodeProviderId,
      openCodeModelId: followUpProviderSettings.openCodeModelId,
    });

    const providerPrompt = buildProviderPrompt(`${promptBody}\n\n${workspaceGuidance}`, followUpProviderSettings.thinkingMode);
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
      model: effectiveModel,
      apiKey: followUpProviderSettings.apiKey,
      qwenAuthMode: followUpProviderSettings.qwenAuthMode,
      qwenRegion: followUpProviderSettings.qwenRegion,
      qwenBaseUrl: followUpProviderSettings.qwenBaseUrl,
      qwenEnvKey: followUpProviderSettings.qwenEnvKey,
      qwenModelId: followUpProviderSettings.qwenModelId,
      qwenProtocol: followUpProviderSettings.qwenProtocol,
      qwenAdditionalModelProviders: followUpProviderSettings.qwenAdditionalModelProviders,
        openCodeAuthMode: followUpProviderSettings.openCodeAuthMode,
        openCodeProviderId: followUpProviderSettings.openCodeProviderId,
        openCodeModelId: followUpProviderSettings.openCodeModelId,
        openCodeBaseUrl: followUpProviderSettings.openCodeBaseUrl,
        openCodeEnvKey: followUpProviderSettings.openCodeEnvKey,
        openCodePackage: followUpProviderSettings.openCodePackage,
      providerMountAuth: followUpProviderSettings.mountAuth,
      providerAuthPath: followUpProviderSettings.authPath,
      customBaseUrl: followUpProviderSettings.customBaseUrl,
      customModel: followUpProviderSettings.customModel,
      sessionId: args.sessionId,
      workflowSettings,
      repoPath: args.repoPath,
      continueSessionId: previousInvocation?.nativeSessionId || (args.provider === "claude-code" ? null : args.sessionId),
    });

    if (!result.ok) {
      this.deps.projectManagementRepository.updateTask(args.task.record_id!, {
        status: "pending",
      });
      this.deps.sessionTracking.updateSession(args.sessionId, { state: "FAILED" });
      throw new Error(result.stderr || result.stdout || "CLI QA follow-up failed.");
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

    let prUrl = args.task.pr_url || args.taskRun?.prUrl || null;
    if (hasUnpushed || hasAhead) {
      if (settings.git.autoCreatePr && settings.git.githubMode !== "LOCAL") {
        const sprint = args.task.sprint_id ? this.deps.projectManagementRepository.getSprint(args.task.sprint_id) : null;
        prUrl = (await this.prService.resolveOrCreateFeaturePr(
          {
            taskId: args.task.id,
            provider: args.provider,
            title: args.task.title,
            featureBranch: args.featureBranch,
            workerBranch,
            taskDescription: args.task.prompt,
            sprintDescription: sprint?.goal,
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
    this.deps.projectManagementRepository.updateTask(args.task.record_id!, {
      status: "coding_completed",
    });
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

  private buildMemoryContext(projectId: string, sprintId: string | null, agentPresetId: string): string | undefined {
    const memoryService = this.deps.memoryService;
    if (!memoryService) {
      return undefined;
    }

    try {
      const longTerm = memoryService.listLongTermByAgent(projectId, agentPresetId, 10);
      const shortTerm = sprintId
        ? memoryService.listBySprintAndAgent(projectId, sprintId, agentPresetId, 10)
        : [];

      if (longTerm.length === 0 && shortTerm.length === 0) {
        return undefined;
      }

      const sections: string[] = ["## PROJECT CONTEXT FROM MEMORY"];
      if (longTerm.length > 0) {
        sections.push("### Long-Term Knowledge");
        for (const memory of longTerm) {
          sections.push(`- [${memory.category}] ${memory.content.slice(0, 300)}`);
        }
      }
      if (shortTerm.length > 0) {
        sections.push("### Recent Sprint Learnings");
        for (const memory of shortTerm) {
          sections.push(`- [${memory.category}] ${memory.content.slice(0, 300)}`);
        }
      }
      return sections.join("\n");
    } catch {
      return undefined;
    }
  }

  private resolveTaskTriggerType(
    task: Pick<Subtask, "pr_url" | "worker_branch" | "is_merged">,
    qaSettings: DashboardSettings["agents"]["qualityAssurance"],
  ): QaReviewTriggerType | null {
    // A task with merge evidence clearly did NOT complete without a PR. We must
    // check `is_merged`/`worker_branch` too, not just `pr_url`: `pr_url` is not a
    // persisted task column — it is reconstructed at runtime — so when an old
    // merged task is reloaded (e.g. a sprint resumes) its `pr_url` comes back
    // empty and the no-PR trigger would misfire QA on already-merged work.
    const hasMergeEvidence = Boolean(task.pr_url?.trim())
      || Boolean(task.worker_branch?.trim())
      || Boolean(task.is_merged);
    if (!hasMergeEvidence && qaSettings.completedTaskWithoutPr.enabled) {
      return "completed_task_without_pr";
    }
    return qaSettings.taskCompletion.enabled ? "task_completion" : null;
  }

  private getLatestSprintTaskUpdatedAt(projectId: string, sprintId: string): number {
    const timestamps = this.deps.projectManagementRepository.listTasks(projectId, sprintId)
      .map((task) => Date.parse(task.updatedAt))
      .filter((value) => Number.isFinite(value));
    return timestamps.length > 0 ? Math.max(...timestamps) : 0;
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

function buildSprintQaSnapshot(subtasks: Subtask[]): string {
  return JSON.stringify(
    subtasks
      .map((task) => ({
        id: task.id,
        title: task.title || "",
        prompt: task.prompt || "",
        status: task.status || "",
        dependsOn: [...task.depends_on].sort(),
        isMerged: Boolean(task.is_merged),
        mergeIndicator: task.merge_indicator || "",
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

function readSprintQaSnapshot(run: QaReviewRunRecord | null): string | null {
  const snapshot = run?.payload?.taskSnapshot;
  return typeof snapshot === "string" && snapshot.trim().length > 0 ? snapshot : null;
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

function renderSprintQaFailedReport(error: unknown): string {
  const summary = error instanceof Error ? error.message : String(error);
  return `\nSprint QA failed and blocked merge: ${summary}\n`;
}
