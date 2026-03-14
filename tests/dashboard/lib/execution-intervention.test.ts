import { describe, expect, it } from "vitest";
import {
  formatHumanInterventionTooltip,
  getPrimaryOverviewIntervention,
  getPrimaryPausedInterventionRun,
  getSprintHumanInterventionBySprintId,
} from "../../../dashboard/src/lib/execution-intervention.js";
import type {
  ExecutionDashboardSnapshot,
  ExecutionHumanInterventionSummary,
  OverviewTelemetryProjectSummary,
} from "../../../dashboard/src/types.js";

const HUMAN_INTERVENTION: ExecutionHumanInterventionSummary = {
  title: "Manual merge required",
  reason: "Task T02 is waiting to be merged into the sprint branch.",
  instructions: "Merge the task PR, then resume the sprint.",
  attentionType: "merge_required",
  severity: "high",
  ownerType: "worker",
};

function createSnapshot(): ExecutionDashboardSnapshot {
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
    updatedAt: "2026-03-13T03:00:00.000Z",
  };
}

describe("execution-intervention helpers", () => {
  it("maps the first intervention summary per sprint id", () => {
    const snapshot = createSnapshot();
    snapshot.sprintRuns = [
      {
        id: "run-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintName: "Sprint One",
        sprintNumber: 1,
        status: "paused",
        triggerType: "dashboard",
        triggeredBy: null,
        executorMode: "mixed",
        startedAt: null,
        finishedAt: null,
        lastHeartbeatAt: null,
        createdAt: "2026-03-13T01:00:00.000Z",
        activeLeaseOwnerKey: null,
        activeLeaseExpiresAt: null,
        humanIntervention: HUMAN_INTERVENTION,
      },
      {
        id: "run-2",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintName: "Sprint One",
        sprintNumber: 1,
        status: "failed",
        triggerType: "dashboard",
        triggeredBy: null,
        executorMode: "mixed",
        startedAt: null,
        finishedAt: null,
        lastHeartbeatAt: null,
        createdAt: "2026-03-12T01:00:00.000Z",
        activeLeaseOwnerKey: null,
        activeLeaseExpiresAt: null,
        humanIntervention: {
          ...HUMAN_INTERVENTION,
          title: "Older intervention",
        },
      },
    ];

    const bySprintId = getSprintHumanInterventionBySprintId(snapshot);

    expect(bySprintId.get("sprint-1")?.title).toBe("Manual merge required");
  });

  it("selects the primary paused intervention run", () => {
    const snapshot = createSnapshot();
    snapshot.sprintRuns = [
      {
        id: "run-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintName: "Sprint One",
        sprintNumber: 1,
        status: "running",
        triggerType: "dashboard",
        triggeredBy: null,
        executorMode: "mixed",
        startedAt: null,
        finishedAt: null,
        lastHeartbeatAt: null,
        createdAt: "2026-03-13T01:00:00.000Z",
        activeLeaseOwnerKey: null,
        activeLeaseExpiresAt: null,
        humanIntervention: null,
      },
      {
        id: "run-2",
        projectId: "project-1",
        sprintId: "sprint-2",
        sprintName: "Sprint Two",
        sprintNumber: 2,
        status: "paused",
        triggerType: "dashboard",
        triggeredBy: null,
        executorMode: "mixed",
        startedAt: null,
        finishedAt: null,
        lastHeartbeatAt: null,
        createdAt: "2026-03-13T02:00:00.000Z",
        activeLeaseOwnerKey: null,
        activeLeaseExpiresAt: null,
        humanIntervention: HUMAN_INTERVENTION,
      },
    ];

    expect(getPrimaryPausedInterventionRun(snapshot)?.id).toBe("run-2");
  });

  it("formats tooltip and selects overview intervention projects", () => {
    const projects: OverviewTelemetryProjectSummary[] = [
      {
        projectId: "project-1",
        projectName: "Project 1",
        sprintId: "sprint-1",
        sprintName: "Sprint One",
        sprintNumber: 1,
        sprintRunId: "run-1",
        sprintRunStatus: "paused",
        activeDispatchCount: 0,
        runningDispatchCount: 0,
        updatedAt: "2026-03-13T03:00:00.000Z",
        humanIntervention: HUMAN_INTERVENTION,
      },
    ];

    expect(getPrimaryOverviewIntervention(projects)?.projectId).toBe("project-1");
    expect(formatHumanInterventionTooltip(HUMAN_INTERVENTION)).toContain("What to do:");
  });
});
