import { buildProviderSettingsOverride } from "../../provider-settings-override.js";
import { buildProviderPrompt } from "../../cli-workflow-utils.js";
import type { PipelineContext } from "./pipeline-context.js";
import { resolveProviderForInvocation } from "../../provider-routing.js";
import { resolveAgentMemoryInstructions } from "../../agent-memory-instructions.js";
import { buildRelevantMemoryInjectionContext } from "../../memory-injection-context.js";
import { buildTaskCodingOutcomeInstructions } from "../../../domain/sprint/task-execution-outcome.js";

export async function executePrepareStage(
  ctx: PipelineContext,
  resumeFromFailedSessionId?: string
): Promise<{ worktreePath: string; initialHead: string; providerPrompt: string; resumed?: boolean }> {
  const resolvedProvider = resolveProviderForInvocation(ctx.settings, {
    invocation: "task_coding",
    task: ctx.task,
  });
  const resolvedProviderSettings = resolvedProvider.providers[ctx.provider];
  const providerSettings = ctx.providerSettingsOverride || buildProviderSettingsOverride(resolvedProviderSettings.model, resolvedProviderSettings);

  const workerGuide = await ctx.deps.getWorkerInstruction(ctx.repoPath);

  let promptBody = workerGuide
    ? `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerGuide}\n\n---\n\n## SUBTASK TO EXECUTE\n\n${ctx.task.prompt}`
    : ctx.task.prompt;

  // Inject memory context (short-term + long-term) for this worker agent
  if (ctx.settings.memory?.enabled && ctx.deps.memoryService && ctx.agentPresetId) {
    try {
      const memCfg = ctx.agentMemoryConfig;
      let projectId: string | undefined;
      let sprintId: string | undefined;
      if (ctx.taskRunId && ctx.deps.executionRepository) {
        const taskRun = ctx.deps.executionRepository.getTaskRun(ctx.taskRunId);
        if (taskRun) { projectId = taskRun.projectId; sprintId = taskRun.sprintId ?? undefined; }
      }
      if (projectId) {
        const memoryContext = await buildRelevantMemoryInjectionContext(ctx.deps.memoryService, {
          projectId,
          sprintId,
          agentPresetId: ctx.agentPresetId,
          query: ctx.task.prompt,
          config: memCfg,
          tokenBudget: 1_800,
        });
        if (memoryContext.markdown) promptBody += `\n\n${memoryContext.markdown}`;
      }
    } catch { /* memory injection is best-effort */ }
  }

  if (ctx.settings.memory?.enabled && ctx.settings.memory.autoCaptureSprint) {
    const learningsInstruction = resolveAgentMemoryInstructions(
      {
        memoryTemplateOverrideEnabled: ctx.memoryTemplateOverrideEnabled,
        memoryTemplateMarkdown: ctx.memoryTemplateMarkdown,
      },
      ctx.settings.memory.workerLearningsInstruction
    );

    if (learningsInstruction) {
      promptBody += `\n\n## LEARNINGS CAPTURE (Required)\n\n${learningsInstruction}`;
    }
  }

  const { worktreePath: finalPath, resumed } = await ctx.invocationWorkspacePreparer.prepareWorktree({
    repoPath: ctx.repoPath,
    worktreePath: ctx.worktreePath,
    workerBranch: ctx.workerBranch,
    featureBranch: ctx.featureBranch,
    resumeSessionId: resumeFromFailedSessionId,
    gitAuth: {
      githubToken: ctx.settings.git.githubToken,
      gitlabToken: ctx.settings.git.gitlabToken,
    },
    gitPolicy: {
      githubMode: ctx.settings.git.githubMode,
      defaultBranch: ctx.settings.git.defaultBranch,
      githubToken: ctx.settings.git.githubToken,
      gitlabToken: ctx.settings.git.gitlabToken,
      ...(ctx.settings.git.githubMode === "REMOTE" ? {
        projectId: ctx.task.project_id,
        workspaceId: ctx.workspaceSessionId,
        githubTokenCredentialRef: ctx.settings.git.githubTokenCredentialRef,
        gitlabTokenCredentialRef: ctx.settings.git.gitlabTokenCredentialRef,
      } : {}),
    },
  });

  ctx.worktreePath = finalPath;

  const workspaceGuidance = await ctx.workspaceManager.buildWorkspaceGuidance(ctx.task.prompt, ctx.worktreePath);
  const outcomeInstructions = buildTaskCodingOutcomeInstructions(ctx.taskClarificationContext ?? {
    taskId: ctx.task.record_id || ctx.task.id,
    taskRunId: ctx.taskRunId,
    sessionId: ctx.sessionId,
  });
  const providerPrompt = buildProviderPrompt(
    `${promptBody}\n\n${workspaceGuidance}\n\n${outcomeInstructions}`,
    providerSettings.thinkingMode,
    ctx.provider,
  );

  const initialHead = (await ctx.runCommand("git", ["rev-parse", "HEAD"], ctx.worktreePath)).stdout.trim();
  ctx.initialHead = initialHead;

  if (resumed) {
    ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
      originator: "system",
      description: `Resumed failed workspace from ${resumeFromFailedSessionId}.`,
    });
    try {
      await ctx.runCommand("git", ["merge", "--ff-only", `origin/${ctx.featureBranch}`], ctx.worktreePath);
      ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
        originator: "system",
        description: `Synced resumed workspace with latest origin/${ctx.featureBranch}.`,
      });
    } catch {
      ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
        originator: "system",
        description: `Resumed workspace could not fast-forward; continuing on existing state.`,
      });
    }
  }

  ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
    originator: "system",
    description: `Running ${ctx.provider} prompt on ${ctx.workerBranch}.`,
  });

  return { worktreePath: ctx.worktreePath, initialHead, providerPrompt, resumed };
}
