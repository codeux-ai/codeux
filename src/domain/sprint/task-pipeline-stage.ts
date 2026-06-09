import type {
  FeaturePrAutoMergeMode,
  Subtask,
  SubtaskMergeIndicator,
  SubtaskStatus,
} from "../../contracts/app-types.js";

/**
 * Canonical pipeline stage a task occupies. This is the single source of truth
 * for "where is this task in the Coding → CI → QA → Merge → Completed flow".
 *
 * The persisted `status` + `merge_indicator` + `is_merged` fields are a
 * *projection* of this stage (see {@link resolveTaskPipelineStage}); every
 * transition site derives them through this module rather than hand-rolling
 * transitions, so disabled stages are skipped consistently and a task is never
 * marked COMPLETED/MERGED before it has actually progressed there.
 */
export type TaskPipelineStage =
  | "CODING" // producing code (PENDING / RUNNING)
  | "CI" // post-coding, waiting on CI checks (only reached when CI is active + a PR exists)
  | "QA" // post-coding, waiting on QA review (only reached when QA is enabled and blocks merge)
  | "MERGE" // post-coding, ready / awaiting merge (auto or manual)
  | "MERGE_CONFLICT" // post-coding, branch/PR conflicts with its target
  | "COMPLETED" // merged, OR genuinely nothing to merge
  | "FAILED"
  | "BLOCKED"
  | "QUOTA";

/** Observed task fields the stage decision reads. */
export interface TaskStageObservation {
  status: SubtaskStatus | undefined;
  isMerged: boolean;
  mergeIndicator: SubtaskMergeIndicator | undefined;
  workerBranch?: string | null;
  prUrl?: string | null;
}

/** Environment / policy inputs that influence the projection. */
export interface TaskStageEnvironment {
  githubMode?: "REMOTE" | "LOCAL";
  /** The provider session / task run reached a terminal COMPLETED state. */
  isExecutionCompleted?: boolean;
  /** A pull request was detected for the task (gitStatus match or pr_url). */
  hasPr?: boolean;
  /**
   * QA merge-gate result. `false` means QA is enabled and is currently blocking
   * the merge; `true`/`undefined` means QA either passed or is not required, so
   * the QA stage is skipped.
   */
  qaMergeAllowed?: boolean;
}

export interface TaskStageProjection {
  stage: TaskPipelineStage;
  status: SubtaskStatus;
  mergeIndicator: SubtaskMergeIndicator | undefined;
  isMerged: boolean;
}

type StageObservationLike = Pick<
  Subtask,
  "status" | "is_merged" | "merge_indicator" | "worker_branch" | "pr_url"
>;

function toObservation(task: StageObservationLike): TaskStageObservation {
  return {
    status: task.status,
    isMerged: Boolean(task.is_merged),
    mergeIndicator: task.merge_indicator,
    workerBranch: task.worker_branch,
    prUrl: task.pr_url,
  };
}

const trimmed = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim() : "";

/**
 * Whether a task has something real to merge.
 *
 * Evidence is a pushed worker branch or an open PR — nothing else. We
 * deliberately do *not* treat "execution completed with no PR detected yet" as a
 * signal here: that previously masked a real worker branch and force-settled
 * tasks as complete (and the no-changes CLI path used to fabricate a phantom
 * worker branch). A task that genuinely produced no changes carries no branch
 * and no PR, so it has no evidence and settles cleanly.
 */
export function taskHasMergeEvidence(
  task: Pick<Subtask, "worker_branch" | "pr_url">,
  _options?: TaskStageEnvironment,
): boolean {
  return trimmed(task.worker_branch).length > 0 || trimmed(task.pr_url).length > 0;
}

export function isTaskCodeComplete(task: Pick<Subtask, "status">): boolean {
  return task.status === "CODING_COMPLETED" || task.status === "COMPLETED";
}

function isMergeSettled(task: Pick<Subtask, "is_merged" | "merge_indicator">): boolean {
  return (
    Boolean(task.is_merged) ||
    task.merge_indicator === "MERGED" ||
    task.merge_indicator === "AUTOMERGE" ||
    task.merge_indicator === "PR_ONLY"
  );
}

/**
 * Normalize the merge indicator that should rest on a task given its evidence.
 * A merged task is MERGED/AUTOMERGE; a conflicting task stays MERGE_CONFLICT
 * (sticky until cleared by the gate); a task with no evidence carries no
 * indicator; otherwise the existing indicator is preserved.
 */
export function normalizeTaskMergeIndicator(
  task: Pick<Subtask, "is_merged" | "merge_indicator" | "worker_branch" | "pr_url">,
  options?: TaskStageEnvironment,
): SubtaskMergeIndicator | undefined {
  if (task.is_merged) {
    return task.merge_indicator === "AUTOMERGE" ? "AUTOMERGE" : "MERGED";
  }
  if (task.merge_indicator === "MERGE_CONFLICT") {
    return "MERGE_CONFLICT";
  }
  return taskHasMergeEvidence(task, options) ? task.merge_indicator : undefined;
}

/**
 * The core resolver. Computes the canonical stage plus the persisted projection
 * for a task. Pure and side-effect free — the gate performs the actual CI /
 * automerge / QA actions and then re-derives the resting projection from here.
 */
export function resolveTaskPipelineStage(
  observation: TaskStageObservation,
  environment?: TaskStageEnvironment,
): TaskStageProjection {
  const env = environment ?? {};
  const status = observation.status ?? "PENDING";

  // Off-ramps and pre-pipeline statuses pass through. A task that is actively
  // coding (or queued to) must never carry a merge indicator or a merged flag —
  // this clears stale CI/QA/MERGED state left over from a previous run when a
  // task is re-dispatched (QA follow-up, retry, etc.).
  if (status !== "COMPLETED" && status !== "CODING_COMPLETED") {
    if (status === "RUNNING" || status === "PENDING") {
      return { stage: "CODING", status, mergeIndicator: undefined, isMerged: false };
    }
    return {
      stage: mapNonPipelineStage(status),
      status,
      mergeIndicator: observation.mergeIndicator,
      isMerged: observation.isMerged,
    };
  }

  const evidenceTask = {
    is_merged: observation.isMerged,
    merge_indicator: observation.mergeIndicator,
    worker_branch: observation.workerBranch ?? undefined,
    pr_url: observation.prUrl ?? undefined,
  };
  const hasEvidence = taskHasMergeEvidence(evidenceTask, env);
  // QA blocks the merge when the gate explicitly says so, or — absent a fresh
  // gate result — when a QA_PENDING indicator is still resting on the task.
  const qaBlocks =
    env.qaMergeAllowed === false ||
    (env.qaMergeAllowed === undefined && observation.mergeIndicator === "QA_PENDING");
  const mergeIndicator: SubtaskMergeIndicator | undefined = qaBlocks
    ? "QA_PENDING"
    : normalizeTaskMergeIndicator(evidenceTask, env);

  let nextStatus: SubtaskStatus = status;

  // A task marked COMPLETED but still carrying unmerged evidence has not truly
  // finished the pipeline — demote it back to CODING_COMPLETED.
  if (status === "COMPLETED" && hasEvidence && !observation.isMerged) {
    nextStatus = "CODING_COMPLETED";
  } else if (
    status === "CODING_COMPLETED" &&
    !qaBlocks &&
    isPipelineSettled({ ...evidenceTask, merge_indicator: mergeIndicator })
  ) {
    // Nothing left to merge (merged, or genuinely no evidence) and QA permits —
    // settle as COMPLETED.
    nextStatus = "COMPLETED";
  }

  const stage = classifyPostCodingStage({
    status: nextStatus,
    isMerged: observation.isMerged,
    mergeIndicator,
    hasEvidence,
    qaBlocks,
  });

  return { stage, status: nextStatus, mergeIndicator, isMerged: observation.isMerged };
}

function mapNonPipelineStage(status: SubtaskStatus): TaskPipelineStage {
  switch (status) {
    case "FAILED":
      return "FAILED";
    case "QUOTA":
      return "QUOTA";
    case "BLOCKED":
    case "QA_REVIEW_FAILED":
      return "BLOCKED";
    default:
      return "CODING";
  }
}

function isPipelineSettled(
  task: Pick<Subtask, "is_merged" | "merge_indicator" | "worker_branch" | "pr_url">,
): boolean {
  return isMergeSettled(task) || !taskHasMergeEvidence(task);
}

function classifyPostCodingStage(input: {
  status: SubtaskStatus;
  isMerged: boolean;
  mergeIndicator: SubtaskMergeIndicator | undefined;
  hasEvidence: boolean;
  qaBlocks: boolean;
}): TaskPipelineStage {
  if (input.status === "COMPLETED" || isMergeSettled({ is_merged: input.isMerged, merge_indicator: input.mergeIndicator })) {
    return "COMPLETED";
  }
  if (input.qaBlocks || input.mergeIndicator === "QA_PENDING") {
    return "QA";
  }
  if (input.mergeIndicator === "MERGE_CONFLICT") {
    return "MERGE_CONFLICT";
  }
  if (input.mergeIndicator === "CI") {
    return "CI";
  }
  // Has unmerged evidence and no blocking gate → awaiting merge.
  return input.hasEvidence ? "MERGE" : "COMPLETED";
}

/* -------------------------------------------------------------------------- */
/* Convenience wrappers over the resolver — these keep the historical helper   */
/* names/signatures used across the orchestrator while routing every decision  */
/* through the single state machine above.                                     */
/* -------------------------------------------------------------------------- */

export interface PreCiGateTransition {
  status: SubtaskStatus;
  merge_indicator: SubtaskMergeIndicator | undefined;
  intervention_owner: Subtask["intervention_owner"];
  intervention_hint: Subtask["intervention_hint"];
}

/**
 * Resting projection used by the feature-PR gate before it runs live CI work.
 * Equivalent to the previous `evaluatePreCiGateTransition`, now derived from the
 * stage resolver. Intervention metadata is cleared once a task is code-complete.
 */
export function evaluatePreCiGateTransition(
  task: Pick<
    Subtask,
    | "status"
    | "is_merged"
    | "merge_indicator"
    | "worker_branch"
    | "pr_url"
    | "intervention_owner"
    | "intervention_hint"
  >,
  options?: {
    githubMode?: "REMOTE" | "LOCAL";
    qaMergeAllowed?: boolean;
    hasPr?: boolean;
    isExecutionCompleted?: boolean;
  },
): PreCiGateTransition {
  const projection = resolveTaskPipelineStage(toObservation(task), {
    githubMode: options?.githubMode,
    qaMergeAllowed: options?.qaMergeAllowed,
    hasPr: options?.hasPr,
    isExecutionCompleted: options?.isExecutionCompleted,
  });

  const clearIntervention =
    projection.status === "CODING_COMPLETED" || projection.status === "COMPLETED";

  return {
    status: projection.status,
    merge_indicator: projection.mergeIndicator,
    intervention_owner: clearIntervention ? undefined : task.intervention_owner,
    intervention_hint: clearIntervention ? undefined : task.intervention_hint,
  };
}

/** A task that has finished the pipeline (merged or nothing to merge). */
export function isCompletedTaskSettled(
  task: StageObservationLike,
  options?: TaskStageEnvironment,
): boolean {
  return resolveTaskPipelineStage(toObservation(task), options).stage === "COMPLETED";
}

/** A code-complete task still working through CI / merge (excludes QA wait). */
export function isCompletedTaskAwaitingMerge(
  task: StageObservationLike,
  options?: TaskStageEnvironment,
): boolean {
  const stage = resolveTaskPipelineStage(toObservation(task), options).stage;
  return stage === "MERGE" || stage === "CI" || stage === "MERGE_CONFLICT";
}
