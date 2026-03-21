import { describe, expect, it } from "vitest";
import type { LiveTaskTimingSummary } from "../../../dashboard/src/v2/lib/live-stats.js";
import { deriveLiveDurationDisplay } from "../../../dashboard/src/v2/lib/live-duration-display.js";

function makeTaskTiming(overrides: Partial<LiveTaskTimingSummary> = {}): LiveTaskTimingSummary {
  return {
    taskId: overrides.taskId || "task-record-1",
    taskKey: overrides.taskKey || "T01",
    taskTitle: overrides.taskTitle || "Task",
    phase: overrides.phase || "RUNNING",
    startedAt: overrides.startedAt ?? "2026-03-21T10:00:00.000Z",
    endedAt: overrides.endedAt ?? null,
    totalSeconds: overrides.totalSeconds ?? 0,
    activeStage: "activeStage" in overrides ? (overrides.activeStage ?? null) : "coding",
    stageTotals: overrides.stageTotals ?? {
      queued: 0,
      coding: 0,
      ci: 0,
      autofix: 0,
      merge: 0,
    },
    segments: overrides.segments ?? [],
  };
}

describe("live duration display", () => {
  it("keeps active task timing badges live from the task summary", () => {
    const display = deriveLiveDurationDisplay({
      taskTiming: makeTaskTiming({
        startedAt: "2026-03-21T10:00:00.000Z",
        totalSeconds: 2,
        activeStage: "coding",
      }),
      now: "2026-03-21T10:00:05.000Z",
    });

    expect(display).toEqual({
      visible: true,
      mode: "live",
      elapsedSeconds: 5,
    });
  });

  it("prefers the completed task summary over fallback dispatch timestamps", () => {
    const display = deriveLiveDurationDisplay({
      taskTiming: makeTaskTiming({
        phase: "COMPLETED",
        startedAt: "2026-03-21T10:00:00.000Z",
        endedAt: "2026-03-21T10:03:00.000Z",
        totalSeconds: 180,
        activeStage: null,
      }),
      dispatchTiming: {
        startedAt: "2026-03-21T10:00:00.000Z",
        finishedAt: "2026-03-21T10:06:00.000Z",
        status: "completed",
      },
      now: "2026-03-21T10:10:00.000Z",
    });

    expect(display).toEqual({
      visible: true,
      mode: "frozen",
      elapsedSeconds: 180,
    });
  });

  it("freezes completed fallback dispatch durations when no task timing is available", () => {
    const display = deriveLiveDurationDisplay({
      dispatchTiming: {
        startedAt: "2026-03-21T10:00:00.000Z",
        finishedAt: "2026-03-21T10:02:00.000Z",
        status: "completed",
      },
      now: "2026-03-21T10:05:00.000Z",
    });

    expect(display).toEqual({
      visible: true,
      mode: "frozen",
      elapsedSeconds: 120,
    });
  });

  it("hides the badge when no usable start timestamp exists", () => {
    const display = deriveLiveDurationDisplay({
      dispatchTiming: {
        startedAt: null,
        finishedAt: null,
        status: "running",
      },
      now: "2026-03-21T10:05:00.000Z",
    });

    expect(display).toEqual({
      visible: false,
      mode: "hidden",
      elapsedSeconds: 0,
    });
  });

  it("hides zero-duration badges for deterministic layout behavior", () => {
    const display = deriveLiveDurationDisplay({
      dispatchTiming: {
        startedAt: "2026-03-21T10:00:00.000Z",
        finishedAt: "2026-03-21T10:00:00.000Z",
        status: "completed",
      },
      now: "2026-03-21T10:00:05.000Z",
    });

    expect(display).toEqual({
      visible: false,
      mode: "hidden",
      elapsedSeconds: 0,
    });
  });
});
