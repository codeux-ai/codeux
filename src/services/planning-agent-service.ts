import { randomUUID } from "crypto";
import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";
import type { MemoryService } from "./memory-service.js";
import type { CliWorkflowSettings, DashboardSettings, Subtask } from "../contracts/app-types.js";
import type {
  TaskExecutorType,
  TaskPriority,
  ImprovePromptInput,
  PlanSprintOptions,
  PlanningOverrides,
} from "../contracts/project-management-types.js";
import type { McpConnectionRecord, McpConnectionRole } from "../contracts/connection-chat-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { ExecutionControlService } from "./execution-control-service.js";
import type { Logger } from "../shared/logging/logger.js";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS } from "./cli-workflow-utils.js";
import { buildReadFileRetryPrompt, isReadFileNotFoundToolError } from "./cli-workflow-text-utils.js";
import { ProviderRunner, type IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";
import { resolveProviderForInvocation } from "./provider-routing.js";
import { extractJsonLikeBlock } from "./planning-json-extractor.js";
import { ProviderExecutionService } from "./provider-execution-service.js";

interface PlanningAgentServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  connectionChatRepository: ConnectionChatRepository;
  executionRepository?: ExecutionRepository;
  settingsRepository: SettingsRepository;
  agentPresetSyncService: AgentPresetSyncService;
  executionControlService: ExecutionControlService;
  memoryService?: MemoryService;
  providerRunner?: IProviderRunner;
  logger?: Logger;
}

interface ImprovePromptResult {
  goal: string;
  invocationId: string;
  agentId: string;
  workerConnectionId: string | null;
}

interface PlanSprintResult {
  ok: true;
  invocationId: string;
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

interface VirtualPlanningResult {
  bodyMarkdown: string;
  nativeSessionId: string | null;
  provider: DashboardSettings["workers"]["virtualWorkerProvider"];
  sessionId: string;
  workflowSettings: CliWorkflowSettings;
  providerSettings: { model: string; apiKey: string; thinkingMode?: unknown };
}

export class PlanningAgentService {
  private readonly providerRunner: IProviderRunner;
  private readonly providerExecutionService: ProviderExecutionService;

  constructor(private readonly deps: PlanningAgentServiceDeps) {
    this.providerRunner = deps.providerRunner || new ProviderRunner(new DockerRunner());
    this.providerExecutionService = new ProviderExecutionService({
      executionRepository: deps.executionRepository,
      providerRunner: this.providerRunner,
      logger: deps.logger,
    });
  }

  async improveSprintPrompt(projectId: string, input: ImprovePromptInput, signal?: AbortSignal): Promise<ImprovePromptResult> {
    const project = this.requireProject(projectId);
    const planningAgent = await this.deps.agentPresetSyncService.resolveTargetedPlanningAgent(
      projectId,
      input.overrides?.planningAgentPresetId,
    );
    const runtime = this.resolvePlanningRuntime(projectId, input.overrides);
    const worker = runtime.mode === "CONNECTED_MCP" ? runtime.connection : null;

    let threadId: string | undefined;
    if (worker) {
      const thread = this.deps.connectionChatRepository.createThread(projectId, {
        title: `Planning agent · ${input.name.trim() || "Untitled sprint"} · Improve`,
        connectionId: worker.id,
        scope: "connection",
      });
      threadId = thread.id;
    }

    const invocation = this.deps.executionRepository?.createExecutionInvocation({
      projectId,
      sprintId: null,
      type: "planning",
      status: "running",
      provider: runtime.mode === "VIRTUAL" ? runtime.settings.workers.virtualWorkerProvider : worker?.displayName || null,
      systemPrompt: null,
    });

    const memoryContext = this.buildMemoryContext(projectId, null, planningAgent.id);
    const prompt = this.buildImprovePrompt({
      projectName: project.name,
      planningAgent,
      sprintName: input.name,
      goal: input.goal,
      memoryContext,
    });

    if (invocation) {
      this.deps.executionRepository?.appendExecutionInvocationMessage(invocation.id, {
        role: "user",
        contentMarkdown: prompt,
      });
    }

    signal?.throwIfAborted();
    let payload: { goal?: string };
    try {
      if (worker && threadId) {
        const reply = await this.postRequestAndWaitForReply(projectId, threadId, worker.id, prompt, signal);
        if (invocation) {
          this.deps.executionRepository?.appendExecutionInvocationMessage(invocation.id, {
            role: "assistant",
            contentMarkdown: reply.bodyMarkdown,
          });
        }
        payload = this.parseJsonReply<{ goal?: string }>(reply.bodyMarkdown);
      } else {
        const virtualResult = await this.runVirtualPlanningRequest({
          projectId,
          sprintId: null,
          invocationId: invocation?.id,
          repoPath: project.baseDir,
          settings: runtime.settings,
          rawPrompt: prompt,
          overrides: input.overrides,
          signal,
        });
        payload = await this.parseWithJsonRetry({
          initialResult: virtualResult,
          parseFn: (body) => this.parseJsonReply<{ goal?: string }>(body),
          projectId,
          sprintId: null,
          invocationId: invocation?.id,
          repoPath: project.baseDir,
          settings: runtime.settings,
          signal,
        });
      }

      if (invocation) {
        this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (invocation) {
        this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date().toISOString(),
        });
      }
      throw error;
    }

    const goal = String(payload.goal || "").trim();
    if (!goal) {
      throw new Error("Planning agent reply did not include an improved sprint prompt.");
    }

    this.captureDecisionMemory(projectId, null, planningAgent.id,
      `Sprint goal refined: "${input.goal.trim().slice(0, 100)}" → "${goal.slice(0, 100)}"`,
      0.7,
    );

    return {
      goal,
      invocationId: invocation?.id || "",
      agentId: planningAgent.id,
      workerConnectionId: worker?.id || null,
    };
  }

  async planSprint(projectId: string, sprintId: string, options: PlanSprintOptions, signal?: AbortSignal): Promise<PlanSprintResult> {
    const project = this.requireProject(projectId);
    const sprint = this.requireSprint(projectId, sprintId);
    const planningAgent = await this.deps.agentPresetSyncService.resolveTargetedPlanningAgent(
      projectId,
      options.overrides?.planningAgentPresetId,
    );
    const runtime = this.resolvePlanningRuntime(projectId, options.overrides);
    const worker = runtime.mode === "CONNECTED_MCP" ? runtime.connection : null;

    const existingTasks = this.deps.projectManagementRepository.listTasks(projectId, sprintId);
    if (existingTasks.length > 0 && !options.replan) {
      throw new Error(`Sprint ${sprint.name} already has ${existingTasks.length} task(s). Clear or edit them before running Planning agent.`);
    }

    let threadId: string | undefined;
    if (worker) {
      const thread = this.deps.connectionChatRepository.createThread(projectId, {
        title: `Planning agent · ${sprint.name} · Plan`,
        connectionId: worker.id,
        scope: "connection",
      });
      threadId = thread.id;
    }

    const invocation = this.deps.executionRepository?.createExecutionInvocation({
      projectId,
      sprintId,
      type: "planning",
      status: "running",
      provider: runtime.mode === "VIRTUAL" ? runtime.settings.workers.virtualWorkerProvider : worker?.displayName || null,
      systemPrompt: null,
    });

    signal?.throwIfAborted();
    const memoryContext = this.buildMemoryContext(projectId, sprintId, planningAgent.id);
    const prompt = this.buildPlanPrompt({
      projectName: project.name,
      planningAgent,
      sprintNumber: sprint.number,
      sprintName: sprint.name,
      goal: sprint.goal,
      memoryContext,
    });

    if (invocation) {
      this.deps.executionRepository?.appendExecutionInvocationMessage(invocation.id, {
        role: "user",
        contentMarkdown: prompt,
      });
    }

    let payload: PlannedSprintPayload;
    try {
      if (worker && threadId) {
        const reply = await this.postRequestAndWaitForReply(projectId, threadId, worker.id, prompt, signal);
        if (invocation) {
          this.deps.executionRepository?.appendExecutionInvocationMessage(invocation.id, {
            role: "assistant",
            contentMarkdown: reply.bodyMarkdown,
          });
        }
        payload = this.parsePlannedSprintReply(reply.bodyMarkdown);
      } else {
        const virtualResult = await this.runVirtualPlanningRequest({
          projectId,
          sprintId,
          invocationId: invocation?.id,
          repoPath: project.baseDir,
          settings: runtime.settings,
          rawPrompt: prompt,
          overrides: options.overrides,
          signal,
        });
        payload = await this.parseWithJsonRetry({
          initialResult: virtualResult,
          parseFn: (body) => this.parsePlannedSprintReply(body),
          projectId,
          sprintId,
          invocationId: invocation?.id,
          repoPath: project.baseDir,
          settings: runtime.settings,
          signal,
        });
      }

      if (invocation) {
        this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (invocation) {
        this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date().toISOString(),
        });
      }
      throw error;
    }

    if (options.replan) {
      this.deps.projectManagementRepository.deleteTasksBySprint(sprintId);
    }

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
        taskKey: task.key,
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

    const taskTitles = payload.tasks.map(t => t.title).join(", ");
    this.captureDecisionMemory(projectId, sprintId, planningAgent.id,
      `Sprint planned with ${payload.tasks.length} tasks: ${taskTitles.slice(0, 200)}. Goal: ${(sprint.goal || "").slice(0, 100)}`,
      0.8,
    );

    if (options.autoStart) {
      await this.deps.executionControlService.orchestrateSprint(projectId, sprintId);
    }

    return {
      ok: true,
      invocationId: invocation?.id || "",
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
    signal?: AbortSignal,
  ): Promise<{ bodyMarkdown: string }> {
    signal?.throwIfAborted();
    const sentMessage = this.deps.connectionChatRepository.postDashboardMessage(projectId, {
      threadId,
      connectionId,
      bodyMarkdown,
    });
    const timeoutAt = Date.now() + 60_000;

    while (Date.now() < timeoutAt) {
      signal?.throwIfAborted();
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

  private resolvePlanningRuntime(projectId: string, overrides?: PlanningOverrides): {
    mode: "CONNECTED_MCP" | "VIRTUAL";
    settings: DashboardSettings;
    connection: McpConnectionRecord | null;
  } {
    const settings = this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;

    if (overrides?.workerId) {
      const connections = this.deps.connectionChatRepository.listConnections(projectId);
      const connection = connections.find(c => c.id === overrides.workerId);
      if (connection && (connection.status === "listening" || connection.status === "connected" || connection.status === "idle")) {
        return {
          mode: "CONNECTED_MCP",
          settings,
          connection,
        };
      }
    }

    if (overrides?.virtualProvider) {
      return {
        mode: "VIRTUAL",
        settings: {
          ...settings,
          workers: {
            ...settings.workers,
            executionMode: "VIRTUAL",
            virtualWorkerProvider: overrides.virtualProvider,
          },
        },
        connection: null,
      };
    }

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
    sprintId: string | null;
    invocationId?: string;
    repoPath: string;
    settings: DashboardSettings;
    rawPrompt: string;
    overrides?: PlanningOverrides;
    signal?: AbortSignal;
  }): Promise<VirtualPlanningResult> {
    const routingTask: Subtask = {
      id: args.sprintId || "planning",
      title: "Planning request",
      prompt: args.rawPrompt,
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };
    const route = resolveProviderForInvocation(args.settings, {
      invocation: "planning",
      task: routingTask,
      providerPool: ["gemini", "codex", "claude-code"],
    });
    const provider = (args.overrides?.virtualProvider || route.provider) as DashboardSettings["workers"]["virtualWorkerProvider"];
    const providerSettings = { ...route.providers[provider] };
    if (!providerSettings) {
      throw new Error(`Virtual worker provider "${provider}" is not configured. Check AI Provider settings.`);
    }

    if (args.overrides?.virtualModel) {
      providerSettings.model = args.overrides.virtualModel;
    }

    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...args.settings.cliWorkflow,
    };
    const sessionId = `planning-${provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const providerPrompt = buildProviderPrompt(args.rawPrompt, providerSettings.thinkingMode);

    if (args.invocationId) {
      this.deps.executionRepository?.updateExecutionInvocation(args.invocationId, {
        provider,
        model: providerSettings.model,
      });
      this.deps.executionRepository?.appendExecutionInvocationMessage(args.invocationId, {
        role: "system",
        contentMarkdown: `Planning request routed through virtual ${this.getProviderLabel(provider)} worker (model: ${providerSettings.model}).`,
        metadata: {
          provider,
          model: providerSettings.model,
          routeKind: "virtual",
        },
      });
    }

    const result = await this.providerExecutionService.executeProvider({
      projectId: args.projectId,
      sprintId: args.sprintId,
      purpose: "planning",
      type: "planning",
      provider,
      prompt: providerPrompt,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      sessionId,
      workflowSettings,
      repoPath: args.repoPath,
      githubToken: args.settings.git.githubToken,
      signal: args.signal,
      expectTextOutput: true,
      invocationId: args.invocationId,
      onActivity: (description, originator) => {
        this.deps.logger?.debug("Virtual planning worker activity", {
          projectId: args.projectId,
          invocationId: args.invocationId,
          provider,
          originator: originator || "system",
          description,
        });
      },
    });

    if (!result.ok) {
      this.deps.logger?.error("Virtual planning provider failed", {
        projectId: args.projectId,
        provider,
        exitCode: result.code,
        stderr: result.stderr?.slice(0, 500),
        stdout: result.stdout?.slice(0, 500),
      });
      throw new Error(`Virtual ${this.getProviderLabel(provider)} worker failed: ${result.stderr || result.stdout}`);
    }

    const bodyMarkdown = (result as any).text.trim();
    if (!bodyMarkdown) {
      throw new Error(`Virtual ${this.getProviderLabel(provider)} worker returned an empty Planning agent reply.`);
    }

    return {
      bodyMarkdown,
      nativeSessionId: result.nativeSessionId,
      provider,
      sessionId,
      workflowSettings,
      providerSettings: {
        model: providerSettings.model,
        apiKey: providerSettings.apiKey,
        thinkingMode: providerSettings.thinkingMode,
      },
    };
  }

  private async runVirtualPlanningFollowUp(args: {
    projectId: string;
    sprintId: string | null;
    invocationId?: string;
    repoPath: string;
    settings: DashboardSettings;
    previousResult: VirtualPlanningResult;
    followUpPrompt: string;
    signal?: AbortSignal;
  }): Promise<VirtualPlanningResult> {
    const { previousResult } = args;
    const { provider, sessionId, workflowSettings, providerSettings } = previousResult;

    if (args.invocationId) {
      this.deps.executionRepository?.appendExecutionInvocationMessage(args.invocationId, {
        role: "system",
        contentMarkdown: `Retrying JSON parse in same ${this.getProviderLabel(provider)} session (session: ${sessionId}).`,
        metadata: {
          provider,
          model: providerSettings.model,
          routeKind: "virtual",
        },
      });
    }

    const result = await this.providerExecutionService.executeProvider({
      projectId: args.projectId,
      sprintId: args.sprintId,
      purpose: "planning",
      type: "planning",
      provider,
      prompt: args.followUpPrompt,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      sessionId,
      workflowSettings,
      repoPath: args.repoPath,
      githubToken: args.settings.git.githubToken,
      signal: args.signal,
      expectTextOutput: true,
      invocationId: args.invocationId,
      continueSessionId: previousResult.nativeSessionId || previousResult.sessionId,
      onActivity: (description, originator) => {
        this.deps.logger?.debug("Virtual planning JSON retry activity", {
          projectId: args.projectId,
          invocationId: args.invocationId,
          provider,
          originator: originator || "system",
          description,
        });
      },
    });

    const bodyMarkdown = (result as any).text?.trim();
    if (!result.ok || !bodyMarkdown) {
      throw new Error(`Virtual ${this.getProviderLabel(provider)} worker JSON retry returned no usable output.`);
    }

    return {
      bodyMarkdown,
      nativeSessionId: result.nativeSessionId || previousResult.nativeSessionId,
      provider,
      sessionId,
      workflowSettings,
      providerSettings,
    };
  }

  private async parseWithJsonRetry<T>(args: {
    initialResult: VirtualPlanningResult;
    parseFn: (bodyMarkdown: string) => T;
    projectId: string;
    sprintId: string | null;
    invocationId?: string;
    repoPath: string;
    settings: DashboardSettings;
    signal?: AbortSignal;
  }): Promise<T> {
    const maxRetries = args.settings.cliWorkflow?.maxPlanningJsonRetries ?? 3;
    let currentResult = args.initialResult;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return args.parseFn(currentResult.bodyMarkdown);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt >= maxRetries) break;

        this.deps.logger?.warn("Planning agent JSON parse failed, retrying in same session", {
          projectId: args.projectId,
          attempt: attempt + 1,
          maxRetries,
          error: lastError.message,
        });

        const followUpPrompt = [
          "Your previous output could not be parsed as valid JSON.",
          `Parse error: ${lastError.message}`,
          "",
          "Please output ONLY the valid JSON sprint definition. Requirements:",
          "- Output raw JSON only — no markdown fences, no commentary, no prose before or after.",
          "- Ensure all string values are properly escaped (especially quotes and newlines inside promptMarkdown).",
          "- Use the exact schema from the original instructions: {\"goal\":\"...\",\"tasks\":[...]}",
        ].join("\n");

        currentResult = await this.runVirtualPlanningFollowUp({
          projectId: args.projectId,
          sprintId: args.sprintId,
          invocationId: args.invocationId,
          repoPath: args.repoPath,
          settings: args.settings,
          previousResult: currentResult,
          followUpPrompt,
          signal: args.signal,
        });
      }
    }

    throw lastError || new Error("Planning agent reply was not valid JSON.");
  }

  private buildImprovePrompt(args: {
    projectName: string;
    planningAgent: AgentPresetRecord;
    sprintName: string;
    goal: string;
    memoryContext?: string;
  }): string {
    const parts = [
      "You are Sprint OS's Planning agent.",
      "",
      "## Planning Agent Instructions",
      args.planningAgent.instructionMarkdown.trim() || "Refine sprint prompts into crisp, implementation-ready scopes.",
      "",
      "## Task",
      "Scan the repository to understand the context, then improve the sprint prompt. Do not break it into tasks yet.",
      `Project: ${args.projectName}`,
      `Sprint: ${args.sprintName.trim() || "Untitled sprint"}`,
      "",
      "## Current Prompt",
      args.goal.trim() || "No prompt provided.",
    ];
    if (args.memoryContext) {
      parts.push("", args.memoryContext);
    }
    parts.push(
      "",
      "## Guidance",
      "- Use file discovery or codebase search to clarify symbols, paths, or architectural patterns mentioned or implied by the prompt.",
      "- Ground the improved prompt in the actual reality of the codebase.",
      "- Be concise but technically precise.",
      "",
      "## Required Output",
      "Return JSON only with this exact shape and no surrounding commentary:",
      '{"goal":"Improved sprint prompt"}',
    );
    return parts.join("\n");
  }

  private buildPlanPrompt(args: {
    projectName: string;
    planningAgent: AgentPresetRecord;
    sprintNumber: number | null;
    sprintName: string;
    goal: string;
    memoryContext?: string;
  }): string {
    const memorySection = args.memoryContext ? `\n${args.memoryContext}\n` : "";
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
      memorySection,
      "",
      "## Constraints",
      "- Plan as a DAG, not as a flat checklist.",
      "- Prefer 3 to 8 tasks unless the scope clearly demands more or fewer.",
      "- Maximize parallelism; add dependencies only for true code blockers.",
      "- Each task must be independently understandable and self-contained.",
      "- Each task key must use `T01`, `T02`, `T03`, ... in topological order.",
      "- Dependencies must only reference keys defined earlier in the task list.",
      "- Do not create branch, PR, merge, coordination, analysis-only, or placeholder tasks.",
      "- Use `auto` executor unless a task clearly needs `mcp_worker`, `docker_cli`, or `jules`.",
      "- `description` must be one concise sentence.",
      "- `promptMarkdown` must use this exact section order: `## Objective`, `## Scope`, `## Implementation Requirements`, `## Constraints`, `## Verification`.",
      "- `promptMarkdown` must name exact files, modules, or symbols whenever they can be inferred.",
      "",
      "## Output Rules",
      "- Return JSON only.",
      "- Return one top-level object with `goal` and `tasks`.",
      "- Return one ordered `tasks` array for the full DAG.",
      "- Do not wrap the JSON in prose.",
      "",
      "## Task Object Schema",
      "{",
      '  "key": "T01",',
      '  "title": "Short imperative title",',
      '  "description": "One-sentence outcome statement.",',
      '  "promptMarkdown": "## Objective\\n...\\n\\n## Scope\\n- ...\\n\\n## Implementation Requirements\\n1. ...\\n\\n## Constraints\\n- ...\\n\\n## Verification\\n- ...",',
      '  "priority": "medium",',
      '  "executorType": "auto",',
      '  "dependsOn": []',
      "}",
      "",
      "## Example Output A",
      "{",
      '  "goal": "Add project override indicators and keep inherited fields unbadged.",',
      '  "tasks": [',
      "    {",
      '      "key": "T01",',
      '      "title": "Add override metadata helper",',
      '      "description": "Create a shared helper that resolves whether each settings field is overridden at project scope.",',
      '      "promptMarkdown": "## Objective\\nAdd a shared helper that converts effective settings source metadata into per-field override display state for the project settings UI.\\n\\n## Scope\\n- dashboard/src/v2/lib/settings-view-models.ts\\n- tests/dashboard/lib/settings-view-models.test.ts\\n\\n## Implementation Requirements\\n1. Add a helper that determines whether a field is overridden or inherited.\\n2. Return no badge state for inherited values.\\n3. Cover overridden and inherited cases with focused tests.\\n\\n## Constraints\\n- Keep source resolution centralized.\\n- Preserve existing effective settings contracts.\\n\\n## Verification\\n- Run the focused settings view-model test file.\\n- Confirm overridden fields resolve to override state and inherited fields resolve to no badge state.",',
      '      "priority": "high",',
      '      "executorType": "auto",',
      '      "dependsOn": []',
      "    },",
      "    {",
      '      "key": "T02",',
      '      "title": "Render override badges in settings UI",',
      '      "description": "Apply the shared override metadata to the project settings controls.",',
      '      "promptMarkdown": "## Objective\\nUse the shared override metadata helper to render the project override badge only on overridden settings controls.\\n\\n## Scope\\n- dashboard/src/v2/SettingsPage.tsx\\n- dashboard/src/v2/components/settings/ProjectSettingsEditor.tsx\\n\\n## Implementation Requirements\\n1. Read per-field override metadata from the shared helper.\\n2. Show the badge only for overridden controls.\\n3. Keep inherited controls free of placeholder badge UI.\\n\\n## Constraints\\n- Reuse existing settings row patterns.\\n- Keep layout stable when no badge is present.\\n\\n## Verification\\n- Verify overridden controls show the badge and inherited controls do not.\\n- Run relevant dashboard tests if present.",',
      '      "priority": "medium",',
      '      "executorType": "auto",',
      '      "dependsOn": ["T01"]',
      "    }",
      "  ]",
      "}",
      "",
      "## Example Output B",
      "{",
      '  "goal": "Fix sprint finalization so no-output tasks do not block completion.",',
      '  "tasks": [',
      "    {",
      '      "key": "T01",',
      '      "title": "Centralize merge settlement rules",',
      '      "description": "Create a shared helper that classifies whether a completed task still has merge work outstanding.",',
      '      "promptMarkdown": "## Objective\\nIntroduce one shared helper for deciding whether a completed task is coding-complete only or fully complete, including the no-output case.\\n\\n## Scope\\n- src/domain/sprint/task-merge-state.ts\\n- src/domain/sprint/ci/feature-pr-gate.ts\\n- tests/backend/domain/sprint/ci/feature-pr-gate.test.ts\\n\\n## Implementation Requirements\\n1. Add a reusable helper for merge settlement classification.\\n2. Treat completed tasks with no PR URL and no worker branch as settled.\\n3. Cover the no-output case with regression tests.\\n\\n## Constraints\\n- Preserve existing behavior for PR-backed tasks.\\n- Keep the helper side-effect free.\\n\\n## Verification\\n- Run focused backend tests for feature PR gating.\\n- Confirm no-output tasks are treated as settled while PR-backed tasks still wait for merge when required.",',
      '      "priority": "high",',
      '      "executorType": "auto",',
      '      "dependsOn": []',
      "    },",
      "    {",
      '      "key": "T02",',
      '      "title": "Use merge settlement helper in sprint completion",',
      '      "description": "Apply the shared settlement rules to watch-loop and status-derivation completion decisions.",',
      '      "promptMarkdown": "## Objective\\nUpdate sprint finalization so tasks without merge work advance cleanly to final completion and do not block sprint completion.\\n\\n## Scope\\n- src/domain/sprint/orchestrator/watch-loop-runner.ts\\n- src/sprint/steps/status-derivation-step.ts\\n- src/sprint/steps/protocol-step.ts\\n- tests/backend/sprint/watch-loop-core.test.ts\\n\\n## Implementation Requirements\\n1. Replace duplicated merge-wait logic with the shared helper.\\n2. Auto-complete tasks that have no merge work after coding is done.\\n3. Add regression coverage for sprint completion with no-output tasks.\\n\\n## Constraints\\n- Do not mark PR-backed tasks complete before merge conditions are satisfied.\\n- Keep dependency unlock behavior consistent.\\n\\n## Verification\\n- Run focused sprint runtime tests.\\n- Confirm no-output tasks complete automatically and real merge-backed tasks still wait when required.",',
      '      "priority": "high",',
      '      "executorType": "auto",',
      '      "dependsOn": ["T01"]',
      "    }",
      "  ]",
      "}",
      "",
      "## Required Output",
      "Return JSON only with this exact shape and no surrounding commentary:",
      '{"goal":"Optional refined sprint goal","tasks":[{"key":"T01","title":"Task title","description":"Short intent","promptMarkdown":"## Objective\\n...\\n\\n## Scope\\n- ...\\n\\n## Implementation Requirements\\n1. ...\\n\\n## Constraints\\n- ...\\n\\n## Verification\\n- ...","priority":"medium","executorType":"auto","dependsOn":[]}]}',
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

    const seenKeys = new Set<string>();
    const tasks = rawTasks.map((task, index) => {
      const draft = task as PlannedTaskDraft & {
        id?: string;
        name?: string;
        prompt?: string;
        instructions?: string;
        depends_on?: string[];
        dependencies?: string[];
      };
      const key = String(draft.key || draft.id || "").trim() || `T${String(index + 1).padStart(2, "0")}`;
      if (seenKeys.has(key)) {
        throw new Error(`Planning agent returned duplicate task key: ${key}.`);
      }
      seenKeys.add(key);

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

  private buildMemoryContext(projectId: string, sprintId: string | null, agentPresetId: string): string | undefined {
    const memoryService = this.deps.memoryService;
    if (!memoryService) return undefined;

    try {
      const longTerm = memoryService.listLongTermByAgent(projectId, agentPresetId, 10);
      const shortTerm = sprintId
        ? memoryService.listBySprintAndAgent(projectId, sprintId, agentPresetId, 10)
        : [];

      if (longTerm.length === 0 && shortTerm.length === 0) return undefined;

      const sections: string[] = ["## PROJECT CONTEXT FROM MEMORY"];
      if (longTerm.length > 0) {
        sections.push("### Long-Term Knowledge");
        for (const m of longTerm) sections.push(`- [${m.category}] ${m.content.slice(0, 300)}`);
      }
      if (shortTerm.length > 0) {
        sections.push("### Recent Sprint Learnings");
        for (const m of shortTerm) sections.push(`- [${m.category}] ${m.content.slice(0, 300)}`);
      }
      return sections.join("\n");
    } catch {
      return undefined;
    }
  }

  private captureDecisionMemory(
    projectId: string,
    sprintId: string | null,
    agentPresetId: string,
    content: string,
    strength: number,
  ): void {
    this.deps.memoryService?.createMemory(projectId, {
      scope: "sprint",
      sprintId,
      agentPresetId,
      content,
      category: "decision",
      strength,
      source: {
        type: "auto_capture",
        originType: "planning_agent",
        agent: "planning",
      },
    }).catch((err) => {
      this.deps.logger?.warn("Failed to capture planning decision memory", {
        projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
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
