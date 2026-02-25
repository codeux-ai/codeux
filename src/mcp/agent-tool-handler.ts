import type { TaskService } from "../task-service.js";
import type { DashboardSettings } from "../types.js";
import type { SprintOrchestrator } from "../sprint-orchestrator.js";
import type { SprintAgentArgs } from "../sprint/types.js";

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

      return { content: [{ type: "text", text: JSON.stringify(session, null, 2) }] };
    } catch (error: any) {
      this.deps.setConsecutiveFailures(this.deps.getConsecutiveFailures() + 1);
      throw error;
    }
  }
}
