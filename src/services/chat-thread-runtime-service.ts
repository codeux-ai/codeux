import type { DashboardSettings, DashboardSettingsScope, ProviderConfigMode, ProviderId, QwenModelProviderSettings, Subtask, ThinkingMode } from "../contracts/app-types.js";
import * as fs from "fs/promises";
import * as path from "path";
import type { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import type { ProjectWorkerAssignmentRepository } from "../repositories/project-worker-assignment-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { TaskService } from "./task-service.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import type { Logger } from "../shared/logging/logger.js";
import type {
  ConversationCompactionSummary,
  CreateDashboardConversationMessageInput,
  ConversationThreadRecord,
  ConversationMessageRecord,
  ConversationRuntimeState,
  PromptSuggestionsMetadata,
  AgentResponseEffectMetadata,
  DashboardAppProgressPlanningStage,
  DashboardAppProgressWidgetMetadata,
  DashboardCreateAppQuickactionKind,
  DashboardCreateAppQuickactionPlanningStatus,
  DashboardCreateAppQuickactionRuntimeState,
  DashboardCreateAppQuickactionStackSummary,
  DashboardCreateAppQueuedFollowUp,
  UpdateConversationThreadInput,
  UpdateConversationThreadRouteInput,
} from "../contracts/connection-chat-types.js";
import type { PlanningDesignGuidanceSelection, ProjectInitializationState } from "../contracts/project-management-types.js";
import {
  DASHBOARD_APP_PROGRESS_WIDGET_TYPE,
  DASHBOARD_CREATE_APP_QUICKACTION_KINDS,
} from "../contracts/connection-chat-types.js";
import type {
  DetachedQuicksprintLaunchInput,
  DetachedQuicksprintLaunchResult,
} from "../contracts/quicksprint-types.js";
import { buildProviderPrompt } from "./cli-workflow-utils.js";
import { resolveEffectiveModel, type ProviderExecutionService } from "./provider-execution-service.js";
import { getRepoCodeUxDir, getRepoCodeUxPath } from "../shared/config/code-ux-paths.js";
import {
  buildChatContinuationPrompt,
  buildChatReplayPrompt,
  normalizeProviderReply,
} from "./chat-reply-prompt.js";
import type { ChatManagementActionService } from "./chat-management-action-service.js";
import type { KnowledgeService } from "./knowledge-service.js";
import type { ChatProviderOutboundService } from "./chat-provider-outbound-service.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { McpApprovalTracker } from "./mcp-approval-tracker.js";
import { getCorrelationId } from "../shared/logging/correlation-id.js";
import type { AgentMcpAccessConfig } from "../contracts/agent-preset-types.js";
import { dashboardReplyAgentMcpAccess, isSchedulerOnlyAgentMcpAccess } from "./agent-mcp-access.js";
import { buildProviderInvocationWorkspaceOptions } from "../infrastructure/providers/cli/invocation-workspace-preparer.js";
import { getCreateAppQuickactionSpec } from "../domain/chat/create-app-quickaction-catalog.js";
import { ProjectInitializationStateService } from "./project-initialization-state-service.js";

interface ChatThreadRuntimeServiceDependencies {
  connectionChatRepository: ConnectionChatRepository;
  projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  executionRepository: ExecutionRepository;
  taskService: TaskService;
  getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings;
  getGithubToken: () => string | undefined;
  agentPresetSyncService: AgentPresetSyncService;
  projectManagementRepository: ProjectManagementRepository;
  providerRunner: IProviderRunner;
  providerExecutionService: ProviderExecutionService;
  chatManagementActionService: ChatManagementActionService;
  chatProviderOutboundService?: ChatProviderOutboundService;
  knowledgeService: KnowledgeService;
  getMcpConnectionInfo?: () => McpConnectionInfo | null;
  getMcpApprovalTracker?: () => McpApprovalTracker;
  runDueSchedulerEntriesAfterReply?: () => Promise<void>;
  getProjectInitializationState?: (projectId: string) => Promise<ProjectInitializationState>;
  logger?: Logger;
}

interface ChatCreateAppQuicksprintLauncher {
  launchDetachedQuicksprint(projectId: string, input: DetachedQuicksprintLaunchInput): Promise<DetachedQuicksprintLaunchResult>;
}

interface NormalizedCreateAppQuickaction {
  kind: DashboardCreateAppQuickactionKind;
  requestId: string;
  templateId: string;
  designGuidance: PlanningDesignGuidanceSelection;
  taskCount: number;
  stackSummary: DashboardCreateAppQuickactionStackSummary | null;
  suggestionTags: string[];
}

export interface ThreadRouteResolution {
  mode: "VIRTUAL";
  providerId?: Exclude<ProviderId, "jules">;
  model?: string;
  apiKey?: string;
  qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
  qwenRegion?: "china" | "international";
  qwenBaseUrl?: string;
  qwenEnvKey?: string;
  qwenModelId?: string;
  qwenProtocol?: "openai" | "anthropic" | "gemini";
  qwenAdditionalModelProviders?: QwenModelProviderSettings[];
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
  providerMountAuth?: boolean;
  providerAuthPath?: string;
  providerConfigMode?: ProviderConfigMode;
  providerConfigPath?: string;
  customBaseUrl?: string;
  customModel?: string;
  thinkingMode?: ThinkingMode;
}

interface InFlightChatTurn {
  abortController: AbortController;
  latestMessage: ConversationMessageRecord;
  messageIds: string[];
}

export interface PostChatMessageRuntimeOptions {
  signal?: AbortSignal;
}

type ChatTurnAbortKind = "cancellation" | "supersession";

class ChatTurnAbortError extends Error {
  constructor(public readonly kind: ChatTurnAbortKind, message: string) {
    super(message);
    this.name = "ChatTurnAbortError";
  }
}

const resolveEffectiveDefaultBranch = (
  project: { defaultBranch?: string | null },
  settings: DashboardSettings,
): string => (
  project.defaultBranch?.trim()
  || settings.git?.defaultBranch?.trim()
  || "main"
);

const resolveEffectiveGithubMode = (
  project: { sourceType?: string | null },
  settings: DashboardSettings,
): "REMOTE" | "LOCAL" => (
  settings.git?.githubMode
  || (project.sourceType === "local" ? "LOCAL" : "REMOTE")
);

const resolveLogicalCompactionContinuationId = (
  provider: Exclude<ProviderId, "jules">,
  threadId: string,
): string | null => {
  if (provider === "codex" || provider === "gemini" || provider === "qwen-code" || provider === "opencode") {
    return threadId;
  }
  return null;
};

function getThreadSessionTitlePath(repoPath: string, threadId: string): string {
  const safeThreadId = threadId.replace(/[^A-Za-z0-9_.-]/g, "-");
  const codeUxDir = path.resolve(getRepoCodeUxDir(repoPath));
  const titlePath = path.resolve(getRepoCodeUxPath(repoPath, "conversations", safeThreadId, "session-title.md"));
  const relativeTitlePath = path.relative(codeUxDir, titlePath);

  if (relativeTitlePath.startsWith("..") || path.isAbsolute(relativeTitlePath)) {
    throw new Error("Refusing to write session title outside the project .code-ux directory.");
  }

  return titlePath;
}

function isChatProviderSourcedMessage(message: Pick<ConversationMessageRecord, "metadata"> | null | undefined): boolean {
  return message?.metadata?.source === "chat_provider" || message?.metadata?.suppressRichWidgets === true;
}

function isAgentSchedulerMessage(message: Pick<ConversationMessageRecord, "metadata"> | null | undefined): boolean {
  return message?.metadata?.source === "agent_scheduler" || message?.metadata?.origin === "agent_scheduler";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? normalized : null;
}

function normalizeCreateAppQuickactionKind(value: unknown): DashboardCreateAppQuickactionKind | null {
  const normalized = readString(value);
  const aliases: Record<string, DashboardCreateAppQuickactionKind> = {
    web: "web_app",
    desktop: "desktop_app",
    shop: "online_shop",
    online_store: "online_shop",
  };
  if (normalized && DASHBOARD_CREATE_APP_QUICKACTION_KINDS.includes(normalized as DashboardCreateAppQuickactionKind)) {
    return normalized as DashboardCreateAppQuickactionKind;
  }
  return normalized ? aliases[normalized] ?? null : null;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

type DashboardCreateAppStackStringField = Exclude<keyof DashboardCreateAppQuickactionStackSummary, "applicationKind">;

function readOptionalStackField(raw: Record<string, unknown>, key: DashboardCreateAppStackStringField): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) {
    return undefined;
  }
  return readString(raw[key]) ?? null;
}

function readCreateAppStackSummary(value: unknown, kind: DashboardCreateAppQuickactionKind): DashboardCreateAppQuickactionStackSummary | null {
  const raw = readRecord(value);
  if (!raw) {
    return null;
  }

  const stackSummary: DashboardCreateAppQuickactionStackSummary = {
    applicationKind: normalizeCreateAppQuickactionKind(raw.applicationKind) ?? kind,
  };
  const fields: DashboardCreateAppStackStringField[] = [
    "techstackId",
    "techstackName",
    "language",
    "framework",
    "runtime",
    "packageManager",
    "styling",
    "testFramework",
  ];
  for (const field of fields) {
    const valueForField = readOptionalStackField(raw, field);
    if (valueForField !== undefined) {
      stackSummary[field] = valueForField;
    }
  }
  return stackSummary;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function readCreateAppDesignGuidance(
  value: unknown,
  expected: PlanningDesignGuidanceSelection,
): PlanningDesignGuidanceSelection {
  if (value === undefined) {
    return { ...expected };
  }
  const selection = readRecord(value);
  const selectedTechStackId = readString(selection?.selectedTechStackId);
  const selectedStyleguideId = readString(selection?.selectedStyleguideId);
  if (
    !selectedTechStackId
    || !selectedStyleguideId
    || selectedTechStackId !== expected.selectedTechStackId
    || selectedStyleguideId !== expected.selectedStyleguideId
  ) {
    throw new Error("Create app quickaction design guidance does not match its catalog entry.");
  }
  return { selectedTechStackId, selectedStyleguideId };
}

function parseCreateAppQuickactionMetadata(metadata: Record<string, unknown> | null | undefined): NormalizedCreateAppQuickaction | null {
  const root = readRecord(metadata);
  if (!root) {
    return null;
  }
  const quickaction = readRecord(root.quickaction) ?? readRecord(root.quickaction_metadata);
  if (!quickaction) {
    return null;
  }
  const type = readString(quickaction.type);
  if (type !== "create_app") {
    return null;
  }

  const kind = normalizeCreateAppQuickactionKind(quickaction.kind ?? root.quickactionKind ?? root.appKind);
  if (!kind) {
    throw new Error("Create app quickaction metadata is missing a supported app kind.");
  }
  const requestId = readString(quickaction.requestId ?? root.quickactionRequestId);
  if (!requestId) {
    throw new Error("Create app quickaction metadata is missing requestId.");
  }
  const suppliedTemplateId = readString(quickaction.templateId ?? root.templateId);
  if (!suppliedTemplateId) {
    throw new Error("Create app quickaction metadata is missing templateId.");
  }
  const spec = getCreateAppQuickactionSpec(kind);
  if (suppliedTemplateId !== spec.templateId) {
    throw new Error(`Create app quickaction template does not match ${kind}.`);
  }

  return {
    kind,
    requestId,
    templateId: spec.templateId,
    designGuidance: readCreateAppDesignGuidance(
      quickaction.designGuidance ?? quickaction.guidanceSelection ?? root.designGuidance ?? root.guidanceSelection,
      spec.designGuidance,
    ),
    taskCount: readPositiveInteger(quickaction.taskCount ?? root.taskCount, 5),
    stackSummary: readCreateAppStackSummary(quickaction.stackSummary ?? root.stackSummary, kind),
    suggestionTags: readStringList(quickaction.suggestionTags ?? root.suggestionTags),
  };
}

function hasAnyQuickactionMetadata(metadata: Record<string, unknown> | null | undefined): boolean {
  const root = readRecord(metadata);
  return Boolean(root && (readRecord(root.quickaction) || readRecord(root.quickaction_metadata)));
}

function isChatProviderSourcedThread(
  _thread: ConversationThreadRecord,
  _messages: ConversationMessageRecord[],
  latestMessage: ConversationMessageRecord,
): boolean {
  return latestMessage.metadata?.source === "chat_provider"
    && latestMessage.metadata?.suppressRichWidgets === true;
}

function getExternalAgentPresetId(metadata: Record<string, unknown> | null | undefined): string | null {
  if (metadata?.source !== "chat_provider") return null;
  return readString(metadata.agentPresetId);
}

async function writeThreadSessionTitleFile(repoPath: string, threadId: string, title: string): Promise<void> {
  if (!title.trim()) {
    throw new Error("Thread title must be a non-empty string.");
  }
  const titlePath = getThreadSessionTitlePath(repoPath, threadId);
  await fs.mkdir(path.dirname(titlePath), { recursive: true });
  await fs.writeFile(titlePath, `${title.trim()}\n`, { encoding: "utf8" });
}

export class ChatThreadRuntimeService {
  private readonly inFlightTurns = new Map<string, InFlightChatTurn>();
  private readonly projectInitializationStateService: ProjectInitializationStateService;
  private quicksprintLauncher: ChatCreateAppQuicksprintLauncher | null = null;

  constructor(private readonly deps: ChatThreadRuntimeServiceDependencies) {
    this.projectInitializationStateService = new ProjectInitializationStateService(
      (projectId) => this.deps.projectManagementRepository.getProject(projectId),
    );
  }

  public setQuicksprintLauncher(launcher: ChatCreateAppQuicksprintLauncher): void {
    this.quicksprintLauncher = launcher;
  }

  public async resolveThreadRoute(
    thread: Pick<ConversationThreadRecord, "connectionId" | "projectId" | "runtimeState">,
    liveAssignments: ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>,
    settings: DashboardSettings,
    latestMessageBody: string,
    latestMessageMetadata?: Record<string, unknown> | null,
  ): Promise<ThreadRouteResolution> {
    const runtimeState = thread.runtimeState || null;
    void liveAssignments;

    const pseudoTask: Subtask = {
      id: "dashboard-reply",
      title: "Dashboard reply",
      prompt: latestMessageBody,
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };

    const selectedAgentPresetId = getExternalAgentPresetId(latestMessageMetadata)
      ?? settings.agents?.routing?.dashboardReply?.agentPresetId
      ?? null;
    const dashboardReplyAgent = typeof this.deps.agentPresetSyncService.resolveDashboardReplyAgent === "function"
      ? await this.deps.agentPresetSyncService.resolveDashboardReplyAgent(
        thread.projectId,
        selectedAgentPresetId,
      ).catch((err) => {
        this.deps.logger?.warn("Failed to resolve dashboard reply agent template", { projectId: thread.projectId, error: err instanceof Error ? err.message : String(err) });
        return null;
      })
      : await this.deps.agentPresetSyncService.getWorkerAgent(thread.projectId).catch((err) => {
        this.deps.logger?.warn("Failed to resolve fallback worker agent template", { projectId: thread.projectId, error: err instanceof Error ? err.message : String(err) });
        return null;
      });
    const route = this.deps.taskService.resolveInvocationProvider("dashboard_reply", pseudoTask, {
      scope: { projectId: thread.projectId },
      cliOnly: true,
      agentProvider: dashboardReplyAgent
        ? {
          providerConfigId: dashboardReplyAgent.providerConfigId,
          model: dashboardReplyAgent.model,
        }
        : null,
    });

    const providerId = route.provider as Exclude<ProviderId, "jules"> | undefined;
    if (!providerId) {
      throw new Error("Dashboard replies require an enabled CLI provider, but no eligible provider was resolved.");
    }
    const providerConfigId = route.providerConfigId || providerId;
    const providerSettings = route.providers[providerConfigId];
    if (!providerSettings) {
      throw new Error(`Dashboard reply routing resolved provider ${providerConfigId}, but no provider settings were available.`);
    }

    return {
      mode: "VIRTUAL",
      providerId,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      qwenAuthMode: providerSettings.qwenAuthMode,
      qwenRegion: providerSettings.qwenRegion,
      qwenBaseUrl: providerSettings.qwenBaseUrl,
      qwenEnvKey: providerSettings.qwenEnvKey,
      qwenModelId: providerSettings.qwenModelId,
      qwenProtocol: providerSettings.qwenProtocol,
      qwenAdditionalModelProviders: providerSettings.qwenAdditionalModelProviders,
        openCodeAuthMode: providerSettings.openCodeAuthMode,
        openCodeProviderId: providerSettings.openCodeProviderId,
        openCodeModelId: providerSettings.openCodeModelId,
        openCodeBaseUrl: providerSettings.openCodeBaseUrl,
        openCodeEnvKey: providerSettings.openCodeEnvKey,
        openCodePackage: providerSettings.openCodePackage,
      providerMountAuth: providerSettings.mountAuth,
      providerAuthPath: providerSettings.authPath,
      providerConfigMode: providerSettings.providerConfigMode,
      providerConfigPath: providerSettings.providerConfigPath,
      customBaseUrl: providerSettings.customBaseUrl,
      customModel: providerSettings.customModel,
      thinkingMode: providerSettings.thinkingMode,
    };
  }

  public updateThreadRoute(threadId: string, input: UpdateConversationThreadRouteInput): ConversationThreadRecord {
    const thread = this.deps.connectionChatRepository.getThread(threadId);
    let connectionId: string | null = null;

    if (input.routeKind === "worker") {
      throw new Error("Connected MCP worker routes are no longer supported.");
    } else if (input.routeKind === "virtual") {
      if (!input.virtualProvider) {
        throw new Error("virtualProvider is required for virtual route.");
      }
      const validProviders = ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"];
      if (!validProviders.includes(input.virtualProvider)) {
        throw new Error(`Virtual provider is not configured or unavailable: ${input.virtualProvider}`);
      }
    } else {
      throw new Error(`Invalid route kind: ${input.routeKind}`);
    }

    const newRuntimeState: ConversationRuntimeState = {
      ...thread.runtimeState,
      routeKind: input.routeKind,
      virtualProvider: input.virtualProvider,
      modelLabel: input.virtualModel,
      workerEndpointId: undefined,
      replayRequired: true,
    };

    return this.deps.connectionChatRepository.updateThread(thread.id, {
      connectionId,
      runtimeState: newRuntimeState,
    });
  }

  public async updateConversationThread(threadId: string, input: UpdateConversationThreadInput): Promise<ConversationThreadRecord> {
    const updatedThread = this.deps.connectionChatRepository.updateThread(threadId, input);
    if (input.title !== undefined) {
      const project = this.deps.projectManagementRepository.getProject(updatedThread.projectId);
      if (!project) {
        throw new Error(`Project not found: ${updatedThread.projectId}`);
      }
      await writeThreadSessionTitleFile(project.baseDir, updatedThread.id, updatedThread.title);
    }
    return updatedThread;
  }

  public async compactThreadSession(threadId: string): Promise<ConversationThreadRecord> {
    const thread = this.deps.connectionChatRepository.getThread(threadId);
    const project = this.deps.projectManagementRepository.getProject(thread.projectId);
    if (!project) {
      throw new Error(`Project not found: ${thread.projectId}`);
    }
    const messages = this.deps.connectionChatRepository.listMessages(thread.id);
    const activeSessionId = thread.runtimeState?.sessionIds?.[0]?.trim() || null;
    if (messages.length === 0) {
      return this.deps.connectionChatRepository.updateThread(thread.id, {
        runtimeState: {
          ...thread.runtimeState,
          replayRequired: true,
          sessionIds: [],
        },
      });
    }

    const assignments = this.deps.projectWorkerAssignmentRepository.listAssignmentsForProject(thread.projectId, { activeOnly: true });
    const settings = this.deps.getDashboardSettings({ projectId: thread.projectId });
    const route = await this.resolveThreadRoute(thread, assignments, settings, messages[messages.length - 1]?.bodyMarkdown || thread.title);
    if (!route.providerId || !route.model || typeof route.apiKey !== "string") {
      throw new Error("Failed to resolve a chat worker for thread compaction.");
    }
    const continueSessionId = activeSessionId || resolveLogicalCompactionContinuationId(route.providerId, thread.id);
    if (!continueSessionId) {
      throw new Error(`Native chat compaction for ${route.providerId} requires an active provider session. Send a message in this thread before compacting it.`);
    }

    const compacted = await this.generateThreadCompaction(
      project.id,
      project.baseDir,
      thread,
      messages,
      route,
      continueSessionId,
    );
    const compactedSessionId = compacted.nativeSessionId || compacted.summary.nativeSessionId || compacted.continueSessionId || null;

    const newRuntimeState: ConversationRuntimeState = {
      ...thread.runtimeState,
      routeKind: "virtual",
      virtualProvider: route.providerId,
      modelLabel: compacted.summary.model,
      replayRequired: compactedSessionId ? false : true,
      sessionIds: compactedSessionId ? [compactedSessionId] : [],
      compactionSummary: compacted.summary,
    };

    return this.deps.connectionChatRepository.updateThread(thread.id, {
      runtimeState: newRuntimeState,
    });
  }

  public cancelInFlightTurn(threadId: string): { cancelled: boolean } {
    const existingTurn = this.inFlightTurns.get(threadId);
    if (!existingTurn) {
      return { cancelled: false };
    }

    existingTurn.abortController.abort(new ChatTurnAbortError("cancellation", "Cancelled from the dashboard"));
    return { cancelled: true };
  }

  public isThreadBusy(threadId: string): boolean {
    return this.inFlightTurns.has(threadId);
  }

  async postMessage(
    projectId: string,
    input: CreateDashboardConversationMessageInput,
    options: PostChatMessageRuntimeOptions = {},
  ): Promise<ConversationMessageRecord> {
    const userMessage = this.deps.connectionChatRepository.postDashboardMessage(projectId, input);
    const thread = this.deps.connectionChatRepository.getThread(userMessage.threadId);
    if (!thread) throw new Error("Thread not found");
    if (!input.threadId && typeof thread.title === "string" && thread.title.trim()) {
      const project = this.deps.projectManagementRepository.getProject(projectId);
      if (project) {
        await writeThreadSessionTitleFile(project.baseDir, thread.id, thread.title);
      }
    }

    let createAppQuickaction: NormalizedCreateAppQuickaction | null = null;
    try {
      createAppQuickaction = parseCreateAppQuickactionMetadata(userMessage.metadata);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger?.error("Dashboard create-app quickaction metadata was invalid", {
        projectId,
        threadId: thread.id,
        messageId: userMessage.id,
        error: message,
      });
      this.deps.connectionChatRepository.markDashboardMessagesFailed(thread.id, {
        upToMessageId: userMessage.id,
      });
      this.deps.connectionChatRepository.postSystemMessage(projectId, {
        threadId: thread.id,
        bodyMarkdown: `Create-app quickaction failed: ${message}`,
      });
      return {
        ...userMessage,
        deliveryStatus: "failed",
      };
    }
    if (createAppQuickaction) {
      try {
        await this.handleCreateAppQuickaction(projectId, thread, userMessage, createAppQuickaction);
        return userMessage;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.deps.logger?.error("Dashboard create-app quickaction failed", {
          projectId,
          threadId: thread.id,
          messageId: userMessage.id,
          quickactionRequestId: createAppQuickaction.requestId,
          error: message,
        });
        this.deps.connectionChatRepository.markDashboardMessagesFailed(thread.id, {
          upToMessageId: userMessage.id,
        });
        this.deps.connectionChatRepository.postSystemMessage(projectId, {
          threadId: thread.id,
          bodyMarkdown: `Create-app quickaction failed: ${message}`,
        });
        return {
          ...userMessage,
          deliveryStatus: "failed",
        };
      }
    }

    if (!hasAnyQuickactionMetadata(userMessage.metadata)) {
      try {
        const handledCreateAppFollowUp = await this.handleCreateAppFollowUp(projectId, thread, userMessage);
        if (handledCreateAppFollowUp) {
          return userMessage;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.deps.logger?.error("Dashboard create-app follow-up failed", {
          projectId,
          threadId: thread.id,
          messageId: userMessage.id,
          error: message,
        });
        this.deps.connectionChatRepository.markDashboardMessagesFailed(thread.id, {
          upToMessageId: userMessage.id,
        });
        this.deps.connectionChatRepository.postSystemMessage(projectId, {
          threadId: thread.id,
          bodyMarkdown: `Create-app follow-up failed: ${message}`,
        });
        return {
          ...userMessage,
          deliveryStatus: "failed",
        };
      }
    }

    const existingTurn = this.inFlightTurns.get(thread.id);
    if (existingTurn) {
      if (isAgentSchedulerMessage(userMessage)) {
        return userMessage;
      }
      // A turn for this thread is already in flight — either still waiting on a provider
      // concurrency slot or already running inside its docker container. Abort it; the
      // owning call below will notice the abort, fold this (and any other still-pending)
      // message into a single follow-up turn instead of racing two invocations against
      // the same provider session.
      existingTurn.abortController.abort(new ChatTurnAbortError("supersession", "Superseded by a newer chat message"));
      return userMessage;
    }

    const turnHandle: InFlightChatTurn = {
      abortController: new AbortController(),
      latestMessage: userMessage,
      messageIds: [userMessage.id],
    };
    const abortFromCaller = (): void => {
      turnHandle.abortController.abort(new ChatTurnAbortError("cancellation", "Chat turn aborted by its caller"));
    };
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (options.signal?.aborted) abortFromCaller();
    this.inFlightTurns.set(thread.id, turnHandle);
    const settledMessageIds = new Set<string>();
    let ownerMessageFailed = false;

    try {
      const assignments = this.deps.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true });
      const settings = this.deps.getDashboardSettings({ projectId });

      for (;;) {
        const currentThread = this.deps.connectionChatRepository.getThread(thread.id) || thread;
        try {
          const route = await this.resolveThreadRoute(
            currentThread,
            assignments,
            settings,
            turnHandle.latestMessage.bodyMarkdown,
            turnHandle.latestMessage.metadata,
          );
          await this.runVirtualProvider(projectId, currentThread, turnHandle.latestMessage, route, turnHandle.abortController.signal);
          for (const messageId of turnHandle.messageIds) {
            settledMessageIds.add(messageId);
          }
        } catch (err: unknown) {
          const abortReason = turnHandle.abortController.signal.reason;
          const abortKind = abortReason instanceof ChatTurnAbortError ? abortReason.kind : null;

          if (abortKind === "supersession") {
            // Leave the interrupted messages pending. The deterministic drain below folds
            // them together with the newer ordinary dashboard message that superseded them.
          } else if (abortKind === "cancellation") {
            this.deps.connectionChatRepository.markDashboardMessagesFailed(thread.id, {
              upToMessageId: turnHandle.latestMessage.id,
            });
            for (const messageId of turnHandle.messageIds) {
              settledMessageIds.add(messageId);
            }
            if (turnHandle.messageIds.includes(userMessage.id)) {
              ownerMessageFailed = true;
            }
          } else {
            const message = err instanceof Error ? err.message : String(err);
            this.deps.logger?.error("Dashboard chat turn failed", {
              projectId,
              threadId: thread.id,
              messageId: turnHandle.latestMessage.id,
              error: message,
            });
            this.deps.connectionChatRepository.markDashboardMessagesFailed(thread.id, {
              upToMessageId: turnHandle.latestMessage.id,
            });
            for (const messageId of turnHandle.messageIds) {
              settledMessageIds.add(messageId);
            }
            if (turnHandle.messageIds.includes(userMessage.id)) {
              ownerMessageFailed = true;
            }
            const failureReply = this.deps.connectionChatRepository.postSystemMessage(projectId, {
              threadId: thread.id,
              bodyMarkdown: `Worker execution failed: ${message}`,
            });
            await this.deliverChatProviderReplyIfNeeded(projectId, thread, turnHandle.latestMessage, failureReply);
          }
        }

        const nextBatch = this.getNextPendingMessageBatch(thread.id, settledMessageIds);
        if (!nextBatch) {
          break;
        }

        turnHandle.latestMessage = nextBatch.message;
        turnHandle.messageIds = nextBatch.messageIds;
        turnHandle.abortController = new AbortController();
      }
    } finally {
      options.signal?.removeEventListener("abort", abortFromCaller);
      this.inFlightTurns.delete(thread.id);
      await this.runDueSchedulerEntriesAfterReply(projectId, thread.id);
    }
    return ownerMessageFailed ? { ...userMessage, deliveryStatus: "failed" } : userMessage;
  }

  private getNextPendingMessageBatch(
    threadId: string,
    settledMessageIds: ReadonlySet<string>,
  ): { message: ConversationMessageRecord; messageIds: string[] } | null {
    const pendingMessages = this.deps.connectionChatRepository
      .listMessages(threadId)
      .filter((candidate) => (
        candidate.direction === "dashboard_to_connection"
        && candidate.deliveryStatus === "pending"
        && !settledMessageIds.has(candidate.id)
      ));
    const firstMessage = pendingMessages[0];
    if (!firstMessage) {
      return null;
    }

    const schedulerBatch = isAgentSchedulerMessage(firstMessage);
    const batch: ConversationMessageRecord[] = [];
    for (const candidate of pendingMessages) {
      if (isAgentSchedulerMessage(candidate) !== schedulerBatch) {
        break;
      }
      batch.push(candidate);
    }

    const latestMessage = batch[batch.length - 1];
    return {
      message: {
        ...latestMessage,
        bodyMarkdown: batch.map((candidate) => candidate.bodyMarkdown).join("\n\n"),
      },
      messageIds: batch.map((candidate) => candidate.id),
    };
  }

  private async runDueSchedulerEntriesAfterReply(projectId: string, threadId: string): Promise<void> {
    const runDueSchedulerEntriesAfterReply = this.deps.runDueSchedulerEntriesAfterReply;
    if (!runDueSchedulerEntriesAfterReply) {
      return;
    }
    try {
      await runDueSchedulerEntriesAfterReply();
    } catch (error: unknown) {
      this.deps.logger?.warn("Failed to run due scheduler entries after dashboard reply", {
        projectId,
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleCreateAppQuickaction(
    projectId: string,
    thread: ConversationThreadRecord,
    userMessage: ConversationMessageRecord,
    quickaction: NormalizedCreateAppQuickaction,
  ): Promise<void> {
    if (!this.quicksprintLauncher) {
      throw new Error("Create-app quickactions are not available until quicksprint launch is initialized.");
    }

    const initializationState = this.deps.getProjectInitializationState
      ? await this.deps.getProjectInitializationState(projectId)
      : await this.projectInitializationStateService.getProjectInitializationState(projectId);
    if (!initializationState.canCreateInitialAppQuickactions) {
      throw new Error(`${getCreateAppQuickactionSpec(quickaction.kind).displayLabel} is only available for an eligible initial project.`);
    }

    const launch = await this.quicksprintLauncher.launchDetachedQuicksprint(projectId, {
      templateId: quickaction.templateId,
      taskCount: quickaction.taskCount,
      submitMode: "plan_and_start",
      clientRequestId: quickaction.requestId,
      planningOverrides: {
        designGuidance: quickaction.designGuidance,
      },
      additionalPrompt: this.buildCreateAppAdditionalPrompt(userMessage.bodyMarkdown, quickaction),
    });

    this.deps.connectionChatRepository.markDashboardMessagesProcessed(thread.id, {
      upToMessageId: userMessage.id,
    });

    const appLabel = getCreateAppQuickactionSpec(quickaction.kind).appKindLabel.toLowerCase();
    const progressMessage = this.deps.connectionChatRepository.postSystemMessage(projectId, {
      threadId: thread.id,
      bodyMarkdown: `Started a ${appLabel} sprint: **${launch.sprint.name}**. Planning is running now; add any directional details here and they can be appended after planning finishes.`,
      metadata: {
        widget_metadata: this.buildCreateAppProgressWidgetMetadata(quickaction, launch),
      },
    });

    const currentThread = this.deps.connectionChatRepository.getThread(thread.id) || thread;
    const quickactionState: DashboardCreateAppQuickactionRuntimeState = {
      activeSprintId: launch.sprint.id,
      appKind: quickaction.kind,
      planningStatus: "running",
      queuedFollowUps: [],
      quickactionRequestId: quickaction.requestId,
      clientRequestId: launch.planningRequest.clientRequestId,
      activePlanningRequestId: launch.planningRequest.clientRequestId,
      progressMessageId: progressMessage?.id ?? null,
      planningError: null,
    };
    this.deps.connectionChatRepository.updateThread(thread.id, {
      runtimeState: {
        ...currentThread.runtimeState,
        createAppQuickaction: quickactionState,
      },
    });

    this.attachCreateAppPlanningCompletion(projectId, thread.id, launch);
  }

  private async handleCreateAppFollowUp(
    projectId: string,
    thread: ConversationThreadRecord,
    userMessage: ConversationMessageRecord,
  ): Promise<boolean> {
    const currentThread = this.deps.connectionChatRepository.getThread(thread.id) || thread;
    const quickactionState = currentThread.runtimeState?.createAppQuickaction ?? null;
    if (!quickactionState?.activeSprintId) {
      return false;
    }

    const followUp: DashboardCreateAppQueuedFollowUp = {
      messageId: userMessage.id,
      bodyMarkdown: userMessage.bodyMarkdown,
      createdAt: userMessage.createdAt,
    };
    const taskCount = this.deps.projectManagementRepository.listTasks(projectId, quickactionState.activeSprintId).length;

    if (quickactionState.planningStatus === "running" && taskCount === 0) {
      const queued = this.updateCreateAppQuickactionRuntimeState(thread.id, (latestQuickactionState) => {
        if (
          !latestQuickactionState
          || latestQuickactionState.activeSprintId !== quickactionState.activeSprintId
          || latestQuickactionState.planningStatus !== "running"
        ) {
          return null;
        }
        return {
          ...latestQuickactionState,
          queuedFollowUps: [
            ...latestQuickactionState.queuedFollowUps.filter((entry) => entry.messageId !== followUp.messageId),
            followUp,
          ],
        };
      });
      if (!queued) {
        this.appendCreateAppFollowUpsToSprint(projectId, quickactionState.activeSprintId, [followUp]);
        this.deps.connectionChatRepository.markDashboardMessagesProcessed(thread.id, {
          upToMessageId: userMessage.id,
        });
        this.deps.connectionChatRepository.postSystemMessage(projectId, {
          threadId: thread.id,
          bodyMarkdown: "Updated the app sprint direction with your latest note.",
        });
        return true;
      }
      const latestTaskCount = this.deps.projectManagementRepository.listTasks(projectId, quickactionState.activeSprintId).length;
      if (latestTaskCount > 0) {
        this.appendAndClearCreateAppQueuedFollowUps(projectId, thread.id, quickactionState.activeSprintId);
        this.deps.connectionChatRepository.markDashboardMessagesProcessed(thread.id, {
          upToMessageId: userMessage.id,
        });
        this.deps.connectionChatRepository.postSystemMessage(projectId, {
          threadId: thread.id,
          bodyMarkdown: "Updated the app sprint direction with your latest note.",
        });
        return true;
      }
      this.deps.connectionChatRepository.markDashboardMessagesProcessed(thread.id, {
        upToMessageId: userMessage.id,
      });
      this.deps.connectionChatRepository.postSystemMessage(projectId, {
        threadId: thread.id,
        bodyMarkdown: "Got it. I'll apply that direction to the app sprint after planning finishes.",
      });
      return true;
    }

    const appendedQueuedFollowUps = this.appendAndClearCreateAppQueuedFollowUps(projectId, thread.id, quickactionState.activeSprintId);
    const alreadyAppendedCurrentFollowUp = appendedQueuedFollowUps
      .some((entry) => entry.messageId === followUp.messageId);
    if (!alreadyAppendedCurrentFollowUp) {
      this.appendCreateAppFollowUpsToSprint(projectId, quickactionState.activeSprintId, [followUp]);
    }
    this.deps.connectionChatRepository.markDashboardMessagesProcessed(thread.id, {
      upToMessageId: userMessage.id,
    });
    this.deps.connectionChatRepository.postSystemMessage(projectId, {
      threadId: thread.id,
      bodyMarkdown: "Updated the app sprint direction with your latest note.",
    });
    return true;
  }

  private attachCreateAppPlanningCompletion(
    projectId: string,
    threadId: string,
    launch: DetachedQuicksprintLaunchResult,
  ): void {
    void launch.planningPromise.then(
      () => this.finalizeCreateAppPlanning(projectId, threadId, launch.sprint.id, launch.planningRequest.clientRequestId, "completed"),
      (error: unknown) => this.finalizeCreateAppPlanning(projectId, threadId, launch.sprint.id, launch.planningRequest.clientRequestId, "failed", error),
    );
  }

  private async finalizeCreateAppPlanning(
    projectId: string,
    threadId: string,
    sprintId: string,
    planningRequestId: string,
    planningStatus: DashboardCreateAppQuickactionPlanningStatus,
    error?: unknown,
  ): Promise<void> {
    try {
      const thread = this.deps.connectionChatRepository.getThread(threadId);
      const quickactionState = thread.runtimeState?.createAppQuickaction ?? null;
      if (!quickactionState || quickactionState.activeSprintId !== sprintId) {
        return;
      }

      const appendedFollowUpIds = new Set<string>();
      if (planningStatus === "completed") {
        try {
          for (;;) {
            const latestThread = this.deps.connectionChatRepository.getThread(threadId);
            const latestQuickactionState = latestThread.runtimeState?.createAppQuickaction ?? null;
            if (!latestQuickactionState || latestQuickactionState.activeSprintId !== sprintId) {
              return;
            }
            if (
              latestQuickactionState.activePlanningRequestId
              && latestQuickactionState.activePlanningRequestId !== planningRequestId
            ) {
              return;
            }
            const followUpsToAppend = latestQuickactionState.queuedFollowUps
              .filter((entry) => !appendedFollowUpIds.has(entry.messageId));
            if (followUpsToAppend.length === 0) {
              break;
            }
            this.appendCreateAppFollowUpsToSprint(projectId, sprintId, followUpsToAppend);
            for (const followUp of followUpsToAppend) {
              appendedFollowUpIds.add(followUp.messageId);
            }
          }
        } catch (appendError: unknown) {
          this.deps.logger?.error("Failed to append queued create-app follow-ups after planning completed", {
            projectId,
            threadId,
            sprintId,
            error: appendError instanceof Error ? appendError.message : String(appendError),
          });
        }
      }

      const now = new Date().toISOString();
      const nextQuickactionState = this.updateCreateAppQuickactionRuntimeState(thread.id, (latestQuickactionState) => {
        if (!latestQuickactionState || latestQuickactionState.activeSprintId !== sprintId) {
          return null;
        }
        if (
          latestQuickactionState.activePlanningRequestId
          && latestQuickactionState.activePlanningRequestId !== planningRequestId
        ) {
          return null;
        }
        let queuedFollowUps = planningStatus === "completed"
          ? latestQuickactionState.queuedFollowUps.filter((entry) => !appendedFollowUpIds.has(entry.messageId))
          : latestQuickactionState.queuedFollowUps;
        if (planningStatus === "completed" && queuedFollowUps.length > 0) {
          try {
            this.appendCreateAppFollowUpsToSprint(projectId, sprintId, queuedFollowUps);
            for (const followUp of queuedFollowUps) {
              appendedFollowUpIds.add(followUp.messageId);
            }
            queuedFollowUps = [];
          } catch (appendError: unknown) {
            this.deps.logger?.error("Failed to append queued create-app follow-ups during final planning state merge", {
              projectId,
              threadId,
              sprintId,
              error: appendError instanceof Error ? appendError.message : String(appendError),
            });
          }
        }
        const nextState: DashboardCreateAppQuickactionRuntimeState = {
          ...latestQuickactionState,
          planningStatus,
          queuedFollowUps,
          planningError: planningStatus === "failed"
            ? (error instanceof Error ? error.message : String(error ?? "Planning failed"))
            : null,
          ...(planningStatus === "completed" ? { completedAt: now } : { failedAt: now }),
        };
        if (nextState.activePlanningRequestId === planningRequestId) {
          delete nextState.activePlanningRequestId;
        }
        return nextState;
      });
      this.updateCreateAppProgressWidgetStatus(nextQuickactionState?.progressMessageId ?? quickactionState.progressMessageId ?? null, planningStatus);
    } catch (settleError: unknown) {
      this.deps.logger?.error("Failed to finalize dashboard create-app planning state", {
        projectId,
        threadId,
        sprintId,
        planningStatus,
        error: settleError instanceof Error ? settleError.message : String(settleError),
      });
    }
  }

  private updateCreateAppQuickactionRuntimeState(
    threadId: string,
    updater: (
      current: DashboardCreateAppQuickactionRuntimeState | null,
      thread: ConversationThreadRecord,
    ) => DashboardCreateAppQuickactionRuntimeState | null,
  ): DashboardCreateAppQuickactionRuntimeState | null {
    const latestThread = this.deps.connectionChatRepository.getThread(threadId);
    const currentRuntimeState = latestThread.runtimeState ?? {};
    const nextQuickactionState = updater(currentRuntimeState.createAppQuickaction ?? null, latestThread);
    if (!nextQuickactionState) {
      return null;
    }

    this.deps.connectionChatRepository.updateThread(threadId, {
      runtimeState: {
        ...currentRuntimeState,
        createAppQuickaction: nextQuickactionState,
      },
    });
    return nextQuickactionState;
  }

  private appendAndClearCreateAppQueuedFollowUps(
    projectId: string,
    threadId: string,
    sprintId: string,
  ): DashboardCreateAppQueuedFollowUp[] {
    const latestThread = this.deps.connectionChatRepository.getThread(threadId);
    const latestQuickactionState = latestThread.runtimeState?.createAppQuickaction ?? null;
    if (!latestQuickactionState || latestQuickactionState.activeSprintId !== sprintId) {
      return [];
    }
    const queuedFollowUps = latestQuickactionState.queuedFollowUps;
    if (queuedFollowUps.length === 0) {
      return [];
    }

    this.appendCreateAppFollowUpsToSprint(projectId, sprintId, queuedFollowUps);
    const appendedFollowUpIds = new Set(queuedFollowUps.map((entry) => entry.messageId));
    this.updateCreateAppQuickactionRuntimeState(threadId, (currentQuickactionState) => {
      if (!currentQuickactionState || currentQuickactionState.activeSprintId !== sprintId) {
        return null;
      }
      return {
        ...currentQuickactionState,
        queuedFollowUps: currentQuickactionState.queuedFollowUps
          .filter((entry) => !appendedFollowUpIds.has(entry.messageId)),
      };
    });
    return queuedFollowUps;
  }

  private appendCreateAppFollowUpsToSprint(
    projectId: string,
    sprintId: string,
    followUps: DashboardCreateAppQueuedFollowUp[],
  ): void {
    const normalizedFollowUps = followUps
      .map((entry) => ({
        ...entry,
        bodyMarkdown: entry.bodyMarkdown.trim(),
      }))
      .filter((entry) => entry.bodyMarkdown.length > 0);
    if (normalizedFollowUps.length === 0) {
      return;
    }

    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error(`Sprint not found for create-app follow-up: ${sprintId}`);
    }

    const currentGoal = sprint.goal.trim();
    const currentOriginalPrompt = sprint.originalPrompt?.trim() ?? "";
    const appendedText = this.appendAdditionalDirectionSection(
      currentGoal || currentOriginalPrompt,
      normalizedFollowUps,
    );
    if (currentGoal) {
      this.deps.projectManagementRepository.updateSprint(sprintId, { goal: appendedText });
    } else {
      this.deps.projectManagementRepository.updateSprint(sprintId, { originalPrompt: appendedText });
    }
  }

  private appendAdditionalDirectionSection(
    currentText: string,
    followUps: DashboardCreateAppQueuedFollowUp[],
  ): string {
    const heading = "## Additional direction from chat";
    const followUpBlock = followUps
      .map((entry) => `### ${entry.createdAt}\n\n${entry.bodyMarkdown.trim()}`)
      .join("\n\n");
    const trimmedCurrentText = currentText.trimEnd();
    if (!trimmedCurrentText) {
      return `${heading}\n\n${followUpBlock}`;
    }
    if (trimmedCurrentText.includes(heading)) {
      return `${trimmedCurrentText}\n\n${followUpBlock}`;
    }
    return `${trimmedCurrentText}\n\n${heading}\n\n${followUpBlock}`;
  }

  private updateCreateAppProgressWidgetStatus(
    progressMessageId: string | null,
    planningStatus: DashboardCreateAppQuickactionPlanningStatus,
  ): void {
    if (!progressMessageId) {
      return;
    }
    const message = this.deps.connectionChatRepository.getMessage(progressMessageId);
    const metadata = message.metadata ?? {};
    const widgetMetadata = readRecord(metadata.widget_metadata);
    if (!widgetMetadata || widgetMetadata.type !== DASHBOARD_APP_PROGRESS_WIDGET_TYPE) {
      return;
    }

    const status = planningStatus === "completed" ? "completed" : "failed";
    const existingStages = Array.isArray(widgetMetadata.planningStages)
      ? widgetMetadata.planningStages
      : [];
    const planningStages = existingStages.map((stage) => {
      const stageRecord = readRecord(stage);
      if (!stageRecord) {
        return stage;
      }
      if (status === "completed") {
        return { ...stageRecord, status: "completed" };
      }
      return stageRecord.id === "planning"
        ? { ...stageRecord, status: "failed" }
        : stageRecord;
    });

    this.deps.connectionChatRepository.updateMessageMetadata(progressMessageId, {
      ...metadata,
      widget_metadata: {
        ...widgetMetadata,
        status,
        planningStages,
      },
    });
  }

  private buildCreateAppAdditionalPrompt(bodyMarkdown: string, quickaction: NormalizedCreateAppQuickaction): string {
    const spec = getCreateAppQuickactionSpec(quickaction.kind);
    const appLabel = spec.appKindLabel.toLowerCase();
    const appArticle = /^[aeiou]/i.test(appLabel) ? "an" : "a";
    const stackLines = this.formatCreateAppStackSummary(quickaction.stackSummary);
    const suggestionLine = quickaction.suggestionTags.length > 0
      ? `Suggestion tags from the dashboard: ${quickaction.suggestionTags.join(", ")}.`
      : "No dashboard suggestion tags were provided.";

    return [
      "Dashboard create-app quickaction.",
      `Quickaction request id: ${quickaction.requestId}.`,
      `Create an app sprint for ${appArticle} ${appLabel}.`,
      stackLines ? `Suggested stack summary:\n${stackLines}` : "No suggested stack summary was provided; infer the right stack from the selected project before planning.",
      suggestionLine,
      `Original dashboard message:\n${bodyMarkdown.trim()}`,
      "Planning instructions: answer quickly, create a concrete app sprint, do not ask for confirmation before planning or starting, and keep the plan directional enough that the user can steer it.",
      "Invite directional follow-up in the resulting planning summary, and prepare for follow-up details to be appended after planning finishes.",
    ].join("\n\n");
  }

  private formatCreateAppStackSummary(stackSummary: DashboardCreateAppQuickactionStackSummary | null): string | null {
    if (!stackSummary) {
      return null;
    }
    const labels: Array<[keyof DashboardCreateAppQuickactionStackSummary, string]> = [
      ["techstackId", "Techstack ID"],
      ["techstackName", "Techstack"],
      ["applicationKind", "Application kind"],
      ["language", "Language"],
      ["framework", "Framework"],
      ["runtime", "Runtime"],
      ["packageManager", "Package manager"],
      ["styling", "Styling"],
      ["testFramework", "Test framework"],
    ];
    const lines = labels.flatMap(([key, label]) => {
      const value = stackSummary[key];
      return typeof value === "string" && value.trim() ? [`- ${label}: ${value.trim()}`] : [];
    });
    return lines.length > 0 ? lines.join("\n") : null;
  }

  private buildCreateAppProgressWidgetMetadata(
    quickaction: NormalizedCreateAppQuickaction,
    launch: DetachedQuicksprintLaunchResult,
  ): DashboardAppProgressWidgetMetadata {
    return {
      type: DASHBOARD_APP_PROGRESS_WIDGET_TYPE,
      status: "running",
      appKind: quickaction.kind,
      sprintId: launch.sprint.id,
      sprintName: launch.sprint.name,
      stackSummary: quickaction.stackSummary,
      planningStages: this.buildCreateAppPlanningStages(),
      suggestionTags: quickaction.suggestionTags,
      quickactionRequestId: quickaction.requestId,
      clientRequestId: launch.planningRequest.clientRequestId,
    };
  }

  private buildCreateAppPlanningStages(): DashboardAppProgressPlanningStage[] {
    return [
      { id: "planning", label: "Planning", status: "running" },
      { id: "plan", label: "Plan", status: "pending" },
      { id: "start", label: "Start", status: "pending" },
      { id: "finish", label: "Finish", status: "pending" },
    ];
  }

  private async runVirtualProvider(
    projectId: string,
    thread: ConversationThreadRecord,
    latestMessage: ConversationMessageRecord,
    route: ThreadRouteResolution,
    signal: AbortSignal,
  ): Promise<void> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) return;

    const provider = route.providerId!;
    // Fold the instance's customModel into the model exactly like the coding path
    // (ProviderExecutionService.executeProvider). The low-level runner keys off `model`
    // alone and ignores `customModel`, so without this a "Claude Local"-style instance
    // (customModel/customBaseUrl pointing at a local LM server) would run as `model=default`
    // and hit the real Anthropic subscription instead of the configured local endpoint.
    const model = resolveEffectiveModel({
      provider,
      model: route.model!,
      providerMountAuth: route.providerMountAuth,
      customModel: route.customModel,
      qwenAuthMode: route.qwenAuthMode,
      qwenModelId: route.qwenModelId,
      openCodeAuthMode: route.openCodeAuthMode,
      openCodeProviderId: route.openCodeProviderId,
      openCodeModelId: route.openCodeModelId,
    });
    const apiKey = route.apiKey!;
    const thinkingMode = route.thinkingMode;
    const dashboardSettings = this.deps.getDashboardSettings({ projectId });
    const defaultBranch = resolveEffectiveDefaultBranch(project, dashboardSettings);
    const invocationWorkspace = buildProviderInvocationWorkspaceOptions({
      workflowSettings: dashboardSettings.cliWorkflow,
      gitPolicy: {
        githubMode: resolveEffectiveGithubMode(project, dashboardSettings),
        defaultBranch,
        githubToken: dashboardSettings.git?.githubToken,
        gitlabToken: dashboardSettings.git?.gitlabToken,
      },
    });

    const runtimeState = thread.runtimeState || {};
    const pendingAction = runtimeState.pendingManagementAction;

    if (pendingAction) {
      const lowerBody = latestMessage.bodyMarkdown.trim().toLowerCase();
      const isApproval = lowerBody === "yes" || lowerBody === "approve" || lowerBody === "confirm" || lowerBody === "y";
      const isRejection = lowerBody === "no" || lowerBody === "reject" || lowerBody === "cancel" || lowerBody === "n";

      if (isApproval || isRejection) {
        this.deps.connectionChatRepository.markDashboardMessagesProcessed(thread.id, {
          upToMessageId: latestMessage.id,
        });

        if (isRejection) {
          const replyMessage = this.deps.connectionChatRepository.postSystemMessage(projectId, {
            threadId: thread.id,
            bodyMarkdown: "_Management action canceled by user._",
          });
          await this.deliverChatProviderReplyIfNeeded(projectId, thread, latestMessage, replyMessage);
          const newRuntimeState: ConversationRuntimeState = { ...runtimeState };
          delete newRuntimeState.pendingManagementAction;
          this.deps.connectionChatRepository.updateThread(thread.id, { runtimeState: newRuntimeState });
          return;
        }

        try {
          const result = await this.deps.chatManagementActionService.executeApprovedAction(
            projectId,
            provider,
            model,
            pendingAction.action
          );

          let systemReply = result.replyMarkdown;
          if (result.result) {
            const stringifiedResult = typeof result.result === "object" ? JSON.stringify(result.result, null, 2) : String(result.result);
            systemReply += `\n\n_Action completed successfully._\n\`\`\`json\n${stringifiedResult}\n\`\`\``;
          }

          const replyMessage = this.deps.connectionChatRepository.postSystemMessage(projectId, {
            threadId: thread.id,
            bodyMarkdown: systemReply.trim(),
          });
          await this.deliverChatProviderReplyIfNeeded(projectId, thread, latestMessage, replyMessage);

          const newRuntimeState: ConversationRuntimeState = { ...runtimeState };
          delete newRuntimeState.pendingManagementAction;
          this.deps.connectionChatRepository.updateThread(thread.id, { runtimeState: newRuntimeState });
          return;

        } catch (err: any) {
          const replyMessage = this.deps.connectionChatRepository.postSystemMessage(projectId, {
            threadId: thread.id,
            bodyMarkdown: `Execution failed: ${err.message}`,
          });
          await this.deliverChatProviderReplyIfNeeded(projectId, thread, latestMessage, replyMessage);
          const newRuntimeState: ConversationRuntimeState = { ...runtimeState };
          delete newRuntimeState.pendingManagementAction;
          this.deps.connectionChatRepository.updateThread(thread.id, { runtimeState: newRuntimeState });
          return;
        }
      }
    }

    const lastProvider = runtimeState.virtualProvider;
    const replayRequired = runtimeState.replayRequired === true || lastProvider !== provider || !runtimeState.sessionIds?.length;

    let promptContent = "";
    let continueSessionId: string | null = null;
    const baseMcpConnection = this.deps.getMcpConnectionInfo?.() ?? null;
    const mcpConnection = baseMcpConnection
      ? { ...baseMcpConnection, threadId: thread.id }
      : null;

    const allMessages = this.deps.connectionChatRepository.listMessages(thread.id) ?? [];
    const suppressRichWidgets = isChatProviderSourcedThread(thread, allMessages, latestMessage);

    const respondingAgentPresetId = getExternalAgentPresetId(latestMessage.metadata)
      ?? dashboardSettings.agents?.routing?.dashboardReply?.agentPresetId
      ?? null;
    const respondingAgent = typeof this.deps.agentPresetSyncService.resolveDashboardReplyAgent === "function"
      ? await this.deps.agentPresetSyncService.resolveDashboardReplyAgent(
        projectId,
        respondingAgentPresetId,
      )
      : await this.deps.agentPresetSyncService.getWorkerAgent(projectId);
    const agentMcpAccess = this.resolveDashboardReplyMcpAccess(
      respondingAgent.mcpAccess,
      respondingAgentPresetId,
    );
    const mcpAvailable = mcpConnection !== null && agentMcpAccess.codeUxEnabled;

    if (replayRequired) {
      const workerInstructions = respondingAgent.instructionMarkdown.trim();
      const knowledgeManifest = this.deps.knowledgeService?.buildManifestMarkdownForAgent(respondingAgent.id) ?? null;
      promptContent = buildChatReplayPrompt({
        projectId,
        repoPath: project.baseDir,
        projectName: project.name,
        thread,
        messages: allMessages,
        workerInstructions,
        isDashboardReply: false,
        mcpAvailable,
        mcpAccessMode: isSchedulerOnlyAgentMcpAccess(agentMcpAccess) ? "scheduler_only" : "management",
        knowledgeManifest,
        suppressRichWidgets,
      });
    } else {
      promptContent = buildChatContinuationPrompt(latestMessage, pendingAction, mcpAvailable, thread.title, suppressRichWidgets);
      continueSessionId = runtimeState.sessionIds![0];
    }

    // opencode's `export <sessionID>` is cumulative for the whole session, so
    // a chat reply that resumes an earlier turn's session needs that turn's
    // raw snapshot as a baseline to subtract out, or it would re-report every
    // earlier reply's tokens too. See execute-provider-stage.ts for the
    // analogous sprint-task wiring.
    const openCodeBaselineRawUsageJson = provider === "opencode" && continueSessionId
      ? (this.deps.executionRepository.getLatestProviderInvocationUsageBySession(thread.id, "dashboard_reply")?.rawUsageJson ?? null)
      : null;

    const finalPrompt = buildProviderPrompt(promptContent, thinkingMode!, provider);

    const result = await this.deps.chatManagementActionService.processManagementAction({
      projectId,
      provider,
      model,
      thinkingMode,
      apiKey,
      qwenAuthMode: route.qwenAuthMode,
      qwenRegion: route.qwenRegion,
      qwenBaseUrl: route.qwenBaseUrl,
      qwenEnvKey: route.qwenEnvKey,
      qwenModelId: route.qwenModelId,
      qwenProtocol: route.qwenProtocol,
      qwenAdditionalModelProviders: route.qwenAdditionalModelProviders,
      openCodeAuthMode: route.openCodeAuthMode,
      openCodeProviderId: route.openCodeProviderId,
      openCodeModelId: route.openCodeModelId,
      openCodeBaseUrl: route.openCodeBaseUrl,
      openCodeEnvKey: route.openCodeEnvKey,
      openCodePackage: route.openCodePackage,
      providerMountAuth: route.providerMountAuth,
      providerAuthPath: route.providerAuthPath,
      providerConfigMode: route.providerConfigMode,
      providerConfigPath: route.providerConfigPath,
      customBaseUrl: route.customBaseUrl,
      customModel: route.customModel,
      sessionId: thread.id,
      continueSessionId,
      openCodeBaselineRawUsageJson,
      settings: dashboardSettings,
      prompt: finalPrompt,
      repoPath: project.baseDir,
      snapshotCheckout: invocationWorkspace.snapshotCheckout,
      gitPolicy: invocationWorkspace.gitPolicy,
      workspaceLifecycle: continueSessionId ? "continue" : invocationWorkspace.workspaceLifecycle,
      mcpConnection,
      agentMcpAccess,
      mcpAgentId: respondingAgent.id,
      signal,
    });

    this.deps.connectionChatRepository.markDashboardMessagesProcessed(thread.id, {
      upToMessageId: latestMessage.id,
    });

    let systemReply = result.replyMarkdown;
    let newPendingAction = null;

    if (result.action) {
      if (result.approvalRequired) {
        systemReply += `\n\n_Action requires approval: ${result.approvalMessage}_\n_Please reply with "yes" to confirm or "no" to cancel._`;
        newPendingAction = {
          action: result.action,
          approvalMessage: result.approvalMessage || "Action requires approval.",
          proposedAt: new Date().toISOString(),
        };
      } else if (result.result) {
        const stringifiedResult = typeof result.result === "object" ? JSON.stringify(result.result, null, 2) : String(result.result);
        systemReply += `\n\n_Action completed successfully._\n\`\`\`json\n${stringifiedResult}\n\`\`\``;
      }
    }

    // In MCP-native mode, check if the worker triggered an approval-gated action
    if (mcpAvailable && !newPendingAction) {
      const tracker = this.deps.getMcpApprovalTracker?.();
      const correlationId = getCorrelationId() ?? thread.id;
      const pendingApproval = tracker?.takePending(correlationId) ?? null;
      if (pendingApproval) {
        newPendingAction = {
          action: pendingApproval.action,
          approvalMessage: pendingApproval.approvalMessage,
          proposedAt: pendingApproval.proposedAt,
        };
      }
    }

    const promptSuggestionsMetadata: PromptSuggestionsMetadata | undefined = result.promptSuggestions?.length
      ? { promptSuggestions: result.promptSuggestions }
      : undefined;
    const agentEffectMetadata: AgentResponseEffectMetadata | undefined = result.agentEffect
      ? { agentEffect: result.agentEffect }
      : undefined;
    const replyMetadata = promptSuggestionsMetadata || agentEffectMetadata
      ? { ...promptSuggestionsMetadata, ...agentEffectMetadata }
      : undefined;

    const replyMessage = this.deps.connectionChatRepository.postSystemMessage(projectId, {
      threadId: thread.id,
      bodyMarkdown: systemReply.trim(),
      ...(replyMetadata ? { metadata: replyMetadata } : {}),
    });
    await this.deliverChatProviderReplyIfNeeded(projectId, thread, latestMessage, replyMessage);

    const newRuntimeState: ConversationRuntimeState = {
      ...runtimeState,
      routeKind: "virtual",
      virtualProvider: provider,
      modelLabel: model,
      sessionIds: [result.nativeSessionId || continueSessionId || thread.id],
      replayRequired: false,
    };

    if (newPendingAction) {
      newRuntimeState.pendingManagementAction = newPendingAction;
    } else {
      delete newRuntimeState.pendingManagementAction;
    }

    this.deps.connectionChatRepository.updateThread(thread.id, {
      connectionId: null,
      runtimeState: newRuntimeState,
    });
  }

  private resolveDashboardReplyMcpAccess(
    access: AgentMcpAccessConfig | undefined,
    _dashboardReplyAgentPresetId: string | null,
  ): AgentMcpAccessConfig {
    return dashboardReplyAgentMcpAccess(access);
  }

  private async deliverChatProviderReplyIfNeeded(
    projectId: string,
    thread: ConversationThreadRecord,
    triggeringMessage: ConversationMessageRecord,
    replyMessage: ConversationMessageRecord,
  ): Promise<void> {
    if (!this.deps.chatProviderOutboundService || !isChatProviderSourcedMessage(triggeringMessage)) {
      return;
    }
    try {
      await this.deps.chatProviderOutboundService.deliverReply({
        projectId,
        thread,
        triggeringMessage,
        replyMessage,
      });
    } catch (error) {
      this.deps.logger?.error("Failed to enqueue chat provider outbound reply", {
        logPurpose: "integration",
        projectId,
        threadId: thread.id,
        triggeringMessageId: triggeringMessage.id,
        replyMessageId: replyMessage.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async generateThreadCompaction(
    projectId: string,
    repoPath: string,
    thread: ConversationThreadRecord,
    messages: ConversationMessageRecord[],
    route: ThreadRouteResolution,
    continueSessionId: string,
  ): Promise<{ summary: ConversationCompactionSummary & { nativeSessionId?: string | null }; nativeSessionId: string | null; continueSessionId: string }> {
    const provider = route.providerId!;
    // Fold customModel into the model so a local-redirect instance (customModel/customBaseUrl)
    // compacts against its configured endpoint rather than the real subscription. The runner
    // keys off `model` and ignores the separate `customModel` field.
    const model = resolveEffectiveModel({
      provider,
      model: route.model!,
      providerMountAuth: route.providerMountAuth,
      customModel: route.customModel,
      qwenAuthMode: route.qwenAuthMode,
      qwenModelId: route.qwenModelId,
      openCodeAuthMode: route.openCodeAuthMode,
      openCodeProviderId: route.openCodeProviderId,
      openCodeModelId: route.openCodeModelId,
    });
    const apiKey = route.apiKey!;
    const dashboardSettings = this.deps.getDashboardSettings({ projectId });
    const workflowSettings = dashboardSettings.cliWorkflow;
    const project = this.deps.projectManagementRepository.getProject(projectId);
    const defaultBranch = resolveEffectiveDefaultBranch(project ?? {}, dashboardSettings);
    const githubToken = this.deps.getGithubToken();
    if (!continueSessionId) {
      throw new Error("Native chat compaction requires an active provider session to continue.");
    }
    const execInvocation = this.deps.executionRepository.createExecutionInvocation({
      projectId,
      skipValidation: true,
      type: "chat_compaction",
      provider,
      model,
      startedAt: new Date().toISOString(),
      attentionItemId: null,
      dispatchId: null,
      providerInvocationId: null,
      sprintId: null,
      sprintRunId: null,
      taskId: null,
      taskRunId: null,
    });

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "user",
      contentMarkdown: "Native CLI session operation: compact",
    });

    try {
      const result = await this.deps.providerExecutionService.executeProvider({
        projectId,
        purpose: "chat_compaction",
        type: "chat_compaction",
        provider,
        prompt: "Native CLI session operation: compact",
        cwd: repoPath,
        model,
        thinkingMode: route.thinkingMode,
        apiKey,
        qwenAuthMode: route.qwenAuthMode,
        qwenRegion: route.qwenRegion,
        qwenBaseUrl: route.qwenBaseUrl,
        qwenEnvKey: route.qwenEnvKey,
        qwenModelId: route.qwenModelId,
        qwenProtocol: route.qwenProtocol,
        qwenAdditionalModelProviders: route.qwenAdditionalModelProviders,
        openCodeAuthMode: route.openCodeAuthMode,
        openCodeProviderId: route.openCodeProviderId,
        openCodeModelId: route.openCodeModelId,
        openCodeBaseUrl: route.openCodeBaseUrl,
        openCodeEnvKey: route.openCodeEnvKey,
        openCodePackage: route.openCodePackage,
        providerMountAuth: route.providerMountAuth,
        providerAuthPath: route.providerAuthPath,
        providerConfigMode: route.providerConfigMode,
        providerConfigPath: route.providerConfigPath,
        customBaseUrl: route.customBaseUrl,
        customModel: route.customModel,
        sessionId: thread.id,
        workspaceSessionId: thread.id,
        workflowSettings,
        repoPath,
        expectTextOutput: true,
        invocationId: execInvocation.id,
        trackPromptInInvocation: false,
        trackAssistantInInvocation: false,
        finalizeExecutionInvocation: false,
        ...buildProviderInvocationWorkspaceOptions({
          workflowSettings,
          gitPolicy: {
            githubMode: resolveEffectiveGithubMode(project ?? {}, dashboardSettings),
            defaultBranch,
            githubToken,
            gitlabToken: dashboardSettings.git?.gitlabToken,
          },
          lifecycle: "continue",
        }),
        continueSessionId,
        nativeSessionOperation: "compact",
        onActivity: (desc, originator) => {
          this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
            role: originator === "user" ? "user" : "assistant",
            contentMarkdown: `[Status] ${desc}`,
          });
        },
      });

      const markdown = normalizeProviderReply(result.text);
      if (!markdown) {
        throw new Error(`Provider ${provider} returned an empty compaction summary.`);
      }

      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
        role: "assistant",
        contentMarkdown: markdown,
      });
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "completed",
        finishedAt: new Date().toISOString(),
      });

      const nativeSessionId = result.nativeSessionId || continueSessionId;
      return {
        summary: {
          markdown,
          generatedAt: new Date().toISOString(),
          provider,
          model,
          sourceMessageId: messages[messages.length - 1]?.id || null,
          sourceMessageCount: messages.length,
          nativeSessionId,
        },
        nativeSessionId,
        continueSessionId,
      };
    } catch (err: any) {
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      throw err;
    }
  }
}
