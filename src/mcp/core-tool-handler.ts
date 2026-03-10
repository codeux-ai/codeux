import { waitUntil } from "../shared/polling/wait-until.js";
import type {
  CreateSessionArgs,
  ListenArgs,
  PostListenReplyArgs,
  PullTaskDispatchArgs,
  PullInboxArgs,
  StartListenArgs,
  UpdateTaskDispatchArgs,
} from "../api/mcp/tool-registry.js";
import type { JulesApiClient, JulesCreateSessionRequest } from "../integrations/jules-api-client.js";
import type { DashboardSettings, JulesActivity, JulesSession, JulesSource } from "../contracts/app-types.js";
import type { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import type { ListenResponse } from "../contracts/connection-chat-types.js";
import type { WorkerTaskDispatchService } from "../services/worker-task-dispatch-service.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ActivitySummaryService } from "../domain/sessions/activity-summary.js";

interface CoreToolHandlerDependencies {
  julesApi: JulesApiClient;
  activitySummary: ActivitySummaryService;
  normalizeName: (type: string, id: string) => string;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>;
  isActionRequiredState: (state?: string) => boolean;
  getConsecutiveFailures: () => number;
  setConsecutiveFailures: (value: number) => void;
  getMaxFailures: () => number;
  isJulesApiConfigured: () => boolean;
  getMissingJulesApiKeyInstruction: () => string;
  isTrackedCliSession: (sessionId: string) => boolean;
  getTrackedSession: (sessionId: string) => JulesSession | null;
  listTrackedSessions: (limit?: number) => { sessions: JulesSession[] };
  listTrackedActivities: (args: { session_id: string; page_size?: number; page_token?: string }) => { activities: JulesActivity[]; nextPageToken?: string };
  listAllTrackedActivities: (sessionId: string) => JulesActivity[];
  getDashboardSettings: () => DashboardSettings;
  connectionChatRepository: ConnectionChatRepository;
  workerTaskDispatchService: WorkerTaskDispatchService;
  logger?: Logger;
}

const DEFAULT_LISTEN_POLL_INTERVAL_MS = 1000;
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

  async handleGetSource({ source_id }: { source_id: string }) {
    this.ensureJulesApiConfigured();
    const source = await this.deps.julesApi.getSource(source_id);
    return { content: [{ type: "text", text: JSON.stringify(this.deps.activitySummary.toSingleSourceSummary(source, source_id), null, 2) }] };
  }

  async handleListSources({ filter, page_size, page_token }: { filter?: string; page_size?: number; page_token?: string }) {
    this.ensureJulesApiConfigured();
    const response = await this.deps.julesApi.listSources({ filter, page_size, page_token });
    const { sources, nextPageToken } = this.deps.activitySummary.extractSourceListResponse(response);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(this.deps.activitySummary.toSourcePageSummary({
          sources,
          nextPageToken,
          pageSize: page_size,
          pageToken: page_token,
          filter,
        }), null, 2)
      }]
    };
  }

  async handleListAllSources({ filter }: { filter?: string }) {
    this.ensureJulesApiConfigured();
    const allSources = await this.deps.julesApi.listAllSources(filter);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          returnedCount: allSources.length,
          filter: filter ?? null,
          sources: allSources.map((source) => this.deps.activitySummary.toSourceSummary(source)),
        }, null, 2)
      }]
    };
  }

  async handleCreateSession(args: CreateSessionArgs) {
    this.ensureJulesApiConfigured();
    const maxFails = this.deps.getMaxFailures();
    if (this.deps.getConsecutiveFailures() >= maxFails) {
      throw new Error(
        `CRITICAL: Emergency stop active. ${this.deps.getConsecutiveFailures()} consecutive task creation failures detected.`
      );
    }

    const data: JulesCreateSessionRequest = {
      prompt: args.prompt,
      sourceContext: { source: this.deps.normalizeName("sources", args.source) },
    };
    if (args.starting_branch) data.sourceContext.githubRepoContext = { startingBranch: args.starting_branch };
    if (args.title) data.title = args.title;
    if (args.require_plan_approval !== undefined) data.requirePlanApproval = args.require_plan_approval;
    if (args.automation_mode) data.automationMode = args.automation_mode;

    try {
      const response = await this.deps.julesApi.createSession(data);
      this.deps.setConsecutiveFailures(0);
      return { content: [{ type: "text", text: JSON.stringify(this.deps.activitySummary.toSessionSummary(response), null, 2) }] };
    } catch (error: unknown) {
      this.deps.setConsecutiveFailures(this.deps.getConsecutiveFailures() + 1);
      throw error;
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

  async handleListSessions({ page_size, page_token }: { page_size?: number; page_token?: string }) {
    const trackedSessions = this.deps.listTrackedSessions(page_size || 100).sessions;
    if (!this.deps.isJulesApiConfigured()) {
      const compactTracked = trackedSessions.map((session) => this.deps.activitySummary.toSessionSummary(session));
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            returnedCount: compactTracked.length,
            pageSize: page_size ?? null,
            pageToken: page_token ?? null,
            nextPageToken: null,
            sessions: compactTracked,
          }, null, 2)
        }]
      };
    }

    this.ensureJulesApiConfigured();
    const sessions = await this.deps.julesApi.listSessions({ page_size, page_token });
    const merged = [...trackedSessions, ...(sessions.sessions || [])];
    const compactSessions = merged.map((session) => this.deps.activitySummary.toSessionSummary(session));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          returnedCount: compactSessions.length,
          pageSize: page_size ?? null,
          pageToken: page_token ?? null,
          nextPageToken: sessions.nextPageToken ?? null,
          sessions: compactSessions,
        }, null, 2)
      }]
    };
  }

  async handleApproveSessionPlan({ session_id }: { session_id: string }) {
    this.ensureJulesApiConfigured();
    const response = await this.deps.julesApi.approveSessionPlan(session_id);
    return { content: [{ type: "text", text: JSON.stringify(this.deps.activitySummary.toActionResponseSummary(response, "approve_session_plan"), null, 2) }] };
  }

  async handleSendSessionMessage({ session_id, prompt }: { session_id: string; prompt: string }) {
    this.ensureJulesApiConfigured();
    const response = await this.deps.julesApi.sendSessionMessage(session_id, prompt);
    return { content: [{ type: "text", text: JSON.stringify(this.deps.activitySummary.toActionResponseSummary(response, "send_session_message"), null, 2) }] };
  }

  async handleWaitForSessionCompletion({
    session_id,
    poll_interval = 10,
    timeout = 900,
  }: {
    session_id: string;
    poll_interval?: number;
    timeout?: number;
  }) {
    const isTracked = this.deps.isTrackedCliSession(session_id);
    if (!isTracked) {
      this.ensureJulesApiConfigured();
    }

    try {
      const session = await waitUntil({
        description: `session ${session_id}`,
        intervalMs: poll_interval * 1000,
        timeoutMs: timeout * 1000,
        action: async () => {
          if (isTracked) {
            const s = this.deps.getTrackedSession(session_id);
            if (!s) {
              throw new Error(`Session not found: ${session_id}`);
            }
            return s;
          }
          return await this.deps.julesApi.getSession(session_id);
        },
        predicate: (session) => {
          return (
            session.state === "COMPLETED" ||
            session.state === "FAILED" ||
            this.deps.isActionRequiredState(session.state) ||
            !!session.outputs?.some((output: unknown) => (output as { pullRequest?: unknown })?.pullRequest)
          );
        },
      });

      return { content: [{ type: "text", text: JSON.stringify(this.deps.activitySummary.toSessionSummary(session), null, 2) }] };
    } catch (error: unknown) {
      if (error instanceof Error && error.message?.includes("Timeout waiting for")) {
        throw new Error(`Timeout waiting for session ${session_id}`);
      }
      throw error;
    }
  }

  async handleGetActivity({ session_id, activity_id }: { session_id: string; activity_id: string }) {
    if (this.deps.isTrackedCliSession(session_id)) {
      const activity = this.deps.listAllTrackedActivities(session_id).find((entry) => {
        const id = entry.id.replace(/^activities\//, "");
        return id === activity_id || id.endsWith(`/${activity_id}`);
      });
      if (!activity) {
        throw new Error(`Activity not found: ${activity_id}`);
      }
      return { content: [{ type: "text", text: JSON.stringify(this.deps.activitySummary.toActivitySummary(activity), null, 2) }] };
    }

    this.ensureJulesApiConfigured();
    const activity = await this.deps.julesApi.getActivity(session_id, activity_id);
    return { content: [{ type: "text", text: JSON.stringify(this.deps.activitySummary.toActivitySummary(activity as JulesActivity), null, 2) }] };
  }

  async handleListActivities({ session_id, page_size, page_token }: { session_id: string; page_size?: number; page_token?: string }) {
    if (this.deps.isTrackedCliSession(session_id)) {
      const activities = this.deps.listTrackedActivities({ session_id, page_size, page_token });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(this.deps.activitySummary.toActivityPageSummary({
            sessionId: session_id,
            activities: activities.activities || [],
            nextPageToken: activities.nextPageToken,
            pageSize: page_size,
            pageToken: page_token,
          }), null, 2)
        }]
      };
    }

    this.ensureJulesApiConfigured();
    const activities = await this.deps.julesApi.listActivities({ session_id, page_size, page_token });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(this.deps.activitySummary.toActivityPageSummary({
          sessionId: session_id,
          activities: activities.activities || [],
          nextPageToken: activities.nextPageToken,
          pageSize: page_size,
          pageToken: page_token,
        }), null, 2)
      }]
    };
  }

  async handleListAllActivities({ session_id }: { session_id: string }) {
    if (this.deps.isTrackedCliSession(session_id)) {
      const allActivities = this.deps.listAllTrackedActivities(session_id);
      return { content: [{ type: "text", text: JSON.stringify(this.deps.activitySummary.toActivityCollectionSummary(session_id, allActivities), null, 2) }] };
    }

    this.ensureJulesApiConfigured();
    const allActivities = await this.deps.julesApi.listAllActivities(session_id);
    return { content: [{ type: "text", text: JSON.stringify(this.deps.activitySummary.toActivityCollectionSummary(session_id, allActivities), null, 2) }] };
  }

  async handleStartListen(args: StartListenArgs) {
    const response = this.deps.connectionChatRepository.startListen({
      connectionKey: args.connection_key,
      displayName: args.display_name,
      role: args.role,
      projectId: args.project_id,
      transport: args.transport,
      capabilities: args.capabilities,
      maxMessages: args.max_messages,
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2),
      }],
    };
  }

  async handleListen(args: ListenArgs) {
    const settings = this.deps.getDashboardSettings();
    const timeoutSeconds = this.normalizeListenTimeoutSeconds(args.timeout_seconds, settings);
    const pollIntervalMs = this.normalizeListenPollIntervalMs(args.poll_interval_ms);
    const shouldIncludeTaskDispatch = Boolean(args.include_task_dispatch ?? (args.role === "worker"));

    const startResponse = this.deps.connectionChatRepository.startListen({
      connectionKey: args.connection_key,
      displayName: args.display_name,
      role: args.role,
      projectId: args.project_id,
      transport: args.transport,
      capabilities: args.capabilities,
      maxMessages: 1,
    });

    const immediateInboxMessage = startResponse.inbox[0];
    if (immediateInboxMessage) {
      return this.wrapListenResponse({
        kind: "dashboard_message",
        connection: startResponse.connection,
        timeoutSeconds,
        pollIntervalMs,
        message: immediateInboxMessage,
        continuation: {
          nextTool: "listen",
          connectionKey: startResponse.connection.connectionKey,
          instruction: "Reply in the dashboard thread with post_listen_reply, then call listen again with the same connection_key to stay in listening mode.",
        },
      });
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutSeconds * 1000) {
      const inbox = this.deps.connectionChatRepository.pullInbox({
        connectionKey: args.connection_key,
        projectId: args.project_id,
        maxMessages: 1,
      });
      const message = inbox[0];
      if (message) {
        return this.wrapListenResponse({
          kind: "dashboard_message",
          connection: this.requireConnectionForListen(args.connection_key),
          timeoutSeconds,
          pollIntervalMs,
          message,
          continuation: {
            nextTool: "listen",
            connectionKey: args.connection_key,
            instruction: "Reply in the dashboard thread with post_listen_reply, then call listen again with the same connection_key to stay in listening mode.",
          },
        });
      }

      if (shouldIncludeTaskDispatch) {
        const claim = this.deps.workerTaskDispatchService.pullNextDispatch({
          connectionKey: args.connection_key,
          projectId: args.project_id,
        });
        if (claim) {
          return this.wrapListenResponse({
            kind: "task_dispatch",
            connection: this.requireConnectionForListen(args.connection_key),
            timeoutSeconds,
            pollIntervalMs,
            dispatch: claim,
            continuation: {
              nextTool: "listen",
              connectionKey: args.connection_key,
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

    const connection = this.requireConnectionForListen(args.connection_key);
    return this.wrapListenResponse({
      kind: "noop_timeout",
      connection,
      timeoutSeconds,
      pollIntervalMs,
      continuation: {
        nextTool: "listen",
        connectionKey: connection.connectionKey,
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
        text: JSON.stringify(message, null, 2),
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

  private normalizeListenTimeoutSeconds(
    requestedTimeoutSeconds: number | undefined,
    settings: DashboardSettings,
  ): number {
    const fallback = settings.sprintLoopSteps?.watchLoopOutputIntervalSeconds ?? 300;
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

  private requireConnectionForListen(connectionKey: string) {
    const connection = this.deps.connectionChatRepository.getConnectionByKey(connectionKey);
    if (!connection) {
      throw new Error(`Connection not found for key: ${connectionKey}`);
    }
    return connection;
  }

  private wrapListenResponse(response: ListenResponse) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify(response, null, 2),
      }],
    };
  }
}
