import type { PipelineContext } from "./pipeline-context.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "../../cli-workflow-text-utils.js";

export async function executeProviderStage(ctx: PipelineContext, providerPrompt: string): Promise<void> {
  const providerSettings = ctx.settings.aiProvider.providers[ctx.provider];

  const runProvider = (p: string) =>
    ctx.providerRunner.runProvider({
      provider: ctx.provider,
      prompt: p,
      cwd: ctx.worktreePath,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      sessionId: ctx.sessionId,
      workflowSettings: ctx.workflowSettings,
      repoPath: ctx.repoPath,
      githubToken: ctx.deps.getGithubToken(),
      onActivity: (desc, originator) =>
        ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
          description: desc,
          originator: originator as any || "system",
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
    throw new Error(providerResult.stderr || providerResult.stdout || `${ctx.provider} failed`);
  }
}
