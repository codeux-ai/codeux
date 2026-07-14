import type { FunctionComponent } from "preact";
import type { Sprint, TaskPriority, TaskStatus } from "../../types.js";
import type { ListWindowOption } from "../../lib/list-window.js";
import { FilterStrip } from "../ui/FilterStrip.js";
import { ListWindowSelector } from "../ui/ListWindowSelector.js";
import { TaskBoardSprintSelector } from "./TaskBoardSprintSelector.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { taskMessages } from "../../i18n/messages/tasks.js";
import { getTaskPriorityLabel, getTaskStatusLabel } from "../../lib/tasks-constants.js";

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

function getStatusFilterLabel(filter: TaskBoardStatusFilter, locale: "en" | "de"): string {
  switch (filter) {
    case "in_progress": return getTaskStatusLabel(filter, locale);
    case "pending": return getTaskStatusLabel(filter, locale);
    case "completed": return getTaskStatusLabel(filter, locale);
    case "all":
    default: return "All";
  }
}

function getPriorityFilterLabel(filter: TaskBoardPriorityFilter, locale: "en" | "de"): string {
  switch (filter) {
    case "critical": return getTaskPriorityLabel(filter, locale);
    case "high": return getTaskPriorityLabel(filter, locale);
    case "medium": return getTaskPriorityLabel(filter, locale);
    case "low": return getTaskPriorityLabel(filter, locale);
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
  const { locale, translate, formatNumber } = useOptionalDashboardI18n();
  const statusLabel = statusFilter === "all" ? translate(taskMessages, "all") : getStatusFilterLabel(statusFilter, locale);
  const priorityLabel = priorityFilter === "all" ? translate(taskMessages, "anyPriority") : getPriorityFilterLabel(priorityFilter, locale);
  const windowLabel = typeof listWindow === "string"
    ? translate(taskMessages, "allTasksWindow")
    : translate(taskMessages, "tasksPerLaneWindow", { count: formatNumber(listWindow) });
  const filterAnnouncement = translate(taskMessages, "filterAnnouncement", { status: statusLabel, priority: priorityLabel, window: windowLabel });

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

      <div className="ml-auto w-full sm:w-auto transition-opacity duration-[var(--task-filter-list-reveal-duration)] ease-[var(--task-filter-list-reveal-ease)]">
        <ListWindowSelector
          value={listWindow}
          onChange={onListWindowChange}
          label={translate(taskMessages, "show")}
          ariaLabel={translate(taskMessages, "selectCardsPerLane")}
          itemLabel={translate(taskMessages, "taskCards")}
        />
      </div>
    </div>
  );
};
