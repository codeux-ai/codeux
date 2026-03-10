import { describe, it, expect, vi, beforeEach } from "vitest";
import { bootDashboard, reinitializeLogger, type BootDashboardDeps } from "../../../../src/app/lifecycle/dashboard-lifecycle-service.js";
import { setupDashboardServer } from "../../../../src/server/dashboard-server.js";
import { createLogger } from "../../../../src/shared/logging/logger.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../src/repositories/settings-defaults.js";
import * as path from "path";

vi.mock("../../../../src/server/dashboard-server.js");
vi.mock("../../../../src/shared/logging/logger.js");

describe("dashboard-lifecycle-service", () => {
  let mockDeps: BootDashboardDeps;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDeps = {
      app: {} as any,
      projectRoot: "/project-root",
      getDashboardPort: vi.fn().mockReturnValue(3000),
      runtimeContext: {
        lastStatus: "idle",
        dashboardSettings: { ...DEFAULT_DASHBOARD_SETTINGS },
        dashboardRuntimePort: undefined,
      } as any,
      externalSettingsHints: {} as any,
      settingsRepository: {
        saveSettings: vi.fn().mockImplementation((s) => s),
      } as any,
      projectManagementRepository: {
        getSelectedProjectId: vi.fn().mockReturnValue("project-1"),
      } as any,
      projectRuntimeRepository: {
        getSelectedProjectStatus: vi.fn().mockReturnValue("runtime-status"),
      } as any,
      connectionChatRepository: {
        listConnections: vi.fn().mockReturnValue([]),
      } as any,
      executionRepository: {
        getProjectExecutionSnapshot: vi.fn().mockReturnValue({
          projectId: "project-1",
          projectName: "Project 1",
          sprintRuns: [],
          taskDispatches: [],
          connections: [],
          recentEvents: [],
          updatedAt: "2026-03-09T00:00:00.000Z",
        }),
      } as any,
      activityCacheService: {
        invalidateGitStatusCache: vi.fn(),
      } as any,
      taskRerunService: {
        rerunTask: vi.fn().mockResolvedValue({ id: "123" }),
      } as any,
      executionControlService: {
        orchestrateSprint: vi.fn().mockResolvedValue({ ok: true }),
        pauseSprintRun: vi.fn().mockResolvedValue({ id: "run-1" }),
        cancelSprintRun: vi.fn().mockResolvedValue({ id: "run-1" }),
        cancelTaskDispatch: vi.fn().mockResolvedValue({ id: "dispatch-1" }),
        retryTaskDispatch: vi.fn().mockResolvedValue({ id: "task-1" }),
      } as any,
      logger: {
        child: vi.fn().mockReturnValue({}),
      } as any,
      getLiveActivitiesForActiveTasks: vi.fn(),
      getGitStatus: vi.fn(),
      isReady: vi.fn(),
      isHealthy: vi.fn(),
      syncGitSettingsFromDashboard: vi.fn(),
      refreshJulesApiKey: vi.fn(),
      setLogger: vi.fn(),
      LIVE_ACTIVITY_CACHE_MS: 500,
    };

    vi.mocked(setupDashboardServer).mockResolvedValue({ port: 3000 } as any);
  });

  describe("reinitializeLogger", () => {
    it("creates logger without logFilePath when enableDebugLogFile is false or undefined", () => {
      mockDeps.runtimeContext.dashboardSettings!.enableDebugLogFile = false;

      reinitializeLogger({
        projectRoot: mockDeps.projectRoot,
        runtimeContext: mockDeps.runtimeContext,
      });

      expect(createLogger).toHaveBeenCalledWith({
        bindings: { service: "sprint-os" },
        logFilePath: undefined,
      });
    });

    it("creates logger with logFilePath when enableDebugLogFile is true", () => {
      mockDeps.runtimeContext.dashboardSettings!.enableDebugLogFile = true;

      reinitializeLogger({
        projectRoot: mockDeps.projectRoot,
        runtimeContext: mockDeps.runtimeContext,
      });

      expect(createLogger).toHaveBeenCalledWith({
        bindings: { service: "sprint-os" },
        logFilePath: path.join("/project-root", ".sprint-os", "debug.log"),
      });
    });
  });

  describe("bootDashboard", () => {
    it("sets dashboardRuntimePort and calls setupDashboardServer with correct arguments", async () => {
      await bootDashboard(mockDeps);

      expect(mockDeps.getDashboardPort).toHaveBeenCalled();
      expect(setupDashboardServer).toHaveBeenCalledWith(
        expect.objectContaining({
          app: mockDeps.app,
          dashboardDir: path.join("/project-root", "dashboard"),
          port: 3000,
          liveActivityCacheMs: 500,
        })
      );
      expect(mockDeps.runtimeContext.dashboardRuntimePort).toBe(3000);
    });

    it("handles saveSettings callback correctly", async () => {
      const mockLogger = {};
      vi.mocked(createLogger).mockReturnValue(mockLogger as any);

      await bootDashboard(mockDeps);

      const setupArgs = vi.mocked(setupDashboardServer).mock.calls[0][0];
      const newSettings = { ...DEFAULT_DASHBOARD_SETTINGS, enableDebugLogFile: true };

      const result = setupArgs.saveSettings(newSettings);

      expect(mockDeps.settingsRepository.saveSettings).toHaveBeenCalledWith(newSettings);
      expect(mockDeps.syncGitSettingsFromDashboard).toHaveBeenCalled();
      expect(mockDeps.refreshJulesApiKey).toHaveBeenCalled();
      expect(createLogger).toHaveBeenCalled(); // via reinitializeLogger
      expect(mockDeps.setLogger).toHaveBeenCalledWith(mockLogger);
      expect(mockDeps.activityCacheService.invalidateGitStatusCache).toHaveBeenCalled();
      expect(result).toEqual(newSettings);
    });

    it("handles rerunTask callback correctly", async () => {
      await bootDashboard(mockDeps);

      const setupArgs = vi.mocked(setupDashboardServer).mock.calls[0][0];

      const result = await setupArgs.rerunTask!("task-1");

      expect(mockDeps.taskRerunService.rerunTask).toHaveBeenCalledWith("task-1");
      expect(mockDeps.activityCacheService.invalidateGitStatusCache).toHaveBeenCalled();
      expect(result).toEqual({ id: "123" });
    });

    it("handles execution control callbacks correctly", async () => {
      await bootDashboard(mockDeps);

      const setupArgs = vi.mocked(setupDashboardServer).mock.calls[0][0];

      await setupArgs.orchestrateSprint!("project-1", "sprint-1");
      await setupArgs.pauseSprintRun!("run-1");
      await setupArgs.cancelSprintRun!("run-1");
      await setupArgs.cancelTaskDispatch!("dispatch-1");
      await setupArgs.retryTaskDispatch!("dispatch-1");

      expect(mockDeps.executionControlService.orchestrateSprint).toHaveBeenCalledWith("project-1", "sprint-1");
      expect(mockDeps.executionControlService.pauseSprintRun).toHaveBeenCalledWith("run-1");
      expect(mockDeps.executionControlService.cancelSprintRun).toHaveBeenCalledWith("run-1");
      expect(mockDeps.executionControlService.cancelTaskDispatch).toHaveBeenCalledWith("dispatch-1");
      expect(mockDeps.executionControlService.retryTaskDispatch).toHaveBeenCalledWith("dispatch-1");
    });

    it("handles other callbacks correctly", async () => {
      mockDeps.connectionChatRepository.listConnections = vi.fn().mockReturnValue([{
        id: "connection-1",
        connectionKey: "worker-1",
        displayName: "Worker 1",
        role: "worker",
        transport: "streamable_http",
        status: "listening",
        capabilities: {
          listenMode: true,
          machineName: "builder-01",
          platform: "linux",
          arch: "x64",
          localExecutionRuntime: "worker_host",
        },
        lastHeartbeatAt: "2026-03-09T00:00:00.000Z",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-09T00:00:00.000Z",
        projectIds: ["project-1"],
        activeProjectIds: ["project-1"],
        tasksRunCount: 2,
        threadCount: 1,
        messageCount: 3,
        pendingInboxCount: 0,
        activeDispatchCount: 1,
      }]);

      await bootDashboard(mockDeps);
      const setupArgs = vi.mocked(setupDashboardServer).mock.calls[0][0];

      setupArgs.getStatus();
      expect(mockDeps.projectRuntimeRepository.getSelectedProjectStatus).toHaveBeenCalled();
      expect(setupArgs.getExecutionSnapshot()).toMatchObject({ projectId: "project-1" });
      expect(mockDeps.executionRepository.getProjectExecutionSnapshot).toHaveBeenCalledWith("project-1");
      expect(setupArgs.getExecutionSnapshot().connections[0]).toMatchObject({
        machineName: "builder-01",
        platform: "linux",
        arch: "x64",
        localExecutionRuntime: "worker_host",
      });

      expect(setupArgs.getLiveActivities).toBe(mockDeps.getLiveActivitiesForActiveTasks);
      expect(setupArgs.getGitStatus).toBe(mockDeps.getGitStatus);

      expect(setupArgs.getExternalSettingsHints()).toBe(mockDeps.externalSettingsHints);

      mockDeps.runtimeContext.dashboardSettings = undefined;
      expect(setupArgs.getSettings()).toEqual(DEFAULT_DASHBOARD_SETTINGS);

      mockDeps.runtimeContext.dashboardSettings = { someSetting: "value" } as any;
      expect(setupArgs.getSettings()).toEqual({ someSetting: "value" });

      expect(setupArgs.isReady).toBe(mockDeps.isReady);
      expect(setupArgs.isHealthy).toBe(mockDeps.isHealthy);
    });
  });
});
