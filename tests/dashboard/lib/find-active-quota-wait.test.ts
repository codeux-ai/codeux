import { describe, expect, it } from "vitest";
import { findActiveQuotaWait, QUOTA_WAIT_EVENT_TYPE } from "../../../dashboard/src/v2/lib/live-task-runtime.js";
import type { ExecutionRuntimeEventSummary } from "../../../dashboard/src/types.js";

function makeEvent(overrides: Partial<ExecutionRuntimeEventSummary>): ExecutionRuntimeEventSummary {
  return {
    id: "evt-1",
    scopeType: "task_run",
    taskRunId: "run-1",
    sprintRunId: null,
    dispatchId: null,
    projectId: "p1",
    sprintId: "s1",
    sprintName: "S1",
    sprintNumber: 1,
    sprintRunStatus: null,
    taskId: "t1",
    taskKey: "T-1",
    taskTitle: "Task",
    taskRunState: "RUNNING",
    eventType: "worker_heartbeat",
    originator: "system",
    sourceEventKey: null,
    provider: "antigravity",
    sessionId: null,
    sessionName: null,
    workerBranch: null,
    prUrl: null,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    createdAt: "2026-06-01T10:00:00.000Z",
    payload: null,
    ...overrides,
  };
}

describe("findActiveQuotaWait", () => {
  const now = Date.parse("2026-06-01T10:05:00.000Z");

  it("returns null when there are no events", () => {
    expect(findActiveQuotaWait([], now)).toBeNull();
    expect(findActiveQuotaWait(undefined, now)).toBeNull();
  });

  it("returns null when no quota-wait event is present", () => {
    expect(findActiveQuotaWait([makeEvent({ eventType: "worker_heartbeat" })], now)).toBeNull();
  });

  it("detects an active wait when the reset time is still in the future", () => {
    const events = [
      makeEvent({ createdAt: "2026-06-01T10:01:00.000Z" }),
      makeEvent({
        id: "evt-wait",
        eventType: QUOTA_WAIT_EVENT_TYPE,
        createdAt: "2026-06-01T10:02:00.000Z",
        payload: { retryAfterIso: "2026-06-01T12:00:00.000Z", errorCategory: "QUOTA_EXHAUSTED" },
      }),
      // A later heartbeat must not hide the still-active wait.
      makeEvent({ id: "evt-hb", createdAt: "2026-06-01T10:04:00.000Z" }),
    ];
    expect(findActiveQuotaWait(events, now)).toEqual({ retryAfterIso: "2026-06-01T12:00:00.000Z" });
  });

  it("returns null once the reset time has passed (work has resumed)", () => {
    const events = [
      makeEvent({
        id: "evt-wait",
        eventType: QUOTA_WAIT_EVENT_TYPE,
        createdAt: "2026-06-01T09:00:00.000Z",
        payload: { retryAfterIso: "2026-06-01T10:01:00.000Z" },
      }),
    ];
    expect(findActiveQuotaWait(events, now)).toBeNull();
  });

  it("uses the most recent quota-wait event when several are present", () => {
    const events = [
      makeEvent({
        id: "wait-old",
        eventType: QUOTA_WAIT_EVENT_TYPE,
        createdAt: "2026-06-01T09:00:00.000Z",
        payload: { retryAfterIso: "2026-06-01T09:30:00.000Z" },
      }),
      makeEvent({
        id: "wait-new",
        eventType: QUOTA_WAIT_EVENT_TYPE,
        createdAt: "2026-06-01T10:03:00.000Z",
        payload: { retryAfterIso: "2026-06-01T13:00:00.000Z" },
      }),
    ];
    expect(findActiveQuotaWait(events, now)).toEqual({ retryAfterIso: "2026-06-01T13:00:00.000Z" });
  });

  it("ignores quota-wait events without a usable reset time", () => {
    const events = [
      makeEvent({ eventType: QUOTA_WAIT_EVENT_TYPE, payload: { errorCategory: "QUOTA_EXHAUSTED" } }),
    ];
    expect(findActiveQuotaWait(events, now)).toBeNull();
  });
});
