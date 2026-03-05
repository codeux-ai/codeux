import * as path from "path";
import type { JulesApiClient, JulesCreateSessionRequest } from "../integrations/jules-api-client.js";
import { chooseProviderForTask } from "./provider-routing.js";
import { TaskStatus, type  DashboardSettings, JulesSession, ProviderId, Subtask } from "../contracts/app-types.js";
import type { CliWorkflowService } from "./cli-workflow-service.js";
import { buildTaskRunTag } from "./task-run-key.js";
import type { Logger } from "../shared/logging/logger.js";

export interface TaskServiceDependencies {
  julesApi: JulesApiClient;
  guideRepository: {
    getGuideContent: (guideName: string, repoPath?: string) => Promise<string>;
  };
  resolveJulesSourceId: (args: { repoPath: string; sourceId?: string }) => Promise<string>;
  getDashboardSettings: () => DashboardSettings;
  isJulesApiConfigured: () => boolean;
  cliWorkflowService: CliWorkflowService;
  logger?: Logger;
}

export interface TaskAgentSessionArgs {
  prompt: string;
  source_id?: string;
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
      const fallback = (["gemini", "codex", "claude-code"] as const).find((provider) => settings.aiProvider.providers[provider].enabled);
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
      status: TaskStatus.PENDING,
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
        projectId: path.basename(path.resolve(args.repo_path)), sprintId: "0",
      });
    }
    const sourceId = await this.deps.resolveJulesSourceId({
      repoPath: args.repo_path,
      sourceId: args.source_id,
    });
    const fullPrompt = await this.buildPrompt(args.repo_path, "TASK TO EXECUTE", args.prompt);

    const data: JulesCreateSessionRequest = {
      prompt: fullPrompt,
      sourceContext: {
        source: sourceId,
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

  async startSprintTask(task: Subtask, sourceId: string | undefined, baseBranch: string, repoPath: string, sprintNumber: number): Promise<JulesSession> {
    const provider = this.resolveProvider(task);

    if (provider !== "jules") {
      const session = await this.deps.cliWorkflowService.startTask({
        provider,
        task,
        repoPath,
        featureBranch: baseBranch,
        projectId: path.basename(path.resolve(repoPath)), sprintId: String(sprintNumber),
      });
      session.provider = provider;
      return session;
    }
    const resolvedSourceId = await this.deps.resolveJulesSourceId({
      repoPath,
      sourceId,
    });
    const fullPrompt = await this.buildPrompt(repoPath, "SUBTASK TO EXECUTE", task.prompt);

    const data: JulesCreateSessionRequest = {
      prompt: fullPrompt,
      title: `Sprint ${sprintNumber}: ${buildTaskRunTag(path.basename(path.resolve(repoPath)), String(sprintNumber), task.id)} [${task.id}] ${task.title}`,
      sourceContext: {
        source: resolvedSourceId,
        githubRepoContext: { startingBranch: baseBranch },
      },
      automationMode: "AUTO_CREATE_PR",
    };

    const session = await this.deps.julesApi.createSession(data);
    session.provider = "jules";
    return session;
  }
}
