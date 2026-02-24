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
import type { AxiosInstance, AxiosError } from "axios";
import dotenv from "dotenv";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import express from "express";
import os from "os";
import { execSync } from "child_process";

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

// Configuration
const args = process.argv.slice(2);
const apiKeyArg = args.find(arg => arg.startsWith("--api-key="))?.split("=")[1] || 
                  (args.indexOf("--api-key") !== -1 ? args[args.indexOf("--api-key") + 1] : null);

const loadApiKeyFromSettings = (): string | null => {
  const settingsRelativePath = path.join(".jules-subagents", "settings.json");
  const searchPaths = [
    path.join(process.cwd(), settingsRelativePath),
    path.join(projectRoot, settingsRelativePath),
    path.join(os.homedir(), settingsRelativePath),
  ];

  for (const settingsPath of [...new Set(searchPaths)]) {
    try {
      if (!fsSync.existsSync(settingsPath)) continue;
      const raw = fsSync.readFileSync(settingsPath, "utf-8");
      const parsed = JSON.parse(raw);
      const key =
        parsed?.julesApiKey ||
        parsed?.JULES_API_KEY ||
        parsed?.julesKey ||
        parsed?.JULES_KEY;
      if (typeof key === "string" && key.trim().length > 0) {
        return key.trim();
      }
    } catch {
      // Ignore invalid or unreadable settings files at startup key discovery time.
    }
  }

  return null;
};

const API_KEY = apiKeyArg || process.env.JULES_API_KEY || process.env.JULES_KEY || loadApiKeyFromSettings();
const BASE_URL = process.env.JULES_API_BASE_URL || "https://jules.googleapis.com/v1alpha";
const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || "4444");

if (!API_KEY) {
  console.error("Error: Jules API Key is missing.");
  console.error("Please provide it via:");
  console.error("  1. Environment variable: JULES_API_KEY or JULES_KEY");
  console.error("  2. Command line argument: --api-key <your_key>");
  console.error("  3. A .env file in the current directory");
  console.error("\nAvailable environment variables:", Object.keys(process.env).filter(k => k.includes("KEY") || k.includes("JULES")).join(", ") || "none");
  process.exit(1);
}

// Types for Jules API
interface JulesSource {
  name: string;
  id: string;
}

interface JulesSession {
  name: string;
  id: string;
  title?: string;
  state?: string;
  prompt: string;
  createTime?: string;
  outputs?: Array<{ pullRequest?: any; [key: string]: any }>;
}

interface JulesActivity {
  name: string;
  id: string;
  createTime: string;
  originator?: "agent" | "user" | "system" | string;
  [key: string]: any;
}

// Types for Sprint Agent
interface Subtask {
  id: string;
  title: string;
  prompt: string;
  depends_on: string[]; // IDs of other subtasks
  status?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED";
  session_id?: string;
  session_name?: string;
  session_state?: string;
  activities?: JulesActivity[];
  is_independent: boolean; // Flag to indicate if it can be delegated to Jules
  is_merged?: boolean; // Flag to indicate if the PR has been merged
}

interface Settings {
  maxFailures?: number;
  [key: string]: any;
}

class JulesAgentServer {
  private static readonly DASHBOARD_ACTIVITY_PAGE_SIZE = 20;
  private static readonly LIVE_ACTIVITY_CACHE_MS = 10_000;
  private server: Server;
  private axiosInstance: AxiosInstance;
  private completedSprints: Set<number> = new Set();
  private lastStatus: any = { subtasks: [], timestamp: null };
  private app = express();
  private settings: Settings = { maxFailures: 5 };
  private consecutiveFailures: number = 0;
  private liveActivitiesCache: { timestamp: number; data: Record<string, JulesActivity[]> } = { timestamp: 0, data: {} };
  private liveActivitiesFetchPromise: Promise<Record<string, JulesActivity[]>> | null = null;

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

    this.axiosInstance = axios.create({
      baseURL: BASE_URL,
      headers: {
        "X-Goog-Api-Key": API_KEY,
        "Content-Type": "application/json",
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
        
        this.settings = { ...this.settings, ...loadedSettings };
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
    this.app.get("/api/status", (req, res) => {
      res.json(this.lastStatus);
    });

    this.app.get("/api/live-activities", async (req, res) => {
      try {
        const activitiesBySession = await this.getLiveActivitiesForActiveTasks();
        res.json({
          activitiesBySession,
          polledAt: new Date().toISOString(),
          cacheTtlMs: JulesAgentServer.LIVE_ACTIVITY_CACHE_MS,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: `Failed to fetch live activities: ${message}` });
      }
    });

    this.app.get("/favicon.ico", (req, res) => res.status(204).end());

    const dashboardDir = path.join(projectRoot, "dashboard");
    this.app.use(express.static(dashboardDir));

    const port = this.settings.dashboardPort || DASHBOARD_PORT;
    
    return new Promise<void>((resolve) => {
      // Listen on localhost only
      this.app.listen(port, "localhost", () => {
        console.error(`\n🚀 [DASHBOARD] Live status available at:`);
        console.error(`   - http://localhost:${port}`);
        console.error(`   - http://127.0.0.1:${port}\n`);
        resolve();
      }).on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          console.error(`Warning: Dashboard port ${port} is already in use. Dashboard will not be available.`);
        } else {
          console.error(`Warning: Failed to start dashboard server: ${err.message}`);
        }
        resolve(); // Don't block the whole server if dashboard fails
      });
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Sources
        {
          name: "get_source",
          description: "Retrieve comprehensive details for a specific code source (e.g., a GitHub repository).",
          inputSchema: {
            type: "object",
            properties: {
              source_id: { type: "string", description: "The unique identifier for the source." },
            },
            required: ["source_id"],
          },
        },
        {
          name: "list_sources",
          description: "Enumerate available code sources with filtering and pagination capabilities.",
          inputSchema: {
            type: "object",
            properties: {
              filter: { type: "string" },
              page_size: { type: "number" },
              page_token: { type: "string" },
            },
          },
        },
        {
          name: "list_all_sources",
          description: "Retrieve the complete list of available sources by automatically handling multi-page results.",
          inputSchema: {
            type: "object",
            properties: {
              filter: { type: "string" },
            },
          },
        },
        // Sessions
        {
          name: "create_session",
          description: "Initiate a new agent session to perform tasks on a specific codebase.",
          inputSchema: {
            type: "object",
            properties: {
              prompt: { type: "string" },
              source: { type: "string" },
              starting_branch: { type: "string" },
              title: { type: "string" },
              require_plan_approval: { type: "boolean" },
              automation_mode: { type: "string", enum: ["AUTO_CREATE_PR"] },
            },
            required: ["prompt", "source"],
          },
        },
        {
          name: "get_session",
          description: "Get the current status, state, and outputs of an active or historical session.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: { type: "string" },
            },
            required: ["session_id"],
          },
        },
        {
          name: "list_sessions",
          description: "List recent agent sessions with pagination.",
          inputSchema: {
            type: "object",
            properties: {
              page_size: { type: "number" },
              page_token: { type: "string" },
            },
          },
        },
        {
          name: "approve_session_plan",
          description: "Authorize the agent to proceed with the proposed plan.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: { type: "string" },
            },
            required: ["session_id"],
          },
        },
        {
          name: "send_session_message",
          description: "Provide additional feedback, instructions, or corrections to the agent.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              prompt: { type: "string" },
            },
            required: ["session_id", "prompt"],
          },
        },
        {
          name: "wait_for_session_completion",
          description: "Monitor a session until it reaches a terminal state or a PR is generated.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              poll_interval: { type: "number", default: 10 },
              timeout: { type: "number", default: 900 },
            },
            required: ["session_id"],
          },
        },
        // Activities
        {
          name: "get_activity",
          description: "Retrieve detailed information about a specific interaction step.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              activity_id: { type: "string" },
            },
            required: ["session_id", "activity_id"],
          },
        },
        {
          name: "list_activities",
          description: "Fetch a chronologically ordered list of activities for a session.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: { type: "string" },
              page_size: { type: "number" },
              page_token: { type: "string" },
            },
            required: ["session_id"],
          },
        },
        {
          name: "list_all_activities",
          description: "Retrieve all activities for a session automatically.",
          inputSchema: {
            type: "object",
            properties: {
              session_id: { type: "string" },
            },
            required: ["session_id"],
          },
        },
        // Sprint Agent
        {
          name: "sprint_agent",
          description: "Intelligent agent that orchestrates sprints by delegating subtasks to Jules.",
          inputSchema: {
            type: "object",
            properties: {
              sprint_number: { type: "number", description: "The sprint number (e.g., 34)." },
              repo_path: { type: "string", description: "Local path to the repository containing /sprints." },
              source_id: { type: "string", description: "The Jules source ID." },
              feature_branch: { type: "string", description: "The main feature branch for this sprint." },
              action: { 
                type: "string", 
                enum: ["status", "orchestrate", "plan"], 
                description: "Action to perform: 'status', 'orchestrate', 'plan'." 
              },
              wait: { type: "boolean", description: "Whether to wait and watch for all tasks to complete (polls every 120s). Defaults to true for 'status' and 'orchestrate'.", default: true },
              retry_failed: { type: "boolean", description: "Whether to automatically retry failed tasks. Defaults to true.", default: true },
            },
            required: ["sprint_number", "repo_path", "source_id", "action"],
          },
        },
        {
          name: "task_agent",
          description: "Executes a single specific task on a codebase by creating a Jules session with injected engineering standards.",
          inputSchema: {
            type: "object",
            properties: {
              prompt: { type: "string", description: "The specific task to perform." },
              source_id: { type: "string", description: "The Jules source ID (e.g., 'sources/123')." },
              repo_path: { type: "string", description: "Local path to the repository to find worker.md." },
              title: { type: "string", description: "Optional title for the session." },
              branch: { type: "string", description: "Optional starting branch." },
              wait: { type: "boolean", description: "Whether to wait for the task to reach a terminal state (COMPLETED/FAILED).", default: false }
            },
            required: ["prompt", "source_id", "repo_path"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "get_source":
            return await this.handleGetSource(args as { source_id: string });
          case "list_sources":
            return await this.handleListSources(args as { filter?: string; page_size?: number; page_token?: string });
          case "list_all_sources":
            return await this.handleListAllSources(args as { filter?: string });
          case "create_session":
            return await this.handleCreateSession(args as any);
          case "get_session":
            return await this.handleGetSession(args as { session_id: string });
          case "list_sessions":
            return await this.handleListSessions(args as { page_size?: number; page_token?: string });
          case "approve_session_plan":
            return await this.handleApproveSessionPlan(args as { session_id: string });
          case "send_session_message":
            return await this.handleSendSessionMessage(args as { session_id: string; prompt: string });
          case "wait_for_session_completion":
            return await this.handleWaitForSessionCompletion(args as { session_id: string; poll_interval?: number; timeout?: number });
          case "get_activity":
            return await this.handleGetActivity(args as { session_id: string; activity_id: string });
          case "list_activities":
            return await this.handleListActivities(args as { session_id: string; page_size?: number; page_token?: string });
          case "list_all_activities":
            return await this.handleListAllActivities(args as { session_id: string });
          case "sprint_agent":
            return await this.handleSprintAgent(args as any);
          case "task_agent":
            return await this.handleTaskAgent(args as any);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
        }
      } catch (error: any) {
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
    if (id.startsWith(`${type}/`)) return id;
    return `${type}/${id}`;
  }

  private isActionRequiredState(state?: string): boolean {
    return state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED";
  }

  private extractSessionId(session: Partial<JulesSession>): string | undefined {
    if (session.id) {
      return session.id.replace(/^sessions\//, "");
    }
    if (session.name && session.name.startsWith("sessions/")) {
      return session.name.replace(/^sessions\//, "");
    }
    return undefined;
  }

  private resolveSessionName(session: Partial<JulesSession>): string | undefined {
    if (session.name && session.name.startsWith("sessions/")) {
      return session.name;
    }
    const sessionId = this.extractSessionId(session);
    return sessionId ? this.normalizeName("sessions", sessionId) : undefined;
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

  private async fetchRecentActivities(sessionName: string, pageSize: number = JulesAgentServer.DASHBOARD_ACTIVITY_PAGE_SIZE): Promise<JulesActivity[]> {
    const activitiesResponse = await this.axiosInstance.get<{ activities?: JulesActivity[] }>(
      `/${sessionName}/activities`,
      { params: { pageSize } }
    );
    const activities = activitiesResponse.data.activities || [];
    return activities.slice().sort((a, b) => {
      const left = new Date(a.createTime || 0).getTime();
      const right = new Date(b.createTime || 0).getTime();
      return left - right;
    });
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
    const response = await this.axiosInstance.get(`/${this.normalizeName("sources", source_id)}`);
    return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
  }

  private async handleListSources({ filter, page_size, page_token }: { filter?: string; page_size?: number; page_token?: string }) {
    const params: any = { filter, pageSize: page_size, pageToken: page_token };
    const response = await this.axiosInstance.get("/sources", { params });
    return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
  }

  private async handleListAllSources({ filter }: { filter?: string }) {
    let allSources: JulesSource[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const params: any = { filter, pageToken };
      const response = await this.axiosInstance.get<{ sources?: JulesSource[], nextPageToken?: string }>("/sources", { params });
      allSources = allSources.concat(response.data.sources || []);
      pageToken = response.data.nextPageToken;
    } while (pageToken);
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
      const response = await this.axiosInstance.post("/sessions", data);
      this.consecutiveFailures = 0; // Reset on success
      return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
    } catch (error: any) {
      this.consecutiveFailures++;
      throw error;
    }
  }

  private async handleGetSession({ session_id }: { session_id: string }) {
    const name = this.normalizeName("sessions", session_id);
    const sessionResponse = await this.axiosInstance.get<JulesSession>(`/${name}`);
    const session = sessionResponse.data;

    try {
      // Fetch activities to get the last message/activity
      const activities = await this.fetchRecentActivities(name, 50);
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
    const params: any = { pageSize: page_size, pageToken: page_token };
    const response = await this.axiosInstance.get("/sessions", { params });
    return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
  }

  private async handleApproveSessionPlan({ session_id }: { session_id: string }) {
    const name = this.normalizeName("sessions", session_id);
    const response = await this.axiosInstance.post(`/${name}:approvePlan`);
    return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
  }

  private async handleSendSessionMessage({ session_id, prompt }: { session_id: string; prompt: string }) {
    const name = this.normalizeName("sessions", session_id);
    const response = await this.axiosInstance.post(`/${name}:sendMessage`, { prompt });
    return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
  }

  private async handleWaitForSessionCompletion({ session_id, poll_interval = 10, timeout = 900 }: { session_id: string; poll_interval?: number; timeout?: number }) {
    const startTime = Date.now();
    const name = this.normalizeName("sessions", session_id);
    while (Date.now() - startTime < timeout * 1000) {
      const response = await this.axiosInstance.get<JulesSession>(`/${name}`);
      const session = response.data;
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
    const sessionName = this.normalizeName("sessions", session_id);
    const activityName = this.normalizeName("activities", activity_id);
    const response = await this.axiosInstance.get(`/${sessionName}/${activityName}`);
    return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
  }

  private async handleListActivities({ session_id, page_size, page_token }: { session_id: string; page_size?: number; page_token?: string }) {
    const sessionName = this.normalizeName("sessions", session_id);
    const params: any = { pageSize: page_size, pageToken: page_token };
    const response = await this.axiosInstance.get(`/${sessionName}/activities`, { params });
    return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
  }

  private async handleListAllActivities({ session_id }: { session_id: string }) {
    const sessionName = this.normalizeName("sessions", session_id);
    let allActivities: JulesActivity[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const params: any = { pageToken };
      const response = await this.axiosInstance.get<{ activities?: JulesActivity[], nextPageToken?: string }>(`/${sessionName}/activities`, { params });
      allActivities = allActivities.concat(response.data.activities || []);
      pageToken = response.data.nextPageToken;
    } while (pageToken);
    return { content: [{ type: "text", text: JSON.stringify({ activities: allActivities }, null, 2) }] };
  }

  private checkBranch(repoPath: string, branch: string): { existsLocal: boolean; existsRemote: boolean } {
    let existsLocal = false;
    let existsRemote = false;

    try {
      // 1. Verify repoPath is a directory
      const stats = execSync(`[ -d "${repoPath}" ] && echo "dir" || echo "notdir"`, { encoding: "utf-8" }).trim();
      if (stats !== "dir") return { existsLocal, existsRemote };

      // 2. Check if it's a git repo
      try {
        execSync("git rev-parse --is-inside-work-tree", { cwd: repoPath, stdio: "ignore" });
      } catch (e) {
        return { existsLocal, existsRemote }; // Not a git repo
      }

      // 3. Check local branch
      try {
        execSync(`git rev-parse --verify ${branch}`, { cwd: repoPath, stdio: "ignore" });
        existsLocal = true;
      } catch (e) {}

      // 4. Check remote branch
      try {
        const remoteOutput = execSync(`git ls-remote --heads origin ${branch}`, { cwd: repoPath, encoding: "utf-8" });
        if (remoteOutput.trim()) existsRemote = true;
      } catch (e) {}
    } catch (globalError) {
      console.error(`Warning in checkBranch: ${globalError instanceof Error ? globalError.message : String(globalError)}`);
    }

    return { existsLocal, existsRemote };
  }

  // --- Sprint Agent Logic ---
  private async handleSprintAgent(args: {
    sprint_number: number;
    repo_path: string;
    source_id: string;
    feature_branch?: string;
    action: "status" | "orchestrate" | "plan";
    wait?: boolean;
    retry_failed?: boolean;
  }) {
    const sprintsDir = path.join(args.repo_path, ".jules-subagents", "sprints");
    const sprintFile = path.join(sprintsDir, `sprint-${args.sprint_number}.md`);
    const subtasksDir = path.join(sprintsDir, `sprint${args.sprint_number}-subtasks`);
    const defaultFeatureBranch = args.feature_branch || `feature/sprint${args.sprint_number}-implementation`;
    const retryFailed = args.retry_failed !== false; // Default to true

    // --- Branch Blocker Logic ---
    if (args.action === "plan" || args.action === "orchestrate") {
      const { existsLocal, existsRemote } = this.checkBranch(args.repo_path, defaultFeatureBranch);
      
      if (!existsLocal || !existsRemote) {
        let branchBlocker = `### 🛑 ACTION REQUIRED: Branch Configuration Missing\n\n`;
        branchBlocker += `The feature branch \`${defaultFeatureBranch}\` is not ready. Jules agents require this branch to exist on the remote repository to begin work.\n\n`;
        
        if (!existsLocal) {
          branchBlocker += `**Step 1:** Create the branch locally:\n\`\`\`bash\ngit checkout -b ${defaultFeatureBranch}\n\`\`\`\n\n`;
        }
        
        if (!existsRemote) {
          branchBlocker += `**Step ${!existsLocal ? "2" : "1"}:** Push the branch to remote origin:\n\`\`\`bash\ngit push -u origin ${defaultFeatureBranch}\n\`\`\`\n\n`;
        }
        
        branchBlocker += `**Important:** Once these steps are completed, run this tool again to proceed with the \`${args.action}\` phase.`;
        
        return { content: [{ type: "text", text: branchBlocker }] };
      }
    }

    if (args.action === "orchestrate" || args.action === "status") {
      try {
        await fs.access(subtasksDir);
        const files = await fs.readdir(subtasksDir);
        if (files.filter(f => f.endsWith(".md")).length === 0) {
          throw new Error("No subtasks found");
        }
      } catch (e) {
        let planBlocker = `### 🛑 ACTION REQUIRED: Sprint Planning Missing\n\n`;
        planBlocker += `No subtasks found in \`${subtasksDir}\`. You must plan the sprint before orchestration can begin.\n\n`;
        planBlocker += `**Instruction:** Run the \`sprint_agent\` with \`action: "plan"\` to initialize the subtasks and define the work items.`;
        return { content: [{ type: "text", text: planBlocker }] };
      }
    }

    if (this.completedSprints.has(args.sprint_number)) {
      return { content: [{ type: "text", text: `Sprint ${args.sprint_number} has already been finished in this session.` }] };
    }

    if (args.action === "plan") {
      try {
        await fs.access(subtasksDir);
        return { content: [{ type: "text", text: `Subtasks directory already exists: ${subtasksDir}.` }] };
      } catch {
        await fs.mkdir(subtasksDir, { recursive: true });
        
        let planningGuide = "";
        try {
          planningGuide = await this.getGuideContent("sprint_agent_guide.md", args.repo_path);
          planningGuide = `\n\n### Technical Operating Standard\n\n${planningGuide}\n`;
        } catch {
          // Fallback if guide not found
        }

        return { 
          content: [{ 
            type: "text", 
            text: `### Planning Phase for Sprint ${args.sprint_number}\n\n` +
                  `Created directory: \`${subtasksDir}\`.\n\n` +
                  planningGuide +
                  `**Instructions for the calling Agent:**\n` +
                  `1. Read \`sprints/sprint-${args.sprint_number}.md\`.\n` +
                  `2. Break the sprint into small, well-planned tasks.\n` +
                  `3. For each task, create a \`.md\` file in the subtasks directory with this format:\n\n` +
                  "```markdown\n" +
                  "title: Task Title\n" +
                  "depends_on: [task_id_1, task_id_2]\n" +
                  "is_independent: true\n" +
                  "merged: false\n" +
                  "prompt:\n" +
                  "Detailed instructions for Jules.\n" +
                  "```"
          }] 
        };
      }
    }

    const runOrchestrationCycle = async () => {
      let subtasks: Subtask[] = [];
      try {
        subtasks = await this.loadSubtasks(subtasksDir);
      } catch (error) {
        throw new Error(`Error loading subtasks from ${subtasksDir}.`);
      }

      const sessionsResponse = await this.axiosInstance.get("/sessions", { params: { pageSize: 100 } });
      let sessions: JulesSession[] = sessionsResponse.data.sessions || [];
      
      // Sort sessions by createTime descending (latest first)
      sessions.sort((a, b) => {
        if (!a.createTime || !b.createTime) return 0;
        return new Date(b.createTime).getTime() - new Date(a.createTime).getTime();
      });

      for (const task of subtasks) {
        const match = sessions.find(s => s.title?.includes(`[${task.id}]`));
        if (match) {
          const sessionName = this.resolveSessionName(match);
          const sessionId = this.extractSessionId(match);
          task.session_name = sessionName;
          task.session_id = sessionId;
          task.session_state = match.state;
          
          // Fetch recent activities for this session
          if (sessionName) {
            try {
              task.activities = await this.fetchRecentActivities(sessionName, 5);
            } catch (e) {
              console.error(`Warning: Could not fetch activities for task ${task.id}`);
            }
          }

          if (match.state === "COMPLETED") {
            task.status = "COMPLETED";
          } else if (match.state === "FAILED") {
            if (retryFailed) {
              const dependenciesMet = task.depends_on.every(depId => {
                const dep = subtasks.find(t => t.id === depId);
                return dep?.status === "COMPLETED" && dep?.is_merged;
              });
              task.status = dependenciesMet ? "PENDING" : "BLOCKED";
            } else {
              task.status = "FAILED";
            }
          } else if (this.isActionRequiredState(match.state)) {
            task.status = "BLOCKED";
          } else {
            task.status = "RUNNING";
          }
        } else if (!task.is_independent) {
          task.status = "BLOCKED";
        } else {
          const dependenciesMet = task.depends_on.every(depId => {
            const dep = subtasks.find(t => t.id === depId);
            return dep?.status === "COMPLETED" && dep?.is_merged;
          });
          task.status = dependenciesMet ? "PENDING" : "BLOCKED";
        }
      }

      let reportText = "";
      let instructions = "";
      if (args.action === "orchestrate") {
        // Pre-check for emergency stop
        const maxFails = this.settings.maxFailures || 5;
        if (this.consecutiveFailures >= maxFails) {
          throw new Error(`CRITICAL: Emergency stop active. ${this.consecutiveFailures} consecutive task creation failures detected. Please check configuration and run again to reset.`);
        }

        const readyTasks = subtasks.filter(t => t.status === "PENDING" && t.is_independent);
        for (const task of readyTasks) {
          try {
            const session = await this.startJulesTask(task, args.source_id, defaultFeatureBranch, args.repo_path, args.sprint_number);
            task.status = "RUNNING";
            task.session_name = this.resolveSessionName(session);
            task.session_id = this.extractSessionId(session);
            reportText += `🚀 **Started Jules Session** for task \`${task.id}\`: [${session.id}](${session.id})\n`;
            this.consecutiveFailures = 0; // Reset on successful start
          } catch (error: any) {
            this.consecutiveFailures++;
            const currentFails = this.consecutiveFailures;
            console.error(`Error starting task ${task.id}: ${error.message} (Consecutive failures: ${currentFails}/${maxFails})`);
            
            if (currentFails >= maxFails) {
              throw new Error(`CRITICAL: Emergency stop triggered after ${currentFails} consecutive task creation failures.`);
            }
          }
        }
      }

      // Generate instructions for completed but unmerged tasks
      const awaitingMerge = subtasks.filter(t => t.status === "COMPLETED" && !t.is_merged);
      if (awaitingMerge.length > 0) {
        instructions += `\n### 📥 MERGE INSTRUCTIONS\n`;
        for (const task of awaitingMerge) {
          instructions += `1. **Task ${task.id}**: Merge the Jules-created branch into \`${defaultFeatureBranch}\`.\n`;
          instructions += `2. Update \`${path.join(subtasksDir, task.id + ".md")}\` with \`merged: true\`.\n`;
        }
      }

      const actionRequiredTasks = subtasks.filter(t => t.status === "BLOCKED" && this.isActionRequiredState(t.session_state));
      if (actionRequiredTasks.length > 0) {
        instructions += `\n### ✋ JULES ACTION REQUIRED\n`;
        for (const task of actionRequiredTasks) {
          instructions += `- **Task ${task.id}** is \`${task.session_state}\`. Open the Jules session and resolve the pending action, then rerun orchestration.\n`;
        }
      }

      let statusTable = `#### Task Status:\n`;
      for (const task of subtasks) {
        let statusIcon = "💤";
        if (task.status === "COMPLETED") {
          statusIcon = task.is_merged ? "✅" : "🤝";
        } else if (task.status === "RUNNING") {
          statusIcon = "⏳";
        } else if (task.status === "BLOCKED") {
          statusIcon = "🚫";
        } else if (task.status === "FAILED") {
          statusIcon = "❌";
        }
        
        const mergeInfo = (task.status === "COMPLETED" && !task.is_merged) ? " **(Awaiting Merge)**" : "";
        statusTable += `- ${statusIcon} **${task.id}**: \`${task.status}\`${mergeInfo} - ${task.title}\n`;
      }

      return { subtasks, reportText, statusTable, instructions };
    };

    const shouldWait = args.wait !== undefined ? args.wait : (args.action === "status" || args.action === "orchestrate");

    if (shouldWait) {
      let allFinished = false;
      let fullReport = `### Sprint ${args.sprint_number} Continuous Orchestration\n\n`;
      const dashboardPort = this.settings.dashboardPort || DASHBOARD_PORT;
      fullReport += `**Feature Branch:** \`${defaultFeatureBranch}\`\n`;
      fullReport += `**Dashboard:** [http://localhost:${dashboardPort}](http://localhost:${dashboardPort})\n\n`;
      
      console.error(`Starting watch loop for Sprint ${args.sprint_number}...`);
      console.error(`Live dashboard available at http://localhost:${dashboardPort}`);

      while (!allFinished) {
        const { subtasks, reportText, statusTable, instructions } = await runOrchestrationCycle();
        
        const timestamp = new Date().toLocaleTimeString();
        
        // Update dashboard status
        this.lastStatus = {
          sprint_number: args.sprint_number,
          feature_branch: defaultFeatureBranch,
          subtasks,
          reportText,
          statusTable,
          instructions,
          timestamp
        };

        console.error(`[${timestamp}] Cycle complete. Status updated.`);
        
        if (reportText) console.error(reportText);

        const runningTasks = subtasks.filter(t => t.status === "RUNNING");
        const readyTasks = subtasks.filter(t => t.status === "PENDING" && t.is_independent);
        const awaitingMerge = subtasks.filter(t => t.status === "COMPLETED" && !t.is_merged);
        
        allFinished = subtasks.length > 0 && subtasks.every(t => (t.status === "COMPLETED" && t.is_merged) || t.status === "FAILED");
        const noMoreActionPossible = runningTasks.length === 0 && readyTasks.length === 0;
        const needsManualMerge = awaitingMerge.length > 0;
        
        if (allFinished || noMoreActionPossible || needsManualMerge) {
          allFinished = true; // Force exit the loop
          fullReport += reportText;
          fullReport += statusTable;
          fullReport += instructions;

          if (needsManualMerge) {
            fullReport += `\n🛑 **Action Required: Merge Detected**\n`;
            fullReport += `One or more tasks have finished. Please follow the **MERGE INSTRUCTIONS** below, then run \`orchestrate\` again to continue.\n`;
          } else if (subtasks.length > 0 && !subtasks.every(t => (t.status === "COMPLETED" && t.is_merged) || t.status === "FAILED") && noMoreActionPossible) {
            fullReport += `\n🛑 **Action Required:** Orchestration paused. No tasks are running and no pending tasks can be started.\n`;
          }
          
          try {
            const watchGuide = await this.getGuideContent("watch.md", args.repo_path);
            fullReport += `\n---\n\n### Watch Loop Operating Standard\n\n${watchGuide}`;
          } catch {
            // No watch guide found
          }

          // Cleanup subtasks only if EVERY task is COMPLETED AND MERGED and there are actual tasks.
          if (subtasks.length > 0 && subtasks.every(t => t.status === "COMPLETED" && t.is_merged)) {
            try {
              console.error(`Marking sprint as completed and cleaning up subtasks directory: ${subtasksDir}`);
              this.completedSprints.add(args.sprint_number);
              await fs.rm(subtasksDir, { recursive: true, force: true });
              fullReport += `\n🧹 **Cleanup:** All tasks completed and merged successfully. Deleted subtasks in \`${subtasksDir}\`.\n`;
              
              fullReport += `\n## 🏁 SPRINT COMPLETION STEPS\n`;
              fullReport += `1. **Create Pull Request**: Merge \`${defaultFeatureBranch}\` into \`main\`.\n`;
              fullReport += `2. **Final Review**: Review all code changes implemented by Jules subagents.\n`;
              fullReport += `3. **CI/CD Verification**: Wait for all CI checks to turn green. If merge conflicts or CI errors occur, fix them locally and push until all checks pass.\n`;
              fullReport += `4. **Next Sprint**: Proceed with the implementation of Sprint ${args.sprint_number + 1} (auto-continue: true).\n`;

            } catch (cleanupError) {
              console.error(`Warning: Failed to cleanup subtasks: ${cleanupError}`);
            }
          } else if (subtasks.some(t => t.status === "FAILED")) {
            fullReport += `\n⚠️ **Cleanup Skipped:** Some tasks failed. Subtasks in \`${subtasksDir}\` are preserved for debugging.\n`;
          } else if (subtasks.some(t => t.status === "COMPLETED" && !t.is_merged)) {
            fullReport += `\n⏸️ **Cleanup Deferred:** Awaiting merges for completed tasks.\n`;
          } else if (subtasks.length === 0) {
            fullReport += `\n⚠️ **Sprint Empty:** No subtasks found. The sprint has not been planned yet.\n`;
          }

          fullReport += `\n✅ **Sprint Execution Finished.**\n`;
        } else {
          await new Promise(resolve => setTimeout(resolve, 120 * 1000));
        }
      }
      return { content: [{ type: "text", text: fullReport }] };
    } else {
      const { subtasks, reportText, statusTable, instructions } = await runOrchestrationCycle();
      const dashboardPort = this.settings.dashboardPort || DASHBOARD_PORT;
      let report = `### Sprint ${args.sprint_number} Orchestration Report\n\n`;
      report += `**Feature Branch:** \`${defaultFeatureBranch}\`\n`;
      report += `**Dashboard:** [http://localhost:${dashboardPort}](http://localhost:${dashboardPort})\n\n`;
      report += reportText;
      report += statusTable;
      report += instructions;

      try {
        const orchGuide = await this.getGuideContent("orchestrator.md", args.repo_path);
        report += `\n---\n\n### Orchestration Guidance\n\n${orchGuide}`;
      } catch {
        // No orchestrator guide found
      }

      return { content: [{ type: "text", text: report }] };
    }
  }

  private async handleTaskAgent(args: {
    prompt: string;
    source_id: string;
    repo_path: string;
    title?: string;
    branch?: string;
    wait?: boolean;
  }) {
    let workerGuide = "";
    try {
      workerGuide = await this.getGuideContent("worker.md", args.repo_path);
    } catch (error) {
      // Fallback if no worker guide is found, though it's recommended
      console.error("Warning: worker.md guide not found for task_agent.");
    }

    const fullPrompt = workerGuide 
      ? `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerGuide}\n\n---\n\n## TASK TO EXECUTE\n\n${args.prompt}`
      : args.prompt;

    const maxFails = this.settings.maxFailures || 5;
    if (this.consecutiveFailures >= maxFails) {
      throw new Error(`CRITICAL: Emergency stop active. ${this.consecutiveFailures} consecutive task creation failures detected.`);
    }

    const data: any = {
      prompt: fullPrompt,
      sourceContext: { 
        source: this.normalizeName("sources", args.source_id),
      },
      automationMode: "AUTO_CREATE_PR"
    };

    if (args.branch) {
      data.sourceContext.githubRepoContext = { startingBranch: args.branch };
    }
    if (args.title) {
      data.title = args.title;
    }

    try {
      const response = await this.axiosInstance.post<JulesSession>("/sessions", data);
      const session = response.data;
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

  private async getGuideContent(guideName: string, repoPath?: string): Promise<string> {
    const relativePath = path.join(".jules-subagents", "agents", guideName);
    let searchPaths = this.getSearchPaths(relativePath);
    
    if (repoPath) {
      const repoScopedPath = path.join(repoPath, relativePath);
      if (!searchPaths.includes(repoScopedPath)) {
        searchPaths.unshift(repoScopedPath); // Explicit repo_path takes top priority
      }
    }

    for (const searchPath of searchPaths) {
      try {
        await fs.access(searchPath);
        return await fs.readFile(searchPath, "utf-8");
      } catch {
        continue;
      }
    }
    
    throw new Error(`Guide not found: ${guideName}`);
  }

  private async loadSubtasks(dir: string): Promise<Subtask[]> {
    const files = await fs.readdir(dir);
    const subtasks: Subtask[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await fs.readFile(path.join(dir, file), "utf-8");
      const id = file.replace(".md", "");
      const titleMatch = content.match(/title:\s*(.*)/);
      const dependsMatch = content.match(/depends_on:\s*\[(.*)\]/);
      const independentMatch = content.match(/is_independent:\s*(true|false)/);
      const mergedMatch = content.match(/merged:\s*(true|false)/);
      const promptMatch = content.match(/prompt:\s*([\s\S]*)/);
      subtasks.push({
        id,
        title: titleMatch ? titleMatch[1].trim() : id,
        prompt: promptMatch ? promptMatch[1].trim() : content,
        depends_on: dependsMatch ? dependsMatch[1].split(",").map(s => s.trim()).filter(s => s) : [],
        is_independent: independentMatch ? independentMatch[1] === "true" : true,
        is_merged: mergedMatch ? mergedMatch[1] === "true" : false,
        status: "PENDING",
      });
    }
    return subtasks;
  }

  private async startJulesTask(task: Subtask, sourceId: string, baseBranch: string, repoPath: string, sprintNumber: number): Promise<JulesSession> {
    const workerGuide = await this.getGuideContent("worker.md", repoPath);
    const fullPrompt = `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerGuide}\n\n---\n\n## SUBTASK TO EXECUTE\n\n${task.prompt}`;
    const data = {
      prompt: fullPrompt,
      title: `Sprint ${sprintNumber}: [${task.id}] ${task.title}`,
      sourceContext: {
        source: this.normalizeName("sources", sourceId),
        githubRepoContext: { startingBranch: baseBranch }
      },
      automationMode: "AUTO_CREATE_PR"
    };
    const response = await this.axiosInstance.post("/sessions", data);
    return response.data;
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
