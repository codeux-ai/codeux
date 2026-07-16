import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { DashboardSnapshotCachePolicy } from "../../../../src/app/lifecycle/dashboard-snapshot-cache-policy.js";
import { DashboardSnapshotCache, mapExecutionConnections, mapAssignedWorkers, mapAttentionItems } from "../../../../src/app/lifecycle/dashboard-snapshot-cache.js";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { ConnectionChatRepository } from "../../../../src/repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../../../src/repositories/execution-repository.js";
import { ProjectAttentionRepository } from "../../../../src/repositories/project-attention-repository.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../../src/repositories/project-worker-assignment-repository.js";
import { WorkerEndpointRepository } from "../../../../src/repositories/worker-endpoint-repository.js";

describe("DashboardSnapshotCache", () => {
  let mockDeps: any;
  let cache: DashboardSnapshotCache;
  const tempDirs: string[] = [];

  beforeEach(() => {
    mockDeps = {
      projectManagementRepository: {
        listProjects: vi.fn().mockReturnValue({ projects: [] }),
      },
      executionRepository: {
        getOverviewTelemetrySnapshot: vi.fn().mockReturnValue({ activeProjects: [] }),
        getProjectExecutionSnapshot: vi.fn().mockReturnValue({ projectId: "p1" }),
        getProjectStatsSnapshot: vi.fn().mockReturnValue({ stats: true }),
        getHeaderTokenThroughputSnapshot: vi.fn().mockReturnValue({ throughput: true }),
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

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });


  describe("DashboardSnapshotCachePolicy", () => {
    it("generates stable cache keys for project stats queries", () => {
      const key1 = DashboardSnapshotCachePolicy.getProjectStatsCacheKey("p1", { window: "7d" });
      const key2 = DashboardSnapshotCachePolicy.getProjectStatsCacheKey("p1", { window: "7d" });
      expect(key1).toBe(key2);
      expect(key1).toBe('p1:{"window":"7d"}');

      const key3 = DashboardSnapshotCachePolicy.getProjectStatsCacheKey("p1", { window: "30d" });
      expect(key1).not.toBe(key3);
    });

    it("matches cache keys correctly for invalidation", () => {
      const key1 = DashboardSnapshotCachePolicy.getProjectStatsCacheKey("p1", { window: "7d" });
      expect(DashboardSnapshotCachePolicy.isProjectStatsCacheKeyMatch(key1, "p1")).toBe(true);
      expect(DashboardSnapshotCachePolicy.isProjectStatsCacheKeyMatch(key1, "p2")).toBe(false);
    });

    it("generates explicit project execution cache keys for selected sprint scope", () => {
      const noneKey = DashboardSnapshotCachePolicy.getProjectExecutionSnapshotCacheKey("p1");
      const nullKey = DashboardSnapshotCachePolicy.getProjectExecutionSnapshotCacheKey("p1", {
        selectedSprintId: null,
      });
      const selectedKey = DashboardSnapshotCachePolicy.getProjectExecutionSnapshotCacheKey("p1", {
        selectedSprintId: "sprint-1",
      });

      expect(noneKey).toBe("project-execution:p1:selected-sprint:none");
      expect(nullKey).toBe(noneKey);
      expect(selectedKey).toBe("project-execution:p1:selected-sprint:selected:sprint-1");
      expect(selectedKey).not.toBe(noneKey);
      expect(DashboardSnapshotCachePolicy.isProjectExecutionSnapshotCacheKeyMatch(selectedKey, "p1")).toBe(true);
      expect(DashboardSnapshotCachePolicy.isProjectExecutionSnapshotCacheKeyMatch(selectedKey, "p2")).toBe(false);
    });
  });

  describe("lean execution snapshot", () => {
    const baseSnapshot = () => ({
      projectId: "p1",
      projectName: "P1",
      sprintRuns: [{ id: "r1", status: "running" }],
      taskDispatches: [],
      recentEvents: [{ id: "e1" }, { id: "e2" }],
      recentInvocations: [{ id: "i1" }],
    });

    it("strips the activity feed from the lean view while the full view keeps it", () => {
      mockDeps.executionRepository.getProjectExecutionSnapshot.mockReturnValue(baseSnapshot());

      const full = cache.getProjectExecutionSnapshot("p1");
      const lean = cache.getProjectExecutionSnapshotLean("p1");

      expect(full.recentEvents).toHaveLength(2);
      expect(full.recentInvocations).toHaveLength(1);
      expect(lean.recentEvents).toEqual([]);
      expect(lean.recentInvocations).toEqual([]);
      // The ledger-relevant data is preserved.
      expect(lean.sprintRuns).toEqual(full.sprintRuns);
    });

    it("returns a referentially stable lean view for an unchanged snapshot", () => {
      mockDeps.executionRepository.getProjectExecutionSnapshot.mockReturnValue(baseSnapshot());
      const lean1 = cache.getProjectExecutionSnapshotLean("p1");
      const lean2 = cache.getProjectExecutionSnapshotLean("p1");
      expect(lean1).toBe(lean2);
    });

    it("passes selected sprint scope through lean snapshots", () => {
      mockDeps.executionRepository.getProjectExecutionSnapshot.mockReturnValue(baseSnapshot());
      cache.getProjectExecutionSnapshotLean("p1", { selectedSprintId: "sprint-1" });

      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledWith("p1", {
        selectedSprintId: "sprint-1",
      });
    });

    it("returns the snapshot as-is when there is no feed to strip", () => {
      mockDeps.executionRepository.getProjectExecutionSnapshot.mockReturnValue({
        projectId: "p1",
        sprintRuns: [],
        recentEvents: [],
        recentInvocations: [],
      });
      const full = cache.getProjectExecutionSnapshot("p1");
      const lean = cache.getProjectExecutionSnapshotLean("p1");
      expect(lean).toBe(full);
    });
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

    it("caches selected sprint execution snapshots separately", () => {
      const defaultSnap = cache.getProjectExecutionSnapshot("p1");
      const selectedSnap = cache.getProjectExecutionSnapshot("p1", { selectedSprintId: "sprint-1" });
      const selectedSnapAgain = cache.getProjectExecutionSnapshot("p1", { selectedSprintId: "sprint-1" });

      expect(selectedSnapAgain).toBe(selectedSnap);
      expect(selectedSnap).not.toBe(defaultSnap);
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledTimes(2);
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenNthCalledWith(1, "p1", {});
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenNthCalledWith(2, "p1", {
        selectedSprintId: "sprint-1",
      });
    });

    it("bounds execution snapshots across many selected sprint scopes", () => {
      for (let index = 0; index <= DashboardSnapshotCachePolicy.PROJECT_EXECUTION_CACHE_MAX_ENTRIES; index += 1) {
        cache.getProjectExecutionSnapshot("p1", { selectedSprintId: `sprint-${index}` });
      }

      const callsAfterFill = mockDeps.executionRepository.getProjectExecutionSnapshot.mock.calls.length;
      cache.getProjectExecutionSnapshot("p1", { selectedSprintId: "sprint-0" });

      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledTimes(callsAfterFill + 1);
    });

    it("bounds parameterized stats and throughput snapshots", () => {
      for (let index = 0; index <= DashboardSnapshotCachePolicy.PROJECT_STATS_CACHE_MAX_ENTRIES; index += 1) {
        cache.getProjectStatsSnapshot(`project-${index}`, { window: "7d" });
      }
      for (let index = 0; index <= DashboardSnapshotCachePolicy.HEADER_TOKEN_THROUGHPUT_CACHE_MAX_ENTRIES; index += 1) {
        cache.getHeaderTokenThroughputSnapshot({ projectId: `project-${index}`, window: "24h" });
      }

      const statsCalls = mockDeps.executionRepository.getProjectStatsSnapshot.mock.calls.length;
      const throughputCalls = mockDeps.executionRepository.getHeaderTokenThroughputSnapshot.mock.calls.length;
      cache.getProjectStatsSnapshot("project-0", { window: "7d" });
      cache.getHeaderTokenThroughputSnapshot({ projectId: "project-0", window: "24h" });

      expect(mockDeps.executionRepository.getProjectStatsSnapshot).toHaveBeenCalledTimes(statsCalls + 1);
      expect(mockDeps.executionRepository.getHeaderTokenThroughputSnapshot).toHaveBeenCalledTimes(throughputCalls + 1);
    });

    it("scopes active attention queues to the selected sprint while project-wide mode keeps all active items", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dashboard-snapshot-cache-"));
      tempDirs.push(dir);
      const storage = new AppDbStorage(path.join(dir, "app.db"));
      try {
        const projectManagementRepository = new ProjectManagementRepository(storage);
        const executionRepository = new ExecutionRepository(storage);
        const projectAttentionRepository = new ProjectAttentionRepository(storage);
        const workerEndpointRepository = new WorkerEndpointRepository(storage);
        const scopedCache = new DashboardSnapshotCache({
          projectManagementRepository,
          executionRepository,
          projectAttentionRepository,
          connectionChatRepository: new ConnectionChatRepository(storage),
          projectWorkerAssignmentRepository: new ProjectWorkerAssignmentRepository(storage),
        });

        const project = projectManagementRepository.createProject({
          name: "Attention Scope Project",
          sourceType: "local",
          sourceRef: "/workspace/attention-scope",
        });
        const sprintA = projectManagementRepository.createSprint(project.id, {
          name: "Sprint A",
          goal: "Ship A",
        });
        const sprintB = projectManagementRepository.createSprint(project.id, {
          name: "Sprint B",
          goal: "Ship B",
        });
        const runA = executionRepository.createSprintRun({
          projectId: project.id,
          sprintId: sprintA.id,
          status: "running",
        });

        const sprintAItem = projectAttentionRepository.openOrRefreshItem({
          projectId: project.id,
          sprintId: sprintA.id,
          attentionType: "manual_attention",
          severity: "high",
          ownerType: "human",
          title: "Sprint A blocker",
          summaryMarkdown: "A needs attention",
        });
        const sprintARunScopedItem = projectAttentionRepository.openOrRefreshItem({
          projectId: project.id,
          sprintId: null,
          sprintRunId: runA.id,
          attentionType: "merge_required",
          severity: "medium",
          ownerType: "human",
          title: "Sprint A run blocker",
          summaryMarkdown: "Run needs attention",
        });
        const sprintBItem = projectAttentionRepository.openOrRefreshItem({
          projectId: project.id,
          sprintId: sprintB.id,
          attentionType: "action_required",
          severity: "critical",
          ownerType: "human",
          title: "Sprint B blocker",
          summaryMarkdown: "B needs attention",
        });
        const claimedSprintBItem = projectAttentionRepository.openOrRefreshItem({
          projectId: project.id,
          sprintId: sprintB.id,
          attentionType: "merge_conflict",
          severity: "high",
          ownerType: "worker",
          title: "Sprint B claimed blocker",
          summaryMarkdown: "B worker attention",
        });
        const workerEndpoint = workerEndpointRepository.createVirtualEndpoint({
          endpointKey: "worker-1",
          displayName: "Worker 1",
        });
        projectAttentionRepository.claimAttentionItem(claimedSprintBItem.id, {
          assignedWorkerEndpointId: workerEndpoint.id,
        });
        const projectWideItem = projectAttentionRepository.openOrRefreshItem({
          projectId: project.id,
          attentionType: "dashboard_reply_required",
          severity: "medium",
          ownerType: "human",
          title: "Project blocker",
          summaryMarkdown: "Project needs attention",
        });
        const resolvedSprintAItem = projectAttentionRepository.openOrRefreshItem({
          projectId: project.id,
          sprintId: sprintA.id,
          attentionType: "ci_fix_required",
          severity: "high",
          ownerType: "human",
          title: "Resolved Sprint A blocker",
          summaryMarkdown: "Resolved",
        });
        projectAttentionRepository.resolveAttentionItem(resolvedSprintAItem.id, {
          status: "resolved",
          reason: "fixed",
        });
        const dismissedSprintAItem = projectAttentionRepository.openOrRefreshItem({
          projectId: project.id,
          sprintId: sprintA.id,
          attentionType: "human_escalation_required",
          severity: "high",
          ownerType: "human",
          title: "Dismissed Sprint A blocker",
          summaryMarkdown: "Dismissed",
        });
        projectAttentionRepository.resolveAttentionItem(dismissedSprintAItem.id, {
          status: "dismissed",
          reason: "not needed",
        });

        const sprintASnapshot = scopedCache.getProjectExecutionSnapshot(project.id, {
          selectedSprintId: sprintA.id,
        });
        const projectWideSnapshot = scopedCache.getProjectExecutionSnapshot(project.id);

        expect(sprintASnapshot.attentionItems.map((item) => item.id).sort()).toEqual([
          sprintAItem.id,
          sprintARunScopedItem.id,
        ].sort());
        expect(projectWideSnapshot.attentionItems.map((item) => item.id).sort()).toEqual([
          sprintAItem.id,
          sprintARunScopedItem.id,
          sprintBItem.id,
          claimedSprintBItem.id,
          projectWideItem.id,
        ].sort());
        expect(projectWideSnapshot.attentionItems.map((item) => item.id)).not.toContain(resolvedSprintAItem.id);
        expect(projectWideSnapshot.attentionItems.map((item) => item.id)).not.toContain(dismissedSprintAItem.id);
      } finally {
        storage.close();
      }
    });

    it("isolates full and lean execution snapshots across selected sprint scopes", () => {
      mockDeps.executionRepository.getProjectExecutionSnapshot.mockImplementation(
        (projectId: string, options: { selectedSprintId?: string | null } = {}) => {
          const selectedSprintId = options.selectedSprintId ?? "none";
          return {
            projectId,
            projectName: `Project ${selectedSprintId}`,
            sprintRuns: [{ id: `run-${selectedSprintId}`, status: "running" }],
            taskDispatches: [],
            sprintWorkflowProjections: [{
              sprintId: selectedSprintId,
              planningStatus: "completed",
              humanIntervention: null,
            }],
            recentEvents: [{ id: `event-${selectedSprintId}` }],
            recentInvocations: [{ id: `invocation-${selectedSprintId}` }],
          };
        },
      );

      const leanSprint1 = cache.getProjectExecutionSnapshotLean("p1", { selectedSprintId: "sprint-1" });
      const leanSprint2 = cache.getProjectExecutionSnapshotLean("p1", { selectedSprintId: "sprint-2" });
      const fullSprint1 = cache.getProjectExecutionSnapshot("p1", { selectedSprintId: "sprint-1" });
      const fullSprint2 = cache.getProjectExecutionSnapshot("p1", { selectedSprintId: "sprint-2" });

      expect(leanSprint1).not.toBe(leanSprint2);
      expect(leanSprint1.projectName).toBe("Project sprint-1");
      expect(leanSprint2.projectName).toBe("Project sprint-2");
      expect(leanSprint1.recentEvents).toEqual([]);
      expect(leanSprint1.recentInvocations).toEqual([]);
      expect(leanSprint2.recentEvents).toEqual([]);
      expect(leanSprint2.recentInvocations).toEqual([]);
      expect(leanSprint1.sprintWorkflowProjections).toEqual([{
        sprintId: "sprint-1",
        planningStatus: "completed",
        humanIntervention: null,
      }]);
      expect(leanSprint2.sprintWorkflowProjections).toEqual([{
        sprintId: "sprint-2",
        planningStatus: "completed",
        humanIntervention: null,
      }]);
      expect(fullSprint1.recentEvents).toEqual([{ id: "event-sprint-1" }]);
      expect(fullSprint1.recentInvocations).toEqual([{ id: "invocation-sprint-1" }]);
      expect(fullSprint2.recentEvents).toEqual([{ id: "event-sprint-2" }]);
      expect(fullSprint2.recentInvocations).toEqual([{ id: "invocation-sprint-2" }]);
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledTimes(2);
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenNthCalledWith(1, "p1", {
        selectedSprintId: "sprint-1",
      });
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenNthCalledWith(2, "p1", {
        selectedSprintId: "sprint-2",
      });
    });

    it("caches project stats snapshots", () => {
      const snap1 = cache.getProjectStatsSnapshot("p1");
      const snap2 = cache.getProjectStatsSnapshot("p1");
      expect(snap1).toBe(snap2); // Immutability: returned snapshot identity is preserved
      expect(mockDeps.executionRepository.getProjectStatsSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  describe("invalidation", () => {
    it("invalidates project execution", () => {
      mockDeps.executionRepository.getProjectExecutionSnapshot.mockReturnValue({
        projectId: "p1",
        sprintRuns: [],
        taskDispatches: [],
        recentEvents: [{ id: "event-1" }],
        recentInvocations: [{ id: "invocation-1" }],
      });
      cache.getProjectExecutionSnapshot("p1");
      cache.getProjectExecutionSnapshot("p1", { selectedSprintId: "sprint-1" });
      cache.getProjectExecutionSnapshotLean("p1", { selectedSprintId: "sprint-2" });
      cache.invalidateProjectExecution("p1");
      cache.getProjectExecutionSnapshot("p1");
      cache.getProjectExecutionSnapshot("p1", { selectedSprintId: "sprint-1" });
      cache.getProjectExecutionSnapshotLean("p1", { selectedSprintId: "sprint-2" });
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledTimes(6);
    });

    it("invalidates project stats", () => {
      cache.getProjectStatsSnapshot("p1", { window: "7d" });
      cache.invalidateProjectStats("p1");
      cache.getProjectStatsSnapshot("p1", { window: "7d" });
      expect(mockDeps.executionRepository.getProjectStatsSnapshot).toHaveBeenCalledTimes(2);
    });

    it("invalidates only the indexed execution and stats keys for the requested project", () => {
      mockDeps.executionRepository.getProjectExecutionSnapshot.mockImplementation(
        (projectId: string, options: { selectedSprintId?: string | null } = {}) => ({
          projectId,
          projectName: `Project ${projectId}`,
          selectedSprintId: options.selectedSprintId ?? null,
          sprintRuns: [],
          taskDispatches: [],
          recentEvents: [{ id: `event-${projectId}-${options.selectedSprintId ?? "none"}` }],
          recentInvocations: [{ id: `invocation-${projectId}-${options.selectedSprintId ?? "none"}` }],
        }),
      );
      mockDeps.executionRepository.getProjectStatsSnapshot.mockImplementation(
        (projectId: string, query: { window: string }) => ({ projectId, window: query.window }),
      );

      const p1Full = cache.getProjectExecutionSnapshot("p1");
      const p1Lean = cache.getProjectExecutionSnapshotLean("p1", { selectedSprintId: "sprint-1" });
      const p1Stats = cache.getProjectStatsSnapshot("p1", { window: "7d" });
      const p2Full = cache.getProjectExecutionSnapshot("p2");
      const p2Lean = cache.getProjectExecutionSnapshotLean("p2", { selectedSprintId: "sprint-2" });
      const p2Stats = cache.getProjectStatsSnapshot("p2", { window: "30d" });

      mockDeps.executionRepository.getProjectExecutionSnapshot.mockClear();
      mockDeps.executionRepository.getProjectStatsSnapshot.mockClear();

      cache.invalidateProjectExecution("p1");
      cache.invalidateProjectStats("p1");

      const p1FullAfterInvalidation = cache.getProjectExecutionSnapshot("p1");
      const p1LeanAfterInvalidation = cache.getProjectExecutionSnapshotLean("p1", { selectedSprintId: "sprint-1" });
      const p1StatsAfterInvalidation = cache.getProjectStatsSnapshot("p1", { window: "7d" });
      const p2FullAfterInvalidation = cache.getProjectExecutionSnapshot("p2");
      const p2LeanAfterInvalidation = cache.getProjectExecutionSnapshotLean("p2", { selectedSprintId: "sprint-2" });
      const p2StatsAfterInvalidation = cache.getProjectStatsSnapshot("p2", { window: "30d" });

      expect(p1FullAfterInvalidation).not.toBe(p1Full);
      expect(p1LeanAfterInvalidation).not.toBe(p1Lean);
      expect(p1StatsAfterInvalidation).not.toBe(p1Stats);
      expect(p2FullAfterInvalidation).toBe(p2Full);
      expect(p2LeanAfterInvalidation).toBe(p2Lean);
      expect(p2StatsAfterInvalidation).toBe(p2Stats);
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledTimes(2);
      expect(mockDeps.executionRepository.getProjectStatsSnapshot).toHaveBeenCalledTimes(1);
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

    it("reuses cached project execution snapshot before mutation", () => {
      const snap1 = cache.getProjectExecutionSnapshot("p1");
      const snap2 = cache.getProjectExecutionSnapshot("p1");
      expect(snap1).toBe(snap2);
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledTimes(1);
    });

    it("invalidates project execution snapshot after mutation event via invalidator", () => {
      const snap1 = cache.getProjectExecutionSnapshot("p1");
      cache.invalidateProjectExecution("p1");
      const snap3 = cache.getProjectExecutionSnapshot("p1");
      expect(snap1).not.toBe(snap3);
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledTimes(2);
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
