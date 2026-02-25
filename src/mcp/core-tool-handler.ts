import type { JulesApiClient } from "../jules-api.js";
import type { JulesActivity, JulesSession } from "../types.js";

interface CoreToolHandlerDependencies {
  julesApi: JulesApiClient;
  normalizeName: (type: string, id: string) => string;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>;
  isActionRequiredState: (state?: string) => boolean;
  getConsecutiveFailures: () => number;
  setConsecutiveFailures: (value: number) => void;
  getMaxFailures: () => number;
}

export class CoreToolHandler {
  constructor(private readonly deps: CoreToolHandlerDependencies) {}

  async handleGetSource({ source_id }: { source_id: string }) {
    const source = await this.deps.julesApi.getSource(source_id);
    return { content: [{ type: "text", text: JSON.stringify(source, null, 2) }] };
  }

  async handleListSources({ filter, page_size, page_token }: { filter?: string; page_size?: number; page_token?: string }) {
    const sources = await this.deps.julesApi.listSources({ filter, page_size, page_token });
    return { content: [{ type: "text", text: JSON.stringify(sources, null, 2) }] };
  }

  async handleListAllSources({ filter }: { filter?: string }) {
    const allSources = await this.deps.julesApi.listAllSources(filter);
    return { content: [{ type: "text", text: JSON.stringify({ sources: allSources }, null, 2) }] };
  }

  async handleCreateSession(args: any) {
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
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    } catch (error: any) {
      this.deps.setConsecutiveFailures(this.deps.getConsecutiveFailures() + 1);
      throw error;
    }
  }

  async handleGetSession({ session_id }: { session_id: string }) {
    const session = await this.deps.julesApi.getSession(session_id);

    try {
      const sessionName = this.deps.resolveSessionName(session) || this.deps.normalizeName("sessions", session_id);
      const activities = await this.deps.fetchRecentActivities(sessionName, 50);
      if (activities.length > 0) {
        (session as any).last_activity = activities[activities.length - 1];
      }
    } catch {
      console.error(`Warning: Could not fetch activities for session ${session_id}`);
    }

    return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
  }

  async handleListSessions({ page_size, page_token }: { page_size?: number; page_token?: string }) {
    const sessions = await this.deps.julesApi.listSessions({ page_size, page_token });
    return { content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }] };
  }

  async handleApproveSessionPlan({ session_id }: { session_id: string }) {
    const response = await this.deps.julesApi.approveSessionPlan(session_id);
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  }

  async handleSendSessionMessage({ session_id, prompt }: { session_id: string; prompt: string }) {
    const response = await this.deps.julesApi.sendSessionMessage(session_id, prompt);
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
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
    const startTime = Date.now();
    while (Date.now() - startTime < timeout * 1000) {
      const session = await this.deps.julesApi.getSession(session_id);
      if (
        session.state === "COMPLETED" ||
        session.state === "FAILED" ||
        this.deps.isActionRequiredState(session.state) ||
        session.outputs?.some((output: any) => output.pullRequest)
      ) {
        return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
      }
      await new Promise((resolve) => setTimeout(resolve, poll_interval * 1000));
    }
    throw new Error(`Timeout waiting for session ${session_id}`);
  }

  async handleGetActivity({ session_id, activity_id }: { session_id: string; activity_id: string }) {
    const activity = await this.deps.julesApi.getActivity(session_id, activity_id);
    return { content: [{ type: "text", text: JSON.stringify(activity, null, 2) }] };
  }

  async handleListActivities({ session_id, page_size, page_token }: { session_id: string; page_size?: number; page_token?: string }) {
    const activities = await this.deps.julesApi.listActivities({ session_id, page_size, page_token });
    return { content: [{ type: "text", text: JSON.stringify(activities, null, 2) }] };
  }

  async handleListAllActivities({ session_id }: { session_id: string }) {
    const allActivities = await this.deps.julesApi.listAllActivities(session_id);
    return { content: [{ type: "text", text: JSON.stringify({ activities: allActivities }, null, 2) }] };
  }
}
