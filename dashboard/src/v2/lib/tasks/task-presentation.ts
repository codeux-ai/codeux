import type { DashboardLocale } from "../../i18n/locales.js";
import { translateTask, type TaskTextKey } from "../../i18n/messages/tasks.js";

const TASK_TIME_MESSAGE_KEYS = {
  Done: "done",
  Review: "review",
  Active: "active",
  "--": "taskTimeNotStarted",
  "...": "taskTimeSaving",
} as const satisfies Record<string, TaskTextKey>;

function parseSprintDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatTaskTimeState(value: string, locale: DashboardLocale = "en"): string {
  const messageKey = TASK_TIME_MESSAGE_KEYS[value as keyof typeof TASK_TIME_MESSAGE_KEYS];
  return messageKey ? translateTask(locale, messageKey) : value;
}

export function formatTaskSprintDateRange(
  startDate: string | null,
  endDate: string | null,
  locale: DashboardLocale = "en",
): string {
  const start = parseSprintDate(startDate);
  const end = parseSprintDate(endDate);
  if (!start && !end) {
    return translateTask(locale, "scheduleTbd");
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  if (start && end) {
    return `${formatter.format(start)} – ${formatter.format(end)}`;
  }
  const resolvedDate = start ?? end;
  return resolvedDate ? formatter.format(resolvedDate) : translateTask(locale, "scheduleTbd");
}
