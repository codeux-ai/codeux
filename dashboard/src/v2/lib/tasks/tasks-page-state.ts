import type { Task, TaskPriority, TaskStatus } from "../../types.js";
import type { ExecutionTaskDispatchSummary, ExecutionRuntimeEventSummary, Subtask } from "../../../types.js";
import { deriveTaskBoardState, type TaskBoardState } from "../task-board-state.js";
import { type ListWindowOption } from "../list-window.js";
import { buildLiveTaskEnrichmentMap } from "./live-task-enrichment.js";
import { buildTaskCardViewModel, type TaskCardViewModel } from "./task-card-view-model.js";

export interface TasksPageState extends TaskBoardState {
  allTasks: Task[];
  taskLookup: Map<string, Task>;
  taskViewModels: Map<string, TaskCardViewModel>;
}

export function deriveTasksPageState({
  tasks,
  optimisticTasks,
  statusFilter,
  priorityFilter,
  listWindow,
  taskScopeSprintId,
  taskDispatches,
  recentEvents,
  subtasks,
}: {
  tasks: Task[];
  optimisticTasks: Task[];
  statusFilter: "all" | TaskStatus;
  priorityFilter: "all" | TaskPriority;
  listWindow: ListWindowOption;
  taskScopeSprintId: string | null;
  taskDispatches: ExecutionTaskDispatchSummary[];
  recentEvents: ExecutionRuntimeEventSummary[];
  subtasks: Subtask[];
}): TasksPageState {
  const allTasks = [...optimisticTasks, ...tasks];
  const taskLookup = new Map(allTasks.map(t => [t.recordId, t]));

  const boardState = deriveTaskBoardState(allTasks, statusFilter, priorityFilter, listWindow);

  const scopedDispatches = taskScopeSprintId
    ? taskDispatches.filter((d) => d.sprintId === taskScopeSprintId)
    : taskDispatches;
    
  const scopedEvents = taskScopeSprintId
    ? recentEvents.filter((e) => e.sprintId === taskScopeSprintId)
    : recentEvents;

  const liveEnrichmentMap = buildLiveTaskEnrichmentMap(subtasks, scopedDispatches, scopedEvents);

  const taskViewModels = new Map<string, TaskCardViewModel>();
  allTasks.forEach(task => {
    taskViewModels.set(task.recordId, buildTaskCardViewModel(task, taskLookup, liveEnrichmentMap.get(task.recordId)));
  });

  return {
    ...boardState,
    allTasks,
    taskLookup,
    taskViewModels,
  };
}
