import type { PipelineContext } from "./pipeline-context.js";
import { resolveProviderForInvocation } from "../../provider-routing.js";
import { ProviderExecutionService, resolveEffectiveModel } from "../../provider-execution-service.js";

export async function executeProviderStage(ctx: PipelineContext, providerPrompt: string): Promise<void> {
  const providerSettings = ctx.providerSettingsOverride || resolveProviderForInvocation(ctx.settings, {
    invocation: "task_coding",
    task: ctx.task,
  }).providers[ctx.provider];

  const effectiveModel = resolveEffectiveModel({
    provider: ctx.provider,
    model: providerSettings.model,
    customModel: providerSettings.customModel,
    qwenAuthMode: providerSettings.qwenAuthMode,
    qwenModelId: providerSettings.qwenModelId,
    openCodeAuthMode: providerSettings.openCodeAuthMode,
    openCodeProviderId: providerSettings.openCodeProviderId,
    openCodeModelId: providerSettings.openCodeModelId,
  });

  const providerMountAuth = "mountAuth" in providerSettings
    ? providerSettings.mountAuth
    : providerSettings.providerMountAuth;
  const providerAuthPath = "authPath" in providerSettings
    ? providerSettings.authPath
    : providerSettings.providerAuthPath;

  const taskRun = ctx.taskRunId && ctx.deps.executionRepository
    ? ctx.deps.executionRepository.getTaskRun(ctx.taskRunId)
    : null;

  const previousInvocation = (ctx.deps.executionRepository && typeof ctx.deps.executionRepository.getLatestProviderInvocationUsageBySession === "function")
    ? ctx.deps.executionRepository.getLatestProviderInvocationUsageBySession(ctx.workspaceSessionId, "task_coding")
    : null;
  const continueSessionId = previousInvocation?.nativeSessionId || (ctx.provider === "claude-code" ? null : ctx.workspaceSessionId);

  const providerExecutionService = new ProviderExecutionService({
    executionRepository: ctx.deps.executionRepository,
    sessionTracking: ctx.deps.sessionTracking,
    providerRunner: ctx.providerRunner,
    providerConcurrencyService: ctx.deps.providerConcurrencyService,
    getGithubToken: ctx.deps.getGithubToken,
  });

  const result = await providerExecutionService.executeProvider({
    projectId: taskRun?.projectId || "",
    sprintId: taskRun?.sprintId,
    taskId: taskRun?.taskId,
    sprintRunId: taskRun?.sprintRunId,
    dispatchId: taskRun?.dispatchId,
    taskRunId: taskRun?.id,
    purpose: "task_coding",
    type: "cli_task_coding",
    provider: ctx.provider,
    prompt: providerPrompt,
    cwd: ctx.worktreePath,
    model: effectiveModel,
    apiKey: providerSettings.apiKey,
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
    providerMountAuth,
    providerAuthPath,
    customBaseUrl: providerSettings.customBaseUrl,
    customModel: providerSettings.customModel,
    sessionId: ctx.sessionId,
    workspaceSessionId: ctx.workspaceSessionId,
    continueSessionId,
    workflowSettings: ctx.workflowSettings,
    repoPath: ctx.repoPath,
    githubToken: ctx.deps.getGithubToken(),
    gitlabToken: ctx.settings.git.gitlabToken,
    signal: ctx.abortSignal,
    customMcpServers: ctx.settings.customMcpServers,
    agentMcpAccess: ctx.agentMcpAccess,
    mcpAgentId: ctx.agentPresetId ?? null,
  });

  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || "Provider failed without output.");
  }
}
