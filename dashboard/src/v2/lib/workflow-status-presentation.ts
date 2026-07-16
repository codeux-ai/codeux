import type { SprintReviewSummary } from "../types.js";
import type { ExecutionAttentionItemSummary } from "../../types.js";
import type {
  CiStatusPresentation,
  CiWorkflowState,
  CiWorkflowStep,
} from "./ci-status-presentation.js";
import type { DashboardLocale } from "../i18n/index.js";
import { translateTask, type TaskTextKey } from "../i18n/messages/tasks.js";

export type WorkflowStageId = "planning" | "coding" | "pull_request" | "qa" | "checks" | "merge" | "completion";

export interface WorkflowStage {
  id: WorkflowStageId;
  label: string;
  state: CiWorkflowState;
  statusLabel: string;
}

export interface WorkflowStatusPresentation {
  scope: "task" | "sprint";
  state: CiWorkflowState;
  tone: "pending" | "active" | "successful" | "failed" | "qa_changes";
  label: string;
  accessibleLabel: string;
  requiresHuman: boolean;
  stages: WorkflowStage[];
}

export interface WorkflowHumanInterventionEvidence {
  ownerType: string | null;
  status?: string | null;
  assignedWorkerEndpointId?: string | null;
  title?: string | null;
}

export interface WorkflowTaskIdentity {
  recordId?: string | null;
  taskKey?: string | null;
  sprintId?: string | null;
  dispatchId?: string | null;
}

export interface WorkflowStatusPresentationInput {
  scope: "task" | "sprint";
  status: string;
  completion?: number;
  tasksCount?: number;
  planningStatus?: string | null;
  review?: SprintReviewSummary | null;
  ciPresentation?: CiStatusPresentation | null;
  humanIntervention?: WorkflowHumanInterventionEvidence | null;
}

const WORKFLOW_COPY_KEYS: Readonly<Record<string, TaskTextKey>> = {
  Planning: "workflowPlanning", "Planning in progress": "workflowPlanningInProgress", "Planning complete": "workflowPlanningComplete", "Planning paused": "workflowPlanningPaused", "Planning failed": "workflowPlanningFailed", "Planning cancelled": "workflowPlanningCancelled", "Planning pending": "workflowPlanningPending",
  "Pull request": "workflowPullRequest", "Pull request ready": "workflowPullRequestReady", "CI checks": "workflowCiChecks", "Checks passed": "workflowChecksPassed", Merge: "workflowMerge", Merged: "workflowMerged", "Waiting for pull request": "workflowWaitingForPullRequest", "Checks pending": "workflowChecksPending", "Merge pending": "workflowMergePending",
  QA: "workflowQa", "Review in progress": "workflowReviewInProgress", "Changes requested": "workflowChangesRequested", "Review failed": "workflowReviewFailed", "QA passed": "workflowQaPassed", "QA cleared": "workflowQaCleared", "No review required": "workflowNoReviewRequired", "Review pending": "workflowReviewPending", "QA pending": "workflowQaPending",
  Coding: "workflowCoding", "Coding cancelled": "workflowCodingCancelled", "Coding failed": "workflowCodingFailed", "Coding complete": "workflowCodingComplete", "Coding queued": "workflowCodingQueued", "Quota wait": "workflowQuotaWait", "Provider capacity wait": "workflowProviderCapacityWait", "Preparing workspace": "workflowPreparingWorkspace", "Coding in progress": "workflowCodingInProgress", "Coding blocked": "workflowCodingBlocked", "Coding paused": "workflowCodingPaused", "Waiting to start": "workflowWaitingToStart",
  Completion: "workflowCompletion", "Workflow complete": "workflowComplete", "Workflow cancelled": "workflowCancelled", "Workflow failed": "workflowFailed", "Completion pending": "workflowCompletionPending",
  "QA changes": "workflowQaChanges", "QA failed": "workflowQaFailed", "CI failed": "workflowCiFailed", "Merge conflict": "workflowMergeConflict", "Merge failed": "workflowMergeFailed", "CI running": "workflowCiRunning", "Creating PR": "workflowCreatingPr", "QA running": "workflowQaRunning", "Merge running": "workflowMergeRunning", Completed: "workflowCompleted", "Coding pending": "workflowCodingPending", "CI passed": "workflowCiPassed", "PR ready": "workflowPrReady", "PR pending": "workflowPrPending", "Human needed": "workflowHumanNeeded", CI: "workflowCi",
};

function localizeWorkflowCopy(locale: DashboardLocale, value: string): string {
  const key = WORKFLOW_COPY_KEYS[value];
  return key ? translateTask(locale, key) : value;
}

function normalizeStatus(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

const ACTIVE_ATTENTION_STATUSES = new Set(["open", "claimed"]);
const HUMAN_ATTENTION_OWNERS = new Set(["human", "user"]);

/**
 * Human-needed is intentionally narrower than generic attention: the item must
 * still be active, explicitly human-owned, and explicitly unassigned. A
 * sprint-run intervention summary is not sufficient evidence because that
 * contract omits status/assignment and may be synthesized from lifecycle
 * events such as a manual pause or runtime error.
 */
export function isActiveHumanIntervention(
  intervention: WorkflowHumanInterventionEvidence | null | undefined,
): boolean {
  if (!intervention) return false;
  const ownerType = normalizeStatus(intervention.ownerType ?? "");
  const status = intervention.status == null ? null : normalizeStatus(intervention.status);
  const hasExplicitWorkerAssignment = Object.prototype.hasOwnProperty.call(
    intervention,
    "assignedWorkerEndpointId",
  );
  return HUMAN_ATTENTION_OWNERS.has(ownerType)
    && status !== null
    && ACTIVE_ATTENTION_STATUSES.has(status)
    && hasExplicitWorkerAssignment
    && intervention.assignedWorkerEndpointId === null;
}

function attentionTaskIds(item: ExecutionAttentionItemSummary): string[] {
  const ids = [item.taskId];
  for (const key of ["taskId", "taskKey"] as const) {
    const value = item.payload?.[key];
    if (typeof value === "string") ids.push(value);
  }
  return ids.flatMap((value) => value?.trim() ? [value.trim()] : []);
}

export function findActiveTaskHumanIntervention(
  attentionItems: readonly ExecutionAttentionItemSummary[] | undefined,
  identity: WorkflowTaskIdentity,
): ExecutionAttentionItemSummary | null {
  const taskIds = new Set(
    [identity.recordId, identity.taskKey].flatMap((value) => value?.trim() ? [value.trim()] : []),
  );
  if (taskIds.size === 0 && !identity.dispatchId) return null;

  return attentionItems?.find((item) => {
    if (!isActiveHumanIntervention(item)) return false;
    if (identity.sprintId && item.sprintId && item.sprintId !== identity.sprintId) return false;
    if (identity.dispatchId && item.dispatchId === identity.dispatchId) return true;
    return attentionTaskIds(item).some((taskId) => taskIds.has(taskId));
  }) ?? null;
}

function fallbackCiStep(id: CiWorkflowStep["id"], workflowCompleted: boolean): CiWorkflowStep {
  const labels = workflowCompleted
    ? {
      pull_request: ["Pull request", "Pull request ready"],
      checks: ["CI checks", "Checks passed"],
      merge: ["Merge", "Merged"],
    } as const
    : {
      pull_request: ["Pull request", "Waiting for pull request"],
      checks: ["CI checks", "Checks pending"],
      merge: ["Merge", "Merge pending"],
    } as const;
  return {
    id,
    label: labels[id][0],
    state: workflowCompleted ? "successful" : "pending",
    statusLabel: labels[id][1],
  };
}

function resolveCiStep(
  id: CiWorkflowStep["id"],
  observed: CiWorkflowStep | undefined,
  workflowCompleted: boolean,
): CiWorkflowStep {
  if (workflowCompleted && observed?.state !== "successful") {
    return fallbackCiStep(id, true);
  }
  return observed ?? fallbackCiStep(id, workflowCompleted);
}

function deriveReviewStage(
  review: SprintReviewSummary | null | undefined,
  status: string,
  ciSteps: readonly CiWorkflowStep[],
): WorkflowStage {
  if (review) {
    const reviewStatus = normalizeStatus(review.status);
    const outcome = normalizeStatus(review.outcome ?? "");
    if (reviewStatus === "running" || reviewStatus === "in_progress" || reviewStatus === "pending") {
      return { id: "qa", label: "QA", state: "in_progress", statusLabel: "Review in progress" };
    }
    if (outcome === "changes_requested") {
      return { id: "qa", label: "QA", state: "failed", statusLabel: "Changes requested" };
    }
    if (["failed", "errored", "cancelled"].includes(reviewStatus) || ["failed", "rejected"].includes(outcome)) {
      return { id: "qa", label: "QA", state: "failed", statusLabel: "Review failed" };
    }
    if (["pass", "passed", "approved", "success", "successful"].includes(outcome) || reviewStatus === "completed") {
      return { id: "qa", label: "QA", state: "successful", statusLabel: "QA passed" };
    }
  }

  const downstreamStarted = ciSteps.slice(1).some((step) => step.state !== "pending");
  if (downstreamStarted) {
    return { id: "qa", label: "QA", state: "successful", statusLabel: "QA cleared" };
  }
  if (status === "completed") {
    return { id: "qa", label: "QA", state: "successful", statusLabel: "No review required" };
  }
  if (status === "qa_pending") {
    return { id: "qa", label: "QA", state: "in_progress", statusLabel: "Review pending" };
  }
  return { id: "qa", label: "QA", state: "pending", statusLabel: "QA pending" };
}

function deriveCodingStage(
  status: string,
  review: SprintReviewSummary | null | undefined,
  ciSteps: readonly CiWorkflowStep[],
): WorkflowStage {
  const hasPostCodingEvidence = Boolean(review) || ciSteps.some((step) => step.state !== "pending");
  if (["failed", "cancelled"].includes(status)) {
    return { id: "coding", label: "Coding", state: "failed", statusLabel: status === "cancelled" ? "Coding cancelled" : "Coding failed" };
  }
  if (["completed", "coding_completed", "qa_review_failed"].includes(status) || hasPostCodingEvidence) {
    return { id: "coding", label: "Coding", state: "successful", statusLabel: "Coding complete" };
  }
  if (["in_progress", "running", "queued", "preparing", "quota", "provider_cap"].includes(status)) {
    const statusLabel = status === "queued"
      ? "Coding queued"
      : status === "quota"
        ? "Quota wait"
        : status === "provider_cap"
          ? "Provider capacity wait"
          : status === "preparing"
            ? "Preparing workspace"
            : "Coding in progress";
    return { id: "coding", label: "Coding", state: "in_progress", statusLabel };
  }
  if (status === "blocked") return { id: "coding", label: "Coding", state: "pending", statusLabel: "Coding blocked" };
  if (status === "paused") {
    return { id: "coding", label: "Coding", state: "in_progress", statusLabel: "Coding paused" };
  }
  return { id: "coding", label: "Coding", state: "pending", statusLabel: "Waiting to start" };
}

function derivePlanningStage(input: WorkflowStatusPresentationInput, status: string): WorkflowStage {
  const planningStatus = normalizeStatus(input.planningStatus ?? "");
  if (planningStatus === "running") {
    return { id: "planning", label: "Planning", state: "in_progress", statusLabel: "Planning in progress" };
  }
  if (planningStatus === "paused") {
    return { id: "planning", label: "Planning", state: "in_progress", statusLabel: "Planning paused" };
  }
  if (status === "idle" && planningStatus === "failed") {
    return { id: "planning", label: "Planning", state: "failed", statusLabel: "Planning failed" };
  }
  if (status === "idle" && planningStatus === "cancelled") {
    return { id: "planning", label: "Planning", state: "failed", statusLabel: "Planning cancelled" };
  }
  if ((input.tasksCount ?? 0) > 0 || status !== "idle" || planningStatus === "completed") {
    return { id: "planning", label: "Planning", state: "successful", statusLabel: "Planning complete" };
  }
  return { id: "planning", label: "Planning", state: "pending", statusLabel: "Planning pending" };
}

function deriveCompletionStage(status: string): WorkflowStage {
  if (status === "completed") {
    return { id: "completion", label: "Completion", state: "successful", statusLabel: "Workflow complete" };
  }
  if (["failed", "cancelled"].includes(status)) {
    return { id: "completion", label: "Completion", state: "failed", statusLabel: status === "cancelled" ? "Workflow cancelled" : "Workflow failed" };
  }
  return { id: "completion", label: "Completion", state: "pending", statusLabel: "Completion pending" };
}

function displayLabel(stages: readonly WorkflowStage[]): string {
  const failed = stages.find((stage) => stage.state === "failed");
  if (failed) {
    if (failed.id === "qa") return failed.statusLabel === "Changes requested" ? "QA changes" : "QA failed";
    if (failed.id === "checks") return "CI failed";
    if (failed.id === "merge") return failed.statusLabel === "Merge conflict" ? "Merge conflict" : "Merge failed";
    return failed.statusLabel;
  }
  const active = stages.find((stage) => stage.state === "in_progress");
  if (active) {
    if (active.id === "checks") return "CI running";
    if (active.id === "pull_request") return "Creating PR";
    if (active.id === "qa") return "QA running";
    if (active.id === "merge") return "Merge running";
    return active.statusLabel;
  }
  const completion = stages[stages.length - 1];
  if (completion.state === "successful") return "Completed";
  const furthestSuccessful = [...stages].reverse().find((stage) => stage.state === "successful");
  if (!furthestSuccessful) return stages[0]?.id === "planning" ? "Planning pending" : "Coding pending";
  if (furthestSuccessful.id === "merge") return "Merged";
  if (furthestSuccessful.id === "checks") return "CI passed";
  if (furthestSuccessful.id === "qa") return "QA passed";
  if (furthestSuccessful.id === "pull_request") return "PR ready";
  if (furthestSuccessful.id === "planning") return "Coding pending";
  return "PR pending";
}

export function deriveWorkflowStatusPresentation(
  input: WorkflowStatusPresentationInput,
  locale: DashboardLocale = "en",
): WorkflowStatusPresentation {
  const status = normalizeStatus(input.status);
  const planningStatus = normalizeStatus(input.planningStatus ?? "");
  const planningOwnsWorkflow = input.scope === "sprint"
    && (
      ["running", "paused"].includes(planningStatus)
      || (status === "idle" && ["failed", "cancelled"].includes(planningStatus))
    );
  const workflowCompleted = status === "completed";
  const suppressRunningSprintTaskGates = input.scope === "sprint"
    && ((status === "running" && input.completion !== 100) || planningOwnsWorkflow);
  const ciPresentation = suppressRunningSprintTaskGates ? null : input.ciPresentation;
  const stageReview = suppressRunningSprintTaskGates ? null : input.review;
  const pullRequest = resolveCiStep("pull_request", ciPresentation?.steps[0], workflowCompleted);
  const checks = resolveCiStep("checks", ciPresentation?.steps[1], workflowCompleted);
  const merge = resolveCiStep("merge", ciPresentation?.steps[2], workflowCompleted);
  const ciSteps = [pullRequest, checks, merge];
  const coding = deriveCodingStage(status, stageReview, ciSteps);
  const qa = deriveReviewStage(stageReview, status, ciSteps);
  const pullRequestStage = { ...pullRequest, id: "pull_request" as const };
  const checksStage = { ...checks, id: "checks" as const, label: "CI" };
  const mergeStage = { ...merge, id: "merge" as const };
  const completionStage = deriveCompletionStage(status);
  const stages: WorkflowStage[] = input.scope === "sprint"
    ? [
        derivePlanningStage(input, status),
        coding,
        qa,
        pullRequestStage,
        checksStage,
        mergeStage,
        completionStage,
      ]
    : [coding, pullRequestStage, qa, checksStage, mergeStage, completionStage];
  const failed = stages.some((stage) => stage.state === "failed");
  const active = stages.some((stage) => stage.state === "in_progress");
  const requiresHuman = isActiveHumanIntervention(input.humanIntervention);
  const state: CiWorkflowState = requiresHuman || failed
    ? "failed"
    : active
      ? "in_progress"
      : completionStage.state === "successful"
        ? "successful"
        : "pending";
  const label = localizeWorkflowCopy(locale, requiresHuman ? "Human needed" : displayLabel(stages));
  const qaChangesRequested = stages.some((stage) => (
    stage.id === "qa" && stage.state === "failed" && stage.statusLabel === "Changes requested"
  ));
  const localizedStages = stages.map((stage) => {
    const observed = stage.id === "pull_request"
      ? ciPresentation?.steps[0]
      : stage.id === "checks"
        ? ciPresentation?.steps[1]
        : stage.id === "merge"
          ? ciPresentation?.steps[2]
          : null;
    const preserveObservedCopy = observed && !(workflowCompleted && observed.state !== "successful");
    return {
      ...stage,
      label: stage.id === "checks" ? localizeWorkflowCopy(locale, "CI") : preserveObservedCopy ? stage.label : localizeWorkflowCopy(locale, stage.label),
      statusLabel: preserveObservedCopy ? stage.statusLabel : localizeWorkflowCopy(locale, stage.statusLabel),
    };
  });
  return {
    scope: input.scope,
    state,
    tone: requiresHuman
      ? "failed"
      : qaChangesRequested
      ? "qa_changes"
      : state === "in_progress"
        ? "active"
        : state,
    label,
    accessibleLabel: `${label}. ${requiresHuman && input.humanIntervention?.title ? `${input.humanIntervention.title}. ` : ""}${localizedStages.map((stage) => `${stage.label}: ${stage.statusLabel}`).join(". ")}.`,
    requiresHuman,
    stages: localizedStages,
  };
}
