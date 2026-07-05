import { describe, expect, it } from "vitest";
import type {
  DashboardStatus,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
  OverviewTelemetrySnapshot,
  ProjectLiveDashboardSnapshot,
} from "../../../src/contracts/app-types.js";
import type { ProjectCollectionResponse } from "../../../src/contracts/project-management-types.js";
import {
  getBoundedStableFingerprint,
  getDashboardRealtimePayloadFingerprint,
} from "../../../src/services/dashboard-realtime-payload-fingerprint.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function createStatus(timestamp = "2026-03-30T09:00:00.000Z"): DashboardStatus {
  return {
    project_id: "project-1",
    sprint_id: "sprint-1",
    sprint_number: 1,
    source_id: "source-1",
    repo_path: "/workspace/project-1",
    feature_branch: "feature/sprint-1",
    subtasks: [
      {
        id: "task-1",
        title: "Task 1",
        prompt: "Do the task",
        depends_on: [],
        status: "RUNNING",
        session_id: "session-1",
        session_name: "Session 1",
        session_state: "running",
        provider: "codex",
        model: "gpt-5",
        worker_branch: "feature/task-1",
        pr_url: null,
        is_independent: true,
        merge_indicator: "CI",
      },
    ],
    timestamp,
  };
}

function createExecution(updatedAt = "2026-03-30T09:00:00.000Z"): ExecutionDashboardSnapshot {
  return {
    projectId: "project-1",
    projectName: "Project 1",
    sprintRuns: [
      {
        id: "run-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintName: "Sprint 1",
        sprintNumber: 1,
        status: "running",
        triggerType: "manual",
        triggeredBy: null,
        executorMode: "auto",
        startedAt: "2026-03-30T08:59:00.000Z",
        finishedAt: null,
        lastHeartbeatAt: "2026-03-30T09:00:00.000Z",
        createdAt: "2026-03-30T08:58:00.000Z",
        activeLeaseOwnerKey: "worker-1",
        activeLeaseExpiresAt: "2026-03-30T09:05:00.000Z",
        humanIntervention: null,
      },
    ],
    taskDispatches: [
      {
        id: "dispatch-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        sprintRunId: "run-1",
        sprintName: "Sprint 1",
        sprintNumber: 1,
        taskId: "task-1",
        taskKey: "T-1",
        taskTitle: "Task 1",
        status: "running",
        executorType: "docker_cli",
        priority: 10,
        connectionId: "connection-1",
        connectionDisplayName: "Worker 1",
        connectionRole: "worker",
        taskRunId: "task-run-1",
        taskRunState: "running",
        provider: "codex",
        sessionId: "session-1",
        sessionName: "Session 1",
        workerBranch: "feature/task-1",
        prUrl: null,
        queuedAt: "2026-03-30T08:58:30.000Z",
        claimedAt: "2026-03-30T08:59:00.000Z",
        startedAt: "2026-03-30T08:59:30.000Z",
        finishedAt: null,
        lastHeartbeatAt: "2026-03-30T09:00:00.000Z",
        errorMessage: null,
        activeLeaseOwnerKey: "worker-1",
        activeLeaseExpiresAt: "2026-03-30T09:05:00.000Z",
      },
    ],
    connections: [
      {
        id: "connection-1",
        connectionKey: "worker-1",
        displayName: "Worker 1",
        role: "worker",
        transport: "stdio",
        status: "connected",
        model: "gpt-5",
        instruction: null,
        labels: [],
        listenMode: true,
        machineName: "local",
        platform: "linux",
        arch: "x64",
        localExecutionRuntime: "docker",
        lastHeartbeatAt: "2026-03-30T09:00:00.000Z",
        projectIds: ["project-1"],
        activeProjectIds: ["project-1"],
        tasksRunCount: 1,
        threadCount: 0,
        messageCount: 0,
        pendingInboxCount: 0,
        activeDispatchCount: 1,
      },
    ],
    primaryAssignedWorker: null,
    overflowAssignedWorkers: [],
    attentionItems: [
      {
        id: "attention-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        sprintRunId: "run-1",
        dispatchId: "dispatch-1",
        attentionType: "clarification",
        severity: "medium",
        ownerType: "human",
        status: "open",
        assignedWorkerEndpointId: null,
        title: "Needs input",
        summaryMarkdown: "Question",
        payload: null,
        openedAt: "2026-03-30T09:00:00.000Z",
        claimedAt: null,
        resolvedAt: null,
        updatedAt: "2026-03-30T09:00:00.000Z",
      },
    ],
    recentEvents: [
      {
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
        taskKey: "T-1",
        taskTitle: "Task 1",
        taskRunState: "running",
        eventType: "task_run.heartbeat",
        originator: "system",
        sourceEventKey: "heartbeat-1",
        provider: "codex",
        sessionId: "session-1",
        sessionName: "Session 1",
        workerBranch: "feature/task-1",
        prUrl: null,
        connectionId: "connection-1",
        connectionDisplayName: "Worker 1",
        connectionRole: "worker",
        createdAt: "2026-03-30T09:00:00.000Z",
        payload: { ignoredLargeField: "content" },
      },
    ],
    recentInvocations: [
      {
        id: "invocation-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        sprintRunId: "run-1",
        dispatchId: "dispatch-1",
        taskRunId: "task-run-1",
        attentionItemId: null,
        providerInvocationId: "provider-invocation-1",
        type: "task_coding",
        status: "running",
        provider: "codex",
        model: "gpt-5",
        systemPrompt: null,
        startedAt: "2026-03-30T08:59:00.000Z",
        finishedAt: null,
        errorMessage: null,
        lastErrorCategory: null,
        lastErrorMessage: null,
        lastRetryAfterIso: null,
        messageCount: 2,
        lastMessageAt: "2026-03-30T09:00:00.000Z",
        createdAt: "2026-03-30T08:59:00.000Z",
        updatedAt: "2026-03-30T09:00:00.000Z",
      },
    ],
    updatedAt,
  };
}

function createLive(updatedAt = "2026-03-30T09:00:00.000Z"): ProjectLiveDashboardSnapshot {
  return {
    projectId: "project-1",
    selectedSprintId: "sprint-1",
    status: createStatus(updatedAt),
    execution: createExecution(updatedAt),
    gitStatus: createGitStatus(updatedAt),
    gitStatusError: null,
    updatedAt,
  };
}

function createGitStatus(lastUpdated = "2026-03-30T09:00:00.000Z"): GitTrackingStatus {
  return {
    mode: "REMOTE",
    available: true,
    repositoryRoot: "/workspace/project-1",
    branch: "feature/sprint-1",
    hasRemote: true,
    dirty: false,
    openPullRequests: [
      {
        number: 12,
        title: "Task 1",
        url: "https://example.invalid/pr/12",
        headRefName: "feature/task-1",
        baseRefName: "feature/sprint-1",
        state: "open",
        checks: [{ name: "ci", status: "success" }],
      },
    ],
    ciRuns: [],
    mergedPullRequests: [],
    tracking: {
      scope: "FEATURE_PR_CI",
      label: "Feature PR",
      branch: "feature/sprint-1",
    },
    warnings: [],
    lastUpdated,
  };
}

function createProjects(updatedAt = "2026-03-30T09:00:00.000Z"): ProjectCollectionResponse {
  return {
    selectedProjectId: "project-1",
    projects: [
      {
        id: "project-1",
        slug: "project-1",
        name: "Project 1",
        baseDir: "/workspace/project-1",
        repoUrl: null,
        sourceType: "local",
        sourceRef: "/workspace/project-1",
        gitProvider: "local",
        gitHostDomain: null,
        defaultBranch: "main",
        featureBranchPrefix: "feature/",
        status: "running",
        sprintsCount: 1,
        openTasks: 1,
        completedTasks: 0,
        isRunning: true,
        settingsOverrides: {},
        agentBindings: [],
        lastRunAt: "2026-03-30T08:59:00.000Z",
        lastRunStatus: "running",
        createdAt: "2026-03-30T08:00:00.000Z",
        updatedAt,
      },
    ],
  };
}

function createOverview(updatedAt = "2026-03-30T09:00:00.000Z"): OverviewTelemetrySnapshot {
  return {
    activeProjects: [
      {
        projectId: "project-1",
        projectName: "Project 1",
        sprintId: "sprint-1",
        sprintName: "Sprint 1",
        sprintNumber: 1,
        sprintRunId: "run-1",
        sprintRunStatus: "running",
        activeDispatchCount: 1,
        runningDispatchCount: 1,
        updatedAt,
        humanIntervention: null,
      },
    ],
    attentionProjects: [],
    recentEvents: createExecution(updatedAt).recentEvents,
    updatedAt,
  };
}

describe("dashboard realtime payload fingerprint", () => {
  it.each([
    ["project.live.updated", createLive(), createLive("2026-03-30T09:01:00.000Z")],
    ["project.execution.updated", createExecution(), createExecution("2026-03-30T09:01:00.000Z")],
    ["project.runtime_status.updated", createStatus(), createStatus("2026-03-30T09:01:00.000Z")],
    ["projects.updated", createProjects(), createProjects("2026-03-30T09:01:00.000Z")],
    ["project.git.updated", createGitStatus(), createGitStatus("2026-03-30T09:01:00.000Z")],
    ["overview.telemetry.updated", createOverview(), createOverview("2026-03-30T09:01:00.000Z")],
  ] as const)("keeps %s stable when only fetch timestamps change", (eventType, previous, next) => {
    expect(getDashboardRealtimePayloadFingerprint(eventType, previous)).toBe(
      getDashboardRealtimePayloadFingerprint(eventType, next),
    );
  });

  it("changes when runtime event identity changes", () => {
    const previous = createExecution();
    const next = clone(previous);
    next.recentEvents[0] = { ...next.recentEvents[0], id: "event-2" };

    expect(getDashboardRealtimePayloadFingerprint("project.execution.updated", previous)).not.toBe(
      getDashboardRealtimePayloadFingerprint("project.execution.updated", next),
    );
  });

  it("changes when invocation status changes", () => {
    const previous = createExecution();
    const next = clone(previous);
    next.recentInvocations = next.recentInvocations?.map((invocation) => ({
      ...invocation,
      status: "completed",
      finishedAt: "2026-03-30T09:02:00.000Z",
    }));

    expect(getDashboardRealtimePayloadFingerprint("project.execution.updated", previous)).not.toBe(
      getDashboardRealtimePayloadFingerprint("project.execution.updated", next),
    );
  });

  it("changes when dashboard-visible project collection fields change", () => {
    const previous = createProjects();
    const next = createProjects();
    next.projects[0] = { ...next.projects[0], openTasks: 2 };

    expect(getDashboardRealtimePayloadFingerprint("projects.updated", previous)).not.toBe(
      getDashboardRealtimePayloadFingerprint("projects.updated", next),
    );
  });

  it("falls back to deterministic bounded stable serialization for unknown payloads", () => {
    const previous = {
      z: [1, { b: "two", a: "one" }],
      a: "same",
      updatedAt: "2026-03-30T09:00:00.000Z",
    };
    const reordered = {
      updatedAt: "2026-03-30T09:01:00.000Z",
      a: "same",
      z: [1, { a: "one", b: "two" }],
    };
    const changed = { ...reordered, a: "changed" };

    expect(getDashboardRealtimePayloadFingerprint("unknown.updated", previous)).toBe(
      getDashboardRealtimePayloadFingerprint("unknown.updated", reordered),
    );
    expect(getDashboardRealtimePayloadFingerprint("unknown.updated", previous)).not.toBe(
      getDashboardRealtimePayloadFingerprint("unknown.updated", changed),
    );
  });

  it("bounds fallback serialization for large unknown feeds", () => {
    const hugePayload = {
      rows: Array.from({ length: 500 }, (_, index) => ({
        id: `row-${index}`,
        body: "x".repeat(2_000),
      })),
    };

    const fingerprint = getBoundedStableFingerprint(hugePayload);

    expect(fingerprint.length).toBeLessThan(60_000);
    expect(fingerprint).toContain("__truncated_array_items:420");
    expect(fingerprint).toContain("__truncated_string");
  });
});
