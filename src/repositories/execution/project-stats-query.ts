import type { DatabaseAdapter } from "../db/database-adapter.js";
import type {
  ProjectStatsQuery,
  ProjectStatsWindow,
  ProjectStatsResolution,
  ProjectExecutionStatsSnapshot
} from "../../contracts/app-types.js";

export interface NormalizedProjectStatsQuery {
  query: ProjectStatsQuery;
  range: ProjectExecutionStatsSnapshot["range"];
  bucketSizeMs: number;
}

export function normalizeProjectStatsQuery(
  db: DatabaseAdapter,
  projectId: string,
  input: ProjectStatsQuery | ProjectStatsWindow,
  now: Date,
): NormalizedProjectStatsQuery {
  const query = typeof input === "string"
    ? { window: input }
    : {
      window: input.window,
      from: input.from ?? undefined,
      to: input.to ?? undefined,
    };

  if (query.window === "custom") {
    const fromDate = parseStatsDateInput(query.from, "start");
    const toDate = parseStatsDateInput(query.to, "end");
    if (!fromDate || !toDate) {
      throw new Error("Custom stats windows require valid from and to values.");
    }
    if (fromDate.getTime() > toDate.getTime()) {
      throw new Error("Custom stats window start must be earlier than end.");
    }
    return buildStatsRangeFromBounds(query, fromDate, toDate);
  }

  if (query.window === "1h") {
    const alignedEnd = new Date(now);
    alignedEnd.setMinutes(0, 0, 0);
    const bucketSizeMs = 5 * 60 * 1000;
    const bucketCount = 12;
    const start = new Date(alignedEnd.getTime() - (bucketCount - 1) * bucketSizeMs);
    return buildStatsRange({
      query,
      window: "1h",
      from: start,
      bucketSizeMs,
      bucketCount,
      resolution: "5min",
      label: "Last 1 hour",
      resolutionLabel: "5-minute telemetry buckets",
    });
  }

  if (query.window === "24h") {
    const alignedEnd = new Date(now);
    alignedEnd.setMinutes(0, 0, 0);
    const bucketSizeMs = 60 * 60 * 1000;
    const bucketCount = 24;
    const start = new Date(alignedEnd.getTime() - (bucketCount - 1) * bucketSizeMs);
    return buildStatsRange({
      query,
      window: "24h",
      from: start,
      bucketSizeMs,
      bucketCount,
      resolution: "hour",
      label: "Last 24 hours",
      resolutionLabel: "Hourly telemetry buckets",
    });
  }

  if (query.window === "7d" || query.window === "30d") {
    const alignedEnd = startOfUtcDay(now);
    const bucketSizeMs = 24 * 60 * 60 * 1000;
    const bucketCount = query.window === "7d" ? 7 : 30;
    const start = new Date(alignedEnd.getTime() - (bucketCount - 1) * bucketSizeMs);
    return buildStatsRange({
      query,
      window: query.window,
      from: start,
      bucketSizeMs,
      bucketCount,
      resolution: "day",
      label: query.window === "7d" ? "Last 7 days" : "Last 30 days",
      resolutionLabel: "Daily telemetry buckets",
    });
  }

  const firstInvocationRow = db.prepare(`
    SELECT MIN(started_at) AS first_started_at
    FROM provider_invocations
    WHERE project_id = ?
  `).get(projectId) as { first_started_at: string | null } | undefined;
  const firstInvocation = parseStatsDateInput(firstInvocationRow?.first_started_at || undefined, "start") || now;
  const allTimeStart = startOfUtcDay(firstInvocation);
  const allTimeEnd = startOfUtcDay(now);
  return buildStatsRangeFromBounds(query, allTimeStart, new Date(allTimeEnd.getTime() + (24 * 60 * 60 * 1000) - 1));
}

function buildStatsRangeFromBounds(
  query: ProjectStatsQuery,
  fromDate: Date,
  toDate: Date,
): NormalizedProjectStatsQuery {
  const spanMs = Math.max(1, toDate.getTime() - fromDate.getTime());
  const spanHours = Math.ceil(spanMs / (60 * 60 * 1000));
  const spanDays = Math.ceil(spanMs / (24 * 60 * 60 * 1000));

  if (spanHours <= 48) {
    const bucketSizeMs = 60 * 60 * 1000;
    const start = startOfHour(fromDate);
    const end = startOfHour(new Date(toDate.getTime() + bucketSizeMs));
    const bucketCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / bucketSizeMs));
    return buildStatsRange({
      query,
      window: query.window,
      from: start,
      bucketSizeMs,
      bucketCount,
      resolution: "hour",
      label: query.window === "custom" ? "Custom range" : "All time",
      resolutionLabel: "Hourly telemetry buckets",
    });
  }

  if (spanDays <= 90) {
    const bucketSizeMs = 24 * 60 * 60 * 1000;
    const start = startOfUtcDay(fromDate);
    const end = startOfUtcDay(new Date(toDate.getTime() + bucketSizeMs));
    const bucketCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / bucketSizeMs));
    return buildStatsRange({
      query,
      window: query.window,
      from: start,
      bucketSizeMs,
      bucketCount,
      resolution: "day",
      label: query.window === "custom" ? "Custom range" : "All time",
      resolutionLabel: "Daily telemetry buckets",
    });
  }

  const bucketSizeMs = 7 * 24 * 60 * 60 * 1000;
  const start = startOfUtcWeek(fromDate);
  const end = startOfUtcWeek(new Date(toDate.getTime() + (24 * 60 * 60 * 1000)));
  const bucketCount = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / bucketSizeMs));
  return buildStatsRange({
    query,
    window: query.window,
    from: start,
    bucketSizeMs,
    bucketCount,
    resolution: "week",
    label: query.window === "custom" ? "Custom range" : "All time",
    resolutionLabel: "Weekly telemetry buckets",
  });
}

function buildStatsRange(input: {
  query: ProjectStatsQuery;
  window: ProjectStatsWindow;
  from: Date;
  bucketSizeMs: number;
  bucketCount: number;
  resolution: ProjectStatsResolution;
  label: string;
  resolutionLabel: string;
}): NormalizedProjectStatsQuery {
  const rangeStart = new Date(input.from);
  const rangeEnd = new Date(rangeStart.getTime() + input.bucketSizeMs * input.bucketCount);
  return {
    query: {
      window: input.query.window,
      from: input.query.from ?? undefined,
      to: input.query.to ?? undefined,
    },
    range: {
      window: input.window,
      label: input.label,
      resolution: input.resolution,
      resolutionLabel: input.resolutionLabel,
      from: rangeStart.toISOString(),
      to: rangeEnd.toISOString(),
      bucketCount: input.bucketCount,
      isCustom: input.query.window === "custom",
    },
    bucketSizeMs: input.bucketSizeMs,
  };
}

function parseStatsDateInput(value: string | undefined, edge: "start" | "end"): Date | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function startOfUtcDay(date: Date): Date {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function startOfHour(date: Date): Date {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  return next;
}

function startOfUtcWeek(date: Date): Date {
  const next = startOfUtcDay(date);
  const day = next.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  next.setUTCDate(next.getUTCDate() - offset);
  return next;
}
