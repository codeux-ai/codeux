import type { Task, TaskPriority, TaskStatus } from "../../types.js";
import type { ExecutionTaskDispatchSummary, ExecutionRuntimeEventSummary, Subtask } from "../../../types.js";
import { type ListWindowOption } from "../list-window.js";
import { deriveTaskBoardState, type TaskBoardState } from "../task-board-state.js";
import { buildLiveTaskEnrichmentMap } from "./live-task-enrichment.js";
import { buildTaskCardViewModel, type TaskCardViewModel } from "./task-card-view-model.js";

export interface TaskBoardViewModelOptions {
  tasks: Task[];
  optimisticTasks: Task[];
  statusFilter: "all" | TaskStatus;
  priorityFilter: "all" | TaskPriority;
  listWindow: ListWindowOption;
  taskScopeSprintId: string | null;
  taskDispatches: ExecutionTaskDispatchSummary[];
  recentEvents: ExecutionRuntimeEventSummary[];
  subtasks: Subtask[];
}

export interface TaskBoardViewModel {
  boardState: TaskBoardState;
  taskViewModels: Map<string, TaskCardViewModel>;
}

export function buildTaskBoardViewModel(options: TaskBoardViewModelOptions): TaskBoardViewModel {
  const {
    tasks,
    optimisticTasks,
    statusFilter,
    priorityFilter,
    listWindow,
    taskScopeSprintId,
    taskDispatches,
    recentEvents,
    subtasks,
  } = options;

  const allTasks = [...optimisticTasks, ...tasks];
  const taskLookup = new Map<string, Task>();
  for (const task of allTasks) {
    taskLookup.set(task.recordId, task);
  }

  const boardState = deriveTaskBoardState(allTasks, statusFilter, priorityFilter, listWindow);

  let scopedDispatches = taskDispatches;
  let scopedEvents = recentEvents;

  if (taskScopeSprintId) {
    scopedDispatches = taskDispatches.filter((d) => d.sprintId === taskScopeSprintId);
    scopedEvents = recentEvents.filter((e) => e.sprintId === taskScopeSprintId);
  }

  const liveEnrichmentMap = buildLiveTaskEnrichmentMap(subtasks, scopedDispatches, scopedEvents);

  const taskViewModels = new Map<string, TaskCardViewModel>();
  for (const task of allTasks) {
    taskViewModels.set(
      task.recordId,
      buildTaskCardViewModel(task, taskLookup, liveEnrichmentMap.get(task.recordId))
    );
  }

  return {
    boardState,
    taskViewModels,
  };
}
