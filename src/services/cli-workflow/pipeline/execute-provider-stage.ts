import { buildProviderSettingsOverride } from "../../provider-settings-override.js";
import type { PipelineContext } from "./pipeline-context.js";
import { resolveProviderForInvocation } from "../../provider-routing.js";
import { ProviderExecutionService, resolveEffectiveModel } from "../../provider-execution-service.js";
import type { ProviderRunResult } from "../../../infrastructure/providers/cli/provider-runner.js";

export async function executeProviderStage(ctx: PipelineContext, providerPrompt: string): Promise<ProviderRunResult> {
  const resolvedProvider = resolveProviderForInvocation(ctx.settings, {
    invocation: "task_coding",
    task: ctx.task,
  });
  const resolvedProviderSettings = resolvedProvider.providers[ctx.provider];
  const providerSettings = ctx.providerSettingsOverride || buildProviderSettingsOverride(resolvedProviderSettings.model, resolvedProviderSettings);

  const effectiveModel = resolveEffectiveModel({
    provider: ctx.provider,
    model: providerSettings.model,
    providerMountAuth: providerSettings.providerMountAuth,
    customModel: providerSettings.customModel,
    qwenAuthMode: providerSettings.qwenAuthMode,
    qwenModelId: providerSettings.qwenModelId,
    openCodeAuthMode: providerSettings.openCodeAuthMode,
    openCodeProviderId: providerSettings.openCodeProviderId,
    openCodeModelId: providerSettings.openCodeModelId,
  });

  const providerMountAuth = "mountAuth" in providerSettings
    ? (providerSettings as any).mountAuth
    : (providerSettings as any).providerMountAuth;
  const providerAuthPath = "authPath" in providerSettings
    ? (providerSettings as any).authPath
    : (providerSettings as any).providerAuthPath;
  const providerConfigMode = "providerConfigMode" in providerSettings
    ? providerSettings.providerConfigMode
    : undefined;
  const providerConfigPath = "providerConfigPath" in providerSettings
    ? providerSettings.providerConfigPath
    : undefined;

  const taskRun = ctx.taskRunId && ctx.deps.executionRepository
    ? ctx.deps.executionRepository.getTaskRun(ctx.taskRunId)
    : null;

  const previousInvocation = (ctx.deps.executionRepository && typeof ctx.deps.executionRepository.getLatestProviderInvocationUsageBySession === "function")
    ? ctx.deps.executionRepository.getLatestProviderInvocationUsageBySession(ctx.workspaceSessionId, "task_coding")
    : null;
  const continueSessionId = previousInvocation?.nativeSessionId || (ctx.provider === "claude-code" ? null : ctx.workspaceSessionId);
  // opencode's `export <sessionID>` reports cumulative totals for the whole
  // session, so a follow-up run that resumes the same session needs the
  // prior invocation's raw snapshot as a baseline to subtract out (see
  // ProviderExecutionService.executeProvider / collectProviderUsageTelemetry).
  const openCodeBaselineRawUsageJson = ctx.provider === "opencode" ? (previousInvocation?.rawUsageJson ?? null) : null;

  const providerExecutionService = new ProviderExecutionService({
    executionRepository: ctx.deps.executionRepository,
    sessionTracking: ctx.deps.sessionTracking,
    providerRunner: ctx.providerRunner,
    providerConcurrencyService: ctx.deps.providerConcurrencyService,
    getGithubToken: ctx.deps.getGithubToken,
    getMcpConnectionInfo: ctx.deps.getMcpConnectionInfo,
    skillService: ctx.deps.skillService,
    agentPresetRepository: ctx.deps.agentPresetRepository,
    getDashboardSettings: ctx.deps.getDashboardSettings,
    settingsCredentialResolver: ctx.deps.settingsCredentialResolver,
  });

  // The provider concurrency cap is a provider-level setting (already clamped to the system
  // ceiling during settings resolution). Pass it through explicitly so containerized tasks
  // enforce the configured cap instead of falling back to provider defaults.
  const concurrencyLimit = providerSettings.maxConcurrentTasks;

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
    maxConcurrentTasks: concurrencyLimit,
    prompt: providerPrompt,
    cwd: ctx.worktreePath,
    model: effectiveModel,
    thinkingMode: providerSettings.thinkingMode,
    apiKey: "",
    apiKeyCredentialRef: providerSettings.apiKeyCredentialRef,
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
    providerConfigMode,
    providerConfigPath,
    customBaseUrl: providerSettings.customBaseUrl,
    customModel: providerSettings.customModel,
    sessionId: ctx.sessionId,
    workspaceSessionId: ctx.workspaceSessionId,
    continueSessionId,
    openCodeBaselineRawUsageJson,
    workflowSettings: ctx.workflowSettings,
    repoPath: ctx.repoPath,
    gitPolicy: {
      githubMode: ctx.settings.git.githubMode,
      defaultBranch: ctx.settings.git.defaultBranch,
      githubToken: ctx.settings.git.githubToken,
      gitlabToken: ctx.settings.git.gitlabToken,
    },
    githubTokenCredentialRef: ctx.settings.git.githubTokenCredentialRef,
    gitlabTokenCredentialRef: ctx.settings.git.gitlabTokenCredentialRef,
    signal: ctx.abortSignal,
    customMcpServers: ctx.settings.customMcpServers,
    agentMcpAccess: ctx.agentMcpAccess,
    mcpAgentId: ctx.agentPresetId ?? null,
  });

  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || "Provider failed without output.");
  }
  return result;
}
