import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMcpDependencies } from "../../../../src/app/dependency-factory/mcp-factory.js";
import { ServerContext } from "../../../../src/app/dependency-factory.js";
import { CoreDependencies } from "../../../../src/app/dependency-factory/core-factory.js";
import { SprintDependencies } from "../../../../src/app/dependency-factory/sprint-factory.js";
import { CoreToolHandler } from "../../../../src/mcp/core-tool-handler.js";
import { AgentToolHandler } from "../../../../src/mcp/agent-tool-handler.js";

vi.mock("../../../../src/mcp/core-tool-handler.js", () => {
  const CoreToolHandler = vi.fn();
  return { CoreToolHandler };
});

vi.mock("../../../../src/mcp/agent-tool-handler.js", () => {
  const AgentToolHandler = vi.fn();
  return { AgentToolHandler };
});

vi.mock("../../../../src/git/sprint-branch-scheme.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    formatSprintBranch: vi.fn(),
  };
});

describe("MCP Factory", () => {
  let mockContext: any;
  let mockCoreDeps: any;
  let mockSprintDeps: any;
  let mockDashboardDeps: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      runtimeContext: {
        consecutiveFailures: 2,
        settings: { maxFailures: 5 },
        dashboardSettings: { testSetting: true },
      },
      normalizeName: vi.fn(),
      resolveSessionName: vi.fn(),
      fetchRecentActivities: vi.fn(),
      isActionRequiredState: vi.fn(),
      isJulesApiConfigured: vi.fn(),
      getMissingJulesApiKeyInstruction: vi.fn(),
      isTrackedCliSession: vi.fn(),
    };

    mockCoreDeps = {
      logger: {
        child: vi.fn().mockReturnValue({}),
      },
      julesApi: {},
      activitySummary: {},
      connectionChatRepository: {
        getConnectionByKey: vi.fn(),
        touchConnectionHeartbeat: vi.fn(),
      },
      workerEndpointRepository: {
        getWorkerEndpointByConnectionId: vi.fn(),
      },
      projectWorkerAssignmentService: {
        noteWorkerActivity: vi.fn(),
      },
      projectAttentionService: {
        openItem: vi.fn(),
        resolveItemsForDispatch: vi.fn(),
      },
      projectWorkerAssignmentRepository: {},
      projectAttentionRepository: {},
      executionRepository: {},
      projectManagementRepository: {},
      agentPresetSyncService: {},
      sessionTracking: {
        getSession: vi.fn(),
        listSessions: vi.fn(),
        listActivities: vi.fn(),
        listAllActivities: vi.fn(),
      },
    };

    mockSprintDeps = {
      sprintOrchestrator: {},
      taskService: {},
      workerInboxReplyService: {},
    };

    mockDashboardDeps = {
      executionControlService: {},
      taskRerunService: {},
    };
  });

  it("should create mcp dependencies and wire them correctly", () => {
    const result = createMcpDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies,
      mockDashboardDeps as any
    );

    expect(result.coreToolHandler).toBeDefined();
    expect(result.agentToolHandler).toBeDefined();

    expect(CoreToolHandler).toHaveBeenCalledTimes(1);
    expect(AgentToolHandler).toHaveBeenCalledTimes(1);

    // Get the arguments passed to CoreToolHandler constructor
    const coreArgs = vi.mocked(CoreToolHandler).mock.calls[0][0];

    coreArgs.normalizeName("type", "id");
    expect(mockContext.normalizeName).toHaveBeenCalledWith("type", "id");

    coreArgs.resolveSessionName("session1");
    expect(mockContext.resolveSessionName).toHaveBeenCalledWith("session1");

    coreArgs.fetchRecentActivities("session1", 10);
    expect(mockContext.fetchRecentActivities).toHaveBeenCalledWith("session1", 10);

    coreArgs.isJulesApiConfigured();
    expect(mockContext.isJulesApiConfigured).toHaveBeenCalled();

    coreArgs.getMissingJulesApiKeyInstruction();
    expect(mockContext.getMissingJulesApiKeyInstruction).toHaveBeenCalled();

    // test isTrackedCliSession format
    coreArgs.isTrackedCliSession("123");
    expect(mockContext.isTrackedCliSession).toHaveBeenCalledWith("sessions/123");
    coreArgs.isTrackedCliSession("sessions/456");
    expect(mockContext.isTrackedCliSession).toHaveBeenCalledWith("sessions/456");

    coreArgs.getTrackedSession("s1");
    expect(mockCoreDeps.sessionTracking.getSession).toHaveBeenCalledWith("s1");

    // Get the arguments passed to AgentToolHandler constructor
    const agentArgs = vi.mocked(AgentToolHandler).mock.calls[0][0];

    expect(agentArgs.workerInboxReplyService).toBeDefined();
  });

  it("handles missing dashboardSettings and maxFailures", () => {
    mockContext.runtimeContext.settings = {};
    mockContext.runtimeContext.dashboardSettings = undefined;

    createMcpDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies,
      mockDashboardDeps as any
    );

    const agentArgs = vi.mocked(AgentToolHandler).mock.calls[0][0];
    expect(agentArgs.workerInboxReplyService).toBeDefined();
  });
});
