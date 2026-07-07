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
    areReviewSummariesEqual(prevTask.latestReview, task.latestReview) &&
    areSelfReflectionRatingsEqual(prevTask.selfReflectionRating, task.selfReflectionRating) &&
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
    agentPresetId: task.agentPresetId,
    assignee,
    time,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    promptMarkdown: task.promptMarkdown,
    description: task.description,
    dependsOnTaskIds: task.dependsOnTaskIds,
    isIndependent: task.isIndependent,
    isMerged: task.isMerged,
    latestReview: task.latestReview,
    selfReflectionRating: task.selfReflectionRating,
    mergeIndicator: task.mergeIndicator,
  };
}

function areReviewSummariesEqual(left: Task["latestReview"], right: TaskRecord["latestReview"]): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.status === right.status
    && left.outcome === right.outcome
    && left.summary === right.summary
    && left.reviewer === right.reviewer
    && left.finishedAt === right.finishedAt
    && left.findings.length === right.findings.length
    && left.findings.every((finding, index) => finding === right.findings[index]);
}

function areSelfReflectionRatingsEqual(left: Task["selfReflectionRating"], right: TaskRecord["selfReflectionRating"]): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.id === right.id
    && left.projectId === right.projectId
    && left.sprintId === right.sprintId
    && left.taskId === right.taskId
    && left.sourceTaskRunId === right.sourceTaskRunId
    && left.overallRating === right.overallRating
    && left.capturedAt === right.capturedAt
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
    && left.sections.length === right.sections.length
    && left.sections.every((section, index) => {
      const other = right.sections[index];
      return Boolean(other)
        && section.label === other.label
        && section.normalizedLabel === other.normalizedLabel
        && section.rating === other.rating
        && section.note === other.note;
    });
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
