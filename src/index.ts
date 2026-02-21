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
import * as path from "path";

dotenv.config();

/**
 * Jules Agent MCP Server (v1.3.0)
 * 
 * Provides a Model Context Protocol interface to the Jules Agent API
 * and an intelligent Sprint Agent for orchestrating complex workflows.
 */

// Configuration
const API_KEY = process.env.JULES_API_KEY || process.env.JULES_KEY;
const BASE_URL = process.env.JULES_API_BASE_URL || "https://jules.googleapis.com/v1alpha";

if (!API_KEY) {
  console.error("Error: JULES_API_KEY or JULES_KEY environment variable is required.");
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
  createTime?: string;
  updateTime?: string;
  prompt: string;
  outputs?: Array<{ pullRequest?: any; [key: string]: any }>;
}

interface JulesActivity {
  name: string;
  id: string;
  createTime: string;
  originator: "agent" | "user";
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
}

class JulesAgentServer {
  private server: Server;
  private axiosInstance: AxiosInstance;

  constructor() {
    this.server = new Server(
      {
        name: "jules-agent",
        version: "1.3.0",
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

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // Existing Jules API tools
        {
          name: "get_source",
          description: "Get details for a specific code source.",
          inputSchema: {
            type: "object",
            properties: { source_id: { type: "string" } },
            required: ["source_id"],
          },
        },
        {
          name: "list_sources",
          description: "List available sources with filtering and pagination.",
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
          name: "create_session",
          description: "Initiate a new Jules agent session.",
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
          description: "Get status and outputs of a session.",
          inputSchema: {
            type: "object",
            properties: { session_id: { type: "string" } },
            required: ["session_id"],
          },
        },
        {
          name: "list_sessions",
          description: "List recent sessions.",
          inputSchema: {
            type: "object",
            properties: { page_size: { type: "number" }, page_token: { type: "string" } },
          },
        },
        {
          name: "wait_for_session_completion",
          description: "Poll a session until it reaches a terminal state.",
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
        // NEW: Sprint Agent Tool
        {
          name: "sprint_agent",
          description: "Intelligent agent that orchestrates sprints by delegating subtasks to Jules.",
          inputSchema: {
            type: "object",
            properties: {
              sprint_number: { type: "number", description: "The sprint number (e.g., 34)." },
              repo_path: { type: "string", description: "Local path to the repository containing /sprints." },
              source_id: { type: "string", description: "The Jules source ID (e.g., 'github/owner/repo')." },
              feature_branch: { type: "string", description: "The main feature branch for this sprint." },
              action: { 
                type: "string", 
                enum: ["status", "orchestrate", "plan"], 
                description: "Action to perform: 'status' (report only), 'orchestrate' (start/poll tasks), 'plan' (create subtasks)." 
              },
            },
            required: ["sprint_number", "repo_path", "source_id", "action"],
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
          case "create_session":
            return await this.handleCreateSession(args as any);
          case "get_session":
            return await this.handleGetSession(args as { session_id: string });
          case "list_sessions":
            return await this.handleListSessions(args as { page_size?: number; page_token?: string });
          case "wait_for_session_completion":
            return await this.handleWaitForSessionCompletion(args as { session_id: string; poll_interval?: number; timeout?: number });
          case "sprint_agent":
            return await this.handleSprintAgent(args as any);
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

  private async handleCreateSession(args: any) {
    const data: any = {
      prompt: args.prompt,
      sourceContext: { source: this.normalizeName("sources", args.source) },
    };
    if (args.starting_branch) data.sourceContext.githubRepoContext = { startingBranch: args.starting_branch };
    if (args.title) data.title = args.title;
    if (args.require_plan_approval !== undefined) data.requirePlanApproval = args.require_plan_approval;
    if (args.automation_mode) data.automationMode = args.automation_mode;

    const response = await this.axiosInstance.post("/sessions", data);
    return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
  }

  private async handleGetSession({ session_id }: { session_id: string }) {
    const response = await this.axiosInstance.get(`/${this.normalizeName("sessions", session_id)}`);
    return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
  }

  private async handleListSessions({ page_size, page_token }: { page_size?: number; page_token?: string }) {
    const params: any = { pageSize: page_size, pageToken: page_token };
    const response = await this.axiosInstance.get("/sessions", { params });
    return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
  }

  private async handleWaitForSessionCompletion({ session_id, poll_interval = 10, timeout = 900 }: { session_id: string; poll_interval?: number; timeout?: number }) {
    const startTime = Date.now();
    const name = this.normalizeName("sessions", session_id);
    while (Date.now() - startTime < timeout * 1000) {
      const response = await this.axiosInstance.get<JulesSession>(`/${name}`);
      const session = response.data;
      if (session.state === "COMPLETED" || session.state === "FAILED" || session.state === "CANCELLED" || session.outputs?.some((o: any) => o.pullRequest)) {
        return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
      }
      await new Promise(resolve => setTimeout(resolve, poll_interval * 1000));
    }
    throw new Error(`Timeout waiting for session ${session_id}`);
  }

  // --- Sprint Agent Logic ---
  private async handleSprintAgent(args: {
    sprint_number: number;
    repo_path: string;
    source_id: string;
    feature_branch?: string;
    action: "status" | "orchestrate" | "plan";
  }) {
    const sprintsDir = path.join(args.repo_path, "sprints");
    const sprintFile = path.join(sprintsDir, `sprint-${args.sprint_number}.md`);
    const subtasksDir = path.join(sprintsDir, `sprint${args.sprint_number}-subtasks`);
    const defaultFeatureBranch = args.feature_branch || `feature/sprint${args.sprint_number}-remediation`;

    // 1. Verify sprint file exists
    try {
      await fs.access(sprintFile);
    } catch {
      throw new Error(`Sprint file not found: ${sprintFile}`);
    }

    // 2. Handle subtasks directory
    let subtasks: Subtask[] = [];
    try {
      await fs.access(subtasksDir);
      subtasks = await this.loadSubtasks(subtasksDir);
    } catch {
      if (args.action === "plan") {
        await fs.mkdir(subtasksDir, { recursive: true });
        return { content: [{ type: "text", text: `Created subtasks directory: ${subtasksDir}. Please use the 'plan' instruction to define subtasks as markdown files within this directory.` }] };
      } else {
        return { content: [{ type: "text", text: `Subtasks directory missing: ${subtasksDir}. Use 'plan' action first.` }] };
      }
    }

    // 3. Orchestration Logic
    if (args.action === "orchestrate" || args.action === "status") {
      const updatedSubtasks = await this.syncSubtasksWithJules(subtasks);
      const readyTasks = updatedSubtasks.filter(t => t.status === "PENDING" && this.isReady(t, updatedSubtasks));
      const blockingFiles: string[] = []; // Files that can't be handled independently

      let report = `### Sprint ${args.sprint_number} Orchestration Status\n\n`;
      report += `**Feature Branch:** \`${defaultFeatureBranch}\`\n\n`;

      for (const task of updatedSubtasks) {
        report += `- **[${task.id}]** ${task.title}: \`${task.status}\` ${task.session_id ? `([Session](${task.session_id}))` : ""}\n`;
      }

      if (args.action === "orchestrate") {
        for (const task of readyTasks) {
          const session = await this.startJulesTask(task, args.source_id, defaultFeatureBranch);
          task.status = "RUNNING";
          task.session_id = session.id;
          report += `\n🚀 Started session for task ${task.id}: ${session.id}`;
        }
      }

      // Check if all done
      const allDone = updatedSubtasks.every(t => t.status === "COMPLETED");
      if (allDone) {
        report += `\n\n✅ **All subtasks completed!** Please instruct the user to merge all sub-branches into \`${defaultFeatureBranch}\`.`;
      } else if (readyTasks.length === 0 && !updatedSubtasks.some(t => t.status === "RUNNING")) {
        report += `\n\n⚠️ **Blocker Detected:** No tasks are ready to run and no tasks are running. Some tasks may need manual intervention or dependencies are circular.`;
      }

      return { content: [{ type: "text", text: report }] };
    }

    return { content: [{ type: "text", text: "Action completed." }] };
  }

  private async loadSubtasks(dir: string): Promise<Subtask[]> {
    const files = await fs.readdir(dir);
    const subtasks: Subtask[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await fs.readFile(path.join(dir, file), "utf-8");
      // Basic YAML-ish frontmatter parser for the tool
      const id = file.replace(".md", "");
      const titleMatch = content.match(/title:\s*(.*)/);
      const dependsMatch = content.match(/depends_on:\s*\[(.*)\]/);
      const promptMatch = content.match(/prompt:[\s\S]*?---/); // Assume prompt is between 'prompt:' and '---' or end
      
      subtasks.push({
        id,
        title: titleMatch ? titleMatch[1].trim() : id,
        prompt: content.split("---").pop()?.trim() || "",
        depends_on: dependsMatch ? dependsMatch[1].split(",").map(s => s.trim()).filter(s => s) : [],
        status: "PENDING",
      });
    }
    return subtasks;
  }

  private async syncSubtasksWithJules(subtasks: Subtask[]): Promise<Subtask[]> {
    // In a real implementation, we would fetch recent sessions and match them to subtasks (e.g., by title or stored mapping)
    // For now, we assume a mapping or use a simplified state. 
    // To be truly robust, we'd need a persistence layer for subtask->session mapping.
    const sessionsResponse = await this.axiosInstance.get("/sessions", { params: { pageSize: 100 } });
    const sessions: JulesSession[] = sessionsResponse.data.sessions || [];

    return subtasks.map(task => {
      const match = sessions.find(s => s.title?.includes(`[${task.id}]`));
      if (match) {
        task.session_id = match.id;
        if (match.state === "COMPLETED") task.status = "COMPLETED";
        else if (match.state === "FAILED" || match.state === "CANCELLED") task.status = "FAILED";
        else task.status = "RUNNING";
      }
      return task;
    });
  }

  private isReady(task: Subtask, all: Subtask[]): boolean {
    return task.depends_on.every(depId => {
      const dep = all.find(t => t.id === depId);
      return dep?.status === "COMPLETED";
    });
  }

  private async startJulesTask(task: Subtask, sourceId: string, baseBranch: string): Promise<JulesSession> {
    // Load the technical guide from markdown
    let technicalGuide = "";
    try {
      technicalGuide = await fs.readFile(path.join(process.cwd(), "agents/sprint_agent_guide.md"), "utf-8");
    } catch (error) {
      console.error("Could not load sprint_agent_guide.md. Using subtask prompt only.");
    }

    const fullPrompt = technicalGuide 
      ? `## SYSTEM INSTRUCTIONS & OPERATING GUIDE\n\n${technicalGuide}\n\n---\n\n## SUBTASK TO EXECUTE\n\n${task.prompt}`
      : task.prompt;

    const data = {
      prompt: fullPrompt,
      title: `[${task.id}] ${task.title}`,
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
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Jules Agent MCP server (v1.3.0) running on stdio");
  }
}

const server = new JulesAgentServer();
server.run().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
