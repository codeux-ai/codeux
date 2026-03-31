import type { Subtask, GitTrackingStatus, GitPullRequestStatus } from "../../../contracts/app-types.js";
import type { ProjectAttentionType, ProjectAttentionOwnerType } from "../../../contracts/project-attention-types.js";
import type { CycleRunnerArgs } from "./cycle-runner.js";
import { matchPrForTask } from "../ci/feature-pr/pr-matcher.js";
import { buildTaskAttentionPayload } from "./attention-payload-builder.js";
import { buildConflictSummaryMarkdown, type MergeConflictTaskContext, selectMergedTaskContexts } from "./conflict-summary-utils.js";

export interface AttentionItemOpenPlan {
  taskId: string;
  payload: ReturnType<typeof buildTaskAttentionPayload>;
}

export interface AttentionItemResolvePlan {
  taskId: string;
  typesToResolve: ProjectAttentionType[];
  reason: string;
}

export interface AttentionPlan {
  toOpen: AttentionItemOpenPlan[];
  toResolve: AttentionItemResolvePlan[];
  metadata?: Record<string, unknown>;
}

export function buildAttentionPlan(
  subtasks: Subtask[],
  protocolResult: {
    awaitingMerge: Subtask[];
    actionRequiredTasks: Subtask[];
  },
  args: CycleRunnerArgs,
  gitStatus: GitTrackingStatus | null,
  activeWorkerMergeConflictTaskIds: Set<string>,
): AttentionPlan {
  const plan: AttentionPlan = {
    toOpen: [],
    toResolve: [],
    metadata: {},
  };

  const projectId = args.executionContext.project.id;
  const sprintId = args.executionContext.sprint.id;
  const sprintRunId = args.sprintRunId || "";

  const knownTaskIds = new Set<string>();
  for (const task of subtasks) {
    const taskId = task.record_id?.trim();
    if (taskId) {
      knownTaskIds.add(taskId);
    }
  }

  const mergeTaskIds = new Set<string>();
  for (const task of protocolResult.awaitingMerge) {
    const taskId = task.record_id?.trim();
    if (!taskId) continue;

    mergeTaskIds.add(taskId);
    const pr = gitStatus?.available ? matchPrForTask(task, gitStatus) : undefined;
    const mergeConflictDetected = shouldEscalateFeatureMergeConflict(
      task,
      args,
      gitStatus,
      activeWorkerMergeConflictTaskIds,
    );
    const mergedFeatureTasks = selectMergedFeatureTaskContexts(subtasks, taskId);

    const payload = buildTaskAttentionPayload({
      projectId,
      sprintId,
      taskId,
      sprintRunId,
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
    });

    plan.toOpen.push({ taskId, payload });

    // Based on whether a conflict was detected, resolve the corresponding type
    plan.toResolve.push({
      taskId,
      typesToResolve: [mergeConflictDetected ? "merge_required" : "merge_conflict"],
      reason: mergeConflictDetected ? "merge_conflict_attention_replaced" : "merge_required_attention_replaced",
    });
  }

  const actionTaskIds = new Set<string>();
  for (const task of protocolResult.actionRequiredTasks) {
    const taskId = task.record_id?.trim();
    if (!taskId) continue;

    actionTaskIds.add(taskId);
    const ownerType: ProjectAttentionOwnerType = task.intervention_owner === "AGENT" ? "worker" : "human";
    const payload = buildTaskAttentionPayload({
      projectId,
      sprintId,
      taskId,
      sprintRunId,
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
    });

    plan.toOpen.push({ taskId, payload });
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
      plan.toResolve.push({
        taskId,
        typesToResolve: ["merge_required", "merge_conflict"],
        reason: "merge_attention_cleared",
      });
    }
    if (!actionTaskIds.has(taskId)) {
      plan.toResolve.push({
        taskId,
        typesToResolve: ["action_required"],
        reason: "action_required_cleared",
      });
    }
    if (!ciFixTaskIds.has(taskId)) {
      plan.toResolve.push({
        taskId,
        typesToResolve: ["ci_fix_required"],
        reason: "ci_fix_attention_cleared",
      });
    }
  }

  return plan;
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
