import express, { type Express } from "express";
import * as fs from "fs";
import * as path from "path";
import type { Server } from "http";
import { createServer } from "http";
import type {
  ExecutionAttentionItemSummary,
  ExecutionAssignedWorkerSummary,
  ExecutionDashboardSnapshot,
  ExternalSettingsHints,
    GitTrackingStatus,
    JulesActivity,
    OverviewTelemetrySnapshot,
    ProjectExecutionStatsSnapshot,
    ProjectStatsQuery,
    ProjectStatsWindow,
    ReadinessProbeStatus,
  } from "../contracts/app-types.js";
import type {
  EffectiveSettingsResponse,
  ProjectSettings,
  ProjectSettingsOverride,
  SprintSettingsOverride,
  SystemSettings,
} from "../contracts/settings-scope-types.js";
import type {
  AgentPresetRecord,
  CreateAgentPresetInput,
  UpdateAgentPresetInput,
} from "../contracts/agent-preset-types.js";
import type {
  ConversationMessageRecord,
  ConversationThreadRecord,
  CreateConversationThreadInput,
  CreateDashboardConversationMessageInput,
  McpConnectionRecord,
  UpdateConversationThreadInput,
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
import { bootDashboardRealtimeWebSocketServer } from "./dashboard-realtime-websocket-server.js";
import type { DashboardRealtimeService } from "../services/dashboard-realtime-service.js";

export interface DashboardServerOptions {
  app: Express;
  dashboardDir: string;
  port: number;
  liveActivityCacheMs: number;
  getStatus: () => unknown;
  getExecutionSnapshot: () => ExecutionDashboardSnapshot;
  getProjectExecutionSnapshot: (projectId: string) => ExecutionDashboardSnapshot;
  getProjectStatsSnapshot: (projectId: string, query?: ProjectStatsQuery) => ProjectExecutionStatsSnapshot;
  setPreferredWorker?: (
    projectId: string,
    input?: {
      workerConnectionId?: string | null;
      workerEndpointId?: string | null;
      workerEndpointKey?: string | null;
    },
  ) => {
    primaryAssignedWorker: ExecutionAssignedWorkerSummary | null;
    overflowAssignedWorkers: ExecutionAssignedWorkerSummary[];
  };
  claimAttentionItem?: (
    projectId: string,
    attentionItemId: string,
    input?: { workerEndpointId?: string; claimReason?: string },
  ) => ExecutionAttentionItemSummary;
  resolveAttentionItem?: (
    projectId: string,
    attentionItemId: string,
    input?: { status?: "resolved" | "dismissed"; reason?: string; resolutionSummaryMarkdown?: string },
  ) => ExecutionAttentionItemSummary;
  getOverviewTelemetrySnapshot: () => OverviewTelemetrySnapshot;
  getLiveActivities: () => Promise<Record<string, JulesActivity[]>>;
  getGitStatus: () => Promise<GitTrackingStatus>;
  getExternalSettingsHints: () => ExternalSettingsHints;
  getSystemSettings: () => SystemSettings;
  saveSystemSettings: (settings: SystemSettings) => SystemSettings;
  resetDatabase: () => Promise<void> | void;
  getProjectSettings: (projectId: string) => ProjectSettingsOverride;
  saveProjectSettings: (projectId: string, settings: ProjectSettingsOverride) => ProjectSettingsOverride;
  resetProjectSettings: (projectId: string) => void;
  getProjectEffectiveSettings: (projectId: string) => EffectiveSettingsResponse;
  getSprintSettings: (sprintId: string) => SprintSettingsOverride;
  saveSprintSettings: (projectId: string, sprintId: string, settings: SprintSettingsOverride) => SprintSettingsOverride;
  resetSprintSettings: (sprintId: string) => void;
  getSprintEffectiveSettings: (projectId: string, sprintId: string) => EffectiveSettingsResponse;
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
  listAgentPresets: (projectId: string) => Promise<AgentPresetRecord[]> | AgentPresetRecord[];
  createAgentPreset: (projectId: string, input: CreateAgentPresetInput) => Promise<AgentPresetRecord> | AgentPresetRecord;
  updateAgentPreset: (agentPresetId: string, input: UpdateAgentPresetInput) => Promise<AgentPresetRecord> | AgentPresetRecord;
  deleteAgentPreset: (agentPresetId: string) => Promise<void> | void;
  importAgentPresetFromMarkdown?: (agentPresetId: string) => Promise<AgentPresetRecord> | AgentPresetRecord;
  syncAllAgentPresetsFromMarkdown?: (projectId: string) => Promise<AgentPresetRecord[]> | AgentPresetRecord[];
  listConversationThreads: (projectId: string) => ConversationThreadRecord[];
  createConversationThread: (projectId: string, input: CreateConversationThreadInput) => ConversationThreadRecord;
  updateConversationThread: (threadId: string, input: UpdateConversationThreadInput) => ConversationThreadRecord;
  deleteConversationThread: (threadId: string) => void;
  listConversationMessages: (threadId: string) => ConversationMessageRecord[];
  postConversationMessage: (projectId: string, input: CreateDashboardConversationMessageInput) => ConversationMessageRecord;
  rerunTask: (taskId: string) => Promise<unknown>;
  orchestrateSprint: (projectId: string, sprintId: string) => Promise<unknown>;
  improveSprintPrompt?: (projectId: string, input: { name: string; goal: string }) => Promise<unknown>;
  planSprint?: (projectId: string, sprintId: string, input: { autoStart: boolean }) => Promise<unknown>;
  pauseSprintRun: (sprintRunId: string) => Promise<unknown> | unknown;
  cancelSprintRun: (sprintRunId: string) => Promise<unknown> | unknown;
  forceCancelSprintRun: (sprintRunId: string) => Promise<unknown> | unknown;
  cancelTaskDispatch: (dispatchId: string) => Promise<unknown> | unknown;
  forceCancelTaskDispatch: (dispatchId: string) => Promise<unknown> | unknown;
  retryTaskDispatch: (dispatchId: string) => Promise<unknown>;
  realtimeService?: DashboardRealtimeService;
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
    getSystemSettings,
    saveSystemSettings,
    resetDatabase,
    getProjectSettings,
    saveProjectSettings,
    resetProjectSettings,
    getProjectEffectiveSettings,
    getSprintSettings,
    saveSprintSettings,
    resetSprintSettings,
    getSprintEffectiveSettings,
    rerunTask,
    orchestrateSprint,
    improveSprintPrompt,
    planSprint,
    pauseSprintRun,
    cancelSprintRun,
    forceCancelSprintRun,
    cancelTaskDispatch,
    forceCancelTaskDispatch,
    retryTaskDispatch,
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

  // Combined endpoint — single HTTP call for live page initial load
  app.get("/api/live", (req, res) => {
    res.json({
      status: getStatus(),
      execution: options.getExecutionSnapshot(),
    });
  });

  app.get("/api/telemetry/overview", (req, res) => {
    res.json(options.getOverviewTelemetrySnapshot());
  });

  app.get("/api/projects/:projectId/execution", (req, res) => {
    try {
      res.json(options.getProjectExecutionSnapshot(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load execution snapshot") });
    }
  });

  app.get("/api/projects/:projectId/stats", (req, res) => {
    try {
      const query = parseProjectStatsQuery(req.query);
      res.json(options.getProjectStatsSnapshot(String(req.params.projectId || "").trim(), query));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load project stats snapshot") });
    }
  });

  app.put("/api/projects/:projectId/preferred-worker", (req, res) => {
    if (!options.setPreferredWorker) {
      res.status(501).json({ error: "Preferred worker assignment is not enabled." });
      return;
    }

    try {
      res.json(options.setPreferredWorker(
        String(req.params.projectId || "").trim(),
        {
          workerConnectionId: parseNullableTrimmedString(req.body?.workerConnectionId),
          workerEndpointId: parseNullableTrimmedString(req.body?.workerEndpointId),
          workerEndpointKey: parseNullableTrimmedString(req.body?.workerEndpointKey),
        },
      ));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update preferred worker") });
    }
  });

  app.post("/api/projects/:projectId/attention-items/:attentionItemId/claim", (req, res) => {
    if (!options.claimAttentionItem) {
      res.status(501).json({ error: "Attention item claim is not enabled." });
      return;
    }

    try {
      res.json(options.claimAttentionItem(
        String(req.params.projectId || "").trim(),
        String(req.params.attentionItemId || "").trim(),
        {
          workerEndpointId: typeof req.body?.workerEndpointId === "string" ? req.body.workerEndpointId.trim() : undefined,
          claimReason: typeof req.body?.claimReason === "string" ? req.body.claimReason.trim() : undefined,
        },
      ));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to claim attention item") });
    }
  });

  app.post("/api/projects/:projectId/attention-items/:attentionItemId/resolve", (req, res) => {
    if (!options.resolveAttentionItem) {
      res.status(501).json({ error: "Attention item resolution is not enabled." });
      return;
    }

    try {
      const requestedStatus = typeof req.body?.status === "string" ? req.body.status.trim() : undefined;
      res.json(options.resolveAttentionItem(
        String(req.params.projectId || "").trim(),
        String(req.params.attentionItemId || "").trim(),
        {
          status: requestedStatus === "dismissed" ? "dismissed" : "resolved",
          reason: typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined,
          resolutionSummaryMarkdown: typeof req.body?.resolutionSummaryMarkdown === "string"
            ? req.body.resolutionSummaryMarkdown
            : undefined,
        },
      ));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to resolve attention item") });
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

  app.get("/api/system-settings", (req, res) => {
    res.json(getSystemSettings());
  });

  app.put("/api/system-settings", (req, res) => {
    try {
      res.json(saveSystemSettings(req.body as SystemSettings));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to save system settings") });
    }
  });

  app.post("/api/system/reset-database", async (req, res) => {
    try {
      await resetDatabase();
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to reset database") });
    }
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

  app.get("/api/projects/:projectId/settings", (req, res) => {
    try {
      res.json(getProjectSettings(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load project settings") });
    }
  });

  app.put("/api/projects/:projectId/settings", (req, res) => {
    try {
      res.json(saveProjectSettings(String(req.params.projectId || "").trim(), req.body as ProjectSettingsOverride));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to save project settings") });
    }
  });

  app.delete("/api/projects/:projectId/settings", (req, res) => {
    try {
      resetProjectSettings(String(req.params.projectId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to reset project settings") });
    }
  });

  app.get("/api/projects/:projectId/settings/effective", (req, res) => {
    try {
      res.json(getProjectEffectiveSettings(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load effective project settings") });
    }
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

  app.get("/api/sprints/:sprintId/settings", (req, res) => {
    try {
      res.json(getSprintSettings(String(req.params.sprintId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load sprint settings") });
    }
  });

  app.put("/api/sprints/:sprintId/settings", (req, res) => {
    const projectId = typeof req.body?.projectId === "string" ? req.body.projectId.trim() : "";
    if (!projectId) {
      res.status(400).json({ error: "projectId is required when saving sprint settings." });
      return;
    }

    try {
      const sprintId = String(req.params.sprintId || "").trim();
      const payload = { ...(req.body as Record<string, unknown>) };
      delete payload.projectId;
      res.json(saveSprintSettings(projectId, sprintId, payload as SprintSettingsOverride));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to save sprint settings") });
    }
  });

  app.delete("/api/sprints/:sprintId/settings", (req, res) => {
    try {
      resetSprintSettings(String(req.params.sprintId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to reset sprint settings") });
    }
  });

  app.get("/api/projects/:projectId/sprints/:sprintId/settings/effective", (req, res) => {
    try {
      res.json(getSprintEffectiveSettings(
        String(req.params.projectId || "").trim(),
        String(req.params.sprintId || "").trim(),
      ));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load effective sprint settings") });
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

  app.get("/api/projects/:projectId/agent-presets", async (req, res) => {
    try {
      res.json(await options.listAgentPresets(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load agent presets") });
    }
  });

  app.post("/api/projects/:projectId/agent-presets", async (req, res) => {
    try {
      res.status(201).json(await options.createAgentPreset(String(req.params.projectId || "").trim(), req.body as CreateAgentPresetInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to create agent preset") });
    }
  });

  app.patch("/api/agent-presets/:agentPresetId", async (req, res) => {
    try {
      res.json(await options.updateAgentPreset(String(req.params.agentPresetId || "").trim(), req.body as UpdateAgentPresetInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update agent preset") });
    }
  });

  app.delete("/api/agent-presets/:agentPresetId", async (req, res) => {
    try {
      await options.deleteAgentPreset(String(req.params.agentPresetId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to delete agent preset") });
    }
  });

  app.post("/api/agent-presets/:agentPresetId/import-markdown", async (req, res) => {
    if (!options.importAgentPresetFromMarkdown) {
      res.status(404).json({ error: "Markdown import is not enabled for agents." });
      return;
    }
    try {
      res.json(await options.importAgentPresetFromMarkdown(String(req.params.agentPresetId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to import agent markdown") });
    }
  });

  app.post("/api/projects/:projectId/agent-presets/sync-markdown", async (req, res) => {
    if (!options.syncAllAgentPresetsFromMarkdown) {
      res.status(404).json({ error: "Bulk markdown sync is not enabled for agents." });
      return;
    }
    try {
      res.json(await options.syncAllAgentPresetsFromMarkdown(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to sync all agent markdown") });
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

  app.patch("/api/conversations/threads/:threadId", (req, res) => {
    try {
      res.json(options.updateConversationThread(String(req.params.threadId || "").trim(), req.body as UpdateConversationThreadInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update conversation thread") });
    }
  });

  app.delete("/api/conversations/threads/:threadId", (req, res) => {
    try {
      options.deleteConversationThread(String(req.params.threadId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to delete conversation thread") });
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

  app.post("/api/projects/:projectId/sprints/:sprintId/orchestrate", async (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      const sprintId = String(req.params.sprintId || "").trim();
      const result = await orchestrateSprint(projectId, sprintId);
      res.status(202).json(result);
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to start sprint orchestration") });
    }
  });

  app.post("/api/projects/:projectId/planning/improve-sprint-prompt", async (req, res) => {
    if (!improveSprintPrompt) {
      res.status(404).json({ error: "Sprint prompt improvement is not enabled." });
      return;
    }
    try {
      const projectId = String(req.params.projectId || "").trim();
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      const goal = typeof req.body?.goal === "string" ? req.body.goal : "";
      res.status(202).json(await improveSprintPrompt(projectId, { name, goal }));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to improve sprint prompt") });
    }
  });

  app.post("/api/projects/:projectId/sprints/:sprintId/plan", async (req, res) => {
    if (!planSprint) {
      res.status(404).json({ error: "Sprint planning is not enabled." });
      return;
    }
    try {
      const projectId = String(req.params.projectId || "").trim();
      const sprintId = String(req.params.sprintId || "").trim();
      const autoStart = Boolean(req.body?.autoStart);
      res.status(202).json(await planSprint(projectId, sprintId, { autoStart }));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to plan sprint") });
    }
  });

  app.post("/api/sprint-runs/:sprintRunId/pause", async (req, res) => {
    try {
      res.json(await pauseSprintRun(String(req.params.sprintRunId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to pause sprint run") });
    }
  });

  app.post("/api/sprint-runs/:sprintRunId/cancel", async (req, res) => {
    try {
      res.json(await cancelSprintRun(String(req.params.sprintRunId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to cancel sprint run") });
    }
  });

  app.post("/api/sprint-runs/:sprintRunId/force-cancel", async (req, res) => {
    try {
      res.json(await forceCancelSprintRun(String(req.params.sprintRunId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to force-cancel sprint run") });
    }
  });

  app.post("/api/task-dispatches/:dispatchId/cancel", async (req, res) => {
    try {
      res.json(await cancelTaskDispatch(String(req.params.dispatchId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to cancel task dispatch") });
    }
  });

  app.post("/api/task-dispatches/:dispatchId/force-cancel", async (req, res) => {
    try {
      res.json(await forceCancelTaskDispatch(String(req.params.dispatchId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to force-cancel task dispatch") });
    }
  });

  app.post("/api/task-dispatches/:dispatchId/retry", async (req, res) => {
    try {
      res.json(await retryTaskDispatch(String(req.params.dispatchId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to retry task dispatch") });
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

  if (options.realtimeService) {
    bootDashboardRealtimeWebSocketServer({
      server: handle.server,
      pathName: "/api/realtime",
      realtimeService: options.realtimeService,
      logger: dashboardLogger.child({ component: "dashboard-realtime-websocket" }),
    });
  }

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

function parseProjectStatsQuery(query: Record<string, unknown>): ProjectStatsQuery {
  const requestedWindow = typeof query.window === "string" ? query.window.trim() : "";
  const window: ProjectStatsWindow = (
    requestedWindow === "24h"
    || requestedWindow === "7d"
    || requestedWindow === "30d"
    || requestedWindow === "all"
    || requestedWindow === "custom"
  )
    ? requestedWindow
    : "7d";

  const from = typeof query.from === "string" && query.from.trim().length > 0 ? query.from.trim() : undefined;
  const to = typeof query.to === "string" && query.to.trim().length > 0 ? query.to.trim() : undefined;

  if (window === "custom" && (!from || !to)) {
    throw new Error("Custom stats windows require both from and to query parameters.");
  }

  return {
    window,
    from,
    to,
  };
}

function parseNullableTrimmedString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
