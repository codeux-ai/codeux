import type { Subtask, GitTrackingStatus, GitPullRequestStatus } from "../../../contracts/app-types.js";
import type { TaskStatus as PlanningTaskStatus } from "../../../contracts/project-management-types.js";
import type { ProjectAttentionItemRecord, ProjectAttentionOwnerType } from "../../../contracts/project-attention-types.js";
import type { SprintOrchestratorDependencies } from "../../../sprint/sprint-orchestrator.js";
import { matchPrForTask } from "../ci/feature-pr/pr-matcher.js";
import type { MergeConflictDebouncer } from "../ci/merge-conflict-debouncer.js";
import { resolveTaskSessionId } from "../../../sprint/action-required-automation.js";
import { buildTaskAttentionPayload } from "./attention-payload-builder.js";
import { buildConflictSummaryMarkdown, selectMergedTaskContexts, type MergeConflictTaskContext } from "./conflict-summary-utils.js";
import type { CycleRunnerArgs } from "./cycle-runner.js";

export interface TaskStateSnapshot {
  id: string;
  status: Subtask["status"];
  isMerged: boolean;
  mergeIndicator: Subtask["merge_indicator"];
  workerBranch: string | null;
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
    activeMergeConflictTaskIds: Set<string>,
    activeHumanMergeConflictEscalationTaskIds: Set<string>,
    mergeConflictDebouncer?: MergeConflictDebouncer,
    activeWorkerCiFixTaskIds: Set<string> = new Set(),
    resolvedWorkerMergeConflictKeys: Set<string> = new Set(),
    activeProjectAttentionItems: ProjectAttentionItemRecord[] = [],
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
      const pr = gitStatus?.available ? matchPrForTask(task, gitStatus) : undefined;
      const resolvedWorkerConflictKey = buildResolvedWorkerMergeConflictKey(
        taskId,
        task.worker_branch || pr?.headRefName || null,
        args.defaultFeatureBranch,
      );
      if (
        resolvedWorkerMergeConflictKeys.has(resolvedWorkerConflictKey)
        || resolvedWorkerMergeConflictKeys.has(taskId)
      ) {
        continue;
      }

      mergeTaskIds.add(taskId);
      const mergeConflictDetected = shouldEscalateFeatureMergeConflict(
        task,
        args,
        gitStatus,
        activeMergeConflictTaskIds,
        mergeConflictDebouncer,
        resolvedWorkerMergeConflictKeys,
      );
      const humanEscalationActive = mergeConflictDetected
        && activeHumanMergeConflictEscalationTaskIds.has(taskId);
      const mergedFeatureTasks = selectMergedFeatureTaskContexts(subtasks, taskId);
      const attentionType = mergeConflictDetected ? "merge_conflict" : "merge_required";
      const ownerType: ProjectAttentionOwnerType = "worker";
      const title = mergeConflictDetected
        ? `Merge conflict for ${task.id}`
        : `Merge required for ${task.id}`;
      const summaryMarkdown = mergeConflictDetected
        ? buildMergeConflictSummary(task, args, pr || null, mergedFeatureTasks)
        : task.merge_indicator === "MERGE_BLOCKED"
          ? `Task \`${task.id}\` is complete but blocked on merge work that could not be resolved automatically.`
          : `Task \`${task.id}\` is complete and awaiting merge into \`${args.defaultFeatureBranch}\`.`;

      if (!humanEscalationActive) {
        itemsToOpen.push(buildTaskAttentionPayload({
          projectId,
          sprintId,
          taskId,
          sprintRunId: sprintRunId || "",
          attentionType,
          severity: mergeConflictDetected || task.merge_indicator === "MERGE_BLOCKED" ? "high" : "medium",
          ownerType,
          title,
          summaryMarkdown,
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
            reason: mergeConflictDetected
              ? "merge_conflict_attention_replaced"
              : "merge_required_attention_replaced",
          },
        });
      } else {
        itemsToResolve.push({
          filter: {
            projectId,
            taskId,
            attentionTypes: ["merge_required", "merge_conflict"],
          },
          resolution: {
            status: "resolved",
            reason: "merge_conflict_human_escalation_active",
          },
        });
      }
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
          // Without the session id the virtual worker cannot drive the
          // intervention (approve plan / answer clarification / resume) and is
          // forced to escalate every agent-owned item to a human with
          // "No session ID available", which pauses the whole sprint.
          sessionId: resolveTaskSessionId(task),
          sessionName: task.session_name || null,
          sessionState: task.session_state || null,
          provider: task.provider || null,
          interventionOwner: task.intervention_owner || "HUMAN",
        },
      }));
    }

    const ciFixTaskIds = new Set<string>();
    for (const task of subtasks) {
      const taskId = task.record_id?.trim();
      if (taskId && task.merge_indicator === "CI" && (task.status === "RUNNING" || task.status === "CODING_COMPLETED")) {
        ciFixTaskIds.add(taskId);
      }
    }

    for (const taskId of knownTaskIds) {
      if (!mergeTaskIds.has(taskId) && !ciFixTaskIds.has(taskId)) {
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
      if (!ciFixTaskIds.has(taskId) && !activeWorkerCiFixTaskIds.has(taskId)) {
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
    this.resolveStaleHumanMergeConflictEscalations(
      subtasks,
      args,
      activeProjectAttentionItems,
    );
  }

  resolveStaleHumanMergeConflictEscalations(
    subtasks: Subtask[],
    args: CycleRunnerArgs,
    activeProjectAttentionItems: ProjectAttentionItemRecord[],
  ): Set<string> {
    const resolvedItemIds = new Set<string>();
    if (
      activeProjectAttentionItems.length === 0
      || typeof this.deps.projectAttentionService?.resolveItem !== "function"
    ) {
      return resolvedItemIds;
    }

    const sprintId = args.executionContext.sprint.id;
    const tasksByRecordId = new Map(
      subtasks
        .map((task) => [task.record_id?.trim() || "", task] as const)
        .filter(([taskId]) => taskId.length > 0),
    );
    const tasksByTaskKey = new Map(
      subtasks
        .map((task) => [task.id?.trim() || "", task] as const)
        .filter(([taskKey]) => taskKey.length > 0),
    );

    for (const item of activeProjectAttentionItems) {
      if (!isTaskLevelHumanMergeConflictEscalation(item, sprintId)) {
        continue;
      }
      const taskId = item.taskId?.trim() || "";
      const taskKey = typeof item.payload?.taskKey === "string" ? item.payload.taskKey.trim() : "";
      const task = tasksByRecordId.get(taskId) || (taskKey ? tasksByTaskKey.get(taskKey) : undefined);
      if (!task || task.merge_indicator === "MERGE_CONFLICT") {
        continue;
      }

      this.deps.projectAttentionService.resolveItem(item.id, {
        status: "dismissed",
        reason: "stale_merge_conflict_handoff_cleared",
        resolutionSummaryMarkdown: [
          "Code UX dismissed this stale merge-conflict handoff because the task no longer carries a MERGE_CONFLICT marker.",
          "",
          "The normal merge gate will retry or reopen a fresh conflict if Git still reports one.",
        ].join("\n"),
        payloadPatch: {
          staleHandoffClearedByCycle: true,
          staleHandoffClearedAtTaskState: {
            status: task.status,
            mergeIndicator: task.merge_indicator || null,
            isMerged: Boolean(task.is_merged),
          },
        },
      });
      resolvedItemIds.add(item.id);
    }
    return resolvedItemIds;
  }
}

export function isTaskLevelHumanMergeConflictEscalation(
  item: ProjectAttentionItemRecord,
  sprintId: string,
): boolean {
  if (
    item.sprintId !== sprintId
    || !item.taskId
    || item.ownerType !== "human"
    || (item.attentionType !== "human_escalation_required" && item.attentionType !== "dashboard_reply_required")
    || item.payload?.sourceAttentionType !== "merge_conflict"
  ) {
    return false;
  }
  return item.payload?.mergeStage !== "main";
}

export function shouldEscalateFeatureMergeConflict(
  task: Subtask,
  args: CycleRunnerArgs,
  gitStatus: GitTrackingStatus | null,
  activeWorkerMergeConflictTaskIds: Set<string>,
  mergeConflictDebouncer?: MergeConflictDebouncer,
  resolvedWorkerMergeConflictKeys: Set<string> = new Set(),
): boolean {
  if (!args.ciIntelligence.resolveMergeConflicts) {
    return false;
  }

  const taskId = task.record_id?.trim();
  const pr = gitStatus?.available ? matchPrForTask(task, gitStatus) : undefined;
  const resolvedWorkerConflictKey = taskId
    ? buildResolvedWorkerMergeConflictKey(
        taskId,
        task.worker_branch || pr?.headRefName || null,
        args.defaultFeatureBranch,
      )
    : null;
  if (
    taskId
    && (
      (resolvedWorkerConflictKey && resolvedWorkerMergeConflictKeys.has(resolvedWorkerConflictKey))
      // Backward-compatible fallback for tests or custom integrations still passing task ids.
      || resolvedWorkerMergeConflictKeys.has(taskId)
    )
  ) {
    return false;
  }

  if (taskId && activeWorkerMergeConflictTaskIds.has(taskId)) {
    return task.merge_indicator === "MERGE_CONFLICT" || Boolean(pr);
  }

  if (task.merge_indicator === "MERGE_CONFLICT") {
    return true;
  }

  if (!gitStatus?.available) {
    return false;
  }

  // Debounce transient `DIRTY` states so a phantom conflict (GitHub still
  // recomputing mergeability) does not escalate before it has actually persisted.
  // `observe` is idempotent within a cycle, so sharing the debouncer with the CI
  // gate keeps both in agreement on what counts as a confirmed conflict.
  return mergeConflictDebouncer
    ? mergeConflictDebouncer.observe(pr?.url, pr?.mergeStateStatus)
    : pr?.mergeStateStatus === "DIRTY";
}

export function buildResolvedWorkerMergeConflictKey(
  taskId: string,
  sourceBranch: string | null | undefined,
  targetBranch: string | null | undefined,
): string {
  return [
    taskId.trim(),
    sourceBranch?.trim() || "",
    targetBranch?.trim() || "",
  ].join("\0");
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

export function collectActiveWorkerCiFixTaskIds(subtasks: Array<{
  taskId: string | null;
  attentionType: string;
  ownerType: string;
}>): Set<string> {
  return new Set(
    subtasks
      .filter((item) => item.attentionType === "ci_fix_required" && item.ownerType === "worker")
      .map((item) => item.taskId?.trim())
      .filter((taskId): taskId is string => Boolean(taskId)),
  );
}

export function collectActiveHumanMergeConflictEscalationTaskIds(subtasks: Array<{
  taskId: string | null;
  attentionType: string;
  ownerType: string;
  payload?: Record<string, unknown> | null;
}>): Set<string> {
  return new Set(
    subtasks
      .filter((item) => (
        item.ownerType === "human"
        && (item.attentionType === "human_escalation_required" || item.attentionType === "dashboard_reply_required")
        && item.payload?.sourceAttentionType === "merge_conflict"
      ))
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
    workerBranch: task.worker_branch || null,
  }]));
}

export function hasMergeStateChanges(previous: Map<string, TaskStateSnapshot>, subtasks: Subtask[]): boolean {
  return subtasks.some((task) => {
    const earlier = previous.get(task.id);
    if (!earlier) {
      return true;
    }
    return earlier.isMerged !== Boolean(task.is_merged)
      || earlier.mergeIndicator !== task.merge_indicator;
  });
}

export function resolveCiStatusCacheTtlMs(watchLoopIntervalSeconds: number | undefined): number {
  const watchLoopIntervalMs = Math.max(1, Number(watchLoopIntervalSeconds || 0)) * 1000;
  // Floor at 10s so a project's git/CI status is refreshed at most every ~10s regardless of how
  // tight the watch-loop interval is. This keeps git operations (and the containers backing them)
  // consolidated per project instead of spinning up on every short cycle.
  return Math.min(15_000, Math.max(10_000, watchLoopIntervalMs));
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
    case "CODING_COMPLETED":
      return "coding_completed";
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
