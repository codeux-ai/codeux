import * as fs from "fs";
import * as path from "path";
import type {
  DashboardSettings,
  DashboardSettingsScope,
  DockerContainer,
  ProviderId,
  RestartInvocationPolicy,
  RestartSprintPolicy,
} from "../contracts/app-types.js";
import type { ExecutionInvocationRecord, ProviderInvocationUsageRecord, TaskDispatchRecord, TaskDispatchStatus, TaskRunRecord } from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { QaReviewRepository } from "../repositories/qa-review-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import { sanitizeToken } from "./cli-workflow-utils.js";
import { QaReviewRecoveryService } from "./runtime-recovery/qa-review-recovery.js";
import { InvocationRecoveryService } from "./runtime-recovery/invocation-recovery.js";
import { calculateInvocationDurationMs, isTerminalTaskRunState } from "./runtime-recovery/recovery-utils.js";
import { cancelStaleProviderInvocation, failStaleProviderInvocation } from "../domain/runtime/provider-invocation-recovery.js";
import type { GuardrailService } from "./guardrail-service.js";
import type { SprintRunLifecycleService } from "./sprint-run-lifecycle-service.js";
import { runCommandStrict } from "./cli-process-runner.js";

const ACTIVE_SPRINT_RUN_STATUSES = ["queued", "running"] as const;
const ACTIVE_DISPATCH_STATUSES = ["queued", "claimed", "running", "cancel_requested"] as const;
const TERMINAL_TASK_RUN_STATES = new Set(["COMPLETED", "FAILED", "BLOCKED", "QUOTA"]);
const TERMINAL_SPRINT_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const ACTIVE_TASK_RUN_STATES = ["PENDING", "RUNNING", "PAUSED"] as const;
const TASK_CODING_INVOCATION_TYPES = ["task_coding", "cli_task_coding", "cli_task_followup"] as const;
const TERMINAL_PROVIDER_INVOCATION_STATUSES = new Set(["completed", "failed", "cancelled"]);
const CLI_PROVIDERS = new Set<ProviderId>(["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"]);
const DURABLE_REMOTE_PROVIDERS = new Set(["jules"]);
const QA_RUN_START_TIMEOUT_MS = 60_000;

interface RestartPolicies {
  sprintPolicy: RestartSprintPolicy;
  invocationPolicy: RestartInvocationPolicy;
}

function parseSprintOrchestratorOwnerPid(ownerKey: string): number | null {
  const match = /^sprint_orchestrator:(\d+)$/.exec(ownerKey);
  if (!match) {
    return null;
  }
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export interface RuntimeStartupRecoveryResult {
  recoveredCliSessionIds: string[];
  reconciledLocalDispatchIds: string[];
  reconciledProviderDispatchIds: string[];
  reconciledContainerInvocationIds: string[];
  reconciledQaReviewRunIds: string[];
  reconciledTerminalProviderLinkedInvocationIds: string[];
  demotedPrematureMergeConflictEscalationIds: string[];
  reconciledStructuredInvocationIds: string[];
  reconciledTaskCodingInvocationIds: string[];
  reconciledTaskCodingProviderIds: string[];
  reconciledTerminalProviderDispatchIds: string[];
  reconciledTerminalDispatchIds: string[];
  rehydratedSprintRunIds: string[];
  reconciledTaskRunIds: string[];
  reconciledPausedSprintRunIds: string[];
  reconciledRetryInvocationIds: string[];
  resumedSprintRunIds: string[];
  supersededSprintRunIds: string[];
  restartPolicyPausedSprintRunIds: string[];
  restartPolicyCancelledSprintRunIds: string[];
  restartPolicySyncedPausedSprintIds: string[];
  restartPolicySyncedOrphanedSprintIds: string[];
  reconciledDuplicateDispatchIds: string[];
}

interface RuntimeStartupRecoveryServiceDeps {
  sessionTracking: SessionTrackingRepository;
  executionRepository: ExecutionRepository;
  sprintRunLifecycleService: SprintRunLifecycleService;
  qaReviewRepository?: QaReviewRepository;
  projectManagementRepository: ProjectManagementRepository;
  projectAttentionService?: Pick<ProjectAttentionService, "listActiveProjectItems" | "openItem" | "resolveItem">;
  guardrailService?: Pick<GuardrailService, "evaluate">;
  sprintOrchestrator: SprintOrchestrator;
  dockerService?: Pick<{ listContainers: () => Promise<DockerContainer[]>; removeContainers: (containerIds: string[], options?: { removeVolumes?: boolean }) => Promise<void> }, "listContainers"> & {
    removeContainers?: (containerIds: string[], options?: { removeVolumes?: boolean }) => Promise<void>;
  };
  getDashboardSettings?: (scope?: DashboardSettingsScope) => DashboardSettings;
  isProcessAlive?: (pid: number) => boolean;
  logger?: Logger;
}

export class RuntimeStartupRecoveryService {
  constructor(private readonly deps: RuntimeStartupRecoveryServiceDeps) {}

  async recover(): Promise<RuntimeStartupRecoveryResult> {
    this.releaseStaleSprintLeases();
    await this.identifyZombieWorkspaces();
    const activeContainerSessionIds = await this.listActiveContainerSessionIds();
    const restartPolicies = this.resolveRestartPolicies();
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
    const restartPolicySyncedPausedSprintIds = this.syncPausedSprintProjections();
    const restartPolicyResult = this.applyRestartSprintPolicy(restartPolicies.sprintPolicy);
    const shouldRecoverInterruptedInvocations = restartPolicies.sprintPolicy === "continue";
    const reconciledLocalDispatchIds = shouldRecoverInterruptedInvocations
      ? await this.reconcileInterruptedLocalDispatches(new Set(recoveredCliSessionIds), activeContainerSessionIds, restartPolicies.invocationPolicy)
      : [];
    const reconciledProviderDispatchIds = shouldRecoverInterruptedInvocations
      ? this.reconcileInterruptedProviderDispatches(restartPolicies.invocationPolicy)
      : [];
    const reconciledRetryInvocationIds = shouldRecoverInterruptedInvocations
      ? this.reconcileInterruptedRetryWaits(restartPolicies.invocationPolicy)
      : [];
    const reconciledContainerInvocationIds = shouldRecoverInterruptedInvocations
      ? await this.reconcileInterruptedCliInvocations(new Set(recoveredCliSessionIds), activeContainerSessionIds, restartPolicies.invocationPolicy)
      : [];
    const reconciledQaReviewRunIds = await qaReviewRecovery.reconcileInterruptedQaReviewRuns(activeContainerSessionIds);
    const reconciledTerminalProviderLinkedInvocationIds = invocationRecovery.reconcileTerminalProviderLinkedInvocations();
    const demotedPrematureMergeConflictEscalationIds = await this.demotePrematureMergeConflictEscalations();
    const reconciledStructuredInvocationIds = await invocationRecovery.reconcileInterruptedStructuredInvocations(activeContainerSessionIds);
    const rehydratedSprintRunIds = this.rehydrateDurableProviderSprintRuns();
    const restartPolicySyncedOrphanedSprintIds = this.syncOrphanedRunningSprintProjections();
    const reconciledTerminalProviderDispatchIds = this.reconcileTerminalProviderBackedDispatches();
    const reconciledTerminalDispatchIds = this.reconcileTerminalTaskRunDispatches();
    // Settle task/dispatch truth before the workflow-level audit row. Provider
    // completion alone does not mean a CLI workflow completed because Git and
    // PR finalization happen after the provider exits.
    const reconciledTaskCodingInvocationIds = await invocationRecovery.reconcileInterruptedTaskCodingInvocations(activeContainerSessionIds);
    const reconciledTaskCodingProviderIds = invocationRecovery.reconcileOrphanedTaskCodingProviderInvocations();
    const reconciledDuplicateDispatchIds = this.reconcileDuplicateActiveTaskDispatches();
    const reconciledTaskRunIds = this.reconcileInterruptedTaskRuns();
    const reconciledPausedSprintRunIds = this.reconcileStalePausedSprintRuns();
    const { resumedSprintRunIds, supersededSprintRunIds } = restartPolicies.sprintPolicy === "continue"
      ? this.resumeRecoverableSprintRuns()
      : { resumedSprintRunIds: [], supersededSprintRunIds: [] };

    if (
      recoveredCliSessionIds.length > 0
      || reconciledLocalDispatchIds.length > 0
      || reconciledProviderDispatchIds.length > 0
      || reconciledRetryInvocationIds.length > 0
      || reconciledContainerInvocationIds.length > 0
      || reconciledQaReviewRunIds.length > 0
      || reconciledTerminalProviderLinkedInvocationIds.length > 0
      || demotedPrematureMergeConflictEscalationIds.length > 0
      || reconciledStructuredInvocationIds.length > 0
      || reconciledTaskCodingInvocationIds.length > 0
      || reconciledTaskCodingProviderIds.length > 0
      || reconciledTerminalProviderDispatchIds.length > 0
      || reconciledTerminalDispatchIds.length > 0
      || reconciledDuplicateDispatchIds.length > 0
      || rehydratedSprintRunIds.length > 0
      || reconciledTaskRunIds.length > 0
      || reconciledPausedSprintRunIds.length > 0
      || restartPolicySyncedPausedSprintIds.length > 0
      || restartPolicySyncedOrphanedSprintIds.length > 0
      || restartPolicyResult.pausedSprintRunIds.length > 0
      || restartPolicyResult.cancelledSprintRunIds.length > 0
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
        reconciledTerminalProviderLinkedInvocations: reconciledTerminalProviderLinkedInvocationIds.length,
        demotedPrematureMergeConflictEscalations: demotedPrematureMergeConflictEscalationIds.length,
        reconciledStructuredInvocations: reconciledStructuredInvocationIds.length,
        reconciledTaskCodingInvocations: reconciledTaskCodingInvocationIds.length,
        reconciledTaskCodingProviders: reconciledTaskCodingProviderIds.length,
        reconciledTerminalProviderDispatches: reconciledTerminalProviderDispatchIds.length,
        reconciledTerminalDispatches: reconciledTerminalDispatchIds.length,
        reconciledDuplicateDispatches: reconciledDuplicateDispatchIds.length,
        rehydratedSprintRuns: rehydratedSprintRunIds.length,
        reconciledTaskRuns: reconciledTaskRunIds.length,
        reconciledPausedSprintRuns: reconciledPausedSprintRunIds.length,
        restartPolicySyncedPausedSprints: restartPolicySyncedPausedSprintIds.length,
        restartPolicySyncedOrphanedSprints: restartPolicySyncedOrphanedSprintIds.length,
        restartPolicyPausedSprintRuns: restartPolicyResult.pausedSprintRunIds.length,
        restartPolicyCancelledSprintRuns: restartPolicyResult.cancelledSprintRunIds.length,
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
      reconciledTerminalProviderLinkedInvocationIds,
      demotedPrematureMergeConflictEscalationIds,
      reconciledStructuredInvocationIds,
      reconciledTaskCodingInvocationIds,
      reconciledTaskCodingProviderIds,
      reconciledTerminalProviderDispatchIds,
      reconciledTerminalDispatchIds,
      rehydratedSprintRunIds,
      reconciledTaskRunIds,
      reconciledPausedSprintRunIds,
      restartPolicySyncedPausedSprintIds,
      restartPolicySyncedOrphanedSprintIds,
      reconciledDuplicateDispatchIds,
      restartPolicyPausedSprintRunIds: restartPolicyResult.pausedSprintRunIds,
      restartPolicyCancelledSprintRunIds: restartPolicyResult.cancelledSprintRunIds,
      resumedSprintRunIds,
      supersededSprintRunIds,
    };
  }

  private async demotePrematureMergeConflictEscalations(): Promise<string[]> {
    const projectAttentionService = this.deps.projectAttentionService;
    const guardrailService = this.deps.guardrailService;
    if (!projectAttentionService || !guardrailService) {
      return [];
    }

    const demotedIds: string[] = [];
    const projects = this.deps.projectManagementRepository.listProjects().projects;

    for (const project of projects) {
      const items = projectAttentionService.listActiveProjectItems(project.id);
      for (const item of items) {
        if (
          item.ownerType !== "human"
          || item.attentionType !== "human_escalation_required"
          || !item.taskId
          || item.payload?.sourceAttentionType !== "merge_conflict"
          || item.payload?.escalatedBy !== "virtual_worker"
        ) {
          continue;
        }

        const alreadyResolved = await this.isEscalatedMergeConflictAlreadyResolved(item);
        if (alreadyResolved) {
          const task = this.deps.projectManagementRepository.getTask(item.taskId);
          if (task?.mergeIndicator === "MERGE_CONFLICT") {
            this.deps.projectManagementRepository.updateTask(item.taskId, {
              mergeIndicator: null,
              isMerged: false,
            });
          }
          projectAttentionService.resolveItem(item.id, {
            status: "dismissed",
          reason: "startup_resolved_merge_conflict_escalation_dismissed",
            resolutionSummaryMarkdown: [
              "Startup recovery dismissed this stale merge-conflict escalation because Git already shows the worker branch contained in the target branch.",
              "",
              "The task remains unmerged so the normal merge gate can retry without reopening the same stale conflict.",
            ].join("\n"),
            payloadPatch: {
              recoveredByStartup: true,
              recoveryReason: "startup_resolved_merge_conflict_escalation_dismissed",
            },
          });
          demotedIds.push(item.id);
          continue;
        }

        const guardrail = guardrailService.evaluate(
          { projectId: item.projectId, sprintId: item.sprintId },
          item.taskId,
          "merge_conflict",
        );
        if (!guardrail.allowed && guardrail.action !== "WARN_ONLY") {
          continue;
        }

        const restoredTitle = item.title.replace(/^Virtual worker escalation:\s*/i, "").trim()
          || "Merge conflict requires automatic resolution";
        const payload = {
          ...(item.payload || {}),
          recoveredFromHumanEscalationItemId: item.id,
          recoveryReason: "startup_premature_merge_conflict_escalation_demoted",
          mergeConflictRetryCount: guardrail.count,
          mergeConflictRetryCap: guardrail.cap,
        };

        projectAttentionService.openItem({
          projectId: item.projectId,
          sprintId: item.sprintId,
          taskId: item.taskId,
          sprintRunId: item.sprintRunId,
          dispatchId: item.dispatchId,
          attentionType: "merge_conflict",
          severity: item.severity,
          ownerType: "worker",
          title: restoredTitle,
          summaryMarkdown: item.summaryMarkdown,
          payload,
        });
        projectAttentionService.resolveItem(item.id, {
          status: "dismissed",
          reason: "startup_premature_merge_conflict_escalation_demoted",
          resolutionSummaryMarkdown: [
            "Startup recovery moved this premature merge-conflict escalation back to automatic virtual-worker handling.",
            "",
            `The merge-conflict guardrail still allowed another attempt (${guardrail.count}/${guardrail.cap > 0 ? guardrail.cap : "∞"}).`,
          ].join("\n"),
          payloadPatch: {
            recoveredByStartup: true,
            recoveryReason: "startup_premature_merge_conflict_escalation_demoted",
          },
        });
        demotedIds.push(item.id);
      }
    }

    return demotedIds;
  }

  private async isEscalatedMergeConflictAlreadyResolved(item: {
    payload?: Record<string, unknown> | null;
  }): Promise<boolean> {
    const payload = item.payload || {};
    const repoPath = typeof payload.repoPath === "string" ? payload.repoPath.trim() : "";
    const conflictingBranches = payload.conflictingBranches && typeof payload.conflictingBranches === "object"
      ? payload.conflictingBranches as Record<string, unknown>
      : {};
    const sourceBranch = typeof conflictingBranches.source === "string"
      ? conflictingBranches.source.trim()
      : (typeof payload.workerBranch === "string" ? payload.workerBranch.trim() : "");
    const targetBranch = typeof conflictingBranches.target === "string"
      ? conflictingBranches.target.trim()
      : (typeof payload.featureBranch === "string" ? payload.featureBranch.trim() : "");

    if (!repoPath || !sourceBranch || !targetBranch) {
      return false;
    }

    const candidatePairs: Array<[string, string]> = [
      [sourceBranch, targetBranch],
      [`origin/${sourceBranch}`, `origin/${targetBranch}`],
    ];
    for (const [sourceRef, targetRef] of candidatePairs) {
      try {
        await runCommandStrict("git", ["merge-base", "--is-ancestor", sourceRef, targetRef], repoPath);
        return true;
      } catch {
        // Try the next available ref form; startup recovery must stay best-effort.
      }
    }

    return false;
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
      if (rawStatus === null || rawStatus === "completed" || rawStatus === "failed" || rawStatus === "cancelled") {
        continue;
      }

      const targetRun = this.resolveDurableProviderRecoverySprintRun(taskRuns);
      if (!targetRun) {
        continue;
      }

      const targetRunWasTerminal = TERMINAL_SPRINT_RUN_STATUSES.has(targetRun.status);
      if (TERMINAL_SPRINT_RUN_STATUSES.has(targetRun.status)) {
        this.deps.sprintRunLifecycleService.updateRun(targetRun.id, {
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
        this.resetTaskToPending(taskRun.taskId);
      } else if (resolution.state === "COMPLETED") {
        this.reconcileCompletedTaskStatus(taskRun.taskId);
      }

      reconciledTaskRunIds.push(taskRun.id);
    }

    return reconciledTaskRunIds;
  }

  private reconcileCompletedTaskStatus(taskId: string): void {
    const task = this.deps.projectManagementRepository.getTask(taskId);
    if (!task || task.status !== "in_progress") {
      return;
    }
    this.deps.projectManagementRepository.updateTask(taskId, {
      status: task.isMerged ? "completed" : "coding_completed",
    });
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
      if (dispatch.status === "cancelled") {
        continue;
      }
      const trackedSession = taskRun.sessionId ? this.deps.sessionTracking.getSession(taskRun.sessionId) : null;
      if (
        taskRun.state === "FAILED"
        && (trackedSession?.state === "CANCELLED" || dispatch.errorMessage === "Provider session CANCELLED")
      ) {
        this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
          status: "cancelled",
          startedAt: dispatch.startedAt || taskRun.startedAt || reconciledAt,
          finishedAt: dispatch.finishedAt || taskRun.finishedAt || reconciledAt,
          lastHeartbeatAt: reconciledAt,
          errorMessage: null,
        });
        this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "task_dispatch_reconciled", "system", {
          reason: "cancelled_session_dispatch_status_mismatch",
          taskRunState: taskRun.state,
          sessionState: trackedSession?.state || "CANCELLED",
          previousDispatchStatus: dispatch.status,
          nextDispatchStatus: "cancelled",
        }, {
          sourceEventKey: `startup-recovery:cancelled-dispatch:${dispatch.id}`,
        });
        reconciledDispatchIds.push(dispatch.id);
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

  private reconcileTerminalProviderBackedDispatches(): string[] {
    const activeDispatches = this.deps.executionRepository.listTaskDispatchesByStatus([...ACTIVE_DISPATCH_STATUSES]);
    if (activeDispatches.length === 0) {
      return [];
    }

    const reconciledAt = new Date().toISOString();
    const reconciledDispatchIds: string[] = [];

    for (const dispatch of activeDispatches) {
      const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(dispatch.id);
      if (!taskRun || isTerminalTaskRunState(taskRun)) {
        continue;
      }

      const linkedProviderInvocations = this.deps.executionRepository
        .listProviderInvocationsForTask(dispatch.projectId, dispatch.taskId)
        .filter((invocation) => (
          TASK_CODING_INVOCATION_TYPES.includes(invocation.purpose as typeof TASK_CODING_INVOCATION_TYPES[number])
          && (invocation.dispatchId === dispatch.id || invocation.taskRunId === taskRun.id)
        ));
      if (
        linkedProviderInvocations.length === 0
        || linkedProviderInvocations.some((invocation) => invocation.status === "running")
      ) {
        continue;
      }

      const terminalProviderInvocation = linkedProviderInvocations
        .filter((invocation) => TERMINAL_PROVIDER_INVOCATION_STATUSES.has(invocation.status))
        .sort((left, right) => this.providerInvocationActivityMs(right) - this.providerInvocationActivityMs(left))[0];
      if (!terminalProviderInvocation) {
        continue;
      }

      const task = this.deps.projectManagementRepository.getTask(dispatch.taskId);
      const taskAlreadyCodeComplete = task?.status === "coding_completed" || task?.status === "completed";
      const providerCompletedSettledTask = terminalProviderInvocation.status === "completed" && taskAlreadyCodeComplete;
      const nextDispatchStatus: TaskDispatchStatus = providerCompletedSettledTask
        ? "completed"
        : terminalProviderInvocation.status === "cancelled"
          ? "cancelled"
          : "failed";
      const nextTaskRunState: TaskRunRecord["state"] = providerCompletedSettledTask ? "COMPLETED" : "FAILED";
      const errorMessage = providerCompletedSettledTask
        ? null
        : `Startup recovery closed active dispatch after linked provider invocation ended as ${terminalProviderInvocation.status}.`;

      this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
      this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
        connectionId: null,
        status: nextDispatchStatus,
        startedAt: dispatch.startedAt || taskRun.startedAt || terminalProviderInvocation.startedAt || reconciledAt,
        finishedAt: dispatch.finishedAt || taskRun.finishedAt || terminalProviderInvocation.finishedAt || reconciledAt,
        lastHeartbeatAt: reconciledAt,
        errorMessage,
      });
      this.deps.executionRepository.updateTaskRun(taskRun.id, {
        connectionId: null,
        state: nextTaskRunState,
        finishedAt: taskRun.finishedAt || terminalProviderInvocation.finishedAt || reconciledAt,
        durationMs: calculateDurationMs(taskRun, terminalProviderInvocation.finishedAt || reconciledAt),
      });
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "task_dispatch_reconciled", "system", {
        reason: "terminal_provider_active_dispatch_mismatch",
        providerInvocationId: terminalProviderInvocation.id,
        providerStatus: terminalProviderInvocation.status,
        previousDispatchStatus: dispatch.status,
        nextDispatchStatus,
        previousTaskRunState: taskRun.state,
        nextTaskRunState,
      }, {
        sourceEventKey: `startup-recovery:terminal-provider-dispatch:${dispatch.id}:${terminalProviderInvocation.id}`,
      });

      if (!providerCompletedSettledTask && task?.status === "in_progress") {
        this.resetTaskToPending(dispatch.taskId);
      }

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

      this.deps.sprintRunLifecycleService.updateRun(sprintRun.id, {
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
    if (taskRun.state === "PAUSED" && sprintRun?.status === "paused") {
      return null;
    }
    if (sprintRun && ["completed", "failed", "cancelled"].includes(sprintRun.status)) {
      return {
        state: "FAILED",
        message: `Recovered stale task run after the linked sprint run was already ${sprintRun.status}.`,
        resetTaskToPending: task?.status === "in_progress",
      };
    }

    const dispatch = taskRun.dispatchId ? this.deps.executionRepository.getTaskDispatch(taskRun.dispatchId) : null;
    if (dispatch) {
      if (ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])) {
        return null;
      }
    }

    if (runningProviderTaskRunIds.has(taskRun.id) || activeExecutionTaskRunIds.has(taskRun.id)) {
      return null;
    }

    if (!dispatch && task?.status === "in_progress" && this.taskHasCompletedDispatch(taskRun)) {
      return {
        state: "COMPLETED",
        message: "Recovered stale task run after the same task already had a completed dispatch.",
        resetTaskToPending: false,
      };
    }

    if (dispatch && !ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])) {
      const dispatchCompleted = dispatch.status === "completed";
      return {
        state: dispatchCompleted ? "COMPLETED" : "FAILED",
        message: `Recovered stale task run after the linked dispatch was already ${dispatch.status}.`,
        resetTaskToPending: !dispatchCompleted && task?.status === "in_progress",
      };
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

  private taskHasCompletedDispatch(taskRun: TaskRunRecord): boolean {
    return this.deps.executionRepository.listTaskDispatches({
      projectId: taskRun.projectId,
      taskId: taskRun.taskId,
    }).some((dispatch) => dispatch.status === "completed");
  }

  private async reconcileInterruptedCliInvocations(
    recoveredCliSessionIds: ReadonlySet<string>,
    activeContainerSessionIds: ReadonlySet<string>,
    invocationPolicy: RestartInvocationPolicy,
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
      const interruptionReason = this.resolveInterruptedInvocationReason(
        invocation,
        recoveredCliSessionIds,
        activeContainerSessionIds,
        invocationPolicy,
      );
      if (!interruptionReason) {
        continue;
      }
      if (invocationPolicy !== "continue") {
        await this.removeContainersForSessions(new Set([invocation.sessionId]));
      }

      const linkedExecutionInvocations = this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(invocation.id);
      cancelStaleProviderInvocation(
        this.deps.executionRepository,
        invocation,
        linkedExecutionInvocations,
        {
          reconciledAt,
          recoveryReason: "startup_cli_invocation_reconcile",
          systemMessage: interruptionReason,
        }
      );

      this.reconcileInterruptedTaskExecution(invocation, interruptionReason, reconciledAt, invocationPolicy);

      reconciledInvocationIds.push(invocation.id);
    }

    return reconciledInvocationIds;
  }

  private reconcileInterruptedRetryWaits(invocationPolicy: RestartInvocationPolicy): string[] {
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
      const retryTask = invocationPolicy !== "cancel";
      const interruptionReason = [
        `Recovered interrupted ${invocation.type} invocation after Code UX restart while waiting for provider ${invocation.lastErrorCategory || "retry"} recovery.`,
        retryWindow,
        retryTask
          ? "The invocation was moved back to a retryable state so recovered orchestration can start a fresh continuation."
          : "Restart policy cancelled the invocation, so it will not be retried automatically.",
      ].join(" ");

      this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
        status: "cancelled",
        finishedAt: reconciledAt,
        errorMessage: null,
      });
      this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
        role: "system",
        contentMarkdown: interruptionReason,
        metadata: {
          recovery: "startup_provider_retry_wait_reconcile",
          provider: invocation.provider,
          model: invocation.model,
          errorCategory: invocation.lastErrorCategory,
          retryAfterIso: invocation.lastRetryAfterIso,
        },
        createdAt: reconciledAt,
      });

      this.reconcileInterruptedTaskExecutionInvocation(invocation, interruptionReason, reconciledAt, invocationPolicy);
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

  private async reconcileInterruptedLocalDispatches(
    recoveredCliSessionIds: ReadonlySet<string>,
    activeContainerSessionIds: ReadonlySet<string>,
    invocationPolicy: RestartInvocationPolicy,
  ): Promise<string[]> {
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
      const linkedProviderInvocations = taskRun
        ? this.deps.executionRepository.listProviderInvocationsForTask(dispatch.projectId, dispatch.taskId)
          .filter((invocation) => invocation.taskRunId === taskRun.id || invocation.dispatchId === dispatch.id)
        : [];
      if (linkedProviderInvocations.some((invocation) => ["completed", "failed", "cancelled"].includes(invocation.status))) {
        continue;
      }

      const sessionId = taskRun?.sessionId || null;
      const sessionRecovered = sessionId ? recoveredCliSessionIds.has(sessionId) : false;
      const interruptionMessage = sessionRecovered
        ? "Local CLI execution was interrupted by Code UX restart. The task was moved back to a retryable state."
        : "Local CLI execution was interrupted before Code UX could persist a resumable session. The task was moved back to a retryable state.";
      const retryTask = invocationPolicy !== "cancel";
      if (sessionId) {
        await this.removeContainersForSessions(new Set([sessionId]));
      }

      this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
      this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
        connectionId: null,
        status: "cancelled",
        finishedAt: interruptedAt,
        lastHeartbeatAt: interruptedAt,
        errorMessage: null,
      });

      if (taskRun) {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          connectionId: null,
          state: retryTask ? "FAILED" : "BLOCKED",
          finishedAt: interruptedAt,
          durationMs: calculateDurationMs(taskRun, interruptedAt),
        });
        this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "cli_workflow_cancelled", "system", {
          dispatchId: dispatch.id,
          reason: "runtime_restart_interrupted",
          recoveredSessionId: sessionRecovered ? taskRun.sessionId : null,
          message: retryTask
            ? interruptionMessage
            : "Local CLI execution was cancelled by restart policy and will not be retried automatically.",
        }, {
          sourceEventKey: `startup-recovery:cli-interrupted:${dispatch.id}:${taskRun.id}`,
        });
      }

      if (retryTask) {
        this.resetTaskToPending(dispatch.taskId);
      } else {
        this.deps.projectManagementRepository.updateTask(dispatch.taskId, {
          status: "QA_REVIEW_FAILED",
        });
      }

      if (dispatch.sprintRunId) {
        this.deps.sprintRunLifecycleService.finalizeCancellationIfIdle(dispatch.sprintRunId);
      }
      reconciledDispatchIds.push(dispatch.id);
    }

    return reconciledDispatchIds;
  }

  private reconcileInterruptedProviderDispatches(invocationPolicy: RestartInvocationPolicy): string[] {
    const interruptedAt = new Date().toISOString();
    const reconciledDispatchIds: string[] = [];
    const activeJulesDispatches = this.deps.executionRepository.listTaskDispatchesByStatus(
      [...ACTIVE_DISPATCH_STATUSES],
      { executorType: "jules" },
    );

    for (const dispatch of activeJulesDispatches) {
      const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(dispatch.id);
      if (!taskRun || isTerminalTaskRunState(taskRun)) {
        continue;
      }
      if ((taskRun.sessionId || taskRun.sessionName) && invocationPolicy === "continue") {
        continue;
      }

      const retryTask = invocationPolicy !== "cancel";
      const errorMessage = retryTask
        ? "Jules dispatch was interrupted before Code UX persisted a provider session. The task was moved back to a retryable state."
        : "Jules dispatch was cancelled by restart policy before Code UX persisted a provider session.";
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
        state: retryTask ? "FAILED" : "BLOCKED",
        finishedAt: interruptedAt,
        durationMs: calculateDurationMs(taskRun, interruptedAt),
      });
      for (const invocation of this.deps.executionRepository.listRunningProviderInvocationUsages()
        .filter((usage) => usage.taskRunId === taskRun.id)) {
        cancelStaleProviderInvocation(
          this.deps.executionRepository,
          invocation,
          this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(invocation.id),
          {
            reconciledAt: interruptedAt,
            recoveryReason: "startup_restart_invocation_policy",
            systemMessage: errorMessage,
          },
        );
      }
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_failed", "system", {
        dispatchId: dispatch.id,
        reason: "runtime_restart_interrupted_before_session",
        errorMessage,
      }, {
        sourceEventKey: `startup-recovery:jules-pre-session:${dispatch.id}:${taskRun.id}`,
      });
      if (retryTask) {
        this.resetTaskToPending(dispatch.taskId);
      } else {
        this.deps.projectManagementRepository.updateTask(dispatch.taskId, {
          status: "QA_REVIEW_FAILED",
        });
      }

      if (dispatch.sprintRunId) {
        this.deps.sprintRunLifecycleService.finalizeCancellationIfIdle(dispatch.sprintRunId);
      }
      reconciledDispatchIds.push(dispatch.id);
    }

    return reconciledDispatchIds;
  }

  private syncPausedSprintProjections(): string[] {
    const activeRuns = this.deps.executionRepository.listSprintRunsByStatus([...ACTIVE_SPRINT_RUN_STATUSES, "cancel_requested"]);
    const activeSprintIds = new Set(activeRuns.map((run) => run.sprintId));
    const syncedSprintIds: string[] = [];

    for (const pausedRun of this.deps.executionRepository.listSprintRunsByStatus(["paused"])) {
      if (activeSprintIds.has(pausedRun.sprintId)) {
        continue;
      }
      const rawStatus = this.deps.projectManagementRepository.getRawSprintStatus(pausedRun.sprintId);
      if (rawStatus === null || rawStatus === "completed" || rawStatus === "cancelled") {
        continue;
      }
      if (rawStatus === "paused") {
        continue;
      }
      this.deps.sprintRunLifecycleService.updateRun(pausedRun.id, {
        status: "paused",
        lastHeartbeatAt: pausedRun.lastHeartbeatAt,
      });
      syncedSprintIds.push(pausedRun.sprintId);
    }

    return syncedSprintIds;
  }

  private syncOrphanedRunningSprintProjections(): string[] {
    const activeRuns = this.deps.executionRepository.listSprintRunsByStatus([...ACTIVE_SPRINT_RUN_STATUSES, "cancel_requested"]);
    const activeSprintIds = new Set(activeRuns.map((run) => run.sprintId));
    const syncedSprintIds: string[] = [];

    for (const project of this.deps.projectManagementRepository.listProjects().projects) {
      for (const sprint of this.deps.projectManagementRepository.listSprints(project.id).sprints) {
        const rawStatus = this.deps.projectManagementRepository.getRawSprintStatus(sprint.id);
        if (rawStatus !== "running" || activeSprintIds.has(sprint.id)) {
          continue;
        }

        const latestRun = this.deps.executionRepository.listSprintRuns(project.id, sprint.id)[0];
        if (!latestRun) {
          this.deps.projectManagementRepository.updateSprint(sprint.id, { status: "idle" });
          syncedSprintIds.push(sprint.id);
          continue;
        }

        if (latestRun.status === "paused") {
          this.deps.projectManagementRepository.updateSprint(sprint.id, { status: "paused" });
          syncedSprintIds.push(sprint.id);
          continue;
        }

        if (TERMINAL_SPRINT_RUN_STATUSES.has(latestRun.status)) {
          this.deps.sprintRunLifecycleService.syncSprintStatus(sprint.id, latestRun.status);
          syncedSprintIds.push(sprint.id);
        }
      }
    }

    return syncedSprintIds;
  }

  private reconcileDuplicateActiveTaskDispatches(): string[] {
    const activeDispatches = this.deps.executionRepository.listTaskDispatchesByStatus([...ACTIVE_DISPATCH_STATUSES]);
    if (activeDispatches.length === 0) {
      return [];
    }

    const groupedByTaskRun = new Map<string, TaskDispatchRecord[]>();
    for (const dispatch of activeDispatches) {
      const key = `${dispatch.sprintRunId}:${dispatch.taskId}`;
      const entries = groupedByTaskRun.get(key) || [];
      entries.push(dispatch);
      groupedByTaskRun.set(key, entries);
    }

    const reconciledAt = new Date().toISOString();
    const reconciledDispatchIds: string[] = [];
    for (const dispatches of groupedByTaskRun.values()) {
      if (dispatches.length < 2) {
        continue;
      }

      const [keeper, ...duplicates] = dispatches.sort((left, right) => (
        this.dispatchActivityMs(right) - this.dispatchActivityMs(left)
      ));
      for (const duplicate of duplicates) {
        const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(duplicate.id);
        this.deps.executionRepository.releaseLease("task_dispatch", duplicate.id);
        this.deps.executionRepository.updateTaskDispatch(duplicate.id, {
          connectionId: null,
          status: "cancelled",
          finishedAt: reconciledAt,
          lastHeartbeatAt: reconciledAt,
          errorMessage: "Startup recovery cancelled duplicate active task dispatch; a newer dispatch for the same task and sprint run is still active.",
        });

        if (taskRun && !isTerminalTaskRunState(taskRun)) {
          this.deps.executionRepository.updateTaskRun(taskRun.id, {
            connectionId: null,
            state: "BLOCKED",
            finishedAt: reconciledAt,
            durationMs: calculateDurationMs(taskRun, reconciledAt),
          });
          this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "duplicate_dispatch_cancelled", "system", {
            dispatchId: duplicate.id,
            keptDispatchId: keeper.id,
            reason: "startup_duplicate_active_dispatch_reconcile",
          }, {
            sourceEventKey: `startup-recovery:duplicate-dispatch:${duplicate.id}:${taskRun.id}`,
          });
        }

        for (const invocation of this.deps.executionRepository.listRunningProviderInvocationUsages()
          .filter((usage) => usage.dispatchId === duplicate.id || usage.taskRunId === taskRun?.id)) {
          cancelStaleProviderInvocation(
            this.deps.executionRepository,
            invocation,
            this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(invocation.id),
            {
              reconciledAt,
              recoveryReason: "startup_duplicate_active_dispatch_reconcile",
              systemMessage: "Startup recovery cancelled duplicate active task dispatch; a newer dispatch for the same task and sprint run is still active.",
            },
          );
        }

        reconciledDispatchIds.push(duplicate.id);
      }
    }

    return reconciledDispatchIds;
  }

  private dispatchActivityMs(dispatch: TaskDispatchRecord): number {
    const candidates = [
      dispatch.startedAt,
      dispatch.claimedAt,
      dispatch.lastHeartbeatAt,
      dispatch.queuedAt,
      dispatch.createdAt,
    ];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return 0;
  }

  private providerInvocationActivityMs(invocation: ProviderInvocationUsageRecord): number {
    const candidates = [
      invocation.finishedAt,
      invocation.updatedAt,
      invocation.startedAt,
      invocation.createdAt,
    ];
    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return 0;
  }

  private applyRestartSprintPolicy(policy: RestartSprintPolicy): {
    pausedSprintRunIds: string[];
    cancelledSprintRunIds: string[];
  } {
    if (policy === "continue") {
      return { pausedSprintRunIds: [], cancelledSprintRunIds: [] };
    }

    const now = new Date().toISOString();
    const activeRuns = this.deps.executionRepository.listSprintRunsByStatus([...ACTIVE_SPRINT_RUN_STATUSES, "cancel_requested"]);
    const pausedSprintRunIds: string[] = [];
    const cancelledSprintRunIds: string[] = [];

    for (const sprintRun of activeRuns) {
      this.cancelRunningProviderInvocationsForSprintRun(sprintRun.id, now, `Restart policy ${policy} stopped active provider invocation.`);
      this.cancelRunningQaReviewsForSprintRun(sprintRun.id, now, `Restart policy ${policy} stopped active QA review.`);
      this.closeActiveDispatchesForSprintRun(sprintRun.id, policy, now);
      this.deps.sprintRunLifecycleService.releaseSprintLease(sprintRun.sprintId);

      if (policy === "pause") {
        this.deps.sprintRunLifecycleService.updateRun(sprintRun.id, {
          status: "paused",
          lastHeartbeatAt: now,
        });
        this.deps.executionRepository.appendSprintRunEvent(sprintRun.id, "sprint_paused", "system", {
          reason: "startup_restart_policy",
          policy,
        }, {
          sourceEventKey: `startup-recovery:restart-policy:pause:${sprintRun.id}`,
        });
        pausedSprintRunIds.push(sprintRun.id);
      } else {
        this.deps.sprintRunLifecycleService.updateRun(sprintRun.id, {
          status: "cancelled",
          finishedAt: now,
          lastHeartbeatAt: now,
        });
        this.deps.executionRepository.appendSprintRunEvent(sprintRun.id, "sprint_cancelled", "system", {
          reason: "startup_restart_policy",
          policy,
        }, {
          sourceEventKey: `startup-recovery:restart-policy:cancel:${sprintRun.id}`,
        });
        cancelledSprintRunIds.push(sprintRun.id);
      }
    }

    return { pausedSprintRunIds, cancelledSprintRunIds };
  }

  private closeActiveDispatchesForSprintRun(
    sprintRunId: string,
    policy: Exclude<RestartSprintPolicy, "continue">,
    now: string,
  ): void {
    const sprintRun = this.deps.executionRepository.getSprintRun(sprintRunId);
    if (!sprintRun) {
      return;
    }
    for (const dispatch of this.deps.executionRepository.listTaskDispatches({
      projectId: sprintRun.projectId,
      sprintRunId,
    })) {
      if (!ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])) {
        continue;
      }
      this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
      this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
        connectionId: null,
        status: policy === "pause" ? "paused" : "cancelled",
        finishedAt: policy === "pause" ? null : now,
        lastHeartbeatAt: now,
        errorMessage: null,
      });
      const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(dispatch.id);
      if (taskRun && !isTerminalTaskRunState(taskRun)) {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          connectionId: null,
          state: policy === "pause" ? "PAUSED" : "FAILED",
          finishedAt: policy === "pause" ? null : now,
          durationMs: policy === "pause" ? taskRun.durationMs : calculateDurationMs(taskRun, now),
        });
      }
    }
  }

  private cancelRunningProviderInvocationsForSprintRun(
    sprintRunId: string,
    now: string,
    message: string,
  ): void {
    const invocations = this.deps.executionRepository.listRunningProviderInvocationUsages()
      .filter((invocation) => invocation.sprintRunId === sprintRunId);
    for (const invocation of invocations) {
      cancelStaleProviderInvocation(
        this.deps.executionRepository,
        invocation,
        this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(invocation.id),
        {
          reconciledAt: now,
          recoveryReason: "startup_restart_policy",
          systemMessage: message,
        },
      );
    }
  }

  private cancelRunningQaReviewsForSprintRun(
    sprintRunId: string,
    now: string,
    summaryMarkdown: string,
  ): void {
    if (!this.deps.qaReviewRepository) {
      return;
    }
    for (const run of this.deps.qaReviewRepository.listRunningRuns()) {
      if (run.sprintRunId !== sprintRunId) {
        continue;
      }
      this.deps.qaReviewRepository.updateRun(run.id, {
        status: "cancelled",
        outcome: null,
        summaryMarkdown,
        finishedAt: now,
      });
    }
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
        this.deps.sprintRunLifecycleService.updateRun(sprintRun.id, {
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
        this.deps.sprintRunLifecycleService.updateRun(sprintRun.id, {
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

      if (this.isHeldByLiveSprintLease(sprintRun.sprintId, recoveredAt)) {
        recoveredSprintIds.add(sprintRun.sprintId);
        continue;
      }

      recoveredSprintIds.add(sprintRun.sprintId);
      this.deps.sprintRunLifecycleService.releaseSprintLease(sprintRun.sprintId);
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

  private isHeldByLiveSprintLease(sprintId: string, nowIso: string): boolean {
    const lease = this.deps.executionRepository.getLease("sprint", sprintId);
    if (!lease || lease.expiresAt <= nowIso) {
      return false;
    }

    const ownerPid = parseSprintOrchestratorOwnerPid(lease.ownerKey);
    if (ownerPid === null) {
      return false;
    }
    return this.isProcessAlive(ownerPid);
  }

  private isProcessAlive(pid: number): boolean {
    if (this.deps.isProcessAlive) {
      return this.deps.isProcessAlive(pid);
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private resolveRestartPolicies(): RestartPolicies {
    const settings = this.deps.getDashboardSettings?.();
    return {
      sprintPolicy: settings?.restartSprintPolicy === "pause" || settings?.restartSprintPolicy === "cancel"
        ? settings.restartSprintPolicy
        : "continue",
      invocationPolicy: settings?.restartInvocationPolicy === "cancel" || settings?.restartInvocationPolicy === "restart"
        ? settings.restartInvocationPolicy
        : "continue",
    };
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
    invocationPolicy: RestartInvocationPolicy,
  ): string | null {
    if (!CLI_PROVIDERS.has(invocation.provider as ProviderId)) {
      return null;
    }

    if (invocationPolicy === "cancel") {
      return `Restart policy cancelled ${invocation.purpose} invocation after Code UX restart. Session ${invocation.sessionId} will not be retried automatically.`;
    }

    if (invocationPolicy === "restart") {
      return `Restart policy restarted ${invocation.purpose} invocation after Code UX restart. Session ${invocation.sessionId} was stopped so orchestration can dispatch a fresh attempt.`;
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

  private async removeContainersForSessions(sessionIds: ReadonlySet<string>): Promise<void> {
    if (!this.deps.dockerService?.removeContainers || sessionIds.size === 0) {
      return;
    }
    const containers = await this.deps.dockerService.listContainers().catch(() => []);
    const containerIds = containers
      .filter((container) => {
        const sessionId = container.labels?.["code-ux.session-id"]?.trim();
        return sessionId ? sessionIds.has(sessionId) : false;
      })
      .map((container) => container.id || container.names)
      .filter((containerId): containerId is string => Boolean(containerId));
    await this.deps.dockerService.removeContainers(containerIds, { removeVolumes: false }).catch(() => undefined);
  }

  private reconcileInterruptedTaskExecution(
    invocation: ProviderInvocationUsageRecord,
    failureReason: string,
    reconciledAt: string,
    invocationPolicy: RestartInvocationPolicy,
  ): void {
    if (invocation.purpose !== "task_coding" || !invocation.taskId) {
      return;
    }

    const task = this.deps.projectManagementRepository.getTask(invocation.taskId);
    if (!task || task.status !== "in_progress") {
      return;
    }
    const retryTask = invocationPolicy !== "cancel";

    if (invocation.dispatchId) {
      const dispatch = this.deps.executionRepository.getTaskDispatch(invocation.dispatchId);
      if (dispatch && ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])) {
        this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
        this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
          connectionId: null,
          status: "cancelled",
          finishedAt: reconciledAt,
          lastHeartbeatAt: reconciledAt,
          errorMessage: null,
        });
      }
    }

    if (invocation.taskRunId) {
      const taskRun = this.deps.executionRepository.getTaskRun(invocation.taskRunId);
      if (taskRun && !isTerminalTaskRunState(taskRun)) {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          connectionId: null,
          state: retryTask ? "FAILED" : "BLOCKED",
          finishedAt: reconciledAt,
          durationMs: calculateDurationMs(taskRun, reconciledAt),
        });
      }
      if (taskRun) {
        this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "cli_workflow_cancelled", "system", {
          dispatchId: invocation.dispatchId || null,
          providerInvocationId: invocation.id,
          reason: "runtime_restart_interrupted",
          recoveredSessionId: invocation.sessionId,
          message: failureReason,
        }, {
          sourceEventKey: `startup-recovery:cli-invocation:${invocation.id}:${taskRun.id}`,
        });
      }
    }

    if (retryTask) {
      this.resetTaskToPending(invocation.taskId);
    } else {
      this.deps.projectManagementRepository.updateTask(invocation.taskId, {
        status: "QA_REVIEW_FAILED",
      });
    }

    if (invocation.sprintRunId) {
      this.deps.sprintRunLifecycleService.finalizeCancellationIfIdle(invocation.sprintRunId);
    }
  }

  private reconcileInterruptedTaskExecutionInvocation(
    invocation: ExecutionInvocationRecord,
    failureReason: string,
    reconciledAt: string,
    invocationPolicy: RestartInvocationPolicy,
  ): void {
    if (!["cli_task_coding", "cli_task_followup"].includes(invocation.type) || !invocation.taskId) {
      return;
    }

    const task = this.deps.projectManagementRepository.getTask(invocation.taskId);
    if (!task || task.status !== "in_progress") {
      return;
    }
    const retryTask = invocationPolicy !== "cancel";

    if (invocation.dispatchId) {
      const dispatch = this.deps.executionRepository.getTaskDispatch(invocation.dispatchId);
      if (dispatch && ACTIVE_DISPATCH_STATUSES.includes(dispatch.status as (typeof ACTIVE_DISPATCH_STATUSES)[number])) {
        this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
        this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
          connectionId: null,
          status: "cancelled",
          finishedAt: reconciledAt,
          lastHeartbeatAt: reconciledAt,
          errorMessage: null,
        });
      }
    }

    if (invocation.taskRunId) {
      const taskRun = this.deps.executionRepository.getTaskRun(invocation.taskRunId);
      if (taskRun && !isTerminalTaskRunState(taskRun)) {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          connectionId: null,
          state: retryTask ? "FAILED" : "BLOCKED",
          finishedAt: reconciledAt,
          durationMs: calculateDurationMs(taskRun, reconciledAt),
        });
      }
      if (taskRun) {
        this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "cli_workflow_cancelled", "system", {
          dispatchId: invocation.dispatchId || null,
          executionInvocationId: invocation.id,
          providerInvocationId: invocation.providerInvocationId || null,
          reason: "runtime_restart_interrupted_retry_wait",
          message: failureReason,
        }, {
          sourceEventKey: `startup-recovery:retry-wait:${invocation.id}:${taskRun.id}`,
        });
      }
    }

    if (retryTask) {
      this.resetTaskToPending(invocation.taskId);
    } else {
      this.deps.projectManagementRepository.updateTask(invocation.taskId, {
        status: "QA_REVIEW_FAILED",
      });
    }

    if (invocation.sprintRunId) {
      this.deps.sprintRunLifecycleService.finalizeCancellationIfIdle(invocation.sprintRunId);
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

  private resetTaskToPending(taskId: string): void {
    this.deps.projectManagementRepository.updateTask(taskId, {
      status: "pending",
      mergeIndicator: null,
      isMerged: false,
    });
  }
}

function calculateDurationMs(taskRun: TaskRunRecord, finishedAt: string): number | null {
  if (!taskRun.startedAt) {
    return taskRun.durationMs;
  }
  return Math.max(0, new Date(finishedAt).getTime() - new Date(taskRun.startedAt).getTime());
}
