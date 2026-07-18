import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import axios from "axios";
import type { AxiosError } from "axios";
import express from "express";
import type { Server as HttpServer } from "node:http";
import { regenerateUserMcpHttpAuthToken, type AppConfig } from "../config/app-config.js";
import { JulesApiClient } from "../integrations/jules-api-client.js";
import type {
  DashboardSettings,
  ExternalSettingsHints,
  GitTrackingStatus,
  JulesActivity,
  JulesSession,
  Settings,
  Subtask,
  DashboardStatus,
  GetCiStatusForScopeArgs,
  AutoMergeFeaturePrArgs,
  AutoMergeFeaturePrResult,
  PersistTaskMergedFlagArgs,
  ReadinessProbeStatus,
} from "../contracts/app-types.js";
import { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import { SubtaskFileRepository } from "../infrastructure/repositories/subtask-file-repository.js";
import { TaskService } from "../services/task-service.js";
import { SettingsRepository } from "../repositories/settings-repository.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { ProjectRuntimeRepository } from "../repositories/project-runtime-repository.js";
import { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import { ChatProviderRepository } from "../repositories/chat-provider-repository.js";
import type { ChatProviderSecretService } from "../services/chat-provider-secret-service.js";
import type { ChatProviderVerificationService } from "../services/chat-provider-verification-service.js";
import type { ChatConnectorRegistry } from "../domain/chat-connectors/registry.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import { QaReviewRepository } from "../repositories/qa-review-repository.js";
import { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import { GitStatusService, type GitTrackingRequest } from "../services/git-status-service.js";
import { defaultRunner } from "../infrastructure/git/git-status-query-client.js";
import type { GitHostTokens } from "../infrastructure/git/repository-host-resolver.js";
import { loadExternalSettingsHints } from "../config/external-settings.js";
import { InstructionService } from "../instructions/instruction-template-service.js";
import { buildMissingJulesApiKeyMessage } from "../mcp/api-key-guidance.js";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import { DockerService } from "../services/docker-service.js";
import { CliWorkflowService } from "../services/cli-workflow-service.js";
import { ActivityCacheService } from "./activity-cache-service.js";
import { registerMcpRequestHandlers } from "./mcp-request-router.js";
import { getCurrentMcpExecutionInvocationId } from "./mcp-agent-context.js";
import { TaskRerunService } from "../services/task-rerun-service.js";
import { ExecutionControlService } from "../services/execution-control-service.js";
import {
  automaticClarificationReplyAgentMcpAccess,
  dashboardReplyAgentMcpAccess,
  isAutomaticClarificationReplyInvocation,
  isInvocationScopedWorkerClarificationAgent,
  isProjectManagerClarificationAgent,
  isWorkerClarificationAgent,
  toAgentCodeUxToolAccess,
  withAttachedFlowAccess,
  withClarificationAudienceAccess,
} from "../services/agent-mcp-access.js";
import { JulesSourceResolver } from "../services/jules-source-resolver.js";
import { RuntimeCleanupService } from "../services/runtime-cleanup-service.js";
import { RuntimeStartupRecoveryService } from "../services/runtime-startup-recovery-service.js";
import type { GuardrailService } from "../services/guardrail-service.js";
import { DockerAssetPruneService } from "../services/docker-asset-prune-service.js";
import { BranchReaperService } from "../services/branch-reaper-service.js";
import { DatabaseMaintenanceService } from "../services/database-maintenance-service.js";
import { DashboardRealtimeService } from "../services/dashboard-realtime-service.js";
import { AgentPresetSyncService } from "../services/agent-preset-sync-service.js";
import { PlanningAgentService } from "../services/planning-agent-service.js";
import type { AgentBaseUpdateService } from "../services/agent-base-update-service.js";
import { ExecutionInvocationControlService } from "../services/execution-invocation-control-service.js";
import { createRuntimeDependencies, ServerContext } from "../app/dependency-factory.js";
import { generateCorrelationId, runWithCorrelationId } from "../shared/logging/correlation-id.js";
import { createLogger, type Logger } from "../shared/logging/logger.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../repositories/settings-defaults.js";
import { AppDbStorage } from "../repositories/app-db-storage.js";
import { ProjectWorkerAssignmentRepository } from "../repositories/project-worker-assignment-repository.js";
import { ProjectAttentionRepository } from "../repositories/project-attention-repository.js";
import type { ProjectAttentionItemRecord } from "../contracts/project-attention-types.js";
import { DefaultRuntimeContext, RuntimeContext } from "../app/runtime-context.js";
import { bootSettings, syncGitSettingsFromDashboard } from "../app/lifecycle/settings-lifecycle-service.js";
import { bootDashboard } from "../app/lifecycle/dashboard-lifecycle-service.js";
import { bootMcpHttpTransport, bootMcpTransport, type McpHttpTransportHandle } from "../app/lifecycle/mcp-lifecycle-service.js";
import type { DashboardServerHandle } from "./dashboard-server.js";
import { McpApprovalTracker } from "../services/mcp-approval-tracker.js";
import { getCodeUxSubtasksDir, CODE_UX_SERVICE_NAME, CODE_UX_VERSION } from "../shared/config/code-ux-paths.js";
import { SprintMarkdownService } from "../services/sprint-markdown-service.js";
import type { SprintIssueService } from "../services/sprint-issue-service.js";
import { VirtualWorkerService } from "../services/virtual-worker-service.js";
import type { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import type { ProjectWorkerAssignmentService } from "../domain/workers/project-worker-assignment-service.js";
import { SprintPreviewRepository } from "../repositories/sprint-preview-repository.js";
import { SprintPreviewService } from "../services/sprint-preview-service.js";
import { SprintFileBrowserService } from "../services/sprint-file-browser-service.js";
import { SprintBranchService } from "../services/sprint-branch-service.js";
import { resolveEffectiveDashboardSettings } from "../services/settings-resolution-service.js";
import { ActiveDispatchRegistry } from "../services/active-dispatch-registry.js";
import { ShutdownContainerService } from "../services/shutdown-container-service.js";
import { beginRuntimeShutdown } from "../services/shutdown-state.js";
import {
  acquireRuntimeProcessLock,
  type RuntimeProcessLockRelease,
} from "../services/runtime-process-lock.js";
import { workspaceVolumeHelperPool } from "../infrastructure/providers/cli/workspace-volume-helper.js";
import {
  disposeCommandSpawner,
  setSelectedProjectGitHelper,
  shutdownGitHelperPool,
} from "../shared/subprocess/command-runner.js";
import { LocalMcpCliConfigService } from "../services/local-mcp-cli-config-service.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { ChatProviderIngressService } from "../services/chat-provider-ingress-service.js";
import type { HeadlessAuthService } from "../services/headless-auth-service.js";
import type { AutomationAuditExportService } from "../services/automation-audit-export-service.js";
import type { HeadlessOperationalReadinessService } from "../services/headless-operational-readiness-service.js";
import type { AutomationSloService } from "../services/automation-slo-service.js";
import type { CredentialBroker } from "../services/credentials/credential-broker.js";
import { ProjectInitializationStateService } from "../services/project-initialization-state-service.js";

function detectMergeConflictMessage(message: string | null | undefined): boolean {
  const normalized = String(message || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.includes("merge conflict")
    || normalized.includes("not mergeable")
    || normalized.includes("cannot be cleanly created")
    || normalized.includes("dirty");
}

function normalizeBranchName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readAttentionPayloadRecord(item: ProjectAttentionItemRecord): Record<string, unknown> | null {
  return item.payload && typeof item.payload === "object" && !Array.isArray(item.payload)
    ? item.payload
    : null;
}

export interface CodeUxServerOptions {
  projectRoot: string;
  appConfig: AppConfig;
}

export class CodeUxServer {
  private static readonly DASHBOARD_ACTIVITY_PAGE_SIZE = 20;
  private static readonly LIVE_ACTIVITY_CACHE_MS = 10_000;
  private static readonly GIT_STATUS_CACHE_MS = 10_000;
  private static readonly RUNTIME_CLEANUP_INTERVAL_MS = 15_000;
  private static readonly LIVE_SNAPSHOT_REFRESH_INTERVAL_MS = 30_000;
  private static readonly WAL_CHECKPOINT_INTERVAL_MS = 60_000;
  private static readonly LOOP_INITIAL_DELAY_MS = 15_000;
  private static readonly STARTUP_RECOVERY_DELAY_MS = 1_000;
  private static readonly STARTUP_CONTAINER_CLEANUP_DELAY_MS = 0;
  private static readonly STARTUP_MAINTENANCE_DELAY_MS = 30_000;
  private static readonly SHUTDOWN_CLOSE_TIMEOUT_MS = 5_000;
  private static readonly SHUTDOWN_SIGNAL_TIMEOUT_MS = 30_000;
  private static readonly shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  private static readonly activeSignalHandlers = new Map<NodeJS.Signals, () => void>();
  private readonly projectRoot: string;
  private readonly appConfig: AppConfig;
  private server: Server;
  private logger: Logger;
  private julesApi: JulesApiClient;
  private completedSprints: Set<number> = new Set();
  private runtimeContext: RuntimeContext = new DefaultRuntimeContext();
  private app = express();
  private subtaskRepository: SubtaskFileRepository;
  private taskService: TaskService;
  private julesSourceResolver: JulesSourceResolver;
  private sprintOrchestrator: SprintOrchestrator;
  private appDbStorage: AppDbStorage;
  private settingsRepository: SettingsRepository;
  private projectManagementRepository: ProjectManagementRepository;
  private projectInitializationStateService: ProjectInitializationStateService;
  private projectRuntimeRepository: ProjectRuntimeRepository;
  private connectionChatRepository: ConnectionChatRepository;
  private chatProviderRepository: ChatProviderRepository;
  private chatProviderSecretService: ChatProviderSecretService;
  private chatProviderVerificationService: ChatProviderVerificationService;
  private chatConnectorRegistry: ChatConnectorRegistry;
  private projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  private projectWorkerAssignmentService: ProjectWorkerAssignmentService;
  private projectAttentionRepository: ProjectAttentionRepository;
  private projectAttentionService: ProjectAttentionService;
  private qaReviewRepository: QaReviewRepository;
  private agentPresetRepository: AgentPresetRepository;
  private dockerService: DockerService;
  private managementToolHandler: import("../mcp/management-tool-handler.js").ManagementToolHandler;
  private workerClarificationCoordinatorService: import("../services/worker-clarification-coordinator-service.js").WorkerClarificationCoordinatorService;
  private sprintPreviewRepository: SprintPreviewRepository;
  private sprintPreviewService: SprintPreviewService;
  private sprintFileBrowserService: SprintFileBrowserService;
  private sprintBranchService: SprintBranchService;
  private customDashboardRepository: import("../repositories/custom-dashboard-repository.js").CustomDashboardRepository;
  private customDashboardCredentialBindingService: import("../services/custom-dashboard-credential-binding-service.js").CustomDashboardCredentialBindingService;
  private customDashboardValidationService: import("../services/custom-dashboard-validation-service.js").CustomDashboardValidationService;
  private agentPresetSyncService: AgentPresetSyncService;
  private executionRepository: ExecutionRepository;
  private guardrailService: GuardrailService;
  private sprintMarkdownService: SprintMarkdownService;
  private sprintIssueService: SprintIssueService;
  private virtualWorkerService: VirtualWorkerService;
  private externalSettingsHints: ExternalSettingsHints;
  private instructionService: InstructionService;
  private sessionTracking: SessionTrackingRepository;
  private cliWorkflowService: CliWorkflowService;
  private activityCacheService: ActivityCacheService;
  private taskRerunService: TaskRerunService;
  private executionControlService: ExecutionControlService;
  private executionInvocationControlService: ExecutionInvocationControlService;
  private activeDispatchRegistry: ActiveDispatchRegistry;
  private shutdownContainerService: ShutdownContainerService;
  private planningAgentService: PlanningAgentService;
  private agentBaseUpdateService: AgentBaseUpdateService;
  private quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;
  private projectSetupService: import("../services/project-setup-service.js").ProjectSetupService;
  private schedulerService: import("../services/scheduler-service.js").SchedulerService;
  private sprintRollbackService: import("../services/sprint-rollback-service.js").SprintRollbackService;
  private nodeFlowService: import("../services/node-flow-service.js").NodeFlowService;
  private chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;
  private chatProviderIngressService: ChatProviderIngressService;
  private chatProviderOutboundService: import("../services/chat-provider-outbound-service.js").ChatProviderOutboundService;
  private chatProviderSessionRuntimeService: import("../services/chat-provider-session-runtime-service.js").ChatProviderSessionRuntimeService;
  private speechTranscriptionService: import("../services/speech-transcription-service.js").SpeechTranscriptionService;
  private speechSynthesisService: import("../services/speech-synthesis-service.js").SpeechSynthesisService;
  private speechModelManager: import("../services/speech-model-manager.js").SpeechModelManager;
  private runtimeCleanupService: RuntimeCleanupService;
  private runtimeStartupRecoveryService: RuntimeStartupRecoveryService;
  private dashboardRealtimeService: DashboardRealtimeService;
  private memoryService: import("../services/memory-service.js").MemoryService;
  private memoryPromotionService: import("../services/memory-promotion-service.js").MemoryPromotionService;
  private embeddingModelManager: import("../services/embedding-model-manager.js").EmbeddingModelManager;
  private embeddingService: import("../services/embedding-service.js").EmbeddingService;
  private memoryRepository: import("../repositories/memory-repository.js").MemoryRepository;
  private knowledgeService: import("../services/knowledge-service.js").KnowledgeService;
  private skillService: import("../services/skill-service.js").SkillService;
  private runtimeCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private sprintPreviewInterval: ReturnType<typeof setInterval> | null = null;
  private sprintPreviewReconcileInFlight = false;
  private liveSnapshotInterval: ReturnType<typeof setInterval> | null = null;
  private walCheckpointInterval: ReturnType<typeof setInterval> | null = null;
  private readonly startupTaskTimers = new Set<ReturnType<typeof setTimeout>>();
  private startupContainerCleanupPromise: Promise<void> | null = null;
  private mcpHttpHandle: McpHttpTransportHandle | null = null;
  private dashboardHandle: DashboardServerHandle | null = null;
  private mcpServiceBound = false;
  private startupRecoveryCompleted = false;
  private isClosing = false;
  private closePromise: Promise<void> | null = null;
  private readonly mcpApprovalTracker = new McpApprovalTracker();
  private readonly localMcpCliConfigService = new LocalMcpCliConfigService();
  private readonly headlessAuthService: HeadlessAuthService;
  private readonly credentialBroker: CredentialBroker;
  private readonly automationAuditService: AutomationAuditExportService;
  private readonly headlessReadinessService: HeadlessOperationalReadinessService;
  private readonly automationSloService: AutomationSloService;
  private readonly signalHandler: () => void;
  private runtimeProcessLockRelease: RuntimeProcessLockRelease | null = null;

  constructor(options: CodeUxServerOptions) {
    this.projectRoot = options.projectRoot;
    this.appConfig = options.appConfig;
    this.dockerService = new DockerService();

    const deps = createRuntimeDependencies(options, this.createContext());

    this.server = deps.server;
    this.logger = deps.logger;
    this.julesApi = deps.julesApi;
    this.subtaskRepository = deps.subtaskRepository;
    this.taskService = deps.taskService;
    this.julesSourceResolver = deps.julesSourceResolver;
    this.sprintOrchestrator = deps.sprintOrchestrator;
    this.appDbStorage = deps.appDbStorage;
    this.settingsRepository = deps.settingsRepository;
    this.projectManagementRepository = deps.projectManagementRepository;
    this.projectInitializationStateService = new ProjectInitializationStateService(
      (projectId) => this.projectManagementRepository.getProject(projectId),
    );
    this.projectRuntimeRepository = deps.projectRuntimeRepository;
    this.connectionChatRepository = deps.connectionChatRepository;
    this.chatProviderRepository = deps.chatProviderRepository;
    this.chatProviderSecretService = deps.chatProviderSecretService;
    this.chatProviderVerificationService = deps.chatProviderVerificationService;
    this.chatConnectorRegistry = deps.chatConnectorRegistry;
    this.projectWorkerAssignmentRepository = deps.projectWorkerAssignmentRepository;
    this.projectWorkerAssignmentService = deps.projectWorkerAssignmentService;
    this.projectAttentionRepository = deps.projectAttentionRepository;
    this.projectAttentionService = deps.projectAttentionService;
    this.qaReviewRepository = deps.qaReviewRepository;
    this.agentPresetRepository = deps.agentPresetRepository;
    this.agentPresetSyncService = deps.agentPresetSyncService;
    this.executionRepository = deps.executionRepository;
    this.guardrailService = deps.guardrailService;
    this.sprintPreviewRepository = deps.sprintPreviewRepository;
    this.sprintPreviewService = deps.sprintPreviewService;
    this.sprintFileBrowserService = deps.sprintFileBrowserService;
    this.sprintBranchService = new SprintBranchService({
      projectManagementRepository: this.projectManagementRepository,
      executionRepository: this.executionRepository,
      settingsRepository: this.settingsRepository,
      logger: this.logger.child({ component: "sprint-branch-service" }),
    });
    this.customDashboardRepository = deps.customDashboardRepository;
    this.customDashboardCredentialBindingService = deps.customDashboardCredentialBindingService;
    this.customDashboardValidationService = deps.customDashboardValidationService;
    this.sprintMarkdownService = deps.sprintMarkdownService;
    this.sprintIssueService = deps.sprintIssueService;
    this.virtualWorkerService = deps.virtualWorkerService;
    this.externalSettingsHints = deps.externalSettingsHints;
    this.instructionService = deps.instructionService;
    this.sessionTracking = deps.sessionTracking;
    this.cliWorkflowService = deps.cliWorkflowService;
    this.managementToolHandler = deps.managementToolHandler;
    this.workerClarificationCoordinatorService = deps.workerClarificationCoordinatorService;
    this.headlessAuthService = deps.headlessAuthService;
    this.credentialBroker = deps.credentialBroker;
    this.automationAuditService = deps.automationAuditService;
    this.headlessReadinessService = deps.headlessReadinessService;
    this.automationSloService = deps.automationSloService;

    this.activityCacheService = deps.activityCacheService;
    this.taskRerunService = deps.taskRerunService;
    this.executionControlService = deps.executionControlService;
    this.executionInvocationControlService = deps.executionInvocationControlService;
    this.activeDispatchRegistry = deps.activeDispatchRegistry;
    this.shutdownContainerService = new ShutdownContainerService({
      activeDispatchRegistry: this.activeDispatchRegistry,
      logger: this.logger.child({ component: "shutdown-container-service" }),
    });
    this.planningAgentService = deps.planningAgentService;
    this.agentBaseUpdateService = deps.agentBaseUpdateService;
    this.quicksprintService = deps.quicksprintService;
    this.projectSetupService = deps.projectSetupService;
    this.schedulerService = deps.schedulerService;
    this.sprintRollbackService = deps.sprintRollbackService;
    this.nodeFlowService = deps.nodeFlowService;
    this.chatThreadRuntimeService = deps.chatThreadRuntimeService;
    this.chatProviderIngressService = deps.chatProviderIngressService;
    this.chatProviderOutboundService = deps.chatProviderOutboundService;
    this.chatProviderSessionRuntimeService = deps.chatProviderSessionRuntimeService;
    this.speechTranscriptionService = deps.speechTranscriptionService;
    this.speechSynthesisService = deps.speechSynthesisService;
    this.speechModelManager = deps.speechModelManager;
    this.runtimeCleanupService = deps.runtimeCleanupService;
    this.runtimeStartupRecoveryService = new RuntimeStartupRecoveryService({
      sessionTracking: this.sessionTracking,
      executionRepository: this.executionRepository,
      sprintRunLifecycleService: deps.sprintRunLifecycleService,
      qaReviewRepository: this.qaReviewRepository,
      projectManagementRepository: this.projectManagementRepository,
      projectAttentionService: this.projectAttentionService,
      guardrailService: this.guardrailService,
      sprintOrchestrator: this.sprintOrchestrator,
      dockerService: this.dockerService,
      getDashboardSettings: (scope) => {
        if (!scope?.projectId) {
          return this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
        }
        return resolveEffectiveDashboardSettings(
          this.settingsRepository,
          scope.projectId,
          scope.sprintId,
        ).settings;
      },
      listDurableRemoteSessions: () => this.julesApi.getSessionsForCapacityCheck(),
      resumeInterruptedPlanningInvocation: (invocationId, mode) => (
        this.planningAgentService.recoverInterruptedInvocation(invocationId, mode)
      ),
      logger: this.logger.child({ component: "runtime-startup-recovery-service" }),
    });
    this.dashboardRealtimeService = deps.dashboardRealtimeService;
    this.memoryService = deps.memoryService;
    this.memoryPromotionService = deps.memoryPromotionService;
    this.embeddingModelManager = deps.embeddingModelManager;
    this.embeddingService = deps.embeddingService;
    this.memoryRepository = deps.memoryRepository;
    this.knowledgeService = deps.knowledgeService;
    this.skillService = deps.skillService;

    this.configureMcpServer(this.server, this.appConfig.runtimeRole);

    this.signalHandler = () => {
      void this.handleShutdownSignal();
    };

    for (const signal of CodeUxServer.shutdownSignals) {
      const activeHandler = CodeUxServer.activeSignalHandlers.get(signal);
      if (activeHandler) {
        process.off(signal, activeHandler);
      }
      process.on(signal, this.signalHandler);
      CodeUxServer.activeSignalHandlers.set(signal, this.signalHandler);
    }
  }

  private async handleShutdownSignal(): Promise<void> {
    await this.withShutdownTimeout(this.close(), "server shutdown", CodeUxServer.SHUTDOWN_SIGNAL_TIMEOUT_MS);
    process.exit(0);
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closePromise = this.closeInternal();
    return this.closePromise;
  }

  private async closeInternal(): Promise<void> {
    this.isClosing = true;
    beginRuntimeShutdown();

    if (this.runtimeCleanupInterval) {
      clearInterval(this.runtimeCleanupInterval);
      this.runtimeCleanupInterval = null;
    }
    if (this.sprintPreviewInterval) {
      clearInterval(this.sprintPreviewInterval);
      this.sprintPreviewInterval = null;
    }
    if (this.liveSnapshotInterval) {
      clearInterval(this.liveSnapshotInterval);
      this.liveSnapshotInterval = null;
    }
    if (this.walCheckpointInterval) {
      clearInterval(this.walCheckpointInterval);
      this.walCheckpointInterval = null;
    }
    for (const timer of this.startupTaskTimers) {
      clearTimeout(timer);
    }
    this.startupTaskTimers.clear();
    this.virtualWorkerService.stop();
    this.workerClarificationCoordinatorService.stop();
    this.schedulerService.stop();
    const requestedDispatchStops = await this.shutdownContainerService.requestActiveDispatchStops().catch((error) => {
      this.logger.warn("Failed to request active dispatch stops during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    });
    disposeCommandSpawner();
    await shutdownGitHelperPool().catch((error) => {
      this.logger.warn("Failed to stop Docker git helper containers during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    await workspaceVolumeHelperPool.shutdown().catch((error) => {
      this.logger.warn("Failed to stop Docker workspace helper containers during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    await this.shutdownContainerService.stopRemainingContainers(requestedDispatchStops).catch((error) => {
      this.logger.warn("Failed to stop running containers during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    if (this.mcpHttpHandle) {
      await this.withShutdownTimeout(this.mcpHttpHandle.close().catch(() => undefined), "MCP HTTP transport close");
      this.mcpHttpHandle = null;
    }
    if (this.dashboardHandle) {
      await this.withShutdownTimeout(
        (this.dashboardHandle.close
          ? this.dashboardHandle.close()
          : this.closeHttpServer(this.dashboardHandle.server)
        ).catch(() => undefined),
        "dashboard server close",
      );
      this.dashboardHandle = null;
      this.runtimeContext.dashboardRuntimePort = null;
    }
    await this.withShutdownTimeout(this.server.close(), "MCP server close");
    this.mcpServiceBound = false;
    for (const [signal, activeHandler] of CodeUxServer.activeSignalHandlers) {
      if (activeHandler === this.signalHandler) {
        process.off(signal, activeHandler);
        CodeUxServer.activeSignalHandlers.delete(signal);
      }
    }
    await this.releaseProjectManagerRuntimeLock();

    // Flush the final write burst and close every SQLite connection explicitly. The CLI exits via
    // process.exit() after this method, so relying on process teardown leaves large WAL files behind
    // after busy sprints and skips SQLite's normal last-connection checkpoint.
    try {
      const failures = new DatabaseMaintenanceService({
        appDbStorage: this.appDbStorage,
        sessionTracking: this.sessionTracking,
        settingsRepository: this.settingsRepository,
        logger: this.logger.child({ component: "database-maintenance-service" }),
      }).checkpointWalDatabases();
      if (failures.length > 0) {
        this.logger.warn("Final WAL checkpoint completed with failures", { databases: failures });
      }
    } catch (error) {
      this.logger.warn("Final WAL checkpoint failed during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    for (const [label, closeDatabase] of [
      ["app", () => this.appDbStorage.close()],
      ["session tracking", () => this.sessionTracking.close()],
      ["settings", () => this.settingsRepository.close()],
    ] as const) {
      try {
        closeDatabase();
      } catch (error) {
        this.logger.warn("Failed to close SQLite database during shutdown", {
          database: label,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async closeHttpServer(server: HttpServer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && error.message !== "Server is not running.") {
          reject(error);
          return;
        }
        resolve();
      });
      server.closeIdleConnections?.();
      setImmediate(() => {
        server.closeAllConnections?.();
      });
    });
  }

  private async withShutdownTimeout<T>(
    promise: Promise<T>,
    label: string,
    timeoutMs = CodeUxServer.SHUTDOWN_CLOSE_TIMEOUT_MS
  ): Promise<T | undefined> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<undefined>((resolve) => {
          timeout = setTimeout(() => {
            this.logger.warn("Timed out while closing runtime component during shutdown", {
              component: label,
              timeoutMs,
            });
            resolve(undefined);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private configureMcpServer(server: Server, runtimeRole: "project_manager"): void {
    registerMcpRequestHandlers({
      server,
      managementToolHandler: this.managementToolHandler,
      getDashboardSettings: () => this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
      getRuntimeRole: () => runtimeRole,
      resolveAgentMcpToolAccess: (agentId, request) => {
        const agent = this.agentPresetRepository.getAgentPreset(agentId);
        if (!agent) return null;
        const settings = this.settingsRepository.resolveProjectDashboardSettings(agent.projectId).settings;
        const executionInvocationId = getCurrentMcpExecutionInvocationId();
        const executionInvocation = executionInvocationId
          ? this.executionRepository.getExecutionInvocation(executionInvocationId)
          : null;
        const invocationWorkerEligible = isInvocationScopedWorkerClarificationAgent({
          agentId: agent.id,
          projectId: agent.projectId,
          invocation: executionInvocation,
        });
        const assignedTaskIds = this.projectManagementRepository.listTasks(agent.projectId)
          .filter((task) => task.agentPresetId === agent.id)
          .map((task) => task.id);
        const workerEligible = invocationWorkerEligible || isWorkerClarificationAgent({
          agentId: agent.id,
          assignedTaskAgentIds: assignedTaskIds.length > 0 ? [agent.id] : [],
          settings,
        });
        const projectManagerEligible = isProjectManagerClarificationAgent({
          agentId: agent.id,
          agentName: agent.name,
          settings,
        });
        const requestArgs = request?.arguments && typeof request.arguments === "object"
          ? request.arguments as Record<string, unknown>
          : null;
        if (
          request
          && (request.toolName === "request_clarification" || request.toolName === "reply_to_clarification")
          && requestArgs?.projectId !== agent.projectId
        ) {
          return null;
        }
        if (request?.toolName === "request_clarification") {
          const routing = settings.agents.routing.taskCoding;
          const hasProjectWorkerRole = (routing.mode === "MANUAL" && routing.agentPresetId === agent.id)
            || routing.orchestratorAgentPresetIds.includes(agent.id);
          const invocationScopeMatches = requestArgs?.projectId === executionInvocation?.projectId
            && isInvocationScopedWorkerClarificationAgent({
              agentId: agent.id,
              projectId: agent.projectId,
              invocation: executionInvocation,
              requestedTaskId: requestArgs?.taskId,
              requestedTaskRunId: requestArgs?.taskRunId,
            });
          if (
            !workerEligible
            || (
              !invocationScopeMatches
              && !hasProjectWorkerRole
              && !assignedTaskIds.includes(String(requestArgs?.taskId ?? ""))
            )
          ) {
            return null;
          }
        }
        if (request?.toolName === "reply_to_clarification" && !projectManagerEligible) {
          return null;
        }
        const access = agent && this.isDashboardReplyRouteAgent(agent)
          ? dashboardReplyAgentMcpAccess(agent.mcpAccess)
          : agent?.mcpAccess;
        const persistentSkillRetrievalEnabled = Boolean(
          agent?.persistentSkillStorage?.enabled
          && agent.persistentSkillStorageIds
          && agent.persistentSkillStorageIds.length > 0,
        );
        let resolvedAccess = access
          ? toAgentCodeUxToolAccess(access, persistentSkillRetrievalEnabled)
          : persistentSkillRetrievalEnabled
            ? toAgentCodeUxToolAccess({ codeUxEnabled: false, codeUxToolToggles: [] }, true)
            : { codeUxEnabled: false, codeUxToolToggles: [] };
        const invocationProviderUsage = executionInvocation?.providerInvocationId
          ? this.executionRepository.getProviderInvocationUsage(executionInvocation.providerInvocationId)
          : null;
        if (isAutomaticClarificationReplyInvocation({
          agentId: agent.id,
          projectId: agent.projectId,
          invocation: executionInvocation,
          providerUsage: invocationProviderUsage,
        })) {
          return toAgentCodeUxToolAccess(automaticClarificationReplyAgentMcpAccess());
        }
        if (this.nodeFlowService.listAgentSkillsForAgent(agent.projectId, agent.id).length > 0) {
          resolvedAccess = withAttachedFlowAccess(resolvedAccess);
        }
        if (workerEligible) {
          resolvedAccess = withClarificationAudienceAccess(resolvedAccess, "worker", "request_clarification");
        }
        if (projectManagerEligible) {
          resolvedAccess = withClarificationAudienceAccess(resolvedAccess, "project_manager", "reply_to_clarification");
        }
        return resolvedAccess;
      },
      formatError: (error: unknown) => this.formatError(error),
      logger: this.logger.child({ component: "mcp-request-router", runtimeRole }),
      withCorrelationContext: (request, operation) => this.runWithMcpCorrelationContext(request, operation),
      getMcpApprovalTracker: () => this.mcpApprovalTracker,
    });

    server.onerror = (error) => {
      this.logger.error("MCP server error", { error, runtimeRole });
    };
  }

  private isDashboardReplyRouteAgent(agent: { id: string; projectId: string; name: string }): boolean {
    try {
      const settings = this.settingsRepository.resolveProjectDashboardSettings(agent.projectId).settings;
      const assignedAgentId = settings.agents?.routing?.dashboardReply?.agentPresetId ?? null;
      if (assignedAgentId) {
        return assignedAgentId === agent.id;
      }
      const normalizedName = agent.name.trim().toLowerCase();
      return normalizedName === "project manager" || normalizedName === "iris";
    } catch (error) {
      this.logger.warn("Failed to resolve dashboard reply agent MCP defaults", {
        projectId: agent.projectId,
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private createMcpServerInstance(runtimeRole: "project_manager"): Server {
    const server = new Server(
      {
        name: CODE_UX_SERVICE_NAME,
        version: CODE_UX_VERSION,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );
    this.configureMcpServer(server, runtimeRole);
    return server;
  }

  private startRuntimeCleanupLoop(): void {
    if (this.appConfig.runtimeRole !== "project_manager" || this.runtimeCleanupInterval || this.isClosing) {
      return;
    }

    const runCleanup = (): void => {
      if (this.isClosing) {
        return;
      }
      void this.runtimeCleanupService.cleanup().catch((error) => {
        this.logger.error("Runtime cleanup sweep failed", { error });
      });
    };

    this.scheduleTrackedTimer(CodeUxServer.LOOP_INITIAL_DELAY_MS, runCleanup);
    this.runtimeCleanupInterval = setInterval(runCleanup, CodeUxServer.RUNTIME_CLEANUP_INTERVAL_MS);
    this.runtimeCleanupInterval.unref?.();
  }

  private startSprintPreviewLoop(): void {
    if (this.appConfig.runtimeRole !== "project_manager" || this.sprintPreviewInterval || this.isClosing) {
      return;
    }

    const reconcile = (): void => {
      if (this.isClosing || this.sprintPreviewReconcileInFlight) {
        return;
      }
      this.sprintPreviewReconcileInFlight = true;
      void Promise.allSettled([
        this.sprintPreviewService.reconcileSessions(),
        this.sprintFileBrowserService.reconcileSessions(),
      ]).then((results) => {
        const [previewResult, fileBrowserResult] = results;
        if (previewResult.status === "rejected") {
          this.logger.error("Sprint preview reconciliation failed", { error: previewResult.reason });
        }
        if (fileBrowserResult.status === "rejected") {
          this.logger.error("File browser reconciliation failed", { error: fileBrowserResult.reason });
        }
      }).finally(() => {
        this.sprintPreviewReconcileInFlight = false;
      });
    };

    this.scheduleTrackedTimer(CodeUxServer.LOOP_INITIAL_DELAY_MS, reconcile);
    this.sprintPreviewInterval = setInterval(reconcile, CodeUxServer.RUNTIME_CLEANUP_INTERVAL_MS);
    this.sprintPreviewInterval.unref?.();
  }

  private startLiveSnapshotLoop(): void {
    if (this.appConfig.runtimeRole !== "project_manager" || this.liveSnapshotInterval || this.isClosing) {
      return;
    }

    const refreshLiveSnapshot = (): void => {
      if (this.isClosing) {
        return;
      }
      const projectId = this.projectManagementRepository.getSelectedProjectId();
      if (!projectId) {
        return;
      }

      this.dashboardRealtimeService.scheduleProjectLiveRefresh(projectId);
      // Refresh git/CI/PR status on its own dedicated, throttled channel (Live page only).
      this.dashboardRealtimeService.scheduleProjectGitRefresh(projectId);
    };

    this.scheduleTrackedTimer(250, refreshLiveSnapshot);
    this.liveSnapshotInterval = setInterval(refreshLiveSnapshot, CodeUxServer.LIVE_SNAPSHOT_REFRESH_INTERVAL_MS);
    this.liveSnapshotInterval.unref?.();
  }

  private startWalCheckpointLoop(): void {
    if (this.appConfig.runtimeRole !== "project_manager" || this.walCheckpointInterval || this.isClosing) {
      return;
    }

    const maintenance = new DatabaseMaintenanceService({
      appDbStorage: this.appDbStorage,
      sessionTracking: this.sessionTracking,
      settingsRepository: this.settingsRepository,
      logger: this.logger.child({ component: "database-maintenance-service" }),
    });

    const checkpoint = (): void => {
      if (this.isClosing) {
        return;
      }
      try {
        this.advanceDeferredDatabaseMigrations();
        if (!this.appDbStorage.hasPendingMaintenanceCriticalIndexes()) {
          maintenance.runPeriodicMaintenance();
        }
      } catch (error) {
        this.logger.error("Periodic database maintenance sweep failed", { error });
      }
    };

    this.walCheckpointInterval = setInterval(checkpoint, CodeUxServer.WAL_CHECKPOINT_INTERVAL_MS);
    this.walCheckpointInterval.unref?.();
  }

  private advanceDeferredDatabaseMigrations(): void {
    const bounded = this.appDbStorage.runBoundedDataMigrationsIfIdle();
    if (!bounded.skipped) {
      const changed = bounded.deletedNonReplayableEvents
        + bounded.backfilledTaskRunEventProjects
        + bounded.backfilledProviderInvocations
        + bounded.backfilledAutomationCredentials
        + bounded.migratedNodeFlowGraphs
        + bounded.backfilledNodeFlowPublications;
      if (changed > 0) {
        this.logger.info("Advanced bounded database data migrations", { changed });
      }
    }
    void this.appDbStorage.runNextDeferredIndexIfIdle().then((status) => {
      if (status === "created") {
        this.logger.info("Created one deferred database index", {
          remaining: this.appDbStorage.getPendingDeferredIndexCount(),
        });
      }
    }).catch((error) => {
      this.logger.warn("Deferred database index build failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private createContext(): ServerContext {
    return {
      runtimeContext: this.runtimeContext,
      getProjectRoot: () => this.projectRoot,
      getAppConfig: () => this.appConfig,
      getEffectiveJulesApiKey: () => this.getEffectiveJulesApiKey(),
      getEffectiveGithubToken: () => this.getEffectiveGithubToken(),
      getEffectiveGitlabToken: () => this.getEffectiveGitlabToken(),
      getDashboardPort: () => this.getDashboardPort(),
      isJulesApiConfigured: () => this.isJulesApiConfigured(),
      getMissingJulesApiKeyInstruction: () => this.getMissingJulesApiKeyInstruction(),
      isActionRequiredState: (state) => this.isActionRequiredState(state),
      resolveSessionName: (session) => this.resolveSessionName(session),
      extractSessionId: (session) => this.extractSessionId(session),
      fetchRecentActivities: (sessionName, pageSize, signal) => this.fetchRecentActivities(sessionName, pageSize, signal),
      listSessionsForSync: () => this.listSessionsForSync(),
      getCiStatusForScope: (args) => this.getCiStatusForScope(args),
      autoMergeFeaturePr: (args) => this.autoMergeFeaturePr(args),
      resolveOrCreateMainBranchPr: (args) => this.resolveOrCreateMainBranchPr(args),
      resolveSessionNameFromTask: (task) => this.resolveSessionNameFromTask(task),
      resolveGitStatusRepoPath: () => this.resolveGitStatusRepoPath(),
      fetchGitStatusForRepo: (repoPath: string, cacheTtlMs?: number) => this.fetchGitStatusForRepo(repoPath, cacheTtlMs),
      invalidateGitStatusCache: (repoPath: string) => GitStatusService.invalidateCache(repoPath),
      persistTaskMergedFlag: (args) => this.persistTaskMergedFlag(args),
      normalizeName: (type, id) => this.normalizeName(type, id),
      isTrackedCliSession: (sessionId) => this.isTrackedCliSession(sessionId),
      getMcpConnectionInfo: () => this.getConfiguredMcpConnectionInfo(),
      getMcpApprovalTracker: () => this.mcpApprovalTracker,
    };
  }

  private getConfiguredMcpConnectionInfo(): McpConnectionInfo | null {
    if (!this.appConfig.mcpHttpEnabled || !this.appConfig.mcpHttpPort || !this.mcpHttpHandle) {
      return null;
    }
    return {
      url: `http://${this.mcpHttpClientHost()}:${this.mcpHttpHandle.port}${this.mcpHttpHandle.path}`,
      authToken: this.appConfig.mcpHttpAuthToken,
    };
  }

  private regenerateMcpHttpAuthToken(): string {
    const token = regenerateUserMcpHttpAuthToken();
    this.appConfig.mcpHttpAuthToken = token;
    return token;
  }

  private mcpHttpClientHost(): string {
    if (!this.mcpHttpHandle) {
      return "127.0.0.1";
    }
    const host = this.mcpHttpHandle.host.trim().toLowerCase();
    return host === "0.0.0.0" || host === "::"
      ? "127.0.0.1"
      : this.mcpHttpHandle.host;
  }

  private runWithMcpCorrelationContext<T>(request: unknown, operation: () => Promise<T>): Promise<T> {
    const correlationId = this.extractMcpCorrelationId(request) ?? generateCorrelationId();
    return runWithCorrelationId(correlationId, operation);
  }

  private extractMcpCorrelationId(request: unknown): string | undefined {
    const requestRecord = request as { id?: unknown; params?: Record<string, unknown> };
    const params = requestRecord.params && typeof requestRecord.params === "object"
      ? requestRecord.params
      : undefined;
    const meta = params?._meta && typeof params._meta === "object"
      ? (params._meta as Record<string, unknown>)
      : undefined;
    const argumentsRecord = params?.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : undefined;

    const candidates: unknown[] = [
      meta?.correlationId,
      meta?.["x-correlation-id"],
      meta?.requestId,
      argumentsRecord?.correlationId,
      requestRecord.id,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return `mcp-${candidate}`;
      }
    }

    return undefined;
  }

  private getEffectiveJulesApiKey(): string | undefined {
    const settings = this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
    const providerEntries = Object.entries(settings.aiProvider?.providers || {});
    const uiProviderKey = providerEntries
      .find(([providerConfigId, provider]) => {
        const providerType = provider.provider
          || (providerConfigId === "jules" || providerConfigId.startsWith("jules-") ? "jules" : null);
        return providerType === "jules" && provider.apiKey.trim().length > 0;
      })
      ?.[1]
      ?.apiKey
      ?.trim();
    if (uiProviderKey && uiProviderKey.length > 0) {
      return uiProviderKey;
    }
    const liveEnvKey = process.env.JULES_API_KEY?.trim() || process.env.JULES_KEY?.trim();
    if (liveEnvKey && liveEnvKey.length > 0) {
      return liveEnvKey;
    }
    const configKey = this.appConfig?.apiKey?.trim();
    if (configKey && configKey.length > 0) {
      return configKey;
    }
    const fallback = this.externalSettingsHints?.resolved?.julesApiKey?.trim();
    return (fallback && fallback.length > 0) ? fallback : undefined;
  }

  private refreshJulesApiKey(): void {
    this.julesApi.setApiKey(this.getEffectiveJulesApiKey());
  }

  private isJulesApiConfigured(): boolean {
    return this.julesApi.hasApiKey();
  }

  private getDashboardPort(): number {
    if (this.runtimeContext.dashboardRuntimePort !== null) return this.runtimeContext.dashboardRuntimePort;
    const explicitEnvPort = Number.parseInt(String(process.env.DASHBOARD_PORT || "").trim(), 10);
    if (Number.isFinite(explicitEnvPort) && explicitEnvPort > 0) {
      return explicitEnvPort;
    }
    const settings = this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
    return settings.dashboardPort || (this.runtimeContext.settings.dashboardPort as number) || this.appConfig.dashboardPort;
  }

  getDashboardRuntimePort(): number {
    return this.getDashboardPort();
  }

  private getMissingJulesApiKeyInstruction(): string {
    return buildMissingJulesApiKeyMessage(this.getDashboardPort());
  }

  private getEffectiveGithubToken(): string | undefined {
    const settings = this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
    const uiToken = settings.git?.githubToken?.trim();
    if (uiToken && uiToken.length > 0) {
      return uiToken;
    }
    const liveEnvToken = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
    if (liveEnvToken && liveEnvToken.length > 0) {
      return liveEnvToken;
    }
    const fallback = this.externalSettingsHints?.resolved?.githubToken?.trim();
    return (fallback && fallback.length > 0) ? fallback : undefined;
  }

  private getEffectiveGitlabToken(): string | undefined {
    const settings = this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
    const uiToken = settings.git?.gitlabToken?.trim();
    if (uiToken && uiToken.length > 0) {
      return uiToken;
    }
    const liveEnvToken = process.env.GITLAB_TOKEN?.trim() || process.env.GLAB_TOKEN?.trim();
    if (liveEnvToken && liveEnvToken.length > 0) {
      return liveEnvToken;
    }
    const fallback = this.externalSettingsHints?.resolved?.gitlabToken?.trim();
    return (fallback && fallback.length > 0) ? fallback : undefined;
  }

  /**
   * Both host tokens, each resolved independently. The git status service picks
   * the one matching the repository's host, so a GitHub repo never receives the
   * GitLab token and vice versa.
   */
  private getEffectiveGitHostTokens(): GitHostTokens {
    return {
      githubToken: this.getEffectiveGithubToken(),
      gitlabToken: this.getEffectiveGitlabToken(),
    };
  }

  private resolveGitTrackingRequest(): GitTrackingRequest {
    const settings = this.getSelectedProjectDashboardSettings();
    const ci = settings.ciIntelligence;
    const runtimeStatus = this.projectRuntimeRepository.getSelectedProjectLiveStatus();
    const subtasks: Subtask[] = Array.isArray(runtimeStatus.subtasks) ? runtimeStatus.subtasks : [];
    const featureBranch = typeof runtimeStatus.feature_branch === "string" && runtimeStatus.feature_branch.trim().length > 0
      ? runtimeStatus.feature_branch.trim()
      : null;
    const defaultBranch = settings.git.defaultBranch?.trim() || "main";
    const featureBranchPrefix = settings.git.featureBranchPrefix?.trim() || "feature/";

    const hasRunningTasks = subtasks.some((task) => task.status === "RUNNING");
    if (ci.enabled && ci.featurePrAutoMergeMode === "WHEN_GREEN" && hasRunningTasks && featureBranch) {
      return {
        scope: "FEATURE_PR_CI",
        featureBranch,
        defaultBranch,
        featureBranchPrefix,
      };
    }

    return {
      scope: "MAIN_BRANCH_CI",
      defaultBranch,
      featureBranch,
      featureBranchPrefix,
    };
  }

  private getSelectedProjectDashboardSettings(): DashboardSettings {
    const selectedProjectId = this.projectManagementRepository.getSelectedProjectId();
    if (selectedProjectId) {
      return this.settingsRepository.resolveProjectDashboardSettings(selectedProjectId).settings;
    }

    return this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
  }

  private resolveGitStatusRepoPath(): string {
    return this.projectRuntimeRepository.getSelectedProjectRepoPath(this.projectRoot);
  }

  private isDashboardEnabled(): boolean {
    return this.appConfig.dashboardEnabled;
  }

  private isReady(): ReadinessProbeStatus {
    const settingsDbUp = this.runtimeContext.settings !== undefined;
    const dashboardBindUp = !this.isDashboardEnabled() || this.runtimeContext.dashboardRuntimePort !== null;
    const mcpServiceUp = this.mcpServiceBound;
    const startupRecoveryUp = this.startupRecoveryCompleted;

    const isReady = settingsDbUp && dashboardBindUp && mcpServiceUp && startupRecoveryUp;

    return {
      status: isReady ? "READY" : "NOT_READY",
      components: {
        settingsDb: settingsDbUp ? "UP" : "DOWN",
        dashboardBind: dashboardBindUp ? "UP" : "DOWN",
        mcpService: mcpServiceUp ? "UP" : "DOWN",
        startupRecovery: startupRecoveryUp ? "UP" : "DOWN",
      }
    };
  }

  private isHealthy(): ReadinessProbeStatus {
    const settingsDbUp = this.runtimeContext.settings !== undefined;
    const dashboardBindUp = !this.isDashboardEnabled() || this.runtimeContext.dashboardRuntimePort !== null;
    const mcpServiceUp = this.mcpServiceBound;

    const isHealthy = settingsDbUp && dashboardBindUp && mcpServiceUp;

    return {
      status: isHealthy ? "UP" : "DOWN",
      components: {
        settingsDb: settingsDbUp ? "UP" : "DOWN",
        dashboardBind: dashboardBindUp ? "UP" : "DOWN",
        mcpService: mcpServiceUp ? "UP" : "DOWN",
      }
    };
  }

  private async persistTaskMergedFlag(args: PersistTaskMergedFlagArgs): Promise<void> {
    const subtasksDir = getCodeUxSubtasksDir(args.repoPath, args.sprintNumber);
    await this.subtaskRepository.setMerged(subtasksDir, args.taskId, args.merged);
  }

  private formatError(error: unknown): { content: Array<{ type: string; text: string }>; isError: true } {
    const maybeError = error as { message?: string };
    let message = maybeError?.message || "An unknown error occurred";
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ error?: { message?: string } }>;
      message = axiosError.response?.data?.error?.message || axiosError.message;
    }
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }

  private normalizeName(type: string, id: string): string {
    return this.julesApi.normalizeName(type, id);
  }

  private isActionRequiredState(state?: string): boolean {
    return state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED";
  }

  private extractSessionId(session: Partial<JulesSession>): string | undefined {
    return this.julesApi.extractSessionId(session);
  }

  private resolveSessionName(session: Partial<JulesSession>): string | undefined {
    return this.julesApi.resolveSessionName(session);
  }

  private resolveSessionNameFromTask(task: Subtask): string | undefined {
    if (task.session_name) {
      return this.resolveSessionName({ name: task.session_name });
    }
    if (task.session_id) {
      return this.resolveSessionName({ id: task.session_id });
    }
    return undefined;
  }

  private isTrackedCliSession(sessionName: string): boolean {
    const normalized = sessionName.replace(/^sessions\//, "");
    return normalized.startsWith("cli-");
  }

  private async listSessionsForSync(): Promise<{ sessions?: JulesSession[] }> {
    // Session sync matches durable task/run metadata and never reads local CLI prompts.
    // QA prompts can contain a full 400-task context, so projecting them into every
    // one-second watch cycle creates a large transient heap proportional to session count.
    const tracked = this.sessionTracking.listSessions(300, { includePrompt: false }).sessions;
    let julesSessions: JulesSession[] = [];
    if (this.isJulesApiConfigured()) {
      try {
        // Shared, coalesced, TTL-cached snapshot: every sprint watch loop reads
        // from one fetch per window instead of each calling listSessions per
        // cycle (which drove the account into 429s/timeouts on high throughput).
        const remote = await this.julesApi.getCachedSessions();
        julesSessions = remote.map((session) => ({ ...session, provider: "jules" }));
      } catch {
        // Keep tracked sessions available even if Jules API is unavailable.
      }
    }

    const seen = new Set<string>();
    const merged = [...tracked, ...julesSessions].filter((session) => {
      const key = this.extractSessionId(session) || session.id || session.name;
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    return { sessions: merged };
  }

  private async fetchRecentActivities(
    sessionName: string,
    pageSize: number = CodeUxServer.DASHBOARD_ACTIVITY_PAGE_SIZE,
    signal?: AbortSignal,
  ): Promise<JulesActivity[]> {
    if (this.isTrackedCliSession(sessionName)) {
      return this.sessionTracking.fetchRecentActivities(sessionName, pageSize);
    }
    if (!this.isJulesApiConfigured()) {
      return [];
    }
    return this.julesApi.fetchRecentActivities(sessionName, pageSize, signal);
  }

  private async fetchGitStatusForRepo(repoPath: string, cacheTtlMs?: number): Promise<GitTrackingStatus> {
    const gitStatusService = new GitStatusService(repoPath, defaultRunner, true);
    const settings = this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
    return await gitStatusService.getStatus(
      settings.git.githubMode,
      this.getEffectiveGitHostTokens(),
      this.resolveGitTrackingRequest(),
      cacheTtlMs
    );
  }

  private async getGitStatus(): Promise<GitTrackingStatus> {
    const status = await this.activityCacheService.getGitStatus();
    await this.reconcileSelectedProjectMergeConflictAttention(status);
    return status;
  }

  private async reconcileSelectedProjectMergeConflictAttention(gitStatus: GitTrackingStatus): Promise<void> {
    const selectedProjectId = this.projectManagementRepository.getSelectedProjectId();
    if (!selectedProjectId) {
      return;
    }

    const activeItems = this.projectAttentionRepository.listProjectAttentionItems(selectedProjectId, {
      statuses: ["open", "claimed"],
      limit: 50,
    });
    const mergeConflictItems = activeItems.filter((item) => this.isMergeConflictAttentionItem(item));
    if (mergeConflictItems.length === 0) {
      return;
    }

    const repositoryStatus = await this.loadRepositoryWideGitStatusForAttentionReconciliation(gitStatus);
    if (!repositoryStatus?.available || repositoryStatus.mode !== "REMOTE") {
      return;
    }

    for (const item of mergeConflictItems) {
      if (!this.shouldResolveMergeConflictAttention(item, repositoryStatus)) {
        continue;
      }

      const payload = readAttentionPayloadRecord(item);
      const mergeStage = payload?.mergeStage === "main" ? "main" : "feature";
      this.projectAttentionRepository.resolveAttentionItem(item.id, {
        status: "resolved",
        reason: mergeStage === "main" ? "main_merge_conflict_cleared" : "merge_conflict_cleared",
      });
    }
  }

  private async loadRepositoryWideGitStatusForAttentionReconciliation(
    gitStatus: GitTrackingStatus,
  ): Promise<GitTrackingStatus | null> {
    if (gitStatus.mode !== "REMOTE" || !gitStatus.available) {
      return null;
    }

    if (gitStatus.tracking.scope === "REPOSITORY") {
      return gitStatus;
    }

    try {
      const gitStatusService = new GitStatusService(this.resolveGitStatusRepoPath(), defaultRunner, true);
      return await gitStatusService.getStatus(
        "REMOTE",
        this.getEffectiveGitHostTokens(),
        { scope: "REPOSITORY" },
        CodeUxServer.GIT_STATUS_CACHE_MS,
      );
    } catch {
      return null;
    }
  }

  private isMergeConflictAttentionItem(item: ProjectAttentionItemRecord): boolean {
    const payload = readAttentionPayloadRecord(item);
    if (item.attentionType === "merge_conflict") {
      return true;
    }

    return (
      (item.attentionType === "human_escalation_required" || item.attentionType === "dashboard_reply_required")
      && payload?.sourceAttentionType === "merge_conflict"
    );
  }

  private shouldResolveMergeConflictAttention(
    item: ProjectAttentionItemRecord,
    gitStatus: GitTrackingStatus,
  ): boolean {
    const payload = readAttentionPayloadRecord(item);
    if (!payload) {
      return false;
    }

    const prNumber = typeof payload.prNumber === "number" && Number.isFinite(payload.prNumber)
      ? payload.prNumber
      : null;
    const prUrl = typeof payload.prUrl === "string" && payload.prUrl.trim().length > 0
      ? payload.prUrl.trim()
      : null;
    const sourceBranch = normalizeBranchName(payload.conflictingBranches && typeof payload.conflictingBranches === "object"
      ? (payload.conflictingBranches as Record<string, unknown>).source
      : payload.mergeStage === "main"
        ? payload.featureBranch
        : payload.workerBranch);
    const targetBranch = normalizeBranchName(payload.conflictingBranches && typeof payload.conflictingBranches === "object"
      ? (payload.conflictingBranches as Record<string, unknown>).target
      : payload.mergeStage === "main"
        ? payload.defaultBranch
        : payload.featureBranch);

    const matchesPullRequest = (pr: { number: number; url: string; headRefName: string | null; baseRefName: string | null }): boolean => {
      if (prNumber !== null && pr.number === prNumber) {
        return true;
      }
      if (prUrl && pr.url === prUrl) {
        return true;
      }
      return normalizeBranchName(pr.headRefName) === sourceBranch && normalizeBranchName(pr.baseRefName) === targetBranch;
    };

    if (gitStatus.mergedPullRequests.some((pr) => matchesPullRequest(pr))) {
      return true;
    }

    const openPr = gitStatus.openPullRequests.find((pr) => matchesPullRequest(pr));
    return Boolean(openPr && String(openPr.mergeStateStatus || "").trim().toUpperCase() !== "DIRTY");
  }

  private async getCiStatusForScope(args: GetCiStatusForScopeArgs): Promise<GitTrackingStatus | null> {
    const gitStatusService = new GitStatusService(args.repoPath, defaultRunner, true);
    try {
      const trackingRequest = {
        scope: args.scope,
        featureBranch: args.featureBranch,
        defaultBranch: args.defaultBranch,
        featureBranchPrefix: args.featureBranchPrefix,
        taskPrUrls: args.taskPrUrls,
      };
      return typeof args.cacheTtlMs === "number"
        ? await gitStatusService.getStatus(
            "REMOTE",
            this.getEffectiveGitHostTokens(),
            trackingRequest,
            args.cacheTtlMs,
          )
        : await gitStatusService.getStatus(
            "REMOTE",
            this.getEffectiveGitHostTokens(),
            trackingRequest,
          );
    } catch {
      return null;
    }
  }

  private async autoMergeFeaturePr(args: AutoMergeFeaturePrArgs): Promise<AutoMergeFeaturePrResult> {
    const gitStatusService = new GitStatusService(args.repoPath, defaultRunner, true);
    try {
      const result = await gitStatusService.mergePullRequest(args.prNumber, this.getEffectiveGitHostTokens());
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message,
        mergeConflict: detectMergeConflictMessage(message),
      };
    }
  }

  private async resolveOrCreateMainBranchPr(args: {
    repoPath: string;
    featureBranch: string;
    defaultBranch: string;
    title: string;
    body: string;
  }): Promise<{ created: boolean; prNumber: number | null; prUrl: string | null; errorMessage?: string } | null> {
    const gitStatusService = new GitStatusService(args.repoPath, defaultRunner, true);
    try {
      return await gitStatusService.resolveOrCreatePullRequest({
        baseBranch: args.defaultBranch,
        headBranch: args.featureBranch,
        title: args.title,
        body: args.body,
      }, this.getEffectiveGitHostTokens());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("Failed to resolve or create main branch PR", {
        repoPath: args.repoPath,
        featureBranch: args.featureBranch,
        defaultBranch: args.defaultBranch,
        error: message,
      });
      return {
        created: false,
        prNumber: null,
        prUrl: null,
        errorMessage: message,
      };
    }
  }

  private async getLiveActivitiesForActiveTasks(): Promise<Record<string, JulesActivity[]>> {
    return await this.activityCacheService.getLiveActivitiesForActiveTasks();
  }

  private scheduleTrackedTimer(delayMs: number, task: () => void): void {
    const timer = setTimeout(() => {
      this.startupTaskTimers.delete(timer);
      if (this.isClosing) {
        return;
      }
      task();
    }, delayMs);
    timer.unref?.();
    this.startupTaskTimers.add(timer);
  }

  private scheduleStartupTask(label: string, delayMs: number, task: () => Promise<void>): void {
    this.scheduleTrackedTimer(delayMs, () => {
      void task().catch((error) => {
        this.logger.error?.(`${label} failed`, { error });
      });
    });
  }

  private scheduleBackgroundStartupTasks(): void {
    this.scheduleStartupTask(
      "Startup recovery",
      CodeUxServer.STARTUP_RECOVERY_DELAY_MS,
      async () => {
        await this.ensureStartupContainerCleanup();
        await this.runStartupRecovery();
      },
    );
    this.scheduleStartupTask(
      "Startup container cleanup",
      CodeUxServer.STARTUP_CONTAINER_CLEANUP_DELAY_MS,
      () => this.ensureStartupContainerCleanup(),
    );
    this.scheduleStartupTask(
      "Startup maintenance",
      CodeUxServer.STARTUP_MAINTENANCE_DELAY_MS,
      () => this.runStartupMaintenance(),
    );
  }

  private ensureStartupContainerCleanup(): Promise<void> {
    if (!this.startupContainerCleanupPromise) {
      this.startupContainerCleanupPromise = this.runStartupContainerCleanup();
    }
    return this.startupContainerCleanupPromise;
  }

  private async runStartupRecovery(): Promise<void> {
    try {
      const recoveryResult = await this.runtimeStartupRecoveryService.recover();
      this.logger.info("Recovery routine completed");
      for (const runId of recoveryResult.resumedSprintRunIds) {
        const sprintRun = this.executionRepository.getSprintRun(runId);
        if (sprintRun) {
          this.dashboardRealtimeService.scheduleProjectLiveRefresh(sprintRun.projectId);
        }
      }
    } catch (error) {
      this.logger.error("Failed to recover runtime state on startup", { error });
    } finally {
      // Repair attention can retain a claimed virtual endpoint and a live Docker
      // container across a process boundary. Reconcile and stop that stale owner
      // before virtual workers are allowed to claim the preserved workspace.
      this.virtualWorkerService.start();
      this.startupRecoveryCompleted = true;
    }
  }

  private async runStartupContainerCleanup(): Promise<void> {
    try {
      await this.sprintPreviewService.cleanupStaleContainersOnStartup();
    } catch (error) {
      this.logger.error?.("Failed to clean up stale sprint preview containers on startup", { error });
    }
    try {
      await this.sprintFileBrowserService.cleanupStaleContainersOnStartup();
    } catch (error) {
      this.logger.error?.("Failed to clean up stale file browser containers on startup", { error });
    }
    try {
      await new DockerAssetPruneService(
        this.sessionTracking,
        this.logger.child({ component: "docker-asset-prune-service" }),
        {
          protectedWorkspaceSessionIds: () => {
            const sessionIds = new Set(
              this.executionRepository
                .listRunningProviderInvocationUsages()
                .map((invocation) => invocation.sessionId?.trim())
                .filter((sessionId): sessionId is string => Boolean(sessionId)),
            );
            for (const invocation of this.executionRepository.listActiveExecutionInvocationsByTypes(["planning"])) {
              sessionIds.add(`planning-${invocation.projectId}-${invocation.sprintId || "project"}`);
            }
            return sessionIds;
          },
        },
      ).cleanupOnStartup();
    } catch (error) {
      this.logger.error?.("Failed to prune stale Docker assets on startup", { error });
    }

    // Startup pruning removes helper generations left by a crashed process. Only create the
    // selected project's persistent generation after that destructive pass has completed, then
    // allow sprint/provider recovery to begin. This prevents a slow prune from deleting a newly
    // recovered helper.
    const selectedProjectId = this.projectManagementRepository.getSelectedProjectId();
    const selectedProject = selectedProjectId
      ? this.projectManagementRepository.getProject(selectedProjectId)
      : null;
    try {
      await setSelectedProjectGitHelper(selectedProject?.baseDir || null);
    } catch (error) {
      this.logger.warn("Failed to prewarm selected-project Git helper after startup cleanup", {
        projectId: selectedProjectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async runStartupMaintenance(): Promise<void> {
    try {
      await new BranchReaperService({
        listProjects: () => this.projectManagementRepository.listProjects().projects.map((project) => ({
          id: project.id,
          baseDir: project.baseDir,
        })),
        resolveProjectGit: (projectId) => {
          try {
            const git = this.settingsRepository.resolveProjectDashboardSettings(projectId).settings.git;
            return {
              deleteMergedBranches: git.deleteMergedBranches,
              defaultBranch: git.defaultBranch,
              featureBranchPrefix: git.featureBranchPrefix,
            };
          } catch {
            return null;
          }
        },
        logger: this.logger.child({ component: "branch-reaper-service" }),
      }).reapOnStartup();
    } catch (error) {
      this.logger.error("Failed to reap merged branches on startup", { error });
    }

    this.advanceDeferredDatabaseMigrations();
    if (this.appDbStorage.hasPendingMaintenanceCriticalIndexes()) {
      this.logger.info("Deferring database retention until maintenance-critical indexes are ready", {
        pendingIndexes: this.appDbStorage.getPendingDeferredIndexCount(),
      });
      return;
    }

    try {
      await new DatabaseMaintenanceService({
        appDbStorage: this.appDbStorage,
        sessionTracking: this.sessionTracking,
        settingsRepository: this.settingsRepository,
        logger: this.logger.child({ component: "database-maintenance-service" }),
      }).runMaintenance();
    } catch (error) {
      this.logger.error("Failed to run database maintenance on startup", { error });
    }
  }

  async run(): Promise<void> {
    await this.acquireProjectManagerRuntimeLock();
    try {
      await this.runInternal();
    } catch (error) {
      await this.releaseProjectManagerRuntimeLock();
      throw error;
    }
  }

  private async acquireProjectManagerRuntimeLock(): Promise<void> {
    if (process.env.NODE_ENV === "test" || process.env.VITEST) {
      return;
    }
    if (this.runtimeProcessLockRelease) {
      return;
    }
    this.runtimeProcessLockRelease = await acquireRuntimeProcessLock({
      projectRoot: this.projectRoot,
    });
  }

  private async releaseProjectManagerRuntimeLock(): Promise<void> {
    const release = this.runtimeProcessLockRelease;
    this.runtimeProcessLockRelease = null;
    if (!release) {
      return;
    }
    await release().catch((error) => {
      this.logger.warn("Failed to release Code UX runtime process lock", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async runInternal(): Promise<void> {
    await this.headlessReadinessService.assertStartupReady();
    await bootSettings({
      runtimeContext: this.runtimeContext,
      projectRoot: this.projectRoot,
      logger: this.logger,
    });
    this.sprintPreviewService.prepareForStartupCleanup();
    this.refreshJulesApiKey();
    try {
      const startupPrune = this.connectionChatRepository.pruneDisconnectedConnectionsOnStartup();
      if (startupPrune.prunedConnectionIds.length > 0) {
        this.logger.info("Pruned disconnected MCP connections on startup", {
          prunedCount: startupPrune.prunedConnectionIds.length,
        });
      }
    } catch (error) {
      this.logger.error("Failed to prune disconnected MCP connections on startup", { error });
    }

    if (this.isDashboardEnabled()) {
      this.dashboardHandle = await bootDashboard({
        app: this.app,
        projectRoot: this.projectRoot,
        getDashboardPort: () => this.getDashboardPort(),
        runtimeContext: this.runtimeContext,
        externalSettingsHints: this.externalSettingsHints,
        appDbStorage: this.appDbStorage,
        settingsRepository: this.settingsRepository,
        projectManagementRepository: this.projectManagementRepository,
        projectInitializationStateService: this.projectInitializationStateService,
        projectRuntimeRepository: this.projectRuntimeRepository,
        executionRepository: this.executionRepository,
        getDashboardNotifications: (limit) => this.executionRepository.getDashboardNotifications({ limit }),
        connectionChatRepository: this.connectionChatRepository,
        chatProviderRepository: this.chatProviderRepository,
        chatProviderSecretService: this.chatProviderSecretService,
        chatProviderVerificationService: this.chatProviderVerificationService,
        chatConnectorRegistry: this.chatConnectorRegistry,
        projectWorkerAssignmentRepository: this.projectWorkerAssignmentRepository,
        projectWorkerAssignmentService: this.projectWorkerAssignmentService,
        projectAttentionRepository: this.projectAttentionRepository,
        qaReviewRepository: this.qaReviewRepository,
        guardrailService: this.guardrailService,
        agentPresetRepository: this.agentPresetRepository,
        agentPresetSyncService: this.agentPresetSyncService,
        knowledgeService: this.knowledgeService,
        sprintMarkdownService: this.sprintMarkdownService,
        sprintIssueService: this.sprintIssueService,
        activityCacheService: this.activityCacheService,
        taskRerunService: this.taskRerunService,
        executionControlService: this.executionControlService,
        executionInvocationControlService: this.executionInvocationControlService,
        planningAgentService: this.planningAgentService,
        agentBaseUpdateService: this.agentBaseUpdateService,
        quicksprintService: this.quicksprintService,
        projectSetupService: this.projectSetupService,
        schedulerService: this.schedulerService,
        sprintRollbackService: this.sprintRollbackService,
        nodeFlowService: this.nodeFlowService,
        credentialBroker: this.credentialBroker,
        headlessAuthService: this.headlessAuthService,
        automationAuditService: this.automationAuditService,
        headlessReadinessService: this.headlessReadinessService,
        automationSloService: this.automationSloService,
        customDashboardRepository: this.customDashboardRepository,
        customDashboardCredentialBindingService: this.customDashboardCredentialBindingService,
        customDashboardValidationService: this.customDashboardValidationService,
        skillService: this.skillService,
        chatThreadRuntimeService: this.chatThreadRuntimeService,
        chatProviderIngressService: this.chatProviderIngressService,
        chatProviderOutboundService: this.chatProviderOutboundService,
        chatProviderSessionRuntimeService: this.chatProviderSessionRuntimeService,
        speechTranscriptionService: this.speechTranscriptionService,
        speechSynthesisService: this.speechSynthesisService,
        speechModelManager: this.speechModelManager,
        dashboardRealtimeService: this.dashboardRealtimeService,
        logger: this.logger,
        getLiveActivitiesForActiveTasks: () => this.getLiveActivitiesForActiveTasks(),
        getGitStatus: () => this.getGitStatus(),
        isReady: () => this.isReady(),
        isHealthy: () => this.isHealthy(),
        listDockerContainers: () => this.dockerService.listContainers(),
        listSprintPreviewSessions: (projectId) => this.sprintPreviewService.listSessions(projectId),
        getSprintPreviewSession: (sessionId: string) => this.sprintPreviewService.getSession(sessionId),
        getSprintPreviewSessionForProjectSprint: (projectId, sprintId, sessionId) => this.sprintPreviewService.getSessionForProjectSprint(projectId, sprintId, sessionId),
        startSprintPreviewSession: (projectId, sprintId) => this.sprintPreviewService.startSession(projectId, sprintId),
        rebuildSprintPreviewSession: (sessionId) => this.sprintPreviewService.rebuildSession(sessionId),
        rebuildSprintPreviewSessionForProjectSprint: (projectId, sprintId, sessionId) => this.sprintPreviewService.rebuildSessionForProjectSprint(projectId, sprintId, sessionId),
        stopSprintPreviewSession: (sessionId) => this.sprintPreviewService.stopSession(sessionId),
        stopSprintPreviewSessionForProjectSprint: (projectId, sprintId, sessionId) => this.sprintPreviewService.stopSessionForProjectSprint(projectId, sprintId, sessionId),
        removeSprintPreviewSession: (sessionId) => this.sprintPreviewService.removeSession(sessionId),
        removeSprintPreviewSessionForProjectSprint: (projectId, sprintId, sessionId) => this.sprintPreviewService.removeSessionForProjectSprint(projectId, sprintId, sessionId),
        getSprintPreviewScript: (projectId, sprintId) => this.sprintPreviewService.getScript(projectId, sprintId),
        saveSprintPreviewScript: (projectId, sprintId, content) => this.sprintPreviewService.saveScript(projectId, sprintId, content),
        updateSprintPreviewEnvironmentOverrides: (projectId, sprintId, sessionId, environmentOverrides) => this.sprintPreviewService.updateEnvironmentOverridesForProjectSprint(projectId, sprintId, sessionId, environmentOverrides),
        updateSprintPreviewStartupCommandOverride: (projectId, sprintId, sessionId, startupCommandOverride) => this.sprintPreviewService.updateStartupCommandOverrideForProjectSprint(projectId, sprintId, sessionId, startupCommandOverride),
        updateSprintPreviewDockerAccessOverride: (projectId, sprintId, sessionId, dockerAccessOverride) => this.sprintPreviewService.updateDockerAccessOverrideForProjectSprint(projectId, sprintId, sessionId, dockerAccessOverride),
        getSprintPreviewLogs: (sessionId, tail) => this.sprintPreviewService.getLogs(sessionId, tail),
        getSprintPreviewLogsForProjectSprint: (projectId, sprintId, sessionId, tail) => this.sprintPreviewService.getLogsForProjectSprint(projectId, sprintId, sessionId, tail),
        proxySprintPreviewRequest: (args) => this.sprintPreviewService.proxyRequest(args),
        proxySprintPreviewRequestForProjectSprint: (projectId, sprintId, args) => this.sprintPreviewService.proxyRequestForProjectSprint(projectId, sprintId, args),
        listFileBrowserSessions: (projectId) => this.sprintFileBrowserService.listSessions(projectId),
        startFileBrowserSession: (projectId, sprintId) => this.sprintFileBrowserService.startSession(projectId, sprintId),
        rebuildFileBrowserSession: (sessionId) => this.sprintFileBrowserService.rebuildSession(sessionId),
        stopFileBrowserSession: (sessionId) => this.sprintFileBrowserService.stopSession(sessionId),
        removeFileBrowserSession: (sessionId) => this.sprintFileBrowserService.removeSession(sessionId),
        getFileBrowserTree: (sessionId) => this.sprintFileBrowserService.getTree(sessionId),
        readFileBrowserFile: (sessionId, filePath) => this.sprintFileBrowserService.readFile(sessionId, filePath),
        getFileBrowserChanges: (sessionId) => this.sprintFileBrowserService.getChangeSet(sessionId),
        getFileBrowserDiff: (sessionId, filePath) => this.sprintFileBrowserService.getDiff(sessionId, filePath),
        updateSprintBranch: (projectId, sprintId) => this.sprintBranchService.updateFromDefault(projectId, sprintId),
        syncGitSettingsFromDashboard: () => syncGitSettingsFromDashboard(this.runtimeContext),
        refreshJulesApiKey: () => this.refreshJulesApiKey(),
        setLogger: (logger) => { this.logger = logger; },
        LIVE_ACTIVITY_CACHE_MS: CodeUxServer.LIVE_ACTIVITY_CACHE_MS,
        memoryService: this.memoryService,
        memoryPromotionService: this.memoryPromotionService,
        embeddingModelManager: this.embeddingModelManager,
        embeddingService: this.embeddingService,
        memoryRepository: this.memoryRepository,
        localMcpCliConfigService: this.localMcpCliConfigService,
        getLocalMcpConnectionInfo: () => this.getConfiguredMcpConnectionInfo(),
        regenerateMcpHttpAuthToken: () => this.regenerateMcpHttpAuthToken(),
      });
    } else {
      this.logger.info("Dashboard startup skipped for Code UX runtime", {
        mode: this.appConfig.serverMode ? "server" : "headless",
      });
    }

    await bootMcpTransport({
      server: this.server,
      logger: this.logger,
    });
    const defaultMcpHttpPort = this.appConfig.dashboardPort + 1;
    const mcpHttpPort = this.appConfig.mcpHttpPort === defaultMcpHttpPort
      ? this.getDashboardPort() + 1
      : this.appConfig.mcpHttpPort;

    this.mcpHttpHandle = await bootMcpHttpTransport({
      enabled: this.appConfig.mcpHttpEnabled,
      host: this.appConfig.mcpHttpHost,
      port: mcpHttpPort,
      path: this.appConfig.mcpHttpPath,
      authToken: this.appConfig.mcpHttpAuthToken,
      getAuthToken: () => this.appConfig.mcpHttpAuthToken,
      requireAuth: this.appConfig.serverMode,
      maxSessions: this.appConfig.mcpHttpMaxSessions,
      sessionTimeoutMs: this.appConfig.mcpHttpSessionTimeoutMs,
      getReady: () => this.isReady(),
      logger: this.logger.child({ component: "mcp-http-transport" }),
      createServer: () => this.createMcpServerInstance("project_manager"),
      recoveryService: this.runtimeStartupRecoveryService,
      runStartupRecovery: false,
    });
    this.mcpServiceBound = true;
    this.startRuntimeCleanupLoop();
    this.startSprintPreviewLoop();
    this.startLiveSnapshotLoop();
    this.startWalCheckpointLoop();
    this.scheduleBackgroundStartupTasks();
  }
}
