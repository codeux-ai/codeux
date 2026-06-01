import type { ExecutionSprintRunSummary, ExecutionHumanIntervention } from "../../src/types.js";

export function createSprintRunFixture(overrides: Partial<ExecutionSprintRunSummary> = {}): ExecutionSprintRunSummary {
  return {
    id: "run-1",
    projectId: "proj-1",
    sprintId: "sprint-1",
    sprintName: "Test Sprint",
    sprintNumber: 1,
    status: "running",
    triggerType: "manual",
    triggeredBy: null,
    executorMode: "mixed",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastHeartbeatAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    activeLeaseOwnerKey: null,
    activeLeaseExpiresAt: null,
    humanIntervention: null,
    ...overrides,
  };
}

export function createManualPauseIntervention(): ExecutionHumanIntervention {
  return {
    title: "Sprint Paused For Manual Attention",
    reason: "A dependency must be approved.",
    instructions: "Approve dependency and resume the sprint.",
    attentionType: "manual_attention",
    severity: "medium",
    ownerType: "human",
  };
}

export function createSystemStopIntervention(): ExecutionHumanIntervention {
  return {
    title: "Worker pause",
    reason: "No executable work was available.",
    instructions: "Resolve the stop condition and restart when ready.",
    attentionType: "manual_attention",
    severity: "low",
    ownerType: "worker",
  };
}
