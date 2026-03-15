import { describe, expect, it } from "vitest";
import { deriveLiveSessionRuntimeState } from "../../../dashboard/src/v2/lib/live-session-runtime.js";
import type { DashboardStatus, ExecutionDashboardSnapshot } from "../../../dashboard/src/types.js";

function createStatus(overrides: Partial<DashboardStatus> = {}): DashboardStatus {
  return {
    project_id: "project-1",
    sprint_id: null,
    sprint_number: null,
    source_id: null,
    repo_path: "/repo",
    feature_branch: null,
    subtasks: [],
    reportText: "",
    statusTable: "",
    instructions: "",
    timestamp: null,
    ...overrides,
  };
}

function createExecution(overrides: Partial<ExecutionDashboardSnapshot> = {}): ExecutionDashboardSnapshot {
  return {
    projectId: "project-1",
    projectName: "Project 1",
    sprintRuns: [],
    taskDispatches: [],
    connections: [],
    primaryAssignedWorker: null,
    overflowAssignedWorkers: [],
    attentionItems: [],
    recentEvents: [],
    updatedAt: null,
    ...overrides,
  };
}

describe("live session runtime state", () => {
  it("treats queued or running sprint runs as active sprint context", () => {
    const state = deriveLiveSessionRuntimeState(
      createStatus(),
      createExecution({
        sprintRuns: [{
          id: "run-1",
          projectId: "project-1",
          sprintId: "sprint-1",
          sprintName: "Sprint 1",
          sprintNumber: 52,
          status: "running",
          triggerType: "manual",
          triggeredBy: null,
          executorMode: "mixed",
          startedAt: "2026-03-15T10:00:00.000Z",
          finishedAt: null,
          lastHeartbeatAt: null,
          createdAt: "2026-03-15T10:00:00.000Z",
          activeLeaseOwnerKey: null,
          activeLeaseExpiresAt: null,
          humanIntervention: null,
        }],
      }),
    );

    expect(state.hasActiveSprint).toBe(true);
    expect(state.hasSprintContext).toBe(true);
    expect(state.liveSprintRun?.id).toBe("run-1");
  });

  it("keeps sprint context when status tasks arrive before execution metadata", () => {
    const state = deriveLiveSessionRuntimeState(
      createStatus({
        sprint_id: "sprint-1",
        sprint_number: 52,
        timestamp: "2026-03-15T10:00:05.000Z",
        subtasks: [{
          id: "T01",
          title: "Live task",
          prompt: "Do the thing.",
          depends_on: [],
          is_independent: true,
          status: "RUNNING",
        }],
      }),
      createExecution(),
    );

    expect(state.hasActiveSprint).toBe(false);
    expect(state.hasSprintContext).toBe(true);
    expect(state.liveSprintRun).toBeNull();
  });

  it("keeps sprint context for paused intervention runs", () => {
    const state = deriveLiveSessionRuntimeState(
      createStatus(),
      createExecution({
        sprintRuns: [{
          id: "run-2",
          projectId: "project-1",
          sprintId: "sprint-2",
          sprintName: "Sprint 2",
          sprintNumber: 53,
          status: "paused",
          triggerType: "manual",
          triggeredBy: null,
          executorMode: "mixed",
          startedAt: "2026-03-15T10:00:00.000Z",
          finishedAt: null,
          lastHeartbeatAt: null,
          createdAt: "2026-03-15T10:00:00.000Z",
          activeLeaseOwnerKey: null,
          activeLeaseExpiresAt: null,
          humanIntervention: {
            title: "Needs action",
            reason: "manual_attention",
            instructions: "Investigate the blocker.",
            attentionType: "manual_attention",
            severity: "high",
            ownerType: "human",
          },
        }],
      }),
    );

    expect(state.hasActiveSprint).toBe(false);
    expect(state.hasSprintContext).toBe(true);
    expect(state.pausedInterventionRun?.id).toBe("run-2");
  });
});
