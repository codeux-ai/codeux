import type {
  ExecutionRuntimeEventSummary,
  ExecutionTaskDispatchSummary,
  Subtask,
} from "../../types.js";
import type { Task, TaskStatus } from "../types.js";
import { projectLiveTask } from "./live-task-runtime.js";

function mapTaskStatusToRuntimeStatus(status: TaskStatus): Subtask["status"] {
  switch (status) {
    case "in_progress":
      return "RUNNING";
    case "coding_completed":
      return "CODING_COMPLETED";
    case "completed":
      return "COMPLETED";
    case "pending":
    default:
      return "PENDING";
  }
}

function toMergeIndicator(value: string | null): Subtask["merge_indicator"] {
  switch (value) {
    case "CI":
    case "AUTOMERGE":
    case "MERGED":
    case "MERGE_BLOCKED":
    case "MERGE_CONFLICT":
      return value;
    default:
      return undefined;
  }
}

export function buildLiveSessionTasks(
  tasks: Task[],
  runtimeTasks: Subtask[],
  projectId: string | null,
  dispatches: ExecutionTaskDispatchSummary[] = [],
  events: ExecutionRuntimeEventSummary[] = [],
): Subtask[] {
  const taskKeyByRecordId = new Map(tasks.map((task) => [task.recordId, task.id]));
  const runtimeByRecordId = new Map(
    runtimeTasks
      .filter((task): task is Subtask & { record_id: string } => typeof task.record_id === "string" && task.record_id.length > 0)
      .map((task) => [task.record_id, task]),
  );
  const runtimeByTaskKey = new Map(runtimeTasks.map((task) => [task.id, task]));

  return tasks.map((task) => {

    let candidateTask: Subtask | undefined = runtimeByRecordId.get(task.recordId);
    if (!candidateTask || (candidateTask.sprint_id && candidateTask.sprint_id !== task.sprintId)) {
      candidateTask = runtimeByTaskKey.get(task.id);
    }
    const runtimeTask = candidateTask?.sprint_id && candidateTask.sprint_id !== task.sprintId ? undefined : candidateTask;
    const baseTask: Subtask = {
      record_id: task.recordId,
      project_id: runtimeTask?.project_id ?? projectId ?? undefined,
      sprint_id: runtimeTask?.sprint_id ?? task.sprintId,
      id: task.id,
      title: runtimeTask?.title ?? task.title,
      prompt: runtimeTask?.prompt ?? task.promptMarkdown ?? task.description ?? "",
      depends_on: task.dependsOnTaskIds.map((dependencyId) => taskKeyByRecordId.get(dependencyId) || dependencyId),
      status: runtimeTask?.status ?? mapTaskStatusToRuntimeStatus(task.status),
      session_id: runtimeTask?.session_id,
      session_name: runtimeTask?.session_name,
      session_state: runtimeTask?.session_state,
      provider: runtimeTask?.provider,
      worker_branch: runtimeTask?.worker_branch,
      pr_url: runtimeTask?.pr_url,
      activities: runtimeTask?.activities,
      is_independent: runtimeTask?.is_independent ?? task.isIndependent,
      latestReview: runtimeTask?.latestReview ?? task.latestReview,
      is_merged: runtimeTask?.is_merged ?? task.isMerged,
      merge_indicator: runtimeTask?.merge_indicator ?? toMergeIndicator(task.mergeIndicator),
    };

    return projectLiveTask(baseTask, dispatches, events);
  });
}
