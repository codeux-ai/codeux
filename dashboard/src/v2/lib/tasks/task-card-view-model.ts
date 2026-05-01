import type { Task, TaskStatus, TaskExecutorType } from "../../types.js";

export interface DependencyIndicator {
  recordId: string;
  id: string;
  title: string;
  status: TaskStatus;
}

export interface TaskCardViewModel {
  task: Task;
  humanizedCreatedAt: string;
  executorLabel: string;
  dependencyIndicators: DependencyIndicator[];
}

const EXECUTOR_LABEL: Record<TaskExecutorType, string> = {
  auto: "Auto",
  docker_cli: "CLI",
  jules: "Jules",
};

export function formatTimeAgo(iso: string, now: number = Date.now()): string {
  const timestamp = new Date(iso).getTime();
  if (isNaN(timestamp)) {
    return "--";
  }

  const mins = Math.floor((now - timestamp) / 60000);
  if (mins < 0) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function getExecutorLabel(executorType: TaskExecutorType): string {
  return EXECUTOR_LABEL[executorType] || "Unknown";
}

export function buildTaskCardViewModel(
  task: Task,
  taskLookup: Map<string, Task>
): TaskCardViewModel {
  const dependencyIndicators: DependencyIndicator[] = (task.dependsOnTaskIds || []).map(depId => {
    const depTask = taskLookup.get(depId);
    if (!depTask) {
      return {
        recordId: depId,
        id: depId,
        title: `Unknown Task (${depId})`,
        status: "pending", // default fallback
      };
    }
    return {
      recordId: depTask.recordId,
      id: depTask.id,
      title: depTask.title,
      status: depTask.status,
    };
  });

  return {
    task,
    humanizedCreatedAt: formatTimeAgo(task.createdAt),
    executorLabel: getExecutorLabel(task.executorType),
    dependencyIndicators,
  };
}
