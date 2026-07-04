import type { Task, TaskPriority, TaskStatus } from "../../types.js";
import type { Sprint } from "../../types.js";
import type { ExecutionTaskDispatchSummary, ExecutionRuntimeEventSummary, Subtask } from "../../../types.js";
import { type ListWindowOption } from "../list-window.js";
import { deriveTaskBoardState, type TaskBoardState } from "../task-board-state.js";
import { buildLiveTaskEnrichmentMap } from "./live-task-enrichment.js";
import { buildTaskCardViewModel, type TaskCardViewModel } from "./task-card-view-model.js";
import { STATUS_CFG } from "../tasks-constants.js";

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
  filterAnnouncement: string;
}

export interface TaskBoardSprintScopeState {
  label: string;
  description: string;
  isScoped: boolean;
  isLoading: boolean;
  isEmpty: boolean;
}

function formatStatusFilter(statusFilter: "all" | TaskStatus): string {
  return statusFilter === "all" ? "all statuses" : `${STATUS_CFG[statusFilter].label} status`;
}

function formatPriorityFilter(priorityFilter: "all" | TaskPriority): string {
  return priorityFilter === "all" ? "any priority" : `${priorityFilter} priority`;
}

export function buildTaskFilterAnnouncement(args: {
  totalCount: number;
  visibleCount: number;
  statusFilter: "all" | TaskStatus;
  priorityFilter: "all" | TaskPriority;
  scopeLabel: string;
}): string {
  const taskWord = args.totalCount === 1 ? "task" : "tasks";
  const visibleSuffix = args.visibleCount < args.totalCount
    ? `, ${args.visibleCount} currently visible`
    : "";
  return `Task board now shows ${args.totalCount} ${taskWord}${visibleSuffix} in ${args.scopeLabel} for ${formatStatusFilter(args.statusFilter)} and ${formatPriorityFilter(args.priorityFilter)}.`;
}

export function buildTaskBoardSprintScopeState(args: {
  sprints: Sprint[];
  selectedSprintId: string | null;
  selectedSprintLabel: string | null;
  loading: boolean;
}): TaskBoardSprintScopeState {
  if (args.loading) {
    return {
      label: "Loading sprints",
      description: "Sprint scope options are loading.",
      isScoped: false,
      isLoading: true,
      isEmpty: false,
    };
  }

  if (args.sprints.length === 0) {
    return {
      label: "No sprints",
      description: "Create a sprint before selecting task scope.",
      isScoped: false,
      isLoading: false,
      isEmpty: true,
    };
  }

  if (args.selectedSprintId && args.selectedSprintLabel) {
    return {
      label: args.selectedSprintLabel,
      description: `Task board scoped to ${args.selectedSprintLabel}.`,
      isScoped: true,
      isLoading: false,
      isEmpty: false,
    };
  }

  return {
    label: "All Sprints",
    description: "Task board scoped to all project sprints.",
    isScoped: false,
    isLoading: false,
    isEmpty: false,
  };
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

  const optimisticRecordIds = new Set(optimisticTasks.map((task) => task.recordId));
  const allTasks = [
    ...optimisticTasks,
    ...tasks.filter((task) => !optimisticRecordIds.has(task.recordId)),
  ];
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
    filterAnnouncement: buildTaskFilterAnnouncement({
      totalCount: boardState.filteredTasks.length,
      visibleCount: boardState.visibleTasks.length,
      statusFilter,
      priorityFilter,
      scopeLabel: taskScopeSprintId ? "selected sprint" : "all sprints",
    }),
  };
}
