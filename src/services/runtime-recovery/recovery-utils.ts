import type { ProviderInvocationUsageRecord, TaskRunRecord } from "../../contracts/execution-types.js";

const TERMINAL_TASK_RUN_STATES = new Set(["COMPLETED", "FAILED", "BLOCKED", "QUOTA"]);

export function isTerminalTaskRunState(taskRun: TaskRunRecord): boolean {
  return TERMINAL_TASK_RUN_STATES.has(taskRun.state);
}

export function calculateInvocationDurationMs(invocation: ProviderInvocationUsageRecord, finishedAt: string): number | null {
  const startedAtMs = Date.parse(invocation.startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return invocation.durationMs;
  }
  return Math.max(0, finishedAtMs - startedAtMs);
}
