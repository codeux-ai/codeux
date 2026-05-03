import { randomUUID } from "crypto";
import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";
import type { MemoryService } from "./memory-service.js";
import type { CliWorkflowSettings, DashboardSettings, ProviderId, Subtask } from "../contracts/app-types.js";
import type {
  TaskExecutorType,
  TaskPriority,
  ImprovePromptInput,
  PlanSprintOptions,
  PlanningOverrides,
} from "../contracts/project-management-types.js";
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
import { WorkspaceManager } from "../infrastructure/providers/cli/workspace-manager.js";
import { resolveAgentMemoryInstructions } from "./agent-memory-instructions.js";
import { resolveProviderForInvocation } from "./provider-routing.js";
import { parsePlannedSprintReply, PlanningParseError } from "./planning-json-extractor.js";
import { extractJsonFromText } from "../domain/llm/json-extraction.js";
import type { PlannedSprintPayload, PlannedTaskDraft } from "../contracts/project-management-types.js";
import { persistPlannedTasks } from "./planning-task-persistence.js";
import { ProviderExecutionService } from "./provider-execution-service.js";
import { StructuredAgentRequestService, type StructuredAgentRequestResult } from "./structured-agent-request-service.js";
import { StructuredProviderResponseService } from "./structured-provider-response-service.js";
import { waitUntil } from "../shared/polling/wait-until.js";
import { LEARNINGS_FILENAME } from "../contracts/memory-types.js";
import * as PlanningPromptBuilder from "./planning-prompt-builder.js";

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
  providerExecutionService?: ProviderExecutionService;
  structuredAgentRequestService?: StructuredAgentRequestService;
}

interface ImprovePromptResult {
  goal: string;
  invocationId: string;
  agentId: string;
  workerConnectionId: null;
}

interface PlanSprintResult {
  ok: true;
  invocationId: string;
  agentId: string;
  createdTaskIds: string[];
  started: boolean;
}

interface PlanningResultContext {
  provider: Exclude<ProviderId, "jules">;
  sessionId: string;
  workflowSettings: CliWorkflowSettings;
  providerSettings: {
    model: string;
    apiKey: string;
    thinkingMode?: unknown;
    qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
    qwenRegion?: "china" | "international";
    qwenBaseUrl?: string;
    qwenEnvKey?: string;
    qwenProtocol?: "openai" | "anthropic" | "gemini";
  };
  memoryCaptureWorkspacePath: string;
  cleanupWorkspace?: () => Promise<void>;
}

export class PlanningAgentService {
  private readonly providerRunner: IProviderRunner;
  private readonly providerExecutionService: ProviderExecutionService;
  private readonly structuredAgentRequestService: StructuredAgentRequestService;
  private readonly workspaceManager = new WorkspaceManager();

  constructor(private readonly deps: PlanningAgentServiceDeps) {
    this.providerRunner = deps.providerRunner || new ProviderRunner(new DockerRunner());
    this.providerExecutionService = deps.providerExecutionService || new ProviderExecutionService({
      executionRepository: deps.executionRepository,
      providerRunner: this.providerRunner,
      logger: deps.logger,
    });

    if (deps.structuredAgentRequestService) {
      this.structuredAgentRequestService = deps.structuredAgentRequestService;
    } else {
      const structuredProviderResponseService = new StructuredProviderResponseService({
        providerExecutionService: this.providerExecutionService,
        executionRepository: deps.executionRepository,
        logger: deps.logger,
      });
      this.structuredAgentRequestService = new StructuredAgentRequestService({
        executionRepository: deps.executionRepository,
        structuredProviderResponseService,
        logger: deps.logger,
      });
    }
  }

  async improveSprintPrompt(projectId: string, input: ImprovePromptInput, signal?: AbortSignal): Promise<ImprovePromptResult> {
    const project = this.requireProject(projectId);
    const planningAgent = await this.deps.agentPresetSyncService.resolveTargetedPlanningAgent(
      projectId,
      input.overrides?.planningAgentPresetId,
    );
    const runtime = this.resolvePlanningRuntime(projectId, input.overrides);
    const invocation = this.deps.executionRepository?.createExecutionInvocation({
      projectId,
      skipValidation: true,
      sprintId: null,
      type: "planning",
      status: "running",
      provider: runtime.settings.workers.virtualWorkerProvider,
      systemPrompt: null,
    });

    const memoryContext = this.buildMemoryContext(projectId, null, planningAgent.id);
    const learningsInstruction = (runtime.settings.memory?.enabled && runtime.settings.memory?.autoCaptureSprint)
      ? resolveAgentMemoryInstructions(planningAgent, runtime.settings.memory?.workerLearningsInstruction)
      : undefined;

    const prompt = PlanningPromptBuilder.buildImprovePrompt({
      projectName: project.name,
      planningAgent,
      sprintName: input.name,
      goal: input.goal,
      memoryContext,
      learningsInstruction,
    });

    const isMemoryCaptureEnabled = !!learningsInstruction;

    if (invocation) {
      this.deps.executionRepository?.appendExecutionInvocationMessage(invocation.id, {
        role: "user",
        contentMarkdown: prompt,
      });
    }

    signal?.throwIfAborted();
    let payload: { goal?: string };
    let cleanupWorkspace: (() => Promise<void>) | undefined;
    try {
      const virtualResult = await this.runVirtualPlanningRequest({
        projectId,
        sprintId: null,
        invocationId: invocation?.id,
        repoPath: project.baseDir,
        settings: runtime.settings,
        rawPrompt: prompt,
        overrides: input.overrides,
        signal,
        parseFn: (bodyMarkdown) => this.parseJsonReply<{ goal?: string }>(bodyMarkdown),
        buildRetryPrompt: (lastError) => [
          "Your previous output could not be parsed as valid JSON.",
          `Parse error: ${lastError.message}`,
          "",
          "Please output ONLY valid JSON.",
          "- Output raw JSON only — no markdown fences, no commentary, no prose before or after."
        ].join("\n"),
      });
      payload = virtualResult.parsed;
      cleanupWorkspace = virtualResult.cleanupWorkspace;

      if (invocation) {
        this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
      }

      if (isMemoryCaptureEnabled) {
        await this.captureMemoriesFromWorkspace(
          projectId,
          undefined,
          planningAgent.id,
          virtualResult.memoryCaptureWorkspacePath,
          invocation?.id || ""
        );
      }
    } catch (error) {
//

      if (invocation) {
        this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date().toISOString(),
        });
      }
      throw error;
    } finally {
      await cleanupWorkspace?.().catch(() => undefined);
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
      workerConnectionId: null,
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
    const existingTasks = this.deps.projectManagementRepository.listTasks(projectId, sprintId);
    if (existingTasks.length > 0 && !options.replan) {
      throw new Error(`Sprint ${sprint.name} already has ${existingTasks.length} task(s). Clear or edit them before running Planning agent.`);
    }

    const invocation = this.deps.executionRepository?.createExecutionInvocation({
      projectId,
      skipValidation: true,
      sprintId,
      type: "planning",
      status: "running",
      provider: runtime.settings.workers.virtualWorkerProvider,
      systemPrompt: null,
    });

    signal?.throwIfAborted();
    const memoryContext = this.buildMemoryContext(projectId, sprintId, planningAgent.id);
    const learningsInstruction = (runtime.settings.memory?.enabled && runtime.settings.memory?.autoCaptureSprint)
      ? resolveAgentMemoryInstructions(planningAgent, runtime.settings.memory?.workerLearningsInstruction)
      : undefined;

    const prompt = PlanningPromptBuilder.buildPlanPrompt({
      projectName: project.name,
      planningAgent,
      sprintNumber: sprint.number,
      sprintName: sprint.name,
      goal: sprint.goal,
      memoryContext,
      learningsInstruction,
    });

    const isMemoryCaptureEnabled = !!learningsInstruction;

    if (invocation) {
      this.deps.executionRepository?.appendExecutionInvocationMessage(invocation.id, {
        role: "user",
        contentMarkdown: prompt,
      });
    }

    let payload: PlannedSprintPayload;
    let cleanupWorkspace: (() => Promise<void>) | undefined;
    try {
      const virtualResult = await this.runVirtualPlanningRequest({
        projectId,
        sprintId,
        invocationId: invocation?.id,
        repoPath: project.baseDir,
        settings: runtime.settings,
        rawPrompt: prompt,
        overrides: options.overrides,
        signal,
        parseFn: (bodyMarkdown) => parsePlannedSprintReply(bodyMarkdown),
        buildRetryPrompt: (lastError) => [
          "Your previous output could not be parsed as valid JSON.",
          `Parse error: ${lastError.message}`,
          "",
          "Please output ONLY the valid JSON sprint definition. Requirements:",
          "- Output raw JSON only — no markdown fences, no commentary, no prose before or after.",
          "- Ensure all string values are properly escaped (especially quotes and newlines inside promptMarkdown).",
          "- Use the exact schema from the original instructions: {\"goal\":\"...\",\"tasks\":[...]}"
        ].join("\n"),
      });
      payload = virtualResult.parsed;
      cleanupWorkspace = virtualResult.cleanupWorkspace;

      if (invocation) {
        this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
      }

      if (isMemoryCaptureEnabled) {
        await this.captureMemoriesFromWorkspace(
          projectId,
          sprintId,
          planningAgent.id,
          virtualResult.memoryCaptureWorkspacePath,
          invocation?.id || ""
        );
      }
    } catch (error) {
      if (error instanceof PlanningParseError && options.sprintRunId) {
        this.deps.executionRepository?.appendSprintRunEvent(
          options.sprintRunId,
          "planning_parse_failure_blocked",
          "system",
          { reason: error.reason, attempts: error.attempts, rawResponse: error.rawContent }
        );
      }

      if (invocation) {
        this.deps.executionRepository?.updateExecutionInvocation(invocation.id, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date().toISOString(),
        });
      }
      throw error;
    } finally {
      await cleanupWorkspace?.().catch(() => undefined);
    }

    if (options.replan) {
      this.deps.projectManagementRepository.deleteTasksBySprint(sprintId);
    }

    if (payload.goal && payload.goal.trim() && payload.goal.trim() !== sprint.goal.trim()) {
      this.deps.projectManagementRepository.updateSprint(sprint.id, {
        goal: payload.goal.trim(),
      });
    }

    const { createdTaskIds } = persistPlannedTasks(
      projectId,
      sprintId,
      payload.tasks,
      this.deps.projectManagementRepository,
    );

    const titles: string[] = [];
    for (const t of payload.tasks) {
      titles.push(t.title);
    }
    const taskTitles = titles.join(", ");
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

  private resolvePlanningRuntime(projectId: string, overrides?: PlanningOverrides): {
    mode: "VIRTUAL";
    settings: DashboardSettings;
    connection: null;
  } {
    const settings = this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;

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

    return {
      mode: "VIRTUAL",
      settings,
      connection: null,
    };
  }

  private async runVirtualPlanningRequest<T>(args: {
    projectId: string;
    sprintId: string | null;
    invocationId?: string;
    repoPath: string;
    settings: DashboardSettings;
    rawPrompt: string;
    overrides?: PlanningOverrides;
    signal?: AbortSignal;
    parseFn: (bodyMarkdown: string) => T;
    buildRetryPrompt: (lastError: Error) => string;
  }): Promise<StructuredAgentRequestResult<T> & PlanningResultContext> {
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
      providerPool: ["gemini", "codex", "claude-code", "qwen-code", "opencode"],
    });
    const providerConfigId = args.overrides?.virtualProvider
      ? Object.entries(route.providers).find(([, candidate]) => candidate.provider === args.overrides?.virtualProvider)?.[0] || route.providerConfigId
      : route.providerConfigId;
    const baseProviderSettings = route.providers[providerConfigId];
    if (!baseProviderSettings) {
      throw new Error(`Virtual worker provider "${providerConfigId}" is not configured. Check AI Provider settings.`);
    }
    const providerSettings = { ...baseProviderSettings };
    const provider = providerSettings.provider as Exclude<ProviderId, "jules">;

    if (args.overrides?.virtualModel) {
      providerSettings.model = args.overrides.virtualModel;
    }

    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...args.settings.cliWorkflow,
    };
    const providerPrompt = buildProviderPrompt(args.rawPrompt, providerSettings.thinkingMode);
    const systemRoutingMessage = `Planning request routed through virtual ${this.getProviderLabel(provider)} worker (model: ${providerSettings.model}).`;
    let snapshotWorkspace = args.repoPath;
    let cleanupWorkspace: (() => Promise<void>) | undefined;
    if (workflowSettings.executionMode === "DOCKER") {
      snapshotWorkspace = await this.workspaceManager.createSnapshotWorkspace(
        args.repoPath,
        `planning-${provider}-${Date.now().toString(36)}`,
      );
      cleanupWorkspace = async () => {
        await this.workspaceManager.removeWorktree(args.repoPath, snapshotWorkspace).catch(() => undefined);
      };
    }

    try {
      const result = await this.structuredAgentRequestService.executeRequest<T>({
        projectId: args.projectId,
        sprintId: args.sprintId,
        purpose: "planning",
        type: "planning",
        provider,
        model: providerSettings.model,
        apiKey: providerSettings.apiKey,
        qwenAuthMode: providerSettings.qwenAuthMode,
        qwenRegion: providerSettings.qwenRegion,
        qwenBaseUrl: providerSettings.qwenBaseUrl,
        qwenEnvKey: providerSettings.qwenEnvKey,
        qwenProtocol: providerSettings.qwenProtocol,
        providerMountAuth: providerSettings.mountAuth,
        providerAuthPath: providerSettings.authPath,
        providerPrompt: args.rawPrompt,
        repoPath: args.repoPath,
        cwd: snapshotWorkspace,
        workspaceSessionId: `${args.projectId}-planning-snapshot`,
        settings: {
          ...args.settings,
          cliWorkflow: workflowSettings,
        },
        parseFn: args.parseFn,
        buildRetryPrompt: args.buildRetryPrompt,
        providerLabel: this.getProviderLabel(provider),
        sessionIdPrefix: "planning",
        invocationId: args.invocationId,
        systemRoutingMessage,
        githubToken: args.settings.git.githubToken,
        signal: args.signal,
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

      return {
        ...result,
        provider,
        sessionId: result.sessionId,
        workflowSettings,
        memoryCaptureWorkspacePath: snapshotWorkspace,
        cleanupWorkspace,
        providerSettings: {
          model: providerSettings.model,
          apiKey: providerSettings.apiKey,
          qwenAuthMode: providerSettings.qwenAuthMode,
          qwenRegion: providerSettings.qwenRegion,
          qwenBaseUrl: providerSettings.qwenBaseUrl,
          qwenEnvKey: providerSettings.qwenEnvKey,
          qwenProtocol: providerSettings.qwenProtocol,
          thinkingMode: providerSettings.thinkingMode,
        },
      };
    } catch (error) {
      if (args.invocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(args.invocationId, {
          status: "failed",
          finishedAt: new Date().toISOString(),
        });
      }
      await cleanupWorkspace?.().catch(() => undefined);
      throw error;
    }
  }


  private parseJsonReply<T>(bodyMarkdown: string): T {
    const extraction = extractJsonFromText(bodyMarkdown);
    if (extraction.success) {
      return extraction.data as T;
    }

    this.deps.logger?.warn("Failed to parse Planning agent reply", {
      bodyMarkdown,
      error: extraction.error.message,
    });
    throw new Error("Planning agent reply was not valid JSON.");
  }

  private getProviderLabel(provider: ProviderId): string {
    switch (provider) {
      case "gemini":
        return "Gemini";
      case "claude-code":
        return "Claude Code";
      case "qwen-code":
        return "Qwen Code";
      case "opencode":
        return "OpenCode";
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

      return PlanningPromptBuilder.buildMemoryContext(longTerm, shortTerm);
    } catch {
      return undefined;
    }
  }

  private async captureMemoriesFromWorkspace(
    projectId: string,
    sprintId: string | undefined,
    agentPresetId: string | null,
    worktreePath: string,
    originId: string,
  ): Promise<number> {
    if (!this.deps.memoryService) {
      return 0;
    }
    if (worktreePath.startsWith("docker-volume://")) {
      const raw = await this.workspaceManager.readWorkspaceFile(worktreePath, LEARNINGS_FILENAME);
      if (!raw) {
        return 0;
      }
      return await this.deps.memoryService.captureMemoriesFromContent(
        projectId,
        sprintId,
        agentPresetId,
        raw,
        originId,
      );
    }
    return await this.deps.memoryService.captureMemoriesFromWorktree(
      projectId,
      sprintId,
      agentPresetId,
      worktreePath,
      originId,
    );
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
