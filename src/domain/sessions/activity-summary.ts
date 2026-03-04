import type { JulesActivity, JulesSession, JulesSource } from "../../contracts/app-types.js";

export class ActivitySummaryService {
  private static readonly ACTIVITY_PREVIEW_CHAR_LIMIT = 180;
  private static readonly ACTIVITY_RECENT_LIMIT = 10;

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
        ActivitySummaryService.ACTIVITY_PREVIEW_CHAR_LIMIT
      );
    }

    const agentMessage = activity.agentMessaged?.agentMessage;
    if (typeof agentMessage === "string" && agentMessage.trim().length > 0) {
      return this.truncate(agentMessage.trim(), ActivitySummaryService.ACTIVITY_PREVIEW_CHAR_LIMIT);
    }

    const userMessage = activity.userMessaged?.userMessage;
    if (typeof userMessage === "string" && userMessage.trim().length > 0) {
      return this.truncate(userMessage.trim(), ActivitySummaryService.ACTIVITY_PREVIEW_CHAR_LIMIT);
    }

    if (typeof activity.description === "string" && activity.description.trim().length > 0) {
      return this.truncate(activity.description.trim(), ActivitySummaryService.ACTIVITY_PREVIEW_CHAR_LIMIT);
    }

    return undefined;
  }

  public toActivitySummary(activity: JulesActivity): Record<string, unknown> {
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

  public toSessionSummary(session: JulesSession, lastActivity?: JulesActivity): Record<string, unknown> {
    const pullRequests = (session.outputs || [])
      .map((output: any) => output?.pullRequest)
      .filter((pullRequest: unknown): pullRequest is Record<string, unknown> => !!pullRequest)
      .map((pullRequest) => ({
        url: typeof pullRequest.url === "string" ? pullRequest.url : undefined,
        workerBranch: typeof pullRequest.workerBranch === "string" ? pullRequest.workerBranch : undefined,
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

  public toActivityCollectionSummary(sessionId: string, activities: JulesActivity[]): Record<string, unknown> {
    const activityTypeCounts = activities.reduce<Record<string, number>>((counts, activity) => {
      const kind = this.getActivityKind(activity);
      counts[kind] = (counts[kind] || 0) + 1;
      return counts;
    }, {});

    const recentActivities = activities
      .slice(-ActivitySummaryService.ACTIVITY_RECENT_LIMIT)
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

  public toActivityPageSummary(args: {
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

  public toSourceSummary(source: JulesSource): Record<string, unknown> {
    return {
      id: source.id,
      name: source.name,
    };
  }

  public toSingleSourceSummary(payload: unknown, sourceIdFallback: string): Record<string, unknown> {
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

  public toSourcePageSummary(args: {
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

  public extractSourceListResponse(payload: unknown): { sources: JulesSource[]; nextPageToken?: string } {
    if (!payload || typeof payload !== "object") {
      return { sources: [] };
    }
    const record = payload as { sources?: unknown; nextPageToken?: unknown };
    const sources = Array.isArray(record.sources) ? (record.sources as JulesSource[]) : [];
    const nextPageToken = typeof record.nextPageToken === "string" ? record.nextPageToken : undefined;
    return { sources, nextPageToken };
  }

  public toActionResponseSummary(payload: unknown, action: string): Record<string, unknown> {
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

  public getActivityRecentLimit(): number {
    return ActivitySummaryService.ACTIVITY_RECENT_LIMIT;
  }
}
