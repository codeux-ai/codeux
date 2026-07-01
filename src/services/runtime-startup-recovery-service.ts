import * as fs from "fs";
import * as path from "path";
import type { DashboardSettings, DashboardSettingsScope, DockerContainer, ProviderId } from "../contracts/app-types.js";
import type { ExecutionInvocationRecord, ProviderInvocationUsageRecord, TaskDispatchStatus, TaskRunRecord } from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { QaReviewRepository } from "../repositories/qa-review-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import type { Logger } from "../shared/logging/logger.js";
import { sanitizeToken } from "./cli-workflow-utils.js";
import { QaReviewRecoveryService } from "./runtime-recovery/qa-review-recovery.js";
import { InvocationRecoveryService } from "./runtime-recovery/invocation-recovery.js";
import { calculateInvocationDurationMs, isTerminalTaskRunState } from "./runtime-recovery/recovery-utils.js";
import { failStaleProviderInvocation } from "../domain/runtime/provider-invocation-recovery.js";

const ACTIVE_SPRINT_RUN_STATUSES = ["queued", "running"] as const;
const ACTIVE_DISPATCH_STATUSES = ["queued", "claimed", "running", "cancel_requested"] as const;
const TERMINAL_TASK_RUN_STATES = new Set(["COMPLETED", "FAILED", "BLOCKED", "QUOTA"]);
const TERMINAL_SPRINT_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_TASK_RUN_STATES = ["PENDING", "RUNNING", "PAUSED"] as const;
const TASK_CODING_INVOCATION_TYPES = ["task_coding", "cli_task_coding", "cli_task_followup"] as const;
const CLI_PROVIDERS = new Set<ProviderId>(["gemini", "codex", "claude-code", "qwen-code", "opencode"]);
const DURABLE_REMOTE_PROVIDERS = new Set(["jules"]);
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
  reconciledTerminalDispatchIds: string[];
  rehydratedSprintRunIds: string[];
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
    const activeContainerSessionIds = await this.listActiveContainerSessionIds();
    const qaReviewRecovery = new QaReviewRecoveryService({
      executionRepository: this.deps.executionRepository,
      qaReviewRepository: this.deps.qaReviewRepository,
    });
    const invocationRecovery = new InvocationRecoveryService({
      executionRepository: this.deps.executionRepository,
      sessionTracking: this.deps.sessionTracking,
      projectManagementRepository: this.deps.projectManagementRepository,
    });

    const cliRecovery = this.deps.sessionTracking.recoverInterruptedCliSessions();
    const recoveredCliSessionIds = cliRecovery.sessionIds;
    const reconciledLocalDispatchIds = this.reconcileInterruptedLocalDispatches(new Set(recoveredCliSessionIds));
    const reconciledProviderDispatchIds = this.reconcileInterruptedProviderDispatches();
    const reconciledRetryInvocationIds = this.reconcileInterruptedRetryWaits();
    const reconciledContainerInvocationIds = await this.reconcileInterruptedCliInvocations(new Set(recoveredCliSessionIds), activeContainerSessionIds);
    const reconciledQaReviewRunIds = await qaReviewRecovery.reconcileInterruptedQaReviewRuns(activeContainerSessionIds);
    const reconciledStructuredInvocationIds = await invocationRecovery.reconcileInterruptedStructuredInvocations(activeContainerSessionIds);
    const rehydratedSprintRunIds = this.rehydrateDurableProviderSprintRuns();
    const reconciledTaskCodingInvocationIds = await invocationRecovery.reconcileInterruptedTaskCodingInvocations(activeContainerSessionIds);
    const reconciledTaskCodingProviderIds = invocationRecovery.reconcileOrphanedTaskCodingProviderInvocations();
    const reconciledTerminalDispatchIds = this.reconcileTerminalTaskRunDispatches();
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
      || reconciledTerminalDispatchIds.length > 0
      || rehydratedSprintRunIds.length > 0
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
        reconciledTerminalDispatches: reconciledTerminalDispatchIds.length,
        rehydratedSprintRuns: rehydratedSprintRunIds.length,
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
      reconciledTerminalDispatchIds,
      rehydratedSprintRunIds,
      reconciledTaskRunIds,
      reconciledPausedSprintRunIds,
      resumedSprintRunIds,
      supersededSprintRunIds,
    };
  }

  private rehydrateDurableProviderSprintRuns(): string[] {
    const executionRepository = this.deps.executionRepository as ExecutionRepository & {
      listTaskRunsByStates?: (states: TaskRunRecord["state"][]) => TaskRunRecord[];
      reassignTaskRunSprintRun?: (taskRunId: string, sprintRunId: string) => TaskRunRecord;
      reassignTaskDispatchSprintRun?: (dispatchId: string, sprintRunId: string) => unknown;
      associateProviderInvocationRuntime?: (
        invocationId: string,
        input: { sprintRunId?: string | null; dispatchId?: string | null; taskRunId?: string | null },
      ) => ProviderInvocationUsageRecord;
    };
    if (
      typeof executionRepository.listTaskRunsByStates !== "function"
      || typeof executionRepository.reassignTaskRunSprintRun !== "function"
      || typeof executionRepository.reassignTaskDispatchSprintRun !== "function"
      || typeof executionRepository.associateProviderInvocationRuntime !== "function"
    ) {
      return [];
    }

    const durableTaskRuns = executionRepository.listTaskRunsByStates([...ACTIVE_TASK_RUN_STATES])
      .filter((taskRun) => this.isRecoverableDurableProviderTaskRun(taskRun));
    if (durableTaskRuns.length === 0) {
      return [];
    }

    const taskRunsBySprintId = new Map<string, TaskRunRecord[]>();
    for (const taskRun of durableTaskRuns) {
      const entries = taskRunsBySprintId.get(taskRun.sprintId) || [];
      entries.push(taskRun);
      taskRunsBySprintId.set(taskRun.sprintId, entries);
    }

    const now = new Date().toISOString();
    const rehydratedSprintRunIds = new Set<string>();

    for (const [sprintId, taskRuns] of taskRunsBySprintId.entries()) {
      const rawStatus = this.deps.projectManagementRepository.getRawSprintStatus(sprintId);
      if (rawStatus === null || rawStatus === "completed" || rawStatus === "cancelled") {
        continue;
      }

      const targetRun = this.resolveDurableProviderRecoverySprintRun(taskRuns);
      if (!targetRun) {
        continue;
      }

      const targetRunWasTerminal = TERMINAL_SPRINT_RUN_STATUSES.has(targetRun.status);
      if (TERMINAL_SPRINT_RUN_STATUSES.has(targetRun.status)) {
        this.deps.executionRepository.updateSprintRun(targetRun.id, {
          status: "running",
          startedAt: targetRun.startedAt || now,
          finishedAt: null,
          lastHeartbeatAt: now,
        });
        this.deps.executionRepository.appendSprintRunEvent(targetRun.id, "sprint_rehydrated", "system", {
          reason: "durable_provider_sessions_survived_restart",
          previousStatus: targetRun.status,
          durableProvider: "jules",
          recoveredTaskRunCount: taskRuns.length,
        }, {
          sourceEventKey: `startup-recovery:durable-provider-sprint:${targetRun.id}`,
        });
        rehydratedSprintRunIds.add(targetRun.id);
      }

      for (const originalTaskRun of taskRuns) {
        let taskRehydrated = targetRunWasTerminal;
        const taskRun = originalTaskRun.sprintRunId === targetRun.id
          ? originalTaskRun
          : executionRepository.reassignTaskRunSprintRun(originalTaskRun.id, targetRun.id);
        if (originalTaskRun.sprintRunId !== targetRun.id) {
          rehydratedSprintRunIds.add(targetRun.id);
          taskRehydrated = true;
        }

        let dispatchId = taskRun.dispatchId;
        if (dispatchId) {
          const dispatch = this.deps.executionRepository.getTaskDispatch(dispatchId);
          if (dispatch) {
            if (dispatch.sprintRunId !== targetRun.id) {
              executionRepository.reassignTaskDispatchSprintRun(dispatch.id, targetRun.id);
              rehydratedSprintRunIds.add(targetRun.id);
              taskRehydrated = true;
            }
            if (!ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])) {
              this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
                status: this.resolveRehydratedDispatchStatus(taskRun),
                startedAt: dispatch.startedAt || taskRun.startedAt || now,
                finishedAt: null,
                lastHeartbeatAt: now,
                errorMessage: null,
              });
              rehydratedSprintRunIds.add(targetRun.id);
              taskRehydrated = true;
            }
          } else {
            dispatchId = null;
          }
        }

        if (!taskRehydrated) {
          continue;
        }

        const sessionKey = this.resolveTaskRunSessionKey(taskRun);
        const usage = sessionKey
          ? this.deps.executionRepository.getLatestProviderInvocationUsageBySession(sessionKey, "task_coding")
          : null;
        if (usage) {
          executionRepository.associateProviderInvocationRuntime(usage.id, {
            sprintRunId: targetRun.id,
            dispatchId,
            taskRunId: taskRun.id,
          });
          if (usage.status !== "running") {
            this.deps.executionRepository.updateProviderInvocationUsage(usage.id, {
              status: "running",
              finishedAt: null,
              durationMs: null,
            });
          }
        }

        this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "task_run_rehydrated", "system", {
          reason: "durable_provider_session_survived_restart",
          previousSprintRunId: originalTaskRun.sprintRunId,
          sprintRunId: targetRun.id,
          dispatchId,
          provider: taskRun.provider,
          sessionId: taskRun.sessionId,
        }, {
          sourceEventKey: `startup-recovery:durable-task-run:${taskRun.id}:${targetRun.id}`,
        });
      }
    }

    return [...rehydratedSprintRunIds];
  }

  private isRecoverableDurableProviderTaskRun(taskRun: TaskRunRecord): boolean {
    return DURABLE_REMOTE_PROVIDERS.has(String(taskRun.provider || ""))
      && taskRun.mode === "jules"
      && Boolean(this.resolveTaskRunSessionKey(taskRun))
      && !isTerminalTaskRunState(taskRun);
  }

  private resolveDurableProviderRecoverySprintRun(taskRuns: TaskRunRecord[]): ReturnType<ExecutionRepository["getSprintRun"]> {
    const firstTaskRun = taskRuns[0];
    if (!firstTaskRun) {
      return null;
    }

    const activeRun = this.deps.executionRepository.findActiveSprintRun(firstTaskRun.projectId, firstTaskRun.sprintId);
    if (activeRun) {
      return activeRun;
    }

    const candidateRuns = new Map<string, NonNullable<ReturnType<ExecutionRepository["getSprintRun"]>>>();
    for (const taskRun of taskRuns) {
      if (!taskRun.sprintRunId) {
        continue;
      }
      const sprintRun = this.deps.executionRepository.getSprintRun(taskRun.sprintRunId);
      if (sprintRun) {
        candidateRuns.set(sprintRun.id, sprintRun);
      }
    }

    return [...candidateRuns.values()].sort((left, right) => (
      Date.parse(right.createdAt) - Date.parse(left.createdAt)
    ))[0] || null;
  }

  private resolveRehydratedDispatchStatus(taskRun: TaskRunRecord): "queued" | "running" | "paused" {
    if (taskRun.state === "PENDING") {
      return "queued";
    }
    if (taskRun.state === "PAUSED") {
      return "paused";
    }
    return "running";
  }

  private resolveTaskRunSessionKey(taskRun: TaskRunRecord): string | null {
    const sessionId = taskRun.sessionId?.trim();
    if (sessionId) {
      return sessionId;
    }
    const sessionName = taskRun.sessionName?.trim();
    if (!sessionName) {
      return null;
    }
    return sessionName.replace(/^sessions\//, "");
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

  private reconcileTerminalTaskRunDispatches(): string[] {
    const terminalRuns = this.deps.executionRepository.listTaskRunsByStates(["COMPLETED", "FAILED"]);
    if (terminalRuns.length === 0) {
      return [];
    }

    const reconciledAt = new Date().toISOString();
    const reconciledDispatchIds: string[] = [];

    for (const taskRun of terminalRuns) {
      if (!taskRun.dispatchId) {
        continue;
      }
      const dispatch = this.deps.executionRepository.getTaskDispatch(taskRun.dispatchId);
      if (!dispatch) {
        continue;
      }
      if (!dispatch.finishedAt && ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as typeof ACTIVE_DISPATCH_STATUSES[number])) {
        continue;
      }

      const expectedStatus: TaskDispatchStatus = taskRun.state === "COMPLETED" ? "completed" : "failed";
      const expectedErrorMessage = taskRun.state === "COMPLETED"
        ? null
        : (dispatch.errorMessage || `Task run ended in ${taskRun.state}`);
      if (dispatch.status === expectedStatus && dispatch.errorMessage === expectedErrorMessage) {
        continue;
      }

      this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
        status: expectedStatus,
        startedAt: dispatch.startedAt || taskRun.startedAt || reconciledAt,
        finishedAt: dispatch.finishedAt || taskRun.finishedAt || reconciledAt,
        lastHeartbeatAt: reconciledAt,
        errorMessage: expectedErrorMessage,
      });
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "task_dispatch_reconciled", "system", {
        reason: "terminal_task_run_dispatch_status_mismatch",
        taskRunState: taskRun.state,
        previousDispatchStatus: dispatch.status,
        nextDispatchStatus: expectedStatus,
      }, {
        sourceEventKey: `startup-recovery:terminal-dispatch:${dispatch.id}:${taskRun.state}`,
      });
      reconciledDispatchIds.push(dispatch.id);
    }

    return reconciledDispatchIds;
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

  private async reconcileInterruptedCliInvocations(
    recoveredCliSessionIds: ReadonlySet<string>,
    activeContainerSessionIds: ReadonlySet<string>,
  ): Promise<string[]> {
    if (!this.deps.dockerService?.listContainers && recoveredCliSessionIds.size === 0) {
      return [];
    }

    const runningInvocations = this.deps.executionRepository.listRunningProviderInvocationUsages(
      Array.from(CLI_PROVIDERS),
    );
    if (runningInvocations.length === 0) {
      return [];
    }

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

      const linkedExecutionInvocations = this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(invocation.id);
      failStaleProviderInvocation(
        this.deps.executionRepository,
        invocation,
        linkedExecutionInvocations,
        {
          reconciledAt,
          recoveryReason: "startup_cli_invocation_reconcile",
          systemMessage: failureReason,
        }
      );

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

function calculateDurationMs(taskRun: TaskRunRecord, finishedAt: string): number | null {
  if (!taskRun.startedAt) {
    return taskRun.durationMs;
  }
  return Math.max(0, new Date(finishedAt).getTime() - new Date(taskRun.startedAt).getTime());
}
