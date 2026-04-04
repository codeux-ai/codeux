import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import axios from "axios";
import type { AxiosError } from "axios";
import express from "express";
import type { AppConfig } from "../config/app-config.js";
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
import { ExecutionRepository } from "../repositories/execution-repository.js";
import { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import { GitStatusService, type GitTrackingRequest } from "../services/git-status-service.js";
import { loadExternalSettingsHints } from "../config/external-settings.js";
import { InstructionService } from "../instructions/instruction-template-service.js";
import { CoreToolHandler } from "../mcp/core-tool-handler.js";
import { AgentToolHandler } from "../mcp/agent-tool-handler.js";
import { buildMissingJulesApiKeyMessage } from "../mcp/api-key-guidance.js";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import { DockerService } from "../services/docker-service.js";
import { CliWorkflowService } from "../services/cli-workflow-service.js";
import { ActivityCacheService } from "./activity-cache-service.js";
import { registerMcpRequestHandlers } from "./mcp-request-router.js";
import { TaskRerunService } from "../services/task-rerun-service.js";
import { ExecutionControlService } from "../services/execution-control-service.js";
import { JulesSourceResolver } from "../services/jules-source-resolver.js";
import { RuntimeCleanupService } from "../services/runtime-cleanup-service.js";
import { RuntimeStartupRecoveryService } from "../services/runtime-startup-recovery-service.js";
import { DashboardRealtimeService } from "../services/dashboard-realtime-service.js";
import { AgentPresetSyncService } from "../services/agent-preset-sync-service.js";
import { PlanningAgentService } from "../services/planning-agent-service.js";
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
import { getSprintSubtasksDir, SPRINT_OS_SERVICE_NAME } from "../shared/config/sprint-os-paths.js";
import { SprintMarkdownService } from "../services/sprint-markdown-service.js";
import { VirtualWorkerService } from "../services/virtual-worker-service.js";
import type { ProjectWorkerAssignmentService } from "../domain/workers/project-worker-assignment-service.js";
import { SprintPreviewRepository } from "../repositories/sprint-preview-repository.js";
import { SprintPreviewService } from "../services/sprint-preview-service.js";

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

export interface JulesAgentServerOptions {
  projectRoot: string;
  appConfig: AppConfig;
}

export class JulesAgentServer {
  private static readonly DASHBOARD_ACTIVITY_PAGE_SIZE = 20;
  private static readonly LIVE_ACTIVITY_CACHE_MS = 10_000;
  private static readonly GIT_STATUS_CACHE_MS = 10_000;
  private static readonly RUNTIME_CLEANUP_INTERVAL_MS = 15_000;
  private static readonly LIVE_SNAPSHOT_REFRESH_INTERVAL_MS = 30_000;
  private static activeSigintHandler: (() => void) | null = null;
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
  private projectRuntimeRepository: ProjectRuntimeRepository;
  private connectionChatRepository: ConnectionChatRepository;
  private projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  private projectWorkerAssignmentService: ProjectWorkerAssignmentService;
  private projectAttentionRepository: ProjectAttentionRepository;
  private agentPresetRepository: AgentPresetRepository;
  private dockerService: DockerService;
  private sprintPreviewRepository: SprintPreviewRepository;
  private sprintPreviewService: SprintPreviewService;
  private agentPresetSyncService: AgentPresetSyncService;
  private executionRepository: ExecutionRepository;
  private sprintMarkdownService: SprintMarkdownService;
  private virtualWorkerService: VirtualWorkerService;
  private externalSettingsHints: ExternalSettingsHints;
  private instructionService: InstructionService;
  private sessionTracking: SessionTrackingRepository;
  private cliWorkflowService: CliWorkflowService;
  private coreToolHandler: CoreToolHandler;
  private agentToolHandler: AgentToolHandler;
  private activityCacheService: ActivityCacheService;
  private taskRerunService: TaskRerunService;
  private executionControlService: ExecutionControlService;
  private planningAgentService: PlanningAgentService;
  private quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;
  private chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;
  private runtimeCleanupService: RuntimeCleanupService;
  private runtimeStartupRecoveryService: RuntimeStartupRecoveryService;
  private dashboardRealtimeService: DashboardRealtimeService;
  private memoryService: import("../services/memory-service.js").MemoryService;
  private memoryPromotionService: import("../services/memory-promotion-service.js").MemoryPromotionService;
  private embeddingModelManager: import("../services/embedding-model-manager.js").EmbeddingModelManager;
  private embeddingService: import("../services/embedding-service.js").EmbeddingService;
  private memoryRepository: import("../repositories/memory-repository.js").MemoryRepository;
  private runtimeCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private sprintPreviewInterval: ReturnType<typeof setInterval> | null = null;
  private liveSnapshotInterval: ReturnType<typeof setInterval> | null = null;
  private mcpHttpHandle: McpHttpTransportHandle | null = null;
  private mcpServiceBound = false;
  private readonly sigintHandler: () => void;

  constructor(options: JulesAgentServerOptions) {
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
    this.projectRuntimeRepository = deps.projectRuntimeRepository;
    this.connectionChatRepository = deps.connectionChatRepository;
    this.projectWorkerAssignmentRepository = deps.projectWorkerAssignmentRepository;
    this.projectWorkerAssignmentService = deps.projectWorkerAssignmentService;
    this.projectAttentionRepository = deps.projectAttentionRepository;
    this.agentPresetRepository = deps.agentPresetRepository;
    this.agentPresetSyncService = deps.agentPresetSyncService;
    this.executionRepository = deps.executionRepository;
    this.sprintPreviewRepository = new SprintPreviewRepository(this.appDbStorage);
    this.sprintPreviewService = new SprintPreviewService({
      sprintPreviewRepository: this.sprintPreviewRepository,
      projectManagementRepository: this.projectManagementRepository,
      executionRepository: this.executionRepository,
      settingsRepository: this.settingsRepository,
      logger: this.logger.child({ component: "sprint-preview-service" }),
    });
    this.sprintMarkdownService = deps.sprintMarkdownService;
    this.virtualWorkerService = deps.virtualWorkerService;
    this.externalSettingsHints = deps.externalSettingsHints;
    this.instructionService = deps.instructionService;
    this.sessionTracking = deps.sessionTracking;
    this.cliWorkflowService = deps.cliWorkflowService;
    this.coreToolHandler = deps.coreToolHandler;
    this.agentToolHandler = deps.agentToolHandler;
    this.activityCacheService = deps.activityCacheService;
    this.taskRerunService = deps.taskRerunService;
    this.executionControlService = deps.executionControlService;
    this.planningAgentService = deps.planningAgentService;
    this.quicksprintService = deps.quicksprintService;
    this.chatThreadRuntimeService = deps.chatThreadRuntimeService;
    this.runtimeCleanupService = deps.runtimeCleanupService;
    this.runtimeStartupRecoveryService = new RuntimeStartupRecoveryService({
      sessionTracking: this.sessionTracking,
      executionRepository: this.executionRepository,
      projectManagementRepository: this.projectManagementRepository,
      sprintOrchestrator: this.sprintOrchestrator,
      logger: this.logger.child({ component: "runtime-startup-recovery-service" }),
    });
    this.dashboardRealtimeService = deps.dashboardRealtimeService;
    this.memoryService = deps.memoryService;
    this.memoryPromotionService = deps.memoryPromotionService;
    this.embeddingModelManager = deps.embeddingModelManager;
    this.embeddingService = deps.embeddingService;
    this.memoryRepository = deps.memoryRepository;

    this.configureMcpServer(this.server, this.appConfig.runtimeRole);

    this.sigintHandler = () => {
      void this.handleSigint();
    };

    if (JulesAgentServer.activeSigintHandler) {
      process.off("SIGINT", JulesAgentServer.activeSigintHandler);
    }
    process.on("SIGINT", this.sigintHandler);
    JulesAgentServer.activeSigintHandler = this.sigintHandler;
  }

  private async handleSigint(): Promise<void> {
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
    if (this.mcpHttpHandle) {
      await this.mcpHttpHandle.close().catch(() => undefined);
      this.mcpHttpHandle = null;
    }
    this.virtualWorkerService.stop();
    await this.server.close();
    process.exit(0);
  }

  private configureMcpServer(server: Server, runtimeRole: "project_manager" | "worker_host" | "worker_gateway"): void {
    registerMcpRequestHandlers({
      server,
      coreToolHandler: this.coreToolHandler,
      agentToolHandler: this.agentToolHandler,
      getDashboardSettings: () => this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
      getRuntimeRole: () => runtimeRole,
      formatError: (error: unknown) => this.formatError(error),
      logger: this.logger.child({ component: "mcp-request-router", runtimeRole }),
      withCorrelationContext: (request, operation) => this.runWithMcpCorrelationContext(request, operation),
    });

    server.onerror = (error) => {
      this.logger.error("MCP server error", { error, runtimeRole });
    };
  }

  private createMcpServerInstance(runtimeRole: "project_manager" | "worker_host" | "worker_gateway"): Server {
    const server = new Server(
      {
        name: SPRINT_OS_SERVICE_NAME,
        version: "1.2.0",
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
    if (this.appConfig.runtimeRole !== "project_manager" || this.runtimeCleanupInterval) {
      return;
    }

    const runCleanup = (): void => {
      try {
        this.runtimeCleanupService.cleanup();
      } catch (error) {
        this.logger.error("Runtime cleanup sweep failed", { error });
      }
    };

    const initialTimer = setTimeout(runCleanup, 0);
    initialTimer.unref?.();
    this.runtimeCleanupInterval = setInterval(runCleanup, JulesAgentServer.RUNTIME_CLEANUP_INTERVAL_MS);
    this.runtimeCleanupInterval.unref?.();
  }

  private startSprintPreviewLoop(): void {
    if (this.appConfig.runtimeRole !== "project_manager" || this.sprintPreviewInterval) {
      return;
    }

    const reconcile = (): void => {
      void this.sprintPreviewService.reconcileSessions().catch((error) => {
        this.logger.error("Sprint preview reconciliation failed", { error });
      });
    };

    const initialTimer = setTimeout(reconcile, 0);
    initialTimer.unref?.();
    this.sprintPreviewInterval = setInterval(reconcile, JulesAgentServer.RUNTIME_CLEANUP_INTERVAL_MS);
    this.sprintPreviewInterval.unref?.();
  }

  private startLiveSnapshotLoop(): void {
    if (this.appConfig.runtimeRole !== "project_manager" || this.liveSnapshotInterval) {
      return;
    }

    const refreshLiveSnapshot = (): void => {
      const projectId = this.projectManagementRepository.getSelectedProjectId();
      if (!projectId) {
        return;
      }

      this.dashboardRealtimeService.scheduleProjectLiveRefresh(projectId);
    };

    const initialTimer = setTimeout(refreshLiveSnapshot, 0);
    initialTimer.unref?.();
    this.liveSnapshotInterval = setInterval(refreshLiveSnapshot, JulesAgentServer.LIVE_SNAPSHOT_REFRESH_INTERVAL_MS);
    this.liveSnapshotInterval.unref?.();
  }

  private createContext(): ServerContext {
    return {
      runtimeContext: this.runtimeContext,
      getProjectRoot: () => this.projectRoot,
      getAppConfig: () => this.appConfig,
      getEffectiveJulesApiKey: () => this.getEffectiveJulesApiKey(),
      getEffectiveGithubToken: () => this.getEffectiveGithubToken(),
      getDashboardPort: () => this.getDashboardPort(),
      isJulesApiConfigured: () => this.isJulesApiConfigured(),
      getMissingJulesApiKeyInstruction: () => this.getMissingJulesApiKeyInstruction(),
      isActionRequiredState: (state) => this.isActionRequiredState(state),
      resolveSessionName: (session) => this.resolveSessionName(session),
      extractSessionId: (session) => this.extractSessionId(session),
      fetchRecentActivities: (sessionName, pageSize) => this.fetchRecentActivities(sessionName, pageSize),
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
    };
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
    const uiProviderKey = settings.aiProvider?.providers?.jules?.apiKey?.trim();
    if (uiProviderKey && uiProviderKey.length > 0) {
      return uiProviderKey;
    }
    const uiKey = settings.aiProvider?.julesApiKey?.trim();
    if (uiKey && uiKey.length > 0) {
      return uiKey;
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

  private getMissingJulesApiKeyInstruction(): string {
    return buildMissingJulesApiKeyMessage(this.getDashboardPort());
  }

  private getEffectiveGithubToken(): string | undefined {
    const settings = this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
    const uiToken = settings.git?.githubToken?.trim();
    if (uiToken && uiToken.length > 0) {
      return uiToken;
    }
    const liveEnvToken = process.env.GITHUB_TOKEN?.trim();
    if (liveEnvToken && liveEnvToken.length > 0) {
      return liveEnvToken;
    }
    const fallback = this.externalSettingsHints?.resolved?.githubToken?.trim();
    return (fallback && fallback.length > 0) ? fallback : undefined;
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
    if (ci.enabled && ci.waitForCiBeforeFeatureMerge && hasRunningTasks && featureBranch) {
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

    const isReady = settingsDbUp && dashboardBindUp && mcpServiceUp && !!this.projectRuntimeRepository.getSelectedProjectLiveStatus().timestamp;

    return {
      status: isReady ? "READY" : "NOT_READY",
      components: {
        settingsDb: settingsDbUp ? "UP" : "DOWN",
        dashboardBind: dashboardBindUp ? "UP" : "DOWN",
        mcpService: mcpServiceUp ? "UP" : "DOWN",
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
    const subtasksDir = getSprintSubtasksDir(args.repoPath, args.sprintNumber);
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
    const tracked = this.sessionTracking.listSessions(300).sessions;
    let julesSessions: JulesSession[] = [];
    if (this.isJulesApiConfigured()) {
      try {
        const remote = await this.julesApi.listSessions({ page_size: 100 });
        julesSessions = (remote.sessions || []).map((session) => ({ ...session, provider: "jules" }));
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

  private async fetchRecentActivities(sessionName: string, pageSize: number = JulesAgentServer.DASHBOARD_ACTIVITY_PAGE_SIZE): Promise<JulesActivity[]> {
    if (this.isTrackedCliSession(sessionName)) {
      return this.sessionTracking.fetchRecentActivities(sessionName, pageSize);
    }
    if (!this.isJulesApiConfigured()) {
      return [];
    }
    return this.julesApi.fetchRecentActivities(sessionName, pageSize);
  }

  private async fetchGitStatusForRepo(repoPath: string, cacheTtlMs?: number): Promise<GitTrackingStatus> {
    const gitStatusService = new GitStatusService(repoPath);
    const settings = this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
    return await gitStatusService.getStatus(
      settings.git.githubMode,
      this.getEffectiveGithubToken(),
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
      const gitStatusService = new GitStatusService(this.resolveGitStatusRepoPath());
      return await gitStatusService.getStatus(
        "REMOTE",
        this.getEffectiveGithubToken(),
        { scope: "REPOSITORY" },
        JulesAgentServer.GIT_STATUS_CACHE_MS,
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
    const gitStatusService = new GitStatusService(args.repoPath);
    try {
      const trackingRequest = {
        scope: args.scope,
        featureBranch: args.featureBranch,
        defaultBranch: args.defaultBranch,
        featureBranchPrefix: args.featureBranchPrefix,
      };
      return typeof args.cacheTtlMs === "number"
        ? await gitStatusService.getStatus(
            "REMOTE",
            this.getEffectiveGithubToken(),
            trackingRequest,
            args.cacheTtlMs,
          )
        : await gitStatusService.getStatus(
            "REMOTE",
            this.getEffectiveGithubToken(),
            trackingRequest,
          );
    } catch {
      return null;
    }
  }

  private async autoMergeFeaturePr(args: AutoMergeFeaturePrArgs): Promise<AutoMergeFeaturePrResult> {
    const gitStatusService = new GitStatusService(args.repoPath);
    try {
      const result = await gitStatusService.mergePullRequest(args.prNumber, this.getEffectiveGithubToken());
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
  }): Promise<{ created: boolean; prNumber: number | null; prUrl: string | null } | null> {
    const gitStatusService = new GitStatusService(args.repoPath);
    try {
      return await gitStatusService.resolveOrCreatePullRequest({
        baseBranch: args.defaultBranch,
        headBranch: args.featureBranch,
        title: args.title,
        body: args.body,
      }, this.getEffectiveGithubToken());
    } catch {
      return null;
    }
  }

  private async getLiveActivitiesForActiveTasks(): Promise<Record<string, JulesActivity[]>> {
    return await this.activityCacheService.getLiveActivitiesForActiveTasks();
  }

  async run() {
    await bootSettings({
      runtimeContext: this.runtimeContext,
      projectRoot: this.projectRoot,
      logger: this.logger,
    });
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
    try {
      await this.sprintPreviewService.cleanupStaleContainersOnStartup();
    } catch (error) {
      this.logger.error("Failed to clean up stale sprint preview containers on startup", { error });
    }
    let recoveredSprintRunIds: string[] = [];
    try {
      const recoveryResult = await this.runtimeStartupRecoveryService.recover();
      recoveredSprintRunIds = recoveryResult.resumedSprintRunIds;
    } catch (error) {
      this.logger.error("Failed to recover runtime state on startup", { error });
    }

    if (this.isDashboardEnabled()) {
      await bootDashboard({
        app: this.app,
        projectRoot: this.projectRoot,
        getDashboardPort: () => this.getDashboardPort(),
        runtimeContext: this.runtimeContext,
        externalSettingsHints: this.externalSettingsHints,
        appDbStorage: this.appDbStorage,
        settingsRepository: this.settingsRepository,
        projectManagementRepository: this.projectManagementRepository,
        projectRuntimeRepository: this.projectRuntimeRepository,
        executionRepository: this.executionRepository,
        connectionChatRepository: this.connectionChatRepository,
        projectWorkerAssignmentRepository: this.projectWorkerAssignmentRepository,
        projectWorkerAssignmentService: this.projectWorkerAssignmentService,
        projectAttentionRepository: this.projectAttentionRepository,
        agentPresetRepository: this.agentPresetRepository,
        agentPresetSyncService: this.agentPresetSyncService,
        sprintMarkdownService: this.sprintMarkdownService,
        activityCacheService: this.activityCacheService,
        taskRerunService: this.taskRerunService,
        executionControlService: this.executionControlService,
        planningAgentService: this.planningAgentService,
        quicksprintService: this.quicksprintService,
        chatThreadRuntimeService: this.chatThreadRuntimeService,
        dashboardRealtimeService: this.dashboardRealtimeService,
        logger: this.logger,
        getLiveActivitiesForActiveTasks: () => this.getLiveActivitiesForActiveTasks(),
        getGitStatus: () => this.getGitStatus(),
        isReady: () => this.isReady(),
        isHealthy: () => this.isHealthy(),
        listDockerContainers: () => this.dockerService.listContainers(),
        listSprintPreviewSessions: (projectId) => this.sprintPreviewService.listSessions(projectId),
        getSprintPreviewSession: (sessionId: string) => this.sprintPreviewService.getSession(sessionId),
        startSprintPreviewSession: (projectId, sprintId) => this.sprintPreviewService.startSession(projectId, sprintId),
        rebuildSprintPreviewSession: (sessionId) => this.sprintPreviewService.rebuildSession(sessionId),
        stopSprintPreviewSession: (sessionId) => this.sprintPreviewService.stopSession(sessionId),
        removeSprintPreviewSession: (sessionId) => this.sprintPreviewService.removeSession(sessionId),
        getSprintPreviewScript: (projectId, sprintId) => this.sprintPreviewService.getScript(projectId, sprintId),
        saveSprintPreviewScript: (projectId, sprintId, content) => this.sprintPreviewService.saveScript(projectId, sprintId, content),
        getSprintPreviewLogs: (sessionId, tail) => this.sprintPreviewService.getLogs(sessionId, tail),
        proxySprintPreviewRequest: (args) => this.sprintPreviewService.proxyRequest(args),
        syncGitSettingsFromDashboard: () => syncGitSettingsFromDashboard(this.runtimeContext),
        refreshJulesApiKey: () => this.refreshJulesApiKey(),
        setLogger: (logger) => { this.logger = logger; },
        LIVE_ACTIVITY_CACHE_MS: JulesAgentServer.LIVE_ACTIVITY_CACHE_MS,
        memoryService: this.memoryService,
        memoryPromotionService: this.memoryPromotionService,
        embeddingModelManager: this.embeddingModelManager,
        embeddingService: this.embeddingService,
        memoryRepository: this.memoryRepository,
      });

      // Trigger rehydration of the dashboard after it's fully booted and configured
      if (recoveredSprintRunIds.length > 0) {
        for (const runId of recoveredSprintRunIds) {
           const sprintRun = this.executionRepository.getSprintRun(runId);
           if (sprintRun) {
               this.dashboardRealtimeService.scheduleProjectLiveRefresh(sprintRun.projectId);
           }
        }
      }
    } else {
      this.logger.info("Dashboard startup skipped for headless Sprint OS runtime", {
        runtimeRole: this.appConfig.runtimeRole,
      });
    }

    await bootMcpTransport({
      server: this.server,
      logger: this.logger,
      isJulesApiConfigured: () => this.isJulesApiConfigured(),
      getMissingJulesApiKeyInstruction: () => this.getMissingJulesApiKeyInstruction(),
    });
    this.mcpHttpHandle = await bootMcpHttpTransport({
      enabled: this.appConfig.mcpHttpEnabled,
      host: this.appConfig.mcpHttpHost,
      port: this.appConfig.mcpHttpPort,
      path: this.appConfig.mcpHttpPath,
      authToken: this.appConfig.mcpHttpAuthToken,
      logger: this.logger.child({ component: "mcp-http-transport" }),
      createServer: () => this.createMcpServerInstance("worker_gateway"),
    });
    this.mcpServiceBound = true;
    this.startRuntimeCleanupLoop();
    this.startSprintPreviewLoop();
    this.startLiveSnapshotLoop();
    this.virtualWorkerService.start();
  }
}
