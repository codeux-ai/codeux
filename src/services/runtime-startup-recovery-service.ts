import * as fs from "fs";
import * as path from "path";
import type { DashboardSettings, DashboardSettingsScope, DockerContainer, ProviderId } from "../contracts/app-types.js";
import type { ExecutionInvocationRecord, ProviderInvocationUsageRecord, TaskRunRecord } from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import type { Logger } from "../shared/logging/logger.js";
import { sanitizeToken } from "./cli-workflow-utils.js";

const ACTIVE_SPRINT_RUN_STATUSES = ["queued", "running"] as const;
const ACTIVE_DISPATCH_STATUSES = ["queued", "claimed", "running", "cancel_requested"] as const;
const TERMINAL_TASK_RUN_STATES = new Set(["COMPLETED", "FAILED", "BLOCKED", "QUOTA"]);
const CLI_PROVIDERS = new Set<ProviderId>(["gemini", "codex", "claude-code", "qwen-code", "opencode"]);

export interface RuntimeStartupRecoveryResult {
  recoveredCliSessionIds: string[];
  reconciledLocalDispatchIds: string[];
  reconciledProviderDispatchIds: string[];
  reconciledContainerInvocationIds: string[];
  reconciledRetryInvocationIds: string[];
  resumedSprintRunIds: string[];
  supersededSprintRunIds: string[];
}

interface RuntimeStartupRecoveryServiceDeps {
  sessionTracking: SessionTrackingRepository;
  executionRepository: ExecutionRepository;
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
    const { resumedSprintRunIds, supersededSprintRunIds } = this.resumeRecoverableSprintRuns();

    if (
      recoveredCliSessionIds.length > 0
      || reconciledLocalDispatchIds.length > 0
      || reconciledProviderDispatchIds.length > 0
      || reconciledRetryInvocationIds.length > 0
      || reconciledContainerInvocationIds.length > 0
      || resumedSprintRunIds.length > 0
      || supersededSprintRunIds.length > 0
    ) {
      this.deps.logger?.info("Recovered runtime state on startup", {
        recoveredCliSessions: recoveredCliSessionIds.length,
        reconciledLocalDispatches: reconciledLocalDispatchIds.length,
        reconciledProviderDispatches: reconciledProviderDispatchIds.length,
        reconciledRetryInvocations: reconciledRetryInvocationIds.length,
        reconciledContainerInvocations: reconciledContainerInvocationIds.length,
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
      resumedSprintRunIds,
      supersededSprintRunIds,
    };
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
