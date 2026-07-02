import type { AiProviderSettings, ProviderId, Subtask, TaskPrSectionKey, TaskPrTemplateSections } from "../../../contracts/app-types.js";
import type { SprintRecord } from "../../../contracts/project-management-types.js";
import type { TaskRunRecord } from "../../../contracts/execution-types.js";
import type { ExecutionRepository } from "../../../repositories/execution-repository.js";
import type { TaskPrComposerInput } from "./pr-description-composer.js";
import { foldUsageGroups } from "./pr-billing-mode.js";

export interface BuildTaskPrComposerInputArgs {
  projectId: string;
  task: Subtask;
  sprint: SprintRecord | null;
  provider: Exclude<ProviderId, "jules">;
  featureBranch: string;
  workerBranch: string;
  taskRun: TaskRunRecord | null;
  aiProviderSettings: AiProviderSettings;
  sections: TaskPrTemplateSections;
  sectionOrder?: TaskPrSectionKey[];
  executionRepository?: ExecutionRepository;
}

export function buildTaskPrComposerInput(args: BuildTaskPrComposerInputArgs): TaskPrComposerInput {
  const groups = args.executionRepository ? args.executionRepository.getTaskUsageGroups(args.projectId, args.task.id) : [];
  const providerConfigs = Object.fromEntries(
    Object.entries(args.aiProviderSettings.providers || {}).map(([id, config]) => [id, config]),
  );
  const usage = groups.length > 0 ? foldUsageGroups(groups, providerConfigs) : null;

  const invocations = args.executionRepository
    ? args.executionRepository.listProviderInvocationsForTask(args.projectId, args.task.id)
    : [];
  const latestModel = invocations.length > 0 ? invocations[invocations.length - 1].model : null;

  const qa = args.task.latestReview
    ? {
      summary: args.task.latestReview.summary,
      findings: args.task.latestReview.findings,
      outcome: args.task.latestReview.outcome,
      reviewer: args.task.latestReview.reviewer,
      finishedAt: args.task.latestReview.finishedAt,
    }
    : null;

  return {
    taskId: args.task.id,
    taskTitle: args.task.title,
    taskPrompt: args.task.prompt,
    provider: args.provider,
    model: latestModel || args.task.model || null,
    sprintGoal: args.sprint?.goal ?? null,
    sprintNumber: args.sprint?.number ?? null,
    sprintName: args.sprint?.name ?? null,
    featureBranch: args.featureBranch,
    workerBranch: args.workerBranch,
    startedAt: args.taskRun?.startedAt ?? null,
    finishedAt: args.taskRun?.finishedAt ?? null,
    durationMs: args.taskRun?.durationMs ?? null,
    usage,
    qa,
    sections: args.sections,
    sectionOrder: args.sectionOrder,
  };
}
