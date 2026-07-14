import type { CardCiStatus } from "../../contracts/app-types.js";

export interface CardCiGateEvent {
  createdAt: string;
  payload: unknown;
}

export interface TaskCardCiStatusInput {
  status?: string | null;
  isMerged?: boolean;
  mergeIndicator?: string | null;
  latestGateEvent?: CardCiGateEvent;
  hasActiveFailure?: boolean;
}

export interface SprintCardCiStatusInput {
  taskStatuses: ReadonlyArray<CardCiStatus | null | undefined>;
  latestMainMergeGateEvent?: CardCiGateEvent;
  hasActiveMainMergeFailure?: boolean;
}

const SETTLED_TASK_MERGE_INDICATORS = new Set(["MERGED", "AUTOMERGE", "PR_ONLY"]);

function asPayload(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function payloadState(payload: Record<string, unknown>): string | null {
  return typeof payload.state === "string" && payload.state.trim().length > 0
    ? payload.state
    : null;
}

function highestPriorityStatus(statuses: ReadonlyArray<CardCiStatus | null | undefined>): CardCiStatus | null {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("pending")) return "pending";
  return null;
}

export function resolveTaskCardCiStatus(input: TaskCardCiStatusInput): CardCiStatus | null {
  if (
    input.isMerged
    || input.status === "completed"
    || input.status === "COMPLETED"
    || (input.mergeIndicator && SETTLED_TASK_MERGE_INDICATORS.has(input.mergeIndicator))
  ) {
    return null;
  }

  if (input.hasActiveFailure) {
    return "failed";
  }

  // The durable indicator is the task-level proof that the CI gate is still
  // active. Once orchestration clears it, historical waiting events must not
  // resurrect a badge.
  if (input.mergeIndicator !== "CI") {
    return null;
  }

  const payload = asPayload(input.latestGateEvent?.payload);
  if (payload) {
    const state = payloadState(payload);
    if (payload.hasFailedChecks === true || state === "failed_checks" || state === "blocked") {
      return "failed";
    }
    if (payload.hasPendingChecks === true || state === "waiting_checks") {
      return "running";
    }
    if (state === "waiting_for_pr" || state === "merge_conflict_pending") {
      return "pending";
    }
    // Any other well-formed gate state is newer settled/non-CI detail. It must
    // clear an older durable CI indicator rather than leaving a stale badge.
    if (state) {
      return null;
    }
  }

  return "pending";
}

export function resolveMainMergeCardCiStatus(
  latestGateEvent: CardCiGateEvent | undefined,
  hasActiveFailure = false,
): CardCiStatus | null {
  if (hasActiveFailure) {
    return "failed";
  }

  const payload = asPayload(latestGateEvent?.payload);
  if (!payload) {
    return null;
  }
  const state = payloadState(payload);
  if (payload.hasFailedChecks === true || state === "failed_checks") {
    return "failed";
  }
  if (payload.hasPendingChecks === true || state === "pending_checks") {
    return "running";
  }
  if (state === "missing_pr") {
    return "pending";
  }
  return null;
}

export function resolveSprintCardCiStatus(input: SprintCardCiStatusInput): CardCiStatus | null {
  return highestPriorityStatus([
    ...input.taskStatuses,
    resolveMainMergeCardCiStatus(input.latestMainMergeGateEvent, input.hasActiveMainMergeFailure),
  ]);
}
