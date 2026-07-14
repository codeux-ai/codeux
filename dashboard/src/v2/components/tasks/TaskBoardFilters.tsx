import type { FunctionComponent } from "preact";
import type { Sprint, TaskPriority, TaskStatus } from "../../types.js";
import type { ListWindowOption } from "../../lib/list-window.js";
import { FilterStrip } from "../ui/FilterStrip.js";
import { ListWindowSelector } from "../ui/ListWindowSelector.js";
import { TaskBoardSprintSelector } from "./TaskBoardSprintSelector.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { taskMessages } from "../../i18n/messages/tasks.js";

export type TaskBoardStatusFilter = "all" | TaskStatus;
export type TaskBoardPriorityFilter = "all" | TaskPriority;

export interface TaskBoardFiltersProps {
  sprints: Sprint[];
  selectedSprintId: string | null;
  onSelectSprint: (id: string | null) => void;
  sprintKeyPrefix: string;
  sprintsLoading: boolean;
  statusFilter: TaskBoardStatusFilter;
  onStatusFilterChange: (filter: TaskBoardStatusFilter) => void;
  priorityFilter: TaskBoardPriorityFilter;
  onPriorityFilterChange: (filter: TaskBoardPriorityFilter) => void;
  listWindow: ListWindowOption;
  onListWindowChange: (value: ListWindowOption) => void;
}

export const TaskBoardFilters: FunctionComponent<TaskBoardFiltersProps> = ({
  sprints,
  selectedSprintId,
  onSelectSprint,
  sprintKeyPrefix,
  sprintsLoading,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  listWindow,
  onListWindowChange,
}) => {
  const { translate } = useDashboardI18n();
  const interactionTokens = useInteractionTokens();
  const statusLabel = translate(taskMessages, statusFilter === "all" ? "all" : statusFilter === "pending" ? "queued" : statusFilter === "completed" ? "done" : "running");
  const priorityLabel = translate(taskMessages, priorityFilter === "all" ? "anyPriority" : priorityFilter);
  const filterAnnouncement = translate(taskMessages, "filterAnnouncement", {
    status: statusLabel,
    priority: priorityLabel,
    window: listWindow === "All" ? translate(taskMessages, "allTasksWindow") : translate(taskMessages, "tasksPerLaneWindow", { count: listWindow }),
  });

  return (
    <section
      aria-labelledby="task-board-controls-heading"
      className="min-w-0 max-w-full rounded-[1.5rem] border border-black/[0.06] bg-white/65 p-3 shadow-[0_2px_16px_rgba(0,0,0,0.03)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-800/55 sm:p-4"
      style={{
        "--task-filter-control-duration": interactionTokens.controlFeedback.duration,
        "--task-filter-control-ease": interactionTokens.controlFeedback.ease,
        "--task-filter-selection-duration": interactionTokens.selectionMovement.duration,
        "--task-filter-selection-ease": interactionTokens.selectionMovement.ease,
        "--task-filter-list-reveal-duration": interactionTokens.listReveal.duration,
        "--task-filter-list-reveal-ease": interactionTokens.listReveal.ease,
      }}
      data-motion-control="controlFeedback"
      data-motion-selection="selectionMovement"
      data-motion-list-reveal="listReveal"
      data-task-control-rail="responsive"
    >
      <h3 id="task-board-controls-heading" className="sr-only">{translate(taskMessages, "taskBoardControls")}</h3>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {filterAnnouncement}
      </span>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(14rem,1.35fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(9rem,auto)] xl:items-end">
        <div className="min-w-0 transition-colors duration-[var(--task-filter-control-duration)] ease-[var(--task-filter-control-ease)] motion-reduce:transition-none md:col-span-2 xl:col-span-1">
          <span className="mb-1.5 block px-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{translate(taskMessages, "sprintScope")}</span>
          <TaskBoardSprintSelector
            sprints={sprints}
            selectedId={selectedSprintId}
            onSelect={onSelectSprint}
            sprintKeyPrefix={sprintKeyPrefix}
            loading={sprintsLoading}
          />
        </div>

        <div className="min-w-0">
          <span className="mb-1.5 block px-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{translate(taskMessages, "status")}</span>
          <FilterStrip
            ariaLabel={translate(taskMessages, "taskStatusFilter")}
            options={[
              { value: "all", label: translate(taskMessages, "all"), ariaLabel: translate(taskMessages, "showAllStatuses") },
              { value: "in_progress", label: translate(taskMessages, "running"), ariaLabel: translate(taskMessages, "showRunningTasks") },
              { value: "pending", label: translate(taskMessages, "queued"), ariaLabel: translate(taskMessages, "showQueuedTasks") },
              { value: "completed", label: translate(taskMessages, "done"), ariaLabel: translate(taskMessages, "showCompletedTasks") },
            ]}
            active={statusFilter}
            onChange={onStatusFilterChange}
          />
        </div>

        <div className="min-w-0">
          <span className="mb-1.5 block px-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{translate(taskMessages, "priority")}</span>
          <FilterStrip
            ariaLabel={translate(taskMessages, "taskPriorityFilter")}
            options={[
              { value: "all", label: translate(taskMessages, "anyPriority"), ariaLabel: translate(taskMessages, "showAnyPriority") },
              { value: "critical", label: translate(taskMessages, "critical"), ariaLabel: translate(taskMessages, "showCriticalTasks") },
              { value: "high", label: translate(taskMessages, "high"), ariaLabel: translate(taskMessages, "showHighTasks") },
              { value: "medium", label: translate(taskMessages, "medium"), ariaLabel: translate(taskMessages, "showMediumTasks") },
              { value: "low", label: translate(taskMessages, "low"), ariaLabel: translate(taskMessages, "showLowTasks") },
            ]}
            active={priorityFilter}
            onChange={onPriorityFilterChange}
          />
        </div>

        <div className="min-w-0 transition-opacity duration-[var(--task-filter-list-reveal-duration)] ease-[var(--task-filter-list-reveal-ease)] motion-reduce:transition-none">
          <span className="mb-1.5 block px-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{translate(taskMessages, "visibleCards")}</span>
          <ListWindowSelector
            value={listWindow}
            onChange={onListWindowChange}
            label={translate(taskMessages, "show")}
            ariaLabel={translate(taskMessages, "selectCardsPerLane")}
            itemLabel={translate(taskMessages, "taskCards")}
          />
        </div>
      </div>
    </section>
  );
};
