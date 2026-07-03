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
  completionTimestamp?: string;
  aiProviderSettings: AiProviderSettings;
  sections: TaskPrTemplateSections;
  sectionOrder?: TaskPrSectionKey[];
  executionRepository?: ExecutionRepository;
}

function resolveTaskRunDurationMs(taskRun: TaskRunRecord | null, finishedAt: string | null): number | null {
  if (!taskRun) return null;
  if (taskRun.durationMs != null) return taskRun.durationMs;
  if (!taskRun.startedAt || !finishedAt) return null;

  const startedMs = new Date(taskRun.startedAt).getTime();
  const finishedMs = new Date(finishedAt).getTime();
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs)) return null;
  return Math.max(0, finishedMs - startedMs);
}

export function buildTaskPrComposerInput(args: BuildTaskPrComposerInputArgs): TaskPrComposerInput {
  const telemetryTaskId = args.task.record_id?.trim() || args.task.id;
  const groups = args.executionRepository ? args.executionRepository.getTaskUsageGroups(args.projectId, telemetryTaskId) : [];
  const providerConfigs = Object.fromEntries(
    Object.entries(args.aiProviderSettings.providers || {}).map(([id, config]) => [id, config]),
  );
  const usage = groups.length > 0 ? foldUsageGroups(groups, providerConfigs) : null;

  const invocations = args.executionRepository
    ? args.executionRepository.listProviderInvocationsForTask(args.projectId, telemetryTaskId)
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
  const finishedAt = args.taskRun?.finishedAt ?? args.completionTimestamp ?? null;

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
    finishedAt,
    durationMs: resolveTaskRunDurationMs(args.taskRun, finishedAt),
    usage,
    qa,
    sections: args.sections,
    sectionOrder: args.sectionOrder,
  };
}
