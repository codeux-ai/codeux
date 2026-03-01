import type { TaskService } from "../services/task-service.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import type { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import type { SprintAgentArgs } from "../sprint/sprint-types.js";

interface AgentToolHandlerDependencies {
  sprintOrchestrator: SprintOrchestrator;
  taskService: TaskService;
  getDashboardSettings: () => DashboardSettings;
  formatSprintBranch: (scheme: string | undefined, sprintNumber: number) => string;
  getConsecutiveFailures: () => number;
  setConsecutiveFailures: (value: number) => void;
  getMaxFailures: () => number;
  waitForSessionCompletion: (args: { session_id: string; poll_interval?: number; timeout?: number }) => Promise<any>;
}

export class AgentToolHandler {
  constructor(private readonly deps: AgentToolHandlerDependencies) {}

  private toSessionSummary(session: {
    id?: string;
    name?: string;
    title?: string;
    state?: string;
    provider?: string;
    createTime?: string;
    outputs?: Array<{ pullRequest?: { url?: string } }>;
  }): Record<string, unknown> {
    const pullRequests = (session.outputs || [])
      .map((output) => output.pullRequest)
      .filter((pullRequest): pullRequest is { url?: string } => !!pullRequest)
      .map((pullRequest) => ({ url: pullRequest.url }))
      .filter((pullRequest) => typeof pullRequest.url === "string");

    return {
      id: session.id,
      name: session.name,
      title: session.title,
      state: session.state,
      provider: session.provider,
      createTime: session.createTime,
      hasPullRequest: pullRequests.length > 0,
      pullRequests,
    };
  }

  async handleSprintAgent(args: SprintAgentArgs) {
    const settings = this.deps.getDashboardSettings();
    const resolvedArgs: SprintAgentArgs = {
      ...args,
      feature_branch: args.feature_branch || this.deps.formatSprintBranch(settings.git.sprintBranchScheme, args.sprint_number),
    };
    return await this.deps.sprintOrchestrator.execute(resolvedArgs);
  }

  async handleTaskAgent(args: {
    prompt: string;
    source_id: string;
    repo_path: string;
    title?: string;
    branch?: string;
    wait?: boolean;
  }) {
    const maxFails = this.deps.getMaxFailures();
    if (this.deps.getConsecutiveFailures() >= maxFails) {
      throw new Error(
        `CRITICAL: Emergency stop active. ${this.deps.getConsecutiveFailures()} consecutive task creation failures detected.`
      );
    }

    try {
      const session = await this.deps.taskService.createTaskAgentSession(args);
      this.deps.setConsecutiveFailures(0);

      if (args.wait) {
        return await this.deps.waitForSessionCompletion({ session_id: session.id });
      }

      return { content: [{ type: "text", text: JSON.stringify(this.toSessionSummary(session), null, 2) }] };
    } catch (error: any) {
      this.deps.setConsecutiveFailures(this.deps.getConsecutiveFailures() + 1);
      throw error;
    }
  }
}
