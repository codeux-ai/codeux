import type { JulesApiClient } from "./jules-api.js";
import { chooseProviderForTask } from "./provider-routing.js";
import type { DashboardSettings, JulesSession, ProviderId, Subtask } from "./types.js";
import type { CliWorkflowService } from "./cli-workflow-service.js";

export interface TaskServiceDependencies {
  julesApi: JulesApiClient;
  guideRepository: {
    getGuideContent: (guideName: string, repoPath?: string) => Promise<string>;
  };
  normalizeSourceName: (sourceId: string) => string;
  getDashboardSettings: () => DashboardSettings;
  isJulesApiConfigured: () => boolean;
  cliWorkflowService: CliWorkflowService;
}

export interface TaskAgentSessionArgs {
  prompt: string;
  source_id: string;
  repo_path: string;
  title?: string;
  branch?: string;
}

export class TaskService {
  constructor(private readonly deps: TaskServiceDependencies) {}

  private resolveProvider(task: Subtask): ProviderId {
    const settings = this.deps.getDashboardSettings();
    const chosen = chooseProviderForTask(settings, task);
    if (chosen === "jules" && !this.deps.isJulesApiConfigured()) {
      const fallback = (["gemini", "codex"] as const).find((provider) => settings.aiProvider.providers[provider].enabled);
      if (fallback) {
        return fallback;
      }
    }
    return chosen;
  }

  private async buildPrompt(repoPath: string, sectionTitle: string, taskPrompt: string): Promise<string> {
    let workerGuide = "";
    try {
      workerGuide = await this.deps.guideRepository.getGuideContent("worker.md", repoPath);
    } catch {
      // optional
    }

    return workerGuide
      ? `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerGuide}\n\n---\n\n## ${sectionTitle}\n\n${taskPrompt}`
      : taskPrompt;
  }

  async createTaskAgentSession(args: TaskAgentSessionArgs): Promise<JulesSession> {
    const pseudoTask: Subtask = {
      id: `adhoc-${Date.now().toString(36)}`,
      title: args.title || "Adhoc Task",
      prompt: args.prompt,
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };
    const provider = this.resolveProvider(pseudoTask);

    if (provider !== "jules") {
      return await this.deps.cliWorkflowService.startTask({
        provider,
        task: {
          ...pseudoTask,
          prompt: args.prompt,
        },
        repoPath: args.repo_path,
        featureBranch: args.branch || this.deps.getDashboardSettings().git.defaultBranch,
        sprintNumber: 0,
      });
    }
    const fullPrompt = await this.buildPrompt(args.repo_path, "TASK TO EXECUTE", args.prompt);

    const data: any = {
      prompt: fullPrompt,
      sourceContext: {
        source: this.deps.normalizeSourceName(args.source_id),
      },
      automationMode: "AUTO_CREATE_PR",
    };

    if (args.branch) {
      data.sourceContext.githubRepoContext = { startingBranch: args.branch };
    }
    if (args.title) {
      data.title = args.title;
    }

    const session = await this.deps.julesApi.createSession(data);
    session.provider = "jules";
    return session;
  }

  async startSprintTask(task: Subtask, sourceId: string, baseBranch: string, repoPath: string, sprintNumber: number): Promise<JulesSession> {
    const provider = this.resolveProvider(task);

    if (provider !== "jules") {
      const session = await this.deps.cliWorkflowService.startTask({
        provider,
        task,
        repoPath,
        featureBranch: baseBranch,
        sprintNumber,
      });
      session.provider = provider;
      return session;
    }
    const fullPrompt = await this.buildPrompt(repoPath, "SUBTASK TO EXECUTE", task.prompt);

    const data = {
      prompt: fullPrompt,
      title: `Sprint ${sprintNumber}: [${task.id}] ${task.title}`,
      sourceContext: {
        source: this.deps.normalizeSourceName(sourceId),
        githubRepoContext: { startingBranch: baseBranch },
      },
      automationMode: "AUTO_CREATE_PR",
    };

    const session = await this.deps.julesApi.createSession(data);
    session.provider = "jules";
    return session;
  }
}
