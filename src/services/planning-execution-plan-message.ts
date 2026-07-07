import type { AppendExecutionInvocationMessageInput } from "../contracts/execution-types.js";
import type { PlannedTaskDraft, TaskExecutorType, TaskPriority } from "../contracts/project-management-types.js";

export interface PlanningExecutionPlanMessageInput {
  invocationId: string;
  projectId: string;
  sprintId: string;
  sprintNumber: number | null;
  sprintName: string;
  goal: string;
  tasks: readonly PlannedTaskDraft[];
  createdTaskIds: readonly string[];
}

interface PlanningExecutionPlanTaskSummary {
  key: string;
  title: string;
  description: string;
  priority: TaskPriority;
  executorType: TaskExecutorType;
  dependsOn: string[];
}

interface PlanningExecutionPlanMetadata {
  invocationId: string;
  projectId: string;
  sprintId: string;
  sprintNumber: number | null;
  sprintName: string;
  goal: string;
  taskCount: number;
  createdTaskIds: string[];
  tasks: PlanningExecutionPlanTaskSummary[];
}

export function buildPlanningExecutionPlanMessage(
  input: PlanningExecutionPlanMessageInput,
): AppendExecutionInvocationMessageInput {
  const tasks = input.tasks.map((task) => ({
    key: task.key,
    title: task.title,
    description: task.description,
    priority: task.priority || "medium",
    executorType: task.executorType || "auto",
    dependsOn: [...(task.dependsOn || [])],
  }));
  const executionPlan: PlanningExecutionPlanMetadata = {
    invocationId: input.invocationId,
    projectId: input.projectId,
    sprintId: input.sprintId,
    sprintNumber: input.sprintNumber,
    sprintName: input.sprintName,
    goal: input.goal,
    taskCount: tasks.length,
    createdTaskIds: [...input.createdTaskIds],
    tasks,
  };

  return {
    role: "assistant",
    contentMarkdown: buildPlanningExecutionPlanMarkdown(executionPlan),
    metadata: {
      widget_metadata: {
        type: "planning_request",
        status: "completed",
        projectId: input.projectId,
        sprintId: input.sprintId,
        sprintNumber: input.sprintNumber,
        sprintName: input.sprintName,
      },
      executionPlan,
    },
  };
}

function buildPlanningExecutionPlanMarkdown(plan: PlanningExecutionPlanMetadata): string {
  const sprintLabel = plan.sprintNumber === null
    ? plan.sprintName
    : `Sprint ${plan.sprintNumber} - ${plan.sprintName}`;
  const lines = [
    `## Execution Plan: ${sprintLabel}`,
    "",
    `Goal: ${plan.goal}`,
    "",
    `Planned ${plan.taskCount} ${plan.taskCount === 1 ? "task" : "tasks"}:`,
  ];

  for (const task of plan.tasks) {
    const dependencySummary = task.dependsOn.length > 0
      ? ` (depends on ${task.dependsOn.map((key) => `\`${key}\``).join(", ")})`
      : "";
    lines.push(`- \`${task.key}\` - ${task.title}${dependencySummary}`);
  }

  return lines.join("\n");
}
