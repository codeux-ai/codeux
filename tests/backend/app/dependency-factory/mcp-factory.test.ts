import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMcpDependencies } from "../../../../src/app/dependency-factory/mcp-factory.js";
import { ServerContext } from "../../../../src/app/dependency-factory.js";
import { CoreDependencies } from "../../../../src/app/dependency-factory/core-factory.js";
import { SprintDependencies } from "../../../../src/app/dependency-factory/sprint-factory.js";
import { ManagementToolHandler } from "../../../../src/mcp/management-tool-handler.js";

vi.mock("../../../../src/mcp/management-tool-handler.js", () => {
  const ManagementToolHandler = vi.fn();
  return { ManagementToolHandler };
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
        dashboardSettings: { testSetting: true },
      },
      normalizeName: vi.fn(),
      resolveSessionName: vi.fn(),
      fetchRecentActivities: vi.fn(),
      isJulesApiConfigured: vi.fn(),
      getMissingJulesApiKeyInstruction: vi.fn(),
      isTrackedCliSession: vi.fn(),
    };

    mockCoreDeps = {
      logger: { child: vi.fn().mockReturnValue({}) },
      executionRepository: {},
      projectManagementRepository: { getProject: vi.fn() },
      agentPresetSyncService: {},
      sprintPreviewService: {},
      settingsRepository: { getDefaultDashboardSettings: vi.fn() },
      memoryService: {},
      memoryPromotionService: {},
      embeddingModelManager: {},
      sprintIssueService: {},
    };

    mockSprintDeps = {
      sprintOrchestrator: {},
      taskService: {},
      workerInboxReplyService: {},
    };

    mockDashboardDeps = {
      executionControlService: {},
      taskRerunService: {},
      planningAgentService: {},
      projectSetupService: {},
    };
  });

  it("creates the management tool handler", () => {
    const result = createMcpDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies,
      mockDashboardDeps as any
    );

    expect(result.managementToolHandler).toBeDefined();
    expect(ManagementToolHandler).toHaveBeenCalledTimes(1);

    const managementArgs = vi.mocked(ManagementToolHandler).mock.calls[0][0];
    expect(typeof managementArgs.getDashboardSettings).toBe("function");
    expect(managementArgs.settingsRepository).toBe(mockCoreDeps.settingsRepository);
    expect(managementArgs.executionControlService).toBe(mockDashboardDeps.executionControlService);
  });

  it("no longer exposes the removed listening handlers", () => {
    const result = createMcpDependencies(
      mockContext as unknown as ServerContext,
      mockCoreDeps as unknown as CoreDependencies,
      mockSprintDeps as unknown as SprintDependencies,
      mockDashboardDeps as any
    );

    expect((result as Record<string, unknown>).coreToolHandler).toBeUndefined();
    expect((result as Record<string, unknown>).agentToolHandler).toBeUndefined();
  });
});
