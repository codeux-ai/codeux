import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { DashboardRealtimeEventRepository } from "../../../src/repositories/dashboard-realtime-event-repository.js";
import {
  computeDashboardRealtimePayloadFingerprint,
  DashboardRealtimeService,
} from "../../../src/services/dashboard-realtime-service.js";

const tempDirs: string[] = [];

async function createService() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-dashboard-realtime-extra-"));
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

describe("DashboardRealtimeService Extra Coverage", () => {
  it("handles null loaders in flushScheduledSnapshots", async () => {
    const { service } = await createService();
    // loaders is null by default
    service.scheduleProjectsRefresh();
    service.scheduleOverviewRefresh();
    service.scheduleProjectLiveRefresh("p1");
    service.scheduleProjectExecutionRefresh("p1");
    service.scheduleProjectRuntimeStatusRefresh("p1");
    service.scheduleProjectStructureRefresh("p1");
    
    // Trigger flush
    await new Promise((resolve) => setTimeout(resolve, 150));
    // Should not throw, just clears pending
  });

  it("handles errors in snapshot loaders", async () => {
    const { service, logger } = await createService();
    service.setSnapshotLoaders({
      getProjectsSnapshot: () => { throw new Error("Projects fail"); },
      getProjectExecutionSnapshot: () => { throw new Error("Execution fail"); },
      getProjectStatusSnapshot: () => { throw new Error("Status fail"); },
      getProjectLiveSnapshot: () => { throw new Error("Live fail"); },
      getOverviewTelemetrySnapshot: () => { throw new Error("Overview fail"); },
    });

    service.scheduleProjectsRefresh();
    service.scheduleOverviewRefresh();
    service.scheduleProjectLiveRefresh("p1");
    service.scheduleProjectExecutionRefresh("p1");
    service.scheduleProjectRuntimeStatusRefresh("p1");

    await new Promise((resolve) => setTimeout(resolve, 150));
    
    expect(logger.error).toHaveBeenCalled();
  });

  it("handles normalized projectId validation", async () => {
    const { service } = await createService();
    // Should return early for empty projectId
    service.scheduleProjectExecutionRefresh("");
    service.scheduleProjectRuntimeStatusRefresh("  ");
    service.scheduleProjectStructureRefresh("");
    service.scheduleProjectLiveRefresh(null as any);
  });

  it("throttles refreshes based on min intervals", async () => {
    const { service } = await createService();
    let projectsCallCount = 0;
    service.setSnapshotLoaders({
      getProjectsSnapshot: () => { projectsCallCount++; return { projects: [], selectedProjectId: "p1" }; },
      getProjectExecutionSnapshot: () => ({ projectId: "p1" } as any),
      getProjectStatusSnapshot: () => ({ project_id: "p1" } as any),
      getOverviewTelemetrySnapshot: () => ({ activeProjects: [] } as any),
    });

    // First call
    service.scheduleProjectsRefresh();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(projectsCallCount).toBe(1);

    // Immediate second call - should be throttled
    service.scheduleProjectsRefresh();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Not enough time passed for the 750ms interval, but it should have scheduled another flush
    expect(projectsCallCount).toBe(1);
  });

  it("handles listener errors gracefully", async () => {
    const { service, logger } = await createService();
    service.subscribe(() => { throw new Error("Listener failed"); });
    
    service.publishRawEvent({
      scopeType: "projects",
      scopeId: "projects",
      eventType: "projects.updated",
      entityType: "project_collection",
      entityId: "projects",
      payload: {},
      replayable: false,
    });

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Dashboard realtime listener failed"), expect.any(Object));
  });

  describe("Parallel snapshot execution", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("publishes ready scopes in parallel despite mixed fast/slow loaders", async () => {
      const { service, logger } = await createService();

      let fastResolved = false;
      service.setSnapshotLoaders({
        getProjectsSnapshot: () => ({ projects: [], selectedProjectId: "fast-p" }),
        getProjectExecutionSnapshot: async (projectId) => {
          if (projectId === "slow-p") {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            return { projectId: "slow-p" } as any;
          }
          fastResolved = true;
          return { projectId: "fast-p" } as any;
        },
        getProjectStatusSnapshot: () => ({} as any),
        getProjectLiveSnapshot: () => ({} as any),
        getOverviewTelemetrySnapshot: () => ({} as any),
      });

      service.scheduleProjectExecutionRefresh("fast-p");
      service.scheduleProjectExecutionRefresh("slow-p");

      // Advance initial flush timer
      vi.advanceTimersByTime(100);

      // Fast one should resolve immediately and be published before the slow one completes
      await Promise.resolve(); // flush async tick
      await Promise.resolve(); // allSettled tick

      expect(fastResolved).toBe(true);
      // Wait for slow one to finish
      vi.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(logger.error).not.toHaveBeenCalled();
    });

    it("continues publishing ready scopes when one fails", async () => {
      const { service, logger } = await createService();

      let fastResolved = false;
      service.setSnapshotLoaders({
        getProjectsSnapshot: () => ({ projects: [], selectedProjectId: "fast-p" }),
        getProjectExecutionSnapshot: async (projectId) => {
          if (projectId === "fail-p") {
            throw new Error("Deliberate failure");
          }
          fastResolved = true;
          return { projectId: "fast-p" } as any;
        },
        getProjectStatusSnapshot: () => ({} as any),
        getProjectLiveSnapshot: () => ({} as any),
        getOverviewTelemetrySnapshot: () => ({} as any),
      });

      service.scheduleProjectExecutionRefresh("fast-p");
      service.scheduleProjectExecutionRefresh("fail-p");

      vi.advanceTimersByTime(100);

      // Let the promises resolve
      await Promise.resolve();
      await Promise.resolve();

      expect(fastResolved).toBe(true);
      expect(logger.error).toHaveBeenCalledWith("Failed to publish project execution updated realtime snapshot", expect.any(Object));
    });
  });
});

describe("dashboard realtime semantic fingerprints", () => {
  it("ignores overview timestamp-only changes while preserving recent event id changes", () => {
    const basePayload = {
      activeProjects: [{
        projectId: "project-1",
        projectName: "Project 1",
        sprintId: "sprint-1",
        sprintRunId: "run-1",
        sprintRunStatus: "running",
        activeDispatchCount: 1,
        runningDispatchCount: 1,
        updatedAt: "2026-03-30T09:00:00.000Z",
      }],
      attentionProjects: [],
      recentEvents: [{ id: "event-1", eventType: "task_started", createdAt: "2026-03-30T09:00:00.000Z" }],
      updatedAt: "2026-03-30T09:00:00.000Z",
    };

    const timestampOnlyFingerprint = computeDashboardRealtimePayloadFingerprint("overview.telemetry.updated", {
      ...basePayload,
      updatedAt: "2026-03-30T09:01:00.000Z",
      activeProjects: [{ ...basePayload.activeProjects[0], updatedAt: "2026-03-30T09:01:00.000Z" }],
    });

    expect(timestampOnlyFingerprint).toBe(
      computeDashboardRealtimePayloadFingerprint("overview.telemetry.updated", basePayload),
    );
    expect(computeDashboardRealtimePayloadFingerprint("overview.telemetry.updated", {
      ...basePayload,
      recentEvents: [{ id: "event-2", eventType: "task_started", createdAt: "2026-03-30T09:00:00.000Z" }],
    })).not.toBe(timestampOnlyFingerprint);
  });

  it("preserves git status content changes while ignoring collection timestamp churn", () => {
    const basePayload = {
      mode: "REMOTE",
      available: true,
      repositoryRoot: "/repo",
      branch: "feature/live",
      hasRemote: true,
      dirty: false,
      openPullRequests: [{
        number: 42,
        title: "Feature",
        url: "https://example.test/pr/42",
        state: "OPEN",
        isDraft: false,
        headRefName: "feature/live",
        baseRefName: "dev",
        mergeStateStatus: "CLEAN",
        reviewDecision: null,
        updatedAt: "2026-03-30T09:00:00.000Z",
        comments: 1,
        checks: [{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }],
      }],
      ciRuns: [],
      mergedPullRequests: [],
      tracking: { scope: "FEATURE_PR_CI", label: "Feature PR", branch: "feature/live" },
      warnings: [],
      lastUpdated: "2026-03-30T09:00:00.000Z",
    };

    const timestampOnlyFingerprint = computeDashboardRealtimePayloadFingerprint("project.git.updated", {
      ...basePayload,
      lastUpdated: "2026-03-30T09:01:00.000Z",
      openPullRequests: [{ ...basePayload.openPullRequests[0], updatedAt: "2026-03-30T09:01:00.000Z" }],
    });

    expect(timestampOnlyFingerprint).toBe(
      computeDashboardRealtimePayloadFingerprint("project.git.updated", basePayload),
    );
    expect(computeDashboardRealtimePayloadFingerprint("project.git.updated", {
      ...basePayload,
      dirty: true,
    })).not.toBe(timestampOnlyFingerprint);
  });
});
