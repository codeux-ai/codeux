import type { DashboardSettings, Subtask } from "../../contracts/app-types.js";
import type { AgentPresetRecord as AgentPreset } from "../../contracts/agent-preset-types.js";
import type { TaskRunRecord } from "../../contracts/execution-types.js";
import type { QaReviewTriggerType } from "../../repositories/qa-review-repository.js";
import { evaluateQaReviewBudget, type QaReviewBudgetArgs } from "./qa-review-budget.js";
import { resolveAgentMemoryInstructions } from "../../services/agent-memory-instructions.js";
import type { ProjectSummary, SprintRecord } from "../../contracts/project-management-types.js";

export interface QaReviewRequestBuilderArgs {
  task: Pick<Subtask, "id" | "session_id" | "provider" | "pr_url" | "worker_branch" | "is_merged" | "record_id">;
  taskRun: Pick<TaskRunRecord, "id" | "taskId" | "workerBranch"> | null;
  project: Pick<ProjectSummary, "id" | "name"> | null;
  sprint: Pick<SprintRecord, "id" | "number" | "featureBranch" | "goal"> | null;
  sprintRunId: string | null;
  settings: DashboardSettings;
  budgetArgs: Omit<QaReviewBudgetArgs, "maxTaskReviewRuns">;
  resolveAgent: (projectId: string, agentPresetId: string | null) => Promise<AgentPreset>;
}

export interface BuiltQaReviewRequest {
  triggerType: QaReviewTriggerType;
  sprintFeatureBranch: string;
  agentPresetId: string;
  agentName: string;
  agentInstructions: string;
  runPayload: {
    projectId: string;
    sprintId: string;
    sprintRunId: string | null;
    taskId: string | null;
    taskRunId: string | null;
    triggerType: QaReviewTriggerType;
    runIndex: number;
    agentPresetId: string | null;
    agentName: string | null;
    targetTaskKey: string | null;
    targetSessionId: string | null;
    targetProvider: string | null;
    payload: Record<string, unknown> | null;
  };
}

export async function buildQaReviewRequest(args: QaReviewRequestBuilderArgs): Promise<BuiltQaReviewRequest | null> {
  const { task, project, sprint, settings, budgetArgs, resolveAgent } = args;

  if (!project || !sprint) {
    return null;
  }

  const qaSettings = settings.agents.qualityAssurance;
  if (!qaSettings.enabled) {
    return null;
  }

  const triggerType = resolveTaskTriggerType(task, qaSettings);
  if (!triggerType) {
    return null;
  }

  const budget = evaluateQaReviewBudget({
    ...budgetArgs,
    maxTaskReviewRuns: qaSettings.maxTaskReviewRuns,
  });

  if (!budget.allowed) {
    return null;
  }

  const sprintFeatureBranch = sprint.featureBranch?.trim()
    || `${settings.git.featureBranchPrefix || "feature/"}sprint-${sprint.number ?? 0}`;

  // A null agentPresetId is the common/default case: the project hasn't pinned a
  // specific QA preset, so resolveAgent falls back to the project's default QA
  // agent. Do NOT bail here — an early `return null` silently skips QA entirely
  // for every QA-enabled project that uses the default agent, stranding tasks at
  // CODING_COMPLETED/QA_PENDING and blocking all merges.
  const agentPresetId = triggerType === "completed_task_without_pr"
    ? qaSettings.completedTaskWithoutPr.agentPresetId
    : qaSettings.taskCompletion.agentPresetId;

  const agent = await resolveAgent(project.id, agentPresetId);

  const memoryInstructions = resolveAgentMemoryInstructions(
    agent,
    settings.memory?.workerLearningsInstruction
  );
  const agentInstructions = agent.instructionMarkdown + (memoryInstructions ? `\n\n### Memory Capture Instructions\n${memoryInstructions}` : "");

  const runPayload = {
    projectId: project.id,
    sprintId: sprint.id,
    sprintRunId: args.sprintRunId || null,
    taskId: task.record_id?.trim() || null,
    taskRunId: args.taskRun?.id || null,
    triggerType,
    runIndex: budgetArgs.existingRuns + 1,
    agentPresetId: agent.id,
    agentName: agent.name,
    targetTaskKey: task.id,
    targetSessionId: task.session_id || null,
    targetProvider: task.provider || null,
    payload: {
      taskKey: task.id,
      runIndex: budgetArgs.existingRuns + 1,
    },
  };

  return {
    triggerType,
    sprintFeatureBranch,
    agentPresetId: agent.id,
    agentName: agent.name,
    agentInstructions,
    runPayload,
  };
}

export function resolveTaskTriggerType(
  task: Pick<Subtask, "pr_url" | "worker_branch" | "is_merged">,
  qaSettings: DashboardSettings["agents"]["qualityAssurance"],
): QaReviewTriggerType | null {
  const hasMergeEvidence = Boolean(task.pr_url?.trim())
    || Boolean(task.worker_branch?.trim())
    || Boolean(task.is_merged);
  if (!hasMergeEvidence && qaSettings.completedTaskWithoutPr.enabled) {
    return "completed_task_without_pr";
  }
  return qaSettings.taskCompletion.enabled ? "task_completion" : null;
}
