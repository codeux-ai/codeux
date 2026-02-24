import type { JulesApiClient } from "./jules-api.js";
import type { JulesSession, Subtask } from "./types.js";

export interface TaskServiceDependencies {
  julesApi: JulesApiClient;
  guideRepository: {
    getGuideContent: (guideName: string, repoPath?: string) => Promise<string>;
  };
  normalizeSourceName: (sourceId: string) => string;
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

  async createTaskAgentSession(args: TaskAgentSessionArgs): Promise<JulesSession> {
    let workerGuide = "";
    try {
      workerGuide = await this.deps.guideRepository.getGuideContent("worker.md", args.repo_path);
    } catch {
      console.error("Warning: worker.md guide not found for task_agent.");
    }

    const fullPrompt = workerGuide
      ? `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerGuide}\n\n---\n\n## TASK TO EXECUTE\n\n${args.prompt}`
      : args.prompt;

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

    return await this.deps.julesApi.createSession(data);
  }

  async startSprintTask(task: Subtask, sourceId: string, baseBranch: string, repoPath: string, sprintNumber: number): Promise<JulesSession> {
    const workerGuide = await this.deps.guideRepository.getGuideContent("worker.md", repoPath);
    const fullPrompt = `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerGuide}\n\n---\n\n## SUBTASK TO EXECUTE\n\n${task.prompt}`;
    const data = {
      prompt: fullPrompt,
      title: `Sprint ${sprintNumber}: [${task.id}] ${task.title}`,
      sourceContext: {
        source: this.deps.normalizeSourceName(sourceId),
        githubRepoContext: { startingBranch: baseBranch },
      },
      automationMode: "AUTO_CREATE_PR",
    };

    return await this.deps.julesApi.createSession(data);
  }
}
