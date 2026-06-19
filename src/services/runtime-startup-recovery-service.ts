import * as fs from "fs";
import * as path from "path";
import type { DashboardSettings, DashboardSettingsScope, DockerContainer, ProviderId } from "../contracts/app-types.js";
import type { ExecutionInvocationRecord, ProviderInvocationUsageRecord, TaskRunRecord } from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { QaReviewRepository } from "../repositories/qa-review-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import type { Logger } from "../shared/logging/logger.js";
import { sanitizeToken } from "./cli-workflow-utils.js";
import { RECOVERED_STALE_QA_SUMMARY_PREFIX } from "../domain/qa-review/qa-review-budget.js";

const ACTIVE_SPRINT_RUN_STATUSES = ["queued", "running"] as const;
const ACTIVE_DISPATCH_STATUSES = ["queued", "claimed", "running", "cancel_requested"] as const;
const TERMINAL_TASK_RUN_STATES = new Set(["COMPLETED", "FAILED", "BLOCKED", "QUOTA"]);
const ACTIVE_TASK_RUN_STATES = ["PENDING", "RUNNING", "PAUSED"] as const;
const TASK_CODING_INVOCATION_TYPES = ["task_coding", "cli_task_coding", "cli_task_followup"] as const;
const CLI_PROVIDERS = new Set<ProviderId>(["gemini", "codex", "claude-code", "qwen-code", "opencode"]);
const QA_RUN_START_TIMEOUT_MS = 60_000;

export interface RuntimeStartupRecoveryResult {
  recoveredCliSessionIds: string[];
  reconciledLocalDispatchIds: string[];
  reconciledProviderDispatchIds: string[];
  reconciledContainerInvocationIds: string[];
  reconciledQaReviewRunIds: string[];
  reconciledStructuredInvocationIds: string[];
  reconciledTaskCodingInvocationIds: string[];
  reconciledTaskCodingProviderIds: string[];
  reconciledTaskRunIds: string[];
  reconciledPausedSprintRunIds: string[];
  reconciledRetryInvocationIds: string[];
  resumedSprintRunIds: string[];
  supersededSprintRunIds: string[];
}

interface RuntimeStartupRecoveryServiceDeps {
  sessionTracking: SessionTrackingRepository;
  executionRepository: ExecutionRepository;
  qaReviewRepository?: QaReviewRepository;
  projectManagementRepository: ProjectManagementRepository;
  sprintOrchestrator: SprintOrchestrator;
  dockerService?: Pick<{ listContainers: () => Promise<DockerContainer[]> }, "listContainers">;
  getDashboardSettings?: (scope?: DashboardSettingsScope) => DashboardSettings;
  logger?: Logger;
}

export class RuntimeStartupRecoveryService {
  constructor(private readonly deps: RuntimeStartupRecoveryServiceDeps) {}

  async recover(): Promise<RuntimeStartupRecoveryResult> {
    this.releaseStaleSprintLeases();
    await this.identifyZombieWorkspaces();
    const cliRecovery = this.deps.sessionTracking.recoverInterruptedCliSessions();
    const recoveredCliSessionIds = cliRecovery.sessionIds;
    const reconciledLocalDispatchIds = this.reconcileInterruptedLocalDispatches(new Set(recoveredCliSessionIds));
    const reconciledProviderDispatchIds = this.reconcileInterruptedProviderDispatches();
    const reconciledRetryInvocationIds = this.reconcileInterruptedRetryWaits();
    const reconciledContainerInvocationIds = await this.reconcileInterruptedCliInvocations(new Set(recoveredCliSessionIds));
    const reconciledQaReviewRunIds = await this.reconcileInterruptedQaReviewRuns();
    const reconciledStructuredInvocationIds = await this.reconcileInterruptedStructuredInvocations();
    const reconciledTaskCodingInvocationIds = await this.reconcileInterruptedTaskCodingInvocations();
    const reconciledTaskCodingProviderIds = this.reconcileOrphanedTaskCodingProviderInvocations();
    const reconciledTaskRunIds = this.reconcileInterruptedTaskRuns();
    const reconciledPausedSprintRunIds = this.reconcileStalePausedSprintRuns();
    const { resumedSprintRunIds, supersededSprintRunIds } = this.resumeRecoverableSprintRuns();

    if (
      recoveredCliSessionIds.length > 0
      || reconciledLocalDispatchIds.length > 0
      || reconciledProviderDispatchIds.length > 0
      || reconciledRetryInvocationIds.length > 0
      || reconciledContainerInvocationIds.length > 0
      || reconciledQaReviewRunIds.length > 0
      || reconciledStructuredInvocationIds.length > 0
      || reconciledTaskCodingInvocationIds.length > 0
      || reconciledTaskCodingProviderIds.length > 0
      || reconciledTaskRunIds.length > 0
      || reconciledPausedSprintRunIds.length > 0
      || resumedSprintRunIds.length > 0
      || supersededSprintRunIds.length > 0
    ) {
      this.deps.logger?.info("Recovered runtime state on startup", {
        recoveredCliSessions: recoveredCliSessionIds.length,
        reconciledLocalDispatches: reconciledLocalDispatchIds.length,
        reconciledProviderDispatches: reconciledProviderDispatchIds.length,
        reconciledRetryInvocations: reconciledRetryInvocationIds.length,
        reconciledContainerInvocations: reconciledContainerInvocationIds.length,
        reconciledQaReviewRuns: reconciledQaReviewRunIds.length,
        reconciledStructuredInvocations: reconciledStructuredInvocationIds.length,
        reconciledTaskCodingInvocations: reconciledTaskCodingInvocationIds.length,
        reconciledTaskCodingProviders: reconciledTaskCodingProviderIds.length,
        reconciledTaskRuns: reconciledTaskRunIds.length,
        reconciledPausedSprintRuns: reconciledPausedSprintRunIds.length,
        resumedSprintRuns: resumedSprintRunIds.length,
        supersededSprintRuns: supersededSprintRunIds.length,
      });
    }

    return {
      recoveredCliSessionIds,
      reconciledLocalDispatchIds,
      reconciledProviderDispatchIds,
      reconciledRetryInvocationIds,
      reconciledContainerInvocationIds,
      reconciledQaReviewRunIds,
      reconciledStructuredInvocationIds,
      reconciledTaskCodingInvocationIds,
      reconciledTaskCodingProviderIds,
      reconciledTaskRunIds,
      reconciledPausedSprintRunIds,
      resumedSprintRunIds,
      supersededSprintRunIds,
    };
  }

  private async reconcileInterruptedQaReviewRuns(): Promise<string[]> {
    if (!this.deps.qaReviewRepository) {
      return [];
    }

    const runningRuns = this.deps.qaReviewRepository.listRunningRuns();
    if (runningRuns.length === 0) {
      return [];
    }

    const activeContainerSessionIds = await this.listActiveContainerSessionIds();
    const reconciledAt = new Date().toISOString();
    const reconciledRunIds: string[] = [];

    for (const run of runningRuns) {
      const latestInvocation = this.findLatestQaExecutionInvocation(run);
      const failureReason = this.resolveInterruptedQaRunReason(run, latestInvocation, activeContainerSessionIds);
      if (!failureReason) {
        continue;
      }

      if (latestInvocation && (latestInvocation.status === "running" || latestInvocation.status === "paused")) {
        this.deps.executionRepository.updateExecutionInvocation(latestInvocation.id, {
          status: "failed",
          finishedAt: reconciledAt,
          errorMessage: failureReason,
        });
        this.deps.executionRepository.appendExecutionInvocationMessage(latestInvocation.id, {
          role: "system",
          contentMarkdown: failureReason,
          metadata: {
            recovery: "startup_qa_review_reconcile",
            qaRunId: run.id,
          },
          createdAt: reconciledAt,
        });
      }

      const providerInvocation = latestInvocation?.providerInvocationId
        ? this.deps.executionRepository.getProviderInvocationUsage(latestInvocation.providerInvocationId)
        : null;
      if (providerInvocation?.status === "running") {
        this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
          status: "failed",
          finishedAt: reconciledAt,
          durationMs: calculateInvocationDurationMs(providerInvocation, reconciledAt),
        });
      }

      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "failed",
        summaryMarkdown: failureReason,
        finishedAt: reconciledAt,
      });
      reconciledRunIds.push(run.id);
    }

    return reconciledRunIds;
  }

  private findLatestQaExecutionInvocation(run: ReturnType<QaReviewRepository["listRunningRuns"]>[number]): ExecutionInvocationRecord | null {
    const invocations = run.taskRunId
      ? this.deps.executionRepository.listExecutionInvocations({
          projectId: run.projectId,
          taskRunId: run.taskRunId,
          limit: 20,
        })
      : run.sprintRunId
        ? this.deps.executionRepository.listExecutionInvocations({
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

  private resolveInterruptedQaRunReason(
    run: ReturnType<QaReviewRepository["listRunningRuns"]>[number],
    invocation: ExecutionInvocationRecord | null,
    activeContainerSessionIds: ReadonlySet<string>,
  ): string | null {
    const referenceAt = Date.parse(invocation?.lastMessageAt || invocation?.startedAt || run.startedAt);
    const ageMs = Number.isFinite(referenceAt) ? Date.now() - referenceAt : 0;

    if (!invocation) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} that never started its backing invocation. Code UX will retry the review.`;
    }

    if (invocation.status !== "running" && invocation.status !== "paused") {
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation ${invocation.status}. Code UX will retry the review.`;
    }

    if (!invocation.providerInvocationId) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing invocation stayed running without provider runtime linkage. Code UX will retry the review.`;
    }

    const providerInvocation = this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId);
    if (!providerInvocation) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing provider invocation disappeared. Code UX will retry the review.`;
    }

    if (providerInvocation.status !== "running") {
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after the backing provider invocation ${providerInvocation.status}. Code UX will retry the review.`;
    }

    if (
      providerInvocation.executionMode === "DOCKER"
      && !activeContainerSessionIds.has(providerInvocation.sessionId)
    ) {
      return `${RECOVERED_STALE_QA_SUMMARY_PREFIX} after its Docker container disappeared for session ${providerInvocation.sessionId}. Code UX will retry the review.`;
    }

    return null;
  }

  private async reconcileInterruptedStructuredInvocations(): Promise<string[]> {
    const executionRepository = this.deps.executionRepository as ExecutionRepository & {
      listActiveExecutionInvocationsByTypes?: (types: string[]) => ExecutionInvocationRecord[];
    };
    if (typeof executionRepository.listActiveExecutionInvocationsByTypes !== "function") {
      return [];
    }

    const invocations = executionRepository.listActiveExecutionInvocationsByTypes(["planning", "qa_review"]);
    if (invocations.length === 0) {
      return [];
    }

    const activeContainerSessionIds = await this.listActiveContainerSessionIds();
    const reconciledAt = new Date().toISOString();
    const reconciledInvocationIds: string[] = [];

    for (const invocation of invocations) {
      const failureReason = this.resolveInterruptedStructuredInvocationReason(invocation, activeContainerSessionIds);
      if (!failureReason) {
        continue;
      }

      this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
        status: "failed",
        finishedAt: reconciledAt,
        errorMessage: failureReason,
      });
      this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
        role: "system",
        contentMarkdown: failureReason,
        metadata: {
          recovery: "startup_structured_invocation_reconcile",
          provider: invocation.provider,
        },
        createdAt: reconciledAt,
      });

      const providerInvocation = invocation.providerInvocationId
        ? this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId)
        : null;
      if (providerInvocation?.status === "running") {
        this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
          status: "failed",
          finishedAt: reconciledAt,
          durationMs: calculateInvocationDurationMs(providerInvocation, reconciledAt),
        });
      }

      reconciledInvocationIds.push(invocation.id);
    }

    return reconciledInvocationIds;
  }

  private async reconcileInterruptedTaskCodingInvocations(): Promise<string[]> {
    const executionRepository = this.deps.executionRepository as ExecutionRepository & {
      listActiveExecutionInvocationsByTypes?: (types: string[]) => ExecutionInvocationRecord[];
    };
    if (typeof executionRepository.listActiveExecutionInvocationsByTypes !== "function") {
      return [];
    }

    const invocations = executionRepository.listActiveExecutionInvocationsByTypes([...TASK_CODING_INVOCATION_TYPES]);
    if (invocations.length === 0) {
      return [];
    }

    const activeContainerSessionIds = await this.listActiveContainerSessionIds();
    const reconciledAt = new Date().toISOString();
    const reconciledInvocationIds: string[] = [];

    for (const invocation of invocations) {
      const resolution = this.resolveInterruptedTaskCodingInvocation(invocation, activeContainerSessionIds);
      if (!resolution) {
        continue;
      }

      this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
        status: resolution.status,
        finishedAt: reconciledAt,
        errorMessage: resolution.status === "failed" ? resolution.message : null,
      });
      this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
        role: "system",
        contentMarkdown: resolution.message,
        metadata: {
          recovery: "startup_task_coding_invocation_reconcile",
          provider: invocation.provider,
          taskRunId: invocation.taskRunId || null,
        },
        createdAt: reconciledAt,
      });

      const providerInvocation = invocation.providerInvocationId
        ? this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId)
        : null;
      if (providerInvocation?.status === "running") {
        this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
          status: resolution.status,
          finishedAt: reconciledAt,
          durationMs: calculateInvocationDurationMs(providerInvocation, reconciledAt),
        });
      }

      reconciledInvocationIds.push(invocation.id);
    }

    return reconciledInvocationIds;
  }

  private resolveInterruptedTaskCodingInvocation(
    invocation: ExecutionInvocationRecord,
    activeContainerSessionIds: ReadonlySet<string>,
  ): { status: "completed" | "failed"; message: string } | null {
    const taskRun = invocation.taskRunId ? this.deps.executionRepository.getTaskRun(invocation.taskRunId) : null;
    if (taskRun && isTerminalTaskRunState(taskRun)) {
      return {
        status: taskRun.state === "COMPLETED" ? "completed" : "failed",
        message: `Recovered stale task coding invocation after the linked task run was already ${taskRun.state}.`,
      };
    }

    const sprintRun = invocation.sprintRunId ? this.deps.executionRepository.getSprintRun(invocation.sprintRunId) : null;
    if (sprintRun && ["completed", "failed", "cancelled"].includes(sprintRun.status)) {
      return {
        status: "failed",
        message: `Recovered stale task coding invocation after the linked sprint run was already ${sprintRun.status}.`,
      };
    }

    const referenceAt = Date.parse(invocation.lastMessageAt || invocation.startedAt);
    const ageMs = Number.isFinite(referenceAt) ? Date.now() - referenceAt : 0;

    if (!invocation.providerInvocationId) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return {
        status: "failed",
        message: "Recovered stale task coding invocation after it stayed running without provider runtime linkage.",
      };
    }

    const providerInvocation = this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId);
    if (!providerInvocation) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return {
        status: "failed",
        message: "Recovered stale task coding invocation after the backing provider invocation disappeared.",
      };
    }

    if (providerInvocation.status !== "running") {
      return {
        status: providerInvocation.status === "completed" ? "completed" : "failed",
        message: `Recovered stale task coding invocation after the backing provider invocation ${providerInvocation.status}.`,
      };
    }

    const providerResolution = this.resolveOrphanedTaskCodingProviderInvocation(providerInvocation);
    if (providerResolution) {
      return providerResolution;
    }

    if (
      providerInvocation.executionMode === "DOCKER"
      && !activeContainerSessionIds.has(providerInvocation.sessionId)
    ) {
      return {
        status: "failed",
        message: `Recovered stale task coding invocation after its Docker container disappeared for session ${providerInvocation.sessionId}.`,
      };
    }

    return null;
  }

  private reconcileOrphanedTaskCodingProviderInvocations(): string[] {
    const runningProviders = this.deps.executionRepository.listRunningProviderInvocationUsages()
      .filter((invocation) => invocation.purpose === "task_coding");
    if (runningProviders.length === 0) {
      return [];
    }

    const reconciledAt = new Date().toISOString();
    const reconciledProviderIds: string[] = [];

    for (const providerInvocation of runningProviders) {
      const resolution = this.resolveOrphanedTaskCodingProviderInvocation(providerInvocation);
      if (!resolution) {
        continue;
      }

      this.deps.executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
        status: resolution.status,
        finishedAt: reconciledAt,
        durationMs: calculateInvocationDurationMs(providerInvocation, reconciledAt),
      });

      const linkedExecutionInvocations = this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(providerInvocation.id);
      for (const executionInvocation of linkedExecutionInvocations) {
        if (executionInvocation.status !== "running" && executionInvocation.status !== "paused") {
          continue;
        }
        this.deps.executionRepository.updateExecutionInvocation(executionInvocation.id, {
          status: resolution.status,
          finishedAt: reconciledAt,
          errorMessage: resolution.status === "failed" ? resolution.message : null,
        });
        this.deps.executionRepository.appendExecutionInvocationMessage(executionInvocation.id, {
          role: "system",
          contentMarkdown: resolution.message,
          metadata: {
            recovery: "startup_task_coding_provider_reconcile",
            provider: providerInvocation.provider,
            sessionId: providerInvocation.sessionId,
          },
          createdAt: reconciledAt,
        });
      }

      reconciledProviderIds.push(providerInvocation.id);
    }

    return reconciledProviderIds;
  }

  private resolveOrphanedTaskCodingProviderInvocation(
    providerInvocation: ProviderInvocationUsageRecord,
  ): { status: "completed" | "failed"; message: string } | null {
    if (providerInvocation.purpose !== "task_coding" || providerInvocation.status !== "running") {
      return null;
    }
    if (providerInvocation.taskRunId) {
      const taskRun = this.deps.executionRepository.getTaskRun(providerInvocation.taskRunId);
      if (taskRun && !isTerminalTaskRunState(taskRun)) {
        return null;
      }
      if (taskRun?.state === "COMPLETED") {
        return {
          status: "completed",
          message: "Recovered stale task coding provider invocation after the linked task run completed.",
        };
      }
    }

    const task = providerInvocation.taskId
      ? this.deps.projectManagementRepository.getTask(providerInvocation.taskId)
      : null;
    if (task?.status === "completed" || task?.status === "coding_completed") {
      return {
        status: "completed",
        message: `Recovered stale task coding provider invocation after the project task was already ${task.status}.`,
      };
    }
    if (task?.status === "QA_REVIEW_FAILED") {
      return {
        status: "failed",
        message: "Recovered stale task coding provider invocation after the project task was already QA_REVIEW_FAILED.",
      };
    }

    const sprintRun = providerInvocation.sprintRunId
      ? this.deps.executionRepository.getSprintRun(providerInvocation.sprintRunId)
      : null;
    if (sprintRun && ["completed", "failed", "cancelled"].includes(sprintRun.status)) {
      return {
        status: "failed",
        message: `Recovered stale task coding provider invocation after the linked sprint run was already ${sprintRun.status}.`,
      };
    }

    if (providerInvocation.dispatchId) {
      const dispatch = this.deps.executionRepository.getTaskDispatch(providerInvocation.dispatchId);
      if (dispatch && ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])) {
        return null;
      }
    }

    const startedAtMs = Date.parse(providerInvocation.startedAt);
    const ageMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : 0;
    if (ageMs < QA_RUN_START_TIMEOUT_MS) {
      return null;
    }

    if (!providerInvocation.taskRunId && !providerInvocation.dispatchId) {
      return {
        status: "failed",
        message: "Recovered stale task coding provider invocation after it remained running without task-run or dispatch linkage.",
      };
    }

    return null;
  }

  private reconcileInterruptedTaskRuns(): string[] {
    const executionRepository = this.deps.executionRepository as ExecutionRepository & {
      listTaskRunsByStates?: (states: TaskRunRecord["state"][]) => TaskRunRecord[];
    };
    if (typeof executionRepository.listTaskRunsByStates !== "function") {
      return [];
    }

    const taskRuns = executionRepository.listTaskRunsByStates([...ACTIVE_TASK_RUN_STATES]);
    if (taskRuns.length === 0) {
      return [];
    }

    const runningProviderTaskRunIds = new Set(
      this.deps.executionRepository.listRunningProviderInvocationUsages()
        .map((invocation) => invocation.taskRunId)
        .filter((taskRunId): taskRunId is string => Boolean(taskRunId)),
    );
    const activeExecutionTaskRunIds = new Set(
      this.deps.executionRepository.listActiveExecutionInvocationsByTypes([...TASK_CODING_INVOCATION_TYPES])
        .map((invocation) => invocation.taskRunId)
        .filter((taskRunId): taskRunId is string => Boolean(taskRunId)),
    );
    const reconciledAt = new Date().toISOString();
    const reconciledTaskRunIds: string[] = [];

    for (const taskRun of taskRuns) {
      const resolution = this.resolveInterruptedTaskRun(
        taskRun,
        runningProviderTaskRunIds,
        activeExecutionTaskRunIds,
      );
      if (!resolution) {
        continue;
      }

      this.deps.executionRepository.updateTaskRun(taskRun.id, {
        connectionId: null,
        state: resolution.state,
        finishedAt: reconciledAt,
        durationMs: calculateDurationMs(taskRun, reconciledAt),
      });
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "task_run_reconciled", "system", {
        reason: resolution.message,
        previousState: taskRun.state,
      }, {
        sourceEventKey: `startup-recovery:task-run:${taskRun.id}:${taskRun.state}`,
      });

      if (resolution.resetTaskToPending) {
        this.deps.projectManagementRepository.updateTask(taskRun.taskId, {
          status: "pending",
        });
      }

      reconciledTaskRunIds.push(taskRun.id);
    }

    return reconciledTaskRunIds;
  }

  private reconcileStalePausedSprintRuns(): string[] {
    const pausedRuns = this.deps.executionRepository.listSprintRunsByStatus(["paused"]);
    if (pausedRuns.length === 0) {
      return [];
    }

    const reconciledAt = new Date().toISOString();
    const reconciledSprintRunIds: string[] = [];

    for (const sprintRun of pausedRuns) {
      // A paused run is a legitimate resting state (awaiting human action or a
      // pending merge) — leave it paused unless the sprint itself was taken to a
      // terminal state or deleted. Gating on rawStatus === "running" would fail
      // every healthy paused run on restart, because `sprints.status` is not the
      // source of truth for active orchestration (it commonly stays "idle").
      const rawStatus = this.deps.projectManagementRepository.getRawSprintStatus(sprintRun.sprintId);
      const sprintIsTerminalOrDeleted =
        rawStatus === null || rawStatus === "completed" || rawStatus === "cancelled";
      if (!sprintIsTerminalOrDeleted) {
        continue;
      }

      this.deps.executionRepository.updateSprintRun(sprintRun.id, {
        status: "failed",
        finishedAt: reconciledAt,
        lastHeartbeatAt: reconciledAt,
      });
      this.deps.executionRepository.appendSprintRunEvent(sprintRun.id, "sprint_failed", "system", {
        reason: "paused_run_associated_sprint_not_running",
        sprintStatus: rawStatus || "deleted",
      }, {
        sourceEventKey: `startup-recovery:paused-sprint-not-running:${sprintRun.id}`,
      });
      reconciledSprintRunIds.push(sprintRun.id);
    }

    return reconciledSprintRunIds;
  }

  private resolveInterruptedTaskRun(
    taskRun: TaskRunRecord,
    runningProviderTaskRunIds: ReadonlySet<string>,
    activeExecutionTaskRunIds: ReadonlySet<string>,
  ): { state: TaskRunRecord["state"]; message: string; resetTaskToPending: boolean } | null {
    const task = this.deps.projectManagementRepository.getTask(taskRun.taskId);
    if (task?.status === "completed" || task?.status === "coding_completed") {
      return {
        state: "COMPLETED",
        message: `Recovered stale task run after the project task was already ${task.status}.`,
        resetTaskToPending: false,
      };
    }
    if (task?.status === "QA_REVIEW_FAILED") {
      return {
        state: "FAILED",
        message: "Recovered stale task run after the project task was already QA_REVIEW_FAILED.",
        resetTaskToPending: false,
      };
    }

    const sprintRun = taskRun.sprintRunId ? this.deps.executionRepository.getSprintRun(taskRun.sprintRunId) : null;
    if (sprintRun && ["completed", "failed", "cancelled"].includes(sprintRun.status)) {
      return {
        state: "FAILED",
        message: `Recovered stale task run after the linked sprint run was already ${sprintRun.status}.`,
        resetTaskToPending: task?.status === "in_progress",
      };
    }

    if (taskRun.dispatchId) {
      const dispatch = this.deps.executionRepository.getTaskDispatch(taskRun.dispatchId);
      if (dispatch && ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])) {
        return null;
      }
    }

    if (runningProviderTaskRunIds.has(taskRun.id) || activeExecutionTaskRunIds.has(taskRun.id)) {
      return null;
    }

    const referenceAt = Date.parse(taskRun.startedAt || "");
    const ageMs = Number.isFinite(referenceAt) ? Date.now() - referenceAt : 0;
    if (ageMs < QA_RUN_START_TIMEOUT_MS) {
      return null;
    }

    return {
      state: "FAILED",
      message: "Recovered stale task run after it remained active without dispatch or provider runtime linkage.",
      resetTaskToPending: task?.status === "in_progress",
    };
  }

  private resolveInterruptedStructuredInvocationReason(
    invocation: ExecutionInvocationRecord,
    activeContainerSessionIds: ReadonlySet<string>,
  ): string | null {
    const referenceAt = Date.parse(invocation.lastMessageAt || invocation.startedAt);
    const ageMs = Number.isFinite(referenceAt) ? Date.now() - referenceAt : 0;
    const purpose = invocation.type === "qa_review" ? "QA review" : "planning";

    if (!invocation.providerInvocationId) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return `Recovered stale ${purpose} invocation after the backing invocation stayed running without provider runtime linkage.`;
    }

    const providerInvocation = this.deps.executionRepository.getProviderInvocationUsage(invocation.providerInvocationId);
    if (!providerInvocation) {
      if (ageMs < QA_RUN_START_TIMEOUT_MS) {
        return null;
      }
      return `Recovered stale ${purpose} invocation after the backing provider invocation disappeared.`;
    }

    if (providerInvocation.status !== "running") {
      return `Recovered stale ${purpose} invocation after the backing provider invocation ${providerInvocation.status}.`;
    }

    if (
      providerInvocation.executionMode === "DOCKER"
      && !activeContainerSessionIds.has(providerInvocation.sessionId)
    ) {
      return `Recovered stale ${purpose} invocation after its Docker container disappeared for session ${providerInvocation.sessionId}.`;
    }

    return null;
  }

  private async reconcileInterruptedCliInvocations(recoveredCliSessionIds: ReadonlySet<string>): Promise<string[]> {
    if (!this.deps.dockerService?.listContainers && recoveredCliSessionIds.size === 0) {
      return [];
    }

    const runningInvocations = this.deps.executionRepository.listRunningProviderInvocationUsages(
      Array.from(CLI_PROVIDERS),
    );
    if (runningInvocations.length === 0) {
      return [];
    }

    const activeContainerSessionIds = await this.listActiveContainerSessionIds();
    const reconciledInvocationIds: string[] = [];
    const reconciledAt = new Date().toISOString();

    for (const invocation of runningInvocations) {
      const failureReason = this.resolveInterruptedInvocationReason(
        invocation,
        recoveredCliSessionIds,
        activeContainerSessionIds,
      );
      if (!failureReason) {
        continue;
      }

      this.deps.executionRepository.updateProviderInvocationUsage(invocation.id, {
        status: "failed",
        finishedAt: reconciledAt,
        durationMs: calculateInvocationDurationMs(invocation, reconciledAt),
      });

      const linkedExecutionInvocations = this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(invocation.id);
      for (const executionInvocation of linkedExecutionInvocations) {
        if (executionInvocation.status !== "running" && executionInvocation.status !== "paused") {
          continue;
        }
        this.deps.executionRepository.updateExecutionInvocation(executionInvocation.id, {
          status: "failed",
          finishedAt: reconciledAt,
          errorMessage: failureReason,
        });
        this.deps.executionRepository.appendExecutionInvocationMessage(executionInvocation.id, {
          role: "system",
          contentMarkdown: failureReason,
          metadata: {
            recovery: "startup_cli_invocation_reconcile",
            provider: invocation.provider,
            sessionId: invocation.sessionId,
          },
          createdAt: reconciledAt,
        });
      }

      this.reconcileInterruptedTaskExecution(invocation, failureReason, reconciledAt);

      reconciledInvocationIds.push(invocation.id);
    }

    return reconciledInvocationIds;
  }

  private reconcileInterruptedRetryWaits(): string[] {
    const runningRetryInvocations = this.deps.executionRepository.listRunningRetryExecutionInvocations();
    if (runningRetryInvocations.length === 0) {
      return [];
    }

    const reconciledAt = new Date().toISOString();
    const reconciledInvocationIds: string[] = [];

    for (const invocation of runningRetryInvocations) {
      const retryAt = invocation.lastRetryAfterIso || "unknown";
      const retryAtMs = Date.parse(retryAt);
      const retryWindow = Number.isFinite(retryAtMs) && retryAtMs > Date.now()
        ? `The retry window is still active until ${retryAt}.`
        : `The retry time ${retryAt} has passed.`;
      const failureReason = [
        `Recovered interrupted ${invocation.type} invocation after Code UX restart while waiting for provider ${invocation.lastErrorCategory || "retry"} recovery.`,
        retryWindow,
        "The invocation was moved back to a retryable state so recovered orchestration can start a fresh continuation.",
      ].join(" ");

      this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
        status: "failed",
        finishedAt: reconciledAt,
        errorMessage: failureReason,
      });
      this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
        role: "system",
        contentMarkdown: failureReason,
        metadata: {
          recovery: "startup_provider_retry_wait_reconcile",
          provider: invocation.provider,
          model: invocation.model,
          errorCategory: invocation.lastErrorCategory,
          retryAfterIso: invocation.lastRetryAfterIso,
        },
        createdAt: reconciledAt,
      });

      this.reconcileInterruptedTaskExecutionInvocation(invocation, failureReason, reconciledAt);
      reconciledInvocationIds.push(invocation.id);
    }

    return reconciledInvocationIds;
  }

  private async identifyZombieWorkspaces(): Promise<void> {
    const projects = this.deps.projectManagementRepository.listProjects().projects;
    const sessions = this.deps.sessionTracking.listTrackedCliSessions();
    const activeSessionIds = new Set(sessions.map((s) => sanitizeToken(s.id)));

    for (const project of projects) {
      const worktreeRoot = path.join(project.baseDir, ".worktrees");
      try {
        const entries = await fs.promises.readdir(worktreeRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }

          const folderName = entry.name;
          if (!activeSessionIds.has(folderName)) {
            const zombiePath = path.join(worktreeRoot, folderName);
            this.deps.logger?.info(`[Recovery] Identified zombie workspace: ${zombiePath}`);
            await fs.promises.rm(zombiePath, { recursive: true, force: true }).catch(() => undefined);
          }
        }
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          this.deps.logger?.error("Failed to clean up zombie workspaces", { error: err });
        }
      }
    }
  }

  private releaseStaleSprintLeases(): void {
    const leases = this.deps.executionRepository.listAllLeases("sprint");
    for (const lease of leases) {
      const projectId = this.deps.executionRepository.resolveLeaseProjectId("sprint", lease.scopeId);
      if (projectId) {
        this.deps.executionRepository.releaseStaleSprintLease(projectId, lease.scopeId);
      }
    }
  }

  private reconcileInterruptedLocalDispatches(recoveredCliSessionIds: ReadonlySet<string>): string[] {
    const interruptedAt = new Date().toISOString();
    const reconciledDispatchIds: string[] = [];
    const activeLocalDispatches = this.deps.executionRepository.listTaskDispatchesByStatus(
      [...ACTIVE_DISPATCH_STATUSES],
      { executorType: "docker_cli" },
    );

    for (const dispatch of activeLocalDispatches) {
      const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(dispatch.id);
      if (taskRun && isTerminalTaskRunState(taskRun)) {
        continue;
      }

      const sessionRecovered = taskRun?.sessionId ? recoveredCliSessionIds.has(taskRun.sessionId) : false;
      const errorMessage = sessionRecovered
        ? "Local CLI execution was interrupted by Code UX restart. The task was moved back to a retryable state."
        : "Local CLI execution was interrupted before Code UX could persist a resumable session. The task was moved back to a retryable state.";

      this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
      this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
        connectionId: null,
        status: "failed",
        finishedAt: interruptedAt,
        lastHeartbeatAt: interruptedAt,
        errorMessage,
      });

      if (taskRun) {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          connectionId: null,
          state: "FAILED",
          finishedAt: interruptedAt,
          durationMs: calculateDurationMs(taskRun, interruptedAt),
        });
        this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "cli_workflow_failed", "system", {
          dispatchId: dispatch.id,
          reason: "runtime_restart_interrupted",
          recoveredSessionId: sessionRecovered ? taskRun.sessionId : null,
          errorMessage,
        }, {
          sourceEventKey: `startup-recovery:cli-interrupted:${dispatch.id}:${taskRun.id}`,
        });
      }

      this.deps.projectManagementRepository.updateTask(dispatch.taskId, {
        status: "pending",
      });

      if (dispatch.sprintRunId) {
        this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(dispatch.sprintRunId);
      }
      reconciledDispatchIds.push(dispatch.id);
    }

    return reconciledDispatchIds;
  }

  private reconcileInterruptedProviderDispatches(): string[] {
    const interruptedAt = new Date().toISOString();
    const reconciledDispatchIds: string[] = [];
    const activeJulesDispatches = this.deps.executionRepository.listTaskDispatchesByStatus(
      [...ACTIVE_DISPATCH_STATUSES],
      { executorType: "jules" },
    );

    for (const dispatch of activeJulesDispatches) {
      const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(dispatch.id);
      if (!taskRun || isTerminalTaskRunState(taskRun) || taskRun.sessionId || taskRun.sessionName) {
        continue;
      }

      const errorMessage = "Jules dispatch was interrupted before Code UX persisted a provider session. The task was moved back to a retryable state.";
      this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
      this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
        connectionId: null,
        status: "failed",
        finishedAt: interruptedAt,
        lastHeartbeatAt: interruptedAt,
        errorMessage,
      });
      this.deps.executionRepository.updateTaskRun(taskRun.id, {
        connectionId: null,
        state: "FAILED",
        finishedAt: interruptedAt,
        durationMs: calculateDurationMs(taskRun, interruptedAt),
      });
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_failed", "system", {
        dispatchId: dispatch.id,
        reason: "runtime_restart_interrupted_before_session",
        errorMessage,
      }, {
        sourceEventKey: `startup-recovery:jules-pre-session:${dispatch.id}:${taskRun.id}`,
      });
      this.deps.projectManagementRepository.updateTask(dispatch.taskId, {
        status: "pending",
      });

      if (dispatch.sprintRunId) {
        this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(dispatch.sprintRunId);
      }
      reconciledDispatchIds.push(dispatch.id);
    }

    return reconciledDispatchIds;
  }

  private resumeRecoverableSprintRuns(): { resumedSprintRunIds: string[]; supersededSprintRunIds: string[] } {
    const resumedSprintRunIds: string[] = [];
    const supersededSprintRunIds: string[] = [];
    const activeRuns = this.deps.executionRepository.listSprintRunsByStatus([...ACTIVE_SPRINT_RUN_STATUSES]);
    activeRuns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const recoveredSprintIds = new Set<string>();
    const recoveredAt = new Date().toISOString();

    for (const sprintRun of activeRuns) {
      if (recoveredSprintIds.has(sprintRun.sprintId)) {
        this.deps.executionRepository.updateSprintRun(sprintRun.id, {
          status: "failed",
          finishedAt: recoveredAt,
          lastHeartbeatAt: recoveredAt,
        });
        this.deps.executionRepository.appendSprintRunEvent(sprintRun.id, "sprint_failed", "system", {
          reason: "superseded_by_newer_active_run_on_startup",
        }, {
          sourceEventKey: `startup-recovery:superseded:${sprintRun.id}`,
        });
        supersededSprintRunIds.push(sprintRun.id);
        continue;
      }

      // Gate the recovery loop against the active in-memory orchestrator registry
      if (this.deps.sprintOrchestrator.isOrchestratingSprint && this.deps.sprintOrchestrator.isOrchestratingSprint(sprintRun.projectId, sprintRun.sprintId)) {
        continue;
      }

      // Only abandon the run when the sprint was explicitly taken to a terminal
      // state (completed/cancelled) or deleted out from under it. The raw
      // `sprints.status` column is NOT a reliable "is orchestrating" signal —
      // active orchestration lives on the sprint_run, and `sprints.status`
      // commonly stays "idle" the whole time (only cancel/complete flows write
      // it). Gating resume on rawStatus === "running" therefore force-failed
      // every in-flight run on restart, stranding sprints mid-cycle.
      const rawStatus = this.deps.projectManagementRepository.getRawSprintStatus(sprintRun.sprintId);
      const sprintIsTerminalOrDeleted =
        rawStatus === null || rawStatus === "completed" || rawStatus === "cancelled";
      if (sprintIsTerminalOrDeleted) {
        this.deps.executionRepository.updateSprintRun(sprintRun.id, {
          status: "failed",
          finishedAt: recoveredAt,
          lastHeartbeatAt: recoveredAt,
        });
        this.deps.executionRepository.appendSprintRunEvent(sprintRun.id, "sprint_failed", "system", {
          reason: "associated_sprint_not_running",
          sprintStatus: rawStatus || "deleted",
        }, {
          sourceEventKey: `startup-recovery:sprint-not-running:${sprintRun.id}`,
        });
        supersededSprintRunIds.push(sprintRun.id);
        continue;
      }

      recoveredSprintIds.add(sprintRun.sprintId);
      this.deps.executionRepository.releaseLease("sprint", sprintRun.sprintId);
      resumedSprintRunIds.push(sprintRun.id);

      void this.deps.sprintOrchestrator.recoverSprintRun(sprintRun.id).catch((error) => {
        this.deps.logger?.error("Failed to recover sprint run on startup", {
          sprintRunId: sprintRun.id,
          sprintId: sprintRun.sprintId,
          projectId: sprintRun.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return { resumedSprintRunIds, supersededSprintRunIds };
  }

  private async listActiveContainerSessionIds(): Promise<Set<string>> {
    if (!this.deps.dockerService?.listContainers) {
      return new Set();
    }

    const containers = await this.deps.dockerService.listContainers().catch(() => []);
    return new Set(
      containers
        .map((container) => container.labels?.["code-ux.session-id"]?.trim())
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    );
  }

  private resolveInterruptedInvocationReason(
    invocation: ProviderInvocationUsageRecord,
    recoveredCliSessionIds: ReadonlySet<string>,
    activeContainerSessionIds: ReadonlySet<string>,
  ): string | null {
    if (!CLI_PROVIDERS.has(invocation.provider as ProviderId)) {
      return null;
    }

    if (recoveredCliSessionIds.has(invocation.sessionId)) {
      return `Recovered stale ${invocation.purpose} invocation after Code UX restart. The backing CLI session (${invocation.sessionId}) was interrupted before completion.`;
    }

    const executionMode = this.resolveInvocationExecutionMode(invocation);
    if (executionMode === "DOCKER" && !activeContainerSessionIds.has(invocation.sessionId)) {
      return `Recovered stale ${invocation.purpose} invocation after Code UX restart. No active Docker container remained for session ${invocation.sessionId}.`;
    }

    return null;
  }

  private reconcileInterruptedTaskExecution(
    invocation: ProviderInvocationUsageRecord,
    failureReason: string,
    reconciledAt: string,
  ): void {
    if (invocation.purpose !== "task_coding" || !invocation.taskId) {
      return;
    }

    const task = this.deps.projectManagementRepository.getTask(invocation.taskId);
    if (!task || task.status !== "in_progress") {
      return;
    }

    if (invocation.dispatchId) {
      const dispatch = this.deps.executionRepository.getTaskDispatch(invocation.dispatchId);
      if (dispatch && ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])) {
        this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
        this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
          connectionId: null,
          status: "failed",
          finishedAt: reconciledAt,
          lastHeartbeatAt: reconciledAt,
          errorMessage: failureReason,
        });
      }
    }

    if (invocation.taskRunId) {
      const taskRun = this.deps.executionRepository.getTaskRun(invocation.taskRunId);
      if (taskRun && !isTerminalTaskRunState(taskRun)) {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          connectionId: null,
          state: "FAILED",
          finishedAt: reconciledAt,
          durationMs: calculateDurationMs(taskRun, reconciledAt),
        });
      }
      if (taskRun) {
        this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "cli_workflow_failed", "system", {
          dispatchId: invocation.dispatchId || null,
          providerInvocationId: invocation.id,
          reason: "runtime_restart_interrupted",
          recoveredSessionId: invocation.sessionId,
          errorMessage: failureReason,
        }, {
          sourceEventKey: `startup-recovery:cli-invocation:${invocation.id}:${taskRun.id}`,
        });
      }
    }

    this.deps.projectManagementRepository.updateTask(invocation.taskId, {
      status: "pending",
    });

    if (invocation.sprintRunId) {
      this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(invocation.sprintRunId);
    }
  }

  private reconcileInterruptedTaskExecutionInvocation(
    invocation: ExecutionInvocationRecord,
    failureReason: string,
    reconciledAt: string,
  ): void {
    if (!["cli_task_coding", "cli_task_followup"].includes(invocation.type) || !invocation.taskId) {
      return;
    }

    const task = this.deps.projectManagementRepository.getTask(invocation.taskId);
    if (!task || task.status !== "in_progress") {
      return;
    }

    if (invocation.dispatchId) {
      const dispatch = this.deps.executionRepository.getTaskDispatch(invocation.dispatchId);
      if (dispatch && ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])) {
        this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
        this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
          connectionId: null,
          status: "failed",
          finishedAt: reconciledAt,
          lastHeartbeatAt: reconciledAt,
          errorMessage: failureReason,
        });
      }
    }

    if (invocation.taskRunId) {
      const taskRun = this.deps.executionRepository.getTaskRun(invocation.taskRunId);
      if (taskRun && !isTerminalTaskRunState(taskRun)) {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          connectionId: null,
          state: "FAILED",
          finishedAt: reconciledAt,
          durationMs: calculateDurationMs(taskRun, reconciledAt),
        });
      }
      if (taskRun) {
        this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "cli_workflow_failed", "system", {
          dispatchId: invocation.dispatchId || null,
          executionInvocationId: invocation.id,
          providerInvocationId: invocation.providerInvocationId || null,
          reason: "runtime_restart_interrupted_retry_wait",
          errorMessage: failureReason,
        }, {
          sourceEventKey: `startup-recovery:retry-wait:${invocation.id}:${taskRun.id}`,
        });
      }
    }

    this.deps.projectManagementRepository.updateTask(invocation.taskId, {
      status: "pending",
    });

    if (invocation.sprintRunId) {
      this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(invocation.sprintRunId);
    }
  }

  private resolveInvocationExecutionMode(invocation: ProviderInvocationUsageRecord): ProviderInvocationUsageRecord["executionMode"] {
    if (invocation.executionMode) {
      return invocation.executionMode;
    }
    if (!this.deps.getDashboardSettings) {
      return null;
    }
    return this.deps.getDashboardSettings({
      projectId: invocation.projectId,
      sprintId: invocation.sprintId,
    }).cliWorkflow.executionMode;
  }
}

function isTerminalTaskRunState(taskRun: TaskRunRecord): boolean {
  return TERMINAL_TASK_RUN_STATES.has(taskRun.state);
}

function calculateDurationMs(taskRun: TaskRunRecord, finishedAt: string): number | null {
  if (!taskRun.startedAt) {
    return taskRun.durationMs;
  }
  return Math.max(0, new Date(finishedAt).getTime() - new Date(taskRun.startedAt).getTime());
}

function calculateInvocationDurationMs(invocation: ProviderInvocationUsageRecord, finishedAt: string): number | null {
  const startedAtMs = Date.parse(invocation.startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return invocation.durationMs;
  }
  return Math.max(0, finishedAtMs - startedAtMs);
}
