import { describe, expect, it } from "vitest";
import type { ExecutionRuntimeEventSummary } from "../../../dashboard/src/types.js";
import { getExecutionEventText } from "../../../dashboard/src/v2/lib/live-session-config.js";

function createEvent(payload: Record<string, unknown>): ExecutionRuntimeEventSummary {
  return {
    id: "event-1",
    scopeType: "task_run",
    taskRunId: "task-run-1",
    sprintRunId: "run-1",
    dispatchId: "dispatch-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintName: "Sprint 1",
    sprintNumber: 1,
    sprintRunStatus: "running",
    taskId: "task-1",
    taskKey: "TASK-1",
    taskTitle: "Task 1",
    taskRunState: "RUNNING",
    eventType: "provider_activity",
    originator: "agent",
    sourceEventKey: "activity:activity-1",
    provider: "jules",
    sessionId: "session-1",
    sessionName: "sessions/session-1",
    workerBranch: null,
    prUrl: null,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    createdAt: "2026-03-27T10:05:00.000Z",
    payload,
  };
}

describe("live-session-config", () => {
  it("renders real agent clarification messages for provider activity events", () => {
    const text = getExecutionEventText(createEvent({
      preview: "Provider activity",
      agentMessaged: {
        agentMessage: "Need the repo root clarified.",
      },
    }));

    expect(text).toBe("Need the repo root clarified.");
  });

  it("falls back to progress descriptions when no direct message exists", () => {
    const text = getExecutionEventText(createEvent({
      preview: "Provider activity",
      progressUpdated: {
        title: "Refreshing workspace snapshot",
      },
    }));

    expect(text).toBe("Refreshing workspace snapshot");
  });
});
