import { createHash } from "node:crypto";
import type { GitCiRunStatus, Subtask } from "../../../../contracts/app-types.js";
import type { TaskRunEventRecord } from "../../../../contracts/execution-types.js";
import type { ExecutionRepository } from "../../../../repositories/execution-repository.js";

const JULES_CI_FIX_EVENT_TYPES = [
  "jules_ci_fix_dispatch_started",
  "jules_ci_fix_message_sent",
  "jules_ci_fix_dispatch_failed",
] as const;
const JULES_CI_FIX_EVENT_SCAN_LIMIT = 100;

export type JulesCiFixExecutionRepository = Pick<
  ExecutionRepository,
  "appendTaskRunEvent" | "listTaskRunEvents"
>;

export interface JulesCiFixAttemptIdentity {
  baseAttemptKey: string;
  failureFingerprint: string;
  baselineHeadSha: string | null;
}

function normalizeSha(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function buildJulesCiFixAttemptIdentity(args: {
  prNumber: number;
  prHeadSha?: string | null;
  failedChecks: string[];
  failedRuns: GitCiRunStatus[];
}): JulesCiFixAttemptIdentity {
  const baselineHeadSha = normalizeSha(args.prHeadSha)
    ?? normalizeSha(args.failedRuns.find((run) => normalizeSha(run.headSha))?.headSha);
  const failureFingerprint = createHash("sha256")
    .update(JSON.stringify({
      prNumber: args.prNumber,
      headSha: baselineHeadSha,
      failedChecks: [...args.failedChecks].sort(),
      failedRuns: args.failedRuns.map((run) => ({
        id: run.id,
        headSha: normalizeSha(run.headSha),
        conclusion: run.conclusion,
      })),
    }))
    .digest("hex")
    .slice(0, 24);
  return {
    baselineHeadSha,
    failureFingerprint,
    baseAttemptKey: `jules-ci-fix:${args.prNumber}:${failureFingerprint}`,
  };
}

function listJulesCiFixEvents(
  executionRepository: JulesCiFixExecutionRepository,
  taskRunId: string,
): TaskRunEventRecord[] {
  return executionRepository.listTaskRunEvents(taskRunId, JULES_CI_FIX_EVENT_SCAN_LIMIT, {
    eventTypes: [...JULES_CI_FIX_EVENT_TYPES],
    skipValidation: true,
  });
}

function eventString(event: TaskRunEventRecord, key: string): string | null {
  const value = event.payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function hasActiveJulesCiFixAttempt(args: {
  executionRepository?: JulesCiFixExecutionRepository;
  taskRunId?: string | null;
  prNumber: number;
  prHeadSha?: string | null;
  failedChecks: string[];
  failedRuns: GitCiRunStatus[];
  sessionState?: string | null;
}): boolean {
  if (
    !args.executionRepository
    || !args.taskRunId
    || typeof args.executionRepository.listTaskRunEvents !== "function"
    || typeof args.executionRepository.appendTaskRunEvent !== "function"
  ) {
    return false;
  }
  const identity = buildJulesCiFixAttemptIdentity(args);
  const events = listJulesCiFixEvents(args.executionRepository, args.taskRunId);
  const failedAttemptIds = new Set(
    events
      .filter((event) => event.eventType === "jules_ci_fix_dispatch_failed")
      .map((event) => eventString(event, "attemptId"))
      .filter((value): value is string => Boolean(value)),
  );
  const normalizedSessionState = args.sessionState?.trim().toUpperCase() ?? "";
  const sessionFinished = normalizedSessionState === "COMPLETED"
    || normalizedSessionState === "FAILED"
    || normalizedSessionState === "CANCELLED";

  return events.some((event) => {
    if (
      event.eventType !== "jules_ci_fix_dispatch_started"
      && event.eventType !== "jules_ci_fix_message_sent"
    ) {
      return false;
    }
    const attemptId = eventString(event, "attemptId");
    if (!attemptId || failedAttemptIds.has(attemptId)) {
      return false;
    }
    if (Number(event.payload?.prNumber) !== args.prNumber) {
      return false;
    }
    const recordedHeadSha = eventString(event, "baselineHeadSha");
    if (recordedHeadSha || identity.baselineHeadSha) {
      // A push alone does not finish a repair: Jules can push an intermediate
      // commit and continue editing. Release the lease only after both the PR
      // head changed and the resumed remote session reached a terminal state.
      return recordedHeadSha === identity.baselineHeadSha || !sessionFinished;
    }
    // Some hosts cannot expose a PR head SHA. In that conservative fallback,
    // the exact failed observation remains leased instead of being re-sent.
    return eventString(event, "failureFingerprint") === identity.failureFingerprint;
  });
}

export function claimJulesCiFixAttempt(args: {
  executionRepository: JulesCiFixExecutionRepository;
  taskRunId: string;
  task: Subtask;
  prNumber: number;
  prHeadSha?: string | null;
  failedChecks: string[];
  failedRuns: GitCiRunStatus[];
  attempt: number;
}): { claimed: boolean; attemptId: string; identity: JulesCiFixAttemptIdentity } {
  const identity = buildJulesCiFixAttemptIdentity(args);
  const events = listJulesCiFixEvents(args.executionRepository, args.taskRunId);
  const dispatchFailures = events.filter((event) => (
    event.eventType === "jules_ci_fix_dispatch_failed"
    && eventString(event, "baseAttemptKey") === identity.baseAttemptKey
  )).length;
  const attemptId = `${identity.baseAttemptKey}:dispatch-${dispatchFailures + 1}`;
  const claimed = args.executionRepository.appendTaskRunEvent(
    args.taskRunId,
    "jules_ci_fix_dispatch_started",
    "system",
    {
      attemptId,
      baseAttemptKey: identity.baseAttemptKey,
      failureFingerprint: identity.failureFingerprint,
      baselineHeadSha: identity.baselineHeadSha,
      prNumber: args.prNumber,
      taskId: args.task.id,
      failedRunIds: args.failedRuns.map((run) => run.id).filter((id) => id !== null),
      guardrailAttempt: args.attempt,
    },
    { sourceEventKey: `${attemptId}:started` },
  );
  return { claimed, attemptId, identity };
}

export function appendJulesCiFixDispatchEvent(args: {
  executionRepository?: JulesCiFixExecutionRepository;
  taskRunId?: string | null;
  eventType: "jules_ci_fix_message_sent" | "jules_ci_fix_dispatch_failed";
  attemptId: string;
  identity: JulesCiFixAttemptIdentity;
  prNumber: number;
  error?: unknown;
}): void {
  if (!args.executionRepository || !args.taskRunId) {
    return;
  }
  args.executionRepository.appendTaskRunEvent(
    args.taskRunId,
    args.eventType,
    args.eventType === "jules_ci_fix_message_sent" ? "provider" : "system",
    {
      attemptId: args.attemptId,
      baseAttemptKey: args.identity.baseAttemptKey,
      failureFingerprint: args.identity.failureFingerprint,
      baselineHeadSha: args.identity.baselineHeadSha,
      prNumber: args.prNumber,
      error: args.error instanceof Error ? args.error.message : args.error ? String(args.error) : null,
    },
    { sourceEventKey: `${args.attemptId}:${args.eventType}` },
  );
}
