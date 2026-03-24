import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSprintDependencies } from "../../../../src/app/dependency-factory/sprint-factory.js";
import { ServerContext } from "../../../../src/app/dependency-factory.js";
import { CoreDependencies } from "../../../../src/app/dependency-factory/core-factory.js";
import { CliWorkflowService } from "../../../../src/services/cli-workflow-service.js";
import { SprintExecutionStateService } from "../../../../src/services/sprint-execution-state-service.js";
import { SprintTaskDispatchService } from "../../../../src/services/sprint-task-dispatch-service.js";
import { TaskService } from "../../../../src/services/task-service.js";
import { VirtualWorkerService } from "../../../../src/services/virtual-worker-service.js";
import { SprintOrchestrator } from "../../../../src/sprint/sprint-orchestrator.js";

vi.mock("../../../../src/services/cli-workflow-service.js", () => {
  const CliWorkflowService = vi.fn();
  return { CliWorkflowService };
});

vi.mock("../../../../src/services/task-service.js", () => {
  const TaskService = vi.fn();
  TaskService.prototype.startSprintTask = vi.fn();
  TaskService.prototype.selectProviderForTask = vi.fn();
  return { TaskService };
});

vi.mock("../../../../src/services/sprint-execution-state-service.js", () => {
  const SprintExecutionStateService = vi.fn();
  return { SprintExecutionStateService };
});

vi.mock("../../../../src/services/sprint-task-dispatch-service.js", () => {
  const SprintTaskDispatchService = vi.fn();
  SprintTaskDispatchService.prototype.startTask = vi.fn();
  return { SprintTaskDispatchService };
});

vi.mock("../../../../src/services/virtual-worker-service.js", () => {
  const VirtualWorkerService = vi.fn();
  VirtualWorkerService.prototype.scheduleProject = vi.fn();
  return { VirtualWorkerService };
});

vi.mock("../../../../src/sprint/sprint-orchestrator.js", () => {
  const SprintOrchestrator = vi.fn();
  return { SprintOrchestrator };
});

describe("Sprint Factory", () => {
  let mockOptions: any;
  let mockContext: any;
  let mockCoreDeps: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOptions = {
      projectRoot: "/project",
      appConfig: { dashboardPort: 3000 },
    };

    mockContext = {
      runtimeContext: {
        settings: {},
        dashboardSettings: { setting1: true },
        consecutiveFailures: 1,
      },
      getEffectiveGithubToken: vi.fn(),
      isJulesApiConfigured: vi.fn(),
      getDashboardPort: vi.fn().mockReturnValue(3001),
      isActionRequiredState: vi.fn(),
      resolveSessionName: vi.fn(),
      extractSessionId: vi.fn(),
      fetchRecentActivities: vi.fn(),
      listSessionsForSync: vi.fn(),
      getCiStatusForScope: vi.fn(),
      autoMergeFeaturePr: vi.fn(),
      resolveOrCreateMainBranchPr: vi.fn(),
    };

    mockCoreDeps = {
      logger: {
        child: vi.fn().mockReturnValue({}),
      },
      julesApi: {
        approveSessionPlan: vi.fn(),
        sendSessionMessage: vi.fn(),
      },
      sessionTracking: {},
      julesSourceResolver: {
        resolveSourceId: vi.fn(),
      },
      agentPresetSyncService: {},
      instructionService: {
        render: vi.fn(),
      },
      projectRuntimeRepository: {
        syncDashboardStatus: vi.fn(),
      },
      projectManagementRepository: {},
      executionRepository: {},
      projectAttentionService: {
        setWorkerAttentionOpenedCallback: vi.fn(),
      },
      settingsRepository: {
        resolveProjectDashboardSettings: vi.fn().mockReturnValue({
          settings: { workers: { executionMode: "VIRTUAL" } },
          sources: {},
        }),
        resolveSprintDashboardSettings: vi.fn().mockReturnValue({
          settings: { workers: { executionMode: "VIRTUAL" } },
          sources: {},
        }),
      },
      workerEndpointRepository: {},
      projectWorkerAssignmentRepository: {},
      projectWorkerAssignmentService: {},
      connectionChatRepository: {},
      activeDispatchRegistry: {},
    };
  });

  it("should create sprint dependencies and wire them correctly", () => {
    const result = createSprintDependencies(
      mockOptions,
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies
    );

    expect(result.cliWorkflowService).toBeDefined();
    expect(result.taskService).toBeDefined();
    expect(result.sprintOrchestrator).toBeDefined();

    expect(CliWorkflowService).toHaveBeenCalledTimes(1);
    expect(TaskService).toHaveBeenCalledTimes(1);
    expect(SprintExecutionStateService).toHaveBeenCalledTimes(1);
    expect(SprintTaskDispatchService).toHaveBeenCalledTimes(1);
    expect(VirtualWorkerService).toHaveBeenCalledTimes(1);
    expect(SprintOrchestrator).toHaveBeenCalledTimes(1);

    // Get the arguments passed to CliWorkflowService constructor
    const cliArgs = vi.mocked(CliWorkflowService).mock.calls[0][0];

    expect(cliArgs.getDashboardSettings()).toEqual({ setting1: true });
    expect(cliArgs.getDashboardSettings({ projectId: "project-1" })).toEqual({ workers: { executionMode: "VIRTUAL" } });
    expect(cliArgs.getDashboardSettings({ projectId: "project-1", sprintId: "sprint-1" })).toEqual({ workers: { executionMode: "VIRTUAL" } });

    expect(cliArgs.agentPresetSyncService).toBe(mockCoreDeps.agentPresetSyncService);

    cliArgs.getGithubToken();
    expect(mockContext.getEffectiveGithubToken).toHaveBeenCalled();

    // Get the arguments passed to TaskService constructor
    const taskArgs = vi.mocked(TaskService).mock.calls[0][0];

    expect(taskArgs.agentPresetSyncService).toBe(mockCoreDeps.agentPresetSyncService);

    taskArgs.resolveJulesSourceId({ repoPath: "path1", sourceId: "id1" });
    expect(mockCoreDeps.julesSourceResolver.resolveSourceId).toHaveBeenCalledWith({
      repoPath: "path1",
      requestedSourceId: "id1",
    });

    expect(taskArgs.getDashboardSettings()).toEqual({ setting1: true });
    expect(taskArgs.getDashboardSettings({ projectId: "project-1" })).toEqual({ workers: { executionMode: "VIRTUAL" } });
    expect(taskArgs.getDashboardSettings({ projectId: "project-1", sprintId: "sprint-1" })).toEqual({ workers: { executionMode: "VIRTUAL" } });

    taskArgs.isJulesApiConfigured();
    expect(mockContext.isJulesApiConfigured).toHaveBeenCalled();

    // Get the arguments passed to SprintOrchestrator constructor
    const sprintArgs = vi.mocked(SprintOrchestrator).mock.calls[0][0];

    expect(sprintArgs.getDashboardPort()).toBe(3001);
    expect(sprintArgs.getConsecutiveFailures()).toBe(1);

    sprintArgs.setConsecutiveFailures(2);
    expect(mockContext.runtimeContext.consecutiveFailures).toBe(2);

    sprintArgs.isActionRequiredState("state1");
    expect(mockContext.isActionRequiredState).toHaveBeenCalledWith("state1");

    sprintArgs.resolveSessionName("session1");
    expect(mockContext.resolveSessionName).toHaveBeenCalledWith("session1");

    sprintArgs.extractSessionId("session2");
    expect(mockContext.extractSessionId).toHaveBeenCalledWith("session2");

    sprintArgs.fetchRecentActivities("session1", 10);
    expect(mockContext.fetchRecentActivities).toHaveBeenCalledWith("session1", 10);

    sprintArgs.listSessions();
    expect(mockContext.listSessionsForSync).toHaveBeenCalled();

    sprintArgs.startTask("task1", { projectId: "p1", sprintId: "s1", sprintRunId: "r1", sourceId: "source1", featureBranch: "branch1", repoPath: "repo1", sprintNumber: 1 });
    const dispatchServiceInstance = (SprintTaskDispatchService as any).mock.instances[0];
    expect(dispatchServiceInstance.startTask).toHaveBeenCalledWith({
      task: "task1",
      projectId: "p1",
      sprintId: "s1",
      sprintRunId: "r1",
      sourceId: "source1",
      featureBranch: "branch1",
      repoPath: "repo1",
      sprintNumber: 1,
    });

    sprintArgs.updateLastStatus({ test: 1 });
    expect(mockCoreDeps.projectRuntimeRepository.syncDashboardStatus).toHaveBeenCalledWith({ test: 1 });
    expect(mockContext.runtimeContext.lastStatus).toEqual({ test: 1 });

    expect(sprintArgs.getDashboardSettings()).toEqual({ setting1: true });
    expect(sprintArgs.getDashboardSettings({ projectId: "project-1" })).toEqual({ workers: { executionMode: "VIRTUAL" } });
    expect(sprintArgs.getDashboardSettings({ projectId: "project-1", sprintId: "sprint-1" })).toEqual({ workers: { executionMode: "VIRTUAL" } });

    sprintArgs.isJulesApiConfigured();
    expect(mockContext.isJulesApiConfigured).toHaveBeenCalledTimes(2); // once from taskService

    sprintArgs.approveSessionPlan("session1");
    expect(mockCoreDeps.julesApi.approveSessionPlan).toHaveBeenCalledWith("session1");

    sprintArgs.sendSessionMessage("session1", "message1");
    expect(mockCoreDeps.julesApi.sendSessionMessage).toHaveBeenCalledWith("session1", "message1");

    sprintArgs.getCiStatusForScope({ arg: 1 });
    expect(mockContext.getCiStatusForScope).toHaveBeenCalledWith({ arg: 1 });

    sprintArgs.autoMergeFeaturePr({ arg: 2 });
    expect(mockContext.autoMergeFeaturePr).toHaveBeenCalledWith({ arg: 2 });

    sprintArgs.resolveOrCreateMainBranchPr({ arg: 3 });
    expect(mockContext.resolveOrCreateMainBranchPr).toHaveBeenCalledWith({ arg: 3 });

    sprintArgs.renderInstruction("template1", { var: 1 }, "repo1");
    expect(mockCoreDeps.instructionService.render).toHaveBeenCalledWith("template1", { var: 1 }, "repo1");
    expect(mockCoreDeps.projectAttentionService.setWorkerAttentionOpenedCallback).toHaveBeenCalledTimes(1);
  });

  it("handles missing dashboardSettings", () => {
    mockContext.runtimeContext.dashboardSettings = undefined;

    createSprintDependencies(
      mockOptions,
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies
    );

    const cliArgs = vi.mocked(CliWorkflowService).mock.calls[0][0];
    expect(cliArgs.getDashboardSettings()).toBeDefined();

    const taskArgs = vi.mocked(TaskService).mock.calls[0][0];
    expect(taskArgs.getDashboardSettings()).toBeDefined();

    const sprintArgs = vi.mocked(SprintOrchestrator).mock.calls[0][0];
    expect(sprintArgs.getDashboardSettings()).toBeDefined();
  });
});
