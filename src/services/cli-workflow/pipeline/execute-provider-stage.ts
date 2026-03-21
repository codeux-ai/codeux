import type { PipelineContext } from "./pipeline-context.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "../../cli-workflow-text-utils.js";
import { classifyProviderError, ProviderQuotaError } from "../../../shared/providers/provider-error-classifier.js";

export async function executeProviderStage(ctx: PipelineContext, providerPrompt: string): Promise<void> {
  const providerSettings = ctx.settings.aiProvider.providers[ctx.provider];
  const model = ctx.provider === ctx.settings.workers.virtualWorkerProvider && ctx.settings.workers.model && ctx.settings.workers.model !== "default"
    ? ctx.settings.workers.model
    : providerSettings.model;

  const runProvider = (p: string) =>
    ctx.providerRunner.runProvider({
      provider: ctx.provider,
      prompt: p,
      cwd: ctx.worktreePath,
      model,
      apiKey: providerSettings.apiKey,
      sessionId: ctx.sessionId,
      workflowSettings: ctx.workflowSettings,
      repoPath: ctx.repoPath,
      githubToken: ctx.deps.getGithubToken(),
      signal: ctx.abortSignal,
      onActivity: (desc, originator) =>
        ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
          description: desc,
          originator: originator || "system",
        }),
    });

  let providerResult = await runProvider(providerPrompt);

  if (!providerResult.ok && ctx.workflowSettings.retryOnReadFileNotFound && isReadFileNotFoundToolError(providerResult)) {
    ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
      originator: "system",
      description: "Retrying with file-discovery guidance.",
    });
    providerResult = await runProvider(buildReadFileRetryPrompt(providerPrompt));
  }

  if (!providerResult.ok) {
    const classification = classifyProviderError(ctx.provider, providerResult);
    if (classification.category !== "UNKNOWN") {
      throw new ProviderQuotaError(classification);
    }
    throw new Error(classification.userMessage);
  }
}
