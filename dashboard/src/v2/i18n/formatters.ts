import type { DashboardLocale } from "./locales.js";

export type DashboardDateValue = Date | number;

const UNIX_SECONDS_MAX_ABS = 99_999_999_999;
const LEGACY_TIME_ONLY_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i;

const parseLegacyTimeOnly = (value: string): number => {
  const match = LEGACY_TIME_ONLY_PATTERN.exec(value.trim());
  if (!match) {
    return Number.NaN;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59 || second > 59) {
    return Number.NaN;
  }

  const meridiem = match[4].toUpperCase();
  const normalizedHour = hour % 12 + (meridiem === "PM" ? 12 : 0);
  const date = new Date(0);
  date.setHours(normalizedHour, minute, second, 0);
  return date.getTime();
};

const parseTimestampString = (value: string): number => {
  const parsedTimestamp = Date.parse(value);
  return Number.isNaN(parsedTimestamp) ? parseLegacyTimeOnly(value) : parsedTimestamp;
};

/**
 * Normalizes dashboard timestamps without throwing during render. Runtime
 * snapshots can contain ISO strings, Unix seconds, Unix milliseconds, or the
 * legacy time-only value emitted by status assembly.
 */
export const parseDashboardTimestamp = (
  value: string | number | Date | null | undefined,
): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const numericValue = typeof value === "number"
    ? value
    : typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value.trim())
      : null;
  const timestamp = numericValue !== null
    ? Math.abs(numericValue) <= UNIX_SECONDS_MAX_ABS ? numericValue * 1_000 : numericValue
    : value instanceof Date
      ? value.getTime()
      : typeof value === "string"
        ? parseTimestampString(value)
        : Number.NaN;

  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
};

export interface DashboardFormatters {
  formatNumber: (value: number | bigint, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: DashboardDateValue, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: DashboardDateValue, options?: Intl.DateTimeFormatOptions) => string;
  formatRelativeTime: (
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ) => string;
  formatList: (values: readonly string[], options?: Intl.ListFormatOptions) => string;
}

export const createDashboardFormatters = (locale: DashboardLocale): DashboardFormatters => ({
  formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
  formatDate: (value, options) => new Intl.DateTimeFormat(locale, options).format(value),
  formatTime: (value, options = { hour: "numeric", minute: "2-digit" }) => (
    new Intl.DateTimeFormat(locale, options).format(value)
  ),
  formatRelativeTime: (value, unit, options) => (
    new Intl.RelativeTimeFormat(locale, options).format(value, unit)
  ),
  formatList: (values, options) => new Intl.ListFormat(locale, options).format(values),
});
