import { describe, expect, it } from "vitest";
import { buildSchedulerOccurrences, computeNextRunAfterOccurrence, normalizeRecurrenceRule } from "../../../../src/domain/scheduler/schedule-time.js";
import type { SchedulerEntryRecord } from "../../../../src/contracts/scheduler-types.js";

const baseEntry: SchedulerEntryRecord = {
  id: "entry-1",
  projectId: "project-1",
  title: "Daily sprint",
  targetType: "sprint",
  status: "scheduled",
  scheduledFor: "2026-05-18T09:00:00.000Z",
  timezone: "UTC",
  recurrence: normalizeRecurrenceRule({ frequency: "daily", interval: 1, endMode: "after_count", count: 3 }),
  nextRunAt: "2026-05-18T09:00:00.000Z",
  lastRunAt: null,
  runCount: 0,
  lastError: null,
  sprintTarget: { sprintId: "sprint-1" },
  createdAt: "2026-05-18T08:00:00.000Z",
  updatedAt: "2026-05-18T08:00:00.000Z",
};

describe("schedule-time", () => {
  it("expands recurring entries into visible occurrences", () => {
    const occurrences = buildSchedulerOccurrences(
      [baseEntry],
      "2026-05-18T00:00:00.000Z",
      "2026-05-25T00:00:00.000Z",
      "2026-05-18T08:30:00.000Z",
    );

    expect(occurrences.map((occurrence) => occurrence.startsAt)).toEqual([
      "2026-05-18T09:00:00.000Z",
      "2026-05-19T09:00:00.000Z",
      "2026-05-20T09:00:00.000Z",
    ]);
    expect(occurrences[0].isNextRun).toBe(true);
  });

  it("stops next run computation when a counted recurrence is exhausted", () => {
    const recurrence = normalizeRecurrenceRule({ frequency: "weekly", interval: 1, endMode: "after_count", count: 2 });

    expect(computeNextRunAfterOccurrence("2026-05-18T09:00:00.000Z", recurrence, 1)).toBe("2026-05-25T09:00:00.000Z");
    expect(computeNextRunAfterOccurrence("2026-05-25T09:00:00.000Z", recurrence, 2)).toBeNull();
  });
});
