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

import { bootDashboardRealtimeWebSocketServer } from "./dashboard-realtime-websocket-server.js";
import type { DashboardRealtimeService } from "../services/dashboard-realtime-service.js";


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

const PREVIEW_BRIDGE_PATH = "/_sprint_os/preview-bridge.js";
const PREVIEW_STATUS_PATH = "/_sprint_os/preview-status";
const PREVIEW_START_PATH = "/_sprint_os/preview-start";
const PREVIEW_REBUILD_PATH = "/_sprint_os/preview-rebuild";
const PREVIEW_HOST_PREFIX = "preview-";

function escapeHtml(value: string | null | undefined): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function parsePreviewSessionIdFromHost(hostHeader: string | undefined): string | null {
  const rawHost = String(hostHeader || "").trim().toLowerCase();
  if (!rawHost) {
    return null;
  }
  const hostWithoutPort = rawHost.split(":")[0] || "";
  if (!hostWithoutPort.startsWith(PREVIEW_HOST_PREFIX)) {
    return null;
  }
  const firstDotIndex = hostWithoutPort.indexOf(".");
  if (firstDotIndex === -1) {
    return null; // Must have a domain suffix
  }
  const firstSegment = hostWithoutPort.slice(0, firstDotIndex);
  if (firstSegment === PREVIEW_HOST_PREFIX) {
    return null;
  }
  const sessionId = firstSegment.slice(PREVIEW_HOST_PREFIX.length).trim();
  return sessionId || null;
}

function buildDashboardOriginForPreviewHost(req: express.Request): string {
  const protocol = req.protocol || "http";
  const rawHost = String(req.headers.host || "").trim();
  const hostWithoutPort = rawHost.split(":")[0] || "localhost";
  const port = rawHost.includes(":") ? rawHost.slice(rawHost.lastIndexOf(":")) : "";

  if (hostWithoutPort.startsWith(PREVIEW_HOST_PREFIX)) {
    const firstDotIndex = hostWithoutPort.indexOf(".");
    if (firstDotIndex !== -1) {
      const dashboardHostWithoutPort = hostWithoutPort.slice(firstDotIndex + 1);
      const finalHost = dashboardHostWithoutPort === "localhost" ? `localhost${port}` : `${dashboardHostWithoutPort}${port}`;
      return `${protocol}://${finalHost}`;
    }
  }

  return `${protocol}://${rawHost}`;
}

function shouldAttemptPreviewSpaFallback(req: express.Request): boolean {
  const accept = String(req.headers.accept || "").toLowerCase();
  return req.method === "GET"
    && req.path !== "/"
    && path.extname(req.path) === ""
    && !req.path.startsWith("/api/")
    && !req.path.startsWith(PREVIEW_BRIDGE_PATH)
    && accept.includes("text/html");
}

function buildPreviewProxyRequestHeaders(
  req: express.Request,
  upstreamPort: number,
): Record<string, string | string[] | undefined> {
  const headers = { ...req.headers } as Record<string, string | string[] | undefined>;
  delete headers["accept-encoding"];
  headers["x-forwarded-host"] = String(req.headers.host || "");
  headers.host = `127.0.0.1:${upstreamPort}`;
  headers["x-forwarded-proto"] = req.protocol || "http";
  if (req.socket.localPort) {
    headers["x-forwarded-port"] = String(req.socket.localPort);
  }
  return headers;
}

async function requestBufferedPreviewResponse(args: {
  method: string;
  upstreamPort: number;
  targetPath: string;
  headers: Record<string, string | string[] | undefined>;
}): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return await new Promise((resolve, reject) => {
    const proxyRequest = httpRequest({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: args.upstreamPort,
      method: args.method,
      path: args.targetPath,
      headers: args.headers,
    }, (proxyResponse) => {
      const chunks: Buffer[] = [];
      proxyResponse.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      proxyResponse.on("end", () => {
        resolve({
          statusCode: proxyResponse.statusCode || 502,
          headers: { ...proxyResponse.headers },
          body: Buffer.concat(chunks),
        });
      });
    });

    proxyRequest.on("error", reject);
    proxyRequest.end();
  });
}

function sendBufferedPreviewResponse(args: {
  req: express.Request;
  res: express.Response;
  upstreamPort: number;
  response: { statusCode: number; headers: Record<string, string | string[] | undefined>; body: Buffer };
}): void {
  const contentType = String(args.response.headers["content-type"] || "");
  const isHtml = contentType.toLowerCase().includes("text/html");
  const responseHeaders = { ...args.response.headers };

  if (typeof responseHeaders.location === "string") {
    responseHeaders.location = rewritePreviewLocationHeader(responseHeaders.location, args.req, args.upstreamPort);
  }

  if (!isHtml) {
    args.res.writeHead(args.response.statusCode, responseHeaders);
    args.res.end(args.response.body);
    return;
  }

  delete responseHeaders["content-length"];
  delete responseHeaders["content-security-policy"];
  delete responseHeaders["content-security-policy-report-only"];
  args.res.writeHead(args.response.statusCode, responseHeaders);
  args.res.end(injectPreviewBridgeIntoHtml(args.response.body.toString("utf8")));
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
    "      try {",
    "        if (action === 'replace') history.replaceState(history.state, '', target);",
    "        else history.pushState(history.state, '', target);",
    "        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));",
    "        queueMicrotask(sendState);",
    "      } catch {",
    "        if (action === 'replace') window.location.replace(target);",
    "        else window.location.assign(target);",
    "      }",
    "    }",
    "  });",
    "})();",
  ].join("\n");
}

function buildPreviewStandbyHtml(args: {
  req: express.Request;
  session: SprintPreviewSession;
  reason?: string | null;
}): string {
  const requestedPath = args.req.originalUrl || args.req.url || "/";
  const status = args.session.status;
  const title = status === "starting"
    ? "Container is starting"
    : status === "stopped"
      ? "Container is stopped"
      : "Container is unavailable";
  const description = status === "starting"
    ? "Sprint OS is building and booting this preview container. The browser will reconnect automatically once the preview responds."
    : status === "stopped"
      ? "This preview container is currently offline. Start it again or rebuild it to bring the in-app browser back."
      : "The preview host is not reachable right now. Rebuild or start the container to restore the browser.";
  const detail = args.reason?.trim() || args.session.lastError?.trim() || "";
  const pollOnLoad = status === "starting" || status === "running";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg-a: #f8f4ea;
      --bg-b: #eef4ff;
      --panel: rgba(255,255,255,0.84);
      --panel-dark: rgba(5,8,13,0.88);
      --border: rgba(15,23,42,0.10);
      --text: #0f172a;
      --muted: #475569;
      --accent: #25c27a;
      --accent-text: #032314;
      --button: #0f172a;
      --button-text: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-a: #071018;
        --bg-b: #111827;
        --panel: var(--panel-dark);
        --border: rgba(255,255,255,0.10);
        --text: #f8fafc;
        --muted: #cbd5e1;
        --button: #e2e8f0;
        --button-text: #0f172a;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(37,194,122,0.16), transparent 28%),
        radial-gradient(circle at bottom right, rgba(59,130,246,0.14), transparent 30%),
        linear-gradient(160deg, var(--bg-a), var(--bg-b));
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .panel {
      width: min(680px, 100%);
      border-radius: 28px;
      border: 1px solid var(--border);
      background: var(--panel);
      box-shadow: 0 24px 80px rgba(15,23,42,0.16);
      padding: 32px;
      backdrop-filter: blur(18px);
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid rgba(37,194,122,0.24);
      background: rgba(37,194,122,0.10);
      color: #15935b;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    h1 {
      margin: 18px 0 10px;
      font-size: clamp(28px, 4vw, 38px);
      line-height: 1.05;
    }
    p {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.7;
    }
    .meta {
      margin-top: 18px;
      padding: 16px 18px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: rgba(15,23,42,0.04);
      font-size: 13px;
      line-height: 1.7;
      color: var(--muted);
    }
    .meta code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--text);
      word-break: break-word;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 22px;
    }
    button, a {
      appearance: none;
      border: 0;
      border-radius: 16px;
      cursor: pointer;
      text-decoration: none;
      font: inherit;
      font-weight: 700;
      padding: 12px 18px;
      transition: transform 140ms ease, opacity 140ms ease, background 140ms ease;
    }
    button:hover, a:hover { transform: translateY(-1px); }
    button:disabled { cursor: default; opacity: 0.55; transform: none; }
    .primary { background: var(--accent); color: var(--accent-text); }
    .secondary {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
    }
    .status {
      margin-top: 16px;
      min-height: 22px;
      font-size: 13px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <main class="panel">
    <div class="eyebrow">Preview Standby</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <div class="meta">
      <div><strong>Sprint:</strong> ${escapeHtml(args.session.sprintName)}</div>
      <div><strong>Container:</strong> ${escapeHtml(args.session.containerName || "Not assigned yet")}</div>
      <div><strong>Requested path:</strong> <code>${escapeHtml(requestedPath)}</code></div>
      ${detail ? `<div><strong>Details:</strong> ${escapeHtml(detail)}</div>` : ""}
    </div>
    <div class="actions">
      <button id="start" class="primary" type="button">Start Container</button>
      <button id="rebuild" class="secondary" type="button">Rebuild Container</button>
    </div>
    <div id="status" class="status"></div>
  </main>
  <script>
    (() => {
      const requestedPath = ${JSON.stringify(requestedPath)};
      const statusNode = document.getElementById("status");
      const startButton = document.getElementById("start");
      const rebuildButton = document.getElementById("rebuild");
      let pollTimer = null;

      const setBusy = (message, busy) => {
        if (statusNode) statusNode.textContent = message || "";
        if (startButton) startButton.disabled = Boolean(busy);
        if (rebuildButton) rebuildButton.disabled = Boolean(busy);
      };

	      const pollUntilReady = async () => {
	        try {
	          const response = await fetch(${JSON.stringify(PREVIEW_STATUS_PATH)}, {
	            headers: { Accept: "application/json" },
	            cache: "no-store",
	          });
	          if (!response.ok) {
	            throw new Error("Failed to refresh preview session state.");
	          }
	          const session = await response.json();
	          if (
	            session
	            && session.hostPort
	            && session.status !== "stopped"
	            && session.status !== "error"
	          ) {
	            window.location.replace(requestedPath);
	            return;
	          }
          if (session && session.lastError && statusNode) {
            statusNode.textContent = session.lastError;
          }
        } catch (error) {
          if (statusNode) {
            statusNode.textContent = error instanceof Error ? error.message : String(error);
          }
        }
        pollTimer = window.setTimeout(pollUntilReady, 2000);
      };

      const triggerAction = async (targetPath, busyMessage) => {
        window.clearTimeout(pollTimer);
        setBusy(busyMessage, true);
        try {
          const response = await fetch(targetPath, { method: "POST" });
          if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(body || "Preview action failed.");
          }
          pollTimer = window.setTimeout(pollUntilReady, 1200);
        } catch (error) {
          setBusy(error instanceof Error ? error.message : String(error), false);
        }
      };

      startButton?.addEventListener("click", () => {
        void triggerAction(${JSON.stringify(PREVIEW_START_PATH)}, "Starting preview container...");
      });
      rebuildButton?.addEventListener("click", () => {
        void triggerAction(${JSON.stringify(PREVIEW_REBUILD_PATH)}, "Rebuilding preview container...");
      });

      if (${pollOnLoad ? "true" : "false"}) {
        setBusy("Waiting for the preview container to respond...", true);
        pollTimer = window.setTimeout(pollUntilReady, 1200);
      }
    })();
  </script>
</body>
</html>`;
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
    const headerValue = key.toLowerCase() === "host" ? `127.0.0.1:${args.upstreamPort}` : value;
    if (Array.isArray(headerValue)) {
      for (const item of headerValue) {
        requestLines.push(`${key}: ${item}`);
      }
      continue;
    }
    requestLines.push(`${key}: ${headerValue}`);
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
    if (!session) {
      res.status(404).send("Sprint preview session is unavailable.");
      return;
    }

    if (req.path === PREVIEW_STATUS_PATH) {
      res.json(session);
      return;
    }

    if (req.path === PREVIEW_START_PATH) {
      if (!startSprintPreviewSession) {
        res.status(503).send("Sprint preview start is unavailable.");
        return;
      }
      try {
        const started = await startSprintPreviewSession(session.projectId, session.sprintId);
        res.json(started);
      } catch (error) {
        res.status(502).send(toErrorMessage(error, "Failed to start sprint preview session"));
      }
      return;
    }

    if (req.path === PREVIEW_REBUILD_PATH) {
      if (!rebuildSprintPreviewSession) {
        res.status(503).send("Sprint preview rebuild is unavailable.");
        return;
      }
      try {
        const rebuilt = await rebuildSprintPreviewSession(session.id);
        res.json(rebuilt);
      } catch (error) {
        res.status(502).send(toErrorMessage(error, "Failed to rebuild sprint preview session"));
      }
      return;
    }

    if (!session.hostPort) {
      res.status(200).type("html").send(buildPreviewStandbyHtml({
        req,
        session,
        reason: session.lastError || "Preview host port is not assigned yet.",
      }));
      return;
    }

    const upstreamHeaders = buildPreviewProxyRequestHeaders(req, session.hostPort);
    const targetPath = req.originalUrl || req.url || "/";
    if (shouldAttemptPreviewSpaFallback(req)) {
      try {
        const primaryResponse = await requestBufferedPreviewResponse({
          method: req.method,
          upstreamPort: session.hostPort,
          targetPath,
          headers: upstreamHeaders,
        });
        const response = primaryResponse.statusCode === 404
          ? await requestBufferedPreviewResponse({
            method: req.method,
            upstreamPort: session.hostPort,
            targetPath: "/",
            headers: upstreamHeaders,
          })
          : primaryResponse;
        sendBufferedPreviewResponse({
          req,
          res,
          upstreamPort: session.hostPort,
          response,
        });
      } catch (error) {
        res.status(200).type("html").send(buildPreviewStandbyHtml({
          req,
          session,
          reason: error instanceof Error ? error.message : String(error),
        }));
      }
      return;
    }

    const proxyRequest = httpRequest({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: session.hostPort,
      method: req.method,
      path: targetPath,
      headers: upstreamHeaders,
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
        const accept = String(req.headers.accept || "").toLowerCase();
        if (req.method === "GET" && accept.includes("text/html")) {
          res.status(200).type("html").send(buildPreviewStandbyHtml({
            req,
            session,
            reason: error instanceof Error ? error.message : String(error),
          }));
          return;
        }
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

  app.delete("/api/browser/sessions/:sessionId", async (req, res) => {
    try {
      if (!removeSprintPreviewSession) {
        throw new Error("Sprint preview runtime is unavailable.");
      }
      await removeSprintPreviewSession(String(req.params.sessionId || "").trim());
      res.status(204).end();
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to remove sprint preview session") });
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
  app.get("/api/live", async (req, res) => {
    try {
      const requestedProjectId = String(req.query.projectId || "").trim();
      const projectId = requestedProjectId.length > 0 ? requestedProjectId : null;
      res.json(await options.getLiveSnapshot(projectId));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load live snapshot") });
    }
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


  const deps: DashboardDependencies = options;
  registerProjectRoutes(app, deps);
  registerSprintRoutes(app, deps);
  registerTaskRoutes(app, deps);


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
      const body = req.body as { provider?: string; clearWorktree?: boolean; resetDependents?: boolean } | undefined;
      const task = await rerunTask(taskId, {
        provider: typeof body?.provider === "string" ? body.provider : undefined,
        clearWorktree: body?.clearWorktree === true,
        resetDependents: body?.resetDependents === true,
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

export function toErrorMessage(error: unknown, prefix: string): string {
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
