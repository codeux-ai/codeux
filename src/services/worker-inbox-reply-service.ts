import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import type { DashboardSettings, ProviderId, Subtask } from "../contracts/app-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { buildProviderPrompt } from "./cli-workflow-utils.js";
import type { IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";

import { getRepoSprintOsPath } from "../shared/config/sprint-os-paths.js";
import type { TaskService } from "./task-service.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";

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
  executionRepository: ExecutionRepository;
  getDashboardSettings: () => DashboardSettings;
  getGithubToken: () => string | undefined;
  providerRunner: IProviderRunner;
  logger?: Logger;
}

export class WorkerInboxReplyService {
  constructor(private readonly deps: WorkerInboxReplyServiceDependencies) {}

  async generateReply(input: GenerateDashboardReplyInput): Promise<GenerateDashboardReplyResult> {
    const project = this.deps.projectManagementRepository.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const route = this.resolveProviderRoute("dashboard_reply", input.bodyMarkdown);
    const rawPrompt = await this.buildPrompt({
      projectId: input.projectId,
      repoPath: project.baseDir,
      projectName: project.name,
      threadId: input.threadId,
      threadTitle: input.threadTitle,
      bodyMarkdown: input.bodyMarkdown,
    });
    const prompt = buildProviderPrompt(rawPrompt, route.providers[route.provider].thinkingMode);

    const execInvocation = this.deps.executionRepository.createExecutionInvocation({
      projectId: input.projectId,
      type: "worker_reply",
      provider: route.provider,
      model: route.providers[route.provider].model,
      startedAt: new Date().toISOString(),
      attentionItemId: null,
      dispatchId: null,
      providerInvocationId: null,
      sprintId: null,
      sprintRunId: null,
      taskId: null,
      taskRunId: null,
    });

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "user",
      contentMarkdown: rawPrompt,
    });

    let output: string;
    try {
      output = await this.runProvider({
        provider: route.provider,
        prompt,
        repoPath: project.baseDir,
        model: route.providers[route.provider].model,
        apiKey: route.providers[route.provider].apiKey,
        githubToken: this.deps.getGithubToken(),
      });
    } catch (err) {
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      throw err;
    }

    const bodyMarkdown = this.normalizeProviderReply(output);

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "assistant",
      contentMarkdown: bodyMarkdown,
    });
    this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });

    if (!bodyMarkdown) {
      throw new Error(`Provider ${route.provider} returned an empty dashboard reply.`);
    }

    this.deps.logger?.info("Generated dashboard reply for worker connection", {
      provider: route.provider,
      projectId: input.projectId,
      threadId: input.threadId,
    });

    return {
      bodyMarkdown,
      provider: route.provider,
      model: route.providers[route.provider].model,
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

    const route = this.resolveProviderRoute("clarification_reply", args.task.prompt || args.task.title);
    const invocationTaskId = typeof args.task.record_id === "string" && args.task.record_id.trim().length > 0
      ? args.task.record_id.trim()
      : null;

    const projectManagerInstructions = (await this.deps.agentPresetSyncService.getProjectManagerAgent(args.projectId))
      .instructionMarkdown
      .trim();

    const clarificationRequest = this.getLatestClarificationRequest(args.task);

    const fullContextPrompt = [
      projectManagerInstructions ? `## PROJECT MANAGER INSTRUCTIONS\n\n${projectManagerInstructions}` : "",
      "## CLARIFICATION TASK",
      "Answer Jules' clarification request for the current task using the sprint context below.",
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
      "",
      "## JULES CLARIFICATION REQUEST",
      clarificationRequest,
      "",
      "## REQUIRED OUTPUT",
      "Return only the answer body in markdown. No JSON. No code fences unless the reply truly needs them.",
      "Answer the agent so they can continue implementation immediately.",
    ].filter(Boolean).join("\n");

    const prompt = buildProviderPrompt(fullContextPrompt, route.providers[route.provider].thinkingMode);

    const execInvocation = this.deps.executionRepository.createExecutionInvocation({
      projectId: args.projectId,
      type: "worker_reply",
      provider: route.provider,
      model: route.providers[route.provider].model,
      startedAt: new Date().toISOString(),
      attentionItemId: null,
      dispatchId: null,
      providerInvocationId: null,
      sprintId: null,
      sprintRunId: null,
      taskId: invocationTaskId,
      taskRunId: null,
    });

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "user",
      contentMarkdown: fullContextPrompt,
    });

    let output: string;
    try {
      output = await this.runProvider({
        provider: route.provider,
        prompt,
        repoPath: project.baseDir,
        model: route.providers[route.provider].model,
        apiKey: route.providers[route.provider].apiKey,
        githubToken: this.deps.getGithubToken(),
      });
    } catch (err) {
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      throw err;
    }

    const reply = this.normalizeProviderReply(output);

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "assistant",
      contentMarkdown: reply,
    });
    this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });

    if (!reply) {
      throw new Error(`Provider ${route.provider} returned an empty clarification reply.`);
    }

    return reply;
  }

  private getLatestClarificationRequest(task: Subtask): string {
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
        return `No explicit Jules clarification message was captured. Latest related activity summary: ${description}`;
      }
    }
    return "No explicit Jules clarification message was captured in recent session activities.";
  }

  private resolveProviderRoute(
    invocation: "dashboard_reply" | "clarification_reply",
    bodyMarkdown: string,
  ): {
    provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
    providers: Record<ProviderId, DashboardSettings["aiProvider"]["providers"][ProviderId]>;
  } {
    const pseudoTask: Subtask = {
      id: "dashboard-reply",
      title: "Dashboard reply",
      prompt: bodyMarkdown,
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };

    const route = this.deps.taskService.resolveInvocationProvider(invocation, pseudoTask, {
      cliOnly: true,
    });
    return {
      ...route,
      provider: route.provider as Extract<ProviderId, "gemini" | "codex" | "claude-code">,
    };
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
    const workflowSettings = this.deps.getDashboardSettings().cliWorkflow;

    const result = await this.deps.providerRunner.runProviderForText({
      provider: input.provider,
      prompt: input.prompt,
      cwd: input.repoPath,
      model: input.model,
      apiKey: input.apiKey,
      sessionId: "worker-reply-" + randomUUID(),
      workflowSettings,
      repoPath: input.repoPath,
      githubToken: input.githubToken,
      onActivity: () => {},
    });
    return result.text;
  }

  private normalizeProviderReply(output: string): string {
    const trimmed = output.trim();
    if (!trimmed) {
      return "";
    }

    try {
      const parsed = JSON.parse(trimmed) as { response?: unknown };
      if (typeof parsed?.response === "string") {
        return parsed.response.trim();
      }
    } catch {
      // Provider returned plain text; keep it as-is.
    }

    return trimmed;
  }

  }
