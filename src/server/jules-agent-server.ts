import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import axios from "axios";
import type { AxiosError } from "axios";
import * as path from "path";
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
  PersistTaskMergedFlagArgs,
  ReadinessProbeStatus,
} from "../contracts/app-types.js";
import { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import { GuideRepository } from "../repositories/guide-repository.js";
import { SubtaskFileRepository } from "../infrastructure/repositories/subtask-file-repository.js";
import { TaskService } from "../services/task-service.js";
import { SettingsRepository } from "../repositories/settings-repository.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { ProjectRuntimeRepository } from "../repositories/project-runtime-repository.js";
import { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import { GitStatusService, type GitTrackingRequest } from "../services/git-status-service.js";
import { loadExternalSettingsHints } from "../config/external-settings.js";
import { InstructionService } from "../instructions/instruction-template-service.js";
import { CoreToolHandler } from "../mcp/core-tool-handler.js";
import { AgentToolHandler } from "../mcp/agent-tool-handler.js";
import { buildMissingJulesApiKeyMessage } from "../mcp/api-key-guidance.js";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import { CliWorkflowService } from "../services/cli-workflow-service.js";
import { ActivityCacheService } from "./activity-cache-service.js";
import { registerMcpRequestHandlers } from "./mcp-request-router.js";
import { TaskRerunService } from "../services/task-rerun-service.js";
import { JulesSourceResolver } from "../services/jules-source-resolver.js";
import { createRuntimeDependencies, ServerContext } from "../app/dependency-factory.js";
import { generateCorrelationId, runWithCorrelationId } from "../shared/logging/correlation-id.js";
import { createLogger, type Logger } from "../shared/logging/logger.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../repositories/settings-defaults.js";
import { DefaultRuntimeContext, RuntimeContext } from "../app/runtime-context.js";
import { bootSettings, syncGitSettingsFromDashboard } from "../app/lifecycle/settings-lifecycle-service.js";
import { bootDashboard } from "../app/lifecycle/dashboard-lifecycle-service.js";
import { bootMcpTransport } from "../app/lifecycle/mcp-lifecycle-service.js";
import { getSprintSubtasksDir } from "../shared/config/sprint-os-paths.js";
import { SprintMarkdownService } from "../services/sprint-markdown-service.js";

export interface JulesAgentServerOptions {
  projectRoot: string;
  appConfig: AppConfig;
}

export class JulesAgentServer {
  private static readonly DASHBOARD_ACTIVITY_PAGE_SIZE = 20;
  private static readonly LIVE_ACTIVITY_CACHE_MS = 10_000;
  private static readonly GIT_STATUS_CACHE_MS = 10_000;
  private readonly projectRoot: string;
  private readonly appConfig: AppConfig;
  private server: Server;
  private logger: Logger;
  private julesApi: JulesApiClient;
  private completedSprints: Set<string | number> = new Set();
  private runtimeContext: RuntimeContext = new DefaultRuntimeContext();
  private app = express();
  private guideRepository: GuideRepository;
  private subtaskRepository: SubtaskFileRepository;
  private taskService: TaskService;
  private julesSourceResolver: JulesSourceResolver;
  private sprintOrchestrator: SprintOrchestrator;
  private settingsRepository: SettingsRepository;
  private projectManagementRepository: ProjectManagementRepository;
  private projectRuntimeRepository: ProjectRuntimeRepository;
  private connectionChatRepository: ConnectionChatRepository;
  private sprintMarkdownService: SprintMarkdownService;
  private externalSettingsHints: ExternalSettingsHints;
  private instructionService: InstructionService;
  private sessionTracking: SessionTrackingRepository;
  private cliWorkflowService: CliWorkflowService;
  private coreToolHandler: CoreToolHandler;
  private agentToolHandler: AgentToolHandler;
  private activityCacheService: ActivityCacheService;
  private taskRerunService: TaskRerunService;
  private mcpServiceBound = false;

  constructor(options: JulesAgentServerOptions) {
    this.projectRoot = options.projectRoot;
    this.appConfig = options.appConfig;

    const deps = createRuntimeDependencies(options, this.createContext());

    this.server = deps.server;
    this.logger = deps.logger;
    this.julesApi = deps.julesApi;
    this.guideRepository = deps.guideRepository;
    this.subtaskRepository = deps.subtaskRepository;
    this.taskService = deps.taskService;
    this.julesSourceResolver = deps.julesSourceResolver;
    this.sprintOrchestrator = deps.sprintOrchestrator;
    this.settingsRepository = deps.settingsRepository;
    this.projectManagementRepository = deps.projectManagementRepository;
    this.projectRuntimeRepository = deps.projectRuntimeRepository;
    this.connectionChatRepository = deps.connectionChatRepository;
    this.sprintMarkdownService = deps.sprintMarkdownService;
    this.externalSettingsHints = deps.externalSettingsHints;
    this.instructionService = deps.instructionService;
    this.sessionTracking = deps.sessionTracking;
    this.cliWorkflowService = deps.cliWorkflowService;
    this.coreToolHandler = deps.coreToolHandler;
    this.agentToolHandler = deps.agentToolHandler;
    this.activityCacheService = deps.activityCacheService;
    this.taskRerunService = deps.taskRerunService;

    registerMcpRequestHandlers({
      server: this.server,
      coreToolHandler: this.coreToolHandler,
      agentToolHandler: this.agentToolHandler,
      getDashboardSettings: () => this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS,
      formatError: (error: unknown) => this.formatError(error),
      logger: this.logger.child({ component: "mcp-request-router" }),
      withCorrelationContext: (request, operation) => this.runWithMcpCorrelationContext(request, operation),
    });

    this.server.onerror = (error) => {
      this.logger.error("MCP server error", { error });
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
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
      getGuideContentIfEnabled: (guideName, repoPath) => this.getGuideContentIfEnabled(guideName, repoPath),
      isActionRequiredState: (state) => this.isActionRequiredState(state),
      resolveSessionName: (session) => this.resolveSessionName(session),
      extractSessionId: (session) => this.extractSessionId(session),
      fetchRecentActivities: (sessionName, pageSize) => this.fetchRecentActivities(sessionName, pageSize),
      listSessionsForSync: () => this.listSessionsForSync(),
      getCiStatusForScope: (args) => this.getCiStatusForScope(args),
      autoMergeFeaturePr: (args) => this.autoMergeFeaturePr(args),
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
    const settings = this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
    const ci = settings.ciIntelligence;
    const runtimeStatus = this.projectRuntimeRepository.getSelectedProjectStatus();
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

  private resolveGitStatusRepoPath(): string {
    return this.projectRuntimeRepository.getSelectedProjectRepoPath(this.projectRoot);
  }

  private isReady(): ReadinessProbeStatus {
    const settingsDbUp = this.runtimeContext.settings !== undefined;
    const dashboardBindUp = this.runtimeContext.dashboardRuntimePort !== null;
    const mcpServiceUp = this.mcpServiceBound;

    const isReady = settingsDbUp && dashboardBindUp && mcpServiceUp && !!this.projectRuntimeRepository.getSelectedProjectStatus().timestamp;

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
    const dashboardBindUp = this.runtimeContext.dashboardRuntimePort !== null;
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
    try {
      await this.subtaskRepository.setMerged(subtasksDir, args.taskId, args.merged);
    } catch {
      // Compatibility markdown may be absent when execution is sourced from sqlite.
    }

    const selectedProjectId = this.projectRuntimeRepository.getSelectedProjectId();
    if (!selectedProjectId) {
      return;
    }

    const sprint = this.projectManagementRepository
      .listSprints(selectedProjectId)
      .find((candidate) => candidate.number === args.sprintNumber);
    if (!sprint) {
      return;
    }

    const task = this.projectManagementRepository
      .listTasks(selectedProjectId, sprint.id)
      .find((candidate) => candidate.taskKey === args.taskId);
    if (!task) {
      return;
    }

    this.projectManagementRepository.updateTask(task.id, {
      isMerged: args.merged,
      mergeIndicator: args.merged ? "MERGED" : null,
    });
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

  private getLocalConnectionKey(): string {
    return `local-project-manager:${this.projectRoot}`;
  }

  private registerLocalConnection(): void {
    const selectedProjectId = this.projectRuntimeRepository.getSelectedProjectId();
    this.connectionChatRepository.upsertConnection({
      connectionKey: this.getLocalConnectionKey(),
      displayName: "Sprint OS Project Manager",
      role: "project_manager",
      transport: "stdio",
      status: "connected",
      capabilities: {
        instruction: "Coordinates the legacy orchestration lane and dashboard control plane.",
        listenMode: false,
      },
      projectIds: selectedProjectId ? [selectedProjectId] : [],
      activeProjectIds: selectedProjectId ? [selectedProjectId] : [],
    });
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

  private getSkillNameForGuide(guideName: string): string {
    return guideName.replace(/\.md$/i, "");
  }

  private isSkillEnabled(skillName: string): boolean {
    const settings = this.runtimeContext.dashboardSettings || DEFAULT_DASHBOARD_SETTINGS;
    const skill = settings.skills.find((entry) => entry.name === skillName);
    return skill ? skill.enabled : true;
  }

  private async getGuideContentIfEnabled(guideName: string, repoPath?: string): Promise<string> {
    const skillName = this.getSkillNameForGuide(guideName);
    if (!this.isSkillEnabled(skillName)) {
      throw new Error(`Skill '${skillName}' is disabled in dashboard settings.`);
    }
    if (!this.guideRepository) {
      return "";
    }
    return this.guideRepository.getGuideContent(guideName, repoPath);
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
    return await this.activityCacheService.getGitStatus();
  }

  private async getCiStatusForScope(args: GetCiStatusForScopeArgs): Promise<GitTrackingStatus | null> {
    const gitStatusService = new GitStatusService(args.repoPath);
    try {
      return await gitStatusService.getStatus(
        "REMOTE",
        this.getEffectiveGithubToken(),
        {
          scope: args.scope,
          featureBranch: args.featureBranch,
          defaultBranch: args.defaultBranch,
          featureBranchPrefix: args.featureBranchPrefix,
        }
      );
    } catch {
      return null;
    }
  }

  private async autoMergeFeaturePr(args: AutoMergeFeaturePrArgs): Promise<{ ok: boolean; message?: string }> {
    const gitStatusService = new GitStatusService(args.repoPath);
    try {
      const result = await gitStatusService.mergePullRequest(args.prNumber, this.getEffectiveGithubToken());
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message };
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
    const recovery = this.sessionTracking.recoverInterruptedCliSessions();
    if (recovery.recoveredCount > 0) {
      const sample = recovery.sessionIds.slice(0, 5).join(", ");
      this.logger.warn("Recovered interrupted CLI sessions", {
        recoveredCount: recovery.recoveredCount,
        sampleSessionIds: sample,
        additionalRecoveredCount: Math.max(recovery.recoveredCount - 5, 0),
      });
    }

    this.registerLocalConnection();

    await bootDashboard({
      app: this.app,
      projectRoot: this.projectRoot,
      getDashboardPort: () => this.getDashboardPort(),
      runtimeContext: this.runtimeContext,
      externalSettingsHints: this.externalSettingsHints,
      settingsRepository: this.settingsRepository,
      projectManagementRepository: this.projectManagementRepository,
      projectRuntimeRepository: this.projectRuntimeRepository,
      connectionChatRepository: this.connectionChatRepository,
      sprintMarkdownService: this.sprintMarkdownService,
      activityCacheService: this.activityCacheService,
      taskRerunService: this.taskRerunService,
      logger: this.logger,
      getLiveActivitiesForActiveTasks: () => this.getLiveActivitiesForActiveTasks(),
      getGitStatus: () => this.getGitStatus(),
      isReady: () => this.isReady(),
      isHealthy: () => this.isHealthy(),
      syncGitSettingsFromDashboard: () => syncGitSettingsFromDashboard(this.runtimeContext),
      refreshJulesApiKey: () => this.refreshJulesApiKey(),
      setLogger: (logger) => { this.logger = logger; },
      LIVE_ACTIVITY_CACHE_MS: JulesAgentServer.LIVE_ACTIVITY_CACHE_MS,
    });

    await bootMcpTransport({
      server: this.server,
      logger: this.logger,
      isJulesApiConfigured: () => this.isJulesApiConfigured(),
      getMissingJulesApiKeyInstruction: () => this.getMissingJulesApiKeyInstruction(),
    });
    this.mcpServiceBound = true;
  }
}
