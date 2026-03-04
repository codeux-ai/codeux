import type { JulesApiClient } from "../integrations/jules-api-client.js";
import type { JulesActivity, JulesSession, JulesSource } from "../contracts/app-types.js";
import { createNoopLogger, type Logger } from "../shared/logging/logger.js";

interface CoreToolHandlerDependencies {
  julesApi: JulesApiClient;
  logger?: Logger;
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
}

export class CoreToolHandler {
  private static readonly ACTIVITY_PREVIEW_CHAR_LIMIT = 180;
  private static readonly ACTIVITY_RECENT_LIMIT = 10;
  private readonly logger: Logger;

  constructor(private readonly deps: CoreToolHandlerDependencies) {
    this.logger = deps.logger ?? createNoopLogger();
  }

  private ensureJulesApiConfigured(): void {
    if (!this.deps.isJulesApiConfigured()) {
      throw new Error(this.deps.getMissingJulesApiKeyInstruction());
    }
  }

  private truncate(text: string | undefined, maxLength: number): string | undefined {
    if (!text) return undefined;
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1)}…`;
  }

  private getActivityKind(activity: JulesActivity): string {
    if (activity.sessionCompleted) return "session_completed";
    if (activity.sessionFailed) return "session_failed";
    if (activity.planApproved) return "plan_approved";
    if (activity.planGenerated) return "plan_generated";
    if (activity.progressUpdated) return "progress_updated";
    if (activity.agentMessaged) return "agent_message";
    if (activity.userMessaged) return "user_message";
    return "activity";
  }

  private getActivityPreview(activity: JulesActivity): string | undefined {
    const progress = activity.progressUpdated;
    if (progress?.title || progress?.description) {
      return this.truncate(
        [progress.title, progress.description].filter((value) => typeof value === "string" && value.length > 0).join(" - "),
        CoreToolHandler.ACTIVITY_PREVIEW_CHAR_LIMIT
      );
    }

    const agentMessage = activity.agentMessaged?.agentMessage;
    if (typeof agentMessage === "string" && agentMessage.trim().length > 0) {
      return this.truncate(agentMessage.trim(), CoreToolHandler.ACTIVITY_PREVIEW_CHAR_LIMIT);
    }

    const userMessage = activity.userMessaged?.userMessage;
    if (typeof userMessage === "string" && userMessage.trim().length > 0) {
      return this.truncate(userMessage.trim(), CoreToolHandler.ACTIVITY_PREVIEW_CHAR_LIMIT);
    }

    if (typeof activity.description === "string" && activity.description.trim().length > 0) {
      return this.truncate(activity.description.trim(), CoreToolHandler.ACTIVITY_PREVIEW_CHAR_LIMIT);
    }

    return undefined;
  }

  private toActivitySummary(activity: JulesActivity): Record<string, unknown> {
    const summary: Record<string, unknown> = {
      id: activity.id,
      name: activity.name,
      createTime: activity.createTime,
      originator: activity.originator ?? "system",
      kind: this.getActivityKind(activity),
    };

    const preview = this.getActivityPreview(activity);
    if (preview) {
      summary.preview = preview;
    }

    return summary;
  }

  private toSessionSummary(session: JulesSession, lastActivity?: JulesActivity): Record<string, unknown> {
    const pullRequests = (session.outputs || [])
      .map((output: any) => output?.pullRequest)
      .filter((pullRequest: unknown): pullRequest is Record<string, unknown> => !!pullRequest)
      .map((pullRequest) => ({
        url: typeof pullRequest.url === "string" ? pullRequest.url : undefined,
      }))
      .filter((pullRequest) => typeof pullRequest.url === "string");

    const summary: Record<string, unknown> = {
      id: session.id,
      name: session.name,
      title: session.title,
      state: session.state,
      provider: session.provider,
      createTime: session.createTime,
      hasPullRequest: pullRequests.length > 0,
      pullRequests,
    };

    if (lastActivity) {
      summary.lastActivity = this.toActivitySummary(lastActivity);
    }

    return summary;
  }

  private toActivityCollectionSummary(sessionId: string, activities: JulesActivity[]): Record<string, unknown> {
    const activityTypeCounts = activities.reduce<Record<string, number>>((counts, activity) => {
      const kind = this.getActivityKind(activity);
      counts[kind] = (counts[kind] || 0) + 1;
      return counts;
    }, {});

    const recentActivities = activities
      .slice(-CoreToolHandler.ACTIVITY_RECENT_LIMIT)
      .map((activity) => this.toActivitySummary(activity));

    return {
      sessionId: sessionId.replace(/^sessions\//, ""),
      totalActivities: activities.length,
      firstActivityTime: activities[0]?.createTime ?? null,
      lastActivityTime: activities[activities.length - 1]?.createTime ?? null,
      activityTypeCounts,
      recentActivities,
    };
  }

  private toActivityPageSummary(args: {
    sessionId: string;
    activities: JulesActivity[];
    nextPageToken?: string;
    pageSize?: number;
    pageToken?: string;
  }): Record<string, unknown> {
    const activityTypeCounts = args.activities.reduce<Record<string, number>>((counts, activity) => {
      const kind = this.getActivityKind(activity);
      counts[kind] = (counts[kind] || 0) + 1;
      return counts;
    }, {});

    return {
      sessionId: args.sessionId.replace(/^sessions\//, ""),
      returnedCount: args.activities.length,
      pageSize: args.pageSize ?? null,
      pageToken: args.pageToken ?? null,
      nextPageToken: args.nextPageToken ?? null,
      activityTypeCounts,
      activities: args.activities.map((activity) => this.toActivitySummary(activity)),
    };
  }

  private toSourceSummary(source: JulesSource): Record<string, unknown> {
    return {
      id: source.id,
      name: source.name,
    };
  }

  private toSingleSourceSummary(payload: unknown, sourceIdFallback: string): Record<string, unknown> {
    if (!payload || typeof payload !== "object") {
      const normalizedId = sourceIdFallback.startsWith("sources/") ? sourceIdFallback : `sources/${sourceIdFallback}`;
      return { id: normalizedId, name: normalizedId };
    }
    const record = payload as Partial<JulesSource>;
    const id = typeof record.id === "string"
      ? record.id
      : (typeof record.name === "string" && record.name.startsWith("sources/")
        ? record.name
        : (sourceIdFallback.startsWith("sources/") ? sourceIdFallback : `sources/${sourceIdFallback}`));
    const name = typeof record.name === "string" ? record.name : id;
    return this.toSourceSummary({ id, name });
  }

  private toSourcePageSummary(args: {
    sources: JulesSource[];
    nextPageToken?: string;
    pageSize?: number;
    pageToken?: string;
    filter?: string;
  }): Record<string, unknown> {
    return {
      returnedCount: args.sources.length,
      filter: args.filter ?? null,
      pageSize: args.pageSize ?? null,
      pageToken: args.pageToken ?? null,
      nextPageToken: args.nextPageToken ?? null,
      sources: args.sources.map((source) => this.toSourceSummary(source)),
    };
  }

  private extractSourceListResponse(payload: unknown): { sources: JulesSource[]; nextPageToken?: string } {
    if (!payload || typeof payload !== "object") {
      return { sources: [] };
    }
    const record = payload as { sources?: unknown; nextPageToken?: unknown };
    const sources = Array.isArray(record.sources) ? (record.sources as JulesSource[]) : [];
    const nextPageToken = typeof record.nextPageToken === "string" ? record.nextPageToken : undefined;
    return { sources, nextPageToken };
  }

  private toActionResponseSummary(payload: unknown, action: string): Record<string, unknown> {
    const summary: Record<string, unknown> = { action };
    if (!payload || typeof payload !== "object") {
      return summary;
    }
    const record = payload as Record<string, unknown>;
    const copyIfPresent = (from: string, to: string = from): void => {
      if (record[from] !== undefined) {
        summary[to] = record[from];
      }
    };
    copyIfPresent("id");
    copyIfPresent("name");
    copyIfPresent("state");
    copyIfPresent("title");
    copyIfPresent("createTime");
    copyIfPresent("updateTime");
    copyIfPresent("done");
    copyIfPresent("message");
    return summary;
  }

  async handleGetSource({ source_id }: { source_id: string }) {
    this.ensureJulesApiConfigured();
    const source = await this.deps.julesApi.getSource(source_id);
    return { content: [{ type: "text", text: JSON.stringify(this.toSingleSourceSummary(source, source_id), null, 2) }] };
  }

  async handleListSources({ filter, page_size, page_token }: { filter?: string; page_size?: number; page_token?: string }) {
    this.ensureJulesApiConfigured();
    const response = await this.deps.julesApi.listSources({ filter, page_size, page_token });
    const { sources, nextPageToken } = this.extractSourceListResponse(response);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(this.toSourcePageSummary({
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
          sources: allSources.map((source) => this.toSourceSummary(source)),
        }, null, 2)
      }]
    };
  }

  async handleCreateSession(args: any) {
    this.ensureJulesApiConfigured();
    const maxFails = this.deps.getMaxFailures();
    if (this.deps.getConsecutiveFailures() >= maxFails) {
      throw new Error(
        `CRITICAL: Emergency stop active. ${this.deps.getConsecutiveFailures()} consecutive task creation failures detected.`
      );
    }

    const data: any = {
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
      return { content: [{ type: "text", text: JSON.stringify(this.toSessionSummary(response), null, 2) }] };
    } catch (error: any) {
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
      return { content: [{ type: "text", text: JSON.stringify(this.toSessionSummary(session), null, 2) }] };
    }

    this.ensureJulesApiConfigured();
    const session = await this.deps.julesApi.getSession(session_id);
    let lastActivity: JulesActivity | undefined;

    try {
      const sessionName = this.deps.resolveSessionName(session) || this.deps.normalizeName("sessions", session_id);
      const activities = await this.deps.fetchRecentActivities(sessionName, CoreToolHandler.ACTIVITY_RECENT_LIMIT);
      if (activities.length > 0) {
        lastActivity = activities[activities.length - 1];
      }
    } catch (error) {
      this.logger.warn("Could not fetch recent activities for session", {
        sessionId: session_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { content: [{ type: "text", text: JSON.stringify(this.toSessionSummary(session, lastActivity), null, 2) }] };
  }

  async handleListSessions({ page_size, page_token }: { page_size?: number; page_token?: string }) {
    const trackedSessions = this.deps.listTrackedSessions(page_size || 100).sessions;
    if (!this.deps.isJulesApiConfigured()) {
      const compactTracked = trackedSessions.map((session) => this.toSessionSummary(session));
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
    const compactSessions = merged.map((session) => this.toSessionSummary(session));
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
    return { content: [{ type: "text", text: JSON.stringify(this.toActionResponseSummary(response, "approve_session_plan"), null, 2) }] };
  }

  async handleSendSessionMessage({ session_id, prompt }: { session_id: string; prompt: string }) {
    this.ensureJulesApiConfigured();
    const response = await this.deps.julesApi.sendSessionMessage(session_id, prompt);
    return { content: [{ type: "text", text: JSON.stringify(this.toActionResponseSummary(response, "send_session_message"), null, 2) }] };
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
    if (this.deps.isTrackedCliSession(session_id)) {
      const startTime = Date.now();
      while (Date.now() - startTime < timeout * 1000) {
        const session = this.deps.getTrackedSession(session_id);
        if (!session) {
          throw new Error(`Session not found: ${session_id}`);
        }
        if (
          session.state === "COMPLETED" ||
          session.state === "FAILED" ||
          this.deps.isActionRequiredState(session.state) ||
          session.outputs?.some((output: any) => output.pullRequest)
        ) {
          return { content: [{ type: "text", text: JSON.stringify(this.toSessionSummary(session), null, 2) }] };
        }
        await new Promise((resolve) => setTimeout(resolve, poll_interval * 1000));
      }
      throw new Error(`Timeout waiting for session ${session_id}`);
    }

    this.ensureJulesApiConfigured();
    const startTime = Date.now();
    while (Date.now() - startTime < timeout * 1000) {
      const session = await this.deps.julesApi.getSession(session_id);
      if (
        session.state === "COMPLETED" ||
        session.state === "FAILED" ||
        this.deps.isActionRequiredState(session.state) ||
        session.outputs?.some((output: any) => output.pullRequest)
      ) {
        return { content: [{ type: "text", text: JSON.stringify(this.toSessionSummary(session), null, 2) }] };
      }
      await new Promise((resolve) => setTimeout(resolve, poll_interval * 1000));
    }
    throw new Error(`Timeout waiting for session ${session_id}`);
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
      return { content: [{ type: "text", text: JSON.stringify(this.toActivitySummary(activity), null, 2) }] };
    }

    this.ensureJulesApiConfigured();
    const activity = await this.deps.julesApi.getActivity(session_id, activity_id);
    return { content: [{ type: "text", text: JSON.stringify(this.toActivitySummary(activity as JulesActivity), null, 2) }] };
  }

  async handleListActivities({ session_id, page_size, page_token }: { session_id: string; page_size?: number; page_token?: string }) {
    if (this.deps.isTrackedCliSession(session_id)) {
      const activities = this.deps.listTrackedActivities({ session_id, page_size, page_token });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(this.toActivityPageSummary({
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
        text: JSON.stringify(this.toActivityPageSummary({
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
      return { content: [{ type: "text", text: JSON.stringify(this.toActivityCollectionSummary(session_id, allActivities), null, 2) }] };
    }

    this.ensureJulesApiConfigured();
    const allActivities = await this.deps.julesApi.listAllActivities(session_id);
    return { content: [{ type: "text", text: JSON.stringify(this.toActivityCollectionSummary(session_id, allActivities), null, 2) }] };
  }
}
