import express, { type Express } from "express";
import type { Server } from "http";
import { createServer } from "http";
import type { Socket } from "node:net";
import type {
  ExecutionAttentionItemSummary,
  ExecutionAssignedWorkerSummary,
  DockerContainer,
  ExecutionDashboardSnapshot,
  ExternalSettingsHints,
  GitTrackingStatus,
  JulesActivity,
  OnboardingDependencyInstallerResult,
  OnboardingDependencyInstallMode,
  OnboardingRuntimeReadiness,
  OverviewTelemetrySnapshot,
  PreviewEnvironmentVariable,
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
  HeaderTokenThroughputQuery,
  HeaderTokenThroughputSnapshot,
} from "../contracts/app-types.js";
import type { OnboardingStateRecord } from "../domain/user/onboarding-state.js";
import type { DashboardNotificationFeed } from "../contracts/dashboard-notification-types.js";
import type {
  EffectiveSettingsResponse,
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
import type { JiraProjectStatus } from "../services/jira-api-client.js";
import type {
  InstructionFileContent,
  InstructionFileSummary,
} from "../contracts/instruction-file-types.js";
import type {
  AgentPresetRecord,
  BaseAgentRole,
  BaseAgentUpdateNotice,
  CreateAgentPresetInput,
  PushAgentPresetsToMarkdownOptions,
  UpdateAgentPresetInput,
} from "../contracts/agent-preset-types.js";
import type { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import type { ChatProviderRepository } from "../repositories/chat-provider-repository.js";
import type {
  ExecutionInvocationRecord,
  ExecutionInvocationMessageRecord,
} from "../contracts/invocation-types.js";
import type { PlanningInvocationRestartMode } from "../services/planning-agent-service.js";
import type {
  ConversationMessageRecord,
  ConversationDraftRecord,
  ConversationMessageHistoryRecord,
  ConversationThreadRecord,
  CreateConversationThreadInput,
  CreateDashboardConversationMessageInput,
  RecordConversationMessageHistoryInput,
  UpsertConversationDraftInput,
  McpConnectionRecord,
  UpdateConversationThreadInput,
  UpdateConversationThreadRouteInput,
  UpdateMcpConnectionInput,
} from "../contracts/connection-chat-types.js";
import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateSprintRollbackInput,
  CreateSprintRollbackResult,
  CreateTaskInput,
  ImprovePromptInput,
  PlanSprintOptions,
  ProjectCollectionResponse,
  ProjectInitializationState,
  ProjectSetupRequestInput,
  ProjectSetupResult,
  ProjectSetupStartResult,
  SprintCollectionResponse,
  ProjectSummary,
  SprintMarkdownExportBundle,
  SprintMarkdownImportInput,
  SprintImportedTaskInput,
  SprintRecord,
  SprintRollbackAssessment,
  TaskRecord,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
  SprintLinkedIssueInput,
  SprintLinkedIssueRecord,
  JiraIssueSearchInput,
  JiraIssueSearchResult,
} from "../contracts/project-management-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { MemoryRepository } from "../repositories/memory-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import { createLogger, type Logger } from "../shared/logging/logger.js";

import { createDashboardRouteDependencies, registerDashboardRoutes } from "./dashboard-route-registration.js";
import { applyDashboardPreRouteMiddleware, applyDashboardPostRouteMiddleware } from "./dashboard-middleware.js";



import { bootDashboardRealtimeWebSocketServer } from "./dashboard-realtime-websocket-server.js";
import { bootDashboardTerminalWebSocketServer } from "./terminal-routes.js";
import type { DashboardRealtimeService } from "../services/dashboard-realtime-service.js";
import { managedRuntimeService } from "../services/managed-runtime-service.js";
import { getActiveProviderTypes, providerToolManager } from "../services/provider-tool-manager.js";
import { playwrightBrowserManager, type PlaywrightBrowserManager } from "../services/playwright-browser-manager.js";
import type { MemoryService } from "../services/memory-service.js";
import type { MemoryPromotionService } from "../services/memory-promotion-service.js";
import type { EmbeddingModelManager } from "../services/embedding-model-manager.js";
import type { EmbeddingService } from "../services/embedding-service.js";
import type { KnowledgeService } from "../services/knowledge-service.js";
import type { UpdateStatus } from "../services/update-checker-service.js";
import type { LocalMcpCliProvider, LocalMcpInstallResult, LocalMcpSetupInfo } from "../services/local-mcp-cli-config-service.js";
import { resolveDashboardBindHost } from "../config/app-config.js";
import type { ChatProviderIngressService } from "../services/chat-provider-ingress-service.js";
import type { SpeechTranscriptionService } from "../services/speech-transcription-service.js";
import type { SpeechSynthesisService } from "../services/speech-synthesis-service.js";
import type { SpeechModelManager } from "../services/speech-model-manager.js";
import type { NodeFlowService } from "../services/node-flow-service.js";
import type { CustomDashboardRepository } from "../repositories/custom-dashboard-repository.js";
import type { CustomDashboardValidationService } from "../services/custom-dashboard-validation-service.js";
import type { SkillService } from "../services/skill-service.js";
import type { CredentialBroker } from "../services/credentials/credential-broker.js";
import type { ApprovalService } from "../services/node-flows/approval-service.js";
import type { AutomationWebhookTriggerRepository } from "../repositories/automation-webhook-trigger-repository.js";
import type { HeadlessAuthService } from "../services/headless-auth-service.js";
import type { AutomationAuditExportService } from "../services/automation-audit-export-service.js";
import type { HeadlessOperationalReadinessService } from "../services/headless-operational-readiness-service.js";
import type { AutomationSloService } from "../services/automation-slo-service.js";
import type { ManagedRuntimeService } from "../services/managed-runtime-service.js";
import type { ProviderToolManager } from "../services/provider-tool-manager.js";
import {
  parsePreviewSessionIdFromHost,
  parseSelectedPreviewPortFromRequest,
  pipePreviewUpgradeRequest,
  resolvePreviewHostPort,
  stripPreviewPortSelectorFromPath,
} from "./preview-host-utils.js";

export type DashboardDependencies = Omit<
  DashboardServerOptions,
  | "app"
  | "dashboardDir"
  | "port"
  | "liveActivityCacheMs"
  | "getUpdateStatus"
  | "getDashboardNotifications"
> & {
  getUpdateStatus: () => Promise<UpdateStatus>;
  getLocalMcpSetup: () => LocalMcpSetupInfo;
  regenerateLocalMcpAuthToken: () => LocalMcpSetupInfo;
  installLocalMcpProvider: (provider: LocalMcpCliProvider) => Promise<LocalMcpInstallResult> | LocalMcpInstallResult;
  getDashboardNotifications: () => DashboardNotificationFeed;
};

export interface DashboardServerOptions {
  app: Express;
  dashboardDir: string;
  port: number;
  liveActivityCacheMs: number;
  memoryService?: MemoryService;
  memoryPromotionService?: MemoryPromotionService;
  embeddingModelManager?: EmbeddingModelManager;
  embeddingService?: EmbeddingService;
  memoryRepository?: MemoryRepository;
  settingsRepository?: SettingsRepository;
  knowledgeService?: KnowledgeService;
  agentPresetRepository?: AgentPresetRepository;
  chatProviderRepository?: ChatProviderRepository;
  chatProviderIngressService?: ChatProviderIngressService;
  speechTranscriptionService?: SpeechTranscriptionService;
  speechSynthesisService?: SpeechSynthesisService;
  speechModelManager?: SpeechModelManager;
  nodeFlowService?: NodeFlowService;
  approvalService?: ApprovalService;
  automationWebhookTriggerRepository?: AutomationWebhookTriggerRepository;
  customDashboardRepository?: CustomDashboardRepository;
  customDashboardValidationService?: CustomDashboardValidationService;
  skillService?: SkillService;
  credentialBroker?: CredentialBroker;
  headlessAuthService?: HeadlessAuthService;
  automationAuditService?: AutomationAuditExportService;
  headlessReadinessService?: HeadlessOperationalReadinessService;
  automationSloService?: AutomationSloService;
  managedRuntimeService?: ManagedRuntimeService;
  providerToolManager?: ProviderToolManager;
  playwrightBrowserManager?: PlaywrightBrowserManager;
  projectManagementRepository?: ProjectManagementRepository;
  executionRepository?: ExecutionRepository;
  getStatus: () => unknown;
  getLiveSnapshot: (projectId?: string | null) => Promise<ProjectLiveDashboardSnapshot> | ProjectLiveDashboardSnapshot;
  getExecutionSnapshot: () => ExecutionDashboardSnapshot;
  getProjectExecutionSnapshot: (projectId: string) => ExecutionDashboardSnapshot;
  getProjectStatsSnapshot: (projectId: string, query?: ProjectStatsQuery) => ProjectExecutionStatsSnapshot;
  getHeaderTokenThroughputSnapshot: (query?: HeaderTokenThroughputQuery) => HeaderTokenThroughputSnapshot;
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
  getDashboardNotifications?: () => DashboardNotificationFeed;
  getLiveActivities: () => Promise<Record<string, JulesActivity[]>>;
  getGitStatus: () => Promise<GitTrackingStatus>;
  getExternalSettingsHints: () => ExternalSettingsHints;
  getLocalMcpSetup?: () => LocalMcpSetupInfo;
  regenerateLocalMcpAuthToken?: () => LocalMcpSetupInfo;
  installLocalMcpProvider?: (provider: LocalMcpCliProvider) => Promise<LocalMcpInstallResult> | LocalMcpInstallResult;
  getSystemSettings: () => SystemSettings;
  getUpdateStatus?: () => Promise<UpdateStatus>;
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
  getProjectInitializationState?: (projectId: string) => Promise<ProjectInitializationState>;
  updateProject: (projectId: string, input: UpdateProjectInput) => ProjectSummary;
  deleteProject: (projectId: string) => void;
  selectProject: (projectId: string | null) => string | null;
  selectSprint: (projectId: string, sprintId: string | null) => string | null;
  listSprints: (projectId: string) => SprintCollectionResponse;
  getSprint: (sprintId: string) => SprintRecord | null;
  createSprint: (projectId: string, input: CreateSprintInput) => SprintRecord;
  updateSprint: (sprintId: string, input: UpdateSprintInput) => SprintRecord;
  deleteSprint: (sprintId: string) => void;
  assessSprintRollback: (projectId: string, sprintId: string) => Promise<SprintRollbackAssessment>;
  createSprintRollback: (projectId: string, sprintId: string, input: CreateSprintRollbackInput) => Promise<CreateSprintRollbackResult>;
  importSprintFromMarkdown: (projectId: string, input: SprintMarkdownImportInput) => SprintRecord;
  exportSprintToMarkdown: (projectId: string, sprintId: string) => SprintMarkdownExportBundle;
  listTasks: (projectId: string, sprintId?: string) => TaskRecord[];
  getTask: (taskId: string) => TaskRecord | null;
  createTask: (projectId: string, input: CreateTaskInput) => TaskRecord;
  createImportedTasks?: (projectId: string, sprintId: string, inputs: SprintImportedTaskInput[]) => TaskRecord[];
  updateTask: (taskId: string, input: UpdateTaskInput) => TaskRecord;
  deleteTask: (taskId: string) => void;
  searchJiraIssues: (projectId: string, input: JiraIssueSearchInput) => Promise<JiraIssueSearchResult[]>;
  searchJiraProjectStatuses: (projectId: string, projectKey?: string) => Promise<JiraProjectStatus[]>;
  listSprintLinkedIssues: (sprintId: string) => SprintLinkedIssueRecord[];
  replaceSprintLinkedIssues: (sprintId: string, projectId: string, issues: SprintLinkedIssueInput[]) => SprintLinkedIssueRecord[];
  listConnections: (projectId: string) => McpConnectionRecord[];
  updateConnection: (connectionId: string, input: UpdateMcpConnectionInput) => McpConnectionRecord;
  listAgentPresets: (projectId: string) => Promise<AgentPresetRecord[]> | AgentPresetRecord[];
  createAgentPreset: (projectId: string, input: CreateAgentPresetInput) => Promise<AgentPresetRecord> | AgentPresetRecord;
  updateAgentPreset: (agentPresetId: string, input: UpdateAgentPresetInput) => Promise<AgentPresetRecord> | AgentPresetRecord;
  deleteAgentPreset: (agentPresetId: string) => Promise<void> | void;
  listBaseAgentUpdateNotices?: (projectId: string) => Promise<BaseAgentUpdateNotice[]> | BaseAgentUpdateNotice[];
  applyBaseAgentUpdate?: (projectId: string, role: BaseAgentRole) => Promise<AgentPresetRecord> | AgentPresetRecord;
  importAgentPresetFromMarkdown?: (agentPresetId: string) => Promise<AgentPresetRecord> | AgentPresetRecord;
  syncAllAgentPresetsFromMarkdown?: (projectId: string) => Promise<AgentPresetRecord[]> | AgentPresetRecord[];
  pullAgentPresetsFromMarkdown?: (projectId: string) => Promise<AgentPresetRecord[]> | AgentPresetRecord[];
  pushAgentPresetsToMarkdown?: (projectId: string, options?: PushAgentPresetsToMarkdownOptions) => Promise<AgentPresetRecord[]> | AgentPresetRecord[];
  exportAgentPresetToMarkdown?: (agentPresetId: string) => Promise<AgentPresetRecord> | AgentPresetRecord;
  pushAgentPresetsToRepository?: (projectId: string, options: {
    mode: "commit_only" | "commit_and_push" | "pull_request";
    branchName?: string;
  }) => Promise<{
    committed: boolean;
    pushedBranch?: string;
    pullRequestUrl?: string;
  }>;
  listInstructionFiles: (projectId: string) => Promise<InstructionFileSummary[]> | InstructionFileSummary[];
  readInstructionFile: (projectId: string, fileId: string) => Promise<InstructionFileContent> | InstructionFileContent;
  writeInstructionFile: (projectId: string, fileId: string, content: string) => Promise<InstructionFileContent> | InstructionFileContent;
  listConversationThreads: (projectId: string) => ConversationThreadRecord[];
  createConversationThread: (projectId: string, input: CreateConversationThreadInput) => ConversationThreadRecord;
  updateConversationThread: (threadId: string, input: UpdateConversationThreadInput) => Promise<ConversationThreadRecord> | ConversationThreadRecord;
  updateThreadRoute: (threadId: string, input: UpdateConversationThreadRouteInput) => ConversationThreadRecord;
  compactThreadSession: (threadId: string) => Promise<ConversationThreadRecord> | ConversationThreadRecord;
  cancelThreadTurn?: (threadId: string) => Promise<{ cancelled: boolean }> | { cancelled: boolean };
  deleteConversationThread: (threadId: string) => void;
  listConversationMessages: (threadId: string) => ConversationMessageRecord[];
  postConversationMessage: (projectId: string, input: CreateDashboardConversationMessageInput) => Promise<ConversationMessageRecord> | ConversationMessageRecord;
  getConversationDraft?: (projectId: string, input: { userId: string; contextKey: string }) => ConversationDraftRecord | null;
  upsertConversationDraft?: (projectId: string, input: UpsertConversationDraftInput) => ConversationDraftRecord | null;
  listConversationMessageHistory?: (projectId: string, input: { userId: string; limit?: number }) => ConversationMessageHistoryRecord[];
  recordConversationMessageHistory?: (projectId: string, input: RecordConversationMessageHistoryInput) => ConversationMessageHistoryRecord;

  listProjectInvocations: (projectId: string) => ExecutionInvocationRecord[];
  listInvocationMessages: (invocationId: string) => ExecutionInvocationMessageRecord[];
  restartExecutionInvocation?: (invocationId: string, mode?: PlanningInvocationRestartMode) => Promise<unknown> | unknown;
  cancelExecutionInvocation?: (invocationId: string) => Promise<unknown> | unknown;
  resetInvocationUsageLimitTimer?: (invocationId: string) => Promise<unknown> | unknown;

  rerunTask: (taskId: string, options?: { provider?: string; providerConfigId?: string; model?: string; clearWorktree?: boolean; resetDependents?: boolean; undoMerge?: boolean }) => Promise<unknown>;
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
  installOnboardingDependencies?: (mode: OnboardingDependencyInstallMode) => Promise<OnboardingDependencyInstallerResult> | OnboardingDependencyInstallerResult;
  getOnboardingState?: () => OnboardingStateRecord;
  markOnboardingCompleted?: () => OnboardingStateRecord;
  resetOnboardingState?: () => OnboardingStateRecord;
  listSprintPreviewSessions?: (projectId: string) => Promise<SprintPreviewSession[]> | SprintPreviewSession[];
  getSprintPreviewSession?: (sessionId: string) => Promise<SprintPreviewSession | null> | SprintPreviewSession | null;
  getSprintPreviewSessionForProjectSprint?: (projectId: string, sprintId: string, sessionId: string) => Promise<SprintPreviewSession> | SprintPreviewSession;
  startSprintPreviewSession?: (projectId: string, sprintId: string) => Promise<SprintPreviewSession> | SprintPreviewSession;
  rebuildSprintPreviewSession?: (sessionId: string) => Promise<SprintPreviewSession> | SprintPreviewSession;
  rebuildSprintPreviewSessionForProjectSprint?: (projectId: string, sprintId: string, sessionId: string) => Promise<SprintPreviewSession> | SprintPreviewSession;
  stopSprintPreviewSession?: (sessionId: string) => Promise<SprintPreviewSession> | SprintPreviewSession;
  stopSprintPreviewSessionForProjectSprint?: (projectId: string, sprintId: string, sessionId: string) => Promise<SprintPreviewSession> | SprintPreviewSession;
  removeSprintPreviewSession?: (sessionId: string) => Promise<void> | void;
  removeSprintPreviewSessionForProjectSprint?: (projectId: string, sprintId: string, sessionId: string) => Promise<void> | void;
  getSprintPreviewScript?: (projectId: string, sprintId: string) => Promise<SprintPreviewScript> | SprintPreviewScript;
  saveSprintPreviewScript?: (projectId: string, sprintId: string, content: string) => Promise<SprintPreviewScript> | SprintPreviewScript;
  getSprintPreviewLogs?: (sessionId: string, tail?: number) => Promise<{ logs: string }> | { logs: string };
  getSprintPreviewLogsForProjectSprint?: (projectId: string, sprintId: string, sessionId: string, tail?: number) => Promise<{ logs: string }> | { logs: string };
  updateSprintPreviewEnvironmentOverrides?: (projectId: string, sprintId: string, sessionId: string, environmentOverrides: PreviewEnvironmentVariable[]) => Promise<SprintPreviewSession> | SprintPreviewSession;
  updateSprintPreviewStartupCommandOverride?: (projectId: string, sprintId: string, sessionId: string, startupCommandOverride: string | null) => Promise<SprintPreviewSession> | SprintPreviewSession;
  updateSprintPreviewDockerAccessOverride?: (projectId: string, sprintId: string, sessionId: string, dockerAccessOverride: boolean | null) => Promise<SprintPreviewSession> | SprintPreviewSession;
  proxySprintPreviewRequest?: (args: {
    sessionId: string;
    method: string;
    path: string;
    headers?: Record<string, string | undefined>;
    body?: Buffer;
    selectedPort?: string | number | null;
  }) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;
  proxySprintPreviewRequestForProjectSprint?: (projectId: string, sprintId: string, args: {
    sessionId: string;
    method: string;
    path: string;
    headers?: Record<string, string | undefined>;
    body?: Buffer;
    selectedPort?: string | number | null;
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
  close?: () => Promise<void>;
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

  app.get("/ready", async (req, res) => {
    const ready = isReady ? isReady() : { status: "READY" as const };
    const operational = options.headlessReadinessService
      ? await options.headlessReadinessService.refresh()
      : null;
    const response = operational
      ? { ...operational, runtime: ready }
      : ready;
    const isRuntimeReady = ready.status === "READY" || ready.status === "UP";
    const isOperationallyReady = operational === null || operational.status === "READY";
    if (isRuntimeReady && isOperationallyReady) {
      res.json(response);
    } else {
      res.status(503).json(response);
    }
  });

  registerDashboardRoutes({
    app,
    deps: createDashboardRouteDependencies(options),
    liveActivityCacheMs,
  });

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
  const sockets = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
  const close = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error && error.message !== "Server is not running.") {
          reject(error);
          return;
        }
        resolve();
      });
      server.closeIdleConnections?.();
      for (const socket of sockets) {
        socket.destroy();
      }
      server.closeAllConnections?.();
    });
  };

  const address = typeof server.address === "function" ? server.address() : null;
  if (!address || typeof address === "string") {
    if (port === 0) {
      throw new Error("Dashboard server did not bind to a TCP port.");
    }
    return { port, server, close };
  }

  return { port: address.port, server, close };
};

const bindDashboardServer = async (
  app: Express,
  startPort: number,
  logger: Logger
): Promise<DashboardServerHandle> => {
  const host = resolveDashboardBindHost();
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
  await options.headlessReadinessService?.assertStartupReady();
  const dashboardLogger = configureDashboardApp(options);
  if (process.env.NODE_ENV !== "test") {
    const runtime = options.managedRuntimeService ?? managedRuntimeService;
    const tools = options.providerToolManager ?? providerToolManager;
    const browser = options.playwrightBrowserManager ?? playwrightBrowserManager;
    const settings = options.getSystemSettings();
    const runtimeLogger = dashboardLogger.child({ component: "managed-runtime-prewarm" });
    void (async () => {
      let browserPreload: Promise<unknown> = Promise.resolve();
      if (settings.defaults.cliWorkflow.containerImageMode !== "custom") {
        await runtime.checkForUpdates(runtimeLogger);
        if (settings.defaults.cliWorkflow.containerInstallPlaywrightBrowsers !== false) {
          browserPreload = browser.prepare(settings.defaults.cliWorkflow, { logger: runtimeLogger }).catch((error: unknown) => {
            runtimeLogger.warn("Playwright browser preload failed; provider CLI preparation will continue.", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }
      await Promise.all([
        browserPreload,
        tools.checkActiveProviders(
          getActiveProviderTypes(settings),
          settings.defaults.cliWorkflow,
          runtimeLogger,
        ),
      ]);
    })().catch((error: unknown) => {
      runtimeLogger.warn("Managed runtime startup preparation failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  const handle = await bindDashboardServer(app, port, dashboardLogger);

  handle.server.on("upgrade", (req, socket, head) => {
    const sessionId = parsePreviewSessionIdFromHost(req.headers.host);
    if (!sessionId || !getSprintPreviewSession) {
      return;
    }
    void (async () => {
      try {
        const session = await getSprintPreviewSession(sessionId);
        if (!session) {
          socket.destroy();
          return;
        }
        const upstreamPort = resolvePreviewHostPort(
          session,
          parseSelectedPreviewPortFromRequest(req.url || "/", req.headers["x-code-ux-preview-port"]),
        );
        if (!upstreamPort) {
          socket.destroy();
          return;
        }
        await pipePreviewUpgradeRequest({
          req,
          socket,
          head,
          upstreamPort,
          targetPath: stripPreviewPortSelectorFromPath(req.url || "/"),
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
