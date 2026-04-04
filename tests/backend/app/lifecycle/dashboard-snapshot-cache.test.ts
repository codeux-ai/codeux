import { describe, it, expect, vi, beforeEach } from "vitest";
import { DashboardSnapshotCache, mapExecutionConnections, mapAssignedWorkers, mapAttentionItems } from "../../../../src/app/lifecycle/dashboard-snapshot-cache.js";

describe("DashboardSnapshotCache", () => {
  let mockDeps: any;
  let cache: DashboardSnapshotCache;

  beforeEach(() => {
    mockDeps = {
      projectManagementRepository: {
        listProjects: vi.fn().mockReturnValue({ projects: [] }),
      },
      executionRepository: {
        getOverviewTelemetrySnapshot: vi.fn().mockReturnValue({ activeProjects: [] }),
        getProjectExecutionSnapshot: vi.fn().mockReturnValue({ projectId: "p1" }),
        getProjectStatsSnapshot: vi.fn().mockReturnValue({ stats: true }),
      },
      connectionChatRepository: {
        listConnections: vi.fn().mockReturnValue([]),
      },
      projectWorkerAssignmentRepository: {
        listAssignmentsForProject: vi.fn().mockReturnValue([]),
      },
      projectAttentionRepository: {
        listProjectAttentionItems: vi.fn().mockReturnValue([]),
      },
    };
    cache = new DashboardSnapshotCache(mockDeps);
  });

  describe("snapshots caching", () => {
    it("caches project snapshots", () => {
      const snap1 = cache.getProjectsSnapshot();
      const snap2 = cache.getProjectsSnapshot();
      expect(snap1).toBe(snap2);
      expect(mockDeps.projectManagementRepository.listProjects).toHaveBeenCalledTimes(1);
    });

    it("caches overview telemetry", () => {
      const snap1 = cache.getOverviewTelemetrySnapshot();
      const snap2 = cache.getOverviewTelemetrySnapshot();
      expect(snap1).toBe(snap2);
      expect(mockDeps.executionRepository.getOverviewTelemetrySnapshot).toHaveBeenCalledTimes(1);
    });

    it("caches project execution snapshots", () => {
      const snap1 = cache.getProjectExecutionSnapshot("p1");
      const snap2 = cache.getProjectExecutionSnapshot("p1");
      expect(snap1).toBe(snap2);
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledTimes(1);
    });

    it("caches project stats snapshots", () => {
      const snap1 = cache.getProjectStatsSnapshot("p1");
      const snap2 = cache.getProjectStatsSnapshot("p1");
      expect(snap1).toBe(snap2);
      expect(mockDeps.executionRepository.getProjectStatsSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  describe("invalidation", () => {
    it("invalidates project execution", () => {
      cache.getProjectExecutionSnapshot("p1");
      cache.invalidateProjectExecution("p1");
      cache.getProjectExecutionSnapshot("p1");
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledTimes(2);
    });

    it("invalidates project stats", () => {
      cache.getProjectStatsSnapshot("p1", { window: "7d" });
      cache.invalidateProjectStats("p1");
      cache.getProjectStatsSnapshot("p1", { window: "7d" });
      expect(mockDeps.executionRepository.getProjectStatsSnapshot).toHaveBeenCalledTimes(2);
    });

    it("invalidates overview", () => {
      cache.getOverviewTelemetrySnapshot();
      cache.invalidateOverview();
      cache.getOverviewTelemetrySnapshot();
      expect(mockDeps.executionRepository.getOverviewTelemetrySnapshot).toHaveBeenCalledTimes(2);
    });

    it("invalidates projects", () => {
      cache.getProjectsSnapshot();
      cache.invalidateProjects();
      cache.getProjectsSnapshot();
      expect(mockDeps.projectManagementRepository.listProjects).toHaveBeenCalledTimes(2);
    });

    it("invalidates all", () => {
      cache.getProjectsSnapshot();
      cache.getOverviewTelemetrySnapshot();
      cache.getProjectExecutionSnapshot("p1");
      cache.getProjectStatsSnapshot("p1");

      cache.invalidateAll();

      cache.getProjectsSnapshot();
      cache.getOverviewTelemetrySnapshot();
      cache.getProjectExecutionSnapshot("p1");
      cache.getProjectStatsSnapshot("p1");

      expect(mockDeps.projectManagementRepository.listProjects).toHaveBeenCalledTimes(2);
      expect(mockDeps.executionRepository.getOverviewTelemetrySnapshot).toHaveBeenCalledTimes(2);
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledTimes(2);
      expect(mockDeps.executionRepository.getProjectStatsSnapshot).toHaveBeenCalledTimes(2);
    });
  });

  describe("mapping functions", () => {
    it("maps execution connections", () => {
      const result = mapExecutionConnections([
        {
          id: "conn1",
          connectionKey: "key1",
          displayName: "Conn 1",
          role: "worker",
          transport: "stdio",
          status: "connected",
          capabilities: { model: "m", instruction: "i", labels: ["l1"], listenMode: true },
          lastHeartbeatAt: "now",
          projectIds: ["p1"],
          activeProjectIds: ["p1"],
          tasksRunCount: 0,
          threadCount: 0,
          messageCount: 0,
          pendingInboxCount: 0,
          activeDispatchCount: 0,
        } as any
      ]);
      expect(result[0].id).toBe("conn1");
    });

    it("maps assigned workers", () => {
      const result = mapAssignedWorkers([
        {
          id: "a1",
          assignmentRole: "primary",
          capabilities: {}
        } as any
      ]);
      expect(result.primaryAssignedWorker?.assignmentId).toBe("a1");
    });

    it("maps attention items", () => {
      const result = mapAttentionItems([
        {
          id: "att1",
          attentionType: "t",
          severity: "high"
        } as any
      ]);
      expect(result[0].id).toBe("att1");
    });
  });
});
