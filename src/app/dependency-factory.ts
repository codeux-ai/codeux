import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import * as path from "path";
import { AppConfig } from "../config/app-config.js";
import { JulesApiClient } from "../integrations/jules-api-client.js";
import { GuideRepository } from "../repositories/guide-repository.js";
import { SubtaskFileRepository } from "../infrastructure/repositories/subtask-file-repository.js";
import { TaskService } from "../services/task-service.js";
import { SettingsRepository } from "../repositories/settings-repository.js";
import { InstructionService } from "../instructions/instruction-template-service.js";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import { CliWorkflowService } from "../services/cli-workflow-service.js";
import { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import { CoreToolHandler } from "../mcp/core-tool-handler.js";
import { AgentToolHandler } from "../mcp/agent-tool-handler.js";
import { ActivityCacheService } from "../server/activity-cache-service.js";
import { ActivitySummaryService } from "../domain/sessions/activity-summary.js";
import { TaskRerunService } from "../services/task-rerun-service.js";
import { JulesSourceResolver } from "../services/jules-source-resolver.js";
import {
  DashboardSettings,
  ExternalSettingsHints,
  JulesActivity,
  JulesSession,
  Subtask,
  Settings,
  GitTrackingStatus,
} from "../contracts/app-types.js";
import { loadExternalSettingsHints } from "../config/external-settings.js";
import { formatSprintBranch } from "../git/sprint-branch-scheme.js";
import { createLogger, type Logger } from "../shared/logging/logger.js";

export interface RuntimeDependencies {
  server: Server;
  logger: Logger;
  julesApi: JulesApiClient;
  guideRepository: GuideRepository;
  subtaskRepository: SubtaskFileRepository;
  taskService: TaskService;
  julesSourceResolver: JulesSourceResolver;
  sprintOrchestrator: SprintOrchestrator;
  settingsRepository: SettingsRepository;
  instructionService: InstructionService;
  sessionTracking: SessionTrackingRepository;
  cliWorkflowService: CliWorkflowService;
  coreToolHandler: CoreToolHandler;
  agentToolHandler: AgentToolHandler;
  activitySummary: ActivitySummaryService;
  activityCacheService: ActivityCacheService;
  taskRerunService: TaskRerunService;
  externalSettingsHints: ExternalSettingsHints;
  dashboardSettings: DashboardSettings;
}

export interface ServerContext {
  getProjectRoot: () => string;
  getAppConfig: () => AppConfig;
  getSettings: () => Settings;
  getDashboardSettings: () => DashboardSettings;
  setDashboardSettings: (settings: DashboardSettings) => void;
  getEffectiveJulesApiKey: () => string | undefined;
  getEffectiveGithubToken: () => string | undefined;
  getDashboardPort: () => number;
  isJulesApiConfigured: () => boolean;
  getMissingJulesApiKeyInstruction: () => string;
  getGuideContentIfEnabled: (guideName: string, repoPath?: string) => Promise<string>;
  getConsecutiveFailures: () => number;
  setConsecutiveFailures: (value: number) => void;
  isActionRequiredState: (state?: string) => boolean;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  extractSessionId: (session: Partial<JulesSession>) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>;
  listSessionsForSync: () => Promise<{ sessions?: JulesSession[] }>;
  updateLastStatus: (status: any) => void;
  getLastStatus: () => any;
  getCiStatusForScope: (args: any) => Promise<GitTrackingStatus | null>;
  autoMergeFeaturePr: (args: any) => Promise<{ ok: boolean; message?: string }>;
  resolveSessionNameFromTask: (task: Subtask) => string | undefined;
  resolveGitStatusRepoPath: () => string;
  fetchGitStatusForRepo: (repoPath: string) => Promise<GitTrackingStatus>;
  persistTaskMergedFlag: (args: any) => Promise<void>;
  normalizeName: (type: string, id: string) => string;
  isTrackedCliSession: (sessionId: string) => boolean;
}

export function createRuntimeDependencies(
  options: { projectRoot: string; appConfig: AppConfig },
  context: ServerContext
): RuntimeDependencies {
  const externalSettingsHints = loadExternalSettingsHints(options.projectRoot);
  const settingsRepository = new SettingsRepository(undefined, externalSettingsHints);
  const dashboardSettings = settingsRepository.getSettings();
  context.setDashboardSettings(dashboardSettings);

  const logFilePath = dashboardSettings.enableDebugLogFile
    ? path.join(options.projectRoot, ".jules-subagents", "debug.log")
    : undefined;

  const logger = createLogger({
    bindings: { service: "jules-subagents" },
    logFilePath,
  });

  const server = new Server(
    {
      name: "jules-subagents",
      version: "1.2.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  const julesApi = new JulesApiClient({
    apiKey: context.getEffectiveJulesApiKey(),
    baseUrl: options.appConfig.baseUrl,
  });

  const guideRepository = new GuideRepository(options.projectRoot);
  const subtaskRepository = new SubtaskFileRepository();
  const instructionService = new InstructionService(options.projectRoot);
  const sessionTracking = new SessionTrackingRepository();
  const julesSourceResolver = new JulesSourceResolver(julesApi);
  const activitySummary = new ActivitySummaryService();

  const cliWorkflowService = new CliWorkflowService({
    sessionTracking,
    getDashboardSettings: () => context.getDashboardSettings(),
    getGuideContent: (guideName: string, repoPath?: string) => context.getGuideContentIfEnabled(guideName, repoPath),
    getGithubToken: () => context.getEffectiveGithubToken(),
    logger: logger.child({ component: "cli-workflow-service" }),
  });

  const taskService = new TaskService({
    julesApi,
    guideRepository: {
      getGuideContent: (guideName: string, repoPath?: string) => context.getGuideContentIfEnabled(guideName, repoPath),
    },
    resolveJulesSourceId: (args) =>
      julesSourceResolver.resolveSourceId({
        repoPath: args.repoPath,
        requestedSourceId: args.sourceId,
      }),
    getDashboardSettings: () => context.getDashboardSettings(),
    isJulesApiConfigured: () => context.isJulesApiConfigured(),
    cliWorkflowService,
    logger: logger.child({ component: "task-service" }),
  });

  const sprintOrchestrator = new SprintOrchestrator({
    settings: context.getSettings(),
    dashboardPort: options.appConfig.dashboardPort,
    getDashboardPort: () => context.getDashboardPort(),
    completedSprints: new Set(), // Note: This was a property in JulesAgentServer, we might need to rethink this if it needs to be shared.
    // Wait, the original constructor used `this.completedSprints`.
    // I should probably pass the actual Set from JulesAgentServer.
    getConsecutiveFailures: () => context.getConsecutiveFailures(),
    setConsecutiveFailures: (value) => context.setConsecutiveFailures(value),
    isActionRequiredState: (state) => context.isActionRequiredState(state),
    resolveSessionName: (session) => context.resolveSessionName(session),
    extractSessionId: (session) => context.extractSessionId(session),
    fetchRecentActivities: (sessionName, pageSize) => context.fetchRecentActivities(sessionName, pageSize),
    listSessions: () => context.listSessionsForSync(),
    subtaskRepository,
    startTask: (task, sourceId, baseBranch, repoPath, sprintNumber) =>
      taskService.startSprintTask(task, sourceId, baseBranch, repoPath, sprintNumber),
    getGuideContent: (guideName, repoPath) => context.getGuideContentIfEnabled(guideName, repoPath),
    updateLastStatus: (status) => context.updateLastStatus(status),
    getDashboardSettings: () => context.getDashboardSettings(),
    isJulesApiConfigured: () => context.isJulesApiConfigured(),
    approveSessionPlan: (sessionId) => julesApi.approveSessionPlan(sessionId),
    sendSessionMessage: (sessionId, prompt) => julesApi.sendSessionMessage(sessionId, prompt),
    getCiStatusForScope: (args) => context.getCiStatusForScope(args),
    autoMergeFeaturePr: (args) => context.autoMergeFeaturePr(args),
    renderInstruction: (templateId, variables, repoPath) =>
      instructionService.render(templateId, variables, repoPath),
    logger: logger.child({ component: "sprint-orchestrator" }),
  });

  const coreToolHandler = new CoreToolHandler({
    julesApi,
    activitySummary,
    normalizeName: (type, id) => context.normalizeName(type, id),
    resolveSessionName: (session) => context.resolveSessionName(session),
    fetchRecentActivities: (sessionName, pageSize) => context.fetchRecentActivities(sessionName, pageSize),
    isActionRequiredState: (state) => context.isActionRequiredState(state),
    getConsecutiveFailures: () => context.getConsecutiveFailures(),
    setConsecutiveFailures: (value) => context.setConsecutiveFailures(value),
    getMaxFailures: () => context.getSettings().maxFailures || 5,
    isJulesApiConfigured: () => context.isJulesApiConfigured(),
    getMissingJulesApiKeyInstruction: () => context.getMissingJulesApiKeyInstruction(),
    isTrackedCliSession: (sessionId) => {
      const normalized = sessionId.startsWith("sessions/") ? sessionId : `sessions/${sessionId}`;
      return context.isTrackedCliSession(normalized);
    },
    getTrackedSession: (sessionId) => sessionTracking.getSession(sessionId),
    listTrackedSessions: (limit) => sessionTracking.listSessions(limit),
    listTrackedActivities: (args) => sessionTracking.listActivities(args),
    listAllTrackedActivities: (sessionId) => sessionTracking.listAllActivities(sessionId),
    logger: logger.child({ component: "core-tool-handler" }),
  });

  const agentToolHandler = new AgentToolHandler({
    sprintOrchestrator,
    taskService,
    getDashboardSettings: () => context.getDashboardSettings(),
    formatSprintBranch,
    getConsecutiveFailures: () => context.getConsecutiveFailures(),
    setConsecutiveFailures: (value) => context.setConsecutiveFailures(value),
    getMaxFailures: () => context.getSettings().maxFailures || 5,
    waitForSessionCompletion: (args) => coreToolHandler.handleWaitForSessionCompletion(args),
  });

  const activityCacheService = new ActivityCacheService(
    {
      getSubtasks: () => {
        const lastStatus = context.getLastStatus();
        return Array.isArray(lastStatus?.subtasks) ? lastStatus.subtasks : [];
      },
      resolveSessionNameFromTask: (task) => context.resolveSessionNameFromTask(task),
      fetchRecentActivities: (sessionName, pageSize) => context.fetchRecentActivities(sessionName, pageSize),
      resolveGitStatusRepoPath: () => context.resolveGitStatusRepoPath(),
      fetchGitStatusForRepo: (repoPath) => context.fetchGitStatusForRepo(repoPath),
      logger: logger.child({ component: "activity-cache-service" }),
    },
    10_000, // LIVE_ACTIVITY_CACHE_MS
    10_000, // GIT_STATUS_CACHE_MS
    20      // DASHBOARD_ACTIVITY_PAGE_SIZE
  );

  const taskRerunService = new TaskRerunService({
    getStatus: () => context.getLastStatus(),
    updateStatus: (status) => {
      context.updateLastStatus(status);
      activityCacheService.invalidateLiveActivitiesCache();
    },
    startTask: ({ task, sourceId, featureBranch, repoPath, sprintNumber }) =>
      taskService.startSprintTask(task, sourceId, featureBranch, repoPath, sprintNumber),
    resolveSessionName: (session) => context.resolveSessionName(session),
    extractSessionId: (session) => context.extractSessionId(session),
    persistMergedFlag: (args) => subtaskRepository.setMerged(
      path.join(args.repoPath, ".jules-subagents", "sprints", `sprint${args.sprintNumber}-subtasks`),
      args.taskId,
      args.merged
    ),
    logger: logger.child({ component: "task-rerun-service" }),
  });

  return {
    server,
    logger,
    julesApi,
    guideRepository,
    subtaskRepository,
    taskService,
    julesSourceResolver,
    sprintOrchestrator,
    settingsRepository,
    instructionService,
    sessionTracking,
    cliWorkflowService,
    coreToolHandler,
    agentToolHandler,
    activitySummary,
    activityCacheService,
    taskRerunService,
    externalSettingsHints,
    dashboardSettings,
  };
}
