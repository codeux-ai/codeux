import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import type { RefObject } from "preact";
import type { AgentAvatarConfig, AgentPreset, Task, TaskStatus } from "../../types.js";
import type { TaskBoardState } from "../../lib/task-board-state.js";
import type { TaskCardViewModel } from "../../lib/tasks/task-card-view-model.js";
import { STATUS_CFG, getTaskStatusLabel } from "../../lib/tasks-constants.js";
import { getTaskDropFeedback } from "../../lib/tasks/task-board-actions.js";
import { SkeletonCard, SkeletonLoader } from "../layout/SkeletonLoader.js";
import { KanbanTaskCard } from "./KanbanTaskCard.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { taskMessages } from "../../i18n/messages/tasks.js";

const ColumnHeader: FunctionComponent<{ status: TaskStatus; count: number }> = memo(({ status, count }) => {
  const { locale, translatePlural, formatNumber } = useOptionalDashboardI18n();
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;
  const headingId = `task-lane-heading-${status}`;

  return (
    <div className="flex items-center justify-between mb-6" id={headingId}>
      <div className="flex items-center gap-2.5">
        <Icon className={`w-5 h-5 ${cfg.color}`} strokeWidth={2} />
        <h2 className={`font-display text-lg font-bold tracking-tight ${cfg.color}`}>{getTaskStatusLabel(status, locale)}</h2>
      </div>
      <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] ${cfg.color}`}>
        <span aria-hidden="true">{formatNumber(count)}</span>
        <span className="sr-only">{translatePlural(taskMessages, "taskCount", count, { count: formatNumber(count) })}</span>
      </span>
    </div>
  );
});

export interface TaskBoardDropTargetContext {
  status: TaskStatus;
  index: number;
}

export interface TaskBoardColumnsProps {
  boardRef: RefObject<HTMLDivElement>;
  columns: TaskBoardState["columns"];
  taskViewModels: Map<string, TaskCardViewModel>;
  allTasks: Task[];
  agentPresetsMap: Map<string, AgentPreset>;
  loading: boolean;
  showSkeletons: boolean;
  filterTransitionPending: boolean;
  statusFilter: "all" | TaskStatus;
  priorityFilter: "all" | Task["priority"];
  taskScopeSprintId: string | null;
  reducedMotion: boolean;
  draggedTaskId: string | null;
  dropTargetContext: TaskBoardDropTargetContext | null;
  listTransitionStyle: {
    transitionDuration: string;
    transitionTimingFunction: string;
  };
  onDragOver: (status: TaskStatus, index: number, event: DragEvent) => void;
  onDrop: (status: TaskStatus, event: DragEvent) => void;
  onDragStart: (taskId: string, event: DragEvent) => void;
  onDragEnd: () => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
}

function getAgentPresetName(task: Task, agentPresetsMap: Map<string, AgentPreset>): string | null {
  return task.agentPresetId ? agentPresetsMap.get(task.agentPresetId)?.name ?? null : null;
}

function getAgentPresetAvatarConfig(task: Task, agentPresetsMap: Map<string, AgentPreset>): AgentAvatarConfig | undefined {
  return task.agentPresetId ? agentPresetsMap.get(task.agentPresetId)?.avatarConfig : undefined;
}

function areTaskListsEquivalent(previous: Task[], next: Task[]): boolean {
  return previous.length === next.length && previous.every((task, index) => (
    task.recordId === next[index].recordId &&
    task.status === next[index].status
  ));
}

function areDropTargetsEqual(
  previous: TaskBoardDropTargetContext | null,
  next: TaskBoardDropTargetContext | null,
): boolean {
  return previous?.status === next?.status && previous?.index === next?.index;
}

function areColumnsEquivalent(
  previous: TaskBoardState["columns"],
  next: TaskBoardState["columns"],
  previousViewModels: Map<string, TaskCardViewModel>,
  nextViewModels: Map<string, TaskCardViewModel>,
): boolean {
  if (previous.length !== next.length) {
    return false;
  }

  return previous.every((column, columnIndex) => {
    const nextColumn = next[columnIndex];
    if (column.status !== nextColumn.status || column.count !== nextColumn.count || column.tasks.length !== nextColumn.tasks.length) {
      return false;
    }

    return column.tasks.every((task, taskIndex) => {
      const nextTask = nextColumn.tasks[taskIndex];
      return task.recordId === nextTask.recordId &&
        previousViewModels.get(task.recordId) === nextViewModels.get(nextTask.recordId);
    });
  });
}

function areTaskBoardColumnsPropsEqual(previous: TaskBoardColumnsProps, next: TaskBoardColumnsProps): boolean {
  return previous.boardRef === next.boardRef &&
    areColumnsEquivalent(previous.columns, next.columns, previous.taskViewModels, next.taskViewModels) &&
    areTaskListsEquivalent(previous.allTasks, next.allTasks) &&
    previous.agentPresetsMap === next.agentPresetsMap &&
    previous.loading === next.loading &&
    previous.showSkeletons === next.showSkeletons &&
    previous.filterTransitionPending === next.filterTransitionPending &&
    previous.statusFilter === next.statusFilter &&
    previous.priorityFilter === next.priorityFilter &&
    previous.taskScopeSprintId === next.taskScopeSprintId &&
    previous.reducedMotion === next.reducedMotion &&
    previous.draggedTaskId === next.draggedTaskId &&
    areDropTargetsEqual(previous.dropTargetContext, next.dropTargetContext) &&
    previous.listTransitionStyle.transitionDuration === next.listTransitionStyle.transitionDuration &&
    previous.listTransitionStyle.transitionTimingFunction === next.listTransitionStyle.transitionTimingFunction &&
    previous.onDragOver === next.onDragOver &&
    previous.onDrop === next.onDrop &&
    previous.onDragStart === next.onDragStart &&
    previous.onDragEnd === next.onDragEnd &&
    previous.onEditTask === next.onEditTask &&
    previous.onDeleteTask === next.onDeleteTask;
}

const TaskBoardColumnsComponent: FunctionComponent<TaskBoardColumnsProps> = ({
  boardRef,
  columns,
  taskViewModels,
  allTasks,
  agentPresetsMap,
  loading,
  showSkeletons,
  filterTransitionPending,
  statusFilter,
  priorityFilter,
  taskScopeSprintId,
  reducedMotion,
  draggedTaskId,
  dropTargetContext,
  listTransitionStyle,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  onEditTask,
  onDeleteTask,
}) => {
  const { locale, translate, translatePlural, formatNumber } = useOptionalDashboardI18n();
  return (
  <div
    ref={boardRef}
    aria-busy={filterTransitionPending}
    style={listTransitionStyle}
    data-motion-list-reorder="listReorder"
    data-motion-list-reveal="listReveal"
    className={`grid gap-6 transition-opacity ${filterTransitionPending ? "opacity-80" : "opacity-100"} ${
      columns.length === 1 ? "grid-cols-1" :
      columns.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
      "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"
    }`}
  >
    {columns.map(({ status, count, tasks: columnTasks }) => (
      <section
        key={status}
        className="flex flex-col"
        role="region"
        aria-labelledby={`task-lane-heading-${status}`}
        aria-describedby={`task-lane-summary-${status}`}
        aria-busy={loading || showSkeletons || filterTransitionPending}
      >
        <ColumnHeader status={status} count={count} />
        <p id={`task-lane-summary-${status}`} className="sr-only" aria-live="polite" aria-atomic="true">
          {translate(taskMessages, "laneSummary", {
            status: getTaskStatusLabel(status, locale),
            tasks: translatePlural(taskMessages, "taskCount", count, { count: formatNumber(count) }),
          })}
        </p>
        <div
          className={`flex-1 grid grid-cols-1 grid-rows-1 p-4 rounded-[1.5rem] min-h-[200px] bg-black/[0.015] dark:bg-white/[0.015] border relative transition-colors motion-reduce:transition-none ${dropTargetContext?.status === status ? "border-signal-500/50 bg-signal-500/5" : "border-black/[0.03] dark:border-white/[0.03]"} ${reducedMotion ? "border-dashed" : ""}`}
          onDragOver={(event) => onDragOver(status, columnTasks.length, event as DragEvent)}
          onDrop={(event) => onDrop(status, event as DragEvent)}
          aria-describedby={`task-lane-summary-${status} task-lane-drop-${status}`}
        >
          <p id={`task-lane-drop-${status}`} className="sr-only" aria-live="polite" aria-atomic="true">
            {getTaskDropFeedback({
              isReducedMotion: reducedMotion,
              isDragging: draggedTaskId !== null,
              targetLane: status,
              currentStatus: draggedTaskId ? allTasks.find((task) => task.recordId === draggedTaskId)?.status : undefined,
              locale,
            })}
          </p>
          {showSkeletons && (
            <div role="status" aria-live="polite" className="sr-only">
              {translate(taskMessages, "loadingLane", { status: getTaskStatusLabel(status, locale).toLocaleLowerCase(locale) })}
            </div>
          )}
          <SkeletonLoader
            show={showSkeletons}
            className="col-start-1 row-start-1"
            skeleton={(
              <div className="flex flex-col gap-4">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            )}
          >
            {!loading && columnTasks.length === 0 ? (
              <div role="status" aria-live="polite" aria-atomic="true" className={`col-start-1 row-start-1 flex min-h-36 items-center justify-center text-center p-6 text-xs font-medium text-slate-400 dark:text-slate-500 border-2 border-dashed rounded-[1.5rem] bg-black/[0.015] dark:bg-white/[0.015] transition-colors motion-reduce:transition-none ${dropTargetContext?.status === status ? "border-signal-500/30" : "border-black/[0.05] dark:border-white/[0.05]"}`}>
                {translate(taskMessages, "emptyLane", {
                  status: getTaskStatusLabel(status, locale).toLocaleLowerCase(locale),
                  scope: translate(taskMessages, statusFilter !== "all" || priorityFilter !== "all" ? "matchingFilters" : taskScopeSprintId ? "inThisSprint" : "inThisProject"),
                })}
              </div>
            ) : !loading ? (
              <div className="col-start-1 row-start-1 flex flex-col gap-4" data-motion-contract="listReorder">
                {columnTasks.map((task, index) => {
                  const isDraggedOver = dropTargetContext?.status === status && dropTargetContext?.index === index;
                  const viewModel = taskViewModels.get(task.recordId);
                  if (!viewModel) return null;

                  return (
                    <div key={task.recordId} className="contents">
                      {isDraggedOver && draggedTaskId !== task.recordId && (
                        <div className="h-24 mb-4 rounded-[1.5rem] border-2 border-dashed border-signal-500/50 bg-signal-500/10 transition-all motion-reduce:transition-none" />
                      )}
                      <div
                        className="task-card-entry"
                        data-task-id={task.recordId}
                        onDragOver={(event) => {
                          event.stopPropagation();
                          onDragOver(status, index, event as DragEvent);
                        }}
                        onDrop={(event) => {
                          event.stopPropagation();
                          onDrop(status, event as DragEvent);
                        }}
                      >
                        <KanbanTaskCard
                          viewModel={viewModel}
                          index={index}
                          onEdit={onEditTask}
                          onDelete={onDeleteTask}
                          agentPresetName={getAgentPresetName(task, agentPresetsMap)}
                          agentPresetAvatarConfig={getAgentPresetAvatarConfig(task, agentPresetsMap)}
                          isDragging={draggedTaskId === task.recordId}
                          onDragStart={(event) => onDragStart(task.recordId, event)}
                          onDragEnd={onDragEnd}
                        />
                      </div>
                    </div>
                  );
                })}
                {dropTargetContext?.status === status && dropTargetContext?.index === columnTasks.length && (
                  <div className="h-24 mt-4 rounded-[1.5rem] border-2 border-dashed border-signal-500/50 bg-signal-500/10 transition-all motion-reduce:transition-none" />
                )}
              </div>
            ) : null}
          </SkeletonLoader>
        </div>
      </section>
    ))}
  </div>
  );
};

export const TaskBoardColumns = memo(TaskBoardColumnsComponent, areTaskBoardColumnsPropsEqual);
