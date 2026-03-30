import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { DashboardRealtimeEventRepository } from "../../../src/repositories/dashboard-realtime-event-repository.js";
import { DashboardRealtimeService } from "../../../src/services/dashboard-realtime-service.js";

const tempDirs: string[] = [];

async function createService() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-dashboard-realtime-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const repository = new DashboardRealtimeEventRepository(storage);
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any;
  const service = new DashboardRealtimeService(repository, logger);

  return { service, logger };
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
});
