import type { FunctionComponent } from "preact";
import type { Sprint, TaskPriority, TaskStatus } from "../../types.js";
import type { ListWindowOption } from "../../lib/list-window.js";
import { FilterStrip } from "../ui/FilterStrip.js";
import { ListWindowSelector } from "../ui/ListWindowSelector.js";
import { TaskBoardSprintSelector } from "./TaskBoardSprintSelector.js";

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
}) => (
  <div className="flex flex-wrap items-center gap-4 mt-2 sm:-mt-4">
    <div className="min-w-0 flex-shrink">
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
        { value: "all", label: "All" },
        { value: "in_progress", label: "Running" },
        { value: "pending", label: "Queued" },
        { value: "completed", label: "Done" },
      ]}
      active={statusFilter}
      onChange={onStatusFilterChange}
    />

    <FilterStrip
      ariaLabel="Task priority filter"
      options={[
        { value: "all", label: "Any Priority" },
        { value: "critical", label: "Critical" },
        { value: "high", label: "High" },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ]}
      active={priorityFilter}
      onChange={onPriorityFilterChange}
    />

    <div className="ml-auto w-full sm:w-auto">
      <ListWindowSelector value={listWindow} onChange={onListWindowChange} label="Show" />
    </div>
  </div>
);
