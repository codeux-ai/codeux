import { buildProviderPrompt } from "../../cli-workflow-utils.js";
import type { PipelineContext } from "./pipeline-context.js";
import type { AgentMemoryConfig } from "../../../contracts/agent-preset-types.js";
import type { MemoryRecord } from "../../../contracts/memory-types.js";
import { resolveProviderForInvocation } from "../../provider-routing.js";
import { resolveAgentMemoryInstructions } from "../../agent-memory-instructions.js";

function formatMemoryContext(shortTerm: MemoryRecord[], longTerm: MemoryRecord[]): string {
  if (shortTerm.length === 0 && longTerm.length === 0) return "";
  const sections: string[] = ["## MEMORY CONTEXT"];
  if (longTerm.length > 0) {
    sections.push("### Long-Term Knowledge");
    for (const m of longTerm) sections.push(`- [${m.category}] ${m.content.slice(0, 300)}`);
  }
  if (shortTerm.length > 0) {
    sections.push("### Recent Sprint Learnings");
    for (const m of shortTerm) sections.push(`- [${m.category}] ${m.content.slice(0, 300)}`);
  }
  return sections.join("\n");
}

function passesStrength(m: MemoryRecord, cfg: AgentMemoryConfig | undefined): boolean {
  if (!cfg || cfg.minStrength === 0) return true;
  const perCat = cfg.minStrengthPerCategory?.[m.category];
  const threshold = perCat !== undefined ? perCat : cfg.minStrength;
  return m.strength >= threshold;
}

function passesCategory(m: MemoryRecord, cfg: AgentMemoryConfig | undefined): boolean {
  if (!cfg || cfg.categories.length === 0) return true;
  return cfg.categories.includes(m.category);
}

export async function executePrepareStage(
  ctx: PipelineContext,
  resumeFromFailedSessionId?: string
): Promise<{ worktreePath: string; initialHead: string; providerPrompt: string }> {
  const providerSettings = ctx.providerSettingsOverride || resolveProviderForInvocation(ctx.settings, {
    invocation: "task_coding",
    task: ctx.task,
  }).providers[ctx.provider];

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
        const fetchShort = !memCfg || memCfg.tier !== "long_term";
        const fetchLong = !memCfg || memCfg.tier !== "short_term";
        let shortTerm = fetchShort && sprintId
          ? ctx.deps.memoryService.listBySprintAndAgent(projectId, sprintId, ctx.agentPresetId, 100)
          : [];
        let longTerm = fetchLong
          ? ctx.deps.memoryService.listLongTermByAgent(projectId, ctx.agentPresetId, 100)
          : [];
        shortTerm = shortTerm.filter((m) => passesCategory(m, memCfg) && passesStrength(m, memCfg));
        longTerm = longTerm.filter((m) => passesCategory(m, memCfg) && passesStrength(m, memCfg));
        if (memCfg?.maxShortTerm && memCfg.maxShortTerm > 0) shortTerm = shortTerm.slice(0, memCfg.maxShortTerm);
        if (memCfg?.maxLongTerm && memCfg.maxLongTerm > 0) longTerm = longTerm.slice(0, memCfg.maxLongTerm);
        const memorySection = formatMemoryContext(shortTerm, longTerm);
        if (memorySection) promptBody += `\n\n${memorySection}`;
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

  const { worktreePath: finalPath, resumed } = await ctx.workspaceManager.prepareWorktree(
    ctx.repoPath,
    ctx.worktreePath,
    ctx.workerBranch,
    ctx.featureBranch,
    resumeFromFailedSessionId,
    {
      githubToken: ctx.settings.git.githubToken,
      gitlabToken: ctx.settings.git.gitlabToken,
    },
  );

  ctx.worktreePath = finalPath;

  const workspaceGuidance = await ctx.workspaceManager.buildWorkspaceGuidance(ctx.task.prompt, ctx.worktreePath);
  const providerPrompt = buildProviderPrompt(`${promptBody}\n\n${workspaceGuidance}`, providerSettings.thinkingMode);

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

  return { worktreePath: ctx.worktreePath, initialHead, providerPrompt };
}
