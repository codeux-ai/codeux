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

  private async syncRemoteBranchesIfNeeded(
    repoPath: string,
    branch: string | undefined,
    scope?: DashboardSettingsScope,
  ): Promise<void> {
    const settings = this.deps.getDashboardSettings(scope);
    if (settings.git.githubMode !== "REMOTE") {
      return;
    }

    try {
      await syncRemoteBranchIfAvailable(repoPath, branch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const branchLabel = branch?.trim() || settings.git.defaultBranch || "the requested branch";
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
    },
  ): ResolvedProviderRoute {
    const settings = this.deps.getDashboardSettings(options?.scope);
    const buildRoute = (providerPool?: ProviderId[]) => resolveProviderForInvocation(settings, {
      invocation,
      task,
      providerPool,
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

  private async buildPrompt(repoPath: string, sectionTitle: string, taskPrompt: string): Promise<string> {
    const workerGuide = (await this.deps.agentPresetSyncService.getOptionalWorkerAgentForRepoPath(repoPath))
      ?.instructionMarkdown
      ?.trim() || "";

    return workerGuide
      ? `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerGuide}\n\n---\n\n## ${sectionTitle}\n\n${taskPrompt}`
      : taskPrompt;
  }

  async createTaskAgentSession(args: TaskAgentSessionArgs): Promise<JulesSession> {
    await this.syncRemoteBranchesIfNeeded(args.repo_path, args.branch);

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

    if (provider !== "jules") {
      return await this.deps.cliWorkflowService.startTask({
        provider,
        providerSettingsOverride: {
          model: selectedProviderSettings.model,
          thinkingMode: selectedProviderSettings.thinkingMode,
          apiKey: selectedProviderSettings.apiKey,
          providerMountAuth: selectedProviderSettings.mountAuth,
          providerAuthPath: selectedProviderSettings.authPath,
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
  ): Promise<JulesSession> {
    await this.syncRemoteBranchesIfNeeded(repoPath, baseBranch, settingsScope);

    // Respect task.provider if already set (e.g. from a rerun with provider override)
    const route = this.resolveInvocationProvider("task_coding", task, { scope: settingsScope });
    const provider = task.provider || route.provider;
    const selectedProviderConfigId = route.providerConfigId || route.provider;
    const selectedProviderSettings = route.providers[selectedProviderConfigId];

    if (provider !== "jules") {
      const session = await this.deps.cliWorkflowService.startTask({
        provider,
        providerSettingsOverride: {
          model: selectedProviderSettings.model,
          thinkingMode: selectedProviderSettings.thinkingMode,
          apiKey: selectedProviderSettings.apiKey,
          providerMountAuth: selectedProviderSettings.mountAuth,
          providerAuthPath: selectedProviderSettings.authPath,
        },
        task,
        repoPath,
        featureBranch: baseBranch,
        sprintNumber,
        settingsScope,
        dispatchId,
        taskRunId,
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
