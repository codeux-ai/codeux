import { setupDashboardServer } from "../../server/dashboard-server.js";
import { registerMemoryRoutes } from "../../server/memory-routes.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";
import { createLogger } from "../../shared/logging/logger.js";
import type { Express } from "express";
import type { Logger } from "../../shared/logging/logger.js";
import type { RuntimeContext } from "../runtime-context.js";
import type {
  ExecutionAttentionItemSummary,
  DockerContainer,
  ExecutionConnectionSummary,
  ExecutionAssignedWorkerSummary,
  ExternalSettingsHints,
  GitTrackingStatus,
  JulesActivity,
  ProjectLiveDashboardSnapshot,
  ProjectStatsQuery,
  ReadinessProbeStatus,
  SprintPreviewScript,
  SprintPreviewSession,
} from "../../contracts/app-types.js";
import type { McpConnectionRecord } from "../../contracts/connection-chat-types.js";
import type { AppDbStorage } from "../../repositories/app-db-storage.js";
import type { SettingsRepository } from "../../repositories/settings-repository.js";
import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ProjectRuntimeRepository } from "../../repositories/project-runtime-repository.js";
import type { ConnectionChatRepository } from "../../repositories/connection-chat-repository.js";
import type { ProjectWorkerAssignmentRepository } from "../../repositories/project-worker-assignment-repository.js";
import type { ProjectWorkerAssignmentService } from "../../domain/workers/project-worker-assignment-service.js";
import type { ProjectAttentionRepository } from "../../repositories/project-attention-repository.js";
import type { AgentPresetRepository } from "../../repositories/agent-preset-repository.js";
import type { AgentPresetSyncService } from "../../services/agent-preset-sync-service.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { SprintMarkdownService } from "../../services/sprint-markdown-service.js";
import type { ActivityCacheService } from "../../server/activity-cache-service.js";
import type { TaskRerunService } from "../../services/task-rerun-service.js";
import type { ExecutionControlService } from "../../services/execution-control-service.js";
import type { DashboardRealtimeService } from "../../services/dashboard-realtime-service.js";
import type { PlanningAgentService } from "../../services/planning-agent-service.js";
import type { ChatThreadRuntimeService } from "../../services/chat-thread-runtime-service.js";
import type { QuicksprintService } from "../../services/quicksprint-service.js";
import type { MemoryService } from "../../services/memory-service.js";
import type { MemoryPromotionService } from "../../services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../../services/embedding-model-manager.js";
import type { EmbeddingService } from "../../services/embedding-service.js";
import type { MemoryRepository } from "../../repositories/memory-repository.js";
import { getRepoDebugLogPath, SPRINT_OS_SERVICE_NAME } from "../../shared/config/sprint-os-paths.js";
import { getProjectLiveSnapshot } from "../live/project-live-snapshot.js";

export interface BootDashboardDeps {
  app: Express;
  projectRoot: string;
  getDashboardPort: () => number;
  runtimeContext: RuntimeContext;
  externalSettingsHints: ExternalSettingsHints;
  appDbStorage: AppDbStorage;
  settingsRepository: SettingsRepository;
  projectManagementRepository: ProjectManagementRepository;
  projectRuntimeRepository: ProjectRuntimeRepository;
  executionRepository: ExecutionRepository;
  connectionChatRepository: ConnectionChatRepository;
  projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  projectWorkerAssignmentService: ProjectWorkerAssignmentService;
  projectAttentionRepository: ProjectAttentionRepository;
  agentPresetRepository: AgentPresetRepository;
  agentPresetSyncService: AgentPresetSyncService;
  sprintMarkdownService: SprintMarkdownService;
  activityCacheService: ActivityCacheService;
  taskRerunService: TaskRerunService;
  executionControlService: ExecutionControlService;
  planningAgentService: PlanningAgentService;
  quicksprintService: QuicksprintService;
  chatThreadRuntimeService: ChatThreadRuntimeService;
  dashboardRealtimeService: DashboardRealtimeService;
  logger: Logger;
  getLiveActivitiesForActiveTasks: () => Promise<Record<string, JulesActivity[]>>;
  getGitStatus: () => Promise<GitTrackingStatus>;
  isReady: () => ReadinessProbeStatus;
  isHealthy: () => ReadinessProbeStatus;
  listDockerContainers: () => Promise<DockerContainer[]>;
  listSprintPreviewSessions: (projectId: string) => Promise<SprintPreviewSession[]>;
  getSprintPreviewSession: (sessionId: string) => Promise<SprintPreviewSession | null>;
  startSprintPreviewSession: (projectId: string, sprintId: string) => Promise<SprintPreviewSession>;
  rebuildSprintPreviewSession: (sessionId: string) => Promise<SprintPreviewSession>;
  stopSprintPreviewSession: (sessionId: string) => Promise<SprintPreviewSession>;
  getSprintPreviewScript: (projectId: string, sprintId: string) => Promise<SprintPreviewScript>;
  saveSprintPreviewScript: (projectId: string, sprintId: string, content: string) => Promise<SprintPreviewScript>;
  getSprintPreviewLogs: (sessionId: string, tail?: number) => Promise<{ logs: string }>;
  proxySprintPreviewRequest: (args: {
    sessionId: string;
    method: string;
    path: string;
    headers?: Record<string, string | undefined>;
    body?: Buffer;
  }) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
  syncGitSettingsFromDashboard: () => void;
  refreshJulesApiKey: () => void;
  setLogger: (logger: Logger) => void;
  LIVE_ACTIVITY_CACHE_MS: number;
  memoryService: MemoryService;
  memoryPromotionService: MemoryPromotionService;
  embeddingModelManager: EmbeddingModelManager;
  embeddingService: EmbeddingService;
  memoryRepository: MemoryRepository;
}

export function reinitializeLogger(deps: { projectRoot: string, runtimeContext: RuntimeContext }): Logger {
  const logFilePath = deps.runtimeContext.dashboardSettings?.enableDebugLogFile
    ? getRepoDebugLogPath(deps.projectRoot)
    : undefined;

  return createLogger({
    bindings: { service: SPRINT_OS_SERVICE_NAME },
    logFilePath,
  });
}

function mapExecutionConnections(connections: McpConnectionRecord[]): ExecutionConnectionSummary[] {
  return connections.map((connection) => ({
    id: connection.id,
    connectionKey: connection.connectionKey,
    displayName: connection.displayName,
    role: connection.role,
    transport: connection.transport,
    status: connection.status,
    model: typeof connection.capabilities.model === "string" ? connection.capabilities.model : null,
    instruction: typeof connection.capabilities.instruction === "string" ? connection.capabilities.instruction : null,
    labels: Array.isArray(connection.capabilities.labels)
      ? connection.capabilities.labels.map((label) => String(label || "").trim()).filter(Boolean)
      : [],
    listenMode: connection.capabilities.listenMode === true,
    machineName: typeof connection.capabilities.machineName === "string" ? connection.capabilities.machineName : null,
    platform: typeof connection.capabilities.platform === "string" ? connection.capabilities.platform : null,
    arch: typeof connection.capabilities.arch === "string" ? connection.capabilities.arch : null,
    localExecutionRuntime: typeof connection.capabilities.localExecutionRuntime === "string"
      ? connection.capabilities.localExecutionRuntime
      : null,
    lastHeartbeatAt: connection.lastHeartbeatAt,
    projectIds: connection.projectIds,
    activeProjectIds: connection.activeProjectIds,
    tasksRunCount: connection.tasksRunCount,
    threadCount: connection.threadCount,
    messageCount: connection.messageCount,
    pendingInboxCount: connection.pendingInboxCount,
    activeDispatchCount: connection.activeDispatchCount,
  }));
}

function mapAssignedWorkers(assignments: ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>): {
  primaryAssignedWorker: ExecutionAssignedWorkerSummary | null;
  overflowAssignedWorkers: ExecutionAssignedWorkerSummary[];
} {
  const mapped = assignments.map((assignment) => ({
    assignmentId: assignment.id,
    workerEndpointId: assignment.workerEndpointId,
    workerEndpointKey: assignment.workerEndpointKey,
    workerEndpointType: assignment.workerEndpointType,
    workerDisplayName: assignment.workerDisplayName,
    connectionId: assignment.connectionId,
    connectionKey: assignment.connectionKey,
    transport: assignment.transport,
    assignmentRole: assignment.assignmentRole,
    status: assignment.status,
    assignedAt: assignment.assignedAt,
    lastAffinityAt: assignment.lastAffinityAt,
    workerStatus: assignment.workerStatus,
    canSuperviseProjects: assignment.capabilities.canSuperviseProjects,
    canExecuteTasks: assignment.capabilities.canExecuteTasks,
  }));

  return {
    primaryAssignedWorker: mapped.find((assignment) => assignment.assignmentRole === "primary") || null,
    overflowAssignedWorkers: mapped.filter((assignment) => assignment.assignmentRole === "overflow"),
  };
}

function mapAttentionItems(attentionItems: ReturnType<ProjectAttentionRepository["listProjectAttentionItems"]>) {
  return attentionItems.map((item) => ({
    id: item.id,
    sprintId: item.sprintId,
    taskId: item.taskId,
    sprintRunId: item.sprintRunId,
    dispatchId: item.dispatchId,
    attentionType: item.attentionType,
    severity: item.severity,
    ownerType: item.ownerType,
    status: item.status,
    assignedWorkerEndpointId: item.assignedWorkerEndpointId,
    title: item.title,
    summaryMarkdown: item.summaryMarkdown,
    payload: item.payload,
    openedAt: item.openedAt,
    claimedAt: item.claimedAt,
    resolvedAt: item.resolvedAt,
    updatedAt: item.updatedAt,
  }));
}

function mapAttentionItem(item: NonNullable<ReturnType<ProjectAttentionRepository["getAttentionItem"]>>): ExecutionAttentionItemSummary {
  return {
    id: item.id,
    sprintId: item.sprintId,
    taskId: item.taskId,
    sprintRunId: item.sprintRunId,
    dispatchId: item.dispatchId,
    attentionType: item.attentionType,
    severity: item.severity,
    ownerType: item.ownerType,
    status: item.status,
    assignedWorkerEndpointId: item.assignedWorkerEndpointId,
    title: item.title,
    summaryMarkdown: item.summaryMarkdown,
    payload: item.payload,
    openedAt: item.openedAt,
    claimedAt: item.claimedAt,
    resolvedAt: item.resolvedAt,
    updatedAt: item.updatedAt,
  };
}

function requireProjectAttentionItem(
  deps: Pick<BootDashboardDeps, "projectAttentionRepository">,
  projectId: string,
  attentionItemId: string,
) {
  const item = deps.projectAttentionRepository.getAttentionItem(attentionItemId);
  if (!item) {
    throw new Error(`Project attention item not found: ${attentionItemId}`);
  }
  if (item.projectId !== projectId) {
    throw new Error(`Attention item ${attentionItemId} does not belong to project ${projectId}.`);
  }
  return item;
}

function requireProject(
  deps: Pick<BootDashboardDeps, "projectManagementRepository">,
  projectId: string,
) {
  const project = deps.projectManagementRepository.getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  return project;
}

function resolveAttentionClaimWorkerEndpointId(
  deps: Pick<BootDashboardDeps, "projectWorkerAssignmentRepository">,
  projectId: string,
  preferredWorkerEndpointId?: string | null,
): string {
  if (preferredWorkerEndpointId) {
    return preferredWorkerEndpointId;
  }

  const assignments = deps.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, {
    activeOnly: true,
  });
  const primary = assignments.find((assignment) => (
    assignment.assignmentRole === "primary"
    && assignment.capabilities.canSuperviseProjects
    && assignment.workerStatus !== "stale"
    && assignment.workerStatus !== "offline"
  ));
  if (primary?.workerEndpointId) {
    return primary.workerEndpointId;
  }

  const overflow = assignments.find((assignment) => (
    assignment.assignmentRole === "overflow"
    && assignment.capabilities.canSuperviseProjects
    && assignment.workerStatus !== "stale"
    && assignment.workerStatus !== "offline"
  ));
  if (overflow?.workerEndpointId) {
    return overflow.workerEndpointId;
  }

  throw new Error(`No supervising worker is assigned to project ${projectId}.`);
}

export async function bootDashboard(deps: BootDashboardDeps): Promise<void> {
  const dashboardDir = `${deps.projectRoot}/dashboard`;
  const port = deps.getDashboardPort();
  const PROJECT_EXECUTION_CACHE_TTL_MS = 2_000;
  const PROJECT_STATS_CACHE_TTL_MS = 2_000;
  const OVERVIEW_CACHE_TTL_MS = 500;
  const PROJECTS_CACHE_TTL_MS = 500;

  const projectExecutionSnapshotCache = new Map<string, { snapshot: ReturnType<typeof deps.executionRepository.getProjectExecutionSnapshot>; expiresAt: number }>();
  const projectStatsSnapshotCache = new Map<string, { snapshot: ReturnType<typeof deps.executionRepository.getProjectStatsSnapshot>; expiresAt: number }>();
  let overviewTelemetryCache: { snapshot: ReturnType<typeof deps.executionRepository.getOverviewTelemetrySnapshot>; expiresAt: number } | null = null;
  let projectsSnapshotCache: { snapshot: ReturnType<typeof deps.projectManagementRepository.listProjects>; expiresAt: number } | null = null;

  const getProjectsSnapshot = () => {
    const now = Date.now();
    if (projectsSnapshotCache && projectsSnapshotCache.expiresAt > now) {
      return projectsSnapshotCache.snapshot;
    }
    const snapshot = deps.projectManagementRepository.listProjects();
    projectsSnapshotCache = {
      snapshot,
      expiresAt: now + PROJECTS_CACHE_TTL_MS,
    };
    return snapshot;
  };

  const getOverviewTelemetrySnapshot = () => {
    const now = Date.now();
    if (overviewTelemetryCache && overviewTelemetryCache.expiresAt > now) {
      return overviewTelemetryCache.snapshot;
    }
    const snapshot = deps.executionRepository.getOverviewTelemetrySnapshot();
    overviewTelemetryCache = {
      snapshot,
      expiresAt: now + OVERVIEW_CACHE_TTL_MS,
    };
    return snapshot;
  };

  const getProjectExecutionSnapshot = (projectId: string) => {
    const now = Date.now();
    const cached = projectExecutionSnapshotCache.get(projectId);
    if (cached && cached.expiresAt > now) {
      return cached.snapshot;
    }

    const assignedWorkers = mapAssignedWorkers(
      deps.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true }),
    );

    const snapshot = {
      ...deps.executionRepository.getProjectExecutionSnapshot(projectId),
      connections: mapExecutionConnections(deps.connectionChatRepository.listConnections(projectId)),
      ...assignedWorkers,
      attentionItems: mapAttentionItems(
        deps.projectAttentionRepository.listProjectAttentionItems(projectId, {
          statuses: ["open", "claimed"],
          limit: 50,
        }),
      ),
    };
    projectExecutionSnapshotCache.set(projectId, {
      snapshot,
      expiresAt: now + PROJECT_EXECUTION_CACHE_TTL_MS,
    });
    return snapshot;
  };

  const getProjectStatsSnapshot = (projectId: string, query: ProjectStatsQuery = { window: "7d" }) => {
    const now = Date.now();
    const cacheKey = `${projectId}:${JSON.stringify(query)}`;
    const cached = projectStatsSnapshotCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.snapshot;
    }
    const snapshot = deps.executionRepository.getProjectStatsSnapshot(projectId, query);
    projectStatsSnapshotCache.set(cacheKey, {
      snapshot,
      expiresAt: now + PROJECT_STATS_CACHE_TTL_MS,
    });
    return snapshot;
  };


  deps.dashboardRealtimeService.setSnapshotLoaders({
    getProjectsSnapshot,
    getProjectExecutionSnapshot,
    getProjectStatusSnapshot: (projectId) => deps.projectRuntimeRepository.getProjectLiveStatus(projectId),
    getProjectLiveSnapshot: (projectIdHint) => getProjectLiveSnapshot({
      projectManagementRepository: deps.projectManagementRepository,
      projectRuntimeRepository: deps.projectRuntimeRepository,
      getProjectExecutionSnapshot,
      getGitStatus: deps.getGitStatus,
      getStartupState: () => deps.runtimeContext.startupState.getSnapshot(),
      logger: deps.logger.child({ component: "project-live-snapshot" })
    }, projectIdHint),
    getOverviewTelemetrySnapshot,
  });

  registerMemoryRoutes(deps.app, {
    memoryService: deps.memoryService,
    memoryPromotionService: deps.memoryPromotionService,
    embeddingModelManager: deps.embeddingModelManager,
    embeddingService: deps.embeddingService,
    memoryRepository: deps.memoryRepository,
    settingsRepository: deps.settingsRepository,
  });

  // Auto-restore previously active embedding model (fire-and-forget)
  deps.embeddingModelManager.restorePreviousModel().catch((error) => {
    deps.logger.warn(`Embedding model auto-restore failed: ${error}`);
  });

  const handle = await setupDashboardServer({
    app: deps.app,
    dashboardDir,
    port,
    liveActivityCacheMs: deps.LIVE_ACTIVITY_CACHE_MS,
    getStatus: () => deps.projectRuntimeRepository.getSelectedProjectLiveStatus(),
    getLiveSnapshot: (projectIdHint) => getProjectLiveSnapshot({
      projectManagementRepository: deps.projectManagementRepository,
      projectRuntimeRepository: deps.projectRuntimeRepository,
      getProjectExecutionSnapshot,
      getGitStatus: deps.getGitStatus,
      getStartupState: () => deps.runtimeContext.startupState.getSnapshot(),
      logger: deps.logger.child({ component: "project-live-snapshot" })
    }, projectIdHint),
    getExecutionSnapshot: () => {
      const projectId = deps.projectManagementRepository.getSelectedProjectId();
      return projectId
        ? getProjectExecutionSnapshot(projectId)
        : {
          projectId: null,
          projectName: null,
          sprintRuns: [],
          taskDispatches: [],
          connections: [],
          primaryAssignedWorker: null,
          overflowAssignedWorkers: [],
          attentionItems: [],
          recentEvents: [],
          updatedAt: null,
        };
    },
    getOverviewTelemetrySnapshot,
    getProjectExecutionSnapshot,
    getProjectStatsSnapshot,
    setPreferredWorker: (projectId, input) => {
      requireProject(deps, projectId);
      const assignments = deps.projectWorkerAssignmentService.setProjectPreferredWorker(projectId, input);
      projectExecutionSnapshotCache.delete(projectId);
      deps.dashboardRealtimeService.scheduleProjectExecutionRefresh(projectId, {
        includeOverview: false,
        includeProjects: false,
      });
      return mapAssignedWorkers(assignments);
    },
    claimAttentionItem: (projectId, attentionItemId, input) => {
      const item = requireProjectAttentionItem(deps, projectId, attentionItemId);
      const workerEndpointId = resolveAttentionClaimWorkerEndpointId(
        deps,
        projectId,
        input?.workerEndpointId || item.assignedWorkerEndpointId,
      );

      return mapAttentionItem(deps.projectAttentionRepository.claimAttentionItem(attentionItemId, {
        assignedWorkerEndpointId: workerEndpointId,
        claimReason: input?.claimReason,
      }));
    },
    resolveAttentionItem: (projectId, attentionItemId, input) => {
      requireProjectAttentionItem(deps, projectId, attentionItemId);
      return mapAttentionItem(deps.projectAttentionRepository.resolveAttentionItem(attentionItemId, {
        status: input?.status || "resolved",
        reason: input?.reason,
        resolutionSummaryMarkdown: input?.resolutionSummaryMarkdown,
      }));
    },
    getLiveActivities: deps.getLiveActivitiesForActiveTasks,
    getGitStatus: deps.getGitStatus,
    getExternalSettingsHints: () => deps.externalSettingsHints,
    getSystemSettings: () => deps.settingsRepository.getSystemSettings(),
    saveSystemSettings: (settings) => {
      const saved = deps.settingsRepository.saveSystemSettings(settings);
      deps.runtimeContext.dashboardSettings = deps.settingsRepository.getDefaultDashboardSettings();
      deps.syncGitSettingsFromDashboard();
      deps.refreshJulesApiKey();

      const newLogger = reinitializeLogger({
        projectRoot: deps.projectRoot,
        runtimeContext: deps.runtimeContext,
      });
      deps.setLogger(newLogger);
      deps.activityCacheService.invalidateGitStatusCache();
      return saved;
    },
    resetDatabase: () => {
      deps.appDbStorage.resetAllData();
      deps.settingsRepository.resetAllData();
      deps.runtimeContext.dashboardSettings = deps.settingsRepository.getDefaultDashboardSettings();
      deps.syncGitSettingsFromDashboard();
      deps.refreshJulesApiKey();

      const newLogger = reinitializeLogger({
        projectRoot: deps.projectRoot,
        runtimeContext: deps.runtimeContext,
      });
      deps.setLogger(newLogger);
      deps.activityCacheService.invalidateGitStatusCache();
      deps.projectManagementRepository.notifyProjectsUpdated();
      deps.dashboardRealtimeService.scheduleOverviewRefresh();
    },
    getProjectSettings: (projectId) => deps.settingsRepository.getProjectSettings(projectId),
    saveProjectSettings: (projectId, settings) => {
      const project = deps.projectManagementRepository.getProject(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }
      return deps.settingsRepository.saveProjectSettings(projectId, settings);
    },
    resetProjectSettings: (projectId) => {
      const project = deps.projectManagementRepository.getProject(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }
      deps.settingsRepository.resetProjectSettings(projectId);
    },
    getProjectEffectiveSettings: (projectId) => {
      const project = deps.projectManagementRepository.getProject(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }
      return deps.settingsRepository.resolveProjectDashboardSettings(projectId);
    },
    getSprintSettings: (sprintId) => deps.settingsRepository.getSprintSettings(sprintId),
    saveSprintSettings: (projectId, sprintId, settings) => {
      const sprint = deps.projectManagementRepository.getSprint(sprintId);
      if (!sprint || sprint.projectId !== projectId) {
        throw new Error(`Sprint not found in project: ${sprintId}`);
      }
      return deps.settingsRepository.saveSprintSettings(sprintId, deps.settingsRepository.getProjectResolvedSettings(projectId), settings);
    },
    resetSprintSettings: (sprintId) => {
      const sprint = deps.projectManagementRepository.getSprint(sprintId);
      if (!sprint) {
        throw new Error(`Sprint not found: ${sprintId}`);
      }
      deps.settingsRepository.resetSprintSettings(sprintId);
    },
    getSprintEffectiveSettings: (projectId, sprintId) => {
      const sprint = deps.projectManagementRepository.getSprint(sprintId);
      if (!sprint || sprint.projectId !== projectId) {
        throw new Error(`Sprint not found in project: ${sprintId}`);
      }
      return deps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId);
    },
    listProjects: () => deps.projectManagementRepository.listProjects(),
    createProject: (input) => deps.projectManagementRepository.createProject(input),
    getProject: (projectId) => deps.projectManagementRepository.getProject(projectId),
    updateProject: (projectId, input) => deps.projectManagementRepository.updateProject(projectId, input),
    deleteProject: (projectId) => deps.projectManagementRepository.deleteProject(projectId),
    selectProject: (projectId) => {
      const selectedProjectId = deps.projectManagementRepository.setSelectedProjectId(projectId);
      deps.projectManagementRepository.notifyProjectsUpdated();
      return selectedProjectId;
    },
    selectSprint: (projectId, sprintId) => {
      const selectedSprintId = deps.projectManagementRepository.setSelectedSprintId(projectId, sprintId);
      deps.dashboardRealtimeService.scheduleProjectExecutionRefresh(projectId, {
        includeOverview: false,
        includeProjects: false,
      });
      deps.dashboardRealtimeService.scheduleProjectStructureRefresh(projectId, { includeProjects: true });
      return selectedSprintId;
    },
    listSprints: (projectId) => deps.projectManagementRepository.listSprints(projectId),
    createSprint: (projectId, input) => deps.projectManagementRepository.createSprint(projectId, input),
    updateSprint: (sprintId, input) => deps.projectManagementRepository.updateSprint(sprintId, input),
    deleteSprint: (sprintId) => deps.projectManagementRepository.deleteSprint(sprintId),
    importSprintFromMarkdown: (projectId, input) => deps.sprintMarkdownService.importSprint(projectId, input),
    exportSprintToMarkdown: (projectId, sprintId) => deps.sprintMarkdownService.exportSprint(projectId, sprintId),
    listTasks: (projectId, sprintId) => deps.projectManagementRepository.listTasks(projectId, sprintId),
    createTask: (projectId, input) => deps.projectManagementRepository.createTask(projectId, input),
    updateTask: (taskId, input) => deps.projectManagementRepository.updateTask(taskId, input),
    deleteTask: (taskId) => deps.projectManagementRepository.deleteTask(taskId),
    listConnections: (projectId) => deps.connectionChatRepository.listConnections(projectId),
    updateConnection: (connectionId, input) => deps.connectionChatRepository.updateConnection(connectionId, input),
    listAgentPresets: async (projectId) => await deps.agentPresetSyncService.listAgentPresets(projectId),
    createAgentPreset: async (projectId, input) => await deps.agentPresetSyncService.createAgentPreset(projectId, input),
    updateAgentPreset: async (agentPresetId, input) => await deps.agentPresetSyncService.updateAgentPreset(agentPresetId, input),
    deleteAgentPreset: async (agentPresetId) => await deps.agentPresetSyncService.deleteAgentPreset(agentPresetId),
    importAgentPresetFromMarkdown: async (agentPresetId) => await deps.agentPresetSyncService.importAgentPresetFromMarkdown(agentPresetId),
    syncAllAgentPresetsFromMarkdown: async (projectId) => await deps.agentPresetSyncService.syncAllAgentPresetsFromMarkdown(projectId),
    listConversationThreads: (projectId) => deps.connectionChatRepository.listThreads(projectId),
    createConversationThread: (projectId, input) => deps.connectionChatRepository.createThread(projectId, input),
    updateConversationThread: (threadId, input) => deps.connectionChatRepository.updateThread(threadId, input),
    updateThreadRoute: (threadId, input) => deps.chatThreadRuntimeService.updateThreadRoute(threadId, input),
    compactThreadSession: (threadId) => deps.chatThreadRuntimeService.compactThreadSession(threadId),
    deleteConversationThread: (threadId) => deps.connectionChatRepository.deleteThread(threadId),
    listConversationMessages: (threadId) => deps.connectionChatRepository.listMessages(threadId),
    postConversationMessage: (projectId, input) => deps.chatThreadRuntimeService.postMessage(projectId, input),

    listProjectInvocations: (projectId) => deps.executionRepository.listExecutionInvocations({ projectId }),
    listInvocationMessages: (invocationId) => deps.executionRepository.listExecutionInvocationMessages(invocationId),

    rerunTask: async (taskId: string, options?: { provider?: string; clearWorktree?: boolean }) => {
      const task = await deps.taskRerunService.rerunTask(taskId, {
        provider: options?.provider as import("../../contracts/app-types.js").ProviderId | undefined,
        clearWorktree: options?.clearWorktree,
      });
      deps.activityCacheService.invalidateGitStatusCache();
      return task;
    },
    improveSprintPrompt: async (projectId, input, signal) => {
      return await deps.planningAgentService.improveSprintPrompt(projectId, input, signal);
    },
    orchestrateSprint: async (projectId, sprintId) => {
      const result = await deps.executionControlService.orchestrateSprint(projectId, sprintId);
      deps.activityCacheService.invalidateGitStatusCache();
      return result;
    },
    planSprint: async (projectId, sprintId, input, signal) => {
      const result = await deps.planningAgentService.planSprint(projectId, sprintId, input, signal);
      deps.activityCacheService.invalidateGitStatusCache();
      return result;
    },
    pauseSprintRun: async (sprintRunId) => deps.executionControlService.pauseSprintRun(sprintRunId),
    cancelSprintRun: async (sprintRunId) => deps.executionControlService.cancelSprintRun(sprintRunId),
    forceCancelSprintRun: async (sprintRunId) => deps.executionControlService.forceCancelSprintRun(sprintRunId),
    cancelTaskDispatch: async (dispatchId) => deps.executionControlService.cancelTaskDispatch(dispatchId),
    forceCancelTaskDispatch: async (dispatchId) => deps.executionControlService.forceCancelTaskDispatch(dispatchId),
    retryTaskDispatch: async (dispatchId) => {
      const result = await deps.executionControlService.retryTaskDispatch(dispatchId);
      deps.activityCacheService.invalidateGitStatusCache();
      return result;
    },
    quicksprintService: deps.quicksprintService,
    realtimeService: deps.dashboardRealtimeService,
    logger: deps.logger.child({ component: "dashboard-server" }),
    isReady: deps.isReady,
    isHealthy: deps.isHealthy,
    listDockerContainers: deps.listDockerContainers,
    listSprintPreviewSessions: deps.listSprintPreviewSessions,
    getSprintPreviewSession: deps.getSprintPreviewSession,
    startSprintPreviewSession: deps.startSprintPreviewSession,
    rebuildSprintPreviewSession: deps.rebuildSprintPreviewSession,
    stopSprintPreviewSession: deps.stopSprintPreviewSession,
    getSprintPreviewScript: deps.getSprintPreviewScript,
    saveSprintPreviewScript: deps.saveSprintPreviewScript,
    getSprintPreviewLogs: deps.getSprintPreviewLogs,
    proxySprintPreviewRequest: deps.proxySprintPreviewRequest,
  });

  deps.runtimeContext.dashboardRuntimePort = handle.port;
}
