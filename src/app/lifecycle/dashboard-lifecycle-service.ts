import { setupDashboardServer, type DashboardServerHandle } from "../../server/dashboard-server.js";
import { InstructionFileService } from "../../services/instruction-file-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";
import { createLogger } from "../../shared/logging/logger.js";
import * as path from "path";
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
  OnboardingRuntimeReadiness,
  ProjectLiveDashboardSnapshot,
  ProjectStatsQuery,
  ReadinessProbeStatus,
  SprintPreviewScript,
  SprintPreviewSession,
  FileBrowserSession,
  FileBrowserTree,
  FileBrowserFileContent,
  FileBrowserChangeSet,
  FileBrowserDiff,
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
import type { SprintIssueService } from "../../services/sprint-issue-service.js";
import type { ActivityCacheService } from "../../server/activity-cache-service.js";
import type { TaskRerunService } from "../../services/task-rerun-service.js";
import type { ExecutionControlService } from "../../services/execution-control-service.js";
import type { DashboardRealtimeService } from "../../services/dashboard-realtime-service.js";
import type { PlanningAgentService } from "../../services/planning-agent-service.js";
import type { ChatThreadRuntimeService } from "../../services/chat-thread-runtime-service.js";
import type { QuicksprintService } from "../../services/quicksprint-service.js";
import type { ProjectSetupService } from "../../services/project-setup-service.js";
import type { SchedulerService } from "../../services/scheduler-service.js";
import type { MemoryService } from "../../services/memory-service.js";
import type { KnowledgeService } from "../../services/knowledge-service.js";
import type { MemoryPromotionService } from "../../services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../../services/embedding-model-manager.js";
import type { EmbeddingService } from "../../services/embedding-service.js";
import type { MemoryRepository } from "../../repositories/memory-repository.js";
import { getRepoDebugLogPath, CODE_UX_SERVICE_NAME } from "../../shared/config/code-ux-paths.js";
import { getProjectLiveSnapshot } from "../live/project-live-snapshot.js";
import { DashboardSnapshotCache, mapAssignedWorkers } from "./dashboard-snapshot-cache.js";
import { prepareGitProjectCreateInput } from "../../services/project-git-clone-service.js";
import { getOnboardingRuntimeReadiness } from "../../services/onboarding-readiness-service.js";

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
  projectSetupService: ProjectSetupService;
  schedulerService: SchedulerService;
  sprintIssueService: SprintIssueService;
  chatThreadRuntimeService: ChatThreadRuntimeService;
  dashboardRealtimeService: DashboardRealtimeService;
  logger: Logger;
  getLiveActivitiesForActiveTasks: () => Promise<Record<string, JulesActivity[]>>;
  getGitStatus: () => Promise<GitTrackingStatus>;
  isReady: () => ReadinessProbeStatus;
  isHealthy: () => ReadinessProbeStatus;
  listDockerContainers: () => Promise<DockerContainer[]>;
  getOnboardingRuntimeReadiness?: () => Promise<OnboardingRuntimeReadiness>;
  listSprintPreviewSessions: (projectId: string) => Promise<SprintPreviewSession[]>;
  getSprintPreviewSession: (sessionId: string) => Promise<SprintPreviewSession | null>;
  startSprintPreviewSession: (projectId: string, sprintId: string) => Promise<SprintPreviewSession>;
  rebuildSprintPreviewSession: (sessionId: string) => Promise<SprintPreviewSession>;
  stopSprintPreviewSession: (sessionId: string) => Promise<SprintPreviewSession>;
  removeSprintPreviewSession: (sessionId: string) => Promise<void>;
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
  listFileBrowserSessions: (projectId: string) => Promise<FileBrowserSession[]>;
  startFileBrowserSession: (projectId: string, sprintId: string) => Promise<FileBrowserSession>;
  rebuildFileBrowserSession: (sessionId: string) => Promise<FileBrowserSession>;
  stopFileBrowserSession: (sessionId: string) => Promise<FileBrowserSession>;
  removeFileBrowserSession: (sessionId: string) => Promise<void>;
  getFileBrowserTree: (sessionId: string) => Promise<FileBrowserTree>;
  readFileBrowserFile: (sessionId: string, filePath: string) => Promise<FileBrowserFileContent>;
  getFileBrowserChanges: (sessionId: string) => Promise<FileBrowserChangeSet>;
  getFileBrowserDiff: (sessionId: string, filePath: string) => Promise<FileBrowserDiff>;
  syncGitSettingsFromDashboard: () => void;
  refreshJulesApiKey: () => void;
  setLogger: (logger: Logger) => void;
  LIVE_ACTIVITY_CACHE_MS: number;
  memoryService: MemoryService;
  memoryPromotionService: MemoryPromotionService;
  embeddingModelManager: EmbeddingModelManager;
  embeddingService: EmbeddingService;
  memoryRepository: MemoryRepository;
  knowledgeService: KnowledgeService;
}

export function reinitializeLogger(deps: { projectRoot: string, runtimeContext: RuntimeContext }): Logger {
  return createLogger({
    bindings: { service: CODE_UX_SERVICE_NAME },
    getConsoleLogLevel: () => deps.runtimeContext.dashboardSettings?.consoleLogLevel,
    getDebugLogFileLevel: () => deps.runtimeContext.dashboardSettings?.debugLogFileLevel,
    getConsoleLogMode: () => deps.runtimeContext.dashboardSettings?.consoleLogMode,
    logFilePath: getRepoDebugLogPath(deps.projectRoot),
  });
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

function resolveGithubToken(deps: BootDashboardDeps): string | undefined {
  const dashboardToken = deps.runtimeContext.dashboardSettings?.git?.githubToken?.trim();
  if (dashboardToken) {
    return dashboardToken;
  }
  const fallback = deps.externalSettingsHints.resolved?.githubToken?.trim();
  return fallback || undefined;
}

function resolveGitlabToken(deps: BootDashboardDeps): string | undefined {
  const dashboardToken = deps.runtimeContext.dashboardSettings?.git?.gitlabToken?.trim();
  if (dashboardToken) {
    return dashboardToken;
  }
  const fallback = deps.externalSettingsHints.resolved?.gitlabToken?.trim();
  return fallback || undefined;
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

export async function bootDashboard(deps: BootDashboardDeps): Promise<DashboardServerHandle> {
  const dashboardDir = path.join(deps.projectRoot, "dashboard");
  const port = deps.getDashboardPort();

  const cache = new DashboardSnapshotCache({
    projectManagementRepository: deps.projectManagementRepository,
    executionRepository: deps.executionRepository,
    connectionChatRepository: deps.connectionChatRepository,
    projectWorkerAssignmentRepository: deps.projectWorkerAssignmentRepository,
    projectAttentionRepository: deps.projectAttentionRepository,
  });

  deps.dashboardRealtimeService.setCacheInvalidator(cache);

  deps.dashboardRealtimeService.setSnapshotLoaders({
    getProjectsSnapshot: cache.getProjectsSnapshot,
    getProjectExecutionSnapshot: cache.getProjectExecutionSnapshot,
    getProjectStatusSnapshot: (projectId) => deps.projectRuntimeRepository.getProjectLiveStatus(projectId),
    getProjectLiveSnapshot: (projectIdHint) => getProjectLiveSnapshot({
      projectManagementRepository: deps.projectManagementRepository,
      projectRuntimeRepository: deps.projectRuntimeRepository,
      getProjectExecutionSnapshot: cache.getProjectExecutionSnapshot,
      getGitStatus: deps.getGitStatus,
      logger: deps.logger.child({ component: "project-live-snapshot" })
    }, projectIdHint, { includeGit: false }),
    getProjectGitStatus: () => deps.getGitStatus(),
    getOverviewTelemetrySnapshot: cache.getOverviewTelemetrySnapshot,
  });

  deps.projectSetupService.setRealtimeNotifier(deps.dashboardRealtimeService);

  // Auto-restore previously active embedding model (fire-and-forget)
  deps.embeddingModelManager.restorePreviousModel().catch((error) => {
    deps.logger.warn(`Embedding model auto-restore failed: ${error}`);
  });
  deps.schedulerService?.start();

  const instructionFileService = new InstructionFileService({
    projectManagementRepository: deps.projectManagementRepository,
    logger: deps.logger.child({ component: "instruction-file-service" }),
  });

  const handle = await setupDashboardServer({
    app: deps.app,
    dashboardDir,
    port,
    liveActivityCacheMs: deps.LIVE_ACTIVITY_CACHE_MS,
    getStatus: () => deps.projectRuntimeRepository.getSelectedProjectLiveStatus(),
    memoryService: deps.memoryService,
    memoryPromotionService: deps.memoryPromotionService,
    embeddingModelManager: deps.embeddingModelManager,
    embeddingService: deps.embeddingService,
    memoryRepository: deps.memoryRepository,
    settingsRepository: deps.settingsRepository,
    knowledgeService: deps.knowledgeService,
    agentPresetRepository: deps.agentPresetRepository,
    projectManagementRepository: deps.projectManagementRepository,
    getLiveSnapshot: (projectIdHint) => getProjectLiveSnapshot({
      projectManagementRepository: deps.projectManagementRepository,
      projectRuntimeRepository: deps.projectRuntimeRepository,
      getProjectExecutionSnapshot: cache.getProjectExecutionSnapshot,
      getGitStatus: deps.getGitStatus,
      logger: deps.logger.child({ component: "project-live-snapshot" })
    }, projectIdHint, { includeGit: false }),
    getExecutionSnapshot: () => {
      const projectId = deps.projectManagementRepository.getSelectedProjectId();
      return projectId
        ? cache.getProjectExecutionSnapshot(projectId)
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
    getOverviewTelemetrySnapshot: cache.getOverviewTelemetrySnapshot,
    getProjectExecutionSnapshot: cache.getProjectExecutionSnapshot,
    getProjectStatsSnapshot: cache.getProjectStatsSnapshot,
    setPreferredWorker: (projectId, input) => {
      requireProject(deps, projectId);
      const assignments = deps.projectWorkerAssignmentService.setProjectPreferredWorker(projectId, input);
      cache.invalidateProjectExecution(projectId);
      cache.invalidateOverview();
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
      cache.invalidateAll();
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
      cache.invalidateAll();
    },
    getProjectSettings: (projectId) => deps.settingsRepository.getProjectSettings(projectId),
    saveProjectSettings: (projectId, settings) => {
      const project = deps.projectManagementRepository.getProject(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }
      const saved = deps.settingsRepository.saveProjectSettings(projectId, settings);
      cache.invalidateProjectExecution(projectId);
      cache.invalidateProjects();
      deps.dashboardRealtimeService.scheduleProjectStructureRefresh(projectId, { includeProjects: true });
      return saved;
    },
    resetProjectSettings: (projectId) => {
      const project = deps.projectManagementRepository.getProject(projectId);
      if (!project) {
        throw new Error(`Project not found: ${projectId}`);
      }
      deps.settingsRepository.resetProjectSettings(projectId);
      deps.dashboardRealtimeService.scheduleProjectStructureRefresh(projectId, { includeProjects: true });
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
      const saved = deps.settingsRepository.saveSprintSettings(sprintId, deps.settingsRepository.getProjectResolvedSettings(projectId), settings);
      cache.invalidateProjectExecution(projectId);
      cache.invalidateProjectStats(projectId);
      deps.dashboardRealtimeService.scheduleProjectExecutionRefresh(projectId, {
        includeOverview: false,
        includeProjects: false,
      });
      deps.dashboardRealtimeService.scheduleProjectStructureRefresh(projectId, { includeProjects: false });
      return saved;
    },
    resetSprintSettings: (sprintId) => {
      const sprint = deps.projectManagementRepository.getSprint(sprintId);
      if (!sprint) {
        throw new Error(`Sprint not found: ${sprintId}`);
      }
      deps.settingsRepository.resetSprintSettings(sprintId);
      cache.invalidateProjectExecution(sprint.projectId);
      cache.invalidateProjectStats(sprint.projectId);
      deps.dashboardRealtimeService.scheduleProjectExecutionRefresh(sprint.projectId, {
        includeOverview: false,
        includeProjects: false,
      });
      deps.dashboardRealtimeService.scheduleProjectStructureRefresh(sprint.projectId, { includeProjects: false });
    },
    getSprintEffectiveSettings: (projectId, sprintId) => {
      const sprint = deps.projectManagementRepository.getSprint(sprintId);
      if (!sprint || sprint.projectId !== projectId) {
        throw new Error(`Sprint not found in project: ${sprintId}`);
      }
      return deps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId);
    },
    listProjects: () => deps.projectManagementRepository.listProjects(),
    createProject: async (input) => deps.projectManagementRepository.createProject(
      await prepareGitProjectCreateInput(input, {
        githubToken: resolveGithubToken(deps),
        gitlabToken: resolveGitlabToken(deps),
      }),
    ),
    getProject: (projectId) => deps.projectManagementRepository.getProject(projectId),
    updateProject: (projectId, input) => deps.projectManagementRepository.updateProject(projectId, input),
    deleteProject: (projectId) => deps.projectManagementRepository.deleteProject(projectId),
    selectProject: (projectId) => {
      const selectedProjectId = deps.projectManagementRepository.setSelectedProjectId(projectId);
      cache.invalidateProjects();
      if (projectId) {
        cache.invalidateProjectExecution(projectId);
      }
      deps.projectManagementRepository.notifyProjectsUpdated();
      return selectedProjectId;
    },
    selectSprint: (projectId, sprintId) => {
      const selectedSprintId = deps.projectManagementRepository.setSelectedSprintId(projectId, sprintId);
      cache.invalidateProjectExecution(projectId);
      deps.dashboardRealtimeService.scheduleProjectExecutionRefresh(projectId, {
        includeOverview: false,
        includeProjects: false,
      });
      deps.dashboardRealtimeService.scheduleProjectStructureRefresh(projectId, { includeProjects: true });
      // Switching the selected sprint is an explicit user action and the Live page reflects it only
      // via the (throttled) project.live.updated push. Expedite that one publish so the new sprint's
      // data appears immediately instead of after the steady-state throttle window.
      deps.dashboardRealtimeService.expediteProjectLiveRefresh(projectId);
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
    searchJiraIssues: (projectId, input) => {
      const settings = deps.settingsRepository.resolveProjectDashboardSettings(projectId);
      if (!settings.settings.jira) {
        throw new Error("Jira is not configured for this project.");
      }
      return deps.sprintIssueService.searchJiraIssues(
        settings.settings.jira.host,
        settings.settings.jira.email,
        settings.settings.jira.apiToken,
        input,
        settings.settings.jira.defaultProject,
      );
    },
    listSprintLinkedIssues: (sprintId) => deps.sprintIssueService.getLinkedIssues(sprintId),
    replaceSprintLinkedIssues: (sprintId, projectId, issues) => deps.sprintIssueService.replaceLinkedIssues(sprintId, projectId, issues),
    listConnections: (projectId) => deps.connectionChatRepository.listConnections(projectId),
    updateConnection: (connectionId, input) => deps.connectionChatRepository.updateConnection(connectionId, input),
    listAgentPresets: async (projectId) => await deps.agentPresetSyncService.listAgentPresetsForDashboard(projectId),
    createAgentPreset: async (projectId, input) => await deps.agentPresetSyncService.createAgentPreset(projectId, input),
    updateAgentPreset: async (agentPresetId, input) => await deps.agentPresetSyncService.updateAgentPreset(agentPresetId, input),
    deleteAgentPreset: async (agentPresetId) => await deps.agentPresetSyncService.deleteAgentPreset(agentPresetId),
    importAgentPresetFromMarkdown: async (agentPresetId) => await deps.agentPresetSyncService.importAgentPresetFromMarkdown(agentPresetId),
    syncAllAgentPresetsFromMarkdown: async (projectId) => await deps.agentPresetSyncService.syncAllAgentPresetsFromMarkdown(projectId),
    listInstructionFiles: (projectId) => instructionFileService.listInstructionFiles(projectId),
    readInstructionFile: (projectId, fileId) => instructionFileService.readInstructionFile(projectId, fileId),
    writeInstructionFile: (projectId, fileId, content) => instructionFileService.writeInstructionFile(projectId, fileId, content),
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

    rerunTask: async (taskId: string, options?: { provider?: string; providerConfigId?: string; model?: string; clearWorktree?: boolean; resetDependents?: boolean; undoMerge?: boolean }) => {
      const task = await deps.taskRerunService.rerunTask(taskId, {
        provider: options?.provider as import("../../contracts/app-types.js").ProviderId | undefined,
        providerConfigId: options?.providerConfigId,
        model: options?.model,
        clearWorktree: options?.clearWorktree,
        resetDependents: options?.resetDependents,
        undoMerge: options?.undoMerge,
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
    resumeSprintRun: async (sprintRunId) => deps.executionControlService.resumeSprintRun(sprintRunId),
    cancelSprintRun: async (sprintRunId) => deps.executionControlService.cancelSprintRun(sprintRunId),
    forceCancelSprintRun: async (sprintRunId) => deps.executionControlService.forceCancelSprintRun(sprintRunId),
    cancelTaskDispatch: async (dispatchId) => deps.executionControlService.cancelTaskDispatch(dispatchId),
    forceCancelTaskDispatch: async (dispatchId) => deps.executionControlService.forceCancelTaskDispatch(dispatchId),
    forceCompleteTask: async (projectId, taskId, reason) => {
      await deps.executionControlService.forceCompleteTask(projectId, taskId, reason);
      deps.activityCacheService.invalidateLiveActivitiesCache();
    },
    retryTaskDispatch: async (dispatchId) => {
      const result = await deps.executionControlService.retryTaskDispatch(dispatchId);
      deps.activityCacheService.invalidateGitStatusCache();
      return result;
    },
    quicksprintService: deps.quicksprintService,
    setupProject: (projectId, input, signal) => deps.projectSetupService.setupProject(projectId, input, signal),
    startProjectSetup: (projectId, input) => deps.projectSetupService.startProjectSetup(projectId, input),
    schedulerService: deps.schedulerService,
    sprintIssueService: deps.sprintIssueService,
    realtimeService: deps.dashboardRealtimeService,
    logger: deps.logger.child({ component: "dashboard-server" }),
    isReady: deps.isReady,
    isHealthy: deps.isHealthy,
    listDockerContainers: deps.listDockerContainers,
    getOnboardingRuntimeReadiness: deps.getOnboardingRuntimeReadiness
      ?? (() => getOnboardingRuntimeReadiness(deps.settingsRepository.getSystemSettings())),
    getOnboardingState: () => deps.settingsRepository.getOnboardingState(),
    markOnboardingCompleted: () => deps.settingsRepository.markOnboardingCompleted(),
    resetOnboardingState: () => deps.settingsRepository.resetOnboardingState(),
    listSprintPreviewSessions: deps.listSprintPreviewSessions,
    getSprintPreviewSession: deps.getSprintPreviewSession,
    startSprintPreviewSession: deps.startSprintPreviewSession,
    rebuildSprintPreviewSession: deps.rebuildSprintPreviewSession,
    stopSprintPreviewSession: deps.stopSprintPreviewSession,
    removeSprintPreviewSession: deps.removeSprintPreviewSession,
    getSprintPreviewScript: deps.getSprintPreviewScript,
    saveSprintPreviewScript: deps.saveSprintPreviewScript,
    getSprintPreviewLogs: deps.getSprintPreviewLogs,
    proxySprintPreviewRequest: deps.proxySprintPreviewRequest,
    listFileBrowserSessions: deps.listFileBrowserSessions,
    startFileBrowserSession: deps.startFileBrowserSession,
    rebuildFileBrowserSession: deps.rebuildFileBrowserSession,
    stopFileBrowserSession: deps.stopFileBrowserSession,
    removeFileBrowserSession: deps.removeFileBrowserSession,
    getFileBrowserTree: deps.getFileBrowserTree,
    readFileBrowserFile: deps.readFileBrowserFile,
    getFileBrowserChanges: deps.getFileBrowserChanges,
    getFileBrowserDiff: deps.getFileBrowserDiff,
  });

  deps.runtimeContext.dashboardRuntimePort = handle.port;
  return handle;
}
