import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMcpDependencies } from "../../../../src/app/dependency-factory/mcp-factory.js";
import { ServerContext } from "../../../../src/app/dependency-factory.js";
import { CoreDependencies } from "../../../../src/app/dependency-factory/core-factory.js";
import { SprintDependencies } from "../../../../src/app/dependency-factory/sprint-factory.js";
import { ManagementToolHandler } from "../../../../src/mcp/management-tool-handler.js";
import { WorkerClarificationContinuationService } from "../../../../src/services/worker-clarification-continuation-service.js";

vi.mock("../../../../src/mcp/management-tool-handler.js", () => {
  const ManagementToolHandler = vi.fn();
  return { ManagementToolHandler };
});

vi.mock("../../../../src/services/worker-clarification-continuation-service.js", () => {
  const WorkerClarificationContinuationService = vi.fn();
  return { WorkerClarificationContinuationService };
});

vi.mock("../../../../src/domain/sprint/branch-name-generator.js", async (importOriginal) => {
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
        dashboardSettings: {
          agents: {
            routing: {
              taskCoding: { mode: "AUTO", agentPresetId: null },
            },
          },
        },
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
      projectAttentionRepository: {},
      agentPresetRepository: { getAgentPreset: vi.fn() },
      julesApi: { sendSessionMessage: vi.fn() },
      agentPresetSyncService: {},
      sprintPreviewService: {},
      settingsRepository: { getDefaultDashboardSettings: vi.fn() },
      memoryService: {},
      memoryPromotionService: {},
      embeddingModelManager: {},
      sprintIssueService: {},
      chatProviderRepository: { id: "chat-provider-repository" },
      chatProviderSecretService: { id: "chat-provider-secret-service" },
      chatProviderVerificationService: { id: "chat-provider-verification-service" },
      chatConnectorRegistry: { id: "chat-connector-registry" },
      headlessAuthService: { configuration: { mode: "local", remoteCredentialManagement: false } },
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
      quicksprintService: {},
      schedulerService: {},
      chatProviderOutboundService: { id: "chat-provider-outbound-service" },
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
    expect(managementArgs.quicksprintService).toBe(mockDashboardDeps.quicksprintService);
    expect(managementArgs.schedulerService).toBe(mockDashboardDeps.schedulerService);
    expect(managementArgs.workerClarificationContinuationService).toBeDefined();
    expect(managementArgs.chatProviderRepository).toBe(mockCoreDeps.chatProviderRepository);
    expect(managementArgs.chatProviderSecretService).toBe(mockCoreDeps.chatProviderSecretService);
    expect(managementArgs.chatProviderVerificationService).toBe(mockCoreDeps.chatProviderVerificationService);
    expect(managementArgs.chatProviderOutboundService).toBe(mockDashboardDeps.chatProviderOutboundService);
    expect(managementArgs.chatConnectorRegistry).toBe(mockCoreDeps.chatConnectorRegistry);

    const continuationArgs = vi.mocked(WorkerClarificationContinuationService).mock.calls[0][0];
    expect(continuationArgs.clarificationService).toBe(managementArgs.workerClarificationService);
    expect(continuationArgs.taskRerunService).toBe(mockDashboardDeps.taskRerunService);
    expect(continuationArgs.executionRepository).toBe(mockCoreDeps.executionRepository);
    expect(continuationArgs.projectManagementRepository).toBe(mockCoreDeps.projectManagementRepository);
    expect(typeof continuationArgs.sendJulesSessionMessage).toBe("function");
    expect(typeof continuationArgs.isAuthorizedProjectManager).toBe("function");
    expect(typeof continuationArgs.resolveProviderConfigId).toBe("function");
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
