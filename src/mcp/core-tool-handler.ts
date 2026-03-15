import type {
  ClaimAttentionItemArgs,
  ListenArgs,
  PostListenReplyArgs,
  PullTaskDispatchArgs,
  PullInboxArgs,
  ReportAttentionOutcomeArgs,
  ResolveAttentionItemArgs,
  StartListenArgs,
  UpdateTaskDispatchArgs,
} from "../api/mcp/tool-registry.js";
import type { JulesApiClient } from "../integrations/jules-api-client.js";
import type { DashboardSettings, JulesActivity, JulesSession } from "../contracts/app-types.js";
import type { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import type { ListenResponse, McpConnectionRole } from "../contracts/connection-chat-types.js";
import type { WorkerTaskDispatchService } from "../services/worker-task-dispatch-service.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ActivitySummaryService } from "../domain/sessions/activity-summary.js";
import type { McpRuntimeRole } from "../contracts/mcp-tool-definitions.js";
import type { WorkerListenEventService } from "../domain/workers/worker-listen-event-service.js";
import type { WorkerEndpointRepository } from "../repositories/worker-endpoint-repository.js";
import type { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import type { WorkerAttentionOutcomeService } from "../domain/workers/worker-attention-outcome-service.js";
import type { ProjectWorkerAssignmentService } from "../domain/workers/project-worker-assignment-service.js";
import type { WorkerExecutionMode } from "../contracts/app-types.js";

interface CoreToolHandlerDependencies {
  julesApi: JulesApiClient;
  activitySummary: ActivitySummaryService;
  normalizeName: (type: string, id: string) => string;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>;
  isJulesApiConfigured: () => boolean;
  getMissingJulesApiKeyInstruction: () => string;
  isTrackedCliSession: (sessionId: string) => boolean;
  getTrackedSession: (sessionId: string) => JulesSession | null;
  getDashboardSettings: () => DashboardSettings;
  connectionChatRepository: ConnectionChatRepository;
  workerEndpointRepository?: WorkerEndpointRepository;
  projectWorkerAssignmentService?: ProjectWorkerAssignmentService;
  projectAttentionService?: ProjectAttentionService;
  workerAttentionOutcomeService?: WorkerAttentionOutcomeService;
  workerTaskDispatchService: WorkerTaskDispatchService;
  workerListenEventService?: WorkerListenEventService;
  resolveWorkerExecutionMode?: (projectId: string, sprintId?: string | null) => WorkerExecutionMode;
  logger?: Logger;
}

const DEFAULT_LISTEN_POLL_INTERVAL_MS = 3000;
const DEFAULT_WORKER_LISTEN_TIMEOUT_SECONDS = 30;
const MIN_LISTEN_TIMEOUT_SECONDS = 1;
const MAX_LISTEN_TIMEOUT_SECONDS = 3600;
const MIN_LISTEN_POLL_INTERVAL_MS = 100;
const MAX_LISTEN_POLL_INTERVAL_MS = 10000;

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export class CoreToolHandler {
  constructor(private readonly deps: CoreToolHandlerDependencies) {}

  private ensureJulesApiConfigured(): void {
    if (!this.deps.isJulesApiConfigured()) {
      throw new Error(this.deps.getMissingJulesApiKeyInstruction());
    }
  }

  async handleGetSession({ session_id }: { session_id: string }) {
    if (this.deps.isTrackedCliSession(session_id)) {
      const session = this.deps.getTrackedSession(session_id);
      if (!session) {
        throw new Error(`Session not found: ${session_id}`);
      }
      return { content: [{ type: "text", text: JSON.stringify(this.deps.activitySummary.toSessionSummary(session), null, 2) }] };
    }

    this.ensureJulesApiConfigured();
    const session = await this.deps.julesApi.getSession(session_id);
    let lastActivity: JulesActivity | undefined;

    try {
      const sessionName = this.deps.resolveSessionName(session) || this.deps.normalizeName("sessions", session_id);
      const activities = await this.deps.fetchRecentActivities(sessionName, this.deps.activitySummary.getActivityRecentLimit());
      if (activities.length > 0) {
        lastActivity = activities[activities.length - 1];
      }
    } catch {
      this.deps.logger?.warn("Could not fetch activities for session", { sessionId: session_id });
    }

    return { content: [{ type: "text", text: JSON.stringify(this.deps.activitySummary.toSessionSummary(session, lastActivity), null, 2) }] };
  }

  async handleStartListen(args: StartListenArgs) {
    const response = this.deps.connectionChatRepository.startListen({
      connectionKey: args.connection_key,
      displayName: args.display_name,
      role: args.role,
      projectId: args.project_id,
      projectIds: args.project_ids,
      activeProjectIds: args.active_project_ids,
      transport: args.transport,
      capabilities: args.capabilities,
      maxMessages: args.max_messages,
    });
    this.ensureWorkerProjectAssignments(response.connection);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2),
      }],
    };
  }

  async handleListen(args: ListenArgs) {
    return this.handleListenForRuntime(args, "project_manager");
  }

  async handleListenForRuntime(args: ListenArgs, runtimeRole: McpRuntimeRole) {
    const normalizedArgs = runtimeRole === "worker_gateway"
      ? {
        ...args,
        role: "worker" as const,
        transport: "streamable_http",
      }
      : args;
    const settings = this.deps.getDashboardSettings();
    const timeoutSeconds = this.normalizeListenTimeoutSeconds(normalizedArgs.timeout_seconds, settings, normalizedArgs.role);
    const pollIntervalMs = this.normalizeListenPollIntervalMs(normalizedArgs.poll_interval_ms);
    const shouldIncludeTaskDispatch = Boolean(normalizedArgs.include_task_dispatch ?? (normalizedArgs.role === "worker"));
    const shouldIncludeAttentionItems = Boolean(normalizedArgs.include_attention_items ?? (normalizedArgs.role === "worker"));

    const startResponse = this.deps.connectionChatRepository.startListen({
      connectionKey: normalizedArgs.connection_key,
      displayName: normalizedArgs.display_name,
      role: normalizedArgs.role,
      projectId: normalizedArgs.project_id,
      projectIds: normalizedArgs.project_ids,
      activeProjectIds: normalizedArgs.active_project_ids,
      transport: normalizedArgs.transport,
      capabilities: normalizedArgs.capabilities,
      maxMessages: 1,
    });
    this.ensureWorkerProjectAssignments(startResponse.connection);

    const immediateInboxMessage = startResponse.inbox[0];
    if (immediateInboxMessage) {
      return this.wrapListenResponse({
        kind: "dashboard_message",
        message: {
          id: immediateInboxMessage.id,
          threadId: immediateInboxMessage.threadId,
          projectId: immediateInboxMessage.projectId,
          bodyMarkdown: immediateInboxMessage.bodyMarkdown,
        },
        continuation: {
          nextTool: "listen",
          instruction: "Reply in the dashboard thread with post_listen_reply, then call listen again with the same connection_key to stay in listening mode.",
        },
      });
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutSeconds * 1000) {
      const inbox = this.deps.connectionChatRepository.pullInbox({
        connectionKey: normalizedArgs.connection_key,
        projectId: normalizedArgs.project_id,
        maxMessages: 1,
      });
      const message = inbox[0];
      if (message) {
        return this.wrapListenResponse({
          kind: "dashboard_message",
          message: {
            id: message.id,
            threadId: message.threadId,
            projectId: message.projectId,
            bodyMarkdown: message.bodyMarkdown,
          },
          continuation: {
            nextTool: "listen",
            instruction: "Reply in the dashboard thread with post_listen_reply, then call listen again with the same connection_key to stay in listening mode.",
          },
        });
      }

      if (shouldIncludeAttentionItems && this.deps.workerListenEventService) {
        const workerEvent = this.deps.workerListenEventService.pullNextEvent({
          connectionKey: normalizedArgs.connection_key,
          projectId: normalizedArgs.project_id,
          includeAttentionItems: true,
        });
        if (workerEvent) {
          return this.wrapListenResponse(workerEvent);
        }
      }

      if (shouldIncludeTaskDispatch) {
        const claim = this.deps.workerTaskDispatchService.pullNextDispatch({
          connectionKey: normalizedArgs.connection_key,
          projectId: normalizedArgs.project_id,
        });
        if (claim) {
          return this.wrapListenResponse({
            kind: "task_dispatch",
            dispatch: claim,
            continuation: {
              nextTool: "listen",
              instruction: "Handle the claimed task dispatch, close it with update_task_dispatch, then call listen again with the same connection_key to stay available.",
            },
          });
        }
      }

      const remainingMs = timeoutSeconds * 1000 - (Date.now() - startTime);
      if (remainingMs <= 0) {
        break;
      }
      await sleep(Math.min(pollIntervalMs, remainingMs));
    }

    return this.wrapListenResponse({
      kind: "noop_timeout",
      continuation: {
        nextTool: "listen",
        instruction: "No new dashboard messages or task dispatches arrived before timeout. Call listen again immediately with the same connection_key if you should remain in listening mode.",
      },
    });
  }

  async handlePullInbox(args: PullInboxArgs) {
    const inbox = this.deps.connectionChatRepository.pullInbox({
      connectionKey: args.connection_key,
      projectId: args.project_id,
      maxMessages: args.max_messages,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ returnedCount: inbox.length, inbox }, null, 2),
      }],
    };
  }

  async handlePostListenReply(args: PostListenReplyArgs) {
    const message = this.deps.connectionChatRepository.postListenReply({
      connectionKey: args.connection_key,
      threadId: args.thread_id,
      bodyMarkdown: args.body_markdown,
      replyToMessageId: args.reply_to_message_id,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          threadId: message.threadId,
          deliveryStatus: message.deliveryStatus,
        }, null, 2),
      }],
    };
  }

  async handlePullTaskDispatch(args: PullTaskDispatchArgs) {
    const claim = this.deps.workerTaskDispatchService.pullNextDispatch({
      connectionKey: args.connection_key,
      projectId: args.project_id,
      sprintId: args.sprint_id,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify(claim ? { claimed: true, dispatch: claim } : { claimed: false, dispatch: null }, null, 2),
      }],
    };
  }

  async handleUpdateTaskDispatch(args: UpdateTaskDispatchArgs) {
    const result = this.deps.workerTaskDispatchService.updateDispatch({
      connectionKey: args.connection_key,
      dispatchId: args.dispatch_id,
      leaseToken: args.lease_token,
      state: args.state,
      provider: args.provider,
      sessionId: args.session_id,
      sessionName: args.session_name,
      workerBranch: args.worker_branch,
      prUrl: args.pr_url,
      summaryMarkdown: args.summary_markdown,
      errorMessage: args.error_message,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }

  async handleClaimAttentionItem(args: ClaimAttentionItemArgs) {
    const workerEndpointId = this.requireWorkerEndpointId(args.connection_key);
    const projectAttentionService = this.requireProjectAttentionService();
    const item = projectAttentionService.claimItem(
      args.attention_item_id,
      workerEndpointId,
      args.claim_reason,
    );

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          itemId: item.id,
          status: item.status,
          assignedWorkerEndpointId: item.assignedWorkerEndpointId,
          claimedAt: item.claimedAt,
        }, null, 2),
      }],
    };
  }

  async handleResolveAttentionItem(args: ResolveAttentionItemArgs) {
    const connection = this.deps.connectionChatRepository.getConnectionByKey(args.connection_key);
    if (!connection) {
      throw new Error(`Connection not found for key: ${args.connection_key}`);
    }

    const workerEndpointId = connection.role === "worker"
      ? this.requireWorkerEndpointId(args.connection_key)
      : null;
    const projectAttentionService = this.requireProjectAttentionService();
    const item = projectAttentionService.resolveItem(args.attention_item_id, {
      status: args.resolution_status || "resolved",
      reason: args.resolution_reason,
      resolutionSummaryMarkdown: args.resolution_summary_markdown,
      workerEndpointId,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          itemId: item.id,
          status: item.status,
          resolvedAt: item.resolvedAt,
        }, null, 2),
      }],
    };
  }

  async handleReportAttentionOutcome(args: ReportAttentionOutcomeArgs) {
    const connection = this.deps.connectionChatRepository.getConnectionByKey(args.connection_key);
    if (!connection) {
      throw new Error(`Connection not found for key: ${args.connection_key}`);
    }

    const workerEndpointId = this.requireWorkerEndpointId(args.connection_key);
    const workerAttentionOutcomeService = this.requireWorkerAttentionOutcomeService();
    const result = workerAttentionOutcomeService.reportOutcome({
      attentionItemId: args.attention_item_id,
      workerEndpointId,
      connectionId: connection.id,
      outcome: args.outcome,
      summaryMarkdown: args.summary_markdown,
      resolutionReason: args.resolution_reason,
      threadTitle: args.thread_title,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          itemId: result.sourceItem.id,
          status: result.sourceItem.status,
          outcome: args.outcome,
          handoffAttentionItemId: result.handoffItem?.id ?? null,
          threadId: result.threadId,
          threadMessageId: result.threadMessageId,
          resolvedAt: result.sourceItem.resolvedAt,
        }, null, 2),
      }],
    };
  }

  private normalizeListenTimeoutSeconds(
    requestedTimeoutSeconds: number | undefined,
    settings: DashboardSettings,
    role?: McpConnectionRole,
  ): number {
    const fallback = role === "worker"
      ? DEFAULT_WORKER_LISTEN_TIMEOUT_SECONDS
      : settings.sprintLoopSteps?.watchLoopOutputIntervalSeconds ?? 300;
    const candidate = requestedTimeoutSeconds ?? fallback;
    if (!Number.isFinite(candidate) || candidate <= 0) {
      return fallback;
    }
    return Math.max(MIN_LISTEN_TIMEOUT_SECONDS, Math.min(MAX_LISTEN_TIMEOUT_SECONDS, candidate));
  }

  private normalizeListenPollIntervalMs(requestedPollIntervalMs: number | undefined): number {
    const candidate = requestedPollIntervalMs ?? DEFAULT_LISTEN_POLL_INTERVAL_MS;
    if (!Number.isFinite(candidate) || candidate <= 0) {
      return DEFAULT_LISTEN_POLL_INTERVAL_MS;
    }
    return Math.max(MIN_LISTEN_POLL_INTERVAL_MS, Math.min(MAX_LISTEN_POLL_INTERVAL_MS, candidate));
  }

  private wrapListenResponse(response: ListenResponse) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2),
      }],
    };
  }

  private ensureWorkerProjectAssignments(connection: {
    id: string;
    role?: string;
    projectIds?: string[];
    activeProjectIds?: string[];
  }): void {
    if (connection.role !== "worker") {
      return;
    }
    if (!this.deps.projectWorkerAssignmentService || !this.deps.workerEndpointRepository) {
      return;
    }

    const workerEndpoint = this.deps.workerEndpointRepository.getWorkerEndpointByConnectionId(connection.id);
    if (!workerEndpoint?.id) {
      return;
    }

    const projectIds = (
      Array.isArray(connection.activeProjectIds) && connection.activeProjectIds.length > 0
        ? connection.activeProjectIds
        : connection.projectIds
    ) || [];

    for (const projectId of projectIds.map((value) => String(value || "").trim()).filter(Boolean)) {
      if (this.deps.resolveWorkerExecutionMode?.(projectId) === "VIRTUAL") {
        continue;
      }
      this.deps.projectWorkerAssignmentService.ensureWorkerAssignment(projectId, workerEndpoint.id);
    }
  }

  private requireWorkerEndpointId(connectionKey: string): string {
    const connection = this.deps.connectionChatRepository.getConnectionByKey(connectionKey);
    if (!connection) {
      throw new Error(`Connection not found for key: ${connectionKey}`);
    }
    const workerEndpoint = this.deps.workerEndpointRepository?.getWorkerEndpointByConnectionId(connection.id);
    if (!workerEndpoint) {
      throw new Error(`Worker endpoint not found for connection ${connectionKey}`);
    }
    return workerEndpoint.id;
  }

  private requireProjectAttentionService(): ProjectAttentionService {
    if (!this.deps.projectAttentionService) {
      throw new Error("Project attention service is not available.");
    }
    return this.deps.projectAttentionService;
  }

  private requireWorkerAttentionOutcomeService(): WorkerAttentionOutcomeService {
    if (!this.deps.workerAttentionOutcomeService) {
      throw new Error("Worker attention outcome service is not available.");
    }
    return this.deps.workerAttentionOutcomeService;
  }
}
