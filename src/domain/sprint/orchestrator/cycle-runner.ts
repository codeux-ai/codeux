import { applyActionRequiredAutomation } from "../../../sprint/action-required-automation.js";
import { runSessionSyncStep } from "../../../sprint/steps/session-sync-step.js";
import { runStatusDerivationStep } from "../../../sprint/steps/status-derivation-step.js";
import { runStartReadyTasksStep } from "../../../sprint/steps/start-ready-tasks-step.js";
import { runStatusTableStep } from "../../../sprint/steps/status-table-step.js";
import { runProtocolStep } from "../../../sprint/steps/protocol-step.js";
import type { SprintCycleResult } from "../../../sprint/sprint-types.js";
import type {
  AutomationInterventionsSettings,
  AutomationLevel,
  CiIntelligenceSettings,
  GitPullRequestStatus,
  GitTrackingStatus,
  SprintLoopStepSettings,
  Subtask,
} from "../../../contracts/app-types.js";
import type { TaskStatus as PlanningTaskStatus } from "../../../contracts/project-management-types.js";
import type { ProjectAttentionOwnerType } from "../../../contracts/project-attention-types.js";
import type { ProjectAttentionItemRecord } from "../../../contracts/project-attention-types.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import type { SprintExecutionContext } from "../../../services/sprint-execution-state-service.js";
import { FeaturePrGateService } from "../ci/feature-pr-gate.js";
import { matchPrForTask } from "../ci/feature-pr/pr-matcher.js";
import type { MemoryCategory } from "../../../contracts/memory-types.js";
import { buildTaskAttentionPayload } from "./attention-payload-builder.js";
import { buildAttentionPlan, shouldEscalateFeatureMergeConflict } from "./attention-plan-builder.js";
import { buildConflictSummaryMarkdown, selectMergedTaskContexts, type MergeConflictTaskContext } from "./conflict-summary-utils.js";


export interface CycleRunnerArgs {
  action: "status" | "orchestrate";
  automationLevel: AutomationLevel;
  automationInterventions: AutomationInterventionsSettings;
  executionContext: SprintExecutionContext;
  repoPath: string;
  defaultFeatureBranch: string;
  retryFailed: boolean;
  loopSteps: SprintLoopStepSettings;
  ciIntelligence: CiIntelligenceSettings;
  githubMode: "REMOTE" | "LOCAL";
  defaultBranch: string;
  featureBranchPrefix: string;
  sprintRunId?: string;
  /** Planning agent preset ID for per-agent memory tagging. */
  planningAgentPresetId?: string;
}

interface TaskStateSnapshot {
  id: string;
  status: Subtask["status"];
  isMerged: boolean;
  mergeIndicator: Subtask["merge_indicator"];
}

export class CycleRunner {
  private readonly ciAutofixRetryCounts = new Map<string, number>();
  private readonly featurePrGate = new FeaturePrGateService();
  private readonly lastAutoReplyTimestamps = new Map<string, number>();

  constructor(private readonly deps: SprintOrchestratorDependencies) {}

  async run(args: CycleRunnerArgs): Promise<SprintCycleResult & {
    awaitingMerge: Subtask[];
    manualMergeTasks: Subtask[];
    workerEscalatedMergeConflictTasks: Subtask[];
  }> {
    let subtasks: Subtask[] = args.loopSteps.loadSubtasks
      ? await this.deps.sprintExecutionStateService.loadSubtasks(
          args.executionContext.project.id,
          args.executionContext.sprint.id,
          args.sprintRunId,
        )
      : [];
    const appendTaskEvent = (
      task: Subtask,
      eventType: string,
      payload: Record<string, unknown>,
      sourceEventKey?: string,
    ): void => {
      if (!args.sprintRunId || typeof task.record_id !== "string" || task.record_id.trim().length === 0) {
        return;
      }
      const taskRun = this.deps.executionRepository.getLatestTaskRun(task.record_id, args.sprintRunId);
      if (!taskRun) {
        return;
      }
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, eventType, "system", payload, {
        sourceEventKey,
      });
    };

    if (args.loopSteps.sessionSync && subtasks.length > 0) {
      const syncResult = await runSessionSyncStep(
        subtasks,
        {
          listSessions: this.deps.listSessions,
          resolveSessionName: this.deps.resolveSessionName,
          extractSessionId: this.deps.extractSessionId,
          fetchRecentActivities: this.deps.fetchRecentActivities,
          isActionRequiredState: this.deps.isActionRequiredState,
          projectManagementRepository: this.deps.projectManagementRepository,
          executionRepository: this.deps.executionRepository,
          sprintRunId: args.sprintRunId,
          logger: this.deps.logger.child({ component: "session-sync-step" }),
        },
        args.retryFailed,
        {
          repoPath: args.repoPath,
          sprintNumber: args.executionContext.sprintNumber,
          maxQuotaRetriesWithoutTimer: this.deps.getDashboardSettings({
            projectId: args.executionContext.project.id,
            sprintId: args.executionContext.sprint.id,
          }).cliWorkflow.maxQuotaRetriesWithoutTimer,
          maxRateLimitRetries: this.deps.getDashboardSettings({
            projectId: args.executionContext.project.id,
            sprintId: args.executionContext.sprint.id,
          }).cliWorkflow.maxRateLimitRetries,
          retryOnRateLimit: this.deps.getDashboardSettings({
            projectId: args.executionContext.project.id,
            sprintId: args.executionContext.sprint.id,
          }).cliWorkflow.retryOnRateLimit,
        },
      );
      subtasks = syncResult.subtasks;
    }

    if (args.loopSteps.statusDerivation && subtasks.length > 0) {
      const preDerivationStates = new Map(subtasks.map((t) => [t.id, t.status]));
      subtasks = runStatusDerivationStep(subtasks, {
        retryFailed: args.retryFailed,
        isActionRequiredState: this.deps.isActionRequiredState,
      });
      await this.captureTaskCompletionMemories(subtasks, preDerivationStates, args);
    }

    let reportText = "";
    if (args.loopSteps.startReadyTasks && subtasks.length > 0) {
      const startResult = await this.runStartReadyTasks(subtasks, args);
      subtasks = startResult.subtasks;
      reportText += startResult.reportText;
    }

    if (subtasks.length > 0) {
      const interventionResult = await applyActionRequiredAutomation(subtasks, {
        projectId: args.executionContext.project.id,
        sprintGoal: args.executionContext.sprint.goal || "",
        automationLevel: args.automationLevel,
        settings: args.automationInterventions,
        isActionRequiredState: this.deps.isActionRequiredState,
        isJulesApiConfigured: this.deps.isJulesApiConfigured,
        approveSessionPlan: this.deps.approveSessionPlan,
        sendSessionMessage: this.deps.sendSessionMessage,
        generateWorkerClarificationReply: this.deps.generateWorkerClarificationReply,
        lastAutoReplyTimestamps: this.lastAutoReplyTimestamps,
        onTaskEvent: ({ task, eventType, payload, sourceEventKey }) => {
          appendTaskEvent(task, eventType, payload, sourceEventKey);
        },
      });
      subtasks = interventionResult.subtasks;
      reportText += interventionResult.reportText;
    }

    let gitStatus: GitTrackingStatus | null = null;
    if (subtasks.length > 0) {
      const activeProjectAttentionItems = typeof this.deps.projectAttentionService?.listActiveProjectItems === "function"
        ? this.deps.projectAttentionService.listActiveProjectItems(args.executionContext.project.id)
        : [];
      const taskStateBeforeCiGate = snapshotTaskState(subtasks);
      gitStatus = this.deps.getCiStatusForScope
        ? await this.deps.getCiStatusForScope({
            repoPath: args.repoPath,
            scope: "FEATURE_PR_CI",
            featureBranch: args.defaultFeatureBranch,
            defaultBranch: args.defaultBranch,
            featureBranchPrefix: args.featureBranchPrefix,
            cacheTtlMs: resolveCiStatusCacheTtlMs(args.loopSteps.watchLoopIntervalSeconds),
          })
        : null;

      const ciAutofixResult = await this.featurePrGate.evaluateCiGate(subtasks, {
        automationLevel: args.automationLevel,
        repoPath: args.repoPath,
        featureBranch: args.defaultFeatureBranch,
        defaultBranch: args.defaultBranch,
        featureBranchPrefix: args.featureBranchPrefix,
        ciIntelligence: args.ciIntelligence,
        githubMode: args.githubMode,
        gitStatus,
        ciAutofixRetryCounts: this.ciAutofixRetryCounts,
        isJulesApiConfigured: this.deps.isJulesApiConfigured,
        sendSessionMessage: async (sessionId, message) => {
          await this.deps.sendSessionMessage(sessionId, message);
        },
        autoMergeFeaturePr: this.deps.autoMergeFeaturePr,
        hasActiveWorkerCiFixAttempt: (task, prNumber) => hasActiveCiFixAttentionAttempt(
          activeProjectAttentionItems,
          task,
          prNumber,
        ),
        openCiFixAttention: (task, payload) => {
          const taskId = task.record_id?.trim();
          if (!taskId || !this.deps.projectAttentionService) {
            return;
          }
          const summaryLines = [
            `CI failed for task \`${task.id}\` on branch \`${payload.branchName}\`.`,
            `PR: ${payload.prUrl}`,
            `Failed checks: ${payload.failedChecks.join(", ")}`,
            payload.failedJobLabels.length > 0 ? `Failed jobs: ${payload.failedJobLabels.join(", ")}` : null,
          ].filter(Boolean).join("\n");

          this.deps.projectAttentionService.openItem({
            projectId: args.executionContext.project.id,
            sprintId: args.executionContext.sprint.id,
            taskId,
            sprintRunId: args.sprintRunId,
            attentionType: "ci_fix_required",
            severity: "high",
            ownerType: "worker",
            title: `CI fix required for ${task.id}`,
            summaryMarkdown: summaryLines,
            payload: { ...payload },
          });
        },
        persistMergedTask: async (task) => {
          if (typeof task.record_id !== "string" || task.record_id.trim().length === 0) {
            return;
          }
          this.deps.projectManagementRepository.updateTask(task.record_id, {
            isMerged: Boolean(task.is_merged),
            mergeIndicator: task.merge_indicator || null,
            status: task.status === "COMPLETED"
              ? "completed"
              : task.status === "CODING_COMPLETED"
                ? "coding_completed"
                : undefined,
          });
        },
        executionRepository: this.deps.executionRepository,
        sprintRunId: args.sprintRunId,
      });
      subtasks = ciAutofixResult.subtasks;
      reportText += ciAutofixResult.reportText;
      await this.captureCiFailureMemories(subtasks, taskStateBeforeCiGate, args);

      this.persistCiGateTaskStateChanges(taskStateBeforeCiGate, subtasks);

      const ciGateRefreshNeeded = hasMergeStateChanges(taskStateBeforeCiGate, subtasks);
      if (ciGateRefreshNeeded && args.loopSteps.statusDerivation) {
        subtasks = runStatusDerivationStep(subtasks, {
          retryFailed: args.retryFailed,
          isActionRequiredState: this.deps.isActionRequiredState,
        });
      }

      if (ciGateRefreshNeeded && args.loopSteps.startReadyTasks) {
        const startResult = await this.runStartReadyTasks(subtasks, args);
        subtasks = startResult.subtasks;
        reportText += startResult.reportText;
      }
    }

    const activeWorkerMergeConflictTaskIds = collectActiveWorkerMergeConflictTaskIds(
      typeof this.deps.projectAttentionService?.listActiveProjectItems === "function"
        ? this.deps.projectAttentionService.listActiveProjectItems(args.executionContext.project.id)
        : [],
    );

    const protocolResult = await runProtocolStep(subtasks, {
      featureBranch: args.defaultFeatureBranch,
      githubMode: args.githubMode,
      ciIntelligence: args.ciIntelligence,
      enableMergeProtocol: args.loopSteps.mergeProtocol,
      enableActionRequiredProtocol: args.loopSteps.actionRequiredProtocol,
      isActionRequiredState: this.deps.isActionRequiredState,
      isWorkerEscalatedMergeConflictTask: (task) => shouldEscalateFeatureMergeConflict(
        task,
        args,
        gitStatus,
        activeWorkerMergeConflictTaskIds,
      ),
      renderInstruction: (templateId, variables) => this.deps.renderInstruction(templateId, variables, args.repoPath),
      onTaskEvent: ({ task, eventType, payload, sourceEventKey }) => {
        appendTaskEvent(task, eventType, payload, sourceEventKey);
      },
    });
    this.syncProtocolAttentionItems(subtasks, protocolResult, args, gitStatus, activeWorkerMergeConflictTaskIds);

    const statusTable = args.loopSteps.statusTable ? runStatusTableStep(subtasks) : "";

    return {
      subtasks,
      reportText,
      statusTable,
      instructions: protocolResult.instructions,
      awaitingMerge: protocolResult.awaitingMerge,
      manualMergeTasks: protocolResult.manualMergeTasks,
      workerEscalatedMergeConflictTasks: protocolResult.workerEscalatedMergeConflictTasks,
    };
  }

  private runStartReadyTasks(
    subtasks: Subtask[],
    args: CycleRunnerArgs,
  ): Promise<{ subtasks: Subtask[]; reportText: string }> {
    return runStartReadyTasksStep(subtasks, {
      action: args.action,
      maxFailures: this.deps.settings.maxFailures || 5,
      getConsecutiveFailures: this.deps.getConsecutiveFailures,
      setConsecutiveFailures: this.deps.setConsecutiveFailures,
      startTask: (task) => {
        if (!args.sprintRunId) {
          throw new Error("Missing sprint run id for orchestrate action.");
        }
        return this.deps.startTask(task, {
          projectId: args.executionContext.project.id,
          sprintId: args.executionContext.sprint.id,
          sprintRunId: args.sprintRunId,
          sourceId: args.executionContext.sourceId,
          featureBranch: args.defaultFeatureBranch,
          repoPath: args.repoPath,
          sprintNumber: args.executionContext.sprintNumber,
        });
      },
      resolveSessionName: this.deps.resolveSessionName,
      extractSessionId: this.deps.extractSessionId,
      logger: this.deps.logger.child({ component: "start-ready-tasks-step" }),
      shouldSkipTask: (task) => task.status === "QUOTA",
    });
  }

  private async captureTaskCompletionMemories(
    subtasks: Subtask[],
    preDerivationStates: Map<string, Subtask["status"]>,
    args: CycleRunnerArgs,
  ): Promise<void> {
    const memoryService = this.deps.memoryService;
    const settings = this.deps.getDashboardSettings({
      projectId: args.executionContext.project.id,
      sprintId: args.executionContext.sprint.id,
    });
    if (!memoryService || !settings.memory?.enabled || !settings.memory.autoCaptureSprint) return;

    const pendingCaptures: { taskId: string; promise: Promise<void> }[] = [];
    for (const task of subtasks) {
      const prev = preDerivationStates.get(task.id);
      if (prev === task.status) continue;

      let category: MemoryCategory;
      let content: string;
      let strength: number;

      if (task.status === "COMPLETED" && prev !== "COMPLETED") {
        category = "context";
        content = `Task completed: ${task.id} — ${task.title}. ${task.prompt}`;
        strength = 0.7;
      } else if (task.status === "FAILED" && prev !== "FAILED") {
        category = "error";
        content = `Task failed: ${task.id} — ${task.title}. ${task.prompt}`;
        strength = 0.8;
      } else {
        continue;
      }

      pendingCaptures.push({
        taskId: task.id,
        promise: memoryService.createMemory(args.executionContext.project.id, {
          scope: "sprint",
          sprintId: args.executionContext.sprint.id,
          agentPresetId: args.planningAgentPresetId ?? null,
          content,
          category,
          strength,
          source: {
            type: "auto_capture",
            originType: "task_status_change",
            originId: task.record_id || task.id,
          },
        }).then(() => {}),
      });
    }

    const results = await Promise.allSettled(pendingCaptures.map(p => p.promise));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.deps.logger.warn("Failed to auto-capture task memory", {
          taskId: pendingCaptures[index].taskId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
  }

  private async captureCiFailureMemories(
    subtasks: Subtask[],
    preGateStates: Map<string, TaskStateSnapshot>,
    args: CycleRunnerArgs,
  ): Promise<void> {
    const memoryService = this.deps.memoryService;
    const settings = this.deps.getDashboardSettings({
      projectId: args.executionContext.project.id,
      sprintId: args.executionContext.sprint.id,
    });
    if (!memoryService || !settings.memory?.enabled || !settings.memory.autoCaptureSprint) return;

    const pendingCaptures: { taskId: string; promise: Promise<void> }[] = [];
    for (const task of subtasks) {
      if (task.merge_indicator !== "CI") continue;
      const prev = preGateStates.get(task.id);
      if (prev && prev.mergeIndicator === "CI") continue; // already known

      const content = `CI failure detected for task ${task.id} — ${task.title}. Branch: ${task.worker_branch || "unknown"}. PR: ${task.pr_url || "none"}.`;

      pendingCaptures.push({
        taskId: task.id,
        promise: memoryService.createMemory(args.executionContext.project.id, {
          scope: "sprint",
          sprintId: args.executionContext.sprint.id,
          agentPresetId: args.planningAgentPresetId ?? null,
          content,
          category: "error",
          strength: 0.7,
          source: {
            type: "auto_capture",
            originType: "ci_failure",
            originId: task.record_id || task.id,
          },
        }).then(() => {}),
      });
    }

    const results = await Promise.allSettled(pendingCaptures.map(p => p.promise));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        this.deps.logger.warn("Failed to auto-capture CI failure memory", {
          taskId: pendingCaptures[index].taskId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
  }

  private persistCiGateTaskStateChanges(
    previous: Map<string, TaskStateSnapshot>,
    subtasks: Subtask[],
  ): void {
    for (const task of subtasks) {
      const earlier = previous.get(task.id);
      if (!earlier || !task.record_id) {
        continue;
      }

      const statusChanged = earlier.status !== task.status;
      const mergeChanged = earlier.isMerged !== Boolean(task.is_merged);
      const mergeIndicatorChanged = earlier.mergeIndicator !== task.merge_indicator;
      if (!statusChanged && !mergeChanged && !mergeIndicatorChanged) {
        continue;
      }

      this.deps.projectManagementRepository.updateTask(task.record_id, {
        status: mapSubtaskStatusToPlanningStatus(task.status),
        isMerged: Boolean(task.is_merged),
        mergeIndicator: task.merge_indicator || null,
      });
    }
  }

  private syncProtocolAttentionItems(
    subtasks: Subtask[],
    protocolResult: {
      awaitingMerge: Subtask[];
      actionRequiredTasks: Subtask[];
    },
    args: CycleRunnerArgs,
    gitStatus: GitTrackingStatus | null,
    activeWorkerMergeConflictTaskIds: Set<string>,
  ): void {
    const projectId = args.executionContext.project.id;
    const plan = buildAttentionPlan(
      subtasks,
      protocolResult,
      args,
      gitStatus,
      activeWorkerMergeConflictTaskIds,
    );

    for (const item of plan.toOpen) {
      this.deps.projectAttentionService.openItem(item.payload);
    }

    for (const resolution of plan.toResolve) {
      if (resolution.typesToResolve.length > 0) {
        this.deps.projectAttentionService.resolveItemsForTask(
          projectId,
          resolution.taskId,
          resolution.typesToResolve,
          resolution.reason,
        );
      }
    }
  }
}

function collectActiveWorkerMergeConflictTaskIds(subtasks: Array<{
  taskId: string | null;
  attentionType: string;
  ownerType: string;
}>): Set<string> {
  return new Set(
    subtasks
      .filter((item) => item.attentionType === "merge_conflict" && item.ownerType === "worker")
      .map((item) => item.taskId?.trim())
      .filter((taskId): taskId is string => Boolean(taskId)),
  );
}

function snapshotTaskState(subtasks: Subtask[]): Map<string, TaskStateSnapshot> {
  return new Map(subtasks.map((task) => [task.id, {
    id: task.id,
    status: task.status,
    isMerged: Boolean(task.is_merged),
    mergeIndicator: task.merge_indicator,
  }]));
}

function hasMergeStateChanges(previous: Map<string, TaskStateSnapshot>, subtasks: Subtask[]): boolean {
  return subtasks.some((task) => {
    const earlier = previous.get(task.id);
    if (!earlier) {
      return true;
    }
    return earlier.isMerged !== Boolean(task.is_merged);
  });
}

function resolveCiStatusCacheTtlMs(watchLoopIntervalSeconds: number | undefined): number {
  const watchLoopIntervalMs = Math.max(1, Number(watchLoopIntervalSeconds || 0)) * 1000;
  return Math.min(15_000, Math.max(3_000, watchLoopIntervalMs));
}

function hasActiveCiFixAttentionAttempt(
  attentionItems: ProjectAttentionItemRecord[],
  task: Subtask,
  prNumber: number,
): boolean {
  const taskRecordId = task.record_id?.trim() || null;
  return attentionItems.some((item) => {
    if (item.attentionType !== "ci_fix_required" || item.ownerType !== "worker") {
      return false;
    }

    const payload = item.payload || {};
    const payloadTaskKey = typeof payload.taskKey === "string" ? payload.taskKey.trim() : null;
    const payloadPrNumber = typeof payload.prNumber === "number" ? payload.prNumber : null;
    const sameTask = Boolean(
      (taskRecordId && item.taskId?.trim() === taskRecordId)
      || (payloadTaskKey && payloadTaskKey === task.id),
    );

    return sameTask && payloadPrNumber === prNumber;
  });
}

function mapSubtaskStatusToPlanningStatus(status: Subtask["status"]): PlanningTaskStatus {
  switch (status) {
    case "RUNNING":
      return "in_progress";
    case "COMPLETED":
      return "completed";
    case "PENDING":
    case "FAILED":
    case "BLOCKED":
    case "QUOTA":
    default:
      return "pending";
  }
}

