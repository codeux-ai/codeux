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

    const pooledProviders = options?.providerPool;
    let resolved = buildRoute(pooledProviders);

    if (resolved.provider === "jules" && !this.deps.isJulesApiConfigured()) {
      const fallbackPool = resolved.enabledProviders.filter((provider) => provider !== "jules");
      if (fallbackPool.length > 0) {
        resolved = buildRoute(fallbackPool);
      }
    }

    if (options?.cliOnly && resolved.provider === "jules") {
      const fallbackPool = resolved.enabledProviders.filter((provider) => provider !== "jules");
      if (fallbackPool.length > 0) {
        resolved = buildRoute(fallbackPool);
      }
    }

    if (options?.cliOnly && resolved.provider === "jules") {
      throw new Error(`Invocation ${invocation} requires a CLI provider, but no eligible CLI provider is enabled.`);
    }

    return resolved;
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

    if (provider !== "jules") {
      return await this.deps.cliWorkflowService.startTask({
        provider,
        providerSettingsOverride: {
          model: route.providers[provider].model,
          thinkingMode: route.providers[provider].thinkingMode,
          apiKey: route.providers[provider].apiKey,
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
    // Respect task.provider if already set (e.g. from a rerun with provider override)
    const route = this.resolveInvocationProvider("task_coding", task, { scope: settingsScope });
    const provider = task.provider || route.provider;

    if (provider !== "jules") {
      const session = await this.deps.cliWorkflowService.startTask({
        provider,
        providerSettingsOverride: {
          model: route.providers[provider].model,
          thinkingMode: route.providers[provider].thinkingMode,
          apiKey: route.providers[provider].apiKey,
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
