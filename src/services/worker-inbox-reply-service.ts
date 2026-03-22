import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import type { DashboardSettings, ProviderId, Subtask } from "../contracts/app-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { buildProviderPrompt } from "./cli-workflow-utils.js";
import { providerSpecs } from "../infrastructure/providers/cli/provider-runner.js";
import { runCommandStrict } from "./cli-process-runner.js";
import { getRepoSprintOsPath } from "../shared/config/sprint-os-paths.js";
import type { TaskService } from "./task-service.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { Logger } from "../shared/logging/logger.js";

export interface GenerateDashboardReplyInput {
  projectId: string;
  threadId: string;
  threadTitle?: string;
  bodyMarkdown: string;
}

export interface GenerateDashboardReplyResult {
  bodyMarkdown: string;
  provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
  model: string;
}

interface WorkerInboxReplyServiceDependencies {
  projectManagementRepository: ProjectManagementRepository;
  taskService: TaskService;
  agentPresetSyncService: AgentPresetSyncService;
  getDashboardSettings: () => DashboardSettings;
  getGithubToken: () => string | undefined;
  logger?: Logger;
}

export class WorkerInboxReplyService {
  constructor(private readonly deps: WorkerInboxReplyServiceDependencies) {}

  async generateReply(input: GenerateDashboardReplyInput): Promise<GenerateDashboardReplyResult> {
    const project = this.deps.projectManagementRepository.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const settings = this.deps.getDashboardSettings();
    const provider = this.chooseProvider(input.bodyMarkdown, settings);
    const providerSettings = settings.aiProvider.providers[provider];
    const rawPrompt = await this.buildPrompt({
      projectId: input.projectId,
      repoPath: project.baseDir,
      projectName: project.name,
      threadId: input.threadId,
      threadTitle: input.threadTitle,
      bodyMarkdown: input.bodyMarkdown,
    });
    const prompt = buildProviderPrompt(rawPrompt, providerSettings.thinkingMode);

    const output = await this.runProvider({
      provider,
      prompt,
      repoPath: project.baseDir,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      githubToken: this.deps.getGithubToken(),
    });
    const bodyMarkdown = output.trim();
    if (!bodyMarkdown) {
      throw new Error(`Provider ${provider} returned an empty dashboard reply.`);
    }

    this.deps.logger?.info("Generated dashboard reply for worker connection", {
      provider,
      projectId: input.projectId,
      threadId: input.threadId,
    });

    return {
      bodyMarkdown,
      provider,
      model: providerSettings.model,
    };
  }

  async generateClarificationReply(args: {
    projectId: string;
    sprintGoal: string;
    subtasks: Subtask[];
    task: Subtask;
  }): Promise<string> {
    const project = this.deps.projectManagementRepository.getProject(args.projectId);
    if (!project) {
      throw new Error(`Project not found: ${args.projectId}`);
    }

    const settings = this.deps.getDashboardSettings();
    const provider = this.chooseProvider(args.task.prompt || args.task.title, settings);
    const providerSettings = settings.aiProvider.providers[provider];

    const workerInstructions = (await this.deps.agentPresetSyncService.getWorkerAgent(args.projectId))
      .instructionMarkdown
      .trim();

    const latestAgentPrompt = this.getLatestAgentPrompt(args.task);

    const fullContextPrompt = [
      workerInstructions ? `## WORKER INSTRUCTIONS\n\n${workerInstructions}` : "",
      "## ROLE",
      "You are a Sprint OS automated assistant answering a clarification request from an implementation agent.",
      "Your goal is to provide a helpful, technically accurate answer based on the full sprint context.",
      "Reply in concise markdown.",
      "",
      "## SPRINT CONTEXT",
      `Project: ${project.name}`,
      `Sprint Goal: ${args.sprintGoal}`,
      "",
      "## SUBTASKS",
      args.subtasks.map((t) => `- [${t.status}] ${t.id}: ${t.title}${t.id === args.task.id ? " (CURRENT TASK)" : ""}`).join("\n"),
      "",
      "## CURRENT TASK DETAIL",
      `Task ID: ${args.task.id}`,
      `Title: ${args.task.title}`,
      `Original Prompt: ${args.task.prompt}`,
      latestAgentPrompt ? `\n## LATEST CLARIFICATION REQUEST FROM AGENT\n${latestAgentPrompt}` : "",
      "",
      "## REQUIRED OUTPUT",
      "Return only the answer body in markdown. No JSON. No code fences unless the reply truly needs them.",
      "Answer the agent so they can continue implementation immediately.",
    ].filter(Boolean).join("\n");

    const prompt = buildProviderPrompt(fullContextPrompt, providerSettings.thinkingMode);

    const output = await this.runProvider({
      provider,
      prompt,
      repoPath: project.baseDir,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      githubToken: this.deps.getGithubToken(),
    });

    return output.trim();
  }

  private getLatestAgentPrompt(task: Subtask): string {
    const activities = Array.isArray(task.activities) ? task.activities : [];
    for (let index = activities.length - 1; index >= 0; index -= 1) {
      const entry = activities[index] as Record<string, unknown>;
      const agentMessaged = entry.agentMessaged as Record<string, unknown> | undefined;
      const agentMessage = typeof agentMessaged?.agentMessage === "string" ? agentMessaged.agentMessage.trim() : "";
      if (agentMessage.length > 0) {
        return agentMessage;
      }
      const description = typeof entry.description === "string" ? entry.description.trim() : "";
      if (description.length > 0) {
        return description;
      }
    }
    return "";
  }

  private chooseProvider(bodyMarkdown: string, settings: DashboardSettings): Extract<ProviderId, "gemini" | "codex" | "claude-code"> {
    const pseudoTask: Subtask = {
      id: "dashboard-reply",
      title: "Dashboard reply",
      prompt: bodyMarkdown,
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };

    return this.deps.taskService.selectCliProviderForTask(pseudoTask);
  }

  private async buildPrompt(args: {
    projectId: string;
    repoPath: string;
    projectName: string;
    threadId: string;
    threadTitle?: string;
    bodyMarkdown: string;
  }): Promise<string> {
    const workerInstructions = (await this.deps.agentPresetSyncService.getWorkerAgent(args.projectId))
      .instructionMarkdown
      .trim();

    const instructions = [
      "You are a Sprint OS connected worker replying to a dashboard chat message.",
      "Reply in concise markdown.",
      "Do not claim code changes, PRs, or completed execution unless they actually happened.",
      "If the message asks for status you do not know, say so plainly and ask for the next action.",
      "Do not start implementation from this message. This is a reply-only interaction.",
    ].join("\n");

    return [
      workerInstructions ? `## WORKER INSTRUCTIONS\n\n${workerInstructions}` : "",
      "## ROLE",
      instructions,
      "",
      "## CONTEXT",
      `Project: ${args.projectName}`,
      `Repo Path: ${args.repoPath}`,
      `Thread ID: ${args.threadId}`,
      args.threadTitle ? `Thread Title: ${args.threadTitle}` : "",
      "",
      "## DASHBOARD MESSAGE",
      args.bodyMarkdown.trim(),
      "",
      "## REQUIRED OUTPUT",
      "Return only the reply body in markdown. No JSON. No code fences unless the reply truly needs them.",
    ].filter((part) => part.trim().length > 0).join("\n");
  }

  private async runProvider(input: {
    provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
    prompt: string;
    repoPath: string;
    model: string;
    apiKey: string;
    githubToken?: string;
  }): Promise<string> {
    const env = this.withProviderEnv(input.provider, input.model, input.apiKey, input.githubToken);
    if (input.provider === "codex") {
      return await this.runCodexReply(input.repoPath, input.model, input.prompt, env);
    }

    const spec = providerSpecs[input.provider](input.model, input.prompt);
    const result = await runCommandStrict(spec.command, spec.args, input.repoPath, env);
    return result.stdout || result.stderr;
  }

  private async runCodexReply(
    repoPath: string,
    model: string,
    prompt: string,
    env: NodeJS.ProcessEnv,
  ): Promise<string> {
    const outputDir = getRepoSprintOsPath(repoPath, "tmp");
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `worker-reply-${randomUUID()}.txt`);

    const args = ["exec", "--yolo", "--output-last-message", outputPath];
    if (model && model !== "default") {
      args.push("--model", model);
    }
    args.push(prompt);

    try {
      const result = await runCommandStrict("codex", args, repoPath, env);
      const fileOutput = await fs.readFile(outputPath, "utf8").catch(() => "");
      return fileOutput.trim() || result.stdout || result.stderr;
    } finally {
      await fs.rm(outputPath, { force: true }).catch(() => undefined);
    }
  }

  private withProviderEnv(
    provider: ProviderId,
    model: string,
    apiKey: string,
    githubToken?: string,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (githubToken) {
      env.GH_TOKEN = githubToken;
      env.GITHUB_TOKEN = githubToken;
    }

    if (provider === "gemini") {
      if (model && model !== "default") {
        env.GEMINI_MODEL = model;
      }
      if (apiKey) {
        env.GEMINI_API_KEY = apiKey;
      }
    } else if (provider === "claude-code") {
      if (apiKey) {
        env.ANTHROPIC_API_KEY = apiKey;
      }
    } else if (provider === "codex") {
      if (model && model !== "default") {
        env.CODEX_MODEL = model;
      }
      if (apiKey) {
        env.OPENAI_API_KEY = apiKey;
      }
    }

    return env;
  }
}
