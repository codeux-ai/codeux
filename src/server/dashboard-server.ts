import express, { type Express } from "express";
import * as fs from "fs";
import * as path from "path";
import type { Server } from "http";
import { createServer } from "http";
import type {
  DashboardSettings,
  ExecutionDashboardSnapshot,
  ExternalSettingsHints,
  GitTrackingStatus,
  JulesActivity,
  ReadinessProbeStatus,
} from "../contracts/app-types.js";
import type {
  ConversationMessageRecord,
  ConversationThreadRecord,
  CreateConversationThreadInput,
  CreateDashboardConversationMessageInput,
  McpConnectionRecord,
  UpdateMcpConnectionInput,
} from "../contracts/connection-chat-types.js";
import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  ProjectCollectionResponse,
  ProjectSummary,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintRecord,
  TaskRecord,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
} from "../contracts/project-management-types.js";
import { correlationIdMiddleware } from "../shared/logging/correlation-id.js";
import { createLogger, type Logger } from "../shared/logging/logger.js";

export interface DashboardServerOptions {
  app: Express;
  dashboardDir: string;
  port: number;
  liveActivityCacheMs: number;
  getStatus: () => unknown;
  getExecutionSnapshot: () => ExecutionDashboardSnapshot;
  getProjectExecutionSnapshot: (projectId: string) => ExecutionDashboardSnapshot;
  getLiveActivities: () => Promise<Record<string, JulesActivity[]>>;
  getGitStatus: () => Promise<GitTrackingStatus>;
  getExternalSettingsHints: () => ExternalSettingsHints;
  getSettings: () => DashboardSettings;
  listProjects: () => ProjectCollectionResponse;
  createProject: (input: CreateProjectInput) => ProjectSummary;
  getProject: (projectId: string) => ProjectSummary | null;
  updateProject: (projectId: string, input: UpdateProjectInput) => ProjectSummary;
  deleteProject: (projectId: string) => void;
  selectProject: (projectId: string | null) => string | null;
  listSprints: (projectId: string) => SprintRecord[];
  createSprint: (projectId: string, input: CreateSprintInput) => SprintRecord;
  updateSprint: (sprintId: string, input: UpdateSprintInput) => SprintRecord;
  deleteSprint: (sprintId: string) => void;
  importSprintFromMarkdown: (projectId: string, input: SprintMarkdownImportInput) => SprintRecord;
  exportSprintToMarkdown: (projectId: string, sprintId: string) => SprintMarkdownExportBundle;
  listTasks: (projectId: string, sprintId?: string) => TaskRecord[];
  createTask: (projectId: string, input: CreateTaskInput) => TaskRecord;
  updateTask: (taskId: string, input: UpdateTaskInput) => TaskRecord;
  deleteTask: (taskId: string) => void;
  listConnections: (projectId: string) => McpConnectionRecord[];
  updateConnection: (connectionId: string, input: UpdateMcpConnectionInput) => McpConnectionRecord;
  listConversationThreads: (projectId: string) => ConversationThreadRecord[];
  createConversationThread: (projectId: string, input: CreateConversationThreadInput) => ConversationThreadRecord;
  listConversationMessages: (threadId: string) => ConversationMessageRecord[];
  postConversationMessage: (projectId: string, input: CreateDashboardConversationMessageInput) => ConversationMessageRecord;
  saveSettings: (settings: DashboardSettings) => DashboardSettings;
  rerunTask: (taskId: string) => Promise<unknown>;
  logger?: Logger;
  isReady?: () => ReadinessProbeStatus;
  isHealthy?: () => ReadinessProbeStatus;
}

export interface DashboardServerHandle {
  port: number;
  server: Server;
}

const bindDashboardServer = async (
  app: Express,
  startPort: number,
  logger: Logger
): Promise<DashboardServerHandle> => {
  let port = Math.max(1, Math.min(65535, Math.round(startPort)));

  while (port <= 65535) {
    try {
      const server = await new Promise<Server>((resolve, reject) => {
        const listeningServer = createServer(app);
        listeningServer.listen(port, "127.0.0.1", () => resolve(listeningServer));
        listeningServer.on("error", reject);
      });
      return { port, server };
    } catch (error) {
      const message = error as NodeJS.ErrnoException;
      if (message.code !== "EADDRINUSE") {
        throw error;
      }
      logger.warn("Dashboard port in use. Trying next port.", {
        attemptedPort: port,
        nextPort: port + 1,
      });
      port += 1;
    }
  }

  throw new Error("No available dashboard port found in range 1-65535.");
};

export const setupDashboardServer = async (options: DashboardServerOptions): Promise<DashboardServerHandle> => {
  const {
    app,
    dashboardDir,
    port,
    liveActivityCacheMs,
    getStatus,
    getLiveActivities,
    getGitStatus,
    getExternalSettingsHints,
    getSettings,
    saveSettings,
    rerunTask,
    logger,
    isReady,
  } = options;

  const dashboardLogger = logger ?? createLogger({ bindings: { component: "dashboard-server" } });

  app.use(correlationIdMiddleware());
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      dashboardLogger.info("Dashboard request completed", {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  });

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    const healthy = options.isHealthy ? options.isHealthy() : { status: "UP" as const };
    if (healthy.status === "UP") {
      res.json(healthy);
    } else {
      res.status(503).json(healthy);
    }
  });

  app.get("/ready", (req, res) => {
    const ready = isReady ? isReady() : { status: "READY" as const };
    if (ready.status === "READY" || ready.status === "UP") {
      res.json(ready);
    } else {
      res.status(503).json(ready);
    }
  });

  app.get("/api/status", (req, res) => {
    res.json(getStatus());
  });

  app.get("/api/execution", (req, res) => {
    res.json(options.getExecutionSnapshot());
  });

  app.get("/api/projects/:projectId/execution", (req, res) => {
    try {
      res.json(options.getProjectExecutionSnapshot(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load execution snapshot") });
    }
  });

  app.get("/api/live-activities", async (req, res) => {
    try {
      const activitiesBySession = await getLiveActivities();
      res.json({
        activitiesBySession,
        polledAt: new Date().toISOString(),
        cacheTtlMs: liveActivityCacheMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Failed to fetch live activities: ${message}` });
    }
  });

  app.get("/api/settings", (req, res) => {
    res.json(getSettings());
  });

  app.get("/api/projects", (req, res) => {
    res.json(options.listProjects());
  });

  app.post("/api/projects", (req, res) => {
    try {
      res.status(201).json(options.createProject(req.body as CreateProjectInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to create project") });
    }
  });

  app.get("/api/projects/:projectId", (req, res) => {
    const projectId = String(req.params.projectId || "").trim();
    const project = options.getProject(projectId);
    if (!project) {
      res.status(404).json({ error: `Project not found: ${projectId}` });
      return;
    }
    res.json(project);
  });

  app.patch("/api/projects/:projectId", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      res.json(options.updateProject(projectId, req.body as UpdateProjectInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update project") });
    }
  });

  app.delete("/api/projects/:projectId", (req, res) => {
    try {
      options.deleteProject(String(req.params.projectId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to delete project") });
    }
  });

  app.put("/api/projects/:projectId/select", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      res.json({ selectedProjectId: options.selectProject(projectId || null) });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to select project") });
    }
  });

  app.get("/api/projects/:projectId/sprints", (req, res) => {
    try {
      res.json(options.listSprints(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list sprints") });
    }
  });

  app.post("/api/projects/:projectId/sprints", (req, res) => {
    try {
      res.status(201).json(options.createSprint(String(req.params.projectId || "").trim(), req.body as CreateSprintInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to create sprint") });
    }
  });

  app.post("/api/projects/:projectId/sprints/import", (req, res) => {
    try {
      res.status(201).json(
        options.importSprintFromMarkdown(String(req.params.projectId || "").trim(), req.body as SprintMarkdownImportInput)
      );
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to import sprint markdown") });
    }
  });

  app.get("/api/projects/:projectId/sprints/:sprintId/export", (req, res) => {
    try {
      res.json(options.exportSprintToMarkdown(String(req.params.projectId || "").trim(), String(req.params.sprintId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to export sprint markdown") });
    }
  });

  app.patch("/api/sprints/:sprintId", (req, res) => {
    try {
      res.json(options.updateSprint(String(req.params.sprintId || "").trim(), req.body as UpdateSprintInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update sprint") });
    }
  });

  app.delete("/api/sprints/:sprintId", (req, res) => {
    try {
      options.deleteSprint(String(req.params.sprintId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to delete sprint") });
    }
  });

  app.get("/api/projects/:projectId/tasks", (req, res) => {
    try {
      const sprintId = typeof req.query.sprintId === "string" && req.query.sprintId.trim()
        ? req.query.sprintId.trim()
        : undefined;
      res.json(options.listTasks(String(req.params.projectId || "").trim(), sprintId));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list tasks") });
    }
  });

  app.post("/api/projects/:projectId/tasks", (req, res) => {
    try {
      res.status(201).json(options.createTask(String(req.params.projectId || "").trim(), req.body as CreateTaskInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to create task") });
    }
  });

  app.patch("/api/tasks/:taskId", (req, res) => {
    try {
      res.json(options.updateTask(String(req.params.taskId || "").trim(), req.body as UpdateTaskInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update task") });
    }
  });

  app.delete("/api/tasks/:taskId", (req, res) => {
    try {
      options.deleteTask(String(req.params.taskId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to delete task") });
    }
  });

  app.get("/api/projects/:projectId/connections", (req, res) => {
    try {
      res.json(options.listConnections(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list connections") });
    }
  });

  app.patch("/api/connections/:connectionId", (req, res) => {
    try {
      res.json(options.updateConnection(String(req.params.connectionId || "").trim(), req.body as UpdateMcpConnectionInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update connection") });
    }
  });

  app.get("/api/projects/:projectId/conversations/threads", (req, res) => {
    try {
      res.json(options.listConversationThreads(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list conversation threads") });
    }
  });

  app.post("/api/projects/:projectId/conversations/threads", (req, res) => {
    try {
      res.status(201).json(
        options.createConversationThread(String(req.params.projectId || "").trim(), req.body as CreateConversationThreadInput)
      );
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to create conversation thread") });
    }
  });

  app.get("/api/conversations/threads/:threadId/messages", (req, res) => {
    try {
      res.json(options.listConversationMessages(String(req.params.threadId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list conversation messages") });
    }
  });

  app.post("/api/projects/:projectId/conversations/messages", (req, res) => {
    try {
      res.status(201).json(
        options.postConversationMessage(String(req.params.projectId || "").trim(), req.body as CreateDashboardConversationMessageInput)
      );
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to post conversation message") });
    }
  });

  app.get("/api/settings/import-sources", (req, res) => {
    res.json(getExternalSettingsHints());
  });

  app.get("/api/git-status", async (req, res) => {
    try {
      const status = await getGitStatus();
      res.json(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Failed to fetch git status: ${message}` });
    }
  });

  app.put("/api/settings", (req, res) => {
    try {
      const saved = saveSettings(req.body as DashboardSettings);
      res.json(saved);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: `Failed to save settings: ${message}` });
    }
  });

  app.post("/api/tasks/:taskId/rerun", async (req, res) => {
    try {
      const taskId = String(req.params.taskId || "").trim();
      if (!taskId) {
        res.status(400).json({ error: "Missing task id." });
        return;
      }
      const task = await rerunTask(taskId);
      res.json({ ok: true, task });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: `Failed to rerun task: ${message}` });
    }
  });

  app.get("/favicon.ico", (req, res) => res.status(204).end());

  const builtDashboardDir = path.join(path.resolve(dashboardDir), "dist");
  const staticDir = fs.existsSync(builtDashboardDir) ? builtDashboardDir : path.resolve(dashboardDir);
  
  // 1. Serve static files (JS, CSS, etc.) first
  app.use(express.static(staticDir));

  // 2. SPA Fallback: For any GET request that isn't for an API and doesn't have an extension,
  // serve the index.html to allow client-side routing (TanStack Router) to take over.
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/") && !req.path.startsWith("/health") && !req.path.startsWith("/ready")) {
      const indexPath = path.join(staticDir, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
        return;
      }
    }
    next();
  });

  const handle = await bindDashboardServer(app, port, dashboardLogger);

  dashboardLogger.info("Dashboard server started", {
    port: handle.port,
    localhostUrl: `http://localhost:${handle.port}`,
    loopbackUrl: `http://127.0.0.1:${handle.port}`,
  });

  return handle;
};

function toErrorMessage(error: unknown, prefix: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${prefix}: ${message}`;
}
