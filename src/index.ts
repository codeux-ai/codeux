#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import type { AxiosError } from "axios";
import dotenv from "dotenv";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import express from "express";
import os from "os";
import { loadAppConfig } from "./config.js";
import { setupDashboardServer } from "./dashboard.js";
import { JulesApiClient } from "./jules-api.js";
import type { DashboardSettings, GitTrackingStatus, JulesActivity, JulesSession, Settings, Subtask } from "./types.js";
import { dispatchTool } from "./tools.js";
import { SprintOrchestrator, type SprintAgentArgs } from "./sprint-orchestrator.js";
import { GuideRepository } from "./guide-repository.js";
import { SubtaskRepository } from "./subtask-repository.js";
import { TaskService } from "./task-service.js";
import { SettingsRepository } from "./settings-repository.js";
import { formatSprintBranch } from "./branch-scheme.js";
import { GitStatusService, type GitTrackingRequest } from "./git-status-service.js";
import { loadExternalSettingsHints } from "./external-settings.js";
import { InstructionService } from "./instructions/service.js";
import { CoreToolHandler } from "./mcp/core-tool-handler.js";
import { AgentToolHandler } from "./mcp/agent-tool-handler.js";
import { buildMissingJulesApiKeyMessage } from "./api-key-guidance.js";
import { SessionTrackingRepository } from "./session-tracking-repository.js";
import { CliWorkflowService } from "./cli-workflow-service.js";
import { getEnabledToolDefinitions, isToolEnabled } from "./mcp/tool-availability.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(projectRoot, ".env") });

/**
 * Jules Subagents MCP Server (v1.2.0)
 * 
 * Provides a Model Context Protocol interface to the Jules Agent API
 * and an intelligent Sprint Orchestration Agent.
 */

const appConfig = loadAppConfig(process.argv, projectRoot);

class JulesAgentServer {
  private static readonly DASHBOARD_ACTIVITY_PAGE_SIZE = 20;
  private static readonly LIVE_ACTIVITY_CACHE_MS = 10_000;
  private static readonly GIT_STATUS_CACHE_MS = 10_000;
  private server: Server;
  private julesApi: JulesApiClient;
  private completedSprints: Set<number> = new Set();
  private lastStatus: any = { subtasks: [], timestamp: null };
  private app = express();
  private settings: Settings = { maxFailures: 5 };
  private consecutiveFailures: number = 0;
  private guideRepository: GuideRepository;
  private subtaskRepository: SubtaskRepository;
  private taskService: TaskService;
  private sprintOrchestrator: SprintOrchestrator;
  private liveActivitiesCache: { timestamp: number; data: Record<string, JulesActivity[]> } = { timestamp: 0, data: {} };
  private liveActivitiesFetchPromise: Promise<Record<string, JulesActivity[]>> | null = null;
  private settingsRepository: SettingsRepository;
  private dashboardSettings: DashboardSettings;
  private externalSettingsHints = loadExternalSettingsHints(projectRoot);
  private gitStatusCache: { timestamp: number; data: GitTrackingStatus | null; repoPath: string | null } = {
    timestamp: 0,
    data: null,
    repoPath: null,
  };
  private gitStatusFetchPromise: Promise<GitTrackingStatus> | null = null;
  private instructionService: InstructionService;
  private sessionTracking: SessionTrackingRepository;
  private cliWorkflowService: CliWorkflowService;
  private coreToolHandler: CoreToolHandler;
  private agentToolHandler: AgentToolHandler;

  constructor() {
    this.server = new Server(
      {
        name: "jules-subagents",
        version: "1.2.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.settingsRepository = new SettingsRepository(undefined, this.externalSettingsHints);
    this.dashboardSettings = this.settingsRepository.getSettings();
    this.julesApi = new JulesApiClient({
      apiKey: this.getEffectiveJulesApiKey(),
      baseUrl: appConfig.baseUrl,
    });
    this.guideRepository = new GuideRepository(projectRoot);
    this.subtaskRepository = new SubtaskRepository();
    this.instructionService = new InstructionService(projectRoot);
    this.sessionTracking = new SessionTrackingRepository();
    this.cliWorkflowService = new CliWorkflowService({
      sessionTracking: this.sessionTracking,
      getDashboardSettings: () => this.dashboardSettings,
      getGuideContent: (guideName: string, repoPath?: string) => this.getGuideContentIfEnabled(guideName, repoPath),
      getGithubToken: () => this.getEffectiveGithubToken(),
    });
    this.taskService = new TaskService({
      julesApi: this.julesApi,
      guideRepository: {
        getGuideContent: (guideName: string, repoPath?: string) => this.getGuideContentIfEnabled(guideName, repoPath),
      },
      normalizeSourceName: (sourceId: string) => this.normalizeName("sources", sourceId),
      getDashboardSettings: () => this.dashboardSettings,
      isJulesApiConfigured: () => this.isJulesApiConfigured(),
      cliWorkflowService: this.cliWorkflowService,
    });
    this.sprintOrchestrator = new SprintOrchestrator({
      settings: this.settings,
      dashboardPort: appConfig.dashboardPort,
      completedSprints: this.completedSprints,
      getConsecutiveFailures: () => this.consecutiveFailures,
      setConsecutiveFailures: (value: number) => {
        this.consecutiveFailures = value;
      },
      isActionRequiredState: (state?: string) => this.isActionRequiredState(state),
      resolveSessionName: (session: Partial<JulesSession>) => this.resolveSessionName(session),
      extractSessionId: (session: Partial<JulesSession>) => this.extractSessionId(session),
      fetchRecentActivities: (sessionName: string, pageSize?: number) => this.fetchRecentActivities(sessionName, pageSize),
      listSessions: () => this.listSessionsForSync(),
      loadSubtasks: (dir: string) => this.subtaskRepository.loadSubtasks(dir),
      startTask: (task: Subtask, sourceId: string, baseBranch: string, repoPath: string, sprintNumber: number) =>
        this.taskService.startSprintTask(task, sourceId, baseBranch, repoPath, sprintNumber),
      getGuideContent: (guideName: string, repoPath?: string) => this.getGuideContentIfEnabled(guideName, repoPath),
      updateLastStatus: (status: any) => {
        this.lastStatus = status;
      },
      getDashboardSettings: () => this.dashboardSettings,
      isJulesApiConfigured: () => this.isJulesApiConfigured(),
      approveSessionPlan: (sessionId: string) => this.julesApi.approveSessionPlan(sessionId),
      sendSessionMessage: (sessionId: string, prompt: string) => this.julesApi.sendSessionMessage(sessionId, prompt),
      getCiStatusForScope: (args) => this.getCiStatusForScope(args),
      autoMergeFeaturePr: (args) => this.autoMergeFeaturePr(args),
      renderInstruction: (templateId, variables, repoPath) =>
        this.instructionService.render(templateId, variables, repoPath),
    });
    this.coreToolHandler = new CoreToolHandler({
      julesApi: this.julesApi,
      normalizeName: (type: string, id: string) => this.normalizeName(type, id),
      resolveSessionName: (session: Partial<JulesSession>) => this.resolveSessionName(session),
      fetchRecentActivities: (sessionName: string, pageSize?: number) => this.fetchRecentActivities(sessionName, pageSize),
      isActionRequiredState: (state?: string) => this.isActionRequiredState(state),
      getConsecutiveFailures: () => this.consecutiveFailures,
      setConsecutiveFailures: (value: number) => {
        this.consecutiveFailures = value;
      },
      getMaxFailures: () => this.settings.maxFailures || 5,
      isJulesApiConfigured: () => this.isJulesApiConfigured(),
      getMissingJulesApiKeyInstruction: () => this.getMissingJulesApiKeyInstruction(),
      isTrackedCliSession: (sessionId: string) => {
        const normalized = sessionId.startsWith("sessions/") ? sessionId : `sessions/${sessionId}`;
        return this.isTrackedCliSession(normalized);
      },
      getTrackedSession: (sessionId: string) => this.sessionTracking.getSession(sessionId),
      listTrackedSessions: (limit?: number) => this.sessionTracking.listSessions(limit),
      listTrackedActivities: (args) => this.sessionTracking.listActivities(args),
      listAllTrackedActivities: (sessionId: string) => this.sessionTracking.listAllActivities(sessionId),
    });
    this.agentToolHandler = new AgentToolHandler({
      sprintOrchestrator: this.sprintOrchestrator,
      taskService: this.taskService,
      getDashboardSettings: () => this.dashboardSettings,
      formatSprintBranch,
      getConsecutiveFailures: () => this.consecutiveFailures,
      setConsecutiveFailures: (value: number) => {
        this.consecutiveFailures = value;
      },
      getMaxFailures: () => this.settings.maxFailures || 5,
      waitForSessionCompletion: (args: { session_id: string; poll_interval?: number; timeout?: number }) =>
        this.coreToolHandler.handleWaitForSessionCompletion(args),
    });

    this.setupToolHandlers();
    
    this.server.onerror = (error) => {
      console.error("[MCP Server Error]", JSON.stringify(error, null, 2));
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private async loadSettings() {
    // 1. Lowest priority: Environment variable
    if (process.env.JULES_API_MAX_FAILS) {
      this.settings.maxFailures = parseInt(process.env.JULES_API_MAX_FAILS);
    }

    // 2. Higher priorities: settings.json files (Reverse order for correct override: HOME -> PROJECT -> CWD)
    const searchPaths = this.getSearchPaths(".jules-subagents/settings.json").reverse();
    for (const settingsPath of searchPaths) {
      try {
        await fs.access(settingsPath);
        const content = await fs.readFile(settingsPath, "utf-8");
        const loadedSettings = JSON.parse(content);
        
        // Handle both camelCase and UPPER_SNAKE_CASE for backward compatibility if needed, 
        // but prefer camelCase for the final settings.
        if (loadedSettings.JULES_API_MAX_FAILS !== undefined) {
          loadedSettings.maxFailures = loadedSettings.JULES_API_MAX_FAILS;
        }
        
        Object.assign(this.settings, loadedSettings);
        console.error(`Loaded settings from: ${settingsPath}`);
      } catch (error) {
        // Skip if not found or invalid
      }
    }
  }

  private getSearchPaths(relativePath: string): string[] {
    const paths = [
      path.join(process.cwd(), relativePath),
      path.join(projectRoot, relativePath),
      path.join(os.homedir(), relativePath),
    ];
    return [...new Set(paths)]; // Unique paths, highest priority first
  }

  private syncGitSettingsFromDashboard(): void {
    this.settings.defaultBranch = this.dashboardSettings.git.defaultBranch;
    this.settings.githubMode = this.dashboardSettings.git.githubMode;
  }

  private getEffectiveJulesApiKey(): string | undefined {
    const uiProviderKey = this.dashboardSettings.aiProvider.providers?.jules?.apiKey?.trim();
    if (uiProviderKey && uiProviderKey.length > 0) {
      return uiProviderKey;
    }
    const uiKey = this.dashboardSettings.aiProvider.julesApiKey?.trim();
    if (uiKey && uiKey.length > 0) {
      return uiKey;
    }
    const liveEnvKey = process.env.JULES_API_KEY?.trim() || process.env.JULES_KEY?.trim();
    if (liveEnvKey && liveEnvKey.length > 0) {
      return liveEnvKey;
    }
    const configKey = appConfig.apiKey?.trim();
    if (configKey && configKey.length > 0) {
      return configKey;
    }
    const fallback = this.externalSettingsHints.resolved.julesApiKey.trim();
    return fallback.length > 0 ? fallback : undefined;
  }

  private refreshJulesApiKey(): void {
    this.julesApi.setApiKey(this.getEffectiveJulesApiKey());
  }

  private isJulesApiConfigured(): boolean {
    return this.julesApi.hasApiKey();
  }

  private getDashboardPort(): number {
    return this.settings.dashboardPort || appConfig.dashboardPort;
  }

  private getMissingJulesApiKeyInstruction(): string {
    return buildMissingJulesApiKeyMessage(this.getDashboardPort());
  }

  private getEffectiveGithubToken(): string | undefined {
    const uiToken = this.dashboardSettings.git.githubToken?.trim();
    if (uiToken && uiToken.length > 0) {
      return uiToken;
    }
    const fallback = this.externalSettingsHints.resolved.githubToken.trim();
    return fallback.length > 0 ? fallback : undefined;
  }

  private resolveGitTrackingRequest(): GitTrackingRequest {
    const ci = this.dashboardSettings.ciIntelligence;
    const subtasks: Subtask[] = Array.isArray(this.lastStatus?.subtasks) ? this.lastStatus.subtasks : [];
    const featureBranch = typeof this.lastStatus?.feature_branch === "string" && this.lastStatus.feature_branch.trim().length > 0
      ? this.lastStatus.feature_branch.trim()
      : null;
    const defaultBranch = this.dashboardSettings.git.defaultBranch?.trim() || "main";
    const featureBranchPrefix = this.dashboardSettings.git.featureBranchPrefix?.trim() || "feature/";

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
    const statusRepoPath = typeof this.lastStatus?.repo_path === "string" ? this.lastStatus.repo_path.trim() : "";
    return statusRepoPath.length > 0 ? statusRepoPath : projectRoot;
  }

  private async setupDashboard() {
    const dashboardDir = path.join(projectRoot, "dashboard");
    const port = this.getDashboardPort();

    await setupDashboardServer({
      app: this.app,
      dashboardDir,
      port,
      liveActivityCacheMs: JulesAgentServer.LIVE_ACTIVITY_CACHE_MS,
      getStatus: () => this.lastStatus,
      getLiveActivities: () => this.getLiveActivitiesForActiveTasks(),
      getGitStatus: () => this.getGitStatus(),
      getExternalSettingsHints: () => this.externalSettingsHints,
      getSettings: () => this.dashboardSettings,
      saveSettings: (settings: DashboardSettings) => {
        this.dashboardSettings = this.settingsRepository.saveSettings(settings);
        this.syncGitSettingsFromDashboard();
        this.refreshJulesApiKey();
        this.gitStatusCache = { timestamp: 0, data: null, repoPath: null };
        return this.dashboardSettings;
      },
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: getEnabledToolDefinitions(this.dashboardSettings) as any,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      if (!isToolEnabled(this.dashboardSettings, name)) {
        throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
      }
      const handlers = {
        get_source: (toolArgs: { source_id: string }) => this.coreToolHandler.handleGetSource(toolArgs),
        list_sources: (toolArgs: { filter?: string; page_size?: number; page_token?: string }) => this.coreToolHandler.handleListSources(toolArgs),
        list_all_sources: (toolArgs: { filter?: string }) => this.coreToolHandler.handleListAllSources(toolArgs),
        create_session: (toolArgs: any) => this.coreToolHandler.handleCreateSession(toolArgs),
        get_session: (toolArgs: { session_id: string }) => this.coreToolHandler.handleGetSession(toolArgs),
        list_sessions: (toolArgs: { page_size?: number; page_token?: string }) => this.coreToolHandler.handleListSessions(toolArgs),
        approve_session_plan: (toolArgs: { session_id: string }) => this.coreToolHandler.handleApproveSessionPlan(toolArgs),
        send_session_message: (toolArgs: { session_id: string; prompt: string }) => this.coreToolHandler.handleSendSessionMessage(toolArgs),
        wait_for_session_completion: (toolArgs: { session_id: string; poll_interval?: number; timeout?: number }) =>
          this.coreToolHandler.handleWaitForSessionCompletion(toolArgs),
        get_activity: (toolArgs: { session_id: string; activity_id: string }) => this.coreToolHandler.handleGetActivity(toolArgs),
        list_activities: (toolArgs: { session_id: string; page_size?: number; page_token?: string }) =>
          this.coreToolHandler.handleListActivities(toolArgs),
        list_all_activities: (toolArgs: { session_id: string }) => this.coreToolHandler.handleListAllActivities(toolArgs),
        sprint_agent: (toolArgs: SprintAgentArgs) => this.agentToolHandler.handleSprintAgent(toolArgs),
        task_agent: (toolArgs: any) => this.agentToolHandler.handleTaskAgent(toolArgs),
      };

      try {
        return await dispatchTool(name, args, handlers);
      } catch (error: any) {
        if (error instanceof Error && error.message.startsWith("Tool not found:")) {
          throw new McpError(ErrorCode.MethodNotFound, error.message);
        }
        return this.formatError(error);
      }
    });
  }

  private formatError(error: any) {
    let message = error.message || "An unknown error occurred";
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<any>;
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

  private getSkillNameForGuide(guideName: string): string {
    return guideName.replace(/\.md$/i, "");
  }

  private isSkillEnabled(skillName: string): boolean {
    const skill = this.dashboardSettings.skills.find((entry) => entry.name === skillName);
    return skill ? skill.enabled : true;
  }

  private async getGuideContentIfEnabled(guideName: string, repoPath?: string): Promise<string> {
    const skillName = this.getSkillNameForGuide(guideName);
    if (!this.isSkillEnabled(skillName)) {
      throw new Error(`Skill '${skillName}' is disabled in dashboard settings.`);
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

  private async getGitStatus(): Promise<GitTrackingStatus> {
    const repoPath = this.resolveGitStatusRepoPath();
    const now = Date.now();
    if (
      this.gitStatusCache.data &&
      this.gitStatusCache.repoPath === repoPath &&
      now - this.gitStatusCache.timestamp < JulesAgentServer.GIT_STATUS_CACHE_MS
    ) {
      return this.gitStatusCache.data;
    }
    if (this.gitStatusFetchPromise) {
      return this.gitStatusFetchPromise;
    }

    const gitStatusService = new GitStatusService(repoPath);
    this.gitStatusFetchPromise = gitStatusService
      .getStatus(
        this.dashboardSettings.git.githubMode,
        this.getEffectiveGithubToken(),
        this.resolveGitTrackingRequest()
      )
      .then((status) => {
        this.gitStatusCache = { timestamp: Date.now(), data: status, repoPath };
        return status;
      })
      .finally(() => {
        this.gitStatusFetchPromise = null;
      });

    return this.gitStatusFetchPromise;
  }

  private async getCiStatusForScope(args: {
    repoPath: string;
    scope: "FEATURE_PR_CI" | "MAIN_MERGE_PR_CI";
    featureBranch: string;
    defaultBranch: string;
    featureBranchPrefix: string;
  }): Promise<GitTrackingStatus | null> {
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

  private async autoMergeFeaturePr(args: { repoPath: string; prNumber: number }): Promise<{ ok: boolean; message?: string }> {
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
    const now = Date.now();
    if (now - this.liveActivitiesCache.timestamp < JulesAgentServer.LIVE_ACTIVITY_CACHE_MS) {
      return this.liveActivitiesCache.data;
    }

    if (this.liveActivitiesFetchPromise) {
      return this.liveActivitiesFetchPromise;
    }

    this.liveActivitiesFetchPromise = (async () => {
      const subtasks: Subtask[] = Array.isArray(this.lastStatus?.subtasks) ? this.lastStatus.subtasks : [];
      const activeSessionNames = Array.from(
        new Set(
          subtasks
            .filter((task) => task.status === "RUNNING")
            .map((task) => this.resolveSessionNameFromTask(task))
            .filter((value): value is string => Boolean(value))
        )
      );

      if (activeSessionNames.length === 0) {
        const empty: Record<string, JulesActivity[]> = {};
        this.liveActivitiesCache = { timestamp: Date.now(), data: empty };
        return empty;
      }

      const results = await Promise.all(
        activeSessionNames.map(async (sessionName) => {
          try {
            const activities = await this.fetchRecentActivities(sessionName);
            return [sessionName, activities] as const;
          } catch {
            console.error(`Warning: Could not fetch live activities for ${sessionName}`);
            return [sessionName, []] as const;
          }
        })
      );

      const data = Object.fromEntries(results);
      this.liveActivitiesCache = { timestamp: Date.now(), data };
      return data;
    })().finally(() => {
      this.liveActivitiesFetchPromise = null;
    });

    return this.liveActivitiesFetchPromise;
  }

  async run() {
    await this.loadSettings();
    this.syncGitSettingsFromDashboard();
    this.refreshJulesApiKey();
    const recovery = this.sessionTracking.recoverInterruptedCliSessions();
    if (recovery.recoveredCount > 0) {
      const sample = recovery.sessionIds.slice(0, 5).join(", ");
      const remainder = recovery.recoveredCount > 5 ? ` (+${recovery.recoveredCount - 5} more)` : "";
      console.error(
        `[Recovery] Marked ${recovery.recoveredCount} interrupted CLI session(s) as FAILED: ${sample}${remainder}`
      );
    }
    await this.setupDashboard();

    if (!this.isJulesApiConfigured()) {
      console.error("Warning: Jules API key is not set. Jules-native tools are disabled; Gemini/Codex CLI providers can still run.");
      console.error(this.getMissingJulesApiKeyInstruction());
    }
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Jules Subagents MCP server (v1.2.0) running on stdio");
  }
}

const server = new JulesAgentServer();
server.run().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
