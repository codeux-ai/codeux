import { setupDashboardServer } from "../../server/dashboard-server.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../repositories/settings-defaults.js";
import { createLogger } from "../../shared/logging/logger.js";
import type { Express } from "express";
import type { Logger } from "../../shared/logging/logger.js";
import type { RuntimeContext } from "../runtime-context.js";
import type {
  DashboardSettings,
  ExecutionConnectionSummary,
  ExternalSettingsHints,
  GitTrackingStatus,
  JulesActivity,
  DashboardStatus,
  Subtask,
  ReadinessProbeStatus
} from "../../contracts/app-types.js";
import type { McpConnectionRecord } from "../../contracts/connection-chat-types.js";
import type { SettingsRepository } from "../../repositories/settings-repository.js";
import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ProjectRuntimeRepository } from "../../repositories/project-runtime-repository.js";
import type { ConnectionChatRepository } from "../../repositories/connection-chat-repository.js";
import type { AgentPresetRepository } from "../../repositories/agent-preset-repository.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { SprintMarkdownService } from "../../services/sprint-markdown-service.js";
import type { ActivityCacheService } from "../../server/activity-cache-service.js";
import type { TaskRerunService } from "../../services/task-rerun-service.js";
import type { ExecutionControlService } from "../../services/execution-control-service.js";
import { getRepoDebugLogPath, SPRINT_OS_SERVICE_NAME } from "../../shared/config/sprint-os-paths.js";

export interface BootDashboardDeps {
  app: Express;
  projectRoot: string;
  getDashboardPort: () => number;
  runtimeContext: RuntimeContext;
  externalSettingsHints: ExternalSettingsHints;
  settingsRepository: SettingsRepository;
  projectManagementRepository: ProjectManagementRepository;
  projectRuntimeRepository: ProjectRuntimeRepository;
  executionRepository: ExecutionRepository;
  connectionChatRepository: ConnectionChatRepository;
  agentPresetRepository: AgentPresetRepository;
  sprintMarkdownService: SprintMarkdownService;
  activityCacheService: ActivityCacheService;
  taskRerunService: TaskRerunService;
  executionControlService: ExecutionControlService;
  logger: Logger;
  getLiveActivitiesForActiveTasks: () => Promise<Record<string, JulesActivity[]>>;
  getGitStatus: () => Promise<GitTrackingStatus>;
  isReady: () => ReadinessProbeStatus;
  isHealthy: () => ReadinessProbeStatus;
  syncGitSettingsFromDashboard: () => void;
  refreshJulesApiKey: () => void;
  setLogger: (logger: Logger) => void;
  LIVE_ACTIVITY_CACHE_MS: number;
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

export async function bootDashboard(deps: BootDashboardDeps): Promise<void> {
  const dashboardDir = `${deps.projectRoot}/dashboard`;
  const port = deps.getDashboardPort();

  const handle = await setupDashboardServer({
    app: deps.app,
    dashboardDir,
    port,
    liveActivityCacheMs: deps.LIVE_ACTIVITY_CACHE_MS,
    getStatus: () => deps.projectRuntimeRepository.getSelectedProjectStatus(),
    getExecutionSnapshot: () => {
      const projectId = deps.projectManagementRepository.getSelectedProjectId();
      return projectId
        ? {
          ...deps.executionRepository.getProjectExecutionSnapshot(projectId),
          connections: mapExecutionConnections(deps.connectionChatRepository.listConnections(projectId)),
        }
        : {
          projectId: null,
          projectName: null,
          sprintRuns: [],
          taskDispatches: [],
          connections: [],
          recentEvents: [],
          updatedAt: null,
        };
    },
    getOverviewTelemetrySnapshot: () => deps.executionRepository.getOverviewTelemetrySnapshot(),
    getProjectExecutionSnapshot: (projectId) => ({
      ...deps.executionRepository.getProjectExecutionSnapshot(projectId),
      connections: mapExecutionConnections(deps.connectionChatRepository.listConnections(projectId)),
    }),
    getLiveActivities: deps.getLiveActivitiesForActiveTasks,
    getGitStatus: deps.getGitStatus,
    getExternalSettingsHints: () => deps.externalSettingsHints,
    getSettings: () => deps.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
    listProjects: () => deps.projectManagementRepository.listProjects(),
    createProject: (input) => deps.projectManagementRepository.createProject(input),
    getProject: (projectId) => deps.projectManagementRepository.getProject(projectId),
    updateProject: (projectId, input) => deps.projectManagementRepository.updateProject(projectId, input),
    deleteProject: (projectId) => deps.projectManagementRepository.deleteProject(projectId),
    selectProject: (projectId) => deps.projectManagementRepository.setSelectedProjectId(projectId),
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
    listAgentPresets: (projectId) => deps.agentPresetRepository.listAgentPresets(projectId),
    createAgentPreset: (projectId, input) => deps.agentPresetRepository.createAgentPreset(projectId, input),
    updateAgentPreset: (agentPresetId, input) => deps.agentPresetRepository.updateAgentPreset(agentPresetId, input),
    deleteAgentPreset: (agentPresetId) => deps.agentPresetRepository.deleteAgentPreset(agentPresetId),
    listConversationThreads: (projectId) => deps.connectionChatRepository.listThreads(projectId),
    createConversationThread: (projectId, input) => deps.connectionChatRepository.createThread(projectId, input),
    updateConversationThread: (threadId, input) => deps.connectionChatRepository.updateThread(threadId, input),
    listConversationMessages: (threadId) => deps.connectionChatRepository.listMessages(threadId),
    postConversationMessage: (projectId, input) => deps.connectionChatRepository.postDashboardMessage(projectId, input),
    saveSettings: (settings: DashboardSettings) => {
      deps.runtimeContext.dashboardSettings = deps.settingsRepository.saveSettings(settings);
      deps.syncGitSettingsFromDashboard();
      deps.refreshJulesApiKey();

      const newLogger = reinitializeLogger({
        projectRoot: deps.projectRoot,
        runtimeContext: deps.runtimeContext
      });
      deps.setLogger(newLogger);

      deps.activityCacheService.invalidateGitStatusCache();
      return deps.runtimeContext.dashboardSettings;
    },
    rerunTask: async (taskId: string) => {
      const task = await deps.taskRerunService.rerunTask(taskId);
      deps.activityCacheService.invalidateGitStatusCache();
      return task;
    },
    orchestrateSprint: async (projectId, sprintId) => {
      const result = await deps.executionControlService.orchestrateSprint(projectId, sprintId);
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
    logger: deps.logger.child({ component: "dashboard-server" }),
    isReady: deps.isReady,
    isHealthy: deps.isHealthy,
  });

  deps.runtimeContext.dashboardRuntimePort = handle.port;
}
