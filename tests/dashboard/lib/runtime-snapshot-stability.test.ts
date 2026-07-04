import { describe, expect, it } from "vitest";
import type { DashboardStatus, ExecutionDashboardSnapshot } from "../../../dashboard/src/types.js";
import {
  areExecutionSnapshotsEquivalent,
  hasActiveExecutionSnapshot,
  stabilizeExecutionSnapshot,
  stabilizeStatusSnapshot,
} from "../../../dashboard/src/lib/runtime-snapshot-stability.js";

function createStatus(overrides: Partial<DashboardStatus> = {}): DashboardStatus {
  return {
    project_id: "project-1",
    sprint_id: "sprint-1",
    sprint_number: 1,
    source_id: "source-1",
    repo_path: "/repo",
    feature_branch: "feature/sprint-1",
    subtasks: [],
    reportText: "Live report",
    statusTable: "",
    instructions: "Stay sharp",
    timestamp: "2026-03-26T10:00:00.000Z",
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
    updatedAt: "2026-03-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("runtime snapshot stability", () => {
  it("detects active execution work from running sprint runs", () => {
    const execution = createExecution({
      sprintRuns: [{
        id: "run-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintName: "Sprint 1",
        sprintNumber: 1,
        status: "running",
        triggerType: "manual",
        triggeredBy: null,
        executorMode: "mixed",
        startedAt: "2026-03-26T10:00:00.000Z",
        finishedAt: null,
        lastHeartbeatAt: null,
        createdAt: "2026-03-26T10:00:00.000Z",
        activeLeaseOwnerKey: null,
        activeLeaseExpiresAt: null,
        humanIntervention: null,
      }],
    });

    expect(hasActiveExecutionSnapshot(execution)).toBe(true);
  });

  it("keeps the previous status tasks when an empty status lands during active execution", () => {
    const previousStatus = createStatus({
      subtasks: [{
        id: "TASK-1",
        title: "Ship it",
        prompt: "Do the work",
        depends_on: [],
        status: "RUNNING",
        is_independent: true,
      }],
    });
    const nextStatus = createStatus({
      subtasks: [],
      timestamp: "2026-03-26T10:00:05.000Z",
    });
    const execution = createExecution({
      sprintRuns: [{
        id: "run-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintName: "Sprint 1",
        sprintNumber: 1,
        status: "running",
        triggerType: "manual",
        triggeredBy: null,
        executorMode: "mixed",
        startedAt: "2026-03-26T10:00:00.000Z",
        finishedAt: null,
        lastHeartbeatAt: null,
        createdAt: "2026-03-26T10:00:00.000Z",
        activeLeaseOwnerKey: null,
        activeLeaseExpiresAt: null,
        humanIntervention: null,
      }],
    });

    expect(stabilizeStatusSnapshot(previousStatus, nextStatus, execution)).toBe(previousStatus);
  });

  it("accepts an empty status when there is no active execution left", () => {
    const previousStatus = createStatus({
      subtasks: [{
        id: "TASK-1",
        title: "Ship it",
        prompt: "Do the work",
        depends_on: [],
        status: "COMPLETED",
        is_independent: true,
      }],
    });
    const nextStatus = createStatus({
      subtasks: [],
      timestamp: "2026-03-26T10:10:00.000Z",
    });

    expect(stabilizeStatusSnapshot(previousStatus, nextStatus, createExecution())).toBe(nextStatus);
  });

  it("keeps prior runtime metadata when an active status refresh drops ephemeral task fields", () => {
    const previousStatus = createStatus({
      subtasks: [{
        record_id: "task-record-1",
        id: "TASK-1",
        title: "Ship it",
        prompt: "Do the work",
        depends_on: [],
        status: "RUNNING",
        session_id: "session-1",
        session_name: "sessions/session-1",
        session_state: "RUNNING",
        provider: "codex",
        worker_branch: "feature/task-1",
        pr_url: "https://example.com/pr/1",
        is_independent: true,
      }],
    });
    const nextStatus = createStatus({
      subtasks: [{
        record_id: "task-record-1",
        id: "TASK-1",
        title: "Ship it",
        prompt: "Do the work",
        depends_on: [],
        status: "RUNNING",
        is_independent: true,
      }],
      timestamp: "2026-03-26T10:00:05.000Z",
    });
    const execution = createExecution({
      taskDispatches: [{
        id: "dispatch-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintRunId: "run-1",
        sprintName: "Sprint 1",
        sprintNumber: 1,
        taskId: "task-record-1",
        taskKey: "TASK-1",
        taskTitle: "Ship it",
        status: "running",
        executorType: "docker_cli",
        priority: 10,
        connectionId: null,
        connectionDisplayName: null,
        connectionRole: null,
        taskRunId: "task-run-1",
        taskRunState: "RUNNING",
        provider: "codex",
        sessionId: "session-1",
        sessionName: "sessions/session-1",
        workerBranch: "feature/task-1",
        prUrl: "https://example.com/pr/1",
        queuedAt: "2026-03-26T10:00:00.000Z",
        claimedAt: "2026-03-26T10:00:01.000Z",
        startedAt: "2026-03-26T10:00:02.000Z",
        finishedAt: null,
        lastHeartbeatAt: "2026-03-26T10:00:05.000Z",
        errorMessage: null,
        activeLeaseOwnerKey: null,
        activeLeaseExpiresAt: null,
      }],
    });

    expect(stabilizeStatusSnapshot(previousStatus, nextStatus, execution)).toEqual({
      ...nextStatus,
      subtasks: previousStatus.subtasks,
    });
  });

  it("keeps the previous execution snapshot when a transient empty payload arrives mid-sprint", () => {
    const previousExecution = createExecution({
      sprintRuns: [{
        id: "run-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintName: "Sprint 1",
        sprintNumber: 1,
        status: "running",
        triggerType: "manual",
        triggeredBy: null,
        executorMode: "mixed",
        startedAt: "2026-03-26T10:00:00.000Z",
        finishedAt: null,
        lastHeartbeatAt: null,
        createdAt: "2026-03-26T10:00:00.000Z",
        activeLeaseOwnerKey: null,
        activeLeaseExpiresAt: null,
        humanIntervention: null,
      }],
    });
    const emptyExecution = createExecution({
      projectId: null,
      projectName: null,
      sprintRuns: [],
      taskDispatches: [],
      connections: [],
      primaryAssignedWorker: null,
      overflowAssignedWorkers: [],
      attentionItems: [],
      recentEvents: [],
      updatedAt: null,
    });

    expect(stabilizeExecutionSnapshot(previousExecution, emptyExecution)).toBe(previousExecution);
  });

  it("accepts a different execution snapshot when the project identity changes", () => {
    const previousExecution = createExecution({
      sprintRuns: [{
        id: "run-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintName: "Sprint 1",
        sprintNumber: 1,
        status: "running",
        triggerType: "manual",
        triggeredBy: null,
        executorMode: "mixed",
        startedAt: "2026-03-26T10:00:00.000Z",
        finishedAt: null,
        lastHeartbeatAt: null,
        createdAt: "2026-03-26T10:00:00.000Z",
        activeLeaseOwnerKey: null,
        activeLeaseExpiresAt: null,
        humanIntervention: null,
      }],
    });
    const nextExecution = createExecution({
      projectId: "project-2",
      projectName: "Project 2",
      updatedAt: "2026-03-26T10:05:00.000Z",
    });

    expect(stabilizeExecutionSnapshot(previousExecution, nextExecution)).toBe(nextExecution);
  });

  it("treats execution snapshots with only fetch timestamp changes as equivalent", () => {
    const previousExecution = createExecution({
      updatedAt: "2026-03-26T10:00:00.000Z",
      sprintRuns: [{
        id: "run-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintName: "Sprint 1",
        sprintNumber: 1,
        status: "running",
        triggerType: "manual",
        triggeredBy: null,
        executorMode: "mixed",
        startedAt: "2026-03-26T10:00:00.000Z",
        finishedAt: null,
        lastHeartbeatAt: null,
        createdAt: "2026-03-26T10:00:00.000Z",
        activeLeaseOwnerKey: null,
        activeLeaseExpiresAt: null,
        humanIntervention: null,
      }],
    });
    const nextExecution = createExecution({
      ...previousExecution,
      updatedAt: "2026-03-26T10:00:05.000Z",
    });

    expect(areExecutionSnapshotsEquivalent(previousExecution, nextExecution)).toBe(true);
  });

  it("keeps unrelated execution collections stable when high-frequency event feeds change", () => {
    const sprintRuns = [{
      id: "run-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintName: "Sprint 1",
      sprintNumber: 1,
      status: "running",
      triggerType: "manual",
      triggeredBy: null,
      executorMode: "mixed",
      startedAt: "2026-03-26T10:00:00.000Z",
      finishedAt: null,
      lastHeartbeatAt: "2026-03-26T10:00:05.000Z",
      createdAt: "2026-03-26T10:00:00.000Z",
      activeLeaseOwnerKey: null,
      activeLeaseExpiresAt: null,
      humanIntervention: null,
    }] satisfies ExecutionDashboardSnapshot["sprintRuns"];
    const taskDispatches = [{
      id: "dispatch-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      sprintName: "Sprint 1",
      sprintNumber: 1,
      taskId: "task-record-1",
      taskKey: "TASK-1",
      taskTitle: "Ship it",
      status: "running",
      executorType: "docker_cli",
      priority: 10,
      connectionId: null,
      connectionDisplayName: null,
      connectionRole: null,
      taskRunId: "task-run-1",
      taskRunState: "RUNNING",
      provider: "codex",
      sessionId: "session-1",
      sessionName: "sessions/session-1",
      workerBranch: "feature/task-1",
      prUrl: null,
      queuedAt: "2026-03-26T10:00:00.000Z",
      claimedAt: "2026-03-26T10:00:01.000Z",
      startedAt: "2026-03-26T10:00:02.000Z",
      finishedAt: null,
      lastHeartbeatAt: "2026-03-26T10:00:05.000Z",
      errorMessage: null,
      activeLeaseOwnerKey: null,
      activeLeaseExpiresAt: null,
    }] satisfies ExecutionDashboardSnapshot["taskDispatches"];
    const previousExecution = createExecution({
      sprintRuns,
      taskDispatches,
      recentEvents: [{
        id: "event-1",
        createdAt: "2026-03-26T10:00:03.000Z",
        eventType: "dispatch_started",
      } as ExecutionDashboardSnapshot["recentEvents"][number]],
      recentInvocations: [{
        id: "invocation-1",
        status: "running",
        updatedAt: "2026-03-26T10:00:04.000Z",
        messageCount: 1,
        lastMessageAt: "2026-03-26T10:00:04.000Z",
      } as NonNullable<ExecutionDashboardSnapshot["recentInvocations"]>[number]],
    });
    const nextExecution = createExecution({
      ...previousExecution,
      sprintRuns: [{ ...sprintRuns[0] }],
      taskDispatches: [{ ...taskDispatches[0] }],
      recentEvents: [{
        id: "event-2",
        createdAt: "2026-03-26T10:00:06.000Z",
        eventType: "provider_activity",
      } as ExecutionDashboardSnapshot["recentEvents"][number]],
      recentInvocations: [{
        id: "invocation-1",
        status: "running",
        updatedAt: "2026-03-26T10:00:06.000Z",
        messageCount: 2,
        lastMessageAt: "2026-03-26T10:00:06.000Z",
      } as NonNullable<ExecutionDashboardSnapshot["recentInvocations"]>[number]],
      updatedAt: "2026-03-26T10:00:06.000Z",
    });

    const stabilized = stabilizeExecutionSnapshot(previousExecution, nextExecution);

    expect(stabilized).not.toBe(nextExecution);
    expect(stabilized.sprintRuns).toBe(previousExecution.sprintRuns);
    expect(stabilized.taskDispatches).toBe(previousExecution.taskDispatches);
    expect(stabilized.connections).toBe(previousExecution.connections);
    expect(stabilized.attentionItems).toBe(previousExecution.attentionItems);
    expect(stabilized.recentEvents).toBe(nextExecution.recentEvents);
    expect(stabilized.recentInvocations).toBe(nextExecution.recentInvocations);
  });

  it("does not stabilize meaningful task execution changes", () => {
    const previousDispatch = {
      id: "dispatch-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      sprintName: "Sprint 1",
      sprintNumber: 1,
      taskId: "task-record-1",
      taskKey: "TASK-1",
      taskTitle: "Ship it",
      status: "running",
      executorType: "docker_cli",
      priority: 10,
      connectionId: null,
      connectionDisplayName: null,
      connectionRole: null,
      taskRunId: "task-run-1",
      taskRunState: "RUNNING",
      provider: "codex",
      sessionId: "session-1",
      sessionName: "sessions/session-1",
      workerBranch: "feature/task-1",
      prUrl: null,
      queuedAt: "2026-03-26T10:00:00.000Z",
      claimedAt: "2026-03-26T10:00:01.000Z",
      startedAt: "2026-03-26T10:00:02.000Z",
      finishedAt: null,
      lastHeartbeatAt: "2026-03-26T10:00:05.000Z",
      errorMessage: null,
      activeLeaseOwnerKey: null,
      activeLeaseExpiresAt: null,
    } satisfies ExecutionDashboardSnapshot["taskDispatches"][number];
    const previousExecution = createExecution({
      taskDispatches: [previousDispatch],
    });
    const nextExecution = createExecution({
      ...previousExecution,
      taskDispatches: [{
        ...previousDispatch,
        status: "failed",
        taskRunState: "FAILED",
        finishedAt: "2026-03-26T10:00:10.000Z",
        errorMessage: "CI failed",
      }],
    });

    const stabilized = stabilizeExecutionSnapshot(previousExecution, nextExecution);

    expect(stabilized.taskDispatches).toBe(nextExecution.taskDispatches);
    expect(areExecutionSnapshotsEquivalent(previousExecution, nextExecution)).toBe(false);
  });
});
