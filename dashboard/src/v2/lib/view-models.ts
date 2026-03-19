import type { Source, Sprint, SprintRecord, Task, TaskRecord } from "../types.js";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function toSprintViewModel(sprint: SprintRecord): Sprint {
  return {
    ...sprint,
    date: formatSprintDateRange(sprint.startDate, sprint.endDate),
  };
}

export function toTaskViewModel(task: TaskRecord, sourcesById: Map<string, Source>, sprintsById: Map<string, Sprint>): Task {
  const sprint = sprintsById.get(task.sprintId);
  const source = sourcesById.get(task.projectId);

  return {
    recordId: task.id,
    id: task.taskKey,
    source: source?.name || "Unassigned",
    sprint: sprint?.name || "Sprint",
    sprintId: task.sprintId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    executorType: task.executorType,
    assignee: inferAssignee(task),
    time: inferTime(task),
    createdAt: task.createdAt,
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
  if (task.executorType === "mcp_worker") {
    return "Worker";
  }
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
  if (task.executorType === "mcp_worker" && task.status !== "completed") {
    return "Queued";
  }
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
