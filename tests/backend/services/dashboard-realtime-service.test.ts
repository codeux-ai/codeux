import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { DashboardRealtimeEventRepository } from "../../../src/repositories/dashboard-realtime-event-repository.js";
import { DashboardRealtimeService } from "../../../src/services/dashboard-realtime-service.js";

const tempDirs: string[] = [];

async function createService() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-dashboard-realtime-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const repository = new DashboardRealtimeEventRepository(storage);
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any;
  const service = new DashboardRealtimeService(repository, logger);
  const cacheInvalidator = {
    invalidateProjectExecution: vi.fn(),
    invalidateProjectStats: vi.fn(),
    invalidateOverview: vi.fn(),
    invalidateProjects: vi.fn(),
  };
  service.setCacheInvalidator(cacheInvalidator);

  return { service, logger, cacheInvalidator };
}

function buildExecutionRealtimeSnapshot(options?: { updatedAt?: string }) {
  return {
    projectId: "proj-1",
    projectName: "Project 1",
    sprintRuns: [
      {
        id: "run-1",
        projectId: "proj-1",
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
        projectId: "proj-1",
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
        projectIds: ["proj-1"],
        activeProjectIds: ["proj-1"],
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
        projectId: "proj-1",
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
        payload: { ignored: "large" },
      },
    ],
    recentInvocations: [
      {
        id: "invocation-1",
        projectId: "proj-1",
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
        startedAt: "2026-03-30T08:59:30.000Z",
        finishedAt: null,
        errorMessage: null,
        lastErrorCategory: null,
        lastErrorMessage: null,
        lastRetryAfterIso: null,
        messageCount: 2,
        lastMessageAt: "2026-03-30T09:00:00.000Z",
        createdAt: "2026-03-30T08:59:30.000Z",
        updatedAt: "2026-03-30T09:00:00.000Z",
      },
    ],
    updatedAt: options?.updatedAt ?? "2026-03-30T09:00:00.000Z",
  };
}

function buildLiveRealtimeSnapshot(
  execution: ReturnType<typeof buildExecutionRealtimeSnapshot>,
  options?: { statusTimestamp?: string; updatedAt?: string },
) {
  return {
    projectId: "proj-1",
    selectedSprintId: "sprint-1",
    status: {
      project_id: "proj-1",
      sprint_id: "sprint-1",
      sprint_number: 1,
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
          is_independent: true,
        },
      ],
      timestamp: options?.statusTimestamp ?? "2026-03-30T09:00:00.000Z",
    },
    execution,
    gitStatus: null,
    gitStatusError: null,
    updatedAt: options?.updatedAt ?? "2026-03-30T09:00:00.000Z",
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("DashboardRealtimeService", () => {
  it("publishes a unified project live snapshot", async () => {
    const { service } = await createService();
    const events: Array<{ eventType: string; payload: unknown }> = [];

    service.setSnapshotLoaders({
      getProjectsSnapshot: () => ({ projects: [], selectedProjectId: "project-1" }),
      getProjectExecutionSnapshot: () => ({
        projectId: "project-1",
        projectName: "Project 1",
        sprintRuns: [],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: "2026-03-30T09:00:00.000Z",
      }),
      getProjectStatusSnapshot: () => ({
        project_id: "project-1",
        sprint_id: "sprint-1",
        subtasks: [],
        timestamp: "2026-03-30T09:00:00.000Z",
      }),
      getProjectLiveSnapshot: () => ({
        projectId: "project-1",
        selectedSprintId: "sprint-1",
        status: {
          project_id: "project-1",
          sprint_id: "sprint-1",
          subtasks: [],
          timestamp: "2026-03-30T09:00:00.000Z",
        },
        execution: {
          projectId: "project-1",
          projectName: "Project 1",
          sprintRuns: [],
          taskDispatches: [],
          connections: [],
          primaryAssignedWorker: null,
          overflowAssignedWorkers: [],
          attentionItems: [],
          recentEvents: [],
          updatedAt: "2026-03-30T09:00:00.000Z",
        },
        gitStatus: null,
        gitStatusError: null,
        updatedAt: "2026-03-30T09:00:00.000Z",
      }),
      getOverviewTelemetrySnapshot: () => ({
        activeProjects: [],
        attentionProjects: [],
        recentEvents: [],
        updatedAt: "2026-03-30T09:00:00.000Z",
      }),
    });

    service.subscribe((event) => {
      events.push({ eventType: event.eventType, payload: event.payload });
    });

    service.scheduleProjectLiveRefresh("project-1");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(events).toContainEqual({
      eventType: "project.live.updated",
      payload: expect.objectContaining({
        projectId: "project-1",
        selectedSprintId: "sprint-1",
      }),
    });
  });

  it("Confirm that firing 100 consecutive schedules synchronously results in exactly 1 emitted notification payload", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const eventRepoMock = {
      getLatestSequence: () => 1,
      appendEvent: vi.fn().mockImplementation((input) => ({ sequence: 2, ...input })),
    };

    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);

    let executionRefreshCount = 0;
    service.subscribe((event) => {
      if (event.eventType === "execution_refresh") {
        executionRefreshCount++;
      }
    });

    vi.useFakeTimers();
    for (let i = 0; i < 100; i++) {
      service.scheduleProjectExecutionRefresh(`proj-${i}`);
    }

    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(executionRefreshCount).toBe(1);
    vi.useRealTimers();
  });

  it("fans execution refreshes into the unified live snapshot stream", async () => {
    const { service } = await createService();
    const eventTypes: string[] = [];

    service.setSnapshotLoaders({
      getProjectsSnapshot: () => ({ projects: [], selectedProjectId: "project-1" }),
      getProjectExecutionSnapshot: () => ({
        projectId: "project-1",
        projectName: "Project 1",
        sprintRuns: [],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: "2026-03-30T09:00:00.000Z",
      }),
      getProjectStatusSnapshot: () => ({
        project_id: "project-1",
        sprint_id: "sprint-1",
        subtasks: [],
        timestamp: "2026-03-30T09:00:00.000Z",
      }),
      getProjectLiveSnapshot: () => ({
        projectId: "project-1",
        selectedSprintId: "sprint-1",
        status: {
          project_id: "project-1",
          sprint_id: "sprint-1",
          subtasks: [],
          timestamp: "2026-03-30T09:00:00.000Z",
        },
        execution: {
          projectId: "project-1",
          projectName: "Project 1",
          sprintRuns: [],
          taskDispatches: [],
          connections: [],
          primaryAssignedWorker: null,
          overflowAssignedWorkers: [],
          attentionItems: [],
          recentEvents: [],
          updatedAt: "2026-03-30T09:00:00.000Z",
        },
        gitStatus: null,
        gitStatusError: null,
        updatedAt: "2026-03-30T09:00:00.000Z",
      }),
      getOverviewTelemetrySnapshot: () => ({
        activeProjects: [],
        attentionProjects: [],
        recentEvents: [],
        updatedAt: "2026-03-30T09:00:00.000Z",
      }),
    });

    service.subscribe((event) => {
      eventTypes.push(event.eventType);
    });

    service.scheduleProjectExecutionRefresh("project-1", { includeOverview: false });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(eventTypes).toContain("project.execution.updated");
    expect(eventTypes).toContain("project.live.updated");
  });

  it("routes the heavy live payload to a dedicated `:live` scope, separate from the execution channel", async () => {
    const { service } = await createService();
    const scopeByEventType = new Map<string, string>();

    service.setSnapshotLoaders({
      getProjectsSnapshot: () => ({ projects: [], selectedProjectId: "project-1" }),
      getProjectExecutionSnapshot: () => ({
        projectId: "project-1",
        projectName: "Project 1",
        sprintRuns: [],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: "2026-03-30T09:00:00.000Z",
      }),
      getProjectStatusSnapshot: () => ({
        project_id: "project-1",
        sprint_id: "sprint-1",
        subtasks: [],
        timestamp: "2026-03-30T09:00:00.000Z",
      }),
      getProjectLiveSnapshot: () => ({
        projectId: "project-1",
        selectedSprintId: "sprint-1",
        status: { project_id: "project-1", sprint_id: "sprint-1", subtasks: [], timestamp: "2026-03-30T09:00:00.000Z" },
        execution: {
          projectId: "project-1",
          projectName: "Project 1",
          sprintRuns: [],
          taskDispatches: [],
          connections: [],
          primaryAssignedWorker: null,
          overflowAssignedWorkers: [],
          attentionItems: [],
          recentEvents: [],
          updatedAt: "2026-03-30T09:00:00.000Z",
        },
        gitStatus: null,
        gitStatusError: null,
        updatedAt: "2026-03-30T09:00:00.000Z",
      }),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], attentionProjects: [], recentEvents: [], updatedAt: "2026-03-30T09:00:00.000Z" }),
    });

    service.subscribe((event) => {
      scopeByEventType.set(event.eventType, event.scope);
    });

    service.scheduleProjectExecutionRefresh("project-1", { includeOverview: false });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The lean execution channel stays on the shared project scope (sprints/overview/chat),
    // while the heavy live payload is isolated on its own scope (Live/Tasks only).
    expect(scopeByEventType.get("project.execution.updated")).toBe("project:project-1");
    expect(scopeByEventType.get("project.live.updated")).toBe("project:project-1:live");
  });

  it("routes the large git payload to a dedicated `:git` scope", async () => {
    const { service } = await createService();
    const scopeByEventType = new Map<string, string>();

    service.setSnapshotLoaders({
      getProjectsSnapshot: () => ({ projects: [], selectedProjectId: "project-1" }),
      getProjectExecutionSnapshot: () => ({} as any),
      getProjectStatusSnapshot: () => ({} as any),
      getProjectLiveSnapshot: () => ({} as any),
      getProjectGitStatus: () => ({ mode: "REMOTE", branch: "feature/x", defaultBranch: "main" } as any),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [], attentionProjects: [], recentEvents: [], updatedAt: "2026-03-30T09:00:00.000Z" }),
    });

    service.subscribe((event) => {
      scopeByEventType.set(event.eventType, event.scope);
    });

    service.scheduleProjectGitRefresh("project-1");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(scopeByEventType.get("project.git.updated")).toBe("project:project-1:git");
  });
});

describe("DashboardRealtimeService observability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits size and frequency info when publishing project live snapshot", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const eventRepoMock = {
      getLatestSequence: () => 1,
      appendEvent: vi.fn().mockReturnValue({ sequence: 2 }),
    };

    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: () => ({ selectedSprintId: "sprint-1", foo: "bar" } as any),
      getProjectsSnapshot: () => ({} as any),
      getProjectExecutionSnapshot: () => ({} as any),
      getProjectStatusSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
    });

    service.scheduleProjectLiveRefresh("proj-1");
    vi.advanceTimersByTime(100);
    // wait for flush
    await Promise.resolve();
    await Promise.resolve();

    expect(loggerMock.info).toHaveBeenCalledWith(
      "realtime_snapshot_published",
      expect.objectContaining({
        type: "project.live.updated",
        projectId: "proj-1",
        sizeBytes: expect.any(Number),
        publishFrequencyMs: 0,
      })
    );
  });

  it("emits background refresh info when publishing projects overview", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const eventRepoMock = {
      getLatestSequence: () => 1,
      appendEvent: vi.fn().mockReturnValue({ sequence: 2 }),
    };

    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: () => ({} as any),
      getProjectsSnapshot: () => ({} as any),
      getProjectExecutionSnapshot: () => ({} as any),
      getProjectStatusSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
    });

    service.scheduleProjectsRefresh();
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(loggerMock.info).toHaveBeenCalledWith(
      "realtime_background_refresh",
      expect.objectContaining({ type: "projects" })
    );
  });

  it("coalesces burst execution refresh scheduling and preserves includeOverview escalation", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const eventRepoMock = {
      getLatestSequence: () => 1,
      appendEvent: vi.fn().mockReturnValue({ sequence: 2 }),
    };
    const getProjectExecutionSnapshot = vi.fn(() => ({ projectId: "proj-1", updatedAt: "2026-03-30T09:00:00.000Z" }));
    const getOverviewTelemetrySnapshot = vi.fn(() => ({ updatedAt: "2026-03-30T09:00:00.000Z" }));

    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: () => ({ selectedSprintId: "sprint-1" } as any),
      getProjectsSnapshot: () => ({} as any),
      getProjectExecutionSnapshot: getProjectExecutionSnapshot as any,
      getProjectStatusSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: getOverviewTelemetrySnapshot as any,
    });

    for (let index = 0; index < 25; index += 1) {
      service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: false });
    }
    service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: true });

    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(getProjectExecutionSnapshot).toHaveBeenCalledTimes(1);
    expect(getOverviewTelemetrySnapshot).toHaveBeenCalledTimes(1);
  });
});

describe("DashboardRealtimeService extracted publisher helper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips duplicate snapshot payloads natively via helper cache checks", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const eventRepoMock = {
      getLatestSequence: () => 1,
      appendEvent: vi.fn().mockImplementation((event) => ({ sequence: 2, ...event })),
    };

    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);

    // We return the same payload shape on two back-to-back loader calls.
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: vi.fn().mockResolvedValue({
        selectedSprintId: "sprint-1",
        updatedAt: new Date().toISOString(), // This is ignored by getFingerprint
        dummyValue: "bar",
      }),
      getProjectExecutionSnapshot: vi.fn().mockResolvedValue({
        projectId: "proj-1",
        updatedAt: new Date().toISOString(), // This is ignored by getFingerprint
        dummyValue: "foo",
      }),
    } as any);

    service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: false });
    await vi.advanceTimersByTimeAsync(100);

    // The first execution refresh queues an execution_refresh event in the debouncer,
    // plus a project.execution.updated AND a project.live.updated.
    expect(eventRepoMock.appendEvent).toHaveBeenCalledTimes(3);

    // Trigger second publish attempt
    service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: false });

    // Advance well past the throttle window (PROJECT_LIVE_MIN_INTERVAL_MS is 5s); the async variant
    // also flushes the loader microtasks so the re-attempted publish actually runs.
    await vi.advanceTimersByTimeAsync(6000);

    // We should get another execution_refresh event (since it doesn't skip dupes)
    // but NO new project.execution.updated or project.live.updated events.
    expect(eventRepoMock.appendEvent).toHaveBeenCalledTimes(4);


    expect(loggerMock.debug).toHaveBeenCalledWith(
      "skipping_duplicate_realtime_snapshot",
      expect.objectContaining({ type: "project.live.updated" })
    );
  });

  it("skips equivalent live and execution snapshots with timestamp churn without full-payload fingerprinting", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const eventRepoMock = {
      getLatestSequence: () => 1,
      appendEvent: vi.fn().mockImplementation((event) => ({ sequence: 2, ...event })),
    };
    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);
    let currentExecution = buildExecutionRealtimeSnapshot();
    let currentLive = buildLiveRealtimeSnapshot(currentExecution);

    service.setSnapshotLoaders({
      getProjectLiveSnapshot: vi.fn(() => currentLive),
      getProjectExecutionSnapshot: vi.fn(() => currentExecution),
      getProjectsSnapshot: () => ({} as any),
      getProjectStatusSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
    });

    const stringifySpy = vi.spyOn(JSON, "stringify");

    service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: false });
    await vi.advanceTimersByTimeAsync(100);

    currentExecution = buildExecutionRealtimeSnapshot({ updatedAt: "2026-03-30T09:01:00.000Z" });
    currentLive = buildLiveRealtimeSnapshot(currentExecution, {
      statusTimestamp: "2026-03-30T09:01:00.000Z",
      updatedAt: "2026-03-30T09:01:00.000Z",
    });

    service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: false });
    await vi.advanceTimersByTimeAsync(6000);

    const stringifyCalls = stringifySpy.mock.calls.length;
    stringifySpy.mockRestore();

    const eventTypes = eventRepoMock.appendEvent.mock.calls.map((call) => call[0].eventType);
    expect(eventTypes.filter((type) => type === "execution_refresh")).toHaveLength(2);
    expect(eventTypes.filter((type) => type === "project.execution.updated")).toHaveLength(1);
    expect(eventTypes.filter((type) => type === "project.live.updated")).toHaveLength(1);
    expect(service.getMetrics("project.execution.updated").unchanged).toBe(1);
    expect(service.getMetrics("project.live.updated").unchanged).toBe(1);
    expect(stringifyCalls).toBe(0);
  });

  it.each([
    {
      name: "sprint run status",
      mutate: (snapshot: ReturnType<typeof buildExecutionRealtimeSnapshot>) => {
        snapshot.sprintRuns[0] = { ...snapshot.sprintRuns[0], status: "completed" };
      },
    },
    {
      name: "dispatch status",
      mutate: (snapshot: ReturnType<typeof buildExecutionRealtimeSnapshot>) => {
        snapshot.taskDispatches[0] = { ...snapshot.taskDispatches[0], status: "completed" };
      },
    },
    {
      name: "attention item status",
      mutate: (snapshot: ReturnType<typeof buildExecutionRealtimeSnapshot>) => {
        snapshot.attentionItems[0] = { ...snapshot.attentionItems[0], status: "resolved" };
      },
    },
    {
      name: "runtime event identity",
      mutate: (snapshot: ReturnType<typeof buildExecutionRealtimeSnapshot>) => {
        snapshot.recentEvents[0] = { ...snapshot.recentEvents[0], id: "event-2" };
      },
    },
    {
      name: "recent invocation identity",
      mutate: (snapshot: ReturnType<typeof buildExecutionRealtimeSnapshot>) => {
        snapshot.recentInvocations[0] = { ...snapshot.recentInvocations[0], id: "invocation-2" };
      },
    },
  ])("publishes when $name changes in a known execution snapshot", async ({ mutate }) => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const eventRepoMock = {
      getLatestSequence: () => 1,
      appendEvent: vi.fn().mockImplementation((event) => ({ sequence: 2, ...event })),
    };
    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);
    let currentExecution = buildExecutionRealtimeSnapshot();
    let currentLive = buildLiveRealtimeSnapshot(currentExecution);

    service.setSnapshotLoaders({
      getProjectLiveSnapshot: vi.fn(() => currentLive),
      getProjectExecutionSnapshot: vi.fn(() => currentExecution),
      getProjectsSnapshot: () => ({} as any),
      getProjectStatusSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
    });

    service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: false });
    await vi.advanceTimersByTimeAsync(100);

    currentExecution = buildExecutionRealtimeSnapshot({ updatedAt: "2026-03-30T09:01:00.000Z" });
    mutate(currentExecution);
    currentLive = buildLiveRealtimeSnapshot(currentExecution, {
      statusTimestamp: "2026-03-30T09:01:00.000Z",
      updatedAt: "2026-03-30T09:01:00.000Z",
    });

    service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: false });
    await vi.advanceTimersByTimeAsync(6000);

    const eventTypes = eventRepoMock.appendEvent.mock.calls.map((call) => call[0].eventType);
    expect(eventTypes.filter((type) => type === "project.execution.updated")).toHaveLength(2);
  });

  it("expediteProjectLiveRefresh bypasses the live throttle for an immediate publish", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const eventRepoMock = {
      getLatestSequence: () => 1,
      appendEvent: vi.fn().mockImplementation((event) => ({ sequence: 2, ...event })),
    };
    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);

    // Distinct payload each call so the duplicate-skip never suppresses a publish.
    let counter = 0;
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: vi.fn().mockImplementation(async () => ({
        selectedSprintId: `sprint-${counter++}`,
      })),
    } as any);

    const livePublishes = () =>
      eventRepoMock.appendEvent.mock.calls.filter((c) => c[0].eventType === "project.live.updated").length;

    // First publish establishes the throttle watermark.
    service.scheduleProjectLiveRefresh("proj-1");
    await vi.advanceTimersByTimeAsync(100);
    expect(livePublishes()).toBe(1);

    // A normal refresh within the 5s window is throttled — no new publish.
    service.scheduleProjectLiveRefresh("proj-1");
    await vi.advanceTimersByTimeAsync(200);
    expect(livePublishes()).toBe(1);

    // Expedite bypasses the throttle and publishes on the next flush.
    service.expediteProjectLiveRefresh("proj-1");
    await vi.advanceTimersByTimeAsync(100);
    expect(livePublishes()).toBe(2);
  });


  describe("synchronous cache invalidation", () => {
    it("invalidates project execution caches when scheduling execution refresh", async () => {
      const { service, cacheInvalidator } = await createService();
      service.scheduleProjectExecutionRefresh("project-1");
      expect(cacheInvalidator.invalidateProjectExecution).toHaveBeenCalledWith("project-1");
      expect(cacheInvalidator.invalidateProjectStats).toHaveBeenCalledWith("project-1");
    });

    it("invalidates overview cache when scheduling overview refresh", async () => {
      const { service, cacheInvalidator } = await createService();
      service.scheduleOverviewRefresh();
      expect(cacheInvalidator.invalidateOverview).toHaveBeenCalled();
    });

    it("invalidates projects cache when scheduling projects refresh", async () => {
      const { service, cacheInvalidator } = await createService();
      service.scheduleProjectsRefresh();
      expect(cacheInvalidator.invalidateProjects).toHaveBeenCalled();
    });
  });
});


describe("DashboardRealtimeService backpressure and metrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("increments coalesced metric when scheduling the same scope rapidly", async () => {
    const { service } = await createService();

    // Initial call shouldn't coalesce (metrics stay 0)
    service.scheduleProjectLiveRefresh("proj-1");
    let metrics = service.getMetrics("project.live.updated");
    expect(metrics.coalesced).toBe(0);

    // Subsequent calls before flush should increment coalesced
    service.scheduleProjectLiveRefresh("proj-1");
    service.scheduleProjectLiveRefresh("proj-1");
    metrics = service.getMetrics("project.live.updated");
    expect(metrics.coalesced).toBe(2);
  });

  it("increments throttled metric when publishing too soon after previous publish", async () => {
    const { service } = await createService();
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: () => ({ selectedSprintId: "s1" } as any),
      getProjectsSnapshot: () => ({} as any),
      getProjectExecutionSnapshot: () => ({} as any),
      getProjectStatusSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
    });

    // First publish establishes the watermark
    service.scheduleProjectLiveRefresh("proj-1");
    await vi.advanceTimersByTimeAsync(100);

    let metrics = service.getMetrics("project.live.updated");
    expect(metrics.published).toBe(1);
    expect(metrics.throttled).toBe(0);

    // Schedule again immediately (throttle window is 5s)
    service.scheduleProjectLiveRefresh("proj-1");
    await vi.advanceTimersByTimeAsync(100);

    metrics = service.getMetrics("project.live.updated");
    expect(metrics.throttled).toBe(1);
    expect(metrics.published).toBe(1);
  });

            it("increments unchanged metric and skips broadcast when payload is identical", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const eventRepoMock = {
      getLatestSequence: () => 1,
      appendEvent: vi.fn().mockImplementation((event) => ({ sequence: 2, ...event })),
    };

    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);

    // We return the same payload shape on two back-to-back loader calls.
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: vi.fn().mockResolvedValue({
        selectedSprintId: "sprint-1",
        updatedAt: new Date().toISOString(), // This is ignored by getFingerprint
        dummyValue: "bar",
      }),
      getProjectExecutionSnapshot: vi.fn().mockResolvedValue({
        projectId: "proj-1",
        updatedAt: new Date().toISOString(), // This is ignored by getFingerprint
        dummyValue: "foo",
      }),
    } as any);

    service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: false });
    await vi.advanceTimersByTimeAsync(100);

    let metrics = service.getMetrics("project.live.updated");
    expect(metrics.published).toBe(1);
    expect(metrics.unchanged).toBe(0);

    // Trigger second publish attempt
    service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: false });

    // Advance well past the throttle window (PROJECT_LIVE_MIN_INTERVAL_MS is 5s); the async variant
    // also flushes the loader microtasks so the re-attempted publish actually runs.
    await vi.advanceTimersByTimeAsync(6000);

    metrics = service.getMetrics("project.live.updated");
    expect(metrics.published).toBe(1); // not incremented
    expect(metrics.unchanged).toBe(1);
  });

  it("increments failures metric when snapshot loader throws", async () => {
    const { service } = await createService();
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: () => { throw new Error("Loader failed"); },
      getProjectsSnapshot: () => ({} as any),
      getProjectExecutionSnapshot: () => ({} as any),
      getProjectStatusSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
    });

    service.scheduleProjectLiveRefresh("proj-error");
    await vi.advanceTimersByTimeAsync(100);

    let metrics = service.getMetrics("project.live.updated");
    expect(metrics.failures).toBe(1);
    expect(metrics.published).toBe(0);
  });

  it("skips heavy live snapshot assembly when no websocket client is subscribed to the live scope", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    const eventRepoMock = {
      getLatestSequence: () => 1,
      appendEvent: vi.fn().mockImplementation((event) => ({ sequence: 2, ...event })),
    };
    const getProjectLiveSnapshot = vi.fn(() => ({ selectedSprintId: "sprint-1" }));
    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);
    service.setScopeInterestResolver((scope) => scope !== "project:proj-1:live");
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: getProjectLiveSnapshot as any,
      getProjectsSnapshot: () => ({} as any),
      getProjectExecutionSnapshot: () => ({} as any),
      getProjectStatusSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
    });

    service.scheduleProjectLiveRefresh("proj-1");
    await vi.advanceTimersByTimeAsync(100);

    expect(getProjectLiveSnapshot).not.toHaveBeenCalled();
    expect(eventRepoMock.appendEvent).not.toHaveBeenCalled();
    expect(service.getMetrics("project.live.updated").skipped).toBe(1);
  });

  it("bounds redundant burst snapshot writes to one publish per coalesced event type", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    let sequence = 1;
    const eventRepoMock = {
      getLatestSequence: () => sequence,
      appendEvent: vi.fn().mockImplementation((event) => ({ sequence: ++sequence, emittedAt: "2026-03-30T09:00:00.000Z", ...event })),
    };
    const getProjectLiveSnapshot = vi.fn(() => ({ selectedSprintId: "sprint-1", value: "live" }));
    const getProjectExecutionSnapshot = vi.fn(() => ({ projectId: "proj-1", value: "execution" }));

    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: getProjectLiveSnapshot as any,
      getProjectsSnapshot: () => ({} as any),
      getProjectExecutionSnapshot: getProjectExecutionSnapshot as any,
      getProjectStatusSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
    });

    for (let index = 0; index < 100; index += 1) {
      service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: false });
    }

    await service.drain();

    const eventTypes = eventRepoMock.appendEvent.mock.calls.map((call) => call[0].eventType);
    expect(eventTypes.filter((type) => type === "execution_refresh")).toHaveLength(1);
    expect(eventTypes.filter((type) => type === "project.live.updated")).toHaveLength(1);
    expect(eventTypes.filter((type) => type === "project.execution.updated")).toHaveLength(1);
    expect(getProjectLiveSnapshot).toHaveBeenCalledTimes(1);
    expect(getProjectExecutionSnapshot).toHaveBeenCalledTimes(1);
    expect(service.getMetrics("project.live.updated").coalesced).toBe(99);
    expect(service.getMetrics("project.execution.updated").coalesced).toBe(99);
  });

  it("continues publishing other ready snapshots when one event write fails", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    let sequence = 1;
    const eventRepoMock = {
      getLatestSequence: () => sequence,
      appendEvent: vi.fn().mockImplementation((event) => {
        if (event.eventType === "project.live.updated") {
          throw new Error("sqlite busy");
        }
        return { sequence: ++sequence, emittedAt: "2026-03-30T09:00:00.000Z", ...event };
      }),
    };
    const publishedEventTypes: string[] = [];
    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: () => ({ selectedSprintId: "sprint-1", value: "live" } as any),
      getProjectsSnapshot: () => ({} as any),
      getProjectExecutionSnapshot: () => ({ projectId: "proj-1", value: "execution" } as any),
      getProjectStatusSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
    });
    service.subscribe((event) => {
      publishedEventTypes.push(event.eventType);
    });

    service.scheduleProjectExecutionRefresh("proj-1", { includeOverview: false });
    await service.drain();

    expect(publishedEventTypes).toContain("execution_refresh");
    expect(publishedEventTypes).toContain("project.execution.updated");
    expect(publishedEventTypes).not.toContain("project.live.updated");
    expect(loggerMock.error).toHaveBeenCalledWith(
      "dashboard_realtime_event_write_failed",
      expect.objectContaining({
        eventType: "project.live.updated",
        projectId: "proj-1",
        correlationId: null,
        error: expect.any(Error),
      }),
    );
    expect(service.getMetrics("project.live.updated").failures).toBe(1);
    expect(service.getMetrics("project.execution.updated").published).toBe(1);
  });

  it("drain flushes pending debounce work without waiting for timers", async () => {
    const loggerMock = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn(), child: vi.fn() };
    let sequence = 1;
    const eventRepoMock = {
      getLatestSequence: () => sequence,
      appendEvent: vi.fn().mockImplementation((event) => ({ sequence: ++sequence, emittedAt: "2026-03-30T09:00:00.000Z", ...event })),
    };
    const service = new DashboardRealtimeService(eventRepoMock as any, loggerMock as any);
    service.setSnapshotLoaders({
      getProjectLiveSnapshot: () => ({ selectedSprintId: "sprint-1" } as any),
      getProjectsSnapshot: () => ({ projects: [], selectedProjectId: "proj-1" } as any),
      getProjectExecutionSnapshot: () => ({} as any),
      getProjectStatusSnapshot: () => ({} as any),
      getOverviewTelemetrySnapshot: () => ({} as any),
    });

    service.scheduleProjectsRefresh();
    await service.drain();

    expect(eventRepoMock.appendEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "execution_refresh" }));
    expect(eventRepoMock.appendEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "projects.updated" }));
  });
});
