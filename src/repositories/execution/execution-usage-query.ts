import { AppDbStorage } from "../app-db-storage.js";
import { ExecutionUsageTotals } from "../../contracts/app-types.js";
import { ProviderInvocationUsageRow } from "./execution-repository-types.js";
import { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import { createEmptyUsageTotals } from "./stats-buckets.js";

export function mergeUsageTotals(target: ExecutionUsageTotals, invocation: ProviderInvocationUsageRecord): void {
  target.invocationCount += 1;
  target.activeTimeMs += invocation.durationMs || 0;
  target.inputTokens += invocation.inputTokens;
  target.cachedInputTokens += invocation.cachedInputTokens;
  target.outputTokens += invocation.outputTokens;
  target.reasoningOutputTokens += invocation.reasoningOutputTokens;
  target.totalTokens += invocation.totalTokens;
  switch (invocation.usageSource) {
    case "reported":
      target.reportedInvocationCount += 1;
      break;
    case "estimated":
      target.estimatedInvocationCount += 1;
      break;
    case "unsupported":
      target.unsupportedInvocationCount += 1;
      break;
    default:
      target.unavailableInvocationCount += 1;
      break;
  }
}

export function withWallTime(usage: ExecutionUsageTotals | undefined, wallTimeMs: number): ExecutionUsageTotals {
  if (!usage) {
    return {
      ...createEmptyUsageTotals(),
      wallTimeMs,
    };
  }
  return {
    ...usage,
    wallTimeMs,
  };
}

export function groupUsageBy(
  rows: ProviderInvocationUsageRecord[],
  keySelector: (row: ProviderInvocationUsageRecord) => string | null,
): Map<string, ExecutionUsageTotals> {
  const map = new Map<string, ExecutionUsageTotals>();
  for (const row of rows) {
    const key = keySelector(row);
    if (!key) {
      continue;
    }
    const current = map.get(key) || createEmptyUsageTotals();
    mergeUsageTotals(current, row);
    map.set(key, current);
  }
  return map;
}

export function getUsageTotalsByTaskIds(
  storage: AppDbStorage,
  projectId: string,
  taskIds: string[],
  mapProviderInvocationUsageRow: (row: ProviderInvocationUsageRow) => ProviderInvocationUsageRecord,
): Map<string, ExecutionUsageTotals> {
  if (taskIds.length === 0) {
    return new Map();
  }
  const rows = storage.executeChunkedInQuery<ProviderInvocationUsageRow>({
    sqlPrefix: "SELECT * FROM provider_invocations WHERE project_id = ? AND task_id",
    items: taskIds,
    bindParamsBefore: [projectId],
  });
  return groupUsageBy(rows.map((row) => mapProviderInvocationUsageRow(row)), (row) => row.taskId);
}

export function getUsageTotalsBySprintRunIds(
  storage: AppDbStorage,
  projectId: string,
  sprintRunIds: string[],
  mapProviderInvocationUsageRow: (row: ProviderInvocationUsageRow) => ProviderInvocationUsageRecord,
): Map<string, ExecutionUsageTotals> {
  if (sprintRunIds.length === 0) {
    return new Map();
  }
  const rows = storage.executeChunkedInQuery<ProviderInvocationUsageRow>({
    sqlPrefix: "SELECT * FROM provider_invocations WHERE project_id = ? AND sprint_run_id",
    items: sprintRunIds,
    bindParamsBefore: [projectId],
  });
  return groupUsageBy(rows.map((row) => mapProviderInvocationUsageRow(row)), (row) => row.sprintRunId);
}
