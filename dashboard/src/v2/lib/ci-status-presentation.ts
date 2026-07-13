import type {
  ExecutionAttentionItemSummary,
  ExecutionRuntimeEventSummary,
  Subtask,
  SubtaskMergeIndicator,
} from "../../../../src/contracts/app-types.js";

export type CiWorkflowState = "pending" | "in_progress" | "successful" | "failed";
export type CiWorkflowStepId = "pull_request" | "checks" | "merge";
export type CiWorkflowFailureKind = "ci_checks" | "merge_conflict" | "merge_attempt";

export interface CiWorkflowStep {
  id: CiWorkflowStepId;
  label: string;
  state: CiWorkflowState;
  statusLabel: string;
  failureKind?: CiWorkflowFailureKind;
}

export interface CiStatusPresentation {
  scope: "task" | "sprint";
  state: CiWorkflowState;
  label: string;
  accessibleLabel: string;
  steps: [CiWorkflowStep, CiWorkflowStep, CiWorkflowStep];
  failureKind?: CiWorkflowFailureKind;
}

export type CiTaskMergeEvidence = Pick<
  Subtask,
  "record_id" | "id" | "sprint_id" | "merge_indicator" | "is_merged" | "pr_url"
>;

export interface TaskCiStatusPresentationInput {
  task: CiTaskMergeEvidence;
  events?: readonly ExecutionRuntimeEventSummary[];
  attentionItems?: readonly ExecutionAttentionItemSummary[];
  sprintRunId?: string | null;
}

export interface SprintCiStatusPresentationInput {
  sprintId: string;
  sprintRunId?: string | null;
  events?: readonly ExecutionRuntimeEventSummary[];
  attentionItems?: readonly ExecutionAttentionItemSummary[];
  tasks?: readonly CiTaskMergeEvidence[];
}

interface StepStates {
  pullRequest: CiWorkflowState;
  checks: CiWorkflowState;
  merge: CiWorkflowState;
  pullRequestLabel?: string;
  checksLabel?: string;
  mergeLabel?: string;
  checksFailureKind?: CiWorkflowFailureKind;
  mergeFailureKind?: CiWorkflowFailureKind;
}

const ACTIVE_ATTENTION_STATUSES = new Set(["open", "claimed"]);
const STEP_LABELS: Record<CiWorkflowStepId, string> = {
  pull_request: "Pull request",
  checks: "Checks",
  merge: "Merge",
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function checksStateFromPayload(payload: Record<string, unknown>, fallback: CiWorkflowState): CiWorkflowState {
  if (payload.hasFailedChecks === true) return "failed";
  if (payload.hasPendingChecks === true) return "in_progress";
  if (payload.hasFailedChecks === false && payload.hasPendingChecks === false) return "successful";
  return fallback;
}

function eventTimestamp(event: ExecutionRuntimeEventSummary): number {
  const timestamp = Date.parse(event.createdAt);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function isNewerEvent(candidate: ExecutionRuntimeEventSummary, current: ExecutionRuntimeEventSummary): boolean {
  const candidateTime = eventTimestamp(candidate);
  const currentTime = eventTimestamp(current);
  return candidateTime > currentTime || (candidateTime === currentTime && candidate.id.localeCompare(current.id) > 0);
}

function eventEntityKey(event: ExecutionRuntimeEventSummary): string {
  if (event.eventType === "main_merge_gate_status") return "main_merge";
  return stringValue(event.taskId)
    ?? stringValue(event.taskKey)
    ?? stringValue(event.payload?.taskId)
    ?? stringValue(event.taskRunId)
    ?? `event:${event.id}`;
}

function newestEventsByEntity(events: readonly ExecutionRuntimeEventSummary[]): Map<string, ExecutionRuntimeEventSummary> {
  const newest = new Map<string, ExecutionRuntimeEventSummary>();
  for (const event of events) {
    if (event.eventType !== "ci_gate_status" && event.eventType !== "main_merge_gate_status") continue;
    const key = eventEntityKey(event);
    const current = newest.get(key);
    if (!current || isNewerEvent(event, current)) newest.set(key, event);
  }
  return newest;
}

function pendingPullRequest(label = "Waiting for pull request"): StepStates {
  return {
    pullRequest: "pending",
    checks: "pending",
    merge: "pending",
    pullRequestLabel: label,
    checksLabel: "Waiting for pull request",
    mergeLabel: "Waiting for checks",
  };
}

function completedWorkflow(mergeLabel = "Merged"): StepStates {
  return {
    pullRequest: "successful",
    checks: "successful",
    merge: "successful",
    pullRequestLabel: "Pull request ready",
    checksLabel: "Checks passed",
    mergeLabel,
  };
}

function normalizeGateEvent(event: ExecutionRuntimeEventSummary): StepStates | null {
  const payload = event.payload;
  const state = stringValue(payload?.state)?.toLowerCase();
  if (!payload || !state) return null;

  const hasPr = payload.prNumber != null || Boolean(stringValue(payload.prUrl)) || Boolean(event.prUrl);
  const pullRequest: CiWorkflowState = hasPr ? "successful" : "pending";

  if (event.eventType === "main_merge_gate_status") {
    switch (state) {
      case "disabled":
      case "unavailable":
        return null;
      case "missing_pr":
        return pendingPullRequest("Pull request missing");
      case "merged":
      case "automerge_succeeded":
        return completedWorkflow();
      case "failed_checks":
        return { pullRequest: "successful", checks: "failed", merge: "pending", checksLabel: "Checks failed", mergeLabel: "Blocked by checks", checksFailureKind: "ci_checks" };
      case "pending_checks":
        return { pullRequest: "successful", checks: "in_progress", merge: "pending", checksLabel: "Checks running", mergeLabel: "Waiting for checks" };
      case "merge_conflict": {
        const checks = checksStateFromPayload(payload, "pending");
        return {
          pullRequest: "successful",
          checks,
          merge: "failed",
          checksLabel: checks === "failed" ? "Checks failed" : checks === "in_progress" ? "Checks running" : checks === "successful" ? "Checks passed" : "Checks pending",
          mergeLabel: "Merge conflict",
          ...(checks === "failed" ? { checksFailureKind: "ci_checks" as const } : {}),
          mergeFailureKind: "merge_conflict",
        };
      }
      case "review_blocked":
        return { pullRequest: "successful", checks: "successful", merge: "pending", checksLabel: "Checks passed", mergeLabel: "Waiting for review" };
      case "ready_for_merge":
        return { pullRequest: "successful", checks: "successful", merge: "pending", checksLabel: "Checks passed", mergeLabel: "Ready to merge" };
      case "automerge_scheduled": {
        const checks = checksStateFromPayload(payload, "pending");
        return { pullRequest: "successful", checks, merge: "in_progress", checksLabel: checks === "failed" ? "Checks failed" : checks === "in_progress" ? "Checks running" : checks === "successful" ? "Checks passed" : "Checks pending", mergeLabel: "Merge running", ...(checks === "failed" ? { checksFailureKind: "ci_checks" as const } : {}) };
      }
      case "automerge_failed": {
        const checks = checksStateFromPayload(payload, "pending");
        return {
          pullRequest: "successful",
          checks,
          merge: "failed",
          checksLabel: checks === "failed" ? "Checks failed" : checks === "in_progress" ? "Checks running" : checks === "successful" ? "Checks passed" : "Checks pending",
          mergeLabel: "Merge failed",
          ...(checks === "failed" ? { checksFailureKind: "ci_checks" as const } : {}),
          mergeFailureKind: "merge_attempt",
        };
      }
      default:
        return null;
    }
  }

  switch (state) {
    case "waiting_for_pr":
    case "awaiting_merge_no_pr":
      return pendingPullRequest(state === "waiting_for_pr" ? "Waiting for pull request" : "Pull request missing");
    case "no_merge_work":
      return completedWorkflow("No merge needed");
    case "merged_branch":
    case "merge_confirmed":
    case "automerge_succeeded":
      return completedWorkflow();
    case "pr_created_no_merge":
      return completedWorkflow("Merge not required");
    case "ready_for_merge":
      return { pullRequest, checks: "successful", merge: "pending", checksLabel: "Checks passed", mergeLabel: "Ready to merge" };
    case "automerge_scheduled":
      return { pullRequest, checks: "pending", merge: "in_progress", checksLabel: "Checks pending", mergeLabel: "Merge running" };
    case "automerge_failed":
      return { pullRequest, checks: "pending", merge: "failed", checksLabel: "Checks pending", mergeLabel: "Merge failed", mergeFailureKind: "merge_attempt" };
    case "automerge_conflict":
    case "merge_conflict":
      return { pullRequest, checks: "pending", merge: "failed", checksLabel: "Checks pending", mergeLabel: "Merge conflict", mergeFailureKind: "merge_conflict" };
    case "merge_conflict_pending":
    case "merge_conflict_cleared":
      return { pullRequest, checks: "pending", merge: "in_progress", checksLabel: "Checks pending", mergeLabel: "Checking mergeability" };
    case "qa_blocked":
      return { pullRequest, checks: "pending", merge: "pending", checksLabel: "Checks pending", mergeLabel: "Waiting for QA" };
    case "waiting_checks":
    case "blocked": {
      if (booleanValue(payload.hasFailedChecks)) {
        return { pullRequest, checks: "failed", merge: "pending", checksLabel: "Checks failed", mergeLabel: "Blocked by checks", checksFailureKind: "ci_checks" };
      }
      if (booleanValue(payload.hasPendingChecks)) {
        return { pullRequest, checks: "in_progress", merge: "pending", checksLabel: "Checks running", mergeLabel: "Waiting for checks" };
      }
      if (booleanValue(payload.hasReviewBlockers)) {
        return { pullRequest, checks: "successful", merge: "pending", checksLabel: "Checks passed", mergeLabel: "Waiting for review" };
      }
      if (payload.hasFailedChecks === false && payload.hasPendingChecks === false) {
        return { pullRequest, checks: "successful", merge: "pending", checksLabel: "Checks passed", mergeLabel: "Ready to merge" };
      }
      return { pullRequest, checks: "pending", merge: "pending", checksLabel: "Checks pending", mergeLabel: "Waiting for checks" };
    }
    default:
      return null;
  }
}

function normalizeMergeIndicator(evidence: CiTaskMergeEvidence): StepStates | null {
  if (evidence.is_merged) return completedWorkflow();
  const indicator: SubtaskMergeIndicator | undefined = evidence.merge_indicator;
  const pullRequest: CiWorkflowState = evidence.pr_url ? "successful" : "pending";
  switch (indicator) {
    case "CI":
      return { pullRequest, checks: evidence.pr_url ? "in_progress" : "pending", merge: "pending", checksLabel: evidence.pr_url ? "Checks running" : "Waiting for pull request", mergeLabel: "Waiting for checks" };
    case "MERGED":
    case "AUTOMERGE":
      return completedWorkflow();
    case "PR_ONLY":
      return completedWorkflow("Merge not required");
    case "MERGE_CONFLICT":
      return { pullRequest, checks: "pending", merge: "failed", checksLabel: "Checks pending", mergeLabel: "Merge conflict", mergeFailureKind: "merge_conflict" };
    case "MERGE_BLOCKED":
      return { pullRequest, checks: "pending", merge: "pending", checksLabel: "Checks pending", mergeLabel: "Merge blocked" };
    case "QA_PENDING":
      return { pullRequest, checks: "pending", merge: "pending", checksLabel: "Checks pending", mergeLabel: "Waiting for QA" };
    default:
      return null;
  }
}

function activeCiAttention(items: readonly ExecutionAttentionItemSummary[]): ExecutionAttentionItemSummary[] {
  return items.filter((item) => item.attentionType.toLowerCase() === "ci_fix_required" && ACTIVE_ATTENTION_STATUSES.has(item.status.toLowerCase()));
}

function withCiAttentionFailure(states: StepStates | null, attention: ExecutionAttentionItemSummary): StepStates {
  const hasPr = attention.payload?.prNumber != null || Boolean(stringValue(attention.payload?.prUrl));
  return {
    pullRequest: states?.pullRequest ?? (hasPr ? "successful" : "pending"),
    checks: "failed",
    merge: states?.merge ?? "pending",
    pullRequestLabel: states?.pullRequestLabel,
    checksLabel: "Checks failed",
    mergeLabel: states?.mergeLabel ?? "Blocked by checks",
    checksFailureKind: "ci_checks",
    mergeFailureKind: states?.mergeFailureKind,
  };
}

function aggregateState(states: readonly CiWorkflowState[]): CiWorkflowState {
  if (states.includes("failed")) return "failed";
  if (states.includes("in_progress")) return "in_progress";
  if (states.includes("pending")) return "pending";
  return "successful";
}

function buildPresentation(scope: "task" | "sprint", entities: readonly StepStates[]): CiStatusPresentation | null {
  if (entities.length === 0) return null;
  const stepData = [
    { id: "pull_request" as const, field: "pullRequest" as const, labelField: "pullRequestLabel" as const, failureField: null },
    { id: "checks" as const, field: "checks" as const, labelField: "checksLabel" as const, failureField: "checksFailureKind" as const },
    { id: "merge" as const, field: "merge" as const, labelField: "mergeLabel" as const, failureField: "mergeFailureKind" as const },
  ];
  const steps = stepData.map(({ id, field, labelField, failureField }): CiWorkflowStep => {
    const state = aggregateState(entities.map((entity) => entity[field]));
    const matchingEntity = entities.find((entity) => entity[field] === state && entity[labelField]);
    const failureKind = failureField && state === "failed" ? matchingEntity?.[failureField] : undefined;
    return {
      id,
      label: STEP_LABELS[id],
      state,
      statusLabel: matchingEntity?.[labelField] ?? state.replace("_", " "),
      ...(failureKind ? { failureKind } : {}),
    };
  }) as CiStatusPresentation["steps"];
  const state = aggregateState(steps.map((step) => step.state));
  const failedStep = steps.find((step) => step.state === "failed");
  const activeStep = steps.find((step) => step.state === "in_progress");
  const failureKind = failedStep?.failureKind;
  const label = failureKind === "ci_checks"
    ? "CI failed"
    : failureKind === "merge_conflict"
      ? "Merge conflict"
      : failureKind === "merge_attempt"
        ? "Merge failed"
        : state === "in_progress"
          ? activeStep?.id === "merge" ? "Merge running" : "CI running"
          : state === "successful" ? "CI passed" : "CI pending";
  return {
    scope,
    state,
    label,
    accessibleLabel: `${label}. ${steps.map((step) => `${step.label}: ${step.statusLabel}`).join(". ")}.`,
    steps,
    ...(failureKind ? { failureKind } : {}),
  };
}

function taskEventMatches(event: ExecutionRuntimeEventSummary, task: CiTaskMergeEvidence, sprintRunId?: string | null): boolean {
  if (event.eventType !== "ci_gate_status") return false;
  if (task.sprint_id && event.sprintId !== task.sprint_id) return false;
  if (sprintRunId && event.sprintRunId !== sprintRunId) return false;
  const payloadTaskId = stringValue(event.payload?.taskId);
  return Boolean(
    (task.record_id && event.taskId === task.record_id)
    || event.taskKey === task.id
    || payloadTaskId === task.id
    || (task.record_id && payloadTaskId === task.record_id),
  );
}

function taskAttentionMatches(item: ExecutionAttentionItemSummary, task: CiTaskMergeEvidence, sprintRunId?: string | null): boolean {
  if (task.sprint_id && item.sprintId !== task.sprint_id) return false;
  if (sprintRunId && item.sprintRunId !== sprintRunId) return false;
  const payloadTask = stringValue(item.payload?.taskId) ?? stringValue(item.payload?.taskKey);
  return Boolean((task.record_id && item.taskId === task.record_id) || payloadTask === task.id || (task.record_id && payloadTask === task.record_id));
}

export function deriveTaskCiStatusPresentation(input: TaskCiStatusPresentationInput): CiStatusPresentation | null {
  const matchingEvents = (input.events ?? []).filter((event) => taskEventMatches(event, input.task, input.sprintRunId));
  const latestEvent = [...newestEventsByEntity(matchingEvents).values()].reduce<ExecutionRuntimeEventSummary | null>(
    (latest, event) => !latest || isNewerEvent(event, latest) ? event : latest,
    null,
  );
  let states = latestEvent ? normalizeGateEvent(latestEvent) : normalizeMergeIndicator(input.task);
  const attention = activeCiAttention(input.attentionItems ?? []).find((item) => taskAttentionMatches(item, input.task, input.sprintRunId));
  if (attention) states = withCiAttentionFailure(states, attention);
  return buildPresentation("task", states ? [states] : []);
}

export function deriveSprintCiStatusPresentation(input: SprintCiStatusPresentationInput): CiStatusPresentation | null {
  const scopedEvents = (input.events ?? []).filter((event) => (
    event.sprintId === input.sprintId
    && (!input.sprintRunId || event.sprintRunId === input.sprintRunId)
  ));
  const taskAliases = new Map<string, string>();
  for (const task of input.tasks ?? []) {
    const canonicalKey = task.record_id ?? task.id;
    taskAliases.set(task.id, canonicalKey);
    if (task.record_id) taskAliases.set(task.record_id, canonicalKey);
  }
  const newest = new Map<string, ExecutionRuntimeEventSummary>();
  for (const event of scopedEvents) {
    if (event.eventType !== "ci_gate_status" && event.eventType !== "main_merge_gate_status") continue;
    const rawKey = eventEntityKey(event);
    const key = taskAliases.get(rawKey) ?? rawKey;
    const current = newest.get(key);
    if (!current || isNewerEvent(event, current)) newest.set(key, event);
  }
  const entities = new Map<string, StepStates>();
  for (const [key, event] of newest) {
    const states = normalizeGateEvent(event);
    if (states) entities.set(key, states);
  }

  for (const task of input.tasks ?? []) {
    if (task.sprint_id && task.sprint_id !== input.sprintId) continue;
    const key = task.record_id ?? task.id;
    if (!entities.has(key)) {
      const fallback = normalizeMergeIndicator(task);
      if (fallback) entities.set(key, fallback);
    }
  }

  for (const attention of activeCiAttention(input.attentionItems ?? [])) {
    if (attention.sprintId !== input.sprintId || (input.sprintRunId && attention.sprintRunId !== input.sprintRunId)) continue;
    const isMainMerge = stringValue(attention.payload?.mergeStage)?.toLowerCase() === "main";
    const rawKey = isMainMerge
      ? "main_merge"
      : stringValue(attention.taskId) ?? stringValue(attention.payload?.taskId) ?? stringValue(attention.payload?.taskKey) ?? `attention:${attention.id}`;
    const key = taskAliases.get(rawKey) ?? rawKey;
    entities.set(key, withCiAttentionFailure(entities.get(key) ?? null, attention));
  }

  return buildPresentation("sprint", [...entities.values()]);
}

// Compact aliases keep the presentation helper ergonomic at call sites.
export const deriveTaskCiPresentation = deriveTaskCiStatusPresentation;
export const deriveSprintCiPresentation = deriveSprintCiStatusPresentation;
export const getTaskCiStatusPresentation = deriveTaskCiStatusPresentation;
export const getSprintCiStatusPresentation = deriveSprintCiStatusPresentation;
