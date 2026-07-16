import { describe, expect, it } from "vitest";
import type {
  DashboardStatus,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
  ProjectLiveDashboardSnapshot,
  Subtask,
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
    sprintWorkflowProjections: [],
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

function createSubtask(overrides: Partial<Subtask> = {}): Subtask {
  return {
    record_id: "task-record-1",
    project_id: "project-1",
    sprint_id: "sprint-1",
    id: "TASK-1",
    title: "Ship it",
    prompt: "Do the work",
    depends_on: [],
    status: "RUNNING",
    is_independent: true,
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
      subtasks: [createSubtask({
        record_id: "task-record-1",
        session_id: "session-1",
        session_name: "sessions/session-1",
        session_state: "RUNNING",
        provider: "codex",
        worker_branch: "feature/task-1",
        pr_url: "https://example.com/pr/1",
      })],
    });
    const nextStatus = createStatus({
      subtasks: [createSubtask({
        record_id: "task-record-1",
      })],
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
      sprintWorkflowProjections: [],
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

  it("keeps active planning and human workflow projections stable outside bounded feeds", () => {
    const previousExecution = createExecution({
      sprintWorkflowProjections: [{
        sprintId: "sprint-1",
        planningStatus: "running",
        humanIntervention: null,
      }],
    });
    const equivalentExecution = createExecution({
      sprintWorkflowProjections: previousExecution.sprintWorkflowProjections.map((projection) => ({ ...projection })),
      updatedAt: "2026-03-26T10:00:05.000Z",
    });
    const emptyExecution = createExecution({
      projectId: null,
      projectName: null,
      sprintWorkflowProjections: [],
      updatedAt: null,
    });

    expect(hasActiveExecutionSnapshot(previousExecution)).toBe(true);
    expect(stabilizeExecutionSnapshot(previousExecution, equivalentExecution).sprintWorkflowProjections).toBe(
      previousExecution.sprintWorkflowProjections,
    );
    expect(stabilizeExecutionSnapshot(previousExecution, emptyExecution)).toBe(previousExecution);
  });

  it("treats durable workflow projection changes as execution updates", () => {
    const previousExecution = createExecution({
      sprintWorkflowProjections: [{
        sprintId: "sprint-1",
        planningStatus: "running",
        humanIntervention: null,
      }],
    });
    const nextExecution = createExecution({
      sprintWorkflowProjections: [{
        sprintId: "sprint-1",
        planningStatus: "completed",
        humanIntervention: null,
      }],
    });

    expect(areExecutionSnapshotsEquivalent(previousExecution, nextExecution)).toBe(false);
    const stabilized = stabilizeExecutionSnapshot(previousExecution, nextExecution);
    expect(stabilized).not.toBe(previousExecution);
    expect(stabilized.sprintWorkflowProjections).toBe(nextExecution.sprintWorkflowProjections);
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

  it("reuses status and execution list references when only large task payloads and timestamps churn", () => {
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
      prUrl: "https://example.com/pr/1",
      queuedAt: "2026-03-26T10:00:00.000Z",
      claimedAt: "2026-03-26T10:00:01.000Z",
      startedAt: "2026-03-26T10:00:02.000Z",
      finishedAt: null,
      lastHeartbeatAt: "2026-03-26T10:00:05.000Z",
      errorMessage: null,
      activeLeaseOwnerKey: null,
      activeLeaseExpiresAt: null,
    }];
    const connections = [{
      id: "connection-1",
      projectId: "project-1",
      displayName: "Worker 1",
      role: "worker",
      status: "online",
      transport: "stdio",
      model: "gpt-5",
      listenMode: false,
      pendingInboxCount: 0,
      activeDispatchCount: 1,
      lastHeartbeatAt: "2026-03-26T10:00:00.000Z",
      connectedAt: "2026-03-26T09:59:00.000Z",
    }];
    const attentionItems = [{
      id: "attention-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      dispatchId: "dispatch-1",
      taskRunId: "task-run-1",
      taskId: "task-record-1",
      taskKey: "TASK-1",
      title: "Needs review",
      description: "Review output",
      status: "open",
      severity: "medium",
      attentionType: "manual_attention",
      ownerType: "human",
      createdAt: "2026-03-26T10:00:00.000Z",
      updatedAt: "2026-03-26T10:00:00.000Z",
      expiresAt: null,
    }];
    const recentEvents = [{
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
      taskId: "task-record-1",
      taskKey: "TASK-1",
      taskTitle: "Ship it",
      taskRunState: "RUNNING",
      eventType: "task.started",
      originator: null,
      sourceEventKey: null,
      provider: "codex",
      sessionId: "session-1",
      sessionName: "sessions/session-1",
      workerBranch: "feature/task-1",
      prUrl: "https://example.com/pr/1",
      connectionId: null,
      connectionDisplayName: null,
      connectionRole: null,
      createdAt: "2026-03-26T10:00:02.000Z",
      payload: { summaryMarkdown: "Started" },
    }];
    const sprintWorkflowProjections = [{
      sprintId: "sprint-1",
      planningStatus: "completed",
      humanIntervention: null,
    }];
    const recentInvocations = [{
      id: "invocation-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task-record-1",
      sprintRunId: "run-1",
      dispatchId: "dispatch-1",
      taskRunId: "task-run-1",
      attentionItemId: null,
      providerInvocationId: null,
      type: "task",
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
    }];
    const previous = createLiveSnapshot({
      status: createStatus({
        subtasks: [createSubtask({
          activities: [{ timestamp: "2026-03-26T10:00:00.000Z", raw: { output: "x".repeat(4_096) } }],
        })],
      }),
      execution: createExecution({
        sprintRuns,
        taskDispatches,
        connections,
        attentionItems,
        sprintWorkflowProjections,
        recentEvents,
        recentInvocations,
      }),
    });
    const next = createLiveSnapshot({
      ...previous,
      status: createStatus({
        ...previous.status,
        timestamp: "2026-03-26T10:00:05.000Z",
        subtasks: [createSubtask({
          activities: [{ timestamp: "2026-03-26T10:00:05.000Z", raw: { output: "y".repeat(4_096) } }],
          updatedAt: "2026-03-26T10:00:05.000Z",
        } as Partial<Subtask> & { updatedAt: string })],
      }),
      execution: createExecution({
        ...previous.execution,
        sprintRuns: previous.execution.sprintRuns.map((run) => ({ ...run })),
        taskDispatches: previous.execution.taskDispatches.map((dispatch) => ({ ...dispatch })),
        connections: previous.execution.connections.map((connection) => ({ ...connection })),
        attentionItems: previous.execution.attentionItems.map((item) => ({ ...item })),
        sprintWorkflowProjections: previous.execution.sprintWorkflowProjections.map((projection) => ({ ...projection })),
        recentEvents: previous.execution.recentEvents.map((event) => ({ ...event })),
        recentInvocations: previous.execution.recentInvocations?.map((invocation) => ({ ...invocation })),
        updatedAt: "2026-03-26T10:00:05.000Z",
      }),
      updatedAt: "2026-03-26T10:00:05.000Z",
    });

    const stabilized = stabilizeProjectLiveDashboardSnapshot(previous, next);

    expect(stabilized).toBe(previous);
    expect(stabilized.status.subtasks).toBe(previous.status.subtasks);
    expect(stabilized.execution.sprintRuns).toBe(previous.execution.sprintRuns);
    expect(stabilized.execution.taskDispatches).toBe(previous.execution.taskDispatches);
    expect(stabilized.execution.connections).toBe(previous.execution.connections);
    expect(stabilized.execution.attentionItems).toBe(previous.execution.attentionItems);
    expect(stabilized.execution.sprintWorkflowProjections).toBe(previous.execution.sprintWorkflowProjections);
    expect(stabilized.execution.recentEvents).toBe(previous.execution.recentEvents);
    expect(stabilized.execution.recentInvocations).toBe(previous.execution.recentInvocations);
  });

  it("treats rendered task runtime and review fields as status changes", () => {
    const previous = createLiveSnapshot({
      status: createStatus({
        subtasks: [createSubtask({
          latestReview: {
            status: "running",
            outcome: null,
            summary: null,
            findings: [],
            reviewer: null,
            finishedAt: null,
          },
        })],
      }),
    });
    const completedTask = createLiveSnapshot({
      ...previous,
      status: createStatus({
        ...previous.status,
        subtasks: [createSubtask({
          status: "COMPLETED",
          latestReview: previous.status.subtasks[0]!.latestReview,
        })],
      }),
    });
    const reviewedTask = createLiveSnapshot({
      ...previous,
      status: createStatus({
        ...previous.status,
        subtasks: [createSubtask({
          latestReview: {
            status: "completed",
            outcome: "pass",
            summary: "Looks good.",
            findings: ["No blocking issues."],
            reviewer: "qa",
            finishedAt: "2026-03-26T10:05:00.000Z",
          },
        })],
      }),
    });
    const metadataTask = createLiveSnapshot({
      ...previous,
      status: createStatus({
        ...previous.status,
        subtasks: [createSubtask({
          session_id: "session-2",
          session_name: "sessions/session-2",
          session_state: "RUNNING",
          provider: "codex",
          worker_branch: "feature/task-2",
          pr_url: "https://example.com/pr/2",
          latestReview: previous.status.subtasks[0]!.latestReview,
        })],
      }),
    });

    expect(areProjectLiveDashboardSnapshotsEquivalent(previous, completedTask)).toBe(false);
    expect(stabilizeProjectLiveDashboardSnapshot(previous, completedTask)).not.toBe(previous);
    expect(areProjectLiveDashboardSnapshotsEquivalent(previous, reviewedTask)).toBe(false);
    expect(stabilizeProjectLiveDashboardSnapshot(previous, reviewedTask)).not.toBe(previous);
    expect(areProjectLiveDashboardSnapshotsEquivalent(previous, metadataTask)).toBe(false);
    expect(stabilizeProjectLiveDashboardSnapshot(previous, metadataTask)).not.toBe(previous);
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
