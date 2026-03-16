import { randomUUID } from "crypto";
import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import type { TaskExecutorType, TaskPriority } from "../contracts/project-management-types.js";
import type { McpConnectionRecord, McpConnectionRole } from "../contracts/connection-chat-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { ExecutionControlService } from "./execution-control-service.js";
import type { Logger } from "../shared/logging/logger.js";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS } from "./cli-workflow-utils.js";
import { buildReadFileRetryPrompt, isReadFileNotFoundToolError } from "./cli-workflow-text-utils.js";
import { ProviderRunner, type IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";
import { classifyProviderError, ProviderQuotaError } from "../shared/providers/provider-error-classifier.js";

interface PlanningAgentServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  connectionChatRepository: ConnectionChatRepository;
  settingsRepository: SettingsRepository;
  agentPresetSyncService: AgentPresetSyncService;
  executionControlService: ExecutionControlService;
  providerRunner?: IProviderRunner;
  logger?: Logger;
}

interface ImprovePromptInput {
  name: string;
  goal: string;
}

interface ImprovePromptResult {
  goal: string;
  threadId: string;
  agentId: string;
  workerConnectionId: string | null;
}

interface PlanSprintResult {
  ok: true;
  threadId: string;
  agentId: string;
  createdTaskIds: string[];
  started: boolean;
}

interface PlannedTaskDraft {
  key: string;
  title: string;
  description: string;
  promptMarkdown: string;
  priority?: TaskPriority;
  executorType?: TaskExecutorType;
  dependsOn?: string[];
}

interface PlannedSprintPayload {
  goal?: string;
  tasks: PlannedTaskDraft[];
}

function extractJsonLikeBlock(bodyMarkdown: string): string {
  const trimmed = bodyMarkdown.trim();
  const fencedMatch = trimmed.match(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/);
  if (fencedMatch?.[1]?.trim()) {
    return fencedMatch[1].trim();
  }

  const tryBalanced = (openChar: "{" | "[", closeChar: "}" | "]"): string | null => {
    const start = trimmed.indexOf(openChar);
    if (start < 0) {
      return null;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index]!;
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === openChar) {
        depth += 1;
        continue;
      }
      if (char === closeChar) {
        depth -= 1;
        if (depth === 0) {
          return trimmed.slice(start, index + 1);
        }
      }
    }
    return null;
  };

  return tryBalanced("{", "}") || tryBalanced("[", "]") || trimmed;
}

export class PlanningAgentService {
  private readonly providerRunner: IProviderRunner;

  constructor(private readonly deps: PlanningAgentServiceDeps) {
    this.providerRunner = deps.providerRunner || new ProviderRunner(new DockerRunner());
  }

  async improveSprintPrompt(projectId: string, input: ImprovePromptInput): Promise<ImprovePromptResult> {
    const project = this.requireProject(projectId);
    const planningAgent = await this.deps.agentPresetSyncService.getPlanningAgent(projectId);
    const runtime = this.resolvePlanningRuntime(projectId);
    const worker = runtime.mode === "CONNECTED_MCP" ? runtime.connection : null;
    const thread = this.deps.connectionChatRepository.createThread(projectId, {
      title: `Planning agent · ${input.name.trim() || "Untitled sprint"} · Improve`,
      connectionId: worker?.id,
    });

    const prompt = this.buildImprovePrompt({
      projectName: project.name,
      planningAgent,
      sprintName: input.name,
      goal: input.goal,
    });
    const reply = worker
      ? await this.postRequestAndWaitForReply(projectId, thread.id, worker.id, prompt)
      : await this.runVirtualPlanningRequest({
        projectId,
        threadId: thread.id,
        repoPath: project.baseDir,
        settings: runtime.settings,
        rawPrompt: prompt,
      });
    const payload = this.parseJsonReply<{ goal?: string }>(reply.bodyMarkdown);
    const goal = String(payload.goal || "").trim();
    if (!goal) {
      throw new Error("Planning agent reply did not include an improved sprint prompt.");
    }

    return {
      goal,
      threadId: thread.id,
      agentId: planningAgent.id,
      workerConnectionId: worker?.id || null,
    };
  }

  async planSprint(projectId: string, sprintId: string, options: { autoStart: boolean }): Promise<PlanSprintResult> {
    const project = this.requireProject(projectId);
    const sprint = this.requireSprint(projectId, sprintId);
    const planningAgent = await this.deps.agentPresetSyncService.getPlanningAgent(projectId);
    const runtime = this.resolvePlanningRuntime(projectId);
    const worker = runtime.mode === "CONNECTED_MCP" ? runtime.connection : null;
    const existingTasks = this.deps.projectManagementRepository.listTasks(projectId, sprintId);
    if (existingTasks.length > 0) {
      throw new Error(`Sprint ${sprint.name} already has ${existingTasks.length} task(s). Clear or edit them before running Planning agent.`);
    }

    const thread = this.deps.connectionChatRepository.createThread(projectId, {
      title: `Planning agent · ${sprint.name} · Plan`,
      connectionId: worker?.id,
    });

    const prompt = this.buildPlanPrompt({
      projectName: project.name,
      planningAgent,
      sprintNumber: sprint.number,
      sprintName: sprint.name,
      goal: sprint.goal,
    });
    const reply = worker
      ? await this.postRequestAndWaitForReply(projectId, thread.id, worker.id, prompt)
      : await this.runVirtualPlanningRequest({
        projectId,
        threadId: thread.id,
        repoPath: project.baseDir,
        settings: runtime.settings,
        rawPrompt: prompt,
      });
    const payload = this.parsePlannedSprintReply(reply.bodyMarkdown);
    if (payload.goal && payload.goal.trim() && payload.goal.trim() !== sprint.goal.trim()) {
      this.deps.projectManagementRepository.updateSprint(sprint.id, {
        goal: payload.goal.trim(),
      });
    }

    const createdTaskIds: string[] = [];
    const taskIdsByKey = new Map<string, string>();
    for (let index = 0; index < payload.tasks.length; index += 1) {
      const task = payload.tasks[index]!;
      const dependsOnTaskIds = (task.dependsOn || []).map((dependencyKey) => {
        const dependencyId = taskIdsByKey.get(dependencyKey);
        if (!dependencyId) {
          throw new Error(`Planning agent returned dependency "${dependencyKey}" before defining it.`);
        }
        return dependencyId;
      });

      const created = this.deps.projectManagementRepository.createTask(projectId, {
        sprintId,
        title: task.title.trim(),
        description: task.description.trim(),
        promptMarkdown: task.promptMarkdown.trim(),
        priority: this.normalizePriority(task.priority),
        executorType: this.normalizeExecutor(task.executorType),
        dependsOnTaskIds,
        sortOrder: index,
        status: "pending",
        isIndependent: dependsOnTaskIds.length === 0,
      });
      createdTaskIds.push(created.id);
      taskIdsByKey.set(task.key, created.id);
    }

    if (options.autoStart) {
      await this.deps.executionControlService.orchestrateSprint(projectId, sprintId);
    }

    return {
      ok: true,
      threadId: thread.id,
      agentId: planningAgent.id,
      createdTaskIds,
      started: options.autoStart,
    };
  }

  private async postRequestAndWaitForReply(
    projectId: string,
    threadId: string,
    connectionId: string,
    bodyMarkdown: string,
  ): Promise<{ bodyMarkdown: string }> {
    const sentMessage = this.deps.connectionChatRepository.postDashboardMessage(projectId, {
      threadId,
      connectionId,
      bodyMarkdown,
    });
    const timeoutAt = Date.now() + 45_000;

    while (Date.now() < timeoutAt) {
      const reply = this.deps.connectionChatRepository
        .listMessages(threadId)
        .find((message) => (
          message.direction === "connection_to_dashboard"
          && new Date(message.createdAt).getTime() >= new Date(sentMessage.createdAt).getTime()
        ));
      if (reply) {
        return reply;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`Planning agent request timed out while waiting for worker reply in thread ${threadId}.`);
  }

  private resolvePlanningRuntime(projectId: string): {
    mode: "CONNECTED_MCP" | "VIRTUAL";
    settings: DashboardSettings;
    connection: McpConnectionRecord | null;
  } {
    const settings = this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;
    if (settings.workers.executionMode === "VIRTUAL") {
      return {
        mode: "VIRTUAL",
        settings,
        connection: null,
      };
    }

    return {
      mode: "CONNECTED_MCP",
      settings,
      connection: this.requirePlanningWorker(projectId),
    };
  }

  private async runVirtualPlanningRequest(args: {
    projectId: string;
    threadId: string;
    repoPath: string;
    settings: DashboardSettings;
    rawPrompt: string;
  }): Promise<{ bodyMarkdown: string }> {
    const provider = args.settings.workers.virtualWorkerProvider;
    const providerSettings = args.settings.aiProvider.providers[provider];
    if (!providerSettings) {
      throw new Error(`Virtual worker provider "${provider}" is not configured. Check AI Provider settings.`);
    }
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...args.settings.cliWorkflow,
    };
    const sessionId = `planning-${provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const providerPrompt = buildProviderPrompt(args.rawPrompt, providerSettings.thinkingMode);

    this.deps.connectionChatRepository.postSystemMessage(args.projectId, {
      threadId: args.threadId,
      bodyMarkdown: `Planning request routed through virtual ${this.getProviderLabel(provider)} worker.`,
    });

    let result = await this.providerRunner.runProviderForText({
      provider,
      prompt: providerPrompt,
      cwd: args.repoPath,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      sessionId,
      workflowSettings,
      repoPath: args.repoPath,
      githubToken: args.settings.git.githubToken,
      onActivity: (description, originator) => {
        this.deps.logger?.debug("Virtual planning worker activity", {
          projectId: args.projectId,
          threadId: args.threadId,
          provider,
          originator: originator || "system",
          description,
        });
      },
    });

    if (!result.ok && workflowSettings.retryOnReadFileNotFound && isReadFileNotFoundToolError(result)) {
      this.deps.logger?.info("Retrying virtual planning request with file-discovery guidance", {
        projectId: args.projectId,
        threadId: args.threadId,
        provider,
      });
      result = await this.providerRunner.runProviderForText({
        provider,
        prompt: buildReadFileRetryPrompt(providerPrompt),
        cwd: args.repoPath,
        model: providerSettings.model,
        apiKey: providerSettings.apiKey,
        sessionId: `${sessionId}-retry`,
        workflowSettings,
        repoPath: args.repoPath,
        githubToken: args.settings.git.githubToken,
        onActivity: (description, originator) => {
          this.deps.logger?.debug("Virtual planning worker retry activity", {
            projectId: args.projectId,
            threadId: args.threadId,
            provider,
            originator: originator || "system",
            description,
          });
        },
      });
    }

    const bodyMarkdown = result.text.trim();
    if (!result.ok) {
      const classification = classifyProviderError(provider, result);
      this.deps.logger?.error("Virtual planning provider failed", {
        projectId: args.projectId,
        provider,
        exitCode: result.code,
        errorCategory: classification.category,
        resetAfter: classification.resetAfter,
        stderr: result.stderr?.slice(0, 500),
        stdout: result.stdout?.slice(0, 500),
      });
      if (classification.category !== "UNKNOWN") {
        throw new ProviderQuotaError(classification);
      }
      throw new Error(classification.userMessage);
    }
    if (!bodyMarkdown) {
      throw new Error(`Virtual ${this.getProviderLabel(provider)} worker returned an empty Planning agent reply.`);
    }

    this.deps.connectionChatRepository.postSystemMessage(args.projectId, {
      threadId: args.threadId,
      bodyMarkdown: [
        `Virtual ${this.getProviderLabel(provider)} worker reply:`,
        "",
        bodyMarkdown,
      ].join("\n"),
    });

    return { bodyMarkdown };
  }

  private buildImprovePrompt(args: {
    projectName: string;
    planningAgent: AgentPresetRecord;
    sprintName: string;
    goal: string;
  }): string {
    return [
      "You are Sprint OS's Planning agent.",
      "",
      "## Planning Agent Instructions",
      args.planningAgent.instructionMarkdown.trim() || "Refine sprint prompts into crisp, implementation-ready scopes.",
      "",
      "## Task",
      "Improve the sprint prompt only. Do not break it into tasks yet.",
      `Project: ${args.projectName}`,
      `Sprint: ${args.sprintName.trim() || "Untitled sprint"}`,
      "",
      "## Current Prompt",
      args.goal.trim() || "No prompt provided.",
      "",
      "## Required Output",
      "Return JSON only with this exact shape and no surrounding commentary:",
      '{"goal":"Improved sprint prompt"}',
    ].join("\n");
  }

  private buildPlanPrompt(args: {
    projectName: string;
    planningAgent: AgentPresetRecord;
    sprintNumber: number | null;
    sprintName: string;
    goal: string;
  }): string {
    return [
      "You are Sprint OS's Planning agent.",
      "",
      "## Planning Agent Instructions",
      args.planningAgent.instructionMarkdown.trim() || "Break sprint goals into actionable subtasks.",
      "",
      "## Task",
      "Plan the sprint into implementation-ready subtasks.",
      `Project: ${args.projectName}`,
      `Sprint: ${args.sprintNumber ? `SPR-${args.sprintNumber}` : args.sprintName}`,
      `Sprint Name: ${args.sprintName}`,
      "",
      "## Sprint Goal",
      args.goal.trim() || "No sprint goal provided.",
      "",
      "## Constraints",
      "- Prefer 3 to 8 tasks.",
      "- Each task must be independently understandable.",
      "- Dependencies must only reference keys defined earlier in the task list.",
      "- Use `auto` executor unless a task clearly needs `mcp_worker`, `docker_cli`, or `jules`.",
      "",
      "## Required Output",
      "Return JSON only with this exact shape and no surrounding commentary:",
      '{"goal":"Optional refined sprint goal","tasks":[{"key":"TASK-1","title":"Task title","description":"Short intent","promptMarkdown":"Detailed instructions for the task executor","priority":"medium","executorType":"auto","dependsOn":[]}]}',
    ].join("\n");
  }

  private parsePlannedSprintReply(bodyMarkdown: string): PlannedSprintPayload {
    const payload = this.parseJsonReply<PlannedSprintPayload & { subtasks?: unknown[] }>(bodyMarkdown);
    const rawTasks = Array.isArray(payload.tasks)
      ? payload.tasks
      : Array.isArray(payload.subtasks)
        ? payload.subtasks
        : [];
    if (rawTasks.length === 0) {
      throw new Error("Planning agent reply did not include any tasks.");
    }

    const tasks = rawTasks.map((task, index) => {
      const draft = task as PlannedTaskDraft & {
        id?: string;
        name?: string;
        prompt?: string;
        instructions?: string;
        depends_on?: string[];
        dependencies?: string[];
      };
      const key = String(draft.key || draft.id || "").trim() || `TASK-${index + 1}`;
      const title = String(draft.title || draft.name || "").trim();
      const description = String(draft.description || "").trim();
      const promptMarkdown = String(draft.promptMarkdown || draft.prompt || draft.instructions || draft.description || "").trim();
      if (!title || !promptMarkdown) {
        throw new Error(`Planning agent returned an incomplete task for key ${key}.`);
      }
      return {
        key,
        title,
        description,
        promptMarkdown,
        priority: draft.priority,
        executorType: draft.executorType,
        dependsOn: Array.isArray(draft.dependsOn)
          ? draft.dependsOn.map((dependency) => String(dependency || "").trim()).filter(Boolean)
          : Array.isArray(draft.depends_on)
            ? draft.depends_on.map((dependency) => String(dependency || "").trim()).filter(Boolean)
            : Array.isArray(draft.dependencies)
              ? draft.dependencies.map((dependency) => String(dependency || "").trim()).filter(Boolean)
          : [],
      };
    });

    return {
      goal: typeof payload.goal === "string" ? payload.goal : undefined,
      tasks,
    };
  }

  private parseJsonReply<T>(bodyMarkdown: string): T {
    const rawJson = extractJsonLikeBlock(bodyMarkdown);

    try {
      return JSON.parse(rawJson) as T;
    } catch (error) {
      this.deps.logger?.warn("Failed to parse Planning agent reply", {
        bodyMarkdown,
        rawJson,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("Planning agent reply was not valid JSON.");
    }
  }

  private normalizePriority(value: string | undefined): TaskPriority {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") {
      return normalized;
    }
    return "medium";
  }

  private normalizeExecutor(value: string | undefined): TaskExecutorType {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "auto" || normalized === "mcp_worker" || normalized === "docker_cli" || normalized === "jules") {
      return normalized;
    }
    return "auto";
  }

  private requirePlanningWorker(projectId: string): McpConnectionRecord {
    const connections = this.deps.connectionChatRepository.listConnections(projectId);
    const preferredRoles: McpConnectionRole[] = ["worker", "listener"];
    const worker = preferredRoles
      .flatMap((role) => connections.filter((connection) => connection.role === role))
      .find((connection) => (
        connection.capabilities.listenMode === true
        && ["connected", "listening", "idle"].includes(connection.status)
      ));
    if (!worker) {
      throw new Error("No connected listen-mode planning connection is available for this project.");
    }
    return worker;
  }

  private getProviderLabel(provider: DashboardSettings["workers"]["virtualWorkerProvider"]): string {
    switch (provider) {
      case "gemini":
        return "Gemini";
      case "claude-code":
        return "Claude Code";
      case "codex":
      default:
        return "Codex";
    }
  }

  private requireProject(projectId: string): NonNullable<ReturnType<ProjectManagementRepository["getProject"]>> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private requireSprint(
    projectId: string,
    sprintId: string,
  ): NonNullable<ReturnType<ProjectManagementRepository["getSprint"]>> {
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error(`Sprint not found in project: ${sprintId}`);
    }
    return sprint;
  }
}
