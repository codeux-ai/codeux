import type {
  HeaderTokenThroughputProjectSnapshot,
  HeaderTokenThroughputQuery,
  HeaderTokenThroughputSnapshot,
  HeaderTokenThroughputTotals,
  HeaderTokenThroughputWindow,
  ProjectStatsRangeSummary,
  ProjectStatsResolution,
} from "../../contracts/app-types.js";
import type { DatabaseAdapter } from "../db/database-adapter.js";
import { toNumber, ValidationError } from "../repository-utils.js";
import { startOfHour, startOfUtcDay } from "./project-stats-query.js";

interface ThroughputAggregateRow {
  invocationCount: number | string | null;
  activeTimeMs: number | string | null;
  inputTokens: number | string | null;
  cachedInputTokens: number | string | null;
  outputTokens: number | string | null;
  reasoningTokens: number | string | null;
  totalTokens: number | string | null;
}

interface ProjectIdentityRow {
  id: string;
  name: string;
}

export function queryHeaderTokenThroughputSnapshot(
  db: DatabaseAdapter,
  input: HeaderTokenThroughputQuery = { window: "24h" },
): HeaderTokenThroughputSnapshot {
  const window = normalizeHeaderTokenThroughputWindow(input.window);
  const projectId = normalizeProjectId(input.projectId);
  const projectRow = projectId ? getRequiredProject(db, projectId) : null;
  const now = new Date();
  const range = normalizeHeaderTokenThroughputRange(db, window, now);

  const app = queryThroughputTotals(db, range.from, range.to);
  const project = projectRow
    ? {
      projectId: projectRow.id,
      projectName: projectRow.name,
      ...queryThroughputTotals(db, range.from, range.to, projectRow.id),
    } satisfies HeaderTokenThroughputProjectSnapshot
    : null;

  return {
    generatedAt: now.toISOString(),
    window,
    range,
    app,
    project,
  };
}

export function normalizeHeaderTokenThroughputWindow(window: unknown): HeaderTokenThroughputWindow {
  if (
    window === "1h"
    || window === "24h"
    || window === "7d"
    || window === "30d"
    || window === "all"
  ) {
    return window;
  }
  throw new ValidationError("Invalid header throughput window. Expected one of: 1h, 24h, 7d, 30d, all.");
}

function normalizeProjectId(projectId: string | null | undefined): string | null {
  if (projectId === null || projectId === undefined) {
    return null;
  }
  const trimmed = projectId.trim();
  if (!trimmed) {
    throw new ValidationError("Missing required projectId when projectId is provided.");
  }
  return trimmed;
}

function getRequiredProject(db: DatabaseAdapter, projectId: string): ProjectIdentityRow {
  const row = db.prepare(`
    SELECT id, name
    FROM projects
    WHERE id = ?
  `).get(projectId) as ProjectIdentityRow | undefined;
  if (!row) {
    throw new ValidationError(`Invalid projectId: ${projectId}`);
  }
  return row;
}

function normalizeHeaderTokenThroughputRange(
  db: DatabaseAdapter,
  window: HeaderTokenThroughputWindow,
  now: Date,
): ProjectStatsRangeSummary {
  if (window === "1h") {
    return buildPresetRange({
      window,
      from: new Date(startOfUtcBucket(now, 5 * 60 * 1000).getTime() - 11 * 5 * 60 * 1000),
      bucketSizeMs: 5 * 60 * 1000,
      bucketCount: 12,
      resolution: "5min",
      label: "Last 1 hour",
      resolutionLabel: "5-minute telemetry buckets",
    });
  }

  if (window === "24h") {
    return buildPresetRange({
      window,
      from: new Date(startOfHour(now).getTime() - 23 * 60 * 60 * 1000),
      bucketSizeMs: 60 * 60 * 1000,
      bucketCount: 24,
      resolution: "hour",
      label: "Last 24 hours",
      resolutionLabel: "Hourly telemetry buckets",
    });
  }

  if (window === "7d" || window === "30d") {
    const bucketCount = window === "7d" ? 7 : 30;
    return buildPresetRange({
      window,
      from: new Date(startOfUtcDay(now).getTime() - (bucketCount - 1) * 24 * 60 * 60 * 1000),
      bucketSizeMs: 24 * 60 * 60 * 1000,
      bucketCount,
      resolution: "day",
      label: window === "7d" ? "Last 7 days" : "Last 30 days",
      resolutionLabel: "Daily telemetry buckets",
    });
  }

  const firstInvocationRow = db.prepare(`
    SELECT MIN(started_at) AS first_started_at
    FROM provider_invocations
  `).get() as { first_started_at: string | null } | undefined;
  const firstInvocation = parseDate(firstInvocationRow?.first_started_at) || now;
  return buildRangeFromBounds(window, startOfUtcDay(firstInvocation), endOfUtcDay(now));
}

function buildRangeFromBounds(
  window: HeaderTokenThroughputWindow,
  fromDate: Date,
  toDate: Date,
): ProjectStatsRangeSummary {
  const spanMs = Math.max(1, toDate.getTime() - fromDate.getTime());
  const spanHours = Math.ceil(spanMs / (60 * 60 * 1000));
  const spanDays = Math.ceil(spanMs / (24 * 60 * 60 * 1000));

  if (spanHours <= 48) {
    const bucketSizeMs = 60 * 60 * 1000;
    const start = startOfHour(fromDate);
    const end = new Date(startOfHour(toDate).getTime() + bucketSizeMs);
    return buildRange({
      window,
      from: start,
      to: end,
      bucketSizeMs,
      resolution: "hour",
      label: "All time",
      resolutionLabel: "Hourly telemetry buckets",
    });
  }

  if (spanDays <= 90) {
    const bucketSizeMs = 24 * 60 * 60 * 1000;
    const start = startOfUtcDay(fromDate);
    const end = new Date(startOfUtcDay(toDate).getTime() + bucketSizeMs);
    return buildRange({
      window,
      from: start,
      to: end,
      bucketSizeMs,
      resolution: "day",
      label: "All time",
      resolutionLabel: "Daily telemetry buckets",
    });
  }

  const bucketSizeMs = 7 * 24 * 60 * 60 * 1000;
  const start = startOfUtcWeek(fromDate);
  const end = new Date(startOfUtcWeek(toDate).getTime() + bucketSizeMs);
  return buildRange({
    window,
    from: start,
    to: end,
    bucketSizeMs,
    resolution: "week",
    label: "All time",
    resolutionLabel: "Weekly telemetry buckets",
  });
}

function buildPresetRange(input: {
  window: HeaderTokenThroughputWindow;
  from: Date;
  bucketSizeMs: number;
  bucketCount: number;
  resolution: ProjectStatsResolution;
  label: string;
  resolutionLabel: string;
}): ProjectStatsRangeSummary {
  const rangeStart = new Date(input.from);
  return {
    window: input.window,
    label: input.label,
    resolution: input.resolution,
    resolutionLabel: input.resolutionLabel,
    from: rangeStart.toISOString(),
    to: new Date(rangeStart.getTime() + input.bucketSizeMs * input.bucketCount).toISOString(),
    bucketCount: input.bucketCount,
    isCustom: false,
  };
}

function buildRange(input: {
  window: HeaderTokenThroughputWindow;
  from: Date;
  to: Date;
  bucketSizeMs: number;
  resolution: ProjectStatsResolution;
  label: string;
  resolutionLabel: string;
}): ProjectStatsRangeSummary {
  return {
    window: input.window,
    label: input.label,
    resolution: input.resolution,
    resolutionLabel: input.resolutionLabel,
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    bucketCount: Math.max(1, Math.ceil((input.to.getTime() - input.from.getTime()) / input.bucketSizeMs)),
    isCustom: false,
  };
}

function queryThroughputTotals(
  db: DatabaseAdapter,
  rangeStartIso: string,
  rangeEndIso: string,
  projectId?: string,
): HeaderTokenThroughputTotals {
  const projectPredicate = projectId ? "AND project_id = ?" : "";
  const params = projectId ? [rangeStartIso, rangeEndIso, projectId] : [rangeStartIso, rangeEndIso];
  const row = db.prepare(`
    SELECT
      COUNT(*) as invocationCount,
      COALESCE(SUM(COALESCE(duration_ms, 0)), 0) as activeTimeMs,
      COALESCE(SUM(input_tokens), 0) as inputTokens,
      COALESCE(SUM(cached_input_tokens), 0) as cachedInputTokens,
      COALESCE(SUM(output_tokens), 0) as outputTokens,
      COALESCE(SUM(reasoning_output_tokens), 0) as reasoningTokens,
      COALESCE(SUM(total_tokens), 0) as totalTokens
    FROM provider_invocations
    WHERE started_at >= ? AND started_at < ?
      ${projectPredicate}
  `).get(...params) as ThroughputAggregateRow | undefined;

  const activeTimeMs = toNumber(row?.activeTimeMs);
  const totalTokens = toNumber(row?.totalTokens);
  return {
    totalTokens,
    inputTokens: toNumber(row?.inputTokens),
    cachedInputTokens: toNumber(row?.cachedInputTokens),
    outputTokens: toNumber(row?.outputTokens),
    reasoningTokens: toNumber(row?.reasoningTokens),
    invocationCount: toNumber(row?.invocationCount),
    activeTimeMs,
    tokensPerMinute: calculateTokensPerMinute(totalTokens, activeTimeMs),
  };
}

function calculateTokensPerMinute(totalTokens: number, activeTimeMs: number): number {
  if (totalTokens <= 0 || activeTimeMs <= 0) {
    return 0;
  }
  return Math.round((totalTokens / (activeTimeMs / 60_000)) * 100) / 100;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfUtcBucket(date: Date, bucketSizeMs: number): Date {
  return new Date(Math.floor(date.getTime() / bucketSizeMs) * bucketSizeMs);
}

function endOfUtcDay(date: Date): Date {
  const next = startOfUtcDay(date);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCMilliseconds(next.getUTCMilliseconds() - 1);
  return next;
}

function startOfUtcWeek(date: Date): Date {
  const next = startOfUtcDay(date);
  const day = next.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  next.setUTCDate(next.getUTCDate() - offset);
  return next;
}
