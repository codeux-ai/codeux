import type { Task, TaskPriority, TaskStatus } from "../../types.js";
import type { Sprint } from "../../types.js";
import type {
  ExecutionAttentionItemSummary,
  ExecutionTaskDispatchSummary,
  ExecutionRuntimeEventSummary,
  Subtask,
  SubtaskMergeIndicator,
} from "../../../types.js";
import { type ListWindowOption } from "../list-window.js";
import {
  deriveTaskCiStatusPresentation,
  type CiTaskMergeEvidence,
  type CiStatusPresentation,
} from "../ci-status-presentation.js";
import { deriveTaskBoardState, type TaskBoardState } from "../task-board-state.js";
import { buildLiveTaskEnrichmentMap, type LiveTaskEnrichment } from "./live-task-enrichment.js";
import { buildTaskCardViewModel, formatTaskDuration, type TaskCardViewModel } from "./task-card-view-model.js";
import { getTaskPriorityLabel, getTaskStatusLabel } from "../tasks-constants.js";
import type { DashboardLocale } from "../../i18n/locales.js";
import { translateTask, translateTaskPlural } from "../../i18n/messages/tasks.js";

export interface TaskBoardViewModelOptions {
  tasks: Task[];
  optimisticTasks: Task[];
  statusFilter: "all" | TaskStatus;
  priorityFilter: "all" | TaskPriority;
  listWindow: ListWindowOption;
  taskScopeSprintId: string | null;
  projectId?: string | null;
  taskDispatches: ExecutionTaskDispatchSummary[];
  attentionItems?: ExecutionAttentionItemSummary[];
  recentEvents: ExecutionRuntimeEventSummary[];
  subtasks: Subtask[];
  taskPullRequestsEnabled?: boolean;
  previousTaskViewModels?: ReadonlyMap<string, TaskCardViewModel>;
  locale?: DashboardLocale;
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

function formatStatusFilter(statusFilter: "all" | TaskStatus, locale: DashboardLocale): string {
  return statusFilter === "all"
    ? translateTask(locale, "allStatuses")
    : translateTask(locale, "statusFilterValue", { status: getTaskStatusLabel(statusFilter, locale) });
}

function formatPriorityFilter(priorityFilter: "all" | TaskPriority, locale: DashboardLocale): string {
  return priorityFilter === "all"
    ? translateTask(locale, "anyPriorityLower")
    : translateTask(locale, "priorityFilterValue", { priority: getTaskPriorityLabel(priorityFilter, locale).toLocaleLowerCase(locale) });
}

function appendField(parts: string[], value: unknown): void {
  const text = value == null ? "" : String(value);
  parts.push(`${text.length}:${text}`);
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, stableJsonValue(record[key])]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value)) ?? "";
}

const ACTIVE_ATTENTION_STATUSES = new Set(["open", "claimed"]);
const SUBTASK_MERGE_INDICATORS = new Set<SubtaskMergeIndicator>([
  "CI",
  "AUTOMERGE",
  "MERGED",
  "MERGE_BLOCKED",
  "MERGE_CONFLICT",
  "PR_ONLY",
  "QA_PENDING",
]);

function normalizeMergeIndicator(value: string | null): SubtaskMergeIndicator | undefined {
  return value && SUBTASK_MERGE_INDICATORS.has(value as SubtaskMergeIndicator)
    ? value as SubtaskMergeIndicator
    : undefined;
}

function payloadTaskRecordId(payload: Record<string, unknown> | null): string | null {
  const taskId = payload?.taskId;
  return typeof taskId === "string" && taskId.trim() ? taskId.trim() : null;
}

function eventMatchesTaskRecord(event: ExecutionRuntimeEventSummary, task: Task): boolean {
  return event.eventType === "ci_gate_status"
    && event.sprintId === task.sprintId
    && (event.taskId === task.recordId || payloadTaskRecordId(event.payload) === task.recordId);
}

function attentionMatchesTaskRecord(item: ExecutionAttentionItemSummary, task: Task): boolean {
  return item.attentionType.toLowerCase() === "ci_fix_required"
    && ACTIVE_ATTENTION_STATUSES.has(item.status.toLowerCase())
    && item.sprintId === task.sprintId
    && (item.taskId === task.recordId || payloadTaskRecordId(item.payload) === task.recordId);
}

interface TaskCiSource {
  presentation: CiStatusPresentation | null;
  signature: string;
}

function buildTaskCiSource(args: {
  task: Task;
  subtask?: Subtask;
  liveEnrichment?: LiveTaskEnrichment;
  events: ExecutionRuntimeEventSummary[];
  attentionItems: ExecutionAttentionItemSummary[];
}): TaskCiSource {
  const evidence: CiTaskMergeEvidence = {
    record_id: args.task.recordId,
    id: args.task.id,
    sprint_id: args.task.sprintId,
    merge_indicator: args.subtask?.merge_indicator ?? normalizeMergeIndicator(args.task.mergeIndicator),
    is_merged: args.subtask?.is_merged ?? args.task.isMerged,
    pr_url: args.subtask?.pr_url ?? args.liveEnrichment?.prUrl,
  };
  const events = args.events.filter((event) => eventMatchesTaskRecord(event, args.task));
  const attentionItems = args.attentionItems.filter((item) => attentionMatchesTaskRecord(item, args.task));
  const presentation = deriveTaskCiStatusPresentation({
    task: evidence,
    events,
    attentionItems,
  });
  const signature = stableStringify({
    evidence,
    events: events.map((event) => ({
      id: event.id,
      projectId: event.projectId,
      sprintId: event.sprintId,
      sprintRunId: event.sprintRunId,
      taskId: event.taskId,
      taskKey: event.taskKey,
      createdAt: event.createdAt,
      payload: event.payload,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    attentionItems: attentionItems.map((item) => ({
      id: item.id,
      sprintId: item.sprintId,
      sprintRunId: item.sprintRunId,
      taskId: item.taskId,
      status: item.status,
      openedAt: item.openedAt,
      updatedAt: item.updatedAt,
      resolvedAt: item.resolvedAt,
      payload: item.payload,
    })).sort((left, right) => left.id.localeCompare(right.id)),
  });
  return { presentation, signature };
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
  appendField(parts, stableStringify(task.latestReview));
  appendField(parts, task.selfReflectionRating?.id);
  appendField(parts, task.selfReflectionRating?.projectId);
  appendField(parts, task.selfReflectionRating?.sprintId);
  appendField(parts, task.selfReflectionRating?.taskId);
  appendField(parts, task.selfReflectionRating?.sourceTaskRunId);
  appendField(parts, task.selfReflectionRating?.overallRating);
  appendField(parts, task.selfReflectionRating?.capturedAt);
  appendField(parts, task.selfReflectionRating?.createdAt);
  appendField(parts, task.selfReflectionRating?.updatedAt);
  appendField(parts, task.selfReflectionRating?.sections.length ?? 0);
  for (const section of task.selfReflectionRating?.sections ?? []) {
    appendField(parts, section.label);
    appendField(parts, section.normalizedLabel);
    appendField(parts, section.rating);
    appendField(parts, section.note);
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

function buildLiveEnrichmentSignature(liveEnrichment: LiveTaskEnrichment | undefined, locale: DashboardLocale): string {
  const parts: string[] = [];
  appendField(parts, liveEnrichment?.sessionId);
  appendField(parts, liveEnrichment?.sessionState);
  appendField(parts, liveEnrichment?.prUrl);
  appendField(parts, liveEnrichment?.liveStartedAt);
  appendField(parts, liveEnrichment?.liveTotalSeconds && liveEnrichment.liveTotalSeconds > 0
    ? formatTaskDuration(liveEnrichment.liveTotalSeconds, locale)
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
  ciStatusSourceSignature: string;
  locale: DashboardLocale;
}): string {
  return [
    buildTaskSignature(args.task),
    buildDependencySignature(args.task, args.taskLookup),
    buildLiveEnrichmentSignature(args.liveEnrichment, args.locale),
    args.ciStatusSourceSignature,
    args.locale,
    args.liveEnrichment?.prUrl || args.taskPullRequestsEnabled ? "pr:1" : "pr:0",
  ].join("||");
}

function findReusableTaskCardViewModel(args: {
  task: Task;
  taskLookup: ReadonlyMap<string, Task>;
  liveEnrichment?: LiveTaskEnrichment;
  previousTaskViewModels?: ReadonlyMap<string, TaskCardViewModel>;
  taskPullRequestsEnabled: boolean;
  ciStatusSourceSignature: string;
  locale: DashboardLocale;
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
    previous.ciStatusSourceSignature ?? "",
    previous.presentationLocale ?? "en",
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
  locale?: DashboardLocale;
}): string {
  const locale = args.locale ?? "en";
  const number = new Intl.NumberFormat(locale);
  const tasks = translateTaskPlural(locale, "taskCount", args.totalCount, {
    count: number.format(args.totalCount),
  });
  const visibleSuffix = args.visibleCount < args.totalCount
    ? translateTask(locale, "visibleCount", { count: number.format(args.visibleCount) })
    : "";
  return translateTask(locale, "boardAnnouncement", {
    tasks,
    visible: visibleSuffix,
    scope: args.scopeLabel,
    status: formatStatusFilter(args.statusFilter, locale),
    priority: formatPriorityFilter(args.priorityFilter, locale),
  });
}

export function buildTaskBoardSprintScopeState(args: {
  sprints: Sprint[];
  selectedSprintId: string | null;
  selectedSprintLabel: string | null;
  loading: boolean;
  locale?: DashboardLocale;
}): TaskBoardSprintScopeState {
  const locale = args.locale ?? "en";
  if (args.loading) {
    return {
      label: translateTask(locale, "loadingSprints"),
      description: translateTask(locale, "loadingSprintsDescription"),
      isScoped: false,
      isLoading: true,
      isEmpty: false,
    };
  }

  if (args.sprints.length === 0) {
    return {
      label: translateTask(locale, "noSprints"),
      description: translateTask(locale, "noSprintsDescription"),
      isScoped: false,
      isLoading: false,
      isEmpty: true,
    };
  }

  if (args.selectedSprintId && args.selectedSprintLabel) {
    return {
      label: args.selectedSprintLabel,
      description: translateTask(locale, "scopedToSprint", { sprint: args.selectedSprintLabel }),
      isScoped: true,
      isLoading: false,
      isEmpty: false,
    };
  }

  return {
    label: translateTask(locale, "allSprints"),
    description: translateTask(locale, "scopedToAll"),
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
    projectId = null,
    taskDispatches,
    attentionItems = [],
    recentEvents,
    subtasks,
    taskPullRequestsEnabled = true,
    previousTaskViewModels,
    locale = "en",
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

  let scopedDispatches = projectId
    ? taskDispatches.filter((dispatch) => dispatch.projectId === projectId)
    : taskDispatches;
  let scopedEvents = projectId
    ? recentEvents.filter((event) => event.projectId === projectId)
    : recentEvents;
  let scopedAttentionItems = projectId
    ? attentionItems.filter((item) => {
      const payloadProjectId = item.payload?.projectId;
      return typeof payloadProjectId !== "string" || payloadProjectId === projectId;
    })
    : attentionItems;

  if (taskScopeSprintId) {
    scopedDispatches = scopedDispatches.filter((dispatch) => dispatch.sprintId === taskScopeSprintId);
    scopedEvents = scopedEvents.filter((event) => event.sprintId === taskScopeSprintId);
    scopedAttentionItems = scopedAttentionItems.filter((item) => item.sprintId === taskScopeSprintId);
  }

  const liveEnrichmentMap = buildLiveTaskEnrichmentMap(subtasks, scopedDispatches, scopedEvents);
  const subtasksByRecordId = new Map(
    subtasks.flatMap((subtask) => subtask.record_id ? [[subtask.record_id, subtask] as const] : []),
  );

  const taskViewModels = new Map<string, TaskCardViewModel>();
  for (const task of allTasks) {
    const liveEnrichment = liveEnrichmentMap.get(task.recordId);
    const ciSource = buildTaskCiSource({
      task,
      subtask: subtasksByRecordId.get(task.recordId),
      liveEnrichment,
      events: scopedEvents,
      attentionItems: scopedAttentionItems,
    });
    const reusableViewModel = findReusableTaskCardViewModel({
      task,
      taskLookup,
      liveEnrichment,
      previousTaskViewModels,
      taskPullRequestsEnabled,
      ciStatusSourceSignature: ciSource.signature,
      locale,
    });
    taskViewModels.set(
      task.recordId,
      reusableViewModel ?? buildTaskCardViewModel(task, taskLookup, liveEnrichment, {
        taskPullRequestsEnabled,
        ciStatusPresentation: ciSource.presentation,
        ciStatusSourceSignature: ciSource.signature,
        locale,
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
      scopeLabel: translateTask(locale, taskScopeSprintId ? "selectedSprint" : "allSprintsScope"),
      locale,
    }),
  };
}
