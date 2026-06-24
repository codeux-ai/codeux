import type { JulesApiClient, JulesCreateSessionRequest } from "../integrations/jules-api-client.js";
import { resolveProviderForInvocation, type ResolvedProviderRoute } from "./provider-routing.js";
import type {
  DashboardSettings,
  DashboardSettingsScope,
  InvocationRoutingId,
  JulesSession,
  ProviderId,
  Subtask,
} from "../contracts/app-types.js";
import type { CliWorkflowService } from "./cli-workflow-service.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import { buildTaskRunTag } from "./task-run-key.js";
import type { Logger } from "../shared/logging/logger.js";
import { syncRemoteBranchIfAvailable } from "./git-branch-sync-service.js";

export interface TaskServiceDependencies {
  julesApi: JulesApiClient;
  agentPresetSyncService: AgentPresetSyncService;
  resolveJulesSourceId: (args: { repoPath: string; sourceId?: string }) => Promise<string>;
  getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings;
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

  resolveProviderConfigIdForProvider(
    route: ResolvedProviderRoute,
    provider: ProviderId,
  ): string {
    if (route.providers[route.providerConfigId]?.provider === provider) {
      return route.providerConfigId;
    }

    const enabledMatch = route.enabledProviders.find((providerConfigId) => (
      route.providers[providerConfigId]?.provider === provider
    ));
    if (enabledMatch) {
      return enabledMatch;
    }

    const configuredMatch = Object.entries(route.providers).find(([, providerSettings]) => (
      providerSettings.provider === provider
    ))?.[0];
    if (configuredMatch) {
      return configuredMatch;
    }

    throw new Error(`Task requested provider ${provider}, but no matching provider settings were available.`);
  }

  private async syncRemoteBranchesIfNeeded(
    repoPath: string,
    branch: string | undefined,
    scope?: DashboardSettingsScope,
    options: { required?: boolean; provider?: ProviderId } = {},
  ): Promise<void> {
    const settings = this.deps.getDashboardSettings(scope);
    if (settings.git.githubMode !== "REMOTE") {
      return;
    }

    try {
      await syncRemoteBranchIfAvailable(repoPath, branch, {
        githubToken: settings.git.githubToken,
        gitlabToken: settings.git.gitlabToken,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const branchLabel = branch?.trim() || settings.git.defaultBranch || "the requested branch";
      if (options.required === false) {
        this.deps.logger?.warn("Remote branch refresh failed before provider dispatch; continuing because the provider does not require local git state.", {
          repoPath,
          branch: branchLabel,
          provider: options.provider,
          error: message,
        });
        return;
      }
      throw new Error(`Failed to refresh origin before starting work from ${branchLabel}: ${message}`);
    }
  }

  resolveInvocationProvider(
    invocation: InvocationRoutingId,
    task: Subtask,
    options?: {
      scope?: DashboardSettingsScope;
      cliOnly?: boolean;
      providerPool?: ProviderId[];
      agentProvider?: {
        providerConfigId?: string | null;
        model?: string | null;
      } | null;
    },
  ): ResolvedProviderRoute {
    const settings = this.deps.getDashboardSettings(options?.scope);
    const buildRoute = (providerPool?: ProviderId[]) => resolveProviderForInvocation(settings, {
      invocation,
      task,
      providerPool,
      agentProvider: options?.agentProvider,
    });
    const getEnabledProviderTypes = (resolvedRoute: ResolvedProviderRoute): ProviderId[] => (
      resolvedRoute.enabledProviders
        .map((providerConfigId) => resolvedRoute.providers[providerConfigId]?.provider)
        .filter((providerId): providerId is ProviderId => Boolean(providerId))
    );

    const pooledProviders = options?.providerPool;
    let resolved = buildRoute(pooledProviders);

    if (resolved.provider === "jules" && !this.deps.isJulesApiConfigured()) {
      const fallbackPool = getEnabledProviderTypes(resolved).filter((providerId) => providerId !== "jules");
      if (fallbackPool.length > 0) {
        resolved = buildRoute(fallbackPool);
      }
    }

    const requiresCli = options?.cliOnly || settings.git.githubMode === "LOCAL";

    if (requiresCli && resolved.provider === "jules") {
      const fallbackPool = getEnabledProviderTypes(resolved).filter((providerId) => providerId !== "jules");
      if (fallbackPool.length > 0) {
        resolved = buildRoute(fallbackPool);
      }
    }

    if (requiresCli && resolved.provider === "jules") {
      throw new Error(`Invocation ${invocation} requires a CLI provider, but no eligible CLI provider is enabled.`);
    }

    return resolved;
  }

  resolveTaskProvider(task: Subtask, scope?: DashboardSettingsScope, executorType?: string): ProviderId | null {
    if (task.provider) {
      return task.provider;
    }
    if (executorType === "jules") {
      return "jules";
    }
    if (executorType === "docker_cli") {
      return this.selectCliProviderForTask(task, scope);
    }
    return this.selectProviderForTask(task, scope);
  }

  selectProviderForTask(task: Subtask, scope?: DashboardSettingsScope): ProviderId {
    return this.resolveInvocationProvider("task_coding", task, { scope }).provider;
  }

  selectCliProviderForTask(task: Subtask, scope?: DashboardSettingsScope): Exclude<ProviderId, "jules"> {
    return this.resolveInvocationProvider("task_coding", task, { scope, cliOnly: true }).provider as Exclude<ProviderId, "jules">;
  }

  private async buildPrompt(
    repoPath: string,
    sectionTitle: string,
    taskPrompt: string,
    projectId?: string,
    agentPresetId?: string | null,
  ): Promise<string> {
    const settings = projectId ? this.deps.getDashboardSettings({ projectId }) : undefined;
    const configuredAgentPresetId = settings?.agents?.routing?.taskCoding?.mode === "MANUAL"
      ? settings.agents.routing.taskCoding.agentPresetId
      : null;
    const workerAgent = projectId
      ? await this.deps.agentPresetSyncService.resolveTargetedCodingAgent(
        projectId,
        agentPresetId || configuredAgentPresetId,
      ).catch(() => null)
      : await this.deps.agentPresetSyncService.getOptionalWorkerAgentForRepoPath(repoPath);
    const workerGuide = workerAgent?.instructionMarkdown?.trim() || "";

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
    const route = this.resolveInvocationProvider("task_coding", pseudoTask);
    const provider = route.provider;
    const selectedProviderConfigId = route.providerConfigId || route.provider;
    const selectedProviderSettings = route.providers[selectedProviderConfigId];

    await this.syncRemoteBranchesIfNeeded(args.repo_path, args.branch, undefined, {
      required: provider !== "jules",
      provider,
    });

    if (provider !== "jules") {
      return await this.deps.cliWorkflowService.startTask({
        provider,
        providerSettingsOverride: {
          model: selectedProviderSettings.model,
          thinkingMode: selectedProviderSettings.thinkingMode,
          apiKey: selectedProviderSettings.apiKey,
          qwenAuthMode: selectedProviderSettings.qwenAuthMode,
          qwenRegion: selectedProviderSettings.qwenRegion,
          qwenBaseUrl: selectedProviderSettings.qwenBaseUrl,
          qwenEnvKey: selectedProviderSettings.qwenEnvKey,
          qwenModelId: selectedProviderSettings.qwenModelId,
          qwenProtocol: selectedProviderSettings.qwenProtocol,
          qwenAdditionalModelProviders: selectedProviderSettings.qwenAdditionalModelProviders,
        openCodeAuthMode: selectedProviderSettings.openCodeAuthMode,
        openCodeProviderId: selectedProviderSettings.openCodeProviderId,
        openCodeModelId: selectedProviderSettings.openCodeModelId,
        openCodeBaseUrl: selectedProviderSettings.openCodeBaseUrl,
        openCodeEnvKey: selectedProviderSettings.openCodeEnvKey,
        openCodePackage: selectedProviderSettings.openCodePackage,
          providerMountAuth: selectedProviderSettings.mountAuth,
          providerAuthPath: selectedProviderSettings.authPath,
          customBaseUrl: selectedProviderSettings.customBaseUrl,
          customModel: selectedProviderSettings.customModel,
        },
        task: {
          ...pseudoTask,
          prompt: args.prompt,
        },
        repoPath: args.repo_path,
        featureBranch: args.branch || this.deps.getDashboardSettings().git.defaultBranch,
        sprintNumber: 0,
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

  async startSprintTask(
    task: Subtask,
    sourceId: string | undefined,
    baseBranch: string,
    repoPath: string,
    sprintNumber: number,
    settingsScope?: DashboardSettingsScope,
    dispatchId?: string,
    taskRunId?: string,
    rerunOptions?: {
      resumeWorkspaceSessionId?: string;
      resumeWorkerBranch?: string;
      forceFreshWorkspace?: boolean;
      providerConfigId?: string;
    },
  ): Promise<JulesSession> {
    // Respect task.provider if already set (e.g. from a rerun with provider override)
    const settings = this.deps.getDashboardSettings(settingsScope);
    const configuredAgentPresetId = settings.agents?.routing?.taskCoding?.mode === "MANUAL"
      ? settings.agents.routing.taskCoding.agentPresetId
      : null;
    const routingAgent = settingsScope?.projectId
      ? await this.deps.agentPresetSyncService.resolveTargetedCodingAgent(
        settingsScope.projectId,
        task.agentPresetId || configuredAgentPresetId,
      ).catch(() => null)
      : null;
    const route = this.resolveInvocationProvider("task_coding", task, {
      scope: settingsScope,
      agentProvider: routingAgent
        ? {
          providerConfigId: routingAgent.providerConfigId,
          model: routingAgent.model,
        }
        : null,
    });
    const rerunProviderSettings = rerunOptions?.providerConfigId
      ? route.providers[rerunOptions.providerConfigId]
      : undefined;
    if (rerunOptions?.providerConfigId && !rerunProviderSettings) {
      throw new Error(`Task requested provider instance ${rerunOptions.providerConfigId}, but no matching provider settings were available.`);
    }
    const provider = rerunProviderSettings?.provider || task.provider || route.provider;
    const selectedProviderConfigId = rerunOptions?.providerConfigId
      ? rerunOptions.providerConfigId
      : task.provider
      ? this.resolveProviderConfigIdForProvider(route, task.provider)
      : route.providerConfigId;
    const selectedProviderSettings = route.providers[selectedProviderConfigId];
    const selectedModel = task.model || selectedProviderSettings.model;

    await this.syncRemoteBranchesIfNeeded(repoPath, baseBranch, settingsScope, {
      required: provider !== "jules",
      provider,
    });

    if (provider !== "jules") {
      const isApiKeyMode = !selectedProviderSettings.mountAuth;

      const session = await this.deps.cliWorkflowService.startTask({
        provider,
        providerSettingsOverride: {
          model: selectedModel,
          thinkingMode: selectedProviderSettings.thinkingMode,
          apiKey: isApiKeyMode ? selectedProviderSettings.apiKey : "",
          qwenAuthMode: isApiKeyMode ? selectedProviderSettings.qwenAuthMode : "LOCAL_AUTH",
          qwenRegion: isApiKeyMode ? selectedProviderSettings.qwenRegion : undefined,
          qwenBaseUrl: isApiKeyMode ? selectedProviderSettings.qwenBaseUrl : "",
          qwenEnvKey: isApiKeyMode ? selectedProviderSettings.qwenEnvKey : "",
          qwenModelId: isApiKeyMode ? selectedProviderSettings.qwenModelId : "",
          qwenProtocol: isApiKeyMode ? selectedProviderSettings.qwenProtocol : undefined,
          qwenAdditionalModelProviders: isApiKeyMode ? selectedProviderSettings.qwenAdditionalModelProviders : [],
          openCodeAuthMode: isApiKeyMode ? selectedProviderSettings.openCodeAuthMode : "LOCAL_AUTH",
          openCodeProviderId: isApiKeyMode ? selectedProviderSettings.openCodeProviderId : "",
          openCodeModelId: isApiKeyMode ? selectedProviderSettings.openCodeModelId : "",
          openCodeBaseUrl: isApiKeyMode ? selectedProviderSettings.openCodeBaseUrl : "",
          openCodeEnvKey: isApiKeyMode ? selectedProviderSettings.openCodeEnvKey : "",
          openCodePackage: isApiKeyMode ? selectedProviderSettings.openCodePackage : "",
          providerMountAuth: selectedProviderSettings.mountAuth,
          providerAuthPath: isApiKeyMode ? "" : selectedProviderSettings.authPath,
          customBaseUrl: isApiKeyMode ? selectedProviderSettings.customBaseUrl : undefined,
          customModel: isApiKeyMode ? selectedProviderSettings.customModel : undefined,
        },
        task,
        repoPath,
        featureBranch: baseBranch,
        sprintNumber,
        settingsScope,
        agentPresetId: task.agentPresetId || null,
        dispatchId,
        taskRunId,
        resumeWorkspaceSessionId: rerunOptions?.resumeWorkspaceSessionId,
        resumeWorkerBranch: rerunOptions?.resumeWorkerBranch,
        forceFreshWorkspace: rerunOptions?.forceFreshWorkspace,
      });
      session.provider = provider;
      return session;
    }
    const resolvedSourceId = await this.deps.resolveJulesSourceId({
      repoPath,
      sourceId,
    });
    const fullPrompt = await this.buildPrompt(
      repoPath,
      "SUBTASK TO EXECUTE",
      task.prompt,
      settingsScope?.projectId,
      task.agentPresetId,
    );

    const data: JulesCreateSessionRequest = {
      prompt: fullPrompt,
      title: `Sprint ${sprintNumber}: ${buildTaskRunTag(repoPath, sprintNumber, task.id)} [${task.id}] ${task.title}`,
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
