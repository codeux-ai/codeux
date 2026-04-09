import type { Source, Sprint, SprintRecord, Task, TaskRecord } from "../types.js";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function toSprintViewModel(sprint: SprintRecord): Sprint {
  return {
    ...sprint,
    date: formatSprintDateRange(sprint.startDate, sprint.endDate),
    latestReview: sprint.latestReview,
  };
}

export function toTaskViewModel(task: TaskRecord, sourcesById: Map<string, Source>, sprintsById: Map<string, Sprint>, prevTask?: Task): Task {
  const sprint = sprintsById.get(task.sprintId);
  const source = sourcesById.get(task.projectId);

  const assignee = inferAssignee(task);
  const time = inferTime(task);
  const sourceName = source?.name || "Unassigned";
  const sprintName = sprint?.name || "Sprint";

  if (
    prevTask &&
    prevTask.recordId === task.id &&
    prevTask.id === task.taskKey &&
    prevTask.source === sourceName &&
    prevTask.sprint === sprintName &&
    prevTask.sprintId === task.sprintId &&
    prevTask.title === task.title &&
    prevTask.status === task.status &&
    prevTask.priority === task.priority &&
    prevTask.executorType === task.executorType &&
    prevTask.assignee === assignee &&
    prevTask.time === time &&
    prevTask.createdAt === task.createdAt &&
    prevTask.updatedAt === task.updatedAt &&
    prevTask.promptMarkdown === task.promptMarkdown &&
    prevTask.description === task.description &&
    prevTask.isIndependent === task.isIndependent &&
    prevTask.isMerged === task.isMerged &&
    prevTask.mergeIndicator === task.mergeIndicator &&
    prevTask.dependsOnTaskIds.length === task.dependsOnTaskIds.length &&
    prevTask.dependsOnTaskIds.every((id, idx) => id === task.dependsOnTaskIds[idx])
  ) {
    return prevTask;
  }

  return {
    recordId: task.id,
    id: task.taskKey,
    source: sourceName,
    sprint: sprintName,
    sprintId: task.sprintId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    executorType: task.executorType,
    assignee,
    time,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    promptMarkdown: task.promptMarkdown,
    description: task.description,
    dependsOnTaskIds: task.dependsOnTaskIds,
    isIndependent: task.isIndependent,
    isMerged: task.isMerged,
    mergeIndicator: task.mergeIndicator,
  };
}

export function formatSprintDateRange(startDate: string | null, endDate: string | null): string {
  if (!startDate && !endDate) {
    return "Schedule TBD";
  }
  if (startDate && endDate) {
    return `${DATE_FORMATTER.format(new Date(startDate))} - ${DATE_FORMATTER.format(new Date(endDate))}`;
  }
  const resolvedDate = startDate || endDate;
  return resolvedDate ? DATE_FORMATTER.format(new Date(resolvedDate)) : "Schedule TBD";
}

function inferAssignee(task: TaskRecord): string {
  if (task.executorType === "jules") {
    return "Jules";
  }
  if (task.executorType === "docker_cli") {
    return "CLI";
  }
  if (task.status === "completed") {
    return "Finisher";
  }
  if (task.status === "coding_completed") {
    return "Closer";
  }
  if (task.status === "in_progress") {
    return "Runner";
  }
  if (task.priority === "critical") {
    return "Architect";
  }
  return "Planner";
}

function inferTime(task: TaskRecord): string {
  if (task.status === "completed") {
    return "Done";
  }
  if (task.status === "coding_completed") {
    return "Review";
  }
  if (task.status === "in_progress") {
    return "Active";
  }
  return "--";
}
