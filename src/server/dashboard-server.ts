import express, { type Express } from "express";
import * as fs from "fs";
import * as path from "path";
import type { Server } from "http";
import { createServer, request as httpRequest } from "http";
import type { IncomingMessage } from "http";
import net from "net";
import type { Duplex } from "stream";
import type { JiraIssueSearchInput, JiraIssueSearchResult } from "../services/jira-api-client.js";
import type {
  DashboardStatus,
  ExecutionAttentionItemSummary,
  ExecutionAssignedWorkerSummary,
  DockerContainer,
  ExecutionDashboardSnapshot,
  ExternalSettingsHints,
  GitTrackingStatus,
  JulesActivity,
  OnboardingRuntimeReadiness,
  OverviewTelemetrySnapshot,
  ProjectExecutionStatsSnapshot,
  ProjectLiveDashboardSnapshot,
  ProjectStatsQuery,
  ProjectStatsWindow,
  ReadinessProbeStatus,
  SprintPreviewScript,
  SprintPreviewSession,
  FileBrowserSession,
  FileBrowserTree,
  FileBrowserFileContent,
  FileBrowserChangeSet,
  FileBrowserDiff,
} from "../contracts/app-types.js";
import type { OnboardingStateRecord } from "../domain/user/onboarding-state.js";
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
import type { SchedulerService } from "../services/scheduler-service.js";
import type { SprintIssueService } from "../services/sprint-issue-service.js";
import type {
  InstructionFileContent,
  InstructionFileSummary,
} from "../contracts/instruction-file-types.js";
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
  ProjectSetupRequestInput,
  ProjectSetupResult,
  ProjectSetupStartResult,
  SprintCollectionResponse,
  ProjectSummary,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintRecord,
  TaskRecord,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
  SprintLinkedIssueInput,
  SprintLinkedIssueRecord,
} from "../contracts/project-management-types.js";
import { createLogger, type Logger } from "../shared/logging/logger.js";

import { registerDashboardRoutes } from "./dashboard-route-registration.js";
import { applyDashboardPreRouteMiddleware, applyDashboardPostRouteMiddleware } from "./dashboard-middleware.js";



import { bootDashboardRealtimeWebSocketServer } from "./dashboard-realtime-websocket-server.js";
import { bootDashboardTerminalWebSocketServer } from "./terminal-routes.js";
import type { DashboardRealtimeService } from "../services/dashboard-realtime-service.js";
import { asyncRoute, parseTrimmedString, requireTrimmedString, syncRoute, toErrorResponse } from "./route-utils.js";
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
  createProject: (input: CreateProjectInput) => ProjectSummary | Promise<ProjectSummary>;
  setupProject?: (projectId: string, input?: ProjectSetupRequestInput, signal?: AbortSignal) => Promise<ProjectSetupResult>;
  startProjectSetup?: (projectId: string, input?: ProjectSetupRequestInput) => Promise<ProjectSetupStartResult>;
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
  searchJiraIssues: (projectId: string, input: JiraIssueSearchInput) => Promise<JiraIssueSearchResult[]>;
  listSprintLinkedIssues: (sprintId: string) => SprintLinkedIssueRecord[];
  replaceSprintLinkedIssues: (sprintId: string, projectId: string, issues: SprintLinkedIssueInput[]) => SprintLinkedIssueRecord[];
  listConnections: (projectId: string) => McpConnectionRecord[];
  updateConnection: (connectionId: string, input: UpdateMcpConnectionInput) => McpConnectionRecord;
  listAgentPresets: (projectId: string) => Promise<AgentPresetRecord[]> | AgentPresetRecord[];
  createAgentPreset: (projectId: string, input: CreateAgentPresetInput) => Promise<AgentPresetRecord> | AgentPresetRecord;
  updateAgentPreset: (agentPresetId: string, input: UpdateAgentPresetInput) => Promise<AgentPresetRecord> | AgentPresetRecord;
  deleteAgentPreset: (agentPresetId: string) => Promise<void> | void;
  importAgentPresetFromMarkdown?: (agentPresetId: string) => Promise<AgentPresetRecord> | AgentPresetRecord;
  syncAllAgentPresetsFromMarkdown?: (projectId: string) => Promise<AgentPresetRecord[]> | AgentPresetRecord[];
  listInstructionFiles: (projectId: string) => Promise<InstructionFileSummary[]> | InstructionFileSummary[];
  readInstructionFile: (projectId: string, fileId: string) => Promise<InstructionFileContent> | InstructionFileContent;
  writeInstructionFile: (projectId: string, fileId: string, content: string) => Promise<InstructionFileContent> | InstructionFileContent;
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

  rerunTask: (taskId: string, options?: { provider?: string; providerConfigId?: string; model?: string; clearWorktree?: boolean; resetDependents?: boolean }) => Promise<unknown>;
  orchestrateSprint: (projectId: string, sprintId: string) => Promise<unknown>;

  improveSprintPrompt?: (projectId: string, input: ImprovePromptInput, signal?: AbortSignal) => Promise<unknown>;
  planSprint?: (projectId: string, sprintId: string, options: PlanSprintOptions, signal?: AbortSignal) => Promise<unknown>;
  quicksprintService?: QuicksprintService;
  schedulerService?: SchedulerService;
  sprintIssueService?: SprintIssueService;

  pauseSprintRun: (sprintRunId: string) => Promise<unknown> | unknown;
  resumeSprintRun?: (sprintRunId: string) => Promise<unknown> | unknown;
  cancelSprintRun: (sprintRunId: string) => Promise<unknown> | unknown;
  forceCancelSprintRun: (sprintRunId: string) => Promise<unknown> | unknown;
  cancelTaskDispatch: (dispatchId: string) => Promise<unknown> | unknown;
  forceCancelTaskDispatch: (dispatchId: string) => Promise<unknown> | unknown;
  forceCompleteTask: (projectId: string, taskId: string, reason: string) => Promise<void>;
  retryTaskDispatch: (dispatchId: string) => Promise<unknown>;
  realtimeService?: DashboardRealtimeService;
  logger?: Logger;
  isReady?: () => ReadinessProbeStatus;
  isHealthy?: () => ReadinessProbeStatus;
  listDockerContainers: () => Promise<DockerContainer[]>;
  getOnboardingRuntimeReadiness?: () => Promise<OnboardingRuntimeReadiness> | OnboardingRuntimeReadiness;
  getOnboardingState?: () => OnboardingStateRecord;
  markOnboardingCompleted?: () => OnboardingStateRecord;
  resetOnboardingState?: () => OnboardingStateRecord;
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
  listFileBrowserSessions?: (projectId: string) => Promise<FileBrowserSession[]> | FileBrowserSession[];
  startFileBrowserSession?: (projectId: string, sprintId: string) => Promise<FileBrowserSession> | FileBrowserSession;
  rebuildFileBrowserSession?: (sessionId: string) => Promise<FileBrowserSession> | FileBrowserSession;
  stopFileBrowserSession?: (sessionId: string) => Promise<FileBrowserSession> | FileBrowserSession;
  removeFileBrowserSession?: (sessionId: string) => Promise<void> | void;
  getFileBrowserTree?: (sessionId: string) => Promise<FileBrowserTree> | FileBrowserTree;
  readFileBrowserFile?: (sessionId: string, filePath: string) => Promise<FileBrowserFileContent> | FileBrowserFileContent;
  getFileBrowserChanges?: (sessionId: string) => Promise<FileBrowserChangeSet> | FileBrowserChangeSet;
  getFileBrowserDiff?: (sessionId: string, filePath: string) => Promise<FileBrowserDiff> | FileBrowserDiff;
}

export interface DashboardServerHandle {
  port: number;
  server: Server;
}

export const configureDashboardApp = (options: DashboardServerOptions): Logger => {
  const {
    app,
    dashboardDir,
    liveActivityCacheMs,
    logger,
    isReady,
  } = options;

  const dashboardLogger = logger ?? createLogger({ bindings: { component: "dashboard-server" } });

  applyDashboardPreRouteMiddleware(app, options, dashboardLogger);

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

  const deps: DashboardDependencies = options;
  registerDashboardRoutes(app, deps, liveActivityCacheMs);

  applyDashboardPostRouteMiddleware(app, dashboardDir);

  return dashboardLogger;
};

const listenDashboardServer = async (
  app: Express,
  host: string,
  port: number
): Promise<DashboardServerHandle> => {
  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = createServer(app);
    if (typeof (listeningServer as Partial<Server>).once === "function") {
      listeningServer.once("error", reject);
    } else {
      listeningServer.on("error", reject);
    }
    listeningServer.listen(port, host, () => resolve(listeningServer));
  });

  const address = typeof server.address === "function" ? server.address() : null;
  if (!address || typeof address === "string") {
    if (port === 0) {
      throw new Error("Dashboard server did not bind to a TCP port.");
    }
    return { port, server };
  }

  return { port: address.port, server };
};

const bindDashboardServer = async (
  app: Express,
  startPort: number,
  logger: Logger
): Promise<DashboardServerHandle> => {
  const host = (process.env.DASHBOARD_HOST || "127.0.0.1").trim() || "127.0.0.1";
  const roundedPort = Math.round(startPort);
  const initialPort = Number.isFinite(roundedPort)
    ? Math.max(0, Math.min(65535, roundedPort))
    : 1;

  if (initialPort === 0) {
    return await listenDashboardServer(app, host, 0);
  }

  let port = initialPort;

  while (port <= 65535) {
    try {
      return await listenDashboardServer(app, host, port);
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
    port,
    getSprintPreviewSession,
  } = options;
  const dashboardLogger = configureDashboardApp(options);
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

  bootDashboardTerminalWebSocketServer({
    server: handle.server,
    pathName: "/api/terminal/ws",
    logger: dashboardLogger.child({ component: "dashboard-terminal-websocket" }),
  });

  dashboardLogger.info("Dashboard server started", {
    port: handle.port,
    localhostUrl: `http://localhost:${handle.port}`,
    loopbackUrl: `http://127.0.0.1:${handle.port}`,
  });

  return handle;
};
