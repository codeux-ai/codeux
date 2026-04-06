import express, { type Express } from "express";
import * as fs from "fs";
import * as path from "path";
import type { Server } from "http";
import { createServer, request as httpRequest } from "http";
import type { IncomingMessage } from "http";
import net from "net";
import type { Duplex } from "stream";
import type {
  DashboardStatus,
  ExecutionAttentionItemSummary,
  ExecutionAssignedWorkerSummary,
  DockerContainer,
  ExecutionDashboardSnapshot,
  ExternalSettingsHints,
  GitTrackingStatus,
  JulesActivity,
  OverviewTelemetrySnapshot,
  ProjectExecutionStatsSnapshot,
  ProjectLiveDashboardSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
  ReadinessProbeStatus,
  SprintPreviewScript,
  SprintPreviewSession,
} from "../contracts/app-types.js";
import type {
  EffectiveSettingsResponse,
  ProjectSettings,
  ProjectSettingsOverride,
  SprintSettingsOverride,
  SystemSettings,
} from "../contracts/settings-scope-types.js";

import type {
  CreateQuicksprintTemplateInput,
  QuicksprintExecutionInput,
  QuicksprintTemplateRecord,
  UpdateQuicksprintTemplateInput,
} from "../contracts/quicksprint-types.js";
import type { QuicksprintService } from "../services/quicksprint-service.js";
import type {
  AgentPresetRecord,
  CreateAgentPresetInput,
  UpdateAgentPresetInput,
} from "../contracts/agent-preset-types.js";
import type {
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord,
} from "../contracts/invocation-types.js";
import type {
  ConversationMessageRecord,
  ConversationThreadRecord,
  CreateConversationThreadInput,
  CreateDashboardConversationMessageInput,
  McpConnectionRecord,
  UpdateConversationThreadInput,
  UpdateConversationThreadRouteInput,
  UpdateMcpConnectionInput,
} from "../contracts/connection-chat-types.js";
import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  ImprovePromptInput,
  PlanSprintOptions,
  ProjectCollectionResponse,
  SprintCollectionResponse,
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

import { registerProjectRoutes } from "./project-routes.js";
import { registerSprintRoutes } from "./sprint-routes.js";
import { registerTaskRoutes } from "./task-routes.js";
import { registerConversationRoutes } from "./conversation-routes.js";
import { registerPlanningRoutes } from "./planning-routes.js";
import { registerPreviewRoutes } from "./preview-routes.js";
import { registerRuntimeRoutes } from "./runtime-routes.js";
import { registerExecutionControlRoutes } from "./execution-control-routes.js";

import { bootDashboardRealtimeWebSocketServer } from "./dashboard-realtime-websocket-server.js";
import type { DashboardRealtimeService } from "../services/dashboard-realtime-service.js";
import { asyncRoute, parseTrimmedString, requireTrimmedString, syncRoute, toErrorResponse } from "./route-utils.js";
import { createPreviewHostMiddleware } from "./preview-host-middleware.js";
import { parsePreviewSessionIdFromHost, pipePreviewUpgradeRequest } from "./preview-host-utils.js";

export type DashboardDependencies = Omit<
  DashboardServerOptions,
  | "app"
  | "dashboardDir"
  | "port"
  | "liveActivityCacheMs"
>;

export interface DashboardServerOptions {
  app: Express;
  dashboardDir: string;
  port: number;
  liveActivityCacheMs: number;
  getStatus: () => unknown;
  getLiveSnapshot: (projectId?: string | null) => Promise<ProjectLiveDashboardSnapshot> | ProjectLiveDashboardSnapshot;
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
  selectSprint: (projectId: string, sprintId: string | null) => string | null;
  listSprints: (projectId: string) => SprintCollectionResponse;
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
  updateThreadRoute: (threadId: string, input: UpdateConversationThreadRouteInput) => ConversationThreadRecord;
  compactThreadSession: (threadId: string) => Promise<ConversationThreadRecord> | ConversationThreadRecord;
  deleteConversationThread: (threadId: string) => void;
  listConversationMessages: (threadId: string) => ConversationMessageRecord[];
  postConversationMessage: (projectId: string, input: CreateDashboardConversationMessageInput) => Promise<ConversationMessageRecord> | ConversationMessageRecord;

  listProjectInvocations: (projectId: string) => ExecutionInvocationRecord[];
  listInvocationMessages: (invocationId: string) => ExecutionInvocationMessageRecord[];

  rerunTask: (taskId: string, options?: { provider?: string; clearWorktree?: boolean; resetDependents?: boolean }) => Promise<unknown>;
  orchestrateSprint: (projectId: string, sprintId: string) => Promise<unknown>;

  improveSprintPrompt?: (projectId: string, input: ImprovePromptInput, signal?: AbortSignal) => Promise<unknown>;
  planSprint?: (projectId: string, sprintId: string, options: PlanSprintOptions, signal?: AbortSignal) => Promise<unknown>;
  quicksprintService?: QuicksprintService;

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
  listDockerContainers: () => Promise<DockerContainer[]>;
  listSprintPreviewSessions?: (projectId: string) => Promise<SprintPreviewSession[]> | SprintPreviewSession[];
  getSprintPreviewSession?: (sessionId: string) => Promise<SprintPreviewSession | null> | SprintPreviewSession | null;
  startSprintPreviewSession?: (projectId: string, sprintId: string) => Promise<SprintPreviewSession> | SprintPreviewSession;
  rebuildSprintPreviewSession?: (sessionId: string) => Promise<SprintPreviewSession> | SprintPreviewSession;
  stopSprintPreviewSession?: (sessionId: string) => Promise<SprintPreviewSession> | SprintPreviewSession;
  removeSprintPreviewSession?: (sessionId: string) => Promise<void> | void;
  getSprintPreviewScript?: (projectId: string, sprintId: string) => Promise<SprintPreviewScript> | SprintPreviewScript;
  saveSprintPreviewScript?: (projectId: string, sprintId: string, content: string) => Promise<SprintPreviewScript> | SprintPreviewScript;
  getSprintPreviewLogs?: (sessionId: string, tail?: number) => Promise<{ logs: string }> | { logs: string };
  proxySprintPreviewRequest?: (args: {
    sessionId: string;
    method: string;
    path: string;
    headers?: Record<string, string | undefined>;
    body?: Buffer;
  }) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
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
  const host = (process.env.DASHBOARD_HOST || "127.0.0.1").trim() || "127.0.0.1";
  let port = Math.max(1, Math.min(65535, Math.round(startPort)));

  while (port <= 65535) {
    try {
      const server = await new Promise<Server>((resolve, reject) => {
        const listeningServer = createServer(app);
        listeningServer.listen(port, host, () => resolve(listeningServer));
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
    listDockerContainers,
    listSprintPreviewSessions,
    getSprintPreviewSession,
    startSprintPreviewSession,
    rebuildSprintPreviewSession,
    stopSprintPreviewSession,
    removeSprintPreviewSession,
    getSprintPreviewScript,
    saveSprintPreviewScript,
    getSprintPreviewLogs,
    proxySprintPreviewRequest,
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

  app.use(createPreviewHostMiddleware(options));

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

  app.get("/api/docker/containers", asyncRoute(async (req, res) => {
    try {
      const containers = await listDockerContainers();
      res.json(containers);
    } catch (error) {
      res.json([]);
    }
  }));

  app.get("/api/live-activities", asyncRoute(async (req, res) => {
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
  }));

  app.get("/api/system-settings", syncRoute((req, res) => {
    res.json(getSystemSettings());
  }));

  app.put("/api/system-settings", syncRoute((req, res) => {
    res.json(saveSystemSettings(req.body as SystemSettings));
  }));

  app.post("/api/system/reset-database", asyncRoute(async (req, res) => {
    await resetDatabase();
    res.json({ ok: true });
  }));


  const deps: DashboardDependencies = options;
  registerProjectRoutes(app, deps);
  registerSprintRoutes(app, deps);
  registerTaskRoutes(app, deps);
  registerConversationRoutes(app, deps);
  registerPlanningRoutes(app, deps);
  registerPreviewRoutes(app, deps);
  registerRuntimeRoutes(app, deps);
  registerExecutionControlRoutes(app, deps);

  app.get("/api/projects/:projectId/connections", syncRoute((req, res) => {
    res.json(options.listConnections(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  app.get("/api/projects/:projectId/agent-presets", asyncRoute(async (req, res) => {
    res.json(await options.listAgentPresets(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  app.post("/api/projects/:projectId/agent-presets", asyncRoute(async (req, res) => {
    res.status(201).json(await options.createAgentPreset(requireTrimmedString(req.params.projectId, "projectId"), req.body as CreateAgentPresetInput));
  }));

  app.patch("/api/agent-presets/:agentPresetId", asyncRoute(async (req, res) => {
    res.json(await options.updateAgentPreset(requireTrimmedString(req.params.agentPresetId, "agentPresetId"), req.body as UpdateAgentPresetInput));
  }));

  app.delete("/api/agent-presets/:agentPresetId", asyncRoute(async (req, res) => {
    await options.deleteAgentPreset(requireTrimmedString(req.params.agentPresetId, "agentPresetId"));
    res.json({ ok: true });
  }));

  app.post("/api/agent-presets/:agentPresetId/import-markdown", asyncRoute(async (req, res) => {
    if (!options.importAgentPresetFromMarkdown) {
      res.status(404).json({ error: "Markdown import is not enabled for agents." });
      return;
    }
    res.json(await options.importAgentPresetFromMarkdown(requireTrimmedString(req.params.agentPresetId, "agentPresetId")));
  }));

  app.post("/api/projects/:projectId/agent-presets/sync-markdown", asyncRoute(async (req, res) => {
    if (!options.syncAllAgentPresetsFromMarkdown) {
      res.status(404).json({ error: "Bulk markdown sync is not enabled for agents." });
      return;
    }
    res.json(await options.syncAllAgentPresetsFromMarkdown(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  app.patch("/api/connections/:connectionId", syncRoute((req, res) => {
    res.json(options.updateConnection(requireTrimmedString(req.params.connectionId, "connectionId"), req.body as UpdateMcpConnectionInput));
  }));

  app.get("/api/projects/:projectId/execution/invocations", syncRoute((req, res) => {
    res.json(options.listProjectInvocations(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  app.get("/api/execution/invocations/:invocationId/messages", syncRoute((req, res) => {
    res.json(options.listInvocationMessages(requireTrimmedString(req.params.invocationId, "invocationId")));
  }));

  app.get("/api/settings/import-sources", syncRoute((req, res) => {
    res.json(getExternalSettingsHints());
  }));

  app.get("/api/git-status", asyncRoute(async (req, res) => {
    try {
      const status = await getGitStatus();
      res.json(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Failed to fetch git status: ${message}` });
    }
  }));

  app.get("/api/projects/:projectId/quicksprints/templates", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    if (!options.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    res.json(options.quicksprintService.listTemplates(projectId));
  }));

  app.get("/api/projects/:projectId/quicksprints/templates/:templateId", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const templateId = requireTrimmedString(req.params.templateId, "templateId");
    if (!options.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const template = options.quicksprintService.getTemplate(projectId, templateId);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(template);
  }));

  app.post("/api/projects/:projectId/quicksprints/templates", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    if (!options.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const template = options.quicksprintService.createCustomTemplate(projectId, req.body as CreateQuicksprintTemplateInput);
    res.status(201).json(template);
  }));

  app.patch("/api/projects/:projectId/quicksprints/templates/:templateId", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const templateId = requireTrimmedString(req.params.templateId, "templateId");
    if (!options.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const template = options.quicksprintService.updateCustomTemplate(projectId, templateId, req.body as UpdateQuicksprintTemplateInput);
    res.json(template);
  }));

  app.delete("/api/projects/:projectId/quicksprints/templates/:templateId", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const templateId = requireTrimmedString(req.params.templateId, "templateId");
    if (!options.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    options.quicksprintService.deleteCustomTemplate(projectId, templateId);
    res.json({ ok: true });
  }));

  app.post("/api/projects/:projectId/quicksprints/execute", asyncRoute(async (req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    if (!options.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    const sprint = await options.quicksprintService.executeQuicksprint(projectId, req.body as QuicksprintExecutionInput, ac.signal);
    res.status(201).json(sprint);
  }));

  app.get("/favicon.ico", (req, res) => res.status(204).end());

  const builtDashboardDir = path.join(path.resolve(dashboardDir), "dist");
  const staticDir = fs.existsSync(builtDashboardDir) ? builtDashboardDir : path.resolve(dashboardDir);
  
  // 1. Serve static files (JS, CSS, etc.) first
  app.use(express.static(staticDir));

  // 2. SPA Fallback: For any GET request that isn't for an API and doesn't have an extension,
  // serve the index.html to allow client-side routing (TanStack Router) to take over.
  app.use((req, res, next) => {
    const isGet = req.method === "GET";
    const isApi = req.path.startsWith("/api/") || req.path.startsWith("/health") || req.path.startsWith("/ready");
    const isExtensionless = path.extname(req.path) === "";
    const isPreviewHost = parsePreviewSessionIdFromHost(req.headers.host) !== null;

    if (isGet && !isApi && isExtensionless && !isPreviewHost) {
      const indexPath = path.join(path.resolve(staticDir), "index.html");
      res.sendFile(indexPath, (err: any) => {
        if (err) {
          // If the file is simply not found, pass to the next middleware (usually resulting in a 404).
          if ((err as any).code === "ENOENT" || (err as any).status === 404) {
            next();
          } else {
            next(err);
          }
        }
      });
      return;
    }
    next();
  });

  const handle = await bindDashboardServer(app, port, dashboardLogger);

  handle.server.on("upgrade", (req, socket, head) => {
    const sessionId = parsePreviewSessionIdFromHost(req.headers.host);
    if (!sessionId || !getSprintPreviewSession) {
      return;
    }
    void (async () => {
      try {
        const session = await getSprintPreviewSession(sessionId);
        if (!session?.hostPort) {
          socket.destroy();
          return;
        }
        await pipePreviewUpgradeRequest({
          req,
          socket,
          head,
          upstreamPort: session.hostPort,
        });
      } catch {
        socket.destroy();
      }
    })();
  });

  if (options.realtimeService) {
    bootDashboardRealtimeWebSocketServer({
      server: handle.server,
      pathName: "/api/realtime",
      realtimeService: options.realtimeService,
      logger: dashboardLogger.child({ component: "dashboard-realtime-websocket" }),
      shouldHandleRequest: (req) => parsePreviewSessionIdFromHost(req.headers.host) === null,
    });
  }

  dashboardLogger.info("Dashboard server started", {
    port: handle.port,
    localhostUrl: `http://localhost:${handle.port}`,
    loopbackUrl: `http://127.0.0.1:${handle.port}`,
  });

  return handle;
};

