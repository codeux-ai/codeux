import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import type { DashboardSettings, ProviderId } from "../contracts/app-types.js";
import type {
  ProjectSetupArtifactPayload,
  ProjectSetupOptions,
  ProjectSetupResult,
  ProjectSetupStartResult,
  ProjectSummary,
} from "../contracts/project-management-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { QuicksprintService } from "./quicksprint-service.js";
import type { Logger } from "../shared/logging/logger.js";
import { ProviderExecutionService } from "./provider-execution-service.js";
import { ProviderConcurrencyService } from "./provider-concurrency-service.js";
import { ProviderRunner, type IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";
import { resolveProviderForInvocation } from "./provider-routing.js";
import { DEFAULT_CLI_WORKFLOW_SETTINGS } from "./cli-workflow-utils.js";
import { extractJsonFromText } from "../domain/llm/json-extraction.js";
import {
  buildDefaultProjectSetupAgentInstructions,
  buildProjectSetupPrompt,
} from "./project-setup-prompt-builder.js";
import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";
import type { DashboardRealtimeMutationNotifier } from "./dashboard-realtime-service.js";

export const PROJECT_SETUP_AGENT_NAME = "Project Setup Agent";

const DEFAULT_OPTIONS: ProjectSetupOptions = {
  agents: true,
  quicksprints: true,
  previewScript: true,
  ci: true,
};

interface ProjectSetupServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  settingsRepository: SettingsRepository;
  executionRepository?: ExecutionRepository;
  agentPresetSyncService: AgentPresetSyncService;
  quicksprintService?: QuicksprintService;
  providerRunner?: IProviderRunner;
  providerConcurrencyService?: ProviderConcurrencyService;
  realtimeNotifier?: DashboardRealtimeMutationNotifier;
  logger?: Logger;
  getGithubToken?: () => string | undefined;
}

type ProjectSetupProviderConfig = ReturnType<ProjectSetupService["resolveProvider"]>;

interface PreparedProjectSetupRun {
  project: ProjectSummary;
  options: ProjectSetupOptions;
  setupAgent: AgentPresetRecord;
  settings: DashboardSettings;
  providerConfig: ProjectSetupProviderConfig;
  prompt: string;
  invocationId: string;
}

export class ProjectSetupService {
  private readonly providerExecutionService: ProviderExecutionService;

  constructor(private deps: ProjectSetupServiceDeps) {
    this.providerExecutionService = new ProviderExecutionService({
      executionRepository: deps.executionRepository,
      providerRunner: deps.providerRunner || new ProviderRunner(new DockerRunner()),
      providerConcurrencyService: deps.providerConcurrencyService,
      logger: deps.logger,
      getGithubToken: deps.getGithubToken,
    });
  }

  setRealtimeNotifier(notifier: DashboardRealtimeMutationNotifier): void {
    this.deps.realtimeNotifier = notifier;
  }

  async setupProject(
    projectId: string,
    input?: {
      options?: Partial<ProjectSetupOptions>;
      clientRequestId?: string;
    },
    signal?: AbortSignal,
  ): Promise<ProjectSetupResult> {
    const prepared = await this.prepareSetupRun(projectId, input);
    return await this.executePreparedSetupRun(prepared, signal);
  }

  async startProjectSetup(
    projectId: string,
    input?: {
      options?: Partial<ProjectSetupOptions>;
      clientRequestId?: string;
    },
  ): Promise<ProjectSetupStartResult> {
    const prepared = await this.prepareSetupRun(projectId, input);
    void this.executePreparedSetupRun(prepared).catch((error) => {
      this.deps.logger?.warn("Background project setup failed", {
        projectId,
        invocationId: prepared.invocationId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return {
      accepted: true,
      projectId,
      invocationId: prepared.invocationId,
      agentId: prepared.setupAgent.id,
    };
  }

  private async prepareSetupRun(
    projectId: string,
    input?: {
      options?: Partial<ProjectSetupOptions>;
      clientRequestId?: string;
    },
  ): Promise<PreparedProjectSetupRun> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const options = this.normalizeOptions(input?.options);
    const setupAgent = await this.ensureProjectSetupAgent(projectId);
    const settings = this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;
    const providerConfig = this.resolveProvider(settings, setupAgent);

    const invocation = this.deps.executionRepository?.createExecutionInvocation({
      projectId,
      skipValidation: true,
      sprintId: null,
      type: "project_setup",
      status: "running",
      provider: providerConfig.provider,
      model: providerConfig.model,
      systemPrompt: null,
    });

    const prompt = buildProjectSetupPrompt({ project, setupAgent, options });
    if (invocation) {
      this.deps.executionRepository?.appendExecutionInvocationMessage(invocation.id, {
        role: "user",
        contentMarkdown: prompt,
      });
    }

    return {
      project,
      options,
      setupAgent,
      settings,
      providerConfig,
      prompt,
      invocationId: invocation?.id || "",
    };
  }

  private async executePreparedSetupRun(
    prepared: PreparedProjectSetupRun,
    signal?: AbortSignal,
  ): Promise<ProjectSetupResult> {
    const { project, options, setupAgent, settings, providerConfig, prompt, invocationId } = prepared;
    const projectId = project.id;
    try {
      signal?.throwIfAborted();
      const sessionId = `project-setup-${providerConfig.provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const result = await this.providerExecutionService.executeProvider({
        projectId,
        purpose: "planning",
        type: "project_setup",
        provider: providerConfig.provider,
        prompt,
        cwd: project.baseDir,
        repoPath: project.baseDir,
        model: providerConfig.model,
        apiKey: providerConfig.apiKey,
        maxConcurrentTasks: providerConfig.maxConcurrentTasks,
        qwenAuthMode: providerConfig.qwenAuthMode,

        qwenRegion: providerConfig.qwenRegion,
        qwenBaseUrl: providerConfig.qwenBaseUrl,
        qwenEnvKey: providerConfig.qwenEnvKey,
        qwenModelId: providerConfig.qwenModelId,
        qwenProtocol: providerConfig.qwenProtocol,
        qwenAdditionalModelProviders: providerConfig.qwenAdditionalModelProviders,
        openCodeAuthMode: providerConfig.openCodeAuthMode,
        openCodeProviderId: providerConfig.openCodeProviderId,
        openCodeModelId: providerConfig.openCodeModelId,
        openCodeBaseUrl: providerConfig.openCodeBaseUrl,
        openCodeEnvKey: providerConfig.openCodeEnvKey,
        openCodePackage: providerConfig.openCodePackage,
        providerMountAuth: providerConfig.providerMountAuth,
        providerAuthPath: providerConfig.providerAuthPath,
        customBaseUrl: providerConfig.customBaseUrl,
        customModel: providerConfig.customModel,
        codexWireApi: providerConfig.codexWireApi,
        sessionId,
        workspaceSessionId: `${projectId}-project-setup`,
        workflowSettings: {
          ...DEFAULT_CLI_WORKFLOW_SETTINGS,
          ...settings.cliWorkflow,
        },
        githubToken: settings.git.githubToken,
        signal,
        expectTextOutput: true,
        invocationId,
        finalizeExecutionInvocation: false,
        onActivity: (description, originator) => {
          this.deps.logger?.debug("Project setup agent activity", {
            projectId,
            invocationId,
            originator: originator || "system",
            description,
          });
        },
      });

      if (!result.ok) {
        throw new Error(result.stderr || result.stdout || "Project setup provider failed without output.");
      }

      const payload = this.parsePayload(result.text || result.stdout || result.usageTelemetry.transcriptText);
      const applied = await this.applyArtifacts(projectId, project.baseDir, options, payload);

      if (invocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(invocationId, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
      }

      this.deps.realtimeNotifier?.scheduleProjectStructureRefresh(projectId, { includeProjects: true });

      return {
        ok: true,
        projectId,
        invocationId,
        agentId: setupAgent.id,
        summary: payload.summary || "Project setup completed.",
        ...applied,
      };
    } catch (error) {
      if (invocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(invocationId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date().toISOString(),
        });
      }
      throw error;
    }
  }

  private normalizeOptions(options?: Partial<ProjectSetupOptions>): ProjectSetupOptions {
    return {
      agents: options?.agents ?? DEFAULT_OPTIONS.agents,
      quicksprints: options?.quicksprints ?? DEFAULT_OPTIONS.quicksprints,
      previewScript: options?.previewScript ?? DEFAULT_OPTIONS.previewScript,
      ci: options?.ci ?? DEFAULT_OPTIONS.ci,
    };
  }

  private async ensureProjectSetupAgent(projectId: string): Promise<AgentPresetRecord> {
    const presets = await this.deps.agentPresetSyncService.listAgentPresets(projectId);
    const existing = presets.find((preset) => preset.name.trim().toLowerCase() === PROJECT_SETUP_AGENT_NAME.toLowerCase());
    if (existing) {
      return existing;
    }
    return await this.deps.agentPresetSyncService.createAgentPreset(projectId, {
      id: "5",
      name: PROJECT_SETUP_AGENT_NAME,
      description: "Initializes Code UX agents, routing, quicksprints, preview startup, and basic CI from repository evidence.",
      labels: ["planning", "setup"],
      instructionMarkdown: buildDefaultProjectSetupAgentInstructions(),
    });
  }

  private resolveProvider(settings: DashboardSettings, setupAgent: AgentPresetRecord): {
    provider: Exclude<ProviderId, "jules">;
    model: string;
    apiKey: string;
    maxConcurrentTasks: number;
    qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
    qwenRegion?: "china" | "international";
    qwenBaseUrl?: string;
    qwenEnvKey?: string;
    qwenModelId?: string;
    qwenProtocol?: "openai" | "anthropic" | "gemini";
    qwenAdditionalModelProviders?: DashboardSettings["aiProvider"]["providers"][string]["qwenAdditionalModelProviders"];
    openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
    openCodeProviderId?: string;
    openCodeModelId?: string;
    openCodeBaseUrl?: string;
    openCodeEnvKey?: string;
    openCodePackage?: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
    customBaseUrl?: string;
    customModel?: string;
    codexWireApi?: "chat" | "responses";
  } {
    const route = resolveProviderForInvocation(settings, {
      invocation: "planning",
      task: {
        id: "project-setup",
        title: "Project setup",
        prompt: "Initialize project operating assets.",
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
      providerPool: ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"],
      agentProvider: {
        providerConfigId: setupAgent.providerConfigId,
        model: setupAgent.model,
      },
    });
    const providerSettings = route.providers[route.providerConfigId];
    if (!providerSettings) {
      throw new Error(`Virtual worker provider "${route.providerConfigId}" is not configured. Check AI Provider settings.`);
    }
    return {
      provider: providerSettings.provider as Exclude<ProviderId, "jules">,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      maxConcurrentTasks: providerSettings.maxConcurrentTasks,
      qwenAuthMode: providerSettings.qwenAuthMode,
      qwenRegion: providerSettings.qwenRegion,
      qwenBaseUrl: providerSettings.qwenBaseUrl,
      qwenEnvKey: providerSettings.qwenEnvKey,
      qwenModelId: providerSettings.qwenModelId,
      qwenProtocol: providerSettings.qwenProtocol,
      qwenAdditionalModelProviders: providerSettings.qwenAdditionalModelProviders,
      openCodeAuthMode: providerSettings.openCodeAuthMode,
      openCodeProviderId: providerSettings.openCodeProviderId,
      openCodeModelId: providerSettings.openCodeModelId,
      openCodeBaseUrl: providerSettings.openCodeBaseUrl,
      openCodeEnvKey: providerSettings.openCodeEnvKey,
      openCodePackage: providerSettings.openCodePackage,
      providerMountAuth: providerSettings.mountAuth,
      providerAuthPath: providerSettings.authPath,
      customBaseUrl: providerSettings.customBaseUrl,
      customModel: providerSettings.customModel,
      codexWireApi: providerSettings.codexWireApi,
    };
  }

  private parsePayload(text: string): ProjectSetupArtifactPayload {
    const extraction = extractJsonFromText(text);
    if (!extraction.success) {
      throw new Error(`Project setup agent reply was not valid JSON: ${extraction.error.message}`);
    }
    const payload = extraction.data as ProjectSetupArtifactPayload;
    if (!payload || typeof payload !== "object") {
      throw new Error("Project setup agent reply must be a JSON object.");
    }
    return payload;
  }

  private async applyArtifacts(
    projectId: string,
    projectBaseDir: string,
    options: ProjectSetupOptions,
    payload: ProjectSetupArtifactPayload,
  ): Promise<Pick<ProjectSetupResult, "createdAgentIds" | "createdQuicksprintTemplateIds" | "writtenFiles">> {
    const createdAgentIds: string[] = [];
    const createdQuicksprintTemplateIds: string[] = [];
    const writtenFiles: string[] = [];

    if (options.agents) {
      for (const agent of payload.agents || []) {
        if (!agent.name?.trim() || !agent.instructionMarkdown?.trim()) continue;
        const created = await this.createOrUpdateAgent(projectId, agent);
        createdAgentIds.push(created.id);
      }
      await this.configureAgentRouting(projectId);
    }

    if (options.quicksprints && this.deps.quicksprintService) {
      for (const template of payload.quicksprints || []) {
        if (!template.name?.trim() || !template.agentInstructionMarkdown?.trim()) continue;
        const created = this.deps.quicksprintService.createCustomTemplate(projectId, {
          name: template.name.trim(),
          description: template.description?.trim() || "Project-specific quicksprint template.",
          icon: template.icon?.trim() || "Sparkles",
          category: template.category?.trim() || "engineering",
          categoryColor: template.categoryColor?.trim() || "#22c55e",
          defaultTaskCount: template.defaultTaskCount,
          agentInstructionMarkdown: template.agentInstructionMarkdown.trim(),
        });
        createdQuicksprintTemplateIds.push(created.id);
      }
    }

    if (options.previewScript && payload.previewScript?.content?.trim()) {
      const target = await this.writeProjectFile(
        projectBaseDir,
        payload.previewScript.path || ".code-ux/browser/start-preview.sh",
        payload.previewScript.content,
        { executable: true },
      );
      writtenFiles.push(target);
    }

    if (options.ci) {
      for (const ci of payload.ci || []) {
        if (!ci.path?.trim() || !ci.content?.trim()) continue;
        const target = await this.writeProjectFile(projectBaseDir, ci.path, ci.content);
        writtenFiles.push(target);
      }
    }

    return { createdAgentIds, createdQuicksprintTemplateIds, writtenFiles };
  }

  private async createOrUpdateAgent(
    projectId: string,
    agent: NonNullable<ProjectSetupArtifactPayload["agents"]>[number],
  ): Promise<AgentPresetRecord> {
    const presets = await this.deps.agentPresetSyncService.listAgentPresets(projectId);
    const existing = presets.find((preset) => preset.name.trim().toLowerCase() === agent.name.trim().toLowerCase());
    const input = {
      name: agent.name.trim(),
      description: agent.description?.trim() || "",
      labels: agent.labels?.map((label) => label.trim()).filter(Boolean),
      instructionMarkdown: agent.instructionMarkdown.trim(),
    };
    return existing
      ? await this.deps.agentPresetSyncService.updateAgentPreset(existing.id, input)
      : await this.deps.agentPresetSyncService.createAgentPreset(projectId, input);
  }

  private async configureAgentRouting(projectId: string): Promise<void> {
    const presets = await this.deps.agentPresetSyncService.listAgentPresets(projectId);
    const setupAgent = presets.find((preset) => preset.name === PROJECT_SETUP_AGENT_NAME);
    const excludedNames = new Set([
      PROJECT_SETUP_AGENT_NAME.toLowerCase(),
      "planning agent",
      "project manager",
      "quality assurance agent",
      "worker",
    ]);
    const workerAgents = presets.filter((preset) =>
      !excludedNames.has(preset.name.trim().toLowerCase()) &&
      (preset.labels.includes("worker") || !preset.labels.includes("planning"))
    );
    const current = this.deps.settingsRepository.getProjectSettings(projectId);
    const effectiveAgents = this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings.agents;
    this.deps.settingsRepository.saveProjectSettings(projectId, {
      ...current,
      agents: {
        ...effectiveAgents,
        ...current.agents,
        routing: {
          ...effectiveAgents.routing,
          ...current.agents?.routing,
          planning: {
            ...effectiveAgents.routing.planning,
            ...current.agents?.routing?.planning,
            agentPresetId: setupAgent?.id || current.agents?.routing?.planning?.agentPresetId || null,
          },
          taskCoding: {
            ...effectiveAgents.routing.taskCoding,
            ...current.agents?.routing?.taskCoding,
            mode: workerAgents.length > 0 ? "ORCHESTRATOR" : "MANUAL",
            agentPresetId: current.agents?.routing?.taskCoding?.agentPresetId || null,
            orchestratorAgentPresetIds: workerAgents.map((preset) => preset.id),
          },
          ciFix: { agentPresetId: workerAgents[0]?.id || current.agents?.routing?.ciFix?.agentPresetId || null },
          mergeConflict: { agentPresetId: workerAgents[0]?.id || current.agents?.routing?.mergeConflict?.agentPresetId || null },
          dashboardReply: { agentPresetId: current.agents?.routing?.dashboardReply?.agentPresetId || null },
          clarificationReply: { agentPresetId: current.agents?.routing?.clarificationReply?.agentPresetId || null },
        },
      },
    });
  }

  private async writeProjectFile(
    projectBaseDir: string,
    relativePath: string,
    content: string,
    options?: { executable?: boolean },
  ): Promise<string> {
    const safeRelative = relativePath.trim().replace(/^[/\\]+/, "");
    const target = path.resolve(projectBaseDir, safeRelative);
    const root = path.resolve(projectBaseDir);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Refusing to write outside project directory: ${relativePath}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    if (options?.executable && process.platform !== "win32") {
      await fs.chmod(target, 0o755);
    }
    return path.relative(projectBaseDir, target);
  }
}
