import type {
  ScheduleRecurrenceRule,
  SchedulerEntryRecord,
  SchedulerOccurrence,
} from "../../contracts/scheduler-types.js";

const DEFAULT_RECURRENCE: ScheduleRecurrenceRule = {
  frequency: "none",
  interval: 1,
  endMode: "never",
  count: null,
  until: null,
};

export function normalizeRecurrenceRule(input?: Partial<ScheduleRecurrenceRule> | null): ScheduleRecurrenceRule {
  const frequency = input?.frequency ?? "none";
  const interval = Math.max(1, Math.floor(Number(input?.interval ?? 1)) || 1);
  const endMode = input?.endMode ?? "never";
  const count = endMode === "after_count"
    ? Math.max(1, Math.floor(Number(input?.count ?? 1)) || 1)
    : null;
  const until = endMode === "on_date" && input?.until ? new Date(input.until).toISOString() : null;

  if (frequency === "none") {
    return { ...DEFAULT_RECURRENCE };
  }

  return {
    frequency,
    interval,
    endMode,
    count,
    until,
  };
}

export function addRecurrenceInterval(dateIso: string, recurrence: ScheduleRecurrenceRule): string | null {
  if (recurrence.frequency === "none") {
    return null;
  }

  const date = new Date(dateIso);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  switch (recurrence.frequency) {
    case "hourly":
      date.setUTCHours(date.getUTCHours() + recurrence.interval);
      break;
    case "daily":
      date.setUTCDate(date.getUTCDate() + recurrence.interval);
      break;
    case "weekly":
      date.setUTCDate(date.getUTCDate() + (recurrence.interval * 7));
      break;
    case "monthly":
      date.setUTCMonth(date.getUTCMonth() + recurrence.interval);
      break;
    default:
      return null;
  }

  return date.toISOString();
}

export function computeNextRunAfterOccurrence(
  occurrenceIso: string,
  recurrence: ScheduleRecurrenceRule,
  runCountAfterOccurrence: number,
): string | null {
  if (recurrence.frequency === "none") {
    return null;
  }
  if (recurrence.endMode === "after_count" && recurrence.count && runCountAfterOccurrence >= recurrence.count) {
    return null;
  }

  const nextRunAt = addRecurrenceInterval(occurrenceIso, recurrence);
  if (!nextRunAt) {
    return null;
  }
  if (recurrence.endMode === "on_date" && recurrence.until && new Date(nextRunAt).getTime() > new Date(recurrence.until).getTime()) {
    return null;
  }
  return nextRunAt;
}

export function computeFirstOccurrenceAtOrAfter(
  scheduledForIso: string,
  recurrence: ScheduleRecurrenceRule,
  nowIso: string,
): string | null {
  const nowTime = new Date(nowIso).getTime();
  let current: string | null = scheduledForIso;
  let occurrenceIndex = 1;

  while (current) {
    const currentTime = new Date(current).getTime();
    if (!Number.isFinite(currentTime)) {
      return null;
    }

    if (currentTime >= nowTime) {
      if (recurrence.endMode === "after_count" && recurrence.count && occurrenceIndex > recurrence.count) {
        return null;
      }
      return current;
    }

    if (recurrence.frequency === "none") {
      return null;
    }

    current = addRecurrenceInterval(current, recurrence);
    occurrenceIndex += 1;

    if (occurrenceIndex > 1000) {
      break;
    }

    if (recurrence.endMode === "on_date" && recurrence.until && current) {
      if (new Date(current).getTime() > new Date(recurrence.until).getTime()) {
        return null;
      }
    }
  }

  return null;
}

export function buildSchedulerOccurrences(
  entries: SchedulerEntryRecord[],
  fromIso: string,
  toIso: string,
  nowIso = new Date().toISOString(),
): SchedulerOccurrence[] {
  const fromTime = new Date(fromIso).getTime();
  const toTime = new Date(toIso).getTime();
  const nowTime = new Date(nowIso).getTime();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime > toTime) {
    return [];
  }

  const occurrences: SchedulerOccurrence[] = [];

  for (const entry of entries) {
    if (entry.status === "cancelled") {
      continue;
    }

    let startsAt: string | null = entry.scheduledFor;
    let occurrenceIndex = 1;

    while (startsAt) {
      const startsTime = new Date(startsAt).getTime();
      if (!Number.isFinite(startsTime)) {
        break;
      }
      if (startsTime > toTime) {
        break;
      }

      const countLimitReached = entry.recurrence.endMode === "after_count"
        && entry.recurrence.count
        && occurrenceIndex > entry.recurrence.count;
      if (countLimitReached) {
        break;
      }

      if (startsTime >= fromTime) {
        occurrences.push({
          id: `${entry.id}:${occurrenceIndex}`,
          entryId: entry.id,
          projectId: entry.projectId,
          title: entry.title,
          targetType: entry.targetType,
          status: entry.status,
          startsAt,
          occurrenceIndex,
          isNextRun: entry.nextRunAt === startsAt,
          isCompletedRun: occurrenceIndex <= entry.runCount || (startsTime < nowTime && entry.status === "completed"),
        });
      }

      if (entry.recurrence.frequency === "none") {
        break;
      }
      startsAt = addRecurrenceInterval(startsAt, entry.recurrence);
      occurrenceIndex += 1;
      if (occurrenceIndex > 1000) {
        break;
      }
      if (entry.recurrence.endMode === "on_date" && entry.recurrence.until && startsAt) {
        if (new Date(startsAt).getTime() > new Date(entry.recurrence.until).getTime()) {
          break;
        }
      }
    }
  }

  return occurrences.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}
