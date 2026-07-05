import { describe, expect, it } from "vitest";
import type {
  DashboardStatus,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
  ProjectLiveDashboardSnapshot,
} from "../../../dashboard/src/types.js";
import {
  areExecutionSnapshotsEquivalent,
  areProjectLiveDashboardSnapshotsEquivalent,
  hasActiveExecutionSnapshot,
  stabilizeExecutionSnapshot,
  stabilizeProjectLiveDashboardSnapshot,
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

function createGitStatus(overrides: Partial<GitTrackingStatus> = {}): GitTrackingStatus {
  return {
    mode: "LOCAL",
    available: true,
    repositoryRoot: "/repo",
    branch: "feature/sprint-1",
    hasRemote: true,
    dirty: false,
    openPullRequests: [],
    ciRuns: [],
    mergedPullRequests: [],
    tracking: {
      scope: "REPOSITORY",
      label: "Repository",
      branch: "feature/sprint-1",
    },
    warnings: [],
    lastUpdated: "2026-03-26T10:00:00.000Z",
    ...overrides,
  };
}

function createLiveSnapshot(overrides: Partial<ProjectLiveDashboardSnapshot> = {}): ProjectLiveDashboardSnapshot {
  return {
    projectId: "project-1",
    selectedSprintId: "sprint-1",
    status: createStatus(),
    execution: createExecution(),
    gitStatus: null,
    gitStatusError: null,
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

  it("reuses the previous live snapshot when only metadata timestamps change", () => {
    const previous = createLiveSnapshot({
      status: createStatus({ timestamp: "2026-03-26T10:00:00.000Z" }),
      execution: createExecution({ updatedAt: "2026-03-26T10:00:00.000Z" }),
      updatedAt: "2026-03-26T10:00:00.000Z",
    });
    const next = createLiveSnapshot({
      status: createStatus({ timestamp: "2026-03-26T10:00:05.000Z" }),
      execution: createExecution({ updatedAt: "2026-03-26T10:00:05.000Z" }),
      updatedAt: "2026-03-26T10:00:05.000Z",
    });

    expect(areProjectLiveDashboardSnapshotsEquivalent(previous, next)).toBe(true);
    expect(stabilizeProjectLiveDashboardSnapshot(previous, next)).toBe(previous);
  });

  it("keeps unrelated live snapshot references stable when invocation and event feeds change", () => {
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
      lastHeartbeatAt: null,
      createdAt: "2026-03-26T10:00:00.000Z",
      activeLeaseOwnerKey: null,
      activeLeaseExpiresAt: null,
      humanIntervention: null,
    }];
    const previous = createLiveSnapshot({
      status: createStatus({
        subtasks: [{
          id: "TASK-1",
          title: "Ship it",
          prompt: "Do the work",
          depends_on: [],
          status: "RUNNING",
          is_independent: true,
        }],
      }),
      execution: createExecution({
        sprintRuns,
        recentEvents: [{
          id: "event-1",
          scopeType: "sprint_run",
          taskRunId: null,
          sprintRunId: "run-1",
          dispatchId: null,
          projectId: "project-1",
          sprintId: "sprint-1",
          sprintName: "Sprint 1",
          sprintNumber: 1,
          sprintRunStatus: "running",
          taskId: null,
          taskKey: null,
          taskTitle: null,
          taskRunState: null,
          eventType: "sprint.started",
          originator: null,
          sourceEventKey: null,
          provider: null,
          sessionId: null,
          sessionName: null,
          workerBranch: null,
          prUrl: null,
          connectionId: null,
          connectionDisplayName: null,
          connectionRole: null,
          createdAt: "2026-03-26T10:00:00.000Z",
          payload: { summaryMarkdown: "Started" },
        }],
        recentInvocations: [{
          id: "invocation-1",
          projectId: "project-1",
          sprintId: "sprint-1",
          taskId: null,
          sprintRunId: "run-1",
          dispatchId: null,
          taskRunId: null,
          attentionItemId: null,
          providerInvocationId: null,
          type: "sprint",
          status: "running",
          provider: "codex",
          model: null,
          systemPrompt: null,
          startedAt: "2026-03-26T10:00:00.000Z",
          finishedAt: null,
          errorMessage: null,
          lastErrorCategory: null,
          lastErrorMessage: null,
          lastRetryAfterIso: null,
          messageCount: 1,
          lastMessageAt: "2026-03-26T10:00:01.000Z",
          createdAt: "2026-03-26T10:00:00.000Z",
          updatedAt: "2026-03-26T10:00:01.000Z",
        }],
      }),
    });
    const next = createLiveSnapshot({
      ...previous,
      status: createStatus({
        ...previous.status,
        timestamp: "2026-03-26T10:00:05.000Z",
        subtasks: previous.status.subtasks.map((task) => ({ ...task })),
      }),
      execution: createExecution({
        ...previous.execution,
        sprintRuns: previous.execution.sprintRuns.map((run) => ({ ...run })),
        recentEvents: [
          {
            ...previous.execution.recentEvents[0]!,
            id: "event-2",
            eventType: "provider.activity",
            createdAt: "2026-03-26T10:00:05.000Z",
            payload: { preview: "New output" },
          },
          previous.execution.recentEvents[0]!,
        ],
        recentInvocations: [{
          ...previous.execution.recentInvocations![0]!,
          messageCount: 2,
          lastMessageAt: "2026-03-26T10:00:05.000Z",
          updatedAt: "2026-03-26T10:00:05.000Z",
        }],
        updatedAt: "2026-03-26T10:00:05.000Z",
      }),
      updatedAt: "2026-03-26T10:00:05.000Z",
    });

    const stabilized = stabilizeProjectLiveDashboardSnapshot(previous, next);

    expect(stabilized).not.toBe(previous);
    expect(stabilized.status).toBe(previous.status);
    expect(stabilized.execution.sprintRuns).toBe(previous.execution.sprintRuns);
    expect(stabilized.execution.recentEvents).toBe(next.execution.recentEvents);
    expect(stabilized.execution.recentInvocations).toBe(next.execution.recentInvocations);
    expect(areProjectLiveDashboardSnapshotsEquivalent(previous, stabilized)).toBe(false);
  });

  it("replaces live snapshots when project or selected sprint scope changes", () => {
    const previous = createLiveSnapshot();
    const nextProject = createLiveSnapshot({ projectId: "project-2" });
    const nextSprint = createLiveSnapshot({ selectedSprintId: "sprint-2" });

    expect(stabilizeProjectLiveDashboardSnapshot(previous, nextProject)).toBe(nextProject);
    expect(stabilizeProjectLiveDashboardSnapshot(previous, nextSprint)).toBe(nextSprint);
    expect(areProjectLiveDashboardSnapshotsEquivalent(previous, nextProject)).toBe(false);
    expect(areProjectLiveDashboardSnapshotsEquivalent(previous, nextSprint)).toBe(false);
  });

  it("treats status subtask and git status changes as live snapshot updates", () => {
    const previous = createLiveSnapshot({
      gitStatus: createGitStatus(),
      status: createStatus({
        subtasks: [{
          id: "TASK-1",
          title: "Ship it",
          prompt: "Do the work",
          depends_on: [],
          status: "RUNNING",
          is_independent: true,
        }],
      }),
    });
    const nextStatus = createLiveSnapshot({
      ...previous,
      status: createStatus({
        ...previous.status,
        subtasks: [{
          ...previous.status.subtasks[0]!,
          status: "COMPLETED",
        }],
      }),
    });
    const nextGit = createLiveSnapshot({
      ...previous,
      gitStatus: createGitStatus({ dirty: true }),
    });
    const nextGitError = createLiveSnapshot({
      ...previous,
      gitStatusError: "git failed",
    });

    expect(areProjectLiveDashboardSnapshotsEquivalent(previous, nextStatus)).toBe(false);
    expect(areProjectLiveDashboardSnapshotsEquivalent(previous, nextGit)).toBe(false);
    expect(areProjectLiveDashboardSnapshotsEquivalent(previous, nextGitError)).toBe(false);
  });
});
