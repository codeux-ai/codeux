import type { Task, TaskPriority, TaskStatus } from "../../types.js";
import type { Sprint } from "../../types.js";
import type { ExecutionTaskDispatchSummary, ExecutionRuntimeEventSummary, Subtask } from "../../../types.js";
import { type ListWindowOption } from "../list-window.js";
import { deriveTaskBoardState, type TaskBoardState } from "../task-board-state.js";
import { buildLiveTaskEnrichmentMap, type LiveTaskEnrichment } from "./live-task-enrichment.js";
import { buildTaskCardViewModel, type TaskCardViewModel } from "./task-card-view-model.js";
import { STATUS_CFG } from "../tasks-constants.js";
import { formatDuration } from "../format-duration.js";

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
  taskPullRequestsEnabled?: boolean;
  previousTaskViewModels?: ReadonlyMap<string, TaskCardViewModel>;
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

function appendField(parts: string[], value: unknown): void {
  const text = value == null ? "" : String(value);
  parts.push(`${text.length}:${text}`);
}

function buildTaskSignature(task: Task): string {
  const parts: string[] = [];
  appendField(parts, task.recordId);
  appendField(parts, task.id);
  appendField(parts, task.sprint);
  appendField(parts, task.sprintId);
  appendField(parts, task.title);
  appendField(parts, task.description);
  appendField(parts, task.promptMarkdown);
  appendField(parts, task.status);
  appendField(parts, task.priority);
  appendField(parts, task.assignee);
  appendField(parts, task.source);
  appendField(parts, task.executorType);
  appendField(parts, task.agentPresetId);
  appendField(parts, task.createdAt);
  appendField(parts, task.updatedAt);
  appendField(parts, task.time);
  appendField(parts, task.isIndependent === true ? "1" : "0");
  appendField(parts, task.isMerged === true ? "1" : "0");
  appendField(parts, task.mergeIndicator);
  appendField(parts, task.isOptimistic === true ? "1" : "0");
  appendField(parts, task.latestReview?.status);
  appendField(parts, task.latestReview?.outcome);
  appendField(parts, task.latestReview?.summary);
  appendField(parts, task.latestReview?.reviewer);
  appendField(parts, task.latestReview?.finishedAt);
  appendField(parts, task.latestReview?.findings?.length ?? 0);
  for (const finding of task.latestReview?.findings ?? []) {
    appendField(parts, finding);
  }
  appendField(parts, task.dependsOnTaskIds?.length ?? 0);
  for (const depId of task.dependsOnTaskIds ?? []) {
    appendField(parts, depId);
  }
  return parts.join("|");
}

function buildDependencySignature(task: Task, taskLookup: ReadonlyMap<string, Task>): string {
  const parts: string[] = [];
  for (const depId of task.dependsOnTaskIds ?? []) {
    const depTask = taskLookup.get(depId);
    appendField(parts, depId);
    appendField(parts, depTask?.recordId);
    appendField(parts, depTask?.id);
    appendField(parts, depTask?.title);
    appendField(parts, depTask?.status);
  }
  return parts.join("|");
}

function buildDependencyIndicatorSignature(task: Task, indicators: ReadonlyArray<TaskCardViewModel["dependencyIndicators"][number]>): string {
  const parts: string[] = [];
  const indicatorsByRecordId = new Map(indicators.map((indicator) => [indicator.recordId, indicator]));
  for (const depId of task.dependsOnTaskIds ?? []) {
    const indicator = indicatorsByRecordId.get(depId);
    appendField(parts, depId);
    if (!indicator || indicator.isKnown === false) {
      appendField(parts, undefined);
      appendField(parts, undefined);
      appendField(parts, undefined);
      appendField(parts, undefined);
      continue;
    }
    appendField(parts, indicator.recordId);
    appendField(parts, indicator.id);
    appendField(parts, indicator.title);
    appendField(parts, indicator.status);
  }
  return parts.join("|");
}

function buildLiveEnrichmentSignature(liveEnrichment?: LiveTaskEnrichment): string {
  const parts: string[] = [];
  appendField(parts, liveEnrichment?.sessionId);
  appendField(parts, liveEnrichment?.sessionState);
  appendField(parts, liveEnrichment?.prUrl);
  appendField(parts, liveEnrichment?.liveStartedAt);
  appendField(parts, liveEnrichment?.liveTotalSeconds && liveEnrichment.liveTotalSeconds > 0
    ? formatDuration(liveEnrichment.liveTotalSeconds)
    : undefined);
  return parts.join("|");
}

function buildTaskCardLiveSignature(viewModel: TaskCardViewModel): string {
  const parts: string[] = [];
  appendField(parts, viewModel.sessionId);
  appendField(parts, viewModel.sessionState);
  appendField(parts, viewModel.prUrl);
  appendField(parts, viewModel.liveStartedAt);
  appendField(parts, viewModel.liveRunningTime);
  return parts.join("|");
}

function buildTaskCardReuseSignature(args: {
  task: Task;
  taskLookup: ReadonlyMap<string, Task>;
  liveEnrichment?: LiveTaskEnrichment;
  taskPullRequestsEnabled: boolean;
}): string {
  return [
    buildTaskSignature(args.task),
    buildDependencySignature(args.task, args.taskLookup),
    buildLiveEnrichmentSignature(args.liveEnrichment),
    args.liveEnrichment?.prUrl || args.taskPullRequestsEnabled ? "pr:1" : "pr:0",
  ].join("||");
}

function findReusableTaskCardViewModel(args: {
  task: Task;
  taskLookup: ReadonlyMap<string, Task>;
  liveEnrichment?: LiveTaskEnrichment;
  previousTaskViewModels?: ReadonlyMap<string, TaskCardViewModel>;
  taskPullRequestsEnabled: boolean;
}): TaskCardViewModel | null {
  const previous = args.previousTaskViewModels?.get(args.task.recordId);
  if (!previous) {
    return null;
  }
  const nextHasPullRequestMetadata = Boolean(args.liveEnrichment?.prUrl || args.taskPullRequestsEnabled);
  if ((previous.hasPullRequestMetadata ?? true) !== nextHasPullRequestMetadata) {
    return null;
  }

  const nextSignature = buildTaskCardReuseSignature(args);
  const previousSignature = [
    buildTaskSignature(previous.task),
    buildDependencyIndicatorSignature(previous.task, previous.dependencyIndicators),
    buildTaskCardLiveSignature(previous),
    previous.hasPullRequestMetadata ?? true ? "pr:1" : "pr:0",
  ].join("||");

  return previousSignature === nextSignature ? previous : null;
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
    taskPullRequestsEnabled = true,
    previousTaskViewModels,
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
    const liveEnrichment = liveEnrichmentMap.get(task.recordId);
    const reusableViewModel = findReusableTaskCardViewModel({
      task,
      taskLookup,
      liveEnrichment,
      previousTaskViewModels,
      taskPullRequestsEnabled,
    });
    taskViewModels.set(
      task.recordId,
      reusableViewModel ?? buildTaskCardViewModel(task, taskLookup, liveEnrichment, {
        taskPullRequestsEnabled,
      })
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
