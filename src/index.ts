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
import type { DashboardSettings, JulesActivity, JulesSession, Settings, Subtask } from "./types.js";
import { TOOL_DEFINITIONS, dispatchTool } from "./tools.js";
import { SprintOrchestrator, type SprintAgentArgs } from "./sprint-orchestrator.js";
import { GuideRepository } from "./guide-repository.js";
import { SubtaskRepository } from "./subtask-repository.js";
import { TaskService } from "./task-service.js";
import { SettingsRepository } from "./settings-repository.js";
import { formatSprintBranch } from "./branch-scheme.js";

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
const apiKey = appConfig.apiKey;
if (!apiKey) {
  console.error("Error: Jules API Key is missing.");
  console.error("Please provide it via:");
  console.error("  1. Environment variable: JULES_API_KEY or JULES_KEY");
  console.error("  2. Command line argument: --api-key <your_key>");
  console.error("  3. A .env file in the current directory");
  console.error("\nAvailable environment variables:", Object.keys(process.env).filter(k => k.includes("KEY") || k.includes("JULES")).join(", ") || "none");
  process.exit(1);
}
const requiredApiKey: string = apiKey;

class JulesAgentServer {
  private static readonly DASHBOARD_ACTIVITY_PAGE_SIZE = 20;
  private static readonly LIVE_ACTIVITY_CACHE_MS = 10_000;
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

    this.julesApi = new JulesApiClient({
      apiKey: requiredApiKey,
      baseUrl: appConfig.baseUrl,
    });
    this.guideRepository = new GuideRepository(projectRoot);
    this.subtaskRepository = new SubtaskRepository();
    this.settingsRepository = new SettingsRepository();
    this.dashboardSettings = this.settingsRepository.getSettings();
    this.taskService = new TaskService({
      julesApi: this.julesApi,
      guideRepository: {
        getGuideContent: (guideName: string, repoPath?: string) => this.getGuideContentIfEnabled(guideName, repoPath),
      },
      normalizeSourceName: (sourceId: string) => this.normalizeName("sources", sourceId),
    });
    this.sprintOrchestrator = new SprintOrchestrator({
      julesApi: this.julesApi,
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
      loadSubtasks: (dir: string) => this.subtaskRepository.loadSubtasks(dir),
      startJulesTask: (task: Subtask, sourceId: string, baseBranch: string, repoPath: string, sprintNumber: number) =>
        this.taskService.startSprintTask(task, sourceId, baseBranch, repoPath, sprintNumber),
      getGuideContent: (guideName: string, repoPath?: string) => this.getGuideContentIfEnabled(guideName, repoPath),
      updateLastStatus: (status: any) => {
        this.lastStatus = status;
      },
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

  private async setupDashboard() {
    const dashboardDir = path.join(projectRoot, "dashboard");
    const port = this.settings.dashboardPort || appConfig.dashboardPort;

    await setupDashboardServer({
      app: this.app,
      dashboardDir,
      port,
      liveActivityCacheMs: JulesAgentServer.LIVE_ACTIVITY_CACHE_MS,
      getStatus: () => this.lastStatus,
      getLiveActivities: () => this.getLiveActivitiesForActiveTasks(),
      getSettings: () => this.dashboardSettings,
      saveSettings: (settings: DashboardSettings) => {
        this.dashboardSettings = this.settingsRepository.saveSettings(settings);
        return this.dashboardSettings;
      },
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOL_DEFINITIONS as any,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const handlers = {
        get_source: (toolArgs: { source_id: string }) => this.handleGetSource(toolArgs),
        list_sources: (toolArgs: { filter?: string; page_size?: number; page_token?: string }) => this.handleListSources(toolArgs),
        list_all_sources: (toolArgs: { filter?: string }) => this.handleListAllSources(toolArgs),
        create_session: (toolArgs: any) => this.handleCreateSession(toolArgs),
        get_session: (toolArgs: { session_id: string }) => this.handleGetSession(toolArgs),
        list_sessions: (toolArgs: { page_size?: number; page_token?: string }) => this.handleListSessions(toolArgs),
        approve_session_plan: (toolArgs: { session_id: string }) => this.handleApproveSessionPlan(toolArgs),
        send_session_message: (toolArgs: { session_id: string; prompt: string }) => this.handleSendSessionMessage(toolArgs),
        wait_for_session_completion: (toolArgs: { session_id: string; poll_interval?: number; timeout?: number }) => this.handleWaitForSessionCompletion(toolArgs),
        get_activity: (toolArgs: { session_id: string; activity_id: string }) => this.handleGetActivity(toolArgs),
        list_activities: (toolArgs: { session_id: string; page_size?: number; page_token?: string }) => this.handleListActivities(toolArgs),
        list_all_activities: (toolArgs: { session_id: string }) => this.handleListAllActivities(toolArgs),
        sprint_agent: (toolArgs: SprintAgentArgs) => this.handleSprintAgent(toolArgs),
        task_agent: (toolArgs: any) => this.handleTaskAgent(toolArgs),
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

  private async fetchRecentActivities(sessionName: string, pageSize: number = JulesAgentServer.DASHBOARD_ACTIVITY_PAGE_SIZE): Promise<JulesActivity[]> {
    return this.julesApi.fetchRecentActivities(sessionName, pageSize);
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

  // --- Jules API Handlers ---
  private async handleGetSource({ source_id }: { source_id: string }) {
    const source = await this.julesApi.getSource(source_id);
    return { content: [{ type: "text", text: JSON.stringify(source, null, 2) }] };
  }

  private async handleListSources({ filter, page_size, page_token }: { filter?: string; page_size?: number; page_token?: string }) {
    const sources = await this.julesApi.listSources({ filter, page_size, page_token });
    return { content: [{ type: "text", text: JSON.stringify(sources, null, 2) }] };
  }

  private async handleListAllSources({ filter }: { filter?: string }) {
    const allSources = await this.julesApi.listAllSources(filter);
    return { content: [{ type: "text", text: JSON.stringify({ sources: allSources }, null, 2) }] };
  }

  private async handleCreateSession(args: any) {
    const maxFails = this.settings.maxFailures || 5;
    if (this.consecutiveFailures >= maxFails) {
      throw new Error(`CRITICAL: Emergency stop active. ${this.consecutiveFailures} consecutive task creation failures detected.`);
    }

    const data: any = {
      prompt: args.prompt,
      sourceContext: { source: this.normalizeName("sources", args.source) },
    };
    if (args.starting_branch) data.sourceContext.githubRepoContext = { startingBranch: args.starting_branch };
    if (args.title) data.title = args.title;
    if (args.require_plan_approval !== undefined) data.requirePlanApproval = args.require_plan_approval;
    if (args.automation_mode) data.automationMode = args.automation_mode;

    try {
      const response = await this.julesApi.createSession(data);
      this.consecutiveFailures = 0; // Reset on success
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    } catch (error: any) {
      this.consecutiveFailures++;
      throw error;
    }
  }

  private async handleGetSession({ session_id }: { session_id: string }) {
    const session = await this.julesApi.getSession(session_id);

    try {
      // Fetch activities to get the last message/activity
      const sessionName = this.resolveSessionName(session) || this.normalizeName("sessions", session_id);
      const activities = await this.fetchRecentActivities(sessionName, 50);
      if (activities.length > 0) {
        // Assume chronological order, last is most recent
        (session as any).last_activity = activities[activities.length - 1];
      }
    } catch (error) {
      console.error(`Warning: Could not fetch activities for session ${session_id}`);
    }

    return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
  }

  private async handleListSessions({ page_size, page_token }: { page_size?: number; page_token?: string }) {
    const sessions = await this.julesApi.listSessions({ page_size, page_token });
    return { content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }] };
  }

  private async handleApproveSessionPlan({ session_id }: { session_id: string }) {
    const response = await this.julesApi.approveSessionPlan(session_id);
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  private async handleSendSessionMessage({ session_id, prompt }: { session_id: string; prompt: string }) {
    const response = await this.julesApi.sendSessionMessage(session_id, prompt);
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  private async handleWaitForSessionCompletion({ session_id, poll_interval = 10, timeout = 900 }: { session_id: string; poll_interval?: number; timeout?: number }) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout * 1000) {
      const session = await this.julesApi.getSession(session_id);
      if (
        session.state === "COMPLETED" ||
        session.state === "FAILED" ||
        this.isActionRequiredState(session.state) ||
        session.outputs?.some((o: any) => o.pullRequest)
      ) {
        return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
      }
      await new Promise(resolve => setTimeout(resolve, poll_interval * 1000));
    }
    throw new Error(`Timeout waiting for session ${session_id}`);
  }

  private async handleGetActivity({ session_id, activity_id }: { session_id: string; activity_id: string }) {
    const activity = await this.julesApi.getActivity(session_id, activity_id);
    return { content: [{ type: "text", text: JSON.stringify(activity, null, 2) }] };
  }

  private async handleListActivities({ session_id, page_size, page_token }: { session_id: string; page_size?: number; page_token?: string }) {
    const activities = await this.julesApi.listActivities({ session_id, page_size, page_token });
    return { content: [{ type: "text", text: JSON.stringify(activities, null, 2) }] };
  }

  private async handleListAllActivities({ session_id }: { session_id: string }) {
    const allActivities = await this.julesApi.listAllActivities(session_id);
    return { content: [{ type: "text", text: JSON.stringify({ activities: allActivities }, null, 2) }] };
  }

  // --- Sprint Agent Logic ---
  private async handleSprintAgent(args: SprintAgentArgs) {
    const resolvedArgs: SprintAgentArgs = {
      ...args,
      feature_branch: args.feature_branch || formatSprintBranch(this.dashboardSettings.git.sprintBranchScheme, args.sprint_number),
    };
    return await this.sprintOrchestrator.execute(resolvedArgs);
  }

  private async handleTaskAgent(args: {
    prompt: string;
    source_id: string;
    repo_path: string;
    title?: string;
    branch?: string;
    wait?: boolean;
  }) {
    const maxFails = this.settings.maxFailures || 5;
    if (this.consecutiveFailures >= maxFails) {
      throw new Error(`CRITICAL: Emergency stop active. ${this.consecutiveFailures} consecutive task creation failures detected.`);
    }

    try {
      const session = await this.taskService.createTaskAgentSession(args);
      this.consecutiveFailures = 0; // Reset on success

      if (args.wait) {
        return await this.handleWaitForSessionCompletion({ session_id: session.id });
      }

      return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
    } catch (error: any) {
      this.consecutiveFailures++;
      throw error;
    }
  }

  async run() {
    await this.loadSettings();
    await this.setupDashboard();
    
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
