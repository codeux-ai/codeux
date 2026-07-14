import type { FunctionComponent } from "preact";
import type { Sprint, TaskPriority, TaskStatus } from "../../types.js";
import type { ListWindowOption } from "../../lib/list-window.js";
import { FilterStrip } from "../ui/FilterStrip.js";
import { ListWindowSelector } from "../ui/ListWindowSelector.js";
import { TaskBoardSprintSelector } from "./TaskBoardSprintSelector.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

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

function getStatusFilterLabel(filter: TaskBoardStatusFilter): string {
  switch (filter) {
    case "in_progress": return "Running";
    case "pending": return "Queued";
    case "completed": return "Done";
    case "all":
    default: return "All";
  }
}

function getPriorityFilterLabel(filter: TaskBoardPriorityFilter): string {
  switch (filter) {
    case "critical": return "Critical";
    case "high": return "High";
    case "medium": return "Medium";
    case "low": return "Low";
    case "all":
    default: return "Any Priority";
  }
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
  const interactionTokens = useInteractionTokens();
  const filterAnnouncement = `Task filters changed. Status ${getStatusFilterLabel(statusFilter)}. Priority ${getPriorityFilterLabel(priorityFilter)}. Showing ${listWindow === "All" ? "all tasks" : `${listWindow} tasks per lane`}.`;

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
      <h3 id="task-board-controls-heading" className="sr-only">Task board controls</h3>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {filterAnnouncement}
      </span>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(14rem,1.35fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(9rem,auto)] xl:items-end">
        <div className="min-w-0 transition-colors duration-[var(--task-filter-control-duration)] ease-[var(--task-filter-control-ease)] motion-reduce:transition-none md:col-span-2 xl:col-span-1">
          <span className="mb-1.5 block px-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Sprint scope</span>
          <TaskBoardSprintSelector
            sprints={sprints}
            selectedId={selectedSprintId}
            onSelect={onSelectSprint}
            sprintKeyPrefix={sprintKeyPrefix}
            loading={sprintsLoading}
          />
        </div>

        <div className="min-w-0">
          <span className="mb-1.5 block px-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Status</span>
          <FilterStrip
            ariaLabel="Task status filter"
            options={[
              { value: "all", label: "All", ariaLabel: "Show all task statuses" },
              { value: "in_progress", label: "Running", ariaLabel: "Show running tasks" },
              { value: "pending", label: "Queued", ariaLabel: "Show queued tasks" },
              { value: "completed", label: "Done", ariaLabel: "Show completed tasks" },
            ]}
            active={statusFilter}
            onChange={onStatusFilterChange}
          />
        </div>

        <div className="min-w-0">
          <span className="mb-1.5 block px-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Priority</span>
          <FilterStrip
            ariaLabel="Task priority filter"
            options={[
              { value: "all", label: "Any Priority", ariaLabel: "Show any task priority" },
              { value: "critical", label: "Critical", ariaLabel: "Show critical priority tasks" },
              { value: "high", label: "High", ariaLabel: "Show high priority tasks" },
              { value: "medium", label: "Medium", ariaLabel: "Show medium priority tasks" },
              { value: "low", label: "Low", ariaLabel: "Show low priority tasks" },
            ]}
            active={priorityFilter}
            onChange={onPriorityFilterChange}
          />
        </div>

        <div className="min-w-0 transition-opacity duration-[var(--task-filter-list-reveal-duration)] ease-[var(--task-filter-list-reveal-ease)] motion-reduce:transition-none">
          <span className="mb-1.5 block px-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Visible cards</span>
          <ListWindowSelector
            value={listWindow}
            onChange={onListWindowChange}
            label="Show"
            ariaLabel="Select number of task cards per lane"
            itemLabel="task cards"
          />
        </div>
      </div>
    </section>
  );
};
