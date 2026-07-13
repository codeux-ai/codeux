import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import type { RefObject } from "preact";
import type { AgentAvatarConfig, AgentPreset, Task, TaskStatus } from "../../types.js";
import type { TaskBoardState } from "../../lib/task-board-state.js";
import type { TaskCardViewModel } from "../../lib/tasks/task-card-view-model.js";
import { STATUS_CFG } from "../../lib/tasks-constants.js";
import { getTaskDropFeedback } from "../../lib/tasks/task-board-actions.js";
import { SkeletonCard, SkeletonLoader } from "../layout/SkeletonLoader.js";
import { KanbanTaskCard } from "./KanbanTaskCard.js";

const ColumnHeader: FunctionComponent<{ status: TaskStatus; count: number }> = memo(({ status, count }) => {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;
  const headingId = `task-lane-heading-${status}`;

  return (
    <header className="flex min-w-0 items-center justify-between gap-3 px-2 pb-3 pt-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-black/[0.05] bg-white/65 dark:border-white/[0.05] dark:bg-white/[0.035]">
          <Icon className={`h-4 w-4 ${cfg.color}`} strokeWidth={2} aria-hidden="true" />
        </div>
        <h2 id={headingId} className={`truncate font-display text-base font-bold tracking-tight ${cfg.color}`}>
          {cfg.label}
          <span className="sr-only"> lane, {count} {count === 1 ? "task" : "tasks"}</span>
        </h2>
      </div>
      <span aria-hidden="true" className={`min-w-8 rounded-lg border border-black/[0.05] bg-black/[0.025] px-2.5 py-1 text-center font-mono text-[10px] font-bold dark:border-white/[0.05] dark:bg-white/[0.03] ${cfg.color}`}>
        {count}
      </span>
    </header>
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
}) => (
  <div
    ref={boardRef}
    aria-busy={filterTransitionPending}
    style={listTransitionStyle}
    data-motion-list-reorder="listReorder"
    data-motion-list-reveal="listReveal"
    data-board-column-count={columns.length}
    className={`grid min-w-0 grid-cols-1 gap-4 transition-opacity motion-reduce:transition-none sm:gap-5 ${filterTransitionPending ? "opacity-80" : "opacity-100"} ${
      columns.length === 1 ? "grid-cols-1" :
      columns.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
      "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"
    }`}
  >
    {columns.map(({ status, count, tasks: columnTasks }) => (
      <section
        key={status}
        className="flex min-w-0 flex-col overflow-hidden rounded-[1.65rem] border border-black/[0.06] bg-white/45 p-3 shadow-[0_2px_16px_rgba(0,0,0,0.025)] dark:border-white/[0.06] dark:bg-void-800/38 sm:p-4"
        role="region"
        aria-labelledby={`task-lane-heading-${status}`}
        aria-describedby={`task-lane-summary-${status}`}
        aria-busy={loading || showSkeletons || filterTransitionPending}
        data-task-lane={status}
        data-reduced-motion={reducedMotion ? "true" : "false"}
      >
        <ColumnHeader status={status} count={count} />
        <p id={`task-lane-summary-${status}`} className="sr-only" aria-live="polite" aria-atomic="true">
          {STATUS_CFG[status].label} lane contains {count} {count === 1 ? "task" : "tasks"} after current filters.
        </p>
        <div
          className={`relative grid min-h-[22rem] flex-1 grid-cols-1 grid-rows-1 rounded-[1.3rem] border p-3 transition-colors motion-reduce:transition-none sm:p-4 ${dropTargetContext?.status === status ? "border-signal-500/50 bg-signal-500/[0.05]" : "border-black/[0.04] bg-black/[0.012] dark:border-white/[0.04] dark:bg-white/[0.012]"} ${reducedMotion ? "border-dashed" : ""}`}
          onDragOver={(event) => onDragOver(status, columnTasks.length, event as DragEvent)}
          onDrop={(event) => onDrop(status, event as DragEvent)}
          aria-describedby={`task-lane-summary-${status} task-lane-drop-${status}`}
          data-drop-active={dropTargetContext?.status === status ? "true" : "false"}
        >
          <p id={`task-lane-drop-${status}`} className="sr-only" aria-live="polite" aria-atomic="true">
            {getTaskDropFeedback({
              isReducedMotion: reducedMotion,
              isDragging: draggedTaskId !== null,
              targetLane: status,
              currentStatus: draggedTaskId ? allTasks.find((task) => task.recordId === draggedTaskId)?.status : undefined,
            })}
          </p>
          {showSkeletons && (
            <div role="status" aria-live="polite" className="sr-only">
              Loading {STATUS_CFG[status].label.toLowerCase()} tasks.
            </div>
          )}
          <SkeletonLoader
            show={showSkeletons}
            className="col-start-1 row-start-1"
            skeleton={(
              <div className="flex flex-col gap-3" aria-hidden="true">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            )}
          >
            {!loading && columnTasks.length === 0 ? (
              <div role="status" aria-live="polite" aria-atomic="true" className={`col-start-1 row-start-1 flex min-h-[18rem] flex-col items-center justify-center rounded-[1.1rem] border border-dashed p-6 text-center transition-colors motion-reduce:transition-none ${dropTargetContext?.status === status ? "border-signal-500/30 bg-signal-500/[0.035]" : "border-black/[0.06] bg-black/[0.012] dark:border-white/[0.06] dark:bg-white/[0.012]"}`}>
                <span className="font-display text-sm font-semibold text-slate-500 dark:text-slate-400">No {STATUS_CFG[status].label.toLowerCase()} tasks</span>
                <span className="mt-1 max-w-52 text-xs font-medium leading-relaxed text-slate-400 dark:text-slate-500">
                  {statusFilter !== "all" || priorityFilter !== "all" ? "Nothing matches the current filters." : taskScopeSprintId ? "This sprint has no work in this lane." : "This project has no work in this lane."}
                </span>
              </div>
            ) : !loading ? (
              <div className="col-start-1 row-start-1 flex min-w-0 flex-col gap-3" data-motion-contract="listReorder">
                {columnTasks.map((task, index) => {
                  const isDraggedOver = dropTargetContext?.status === status && dropTargetContext?.index === index;
                  const viewModel = taskViewModels.get(task.recordId);
                  if (!viewModel) return null;

                  return (
                    <div key={task.recordId} className="contents">
                      {isDraggedOver && draggedTaskId !== task.recordId && (
                        <div aria-hidden="true" className="mb-3 h-24 rounded-[1.2rem] border-2 border-dashed border-signal-500/50 bg-signal-500/[0.08] transition-colors motion-reduce:transition-none" />
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
                  <div aria-hidden="true" className="mt-3 h-24 rounded-[1.2rem] border-2 border-dashed border-signal-500/50 bg-signal-500/[0.08] transition-colors motion-reduce:transition-none" />
                )}
              </div>
            ) : null}
          </SkeletonLoader>
        </div>
      </section>
    ))}
  </div>
);

export const TaskBoardColumns = memo(TaskBoardColumnsComponent, areTaskBoardColumnsPropsEqual);
