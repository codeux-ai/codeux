import type { Subtask, GitTrackingStatus, GitPullRequestStatus } from "../../../contracts/app-types.js";
import type { TaskStatus as PlanningTaskStatus } from "../../../contracts/project-management-types.js";
import type { ProjectAttentionItemRecord, ProjectAttentionOwnerType } from "../../../contracts/project-attention-types.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import { matchPrForTask } from "../ci/feature-pr/pr-matcher.js";
import { buildTaskAttentionPayload } from "./attention-payload-builder.js";
import { buildConflictSummaryMarkdown, selectMergedTaskContexts, type MergeConflictTaskContext } from "./conflict-summary-utils.js";
import type { CycleRunnerArgs } from "./cycle-runner.js";

export interface TaskStateSnapshot {
  id: string;
  status: Subtask["status"];
  isMerged: boolean;
  mergeIndicator: Subtask["merge_indicator"];
}

export interface TaskActionRequiredSnapshot {
  status: Subtask["status"];
  sessionState: string | undefined;
}

export class CycleStateCoordinator {
  constructor(private readonly deps: SprintOrchestratorDependencies) {}

  syncAutoInterventionExecutionState(
    subtasks: Subtask[],
    previousTasks: Map<string, TaskActionRequiredSnapshot>,
    sprintRunId?: string,
  ): void {
    if (!sprintRunId) {
      return;
    }

    const now = new Date().toISOString();
    const taskRunsToUpdate: any[] = [];
    const dispatchesToUpdate: any[] = [];

    for (const task of subtasks) {
      const previous = previousTasks.get(task.id);
      if (!previous || !task.record_id) {
        continue;
      }
      if (previous.status !== "BLOCKED" || task.status !== "RUNNING") {
        continue;
      }
      if (!this.deps.isActionRequiredState(previous.sessionState)) {
        continue;
      }

      const taskRun = this.deps.executionRepository.getLatestTaskRun(task.record_id, sprintRunId);
      if (!taskRun) {
        continue;
      }

      taskRunsToUpdate.push({
        id: taskRun.id,
        state: "RUNNING",
        finishedAt: null,
        durationMs: null,
      });

      if (!taskRun.dispatchId) {
        continue;
      }

      const dispatch = this.deps.executionRepository.getTaskDispatch(taskRun.dispatchId);
      if (!dispatch) {
        continue;
      }

      dispatchesToUpdate.push({
        id: dispatch.id,
        status: "running",
        startedAt: dispatch.startedAt || taskRun.startedAt || now,
        finishedAt: null,
        lastHeartbeatAt: now,
        errorMessage: null,
      });
    }

    if (taskRunsToUpdate.length > 0) {
      this.deps.executionRepository.updateTaskRunsBatch(taskRunsToUpdate);
    }
    if (dispatchesToUpdate.length > 0) {
      this.deps.executionRepository.updateTaskDispatchesBatch(dispatchesToUpdate);
    }
  }

  persistCiGateTaskStateChanges(
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

  syncProtocolAttentionItems(
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
    const sprintId = args.executionContext.sprint.id;
    const sprintRunId = args.sprintRunId;
    const knownTaskIds = subtasks
      .map((task) => task.record_id?.trim())
      .filter((taskId): taskId is string => Boolean(taskId));

    const itemsToOpen: any[] = [];
    const itemsToResolve: any[] = [];

    const mergeTaskIds = new Set<string>();
    for (const task of protocolResult.awaitingMerge) {
      const taskId = task.record_id?.trim();
      if (!taskId) {
        continue;
      }
      mergeTaskIds.add(taskId);
      const pr = gitStatus?.available ? matchPrForTask(task, gitStatus) : undefined;
      const mergeConflictDetected = shouldEscalateFeatureMergeConflict(
        task,
        args,
        gitStatus,
        activeWorkerMergeConflictTaskIds,
      );
      const mergedFeatureTasks = selectMergedFeatureTaskContexts(subtasks, taskId);

      itemsToOpen.push(buildTaskAttentionPayload({
        projectId,
        sprintId,
        taskId,
        sprintRunId: sprintRunId || "",
        attentionType: mergeConflictDetected ? "merge_conflict" : "merge_required",
        severity: mergeConflictDetected || task.merge_indicator === "MERGE_BLOCKED" ? "high" : "medium",
        ownerType: "worker",
        title: mergeConflictDetected ? `Merge conflict for ${task.id}` : `Merge required for ${task.id}`,
        summaryMarkdown: mergeConflictDetected
          ? buildMergeConflictSummary(task, args, pr || null, mergedFeatureTasks)
          : task.merge_indicator === "MERGE_BLOCKED"
            ? `Task \`${task.id}\` is complete but blocked on merge work that could not be resolved automatically.`
            : `Task \`${task.id}\` is complete and awaiting merge into \`${args.defaultFeatureBranch}\`.`,
        payload: {
          repoPath: args.repoPath,
          workingDirectoryHint: `cd ${args.repoPath}`,
          featureBranch: args.defaultFeatureBranch,
          defaultBranch: args.defaultBranch,
          taskKey: task.id,
          taskTitle: task.title,
          taskPrompt: task.prompt,
          mergeIndicator: task.merge_indicator || null,
          workerBranch: task.worker_branch || null,
          prUrl: task.pr_url || null,
          prNumber: pr?.number ?? null,
          mergeStateStatus: pr?.mergeStateStatus ?? null,
          conflictingBranches: {
            source: task.worker_branch || pr?.headRefName || null,
            target: args.defaultFeatureBranch,
          },
          currentTask: buildTaskContext(task),
          featureBranchTaskContexts: mergedFeatureTasks,
        },
      }));
      itemsToResolve.push({
        filter: {
          projectId,
          taskId,
          attentionTypes: [mergeConflictDetected ? "merge_required" : "merge_conflict"],
        },
        resolution: {
          status: "resolved",
          reason: mergeConflictDetected ? "merge_conflict_attention_replaced" : "merge_required_attention_replaced",
        },
      });
    }

    const actionTaskIds = new Set<string>();
    for (const task of protocolResult.actionRequiredTasks) {
      const taskId = task.record_id?.trim();
      if (!taskId) {
        continue;
      }
      actionTaskIds.add(taskId);
      const ownerType: ProjectAttentionOwnerType = task.intervention_owner === "AGENT" ? "worker" : "human";
      itemsToOpen.push(buildTaskAttentionPayload({
        projectId,
        sprintId,
        taskId,
        sprintRunId: sprintRunId || "",
        attentionType: "action_required",
        severity: task.intervention_owner === "AGENT" ? "high" : "medium",
        ownerType,
        title: `Action required for ${task.id}`,
        summaryMarkdown: task.intervention_hint?.trim()
          || `Task \`${task.id}\` is blocked in session state \`${task.session_state || "UNKNOWN"}\`.`,
        payload: {
          repoPath: args.repoPath,
          featureBranch: args.defaultFeatureBranch,
          defaultBranch: args.defaultBranch,
          taskKey: task.id,
          taskTitle: task.title,
          sessionState: task.session_state || null,
          provider: task.provider || null,
          interventionOwner: task.intervention_owner || "HUMAN",
        },
      }));
    }

    const ciFixTaskIds = new Set<string>();
    for (const task of subtasks) {
      const taskId = task.record_id?.trim();
      if (taskId && task.merge_indicator === "CI" && task.status === "RUNNING") {
        ciFixTaskIds.add(taskId);
      }
    }

    for (const taskId of knownTaskIds) {
      if (!mergeTaskIds.has(taskId)) {
        itemsToResolve.push({
          filter: {
            projectId,
            taskId,
            attentionTypes: ["merge_required", "merge_conflict"],
          },
          resolution: {
            status: "resolved",
            reason: "merge_attention_cleared",
          },
        });
      }
      if (!actionTaskIds.has(taskId)) {
        itemsToResolve.push({
          filter: {
            projectId,
            taskId,
            attentionTypes: ["action_required"],
          },
          resolution: {
            status: "resolved",
            reason: "action_required_cleared",
          },
        });
      }
      if (!ciFixTaskIds.has(taskId)) {
        itemsToResolve.push({
          filter: {
            projectId,
            taskId,
            attentionTypes: ["ci_fix_required"],
          },
          resolution: {
            status: "resolved",
            reason: "ci_fix_attention_cleared",
          },
        });
      }
    }

    if (itemsToOpen.length > 0) {
      this.deps.projectAttentionService.openItems(itemsToOpen);
    }
    if (itemsToResolve.length > 0) {
      this.deps.projectAttentionService.resolveItems(itemsToResolve);
    }
  }
}

export function shouldEscalateFeatureMergeConflict(
  task: Subtask,
  args: CycleRunnerArgs,
  gitStatus: GitTrackingStatus | null,
  activeWorkerMergeConflictTaskIds: Set<string>,
): boolean {
  if (!args.ciIntelligence.resolveMergeConflicts) {
    return false;
  }

  const taskId = task.record_id?.trim();
  if (taskId && activeWorkerMergeConflictTaskIds.has(taskId)) {
    return true;
  }

  if (task.merge_indicator === "MERGE_CONFLICT") {
    return true;
  }

  if (!gitStatus?.available) {
    return false;
  }

  const pr = matchPrForTask(task, gitStatus);
  return pr?.mergeStateStatus === "DIRTY";
}

export function collectActiveWorkerMergeConflictTaskIds(subtasks: Array<{
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

export function snapshotTaskState(subtasks: Subtask[]): Map<string, TaskStateSnapshot> {
  return new Map(subtasks.map((task) => [task.id, {
    id: task.id,
    status: task.status,
    isMerged: Boolean(task.is_merged),
    mergeIndicator: task.merge_indicator,
  }]));
}

export function hasMergeStateChanges(previous: Map<string, TaskStateSnapshot>, subtasks: Subtask[]): boolean {
  return subtasks.some((task) => {
    const earlier = previous.get(task.id);
    if (!earlier) {
      return true;
    }
    return earlier.isMerged !== Boolean(task.is_merged);
  });
}

export function resolveCiStatusCacheTtlMs(watchLoopIntervalSeconds: number | undefined): number {
  const watchLoopIntervalMs = Math.max(1, Number(watchLoopIntervalSeconds || 0)) * 1000;
  return Math.min(15_000, Math.max(3_000, watchLoopIntervalMs));
}

export function hasActiveCiFixAttentionAttempt(
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

export function mapSubtaskStatusToPlanningStatus(status: Subtask["status"]): PlanningTaskStatus {
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

export function buildTaskContext(task: Subtask): MergeConflictTaskContext {
  return {
    taskKey: task.id,
    taskTitle: task.title,
    taskPrompt: task.prompt,
    workerBranch: task.worker_branch || null,
    prUrl: task.pr_url || null,
  };
}

export function selectMergedFeatureTaskContexts(subtasks: Subtask[], excludedTaskId: string): MergeConflictTaskContext[] {
  return selectMergedTaskContexts(subtasks, { excludedTaskId, limit: 5 });
}

export function buildMergeConflictSummary(
  task: Subtask,
  args: CycleRunnerArgs,
  pr: GitPullRequestStatus | null,
  mergedFeatureTasks: MergeConflictTaskContext[],
): string {
  const sourceBranch = task.worker_branch || pr?.headRefName || "the task worker branch";
  return buildConflictSummaryMarkdown({
    repoPath: args.repoPath,
    workingDir: `cd ${args.repoPath}`,
    conflictingBranches: {
      source: sourceBranch,
      target: args.defaultFeatureBranch,
    },
    prInfo: pr ? { number: pr.number, url: pr.url } : undefined,
    taskContext: {
      id: task.id,
      title: task.title,
      prompt: task.prompt,
    },
    mergedTaskContexts: mergedFeatureTasks,
    isMainMerge: false,
  });
}
