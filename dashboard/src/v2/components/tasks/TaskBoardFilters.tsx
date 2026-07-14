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
    <div
      className="flex flex-wrap items-center gap-4 mt-2 sm:-mt-4"
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
    >
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {filterAnnouncement}
      </span>
      <div className="min-w-0 flex-shrink transition-colors duration-[var(--task-filter-control-duration)] ease-[var(--task-filter-control-ease)]">
        <TaskBoardSprintSelector
          sprints={sprints}
          selectedId={selectedSprintId}
          onSelect={onSelectSprint}
          sprintKeyPrefix={sprintKeyPrefix}
          loading={sprintsLoading}
        />
      </div>

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

      <div className="ml-auto w-full sm:w-auto transition-opacity duration-[var(--task-filter-list-reveal-duration)] ease-[var(--task-filter-list-reveal-ease)]">
        <ListWindowSelector
          value={listWindow}
          onChange={onListWindowChange}
          label="Show"
          ariaLabel="Select number of task cards per lane"
          itemLabel="task cards"
        />
      </div>
    </div>
  );
};
