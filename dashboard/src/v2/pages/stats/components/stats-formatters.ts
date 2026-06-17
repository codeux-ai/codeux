import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageBucketSummary,
  ProjectExecutionStatsSnapshot,
} from "../../../types.js";
import type { LedgerSortKey } from "./stats-ui-primitives.js";

export const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatDay(_value: string): string {
  const date = new Date(_value);
  if (Number.isNaN(date.getTime())) {
    return _value;
  }
  return DAY_FORMATTER.format(date);
}

export function formatHourTick(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getHours()}:00`;
}

export function formatMinuteTick(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return SHORT_DATE_FORMATTER.format(date);
}

export function toTimestamp(value: string | null): number {
  if (!value) {
    return 0;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function getAxisLabelStep(stats: ProjectExecutionStatsSnapshot["range"]): number {
  if (stats.resolution === "5min") {
    return 3;
  }
  if (stats.resolution === "hour") {
    return stats.bucketCount > 18 ? 3 : 1;
  }
  if (stats.resolution === "week") {
    return stats.bucketCount > 24 ? 4 : 2;
  }
  return stats.bucketCount > 20 ? 5 : 1;
}

export function formatAxisLabel(bucket: ExecutionUsageBucketSummary, range: ProjectExecutionStatsSnapshot["range"]): string {
  if (range.resolution === "5min") {
    return formatMinuteTick(bucket.bucketStart);
  }
  if (range.resolution === "hour") {
    return formatHourTick(bucket.bucketStart);
  }
  if (range.resolution === "week") {
    return bucket.label;
  }
  return formatShortDate(bucket.bucketStart);
}

export function getLedgerSortValue(item: ExecutionStatsEntitySummary, key: LedgerSortKey): number | string {
  switch (key) {
    case "tokens":
      return item.usage.totalTokens;
    case "active":
      return item.usage.activeTimeMs;
    case "input":
      return item.usage.inputTokens;
    case "output":
      return item.usage.outputTokens;
    case "name":
      return item.label.toLowerCase();
    case "p50":
      return (item as any).duration?.p50Ms ?? 0;
    case "p95":
      return (item as any).duration?.p95Ms ?? 0;
    case "last":
    default:
      return toTimestamp(item.lastActivityAt);
  }
}
