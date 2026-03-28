import express, { type Express } from "express";
import * as fs from "fs";
import * as path from "path";
import type { Server } from "http";
import { createServer, request as httpRequest } from "http";
import type { IncomingMessage } from "http";
import net from "net";
import type { Duplex } from "stream";
import type {
  ExecutionAttentionItemSummary,
  ExecutionAssignedWorkerSummary,
  DockerContainer,
  ExecutionDashboardSnapshot,
  ExternalSettingsHints,
    GitTrackingStatus,
    JulesActivity,
    OverviewTelemetrySnapshot,
    ProjectExecutionStatsSnapshot,
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

  rerunTask: (taskId: string, options?: { provider?: string; clearWorktree?: boolean }) => Promise<unknown>;
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

const PREVIEW_BRIDGE_PATH = "/_sprint_os/preview-bridge.js";
const PREVIEW_HOST_PREFIX = "preview-";
const LOCAL_PREVIEW_HOST_SUFFIX = ".localhost";

function parsePreviewSessionIdFromHost(hostHeader: string | undefined): string | null {
  const rawHost = String(hostHeader || "").trim().toLowerCase();
  if (!rawHost) {
    return null;
  }
  const hostWithoutPort = rawHost.split(":")[0] || "";
  if (!hostWithoutPort.startsWith(PREVIEW_HOST_PREFIX) || !hostWithoutPort.endsWith(LOCAL_PREVIEW_HOST_SUFFIX)) {
    return null;
  }
  const sessionId = hostWithoutPort.slice(PREVIEW_HOST_PREFIX.length, hostWithoutPort.length - LOCAL_PREVIEW_HOST_SUFFIX.length).trim();
  return sessionId || null;
}

function buildDashboardOriginForPreviewHost(req: express.Request): string {
  const protocol = req.protocol || "http";
  const rawHost = String(req.headers.host || "").trim();
  const hostWithoutPort = rawHost.split(":")[0] || "localhost";
  const port = rawHost.includes(":") ? rawHost.slice(rawHost.lastIndexOf(":")) : "";
  const dashboardHost = hostWithoutPort.startsWith(PREVIEW_HOST_PREFIX) && hostWithoutPort.endsWith(LOCAL_PREVIEW_HOST_SUFFIX)
    ? `localhost${port}`
    : rawHost;
  return `${protocol}://${dashboardHost}`;
}

function buildPreviewBridgeScript(): string {
  return [
    "(() => {",
    "  const sendState = () => {",
    "    try {",
    "      window.parent?.postMessage({",
    "        type: 'sprint-preview:state',",
    "        href: window.location.href,",
    "        path: `${window.location.pathname}${window.location.search}${window.location.hash}`,",
    "        title: document.title || ''",
    "      }, '*');",
    "    } catch {}",
    "  };",
    "  const wrapHistory = (methodName) => {",
    "    const original = history[methodName];",
    "    if (typeof original !== 'function') return;",
    "    history[methodName] = function (...args) {",
    "      const result = original.apply(this, args);",
    "      queueMicrotask(sendState);",
    "      return result;",
    "    };",
    "  };",
    "  wrapHistory('pushState');",
    "  wrapHistory('replaceState');",
    "  window.addEventListener('popstate', sendState);",
    "  window.addEventListener('hashchange', sendState);",
    "  window.addEventListener('load', sendState);",
    "  document.addEventListener('DOMContentLoaded', sendState);",
    "  window.addEventListener('message', (event) => {",
    "    const message = event.data || {};",
    "    if (message.type !== 'sprint-preview:navigate') return;",
    "    const action = String(message.action || '');",
    "    if (action === 'back') { history.back(); return; }",
    "    if (action === 'forward') { history.forward(); return; }",
    "    if (action === 'reload') { window.location.reload(); return; }",
    "    if (action === 'push' || action === 'replace') {",
    "      const target = typeof message.path === 'string' && message.path.trim() ? message.path.trim() : '/';",
    "      if (action === 'replace') window.location.replace(target);",
    "      else window.location.assign(target);",
    "    }",
    "  });",
    "})();",
  ].join("\n");
}

function injectPreviewBridgeIntoHtml(html: string): string {
  const tag = `<script src="${PREVIEW_BRIDGE_PATH}"></script>`;
  if (html.includes(PREVIEW_BRIDGE_PATH)) {
    return html;
  }
  if (html.includes("</head>")) {
    return html.replace("</head>", `  ${tag}\n</head>`);
  }
  if (html.includes("</body>")) {
    return html.replace("</body>", `  ${tag}\n</body>`);
  }
  return `${html}\n${tag}\n`;
}

function rewritePreviewLocationHeader(location: string, req: express.Request, upstreamPort: number): string {
  if (!location) {
    return location;
  }
  const previewOrigin = `${req.protocol || "http"}://${String(req.headers.host || "").trim()}`;
  const upstreamOrigins = new Set([
    `http://127.0.0.1:${upstreamPort}`,
    `http://localhost:${upstreamPort}`,
  ]);
  for (const upstreamOrigin of upstreamOrigins) {
    if (location.startsWith(upstreamOrigin)) {
      return `${previewOrigin}${location.slice(upstreamOrigin.length)}`;
    }
  }
  return location;
}

async function pipePreviewUpgradeRequest(args: {
  req: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  upstreamPort: number;
}): Promise<void> {
  const upstreamSocket = net.connect(args.upstreamPort, "127.0.0.1");
  const requestLines = [`${args.req.method || "GET"} ${args.req.url || "/"} HTTP/${args.req.httpVersion}`];
  for (const [key, value] of Object.entries(args.req.headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        requestLines.push(`${key}: ${item}`);
      }
      continue;
    }
    requestLines.push(`${key}: ${value}`);
  }
  requestLines.push("", "");
  const requestBuffer = Buffer.from(requestLines.join("\r\n"), "utf8");

  const destroyBoth = () => {
    args.socket.destroy();
    upstreamSocket.destroy();
  };

  upstreamSocket.on("connect", () => {
    upstreamSocket.write(requestBuffer);
    if (args.head.length > 0) {
      upstreamSocket.write(args.head);
    }
    args.socket.pipe(upstreamSocket);
    upstreamSocket.pipe(args.socket);
  });
  upstreamSocket.on("error", destroyBoth);
  args.socket.on("error", destroyBoth);
  args.socket.on("close", () => upstreamSocket.destroy());
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

  app.use(async (req, res, next) => {
    const sessionId = parsePreviewSessionIdFromHost(req.headers.host);
    if (!sessionId) {
      next();
      return;
    }
    if (req.path === PREVIEW_BRIDGE_PATH) {
      res.type("application/javascript").send(buildPreviewBridgeScript());
      return;
    }
    if (!getSprintPreviewSession) {
      res.status(503).send("Sprint preview runtime is unavailable.");
      return;
    }

    let session: SprintPreviewSession | null = null;
    try {
      session = await getSprintPreviewSession(sessionId);
    } catch (error) {
      res.status(502).send(toErrorMessage(error, "Failed to resolve sprint preview session"));
      return;
    }
    if (!session?.hostPort) {
      res.status(404).send("Sprint preview session is unavailable.");
      return;
    }

    const headers = { ...req.headers } as Record<string, string | string[] | undefined>;
    delete headers["accept-encoding"];
    headers.host = String(req.headers.host || "");
    headers["x-forwarded-host"] = String(req.headers.host || "");
    headers["x-forwarded-proto"] = req.protocol || "http";
    if (req.socket.localPort) {
      headers["x-forwarded-port"] = String(req.socket.localPort);
    }

    const proxyRequest = httpRequest({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: session.hostPort,
      method: req.method,
      path: req.originalUrl || req.url,
      headers,
    }, (proxyResponse) => {
      const contentType = String(proxyResponse.headers["content-type"] || "");
      const isHtml = contentType.toLowerCase().includes("text/html");
      if (!isHtml) {
        const responseHeaders = { ...proxyResponse.headers };
        if (typeof responseHeaders.location === "string") {
          responseHeaders.location = rewritePreviewLocationHeader(responseHeaders.location, req, session.hostPort!);
        }
        res.writeHead(proxyResponse.statusCode || 502, responseHeaders);
        proxyResponse.pipe(res);
        return;
      }

      const chunks: Buffer[] = [];
      proxyResponse.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      proxyResponse.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const injected = injectPreviewBridgeIntoHtml(body);
        const responseHeaders = { ...proxyResponse.headers };
        delete responseHeaders["content-length"];
        delete responseHeaders["content-security-policy"];
        delete responseHeaders["content-security-policy-report-only"];
        if (typeof responseHeaders.location === "string") {
          responseHeaders.location = rewritePreviewLocationHeader(responseHeaders.location, req, session.hostPort!);
        }
        res.writeHead(proxyResponse.statusCode || 502, responseHeaders);
        res.end(injected);
      });
    });

    proxyRequest.on("error", (error) => {
      if (!res.headersSent) {
        res.status(502).send(toErrorMessage(error, "Failed to proxy sprint preview host request"));
      } else {
        res.end();
      }
    });

    req.pipe(proxyRequest);
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

  app.get("/api/docker/containers", async (req, res) => {
    try {
      const containers = await listDockerContainers();
      res.json(containers);
    } catch (error) {
      res.json([]);
    }
  });

  app.get("/api/projects/:projectId/preview/sessions", async (req, res) => {
    try {
      if (!listSprintPreviewSessions) {
        res.json([]);
        return;
      }
      res.json(await listSprintPreviewSessions(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list sprint preview sessions") });
    }
  });

  app.post("/api/projects/:projectId/sprints/:sprintId/preview/start", async (req, res) => {
    try {
      if (!startSprintPreviewSession) {
        throw new Error("Sprint preview runtime is unavailable.");
      }
      res.json(await startSprintPreviewSession(
        String(req.params.projectId || "").trim(),
        String(req.params.sprintId || "").trim(),
      ));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to start sprint preview session") });
    }
  });

  app.post("/api/browser/sessions/:sessionId/rebuild", async (req, res) => {
    try {
      if (!rebuildSprintPreviewSession) {
        throw new Error("Sprint preview runtime is unavailable.");
      }
      res.json(await rebuildSprintPreviewSession(String(req.params.sessionId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to rebuild sprint preview session") });
    }
  });

  app.post("/api/browser/sessions/:sessionId/stop", async (req, res) => {
    try {
      if (!stopSprintPreviewSession) {
        throw new Error("Sprint preview runtime is unavailable.");
      }
      res.json(await stopSprintPreviewSession(String(req.params.sessionId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to stop sprint preview session") });
    }
  });

  app.get("/api/projects/:projectId/sprints/:sprintId/preview/script", async (req, res) => {
    try {
      if (!getSprintPreviewScript) {
        throw new Error("Sprint preview runtime is unavailable.");
      }
      res.json(await getSprintPreviewScript(
        String(req.params.projectId || "").trim(),
        String(req.params.sprintId || "").trim(),
      ));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load sprint preview script") });
    }
  });

  app.put("/api/projects/:projectId/sprints/:sprintId/preview/script", async (req, res) => {
    try {
      if (!saveSprintPreviewScript) {
        throw new Error("Sprint preview runtime is unavailable.");
      }
      res.json(await saveSprintPreviewScript(
        String(req.params.projectId || "").trim(),
        String(req.params.sprintId || "").trim(),
        typeof req.body?.content === "string" ? req.body.content : "",
      ));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to save sprint preview script") });
    }
  });

  app.get("/api/browser/sessions/:sessionId/logs", async (req, res) => {
    try {
      if (!getSprintPreviewLogs) {
        throw new Error("Sprint preview runtime is unavailable.");
      }
      const tail = typeof req.query.tail === "string" ? Number(req.query.tail) : undefined;
      res.json(await getSprintPreviewLogs(String(req.params.sessionId || "").trim(), tail));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load sprint preview logs") });
    }
  });

  app.all("/api/browser/sessions/:sessionId/proxy{*rest}", async (req, res) => {
    try {
      if (!proxySprintPreviewRequest) {
        throw new Error("Sprint preview runtime is unavailable.");
      }
      const sessionId = String(req.params.sessionId || "").trim();
      const prefix = `/api/browser/sessions/${sessionId}/proxy`;
      const pathWithQuery = req.originalUrl.startsWith(prefix)
        ? req.originalUrl.slice(prefix.length) || "/"
        : "/";
      const body = req.body
        ? Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(JSON.stringify(req.body))
        : undefined;
      const proxied = await proxySprintPreviewRequest({
        sessionId,
        method: req.method,
        path: pathWithQuery,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value]),
        ),
        body,
      });
      for (const [key, value] of Object.entries(proxied.headers)) {
        res.setHeader(key, value);
      }
      res.status(proxied.status).send(proxied.body);
    } catch (error) {
      res.status(502).json({ error: toErrorMessage(error, "Failed to proxy sprint preview request") });
    }
  });

  // Combined endpoint — single HTTP call for live page initial load
  app.get("/api/live", (req, res) => {
    const status = getStatus() as { project_id?: string | null };
    const projectId = typeof status?.project_id === "string" && status.project_id.trim().length > 0
      ? status.project_id.trim()
      : null;

    res.json({
      status,
      execution: projectId ? options.getProjectExecutionSnapshot(projectId) : options.getExecutionSnapshot(),
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

    app.put("/api/projects/:projectId/selected-sprint", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      const sprintId = typeof req.body?.sprintId === "string" && req.body.sprintId.trim()
        ? req.body.sprintId.trim()
        : null;
      res.json({ selectedSprintId: options.selectSprint(projectId, sprintId) });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to select sprint") });
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

  app.get("/api/projects/:projectId/execution/invocations", (req, res) => {
    try {
      res.json(options.listProjectInvocations(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list project invocations") });
    }
  });

  app.get("/api/execution/invocations/:invocationId/messages", (req, res) => {
    try {
      res.json(options.listInvocationMessages(String(req.params.invocationId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list invocation messages") });
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

  app.put("/api/conversations/threads/:threadId/route", (req, res) => {
    if (!options.updateThreadRoute) {
      res.status(404).json({ error: "Thread routing is not enabled." });
      return;
    }
    try {
      const input = {
        routeKind: req.body?.routeKind as "worker" | "virtual",
        virtualProvider: typeof req.body?.virtualProvider === "string" ? req.body.virtualProvider.trim() : undefined,
        virtualModel: typeof req.body?.virtualModel === "string" ? req.body.virtualModel.trim() : undefined,
        workerEndpointId: typeof req.body?.workerEndpointId === "string" ? req.body.workerEndpointId.trim() : undefined,
      };
      if (input.routeKind !== "worker" && input.routeKind !== "virtual") {
        throw new Error("Invalid routeKind. Must be 'worker' or 'virtual'.");
      }
      res.json(options.updateThreadRoute(String(req.params.threadId || "").trim(), input));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update thread route") });
    }
  });

  app.post("/api/conversations/threads/:threadId/compact", async (req, res) => {
    if (!options.compactThreadSession) {
      res.status(404).json({ error: "Thread compaction is not enabled." });
      return;
    }
    try {
      res.json(await options.compactThreadSession(String(req.params.threadId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to compact thread session") });
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
      const body = req.body as { provider?: string; clearWorktree?: boolean } | undefined;
      const task = await rerunTask(taskId, {
        provider: typeof body?.provider === "string" ? body.provider : undefined,
        clearWorktree: body?.clearWorktree === true,
      });
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

  app.get("/api/projects/:projectId/quicksprints/templates", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      if (!options.quicksprintService) {
        res.status(404).json({ error: "Quicksprint service is not enabled." });
        return;
      }
      res.json(options.quicksprintService.listTemplates(projectId));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list quicksprint templates") });
    }
  });

  app.get("/api/projects/:projectId/quicksprints/templates/:templateId", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      const templateId = String(req.params.templateId || "").trim();
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
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to get quicksprint template") });
    }
  });

  app.post("/api/projects/:projectId/quicksprints/templates", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      if (!options.quicksprintService) {
        res.status(404).json({ error: "Quicksprint service is not enabled." });
        return;
      }
      const template = options.quicksprintService.createCustomTemplate(projectId, req.body as CreateQuicksprintTemplateInput);
      res.status(201).json(template);
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to create custom quicksprint template") });
    }
  });

  app.patch("/api/projects/:projectId/quicksprints/templates/:templateId", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      const templateId = String(req.params.templateId || "").trim();
      if (!options.quicksprintService) {
        res.status(404).json({ error: "Quicksprint service is not enabled." });
        return;
      }
      const template = options.quicksprintService.updateCustomTemplate(projectId, templateId, req.body as UpdateQuicksprintTemplateInput);
      res.json(template);
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update custom quicksprint template") });
    }
  });

  app.delete("/api/projects/:projectId/quicksprints/templates/:templateId", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      const templateId = String(req.params.templateId || "").trim();
      if (!options.quicksprintService) {
        res.status(404).json({ error: "Quicksprint service is not enabled." });
        return;
      }
      options.quicksprintService.deleteCustomTemplate(projectId, templateId);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to delete custom quicksprint template") });
    }
  });

  app.post("/api/projects/:projectId/quicksprints/execute", async (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      if (!options.quicksprintService) {
        res.status(404).json({ error: "Quicksprint service is not enabled." });
        return;
      }
      const sprint = await options.quicksprintService.executeQuicksprint(projectId, req.body as QuicksprintExecutionInput);
      res.status(201).json(sprint);
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to execute quicksprint") });
    }
  });

  app.post("/api/projects/:projectId/planning/improve-sprint-prompt", async (req, res) => {
    if (!improveSprintPrompt) {
      res.status(404).json({ error: "Sprint prompt improvement is not enabled." });
      return;
    }
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    try {
      const projectId = String(req.params.projectId || "").trim();
      const input: ImprovePromptInput = {
        name: typeof req.body?.name === "string" ? req.body.name.trim() : "",
        goal: typeof req.body?.goal === "string" ? req.body.goal : "",
        planningAgentPresetId: typeof req.body?.planningAgentPresetId === "string" ? req.body.planningAgentPresetId.trim() : undefined,
        overrides: req.body?.overrides,
      };
      res.status(202).json(await improveSprintPrompt(projectId, input, ac.signal));
    } catch (error) {
      if (!res.headersSent) {
        res.status(400).json({ error: toErrorMessage(error, "Failed to improve sprint prompt") });
      }
    }
  });

  app.post("/api/projects/:projectId/sprints/:sprintId/plan", async (req, res) => {
    if (!planSprint) {
      res.status(404).json({ error: "Sprint planning is not enabled." });
      return;
    }
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    try {
      const projectId = String(req.params.projectId || "").trim();
      const sprintId = String(req.params.sprintId || "").trim();
      const options: PlanSprintOptions = {
        autoStart: Boolean(req.body?.autoStart),
        replan: Boolean(req.body?.replan),
        planningAgentPresetId: typeof req.body?.planningAgentPresetId === "string" ? req.body.planningAgentPresetId.trim() : undefined,
        overrides: req.body?.overrides,
      };
      res.status(202).json(await planSprint(projectId, sprintId, options, ac.signal));
    } catch (error) {
      if (!res.headersSent) {
        res.status(400).json({ error: toErrorMessage(error, "Failed to plan sprint") });
      }
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
