/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import {
  formatScheduleDateTime,
  toAgentSchedulerSummaryEntry,
} from "../../../dashboard/src/v2/lib/scheduler-api.js";
import type { SchedulerEntryRecord } from "../../../dashboard/src/v2/types.js";

const agentEntry = (overrides: Partial<SchedulerEntryRecord> = {}): SchedulerEntryRecord & {
  targetType: "agent_wakeup";
} => ({
  id: "entry-agent",
  projectId: "project-1",
  title: "Nutzername bleibt",
  targetType: "agent_wakeup",
  status: "scheduled",
  scheduledFor: "2026-10-25T01:30:00.000Z",
  timezone: "Europe/Berlin",
  recurrence: { frequency: "none", interval: 1, endMode: "never" },
  nextRunAt: "2026-10-25T01:30:00.000Z",
  lastRunAt: null,
  runCount: 0,
  lastError: null,
  agentWakeupTarget: {
    bodyMarkdown: "Do not translate this message.",
    threadId: "thread-verbatim",
    origin: "agent_scheduler",
    source: "agent_scheduler",
  },
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

describe("Scheduler locale presentation", () => {
  it("formats the same ISO instant in German using the persisted timezone", () => {
    expect(formatScheduleDateTime("2026-10-25T01:30:00.000Z", "de", "Europe/Berlin")).toMatch(/02:30/);
    expect(formatScheduleDateTime("not-an-iso-date", "de", "Europe/Berlin")).toBe("Keine geplante Zeit");
  });

  it("localizes agent schedule chrome while keeping titles, IDs, and timezone IDs verbatim", () => {
    const summary = toAgentSchedulerSummaryEntry(agentEntry(), "de");

    expect(summary.label).toBe("Agenten-Weckruf");
    expect(summary.statusLabel).toBe("geplant");
    expect(summary.title).toBe("Nutzername bleibt");
    expect(summary.targetSummary).toBe("Thread thread-verbatim");
    expect(summary.timingSummary).toMatch(/^Geplant für /);
    expect(summary.scheduledAt).toBe("2026-10-25T01:30:00.000Z");
  });

  it("localizes anchored task timing without mutating anchor IDs or offsets", () => {
    const summary = toAgentSchedulerSummaryEntry(agentEntry({
      scheduleAnchor: {
        mode: "after_task_end",
        sourceTaskId: "task-source-verbatim",
        offsetMinutes: 15,
      },
    }), "de");

    expect(summary.timingSummary).toBe("Nachdem Quell-Aufgabe task-source-verbatim endet + 15 Minuten");
  });
});
