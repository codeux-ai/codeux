import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageBucketSummary,
  ProjectExecutionStatsSnapshot,
} from "../../../types.js";
import type { LedgerSortKey } from "./stats-ui-primitives.js";
import type { DashboardLocale } from "../../../i18n/index.js";

export interface LedgerDurationStats {
  p50Ms?: number | null;
  p95Ms?: number | null;
}

export interface ExecutionStatsEntityWithDuration extends ExecutionStatsEntitySummary {
  duration?: LedgerDurationStats | null;
}

export const createDayFormatter = (locale: DashboardLocale = "en"): Intl.DateTimeFormat => new Intl.DateTimeFormat(locale, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const createShortDateFormatter = (locale: DashboardLocale = "en"): Intl.DateTimeFormat => new Intl.DateTimeFormat(locale, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** @deprecated Pass a locale to formatDay instead. */
export const DAY_FORMATTER = createDayFormatter();

export function formatDay(_value: string, locale: DashboardLocale = "en"): string {
  const date = new Date(_value);
  if (Number.isNaN(date.getTime())) {
    return _value;
  }
  return createDayFormatter(locale).format(date);
}

export function formatHourTick(value: string, locale: DashboardLocale = "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const bucketHour = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
  ));
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(bucketHour);
}

export function formatMinuteTick(value: string, locale: DashboardLocale = "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(date);
}

export function formatShortDate(value: string, locale: DashboardLocale = "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return createShortDateFormatter(locale).format(date);
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

export function formatAxisLabel(bucket: ExecutionUsageBucketSummary, range: ProjectExecutionStatsSnapshot["range"], locale: DashboardLocale = "en"): string {
  if (range.resolution === "5min") {
    return formatMinuteTick(bucket.bucketStart, locale);
  }
  if (range.resolution === "hour") {
    return formatHourTick(bucket.bucketStart, locale);
  }
  if (range.resolution === "week") {
    return bucket.label;
  }
  return formatShortDate(bucket.bucketStart, locale);
}

export function getLedgerSortValue(item: ExecutionStatsEntitySummary, key: LedgerSortKey): number | string {
  const duration = (item as ExecutionStatsEntityWithDuration).duration;

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
      return duration?.p50Ms ?? 0;
    case "p95":
      return duration?.p95Ms ?? 0;
    case "last":
    default:
      return toTimestamp(item.lastActivityAt);
  }
}
