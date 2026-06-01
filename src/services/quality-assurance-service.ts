import * as fs from "fs/promises";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS } from "./cli-workflow-utils.js";
import { extractJsonFromText } from "../domain/llm/json-extraction.js";
import { StructuredAgentRequestService } from "./structured-agent-request-service.js";
import { StructuredProviderResponseService } from "./structured-provider-response-service.js";
import { WorkspaceManager } from "../infrastructure/providers/cli/workspace-manager.js";
import { WorkspaceArtifactService } from "../infrastructure/providers/cli/workspace-artifact-service.js";
import { PrService } from "../infrastructure/providers/cli/pr-service.js";
import type { IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { ProviderExecutionService } from "./provider-execution-service.js";
import { ProviderConcurrencyService } from "./provider-concurrency-service.js";
import type { DashboardSettings, DashboardSettingsScope, ProviderId, Subtask } from "../contracts/app-types.js";
import type { TaskRunRecord } from "../contracts/execution-types.js";
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
import { parseQaError, type QaReviewError } from "../domain/qa-review/qa-review-types.js";

type CliQaProvider = Exclude<ProviderId, "jules">;

interface QaReviewResultPayload {
  verdict?: unknown;
  summary?: unknown;
  findings?: unknown;
  fixInstructions?: unknown;
  targetTaskKey?: unknown;
  shouldHavePr?: unknown;
  followUpTasks?: unknown;
}

interface QaFollowUpTaskPayload {
  title?: unknown;
  promptMarkdown?: unknown;
  prompt?: unknown;
  description?: unknown;
  dependsOnTaskKeys?: unknown;
  priority?: unknown;
}

interface NormalizedQaFollowUpTask {
  title: string;
  promptMarkdown: string;
  description: string | null;
  dependsOnTaskKeys: string[];
  priority: TaskPriority;
}

interface NormalizedQaReviewResult {
  verdict: "pass" | "changes_requested";
  summary: string;
  findings: string[];
  fixInstructions: string | null;
  targetTaskKey: string | null;
  shouldHavePr: boolean | null;
  followUpTasks: NormalizedQaFollowUpTask[];
  raw: Record<string, unknown>;
}

const SPRINT_RUN_KEEPALIVE_MS = 30_000;
const SPRINT_LEASE_EXTENSION_MS = 5 * 60 * 1000;
const QA_RUN_START_TIMEOUT_MS = 60_000;
const RECOVERED_STALE_QA_SUMMARY_PREFIX = "Recovered stale QA review run";

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
}

export class QualityAssuranceService {
  private readonly workspaceManager = new WorkspaceManager();
  private readonly workspaceArtifactService = new WorkspaceArtifactService(this.workspaceManager);

  private readonly prService = new PrService();

  private readonly providerExecutionService: ProviderExecutionService;
  private readonly structuredAgentRequestService: StructuredAgentRequestService;

  private readonly activeQaRuns = new Map<string, AbortController>();

  stopQaReview(args: { runId?: string; taskId?: string; sprintId?: string } | string): boolean {
    let runId: string | undefined;
    let taskId: string | undefined;
    let sprintId: string | undefined;

    if (typeof args === "string") {
      runId = args;
    } else {
      runId = args.runId;
      taskId = args.taskId;
      sprintId = args.sprintId;
    }

    if (!runId && taskId) {
      const activeRun = this.deps.qaReviewRepository.getLatestTaskRun(taskId);
      if (activeRun && activeRun.status === "running") {
        runId = activeRun.id;
      }
    }
    if (!runId && sprintId) {
      const activeRun = this.deps.qaReviewRepository.getLatestSprintRun(sprintId);
      if (activeRun && activeRun.status === "running") {
        runId = activeRun.id;
      }
    }

    if (runId) {
      const controller = this.activeQaRuns.get(runId);
      if (controller) {
        controller.abort();
        this.activeQaRuns.delete(runId);
        return true;
      }
    }
    return false;
  }

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
    customProvider?: {
      provider: string;
      providerConfigId?: string;
      model?: string;
    };
    agentPresetId?: string;
    force?: boolean;
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
    if (!qaSettings.enabled && !args.force) {
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }

    let triggerType = this.resolveTaskTriggerType(args.task, qaSettings);
    if (!triggerType && args.force) {
      triggerType = args.task.pr_url ? "task_completion" : "completed_task_without_pr";
    }
    if (!triggerType) {
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }

    const existingRuns = this.deps.qaReviewRepository.countTaskRuns(taskId);
    if (existingRuns >= qaSettings.maxTaskReviewRuns && !args.customProvider && !args.force) {
      await this.cleanupCliWorkspaceIfNeeded(args.task, args.repoPath, scope);
      return { reviewed: false, reopenedTask: false, mergeBlocked: false, reportText: "" };
    }

    // Separate per-task QA guardrail (independent of the QA agent's own maxTaskReviewRuns).
    const qaGuardrail = this.deps.guardrailService.evaluateQa(scope, taskId);
    if (!qaGuardrail.allowed && qaGuardrail.action !== "WARN_ONLY" && !args.customProvider && !args.force) {
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

    const defaultAgentPresetId = triggerType === "completed_task_without_pr"
      ? qaSettings.completedTaskWithoutPr.agentPresetId
      : qaSettings.taskCompletion.agentPresetId;
    const agentPresetId = args.agentPresetId || defaultAgentPresetId || "";
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

    const abortController = new AbortController();
    this.activeQaRuns.set(run.id, abortController);

    // Record the QA invocation against the per-task guardrail ledger.
    this.deps.guardrailService.record(scope, taskId, "qa_review");

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
        customProvider: args.customProvider,
        abortSignal: abortController.signal,
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
          featureBranch: sprint.featureBranch?.trim() || settings.git.defaultBranch,
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
        });
        args.task.status = "RUNNING";
      } else {
        this.deps.projectManagementRepository.updateTask(taskId, {
          status: "pending",
        });
        args.task.status = "PENDING";
      }

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
      const isStopped = error instanceof Error && error.message.includes("aborted");
      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "failed",
        summaryMarkdown: isStopped ? "QA review was stopped manually." : qaError.message,
        payload: {
          error_code: isStopped ? "CANCELLED" : qaError.code,
        },
        finishedAt: new Date().toISOString(),
      });
      this.appendTaskEvent(taskRun, "qa_review_failed", {
        triggerType,
        error: isStopped ? "QA review was stopped manually." : qaError.message,
        error_code: isStopped ? "CANCELLED" : qaError.code,
        qaReviewRunId: run.id,
      });
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
    } finally {
      this.activeQaRuns.delete(run.id);
    }
  }

  async reviewSprintCompletion(args: {
    projectId: string;
    sprintId: string;
    sprintRunId?: string | null;
    repoPath: string;
    subtasks: Subtask[];
    customProvider?: {
      provider: string;
      providerConfigId?: string;
      model?: string;
    };
    agentPresetId?: string;
    force?: boolean;
  }): Promise<SprintQaReviewOutcome> {
    const scope = {
      projectId: args.projectId,
      sprintId: args.sprintId,
    };
    const settings = this.deps.getDashboardSettings(scope);
    const qaSettings = settings.agents.qualityAssurance;
    if ((!qaSettings.enabled || !qaSettings.sprintCompletion.enabled) && !args.force) {
      return { reviewed: false, blockedCompletion: false, mergeBlocked: false, reportText: "" };
    }

    const project = this.deps.projectManagementRepository.getProject(args.projectId);
    const sprint = this.deps.projectManagementRepository.getSprint(args.sprintId);
    if (!project || !sprint) {
      return { reviewed: false, blockedCompletion: false, mergeBlocked: false, reportText: "" };
    }

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
    const recoveredStaleLatestRun = this.isRecoveredStaleQaRun(latestRun);
    const retriesExhausted = typeof latestRun?.runIndex === "number" && latestRun.runIndex >= maxRuns;

    if (latestRun?.status === "running") {
      return {
        reviewed: false,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: renderSprintQaPendingReport(latestRun),
      };
    }
    if (latestRun?.outcome === "pass" && !args.customProvider && !args.force) {
      return { reviewed: false, blockedCompletion: false, mergeBlocked: false, reportText: "" };
    }
    if (retriesExhausted && !args.customProvider && !args.force) {
      return { reviewed: false, blockedCompletion: false, mergeBlocked: false, reportText: "" };
    }
    if (
      (latestRun?.outcome === "changes_requested" || latestRun?.status === "failed")
      && !hasMeaningfulChangesSinceLatestRun
      && !recoveredStaleLatestRun
      && !args.customProvider
      && !args.force
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
      args.agentPresetId || qaSettings.sprintCompletion.agentPresetId,
    );
    const run = this.deps.qaReviewRepository.createRun({
      projectId: args.projectId,
      sprintId: args.sprintId,
      sprintRunId: args.sprintRunId || null,
      triggerType: "sprint_completion",
      runIndex: (latestRun?.runIndex || 0) + 1,
      agentPresetId: agent.id,
      agentName: agent.name,
      payload: {
        sprintRunId: args.sprintRunId || null,
        taskSnapshot: currentTaskSnapshot,
      },
    });

    const abortController = new AbortController();
    this.activeQaRuns.set(run.id, abortController);

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
        sprintRunId: args.sprintRunId || null,
        agentPresetId: agent.id,
        customProvider: args.customProvider,
        abortSignal: abortController.signal,
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
      const targetTaskRun = targetTask ? this.resolveTaskRunForSubtask(targetTask, args.sprintRunId || undefined) : null;
      const fixInstructions = review.fixInstructions;
      const continued = targetTask && fixInstructions
        ? await this.requestFixesForTask({
          task: targetTask,
          taskRun: targetTaskRun,
          repoPath: args.repoPath,
          featureBranch: sprint.featureBranch?.trim() || settings.git.defaultBranch,
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
        });
        targetTask.status = "RUNNING";
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
      const isStopped = error instanceof Error && error.message.includes("aborted");
      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "failed",
        summaryMarkdown: isStopped ? "QA review was stopped manually." : qaError.message,
        payload: {
          error_code: isStopped ? "CANCELLED" : qaError.code,
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
    } finally {
      this.activeQaRuns.delete(run.id);
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

    if (runsUsed >= maxRuns) {
      return {
        mergeAllowed: true,
        reason: "retries_exhausted",
        summary: latestRun?.summaryMarkdown || `QA retry budget exhausted (${runsUsed}/${maxRuns}).`,
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
    customProvider?: {
      provider: string;
      providerConfigId?: string;
      model?: string;
    };
    abortSignal?: AbortSignal;
  }): Promise<NormalizedQaReviewResult> {
    return await this.withSprintRunKeepAlive(args.sprintRunId, args.scope.sprintId, async () => {
      await this.syncRemoteBranchesIfNeeded(
        args.repoPath,
        args.currentTask?.worker_branch || args.taskRun?.workerBranch || undefined,
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

      let provider: CliQaProvider;
      let providerConfigId: string;
      let providerSettings: any;

      if (args.customProvider) {
        provider = args.customProvider.provider as CliQaProvider;
        providerConfigId = args.customProvider.providerConfigId || args.customProvider.provider;
        const settings = this.deps.getDashboardSettings(args.scope);
        const resolvedSettings = settings.aiProvider.providers[providerConfigId];
        providerSettings = {
          ...resolvedSettings,
          model: args.customProvider.model || resolvedSettings?.model,
        };
      } else {
        const route = this.deps.taskService.resolveInvocationProvider("qa_review", pseudoTask, {
          scope: args.scope,
          cliOnly: true,
        });
        provider = route.provider as CliQaProvider;
        providerConfigId = route.providerConfigId || route.provider;
        providerSettings = route.providers[providerConfigId];
      }

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
          signal: args.abortSignal,
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

  private reconcileRunningQaRun(run: QaReviewRunRecord | null): QaReviewRunRecord | null {
    if (!run || run.status !== "running") {
      return run;
    }

    const latestInvocation = this.findLatestQaExecutionInvocation(run);
    if (latestInvocation?.status === "running" || latestInvocation?.status === "paused") {
      return run;
    }

    const runStartedAtMs = Date.parse(run.startedAt);
    const ageMs = Number.isFinite(runStartedAtMs) ? Date.now() - runStartedAtMs : 0;
    if (!latestInvocation && ageMs < QA_RUN_START_TIMEOUT_MS) {
      return run;
    }

    return this.deps.qaReviewRepository.updateRun(run.id, {
      status: "failed",
      summaryMarkdown: latestInvocation
        ? `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation ${latestInvocation.status}. Code UX will retry the review.`
        : `${RECOVERED_STALE_QA_SUMMARY_PREFIX} that never started its backing invocation. Code UX will retry the review.`,
      finishedAt: latestInvocation?.finishedAt || new Date().toISOString(),
    });
  }

  private isRecoveredStaleQaRun(run: QaReviewRunRecord | null): boolean {
    return typeof run?.summaryMarkdown === "string" && run.summaryMarkdown.startsWith(RECOVERED_STALE_QA_SUMMARY_PREFIX);
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
    const currentTaskSection = args.currentTask
      ? [
        "## CURRENT TASK",
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
      "## PROJECT CONTEXT",
      `Project: ${args.projectName}`,
      `Sprint goal: ${args.sprintGoal || "No sprint goal provided."}`,
      "",
      "## SPRINT TASKS",
      args.subtasks.map((task) => (
        `- [${task.status || "unknown"}] ${task.id}: ${task.title} | provider=${task.provider || "unknown"} | branch=${task.worker_branch || "none"} | pr=${task.pr_url || "none"}`
      )).join("\n"),
      "",
      "## FULL TASK INSTRUCTIONS",
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
    const workerBranch = args.task.worker_branch?.trim() || args.taskRun?.workerBranch?.trim();
    if (!workerBranch) {
      throw new Error(`Cannot continue CLI QA fixes for ${args.task.id}: worker branch is missing.`);
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

    const worktreePath = await this.workspaceManager.resolveResumeWorktreePath(args.repoPath, args.sessionId, workflowSettings.executionMode)
      || this.workspaceManager.buildWorktreePath(args.repoPath, args.sessionId, workflowSettings.executionMode);
    const existed = await this.workspacePathExists(worktreePath);
    if (!existed) {
      await this.workspaceManager.prepareWorktree(args.repoPath, worktreePath, workerBranch, args.featureBranch, undefined, gitAuth);
    } else {
      await this.syncExistingCliFollowUpWorkspace(args.repoPath, worktreePath, workerBranch, gitAuth);
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
    const followUpProviderSettings = settings.aiProvider.providers[args.provider];
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
      model: followUpProviderSettings.model,
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
    });

    let hasUnpushed = applyResult.hasChanges;
    let hasAhead = applyResult.hasChanges;
    if (!applyResult.hasChanges) {
      hasUnpushed = await this.prService.hasUnpushedCommits(args.repoPath, workerBranch, args.featureBranch);
      hasAhead = await this.prService.hasWorkerBranchCommitsAgainstFeature(args.repoPath, workerBranch, args.featureBranch);
      if (hasUnpushed) {
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
      if (settings.git.autoCreatePr) {
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

  private async workspacePathExists(targetPath: string): Promise<boolean> {
    if (targetPath.startsWith("docker-volume://")) {
      return this.workspaceManager.workspaceExists(targetPath);
    }
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async syncExistingCliFollowUpWorkspace(
    repoPath: string,
    worktreePath: string,
    workerBranch: string,
    gitAuth: GitHttpAuthOptions,
  ): Promise<void> {
    const fetchEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, gitAuth);
    await this.runWorkspaceCommand(
      worktreePath,
      "git",
      ["fetch", "origin", `+refs/heads/${workerBranch}:refs/remotes/origin/${workerBranch}`],
      fetchEnv ?? process.env,
    ).catch(() => undefined);

    const hasRemoteWorkerBranch = await this.runWorkspaceCommand(
      worktreePath,
      "git",
      ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${workerBranch}`],
    ).then(() => true, () => false);

    if (hasRemoteWorkerBranch) {
      await this.runWorkspaceCommand(
        worktreePath,
        "git",
        ["clean", "-fd", "-e", ".code-ux-home/", "-e", ".task-learnings.md"],
      ).catch(() => undefined);
      await this.runWorkspaceCommand(worktreePath, "git", ["checkout", "-B", workerBranch, `origin/${workerBranch}`]);
      await this.runWorkspaceCommand(worktreePath, "git", ["reset", "--hard", `origin/${workerBranch}`]);
      return;
    }

    await this.runWorkspaceCommand(worktreePath, "git", ["checkout", workerBranch]).catch(() => undefined);
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
    task: Pick<Subtask, "pr_url">,
    qaSettings: DashboardSettings["agents"]["qualityAssurance"],
  ): QaReviewTriggerType | null {
    if (!task.pr_url && qaSettings.completedTaskWithoutPr.enabled) {
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

function normalizeQaReviewResult(bodyMarkdown: string): NormalizedQaReviewResult {
  const extraction = extractJsonFromText(bodyMarkdown);
  if (!extraction.success) {
    throw new Error(`Invalid JSON format: ${(extraction as any).error?.message || "Unknown error"}`);
  }

  const parsed = extraction.data;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Result must be a JSON object.");
  }

  const payload = parsed as Record<string, unknown>;

  if (payload.verdict !== "pass" && payload.verdict !== "changes_requested") {
    throw new Error("Missing or invalid 'verdict'. Must be 'pass' or 'changes_requested'.");
  }

  const verdict = payload.verdict;

  if (typeof payload.summary !== "string" || payload.summary.trim() === "") {
    throw new Error("Missing or invalid 'summary'. Must be a non-empty string.");
  }

  const summary = payload.summary.trim();

  const findings = Array.isArray(payload.findings)
    ? payload.findings.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const fixInstructions = typeof payload.fixInstructions === "string" && payload.fixInstructions.trim().length > 0
    ? payload.fixInstructions.trim()
    : null;
  const targetTaskKey = typeof payload.targetTaskKey === "string" && payload.targetTaskKey.trim().length > 0
    ? payload.targetTaskKey.trim()
    : null;
  const shouldHavePr = typeof payload.shouldHavePr === "boolean" ? payload.shouldHavePr : null;
  const followUpTasks = Array.isArray(payload.followUpTasks)
    ? payload.followUpTasks
      .map((entry) => normalizeFollowUpTask(entry))
      .filter((entry): entry is NormalizedQaFollowUpTask => entry !== null)
    : [];

  return {
    verdict,
    summary,
    findings,
    fixInstructions,
    targetTaskKey,
    shouldHavePr,
    followUpTasks,
    raw: payload,
  };
}

function normalizeFollowUpTask(value: unknown): NormalizedQaFollowUpTask | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as QaFollowUpTaskPayload;
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const promptMarkdown = typeof payload.promptMarkdown === "string"
    ? payload.promptMarkdown.trim()
    : typeof payload.prompt === "string"
      ? payload.prompt.trim()
      : "";
  if (!title || !promptMarkdown) {
    return null;
  }

  const description = typeof payload.description === "string" && payload.description.trim().length > 0
    ? payload.description.trim()
    : null;
  const dependsOnTaskKeys = Array.isArray(payload.dependsOnTaskKeys)
    ? payload.dependsOnTaskKeys.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const priority = payload.priority === "critical" || payload.priority === "high" || payload.priority === "low"
    ? payload.priority
    : "medium";

  return {
    title,
    promptMarkdown,
    description,
    dependsOnTaskKeys,
    priority,
  };
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
