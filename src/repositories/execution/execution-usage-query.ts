import { AppDbStorage } from "../app-db-storage.js";
import { ExecutionUsageTotals } from "../../contracts/app-types.js";
import { ProviderInvocationUsageRow } from "./execution-repository-types.js";
import { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import { createEmptyUsageTotals } from "./stats-buckets.js";

export interface UsageRowRaw {
  task_id?: string | null;
  sprint_run_id?: string | null;
  invocation_count?: number | null;
  duration_ms?: number | null;
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
  reasoning_output_tokens?: number | null;
  total_tokens?: number | null;
  reported_invocation_count?: number | null;
  estimated_invocation_count?: number | null;
  unsupported_invocation_count?: number | null;
  unavailable_invocation_count?: number | null;
}

export const USAGE_AGGREGATION_SQL = `SELECT
      %ID_COLUMN%,
      COUNT(*) as invocation_count,
      SUM(duration_ms) as duration_ms,
      SUM(input_tokens) as input_tokens,
      SUM(cached_input_tokens) as cached_input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(reasoning_output_tokens) as reasoning_output_tokens,
      SUM(total_tokens) as total_tokens,
      SUM(CASE WHEN usage_source = 'reported' THEN 1 ELSE 0 END) as reported_invocation_count,
      SUM(CASE WHEN usage_source = 'estimated' THEN 1 ELSE 0 END) as estimated_invocation_count,
      SUM(CASE WHEN usage_source = 'unsupported' THEN 1 ELSE 0 END) as unsupported_invocation_count,
      SUM(CASE WHEN usage_source NOT IN ('reported', 'estimated', 'unsupported') THEN 1 ELSE 0 END) as unavailable_invocation_count
    FROM provider_invocations WHERE project_id = ? AND %ID_COLUMN%`;

export function mapUsageRowToTotals(row: UsageRowRaw | null | undefined): ExecutionUsageTotals {
  if (!row) {
    return createEmptyUsageTotals();
  }

  return {
    invocationCount: Number(row.invocation_count) || 0,
    activeTimeMs: Number(row.duration_ms) || 0,
    wallTimeMs: 0,
    inputTokens: Number(row.input_tokens) || 0,
    cachedInputTokens: Number(row.cached_input_tokens) || 0,
    outputTokens: Number(row.output_tokens) || 0,
    reasoningOutputTokens: Number(row.reasoning_output_tokens) || 0,
    totalTokens: Number(row.total_tokens) || 0,
    reportedInvocationCount: Number(row.reported_invocation_count) || 0,
    estimatedInvocationCount: Number(row.estimated_invocation_count) || 0,
    unsupportedInvocationCount: Number(row.unsupported_invocation_count) || 0,
    unavailableInvocationCount: Number(row.unavailable_invocation_count) || 0,
  };
}

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
  const rows = storage.executeChunkedInQuery<UsageRowRaw>({
    sqlPrefix: USAGE_AGGREGATION_SQL.replace(/%ID_COLUMN%/g, 'task_id'),
    sqlSuffix: "GROUP BY task_id",
    items: taskIds,
    bindParamsBefore: [projectId],
  });

  const map = new Map<string, ExecutionUsageTotals>();
  for (const row of rows) {
    const key = row.task_id || row.sprint_run_id;
    if (key) {
      map.set(key, mapUsageRowToTotals(row));
    }
  }
  return map;
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
  const rows = storage.executeChunkedInQuery<UsageRowRaw>({
    sqlPrefix: USAGE_AGGREGATION_SQL.replace(/%ID_COLUMN%/g, 'sprint_run_id'),
    sqlSuffix: "GROUP BY sprint_run_id",
    items: sprintRunIds,
    bindParamsBefore: [projectId],
  });

  const map = new Map<string, ExecutionUsageTotals>();
  for (const row of rows) {
    const key = row.task_id || row.sprint_run_id;
    if (key) {
      map.set(key, mapUsageRowToTotals(row));
    }
  }
  return map;
}
