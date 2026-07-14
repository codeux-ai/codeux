import { describe, expect, it, vi } from "vitest";
import type { ExecutionInvocationRecord } from "../../../../src/contracts/invocation-types.js";
import {
  fetchProjectPlanningMetrics,
  selectRecentPlanningInvocationDurations,
} from "../../../../src/domain/planning/invocation-metrics.js";

function invocation(
  overrides: Partial<ExecutionInvocationRecord> = {}
): ExecutionInvocationRecord {
  return {
    id: "invocation",
    projectId: "project",
    sprintId: null,
    taskId: null,
    sprintRunId: null,
    dispatchId: null,
    taskRunId: null,
    attentionItemId: null,
    providerInvocationId: null,
    type: "planning",
    status: "completed",
    provider: null,
    model: null,
    systemPrompt: null,
    startedAt: "2026-07-13T10:00:00.000Z",
    finishedAt: "2026-07-13T10:01:00.000Z",
    errorMessage: null,
    lastErrorCategory: null,
    lastErrorMessage: null,
    lastRetryAfterIso: null,
    messageCount: 0,
    lastMessageAt: null,
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:01:00.000Z",
    ...overrides,
  };
}

describe("selectRecentPlanningInvocationDurations", () => {
  it("uses the latest ten completed planning invocations regardless of input order", () => {
    const records = Array.from({ length: 12 }, (_, index) => invocation({
      id: `planning-${index}`,
      startedAt: new Date(Date.UTC(2026, 6, 1, 0, index)).toISOString(),
      finishedAt: new Date(Date.UTC(2026, 6, 1, 0, index, index + 1)).toISOString(),
    })).reverse();

    expect(selectRecentPlanningInvocationDurations(records)).toEqual([
      12_000,
      11_000,
      10_000,
      9_000,
      8_000,
      7_000,
      6_000,
      5_000,
      4_000,
      3_000,
    ]);
  });

  it("ignores non-planning, unfinished, terminal non-success, and malformed records", () => {
    const records = [
      invocation({ id: "valid" }),
      invocation({ id: "running", status: "running", finishedAt: null }),
      invocation({ id: "failed", status: "failed" }),
      invocation({ id: "cancelled", status: "cancelled" }),
      invocation({ id: "paused", status: "paused" }),
      invocation({ id: "other", type: "qa" }),
      invocation({ id: "invalid-start", startedAt: "invalid" }),
      invocation({ id: "invalid-finish", finishedAt: "invalid" }),
    ];

    expect(selectRecentPlanningInvocationDurations(records)).toEqual([60_000]);
  });

  it("clamps negative durations to zero", () => {
    expect(selectRecentPlanningInvocationDurations([
      invocation({
        startedAt: "2026-07-13T10:01:00.000Z",
        finishedAt: "2026-07-13T10:00:00.000Z",
      }),
    ])).toEqual([0]);
  });
});

describe("fetchProjectPlanningMetrics", () => {
  it("loads project invocations and delegates selection with a custom limit", () => {
    const listProjectInvocations = vi.fn(() => [
      invocation({ id: "older", startedAt: "2026-07-13T09:00:00.000Z", finishedAt: "2026-07-13T09:02:00.000Z" }),
      invocation({ id: "newer" }),
    ]);

    expect(fetchProjectPlanningMetrics(listProjectInvocations, "project", 1)).toEqual({
      durationsMs: [60_000],
    });
    expect(listProjectInvocations).toHaveBeenCalledWith("project");
  });
});
