import type { AiProviderSettings, SprintPrSectionKey, SprintPrTemplateSections, Subtask } from "../../../contracts/app-types.js";
import type { SprintLinkedIssueRecord, SprintRecord } from "../../../contracts/project-management-types.js";
import type { ExecutionRepository } from "../../../repositories/execution-repository.js";
import type { SprintPrComposerInput, SprintPrLinkedIssueSummary, SprintPrSubtaskSummary } from "./pr-description-composer.js";
import { foldUsageGroups } from "./pr-billing-mode.js";

export interface BuildSprintPrComposerInputArgs {
  sprint: SprintRecord;
  sprintRunId: string;
  subtasks: Subtask[];
  featureBranch: string;
  defaultBranch: string;
  aiProviderSettings: AiProviderSettings;
  sections: SprintPrTemplateSections;
  sectionOrder?: SprintPrSectionKey[];
  completionTimestamp?: string;
  executionRepository: ExecutionRepository;
}

function isTaskCompleted(task: Subtask): boolean {
  return task.status === "COMPLETED"
    || (task.status === "CODING_COMPLETED" && (task.is_merged || task.merge_indicator === "MERGED" || task.merge_indicator === "AUTOMERGE"));
}

function mapLinkedIssue(issue: SprintLinkedIssueRecord): SprintPrLinkedIssueSummary {
  return {
    provider: issue.provider,
    issueKey: issue.issueKey,
    issueNumber: issue.issueNumber,
    title: issue.title,
    url: issue.url,
  };
}

export function buildSprintPrComposerInput(args: BuildSprintPrComposerInputArgs): SprintPrComposerInput {
  const { sprint, executionRepository } = args;
  const providerConfigs = Object.fromEntries(
    Object.entries(args.aiProviderSettings.providers || {}).map(([id, config]) => [id, config]),
  );

  const sprintRun = executionRepository.getSprintRun(args.sprintRunId);
  const finishedAt = sprintRun?.finishedAt ?? args.completionTimestamp ?? null;

  const aggregateGroups = executionRepository.getSprintUsageGroups(sprint.projectId, sprint.id);
  const aggregateUsage = aggregateGroups.length > 0 ? foldUsageGroups(aggregateGroups, providerConfigs) : null;

  const planningGroups = executionRepository.getSprintUsageGroups(sprint.projectId, sprint.id, "planning");
  const planningUsage = planningGroups.length > 0 ? foldUsageGroups(planningGroups, providerConfigs) : null;
  const planningInvocations = executionRepository.listProviderInvocationsForSprint(sprint.projectId, sprint.id, "planning");
  const latestPlanning = planningInvocations.length > 0 ? planningInvocations[planningInvocations.length - 1] : null;
  const planning = latestPlanning
    ? { provider: latestPlanning.provider, model: latestPlanning.model, usage: planningUsage }
    : null;

  const subtasks: SprintPrSubtaskSummary[] = args.subtasks.map((task) => ({
    id: task.id,
    title: task.title,
    provider: task.provider,
    model: task.model,
    prUrl: task.pr_url,
    completed: isTaskCompleted(task),
  }));

  const qa = sprint.latestReview
    ? {
      summary: sprint.latestReview.summary,
      findings: sprint.latestReview.findings,
      outcome: sprint.latestReview.outcome,
      reviewer: sprint.latestReview.reviewer,
      finishedAt: sprint.latestReview.finishedAt,
    }
    : null;

  return {
    sprintId: sprint.id,
    sprintNumber: sprint.number,
    sprintName: sprint.name,
    sprintGoal: sprint.goal,
    sprintOriginalPrompt: sprint.originalPrompt,
    defaultBranch: args.defaultBranch,
    featureBranch: args.featureBranch,
    subtasks,
    linkedIssues: (sprint.linkedIssues || []).map(mapLinkedIssue),
    planning,
    aggregateUsage,
    startedAt: sprintRun?.startedAt ?? null,
    finishedAt,
    qa,
    sections: args.sections,
    sectionOrder: args.sectionOrder,
  };
}
