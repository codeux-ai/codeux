import { AppDbStorage } from "../app-db-storage.js";
import { ExecutionUsageTotals } from "../../contracts/app-types.js";
import { createEmptyUsageTotals } from "./stats-buckets.js";

/**
 * Common row type for usage aggregation queries.
 * Uses camelCase to match SQL aliases.
 */
export interface UsageRowRaw {
  task_id?: string | null;
  sprint_run_id?: string | null;
  invocationCount?: number | null;
  activeTimeMs?: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  reasoningOutputTokens?: number | null;
  totalTokens?: number | null;
  reportedInvocationCount?: number | null;
  estimatedInvocationCount?: number | null;
  unsupportedInvocationCount?: number | null;
  unavailableInvocationCount?: number | null;
  durationSamples?: string | null; // Comma separated samples from GROUP_CONCAT
}

/**
 * Shared SQL fragment for usage aggregation.
 * Aliases are camelCase to match the UsageRowRaw interface.
 */
export const USAGE_AGGREGATION_FIELDS_SQL = `
  COUNT(*) as invocationCount,
  SUM(COALESCE(duration_ms, 0)) as activeTimeMs,
  SUM(COALESCE(input_tokens, 0)) as inputTokens,
  SUM(COALESCE(cached_input_tokens, 0)) as cachedInputTokens,
  SUM(COALESCE(output_tokens, 0)) as outputTokens,
  SUM(COALESCE(reasoning_output_tokens, 0)) as reasoningOutputTokens,
  SUM(COALESCE(total_tokens, 0)) as totalTokens,
  SUM(CASE WHEN usage_source = 'reported' THEN 1 ELSE 0 END) as reportedInvocationCount,
  SUM(CASE WHEN usage_source = 'estimated' THEN 1 ELSE 0 END) as estimatedInvocationCount,
  SUM(CASE WHEN usage_source = 'unsupported' THEN 1 ELSE 0 END) as unsupportedInvocationCount,
  SUM(CASE WHEN usage_source NOT IN ('reported', 'estimated', 'unsupported') THEN 1 ELSE 0 END) as unavailableInvocationCount,
  GROUP_CONCAT(COALESCE(duration_ms, 0)) as durationSamples
`;

/**
 * Internal extended type to carry duration samples for stats calculation.
 */
export interface ExecutionUsageTotalsWithSamples extends ExecutionUsageTotals {
  durationSamples: number[];
}

/**
 * Maps a raw database row to an ExecutionUsageTotals object.
 */
export function mapUsageRowToTotals(row: any): ExecutionUsageTotals {
  if (!row) {
    const empty = createEmptyUsageTotals() as ExecutionUsageTotalsWithSamples;
    empty.durationSamples = [];
    return empty;
  }

  const toNumber = (value: any): number => {
    if (value === null || value === undefined) return 0;
    const n = Number(value);
    return isNaN(n) ? 0 : n;
  };

  const totals: ExecutionUsageTotalsWithSamples = {
    invocationCount: toNumber(row.invocationCount ?? row.invocation_count),
    activeTimeMs: toNumber(row.activeTimeMs ?? row.duration_ms),
    wallTimeMs: 0,
    inputTokens: toNumber(row.inputTokens ?? row.input_tokens),
    cachedInputTokens: toNumber(row.cachedInputTokens ?? row.cached_input_tokens),
    outputTokens: toNumber(row.outputTokens ?? row.output_tokens),
    reasoningOutputTokens: toNumber(row.reasoningOutputTokens ?? row.reasoning_output_tokens),
    totalTokens: toNumber(row.totalTokens ?? row.total_tokens),
    reportedInvocationCount: toNumber(row.reportedInvocationCount ?? row.reported_invocation_count),
    estimatedInvocationCount: toNumber(row.estimatedInvocationCount ?? row.estimated_invocation_count),
    unsupportedInvocationCount: toNumber(row.unsupportedInvocationCount ?? row.unsupported_invocation_count),
    unavailableInvocationCount: toNumber(row.unavailableInvocationCount ?? row.unavailable_invocation_count),
    durationSamples: row.durationSamples ? String(row.durationSamples).split(",").map(v => Number(v)).filter(v => !isNaN(v)) : []
  };

  return totals;
}

/**
 * Merges source usage totals into target.
 * Robust against missing fields in source.
 */
export function mergeUsageTotals(target: ExecutionUsageTotals, source: Partial<ExecutionUsageTotals>): void {
  const add = (a: number, b: any) => a + (Number(b) || 0);

  target.invocationCount = add(target.invocationCount, source.invocationCount);
  target.activeTimeMs = add(target.activeTimeMs, source.activeTimeMs);
  target.inputTokens = add(target.inputTokens, source.inputTokens);
  target.cachedInputTokens = add(target.cachedInputTokens, source.cachedInputTokens);
  target.outputTokens = add(target.outputTokens, source.outputTokens);
  target.reasoningOutputTokens = add(target.reasoningOutputTokens, source.reasoningOutputTokens);
  target.totalTokens = add(target.totalTokens, source.totalTokens);
  target.reportedInvocationCount = add(target.reportedInvocationCount, source.reportedInvocationCount);
  target.estimatedInvocationCount = add(target.estimatedInvocationCount, source.estimatedInvocationCount);
  target.unsupportedInvocationCount = add(target.unsupportedInvocationCount, source.unsupportedInvocationCount);
  target.unavailableInvocationCount = add(target.unavailableInvocationCount, source.unavailableInvocationCount);

  const tExtended = target as Partial<ExecutionUsageTotalsWithSamples>;
  const sExtended = source as Partial<ExecutionUsageTotalsWithSamples>;
  if (sExtended.durationSamples && sExtended.durationSamples.length > 0) {
    if (!tExtended.durationSamples) {
      tExtended.durationSamples = [...sExtended.durationSamples];
    } else {
      tExtended.durationSamples.push(...sExtended.durationSamples);
    }
  }
}

/**
 * Aggregates usage totals for a list of task IDs.
 */
export function getUsageTotalsByTaskIds(
  storage: AppDbStorage,
  projectId: string,
  taskIds: string[]
): Map<string, ExecutionUsageTotals> {
  if (taskIds.length === 0) {
    return new Map();
  }

  const rows = storage.executeChunkedInQuery<any>({
    sqlPrefix: `
      SELECT
        task_id,
        ${USAGE_AGGREGATION_FIELDS_SQL}
      FROM provider_invocations
      WHERE project_id = ? AND task_id`,
    items: taskIds,
    bindParamsBefore: [projectId],
    sqlSuffix: "GROUP BY task_id"
  });

  const map = new Map<string, ExecutionUsageTotals>();
  for (const row of rows) {
    if (row.task_id) {
      map.set(row.task_id, mapUsageRowToTotals(row));
    }
  }
  return map;
}

/**
 * Aggregates usage totals for a list of sprint run IDs.
 */
export function getUsageTotalsBySprintRunIds(
  storage: AppDbStorage,
  projectId: string,
  sprintRunIds: string[]
): Map<string, ExecutionUsageTotals> {
  if (sprintRunIds.length === 0) {
    return new Map();
  }

  const rows = storage.executeChunkedInQuery<any>({
    sqlPrefix: `
      SELECT
        sprint_run_id,
        ${USAGE_AGGREGATION_FIELDS_SQL}
      FROM provider_invocations
      WHERE project_id = ? AND sprint_run_id`,
    items: sprintRunIds,
    bindParamsBefore: [projectId],
    sqlSuffix: "GROUP BY sprint_run_id"
  });

  const map = new Map<string, ExecutionUsageTotals>();
  for (const row of rows) {
    if (row.sprint_run_id) {
      map.set(row.sprint_run_id, mapUsageRowToTotals(row));
    }
  }
  return map;
}
