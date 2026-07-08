import type { Sprint, SprintStatus } from "../types.js";

export type SprintTableSortKey = "showcasePinned" | "sprintKey" | "name" | "status" | "tasksCount" | "completion" | "createdAt";
export type SprintTableSortDirection = "asc" | "desc";

export interface LedgerSort {
  key: SprintTableSortKey;
  direction: SprintTableSortDirection;
}

export const SPRINT_TABLE_SORT_LABELS: Record<SprintTableSortKey, string> = {
  showcasePinned: "Showcase",
  sprintKey: "Sprint ID",
  name: "Sprint",
  status: "Status",
  tasksCount: "Tasks",
  completion: "Completion",
  createdAt: "Created",
};

export type SprintShowcaseFilter = "all" | "pinned" | "unpinned";
export type SprintQaFilter = "all" | "missing" | "running" | "reviewed";

export interface LedgerFilters {
  query: string;
  status: Set<SprintStatus> | "all";
  showcase: SprintShowcaseFilter;
  qa: SprintQaFilter;
}

export const DEFAULT_LEDGER_FILTERS: LedgerFilters = {
  query: "",
  status: "all",
  showcase: "all",
  qa: "all",
};

const STATUS_LABELS: Record<SprintStatus, string> = {
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  idle: "Draft",
};

const STATUS_ORDER: Record<SprintStatus, number> = {
  running: 0,
  paused: 1,
  idle: 2,
  completed: 3,
  failed: 4,
  cancelled: 5,
};

export { STATUS_LABELS, STATUS_ORDER };

export const formatSprintKey = (sprint: Sprint, prefix: string = "SPR"): string => (
  sprint.number ? `${prefix}-${sprint.number}` : sprint.slug.toUpperCase()
);

const compareString = (left: string, right: string): number => (
  left.localeCompare(right, undefined, { sensitivity: "base" })
);

/**
 * Filter sprints by a search query. Matches against sprint key,
 * name, status label, and goal text (case-insensitive).
 */
export function filterSprints(sprints: Sprint[], filters: LedgerFilters, sprintKeyPrefix: string = "SPR"): Sprint[] {
  let filtered = sprints;

  if (filters.status !== "all" && filters.status.size > 0) {
    filtered = filtered.filter((s) => (filters.status as Set<SprintStatus>).has(s.status));
  }

  if (filters.showcase === "pinned") {
    filtered = filtered.filter((s) => s.showcasePinned);
  } else if (filters.showcase === "unpinned") {
    filtered = filtered.filter((s) => !s.showcasePinned);
  }

  if (filters.qa === "missing") {
    filtered = filtered.filter((s) => !s.latestReview);
  } else if (filters.qa === "running") {
    filtered = filtered.filter((s) => s.latestReview?.status === "running");
  } else if (filters.qa === "reviewed") {
    filtered = filtered.filter((s) => s.latestReview && s.latestReview.status !== "running");
  }

  const trimmed = filters.query.trim();
  if (!trimmed) {
    return filtered;
  }
  const lower = trimmed.toLowerCase();
  return filtered.filter((sprint) => {
    const key = formatSprintKey(sprint, sprintKeyPrefix).toLowerCase();
    const name = sprint.name.toLowerCase();
    const statusLabel = STATUS_LABELS[sprint.status].toLowerCase();
    const goal = (sprint.goal || "").toLowerCase();
    return (
      key.includes(lower)
      || name.includes(lower)
      || statusLabel.includes(lower)
      || goal.includes(lower)
    );
  });
}

/**
 * Sort sprints by a given column key and direction.
 * Uses the same sort logic as the original SprintsPage table.
 */
export function sortSprints(sprints: Sprint[], sort: LedgerSort, sprintKeyPrefix: string = "SPR"): Sprint[] {
  const ordered = [...sprints].sort((left, right) => {
    switch (sort.key) {
      case "showcasePinned":
        return Number(right.showcasePinned) - Number(left.showcasePinned);
      case "sprintKey":
        if (left.number !== null && right.number !== null && left.number !== right.number) {
          return left.number - right.number;
        }
        return compareString(formatSprintKey(left, sprintKeyPrefix), formatSprintKey(right, sprintKeyPrefix));
      case "name":
        return compareString(left.name, right.name);
      case "status":
        return STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
      case "tasksCount":
        return left.tasksCount - right.tasksCount;
      case "completion":
        return left.completion - right.completion;
      case "createdAt":
      default:
        return left.createdAt.localeCompare(right.createdAt);
    }
  });

  if (sort.direction === "desc") {
    ordered.reverse();
  }
  return ordered;
}

/**
 * Filter then sort sprints for ledger display.
 */
export function getLedgerSprints(sprints: Sprint[], filters: LedgerFilters, sort: LedgerSort, sprintKeyPrefix: string = "SPR"): Sprint[] {
  return sortSprints(filterSprints(sprints, filters, sprintKeyPrefix), sort, sprintKeyPrefix);
}

/**
 * Slice the sorted/filtered sprints to the active view window limit.
 */
export function sliceLedgerSprints(sprints: Sprint[], limit: number): Sprint[] {
  return sprints.slice(0, limit);
}

/**
 * Toggle a sprint ID in the selection set.
 */
export function toggleSelection(selectedIds: Set<string>, id: string): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/**
 * Select all sprint IDs from the filtered set.
 */
export function selectAllFiltered(filteredSprints: Sprint[]): Set<string> {
  return new Set(filteredSprints.map((s) => s.id));
}

/**
 * Deselect all.
 */
export function deselectAll(): Set<string> {
  return new Set();
}

/**
 * Prune selectedIds to only include IDs present in the filtered set.
 * Keeps selection coherent when filters change.
 */
export function pruneSelection(selectedIds: Set<string>, filteredSprints: Sprint[]): Set<string> {
  const filteredIds = new Set(filteredSprints.map((s) => s.id));
  const pruned = new Set<string>();
  for (const id of selectedIds) {
    if (filteredIds.has(id)) {
      pruned.add(id);
    }
  }
  return pruned;
}

/**
 * Get selected sprints that are in the current filtered result set.
 */
export function getSelectedFilteredSprints(selectedIds: Set<string>, filteredSprints: Sprint[]): Sprint[] {
  return filteredSprints.filter((s) => selectedIds.has(s.id));
}

export interface LedgerSelectionSummary {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  noneSelected: boolean;
}

export function getLedgerSelectionSummary(selectedIds: Set<string>, filteredSprints: Sprint[]): LedgerSelectionSummary {
  const selectedCount = filteredSprints.reduce((count, sprint) => count + (selectedIds.has(sprint.id) ? 1 : 0), 0);
  const totalCount = filteredSprints.length;
  return {
    selectedCount,
    totalCount,
    allSelected: totalCount > 0 && selectedCount === totalCount,
    noneSelected: selectedCount === 0,
  };
}

export function getLedgerViewStateKey(filters: LedgerFilters, sort: LedgerSort, listWindow: string | number): string {
  const status = filters.status === "all" ? "all" : [...filters.status].sort().join(",");
  return [
    filters.query.trim(),
    status,
    filters.showcase,
    filters.qa,
    sort.key,
    sort.direction,
    String(listWindow),
  ].join("|");
}

export type BulkLedgerAction = "start" | "pin" | "unpin" | "delete" | null;

export function formatSprintCount(count: number): string {
  return `${count} sprint${count === 1 ? "" : "s"}`;
}

export interface LedgerOutcomeMessageOptions {
  totalCount?: number;
  filteredCount?: number;
  selectedCount?: number;
  removedSelectedCount?: number;
}

export function getLedgerOutcomeMessage(
  outcome: string,
  visibleCount: number,
  options: LedgerOutcomeMessageOptions = {},
): string {
  const visibleCopy = typeof options.filteredCount === "number" && options.filteredCount !== visibleCount
    ? `Showing ${visibleCount} of ${formatSprintCount(options.filteredCount)} in the current result.`
    : typeof options.totalCount === "number"
      ? `Showing ${visibleCount} of ${formatSprintCount(options.totalCount)}.`
      : `${formatSprintCount(visibleCount)} visible.`;
  const selectedCopy = typeof options.selectedCount === "number"
    ? options.selectedCount === 0
      ? "No sprints selected."
      : `${options.selectedCount} selected.`
    : "";
  const removedCopy = options.removedSelectedCount
    ? `${options.removedSelectedCount} hidden selection${options.removedSelectedCount === 1 ? "" : "s"} removed.`
    : "";

  return [outcome, visibleCopy, selectedCopy, removedCopy].filter(Boolean).join(" ");
}

export function formatSelectedSprintNamesForConfirmation(sprints: Sprint[], maxNames: number = 3): string {
  if (sprints.length === 0) {
    return "No selected sprints.";
  }
  const visibleNames = sprints.slice(0, maxNames).map((sprint) => `"${sprint.name}"`);
  const remainingCount = sprints.length - visibleNames.length;
  if (remainingCount <= 0) {
    return `Affected sprints: ${visibleNames.join(", ")}.`;
  }
  return `Affected sprints: ${visibleNames.join(", ")}, and ${remainingCount} more sprint${remainingCount === 1 ? "" : "s"}.`;
}

export function getBulkActionMessage(action: BulkLedgerAction, selectedCount: number, pending: boolean): string {
  if (selectedCount === 0) {
    return "No sprints selected.";
  }
  const suffix = `${selectedCount} selected sprint${selectedCount === 1 ? "" : "s"}`;
  if (!action) {
    return `Bulk controls apply to ${suffix}.`;
  }
  if (pending) {
    const verb = action === "delete" ? "Deleting" : action === "start" ? "Starting" : action === "pin" ? "Pinning" : "Unpinning";
    return `${verb} ${suffix}.`;
  }
  const verb = action === "delete" ? "Delete" : action === "start" ? "Start" : action === "pin" ? "Pin" : "Unpin";
  return `${verb} will apply to ${suffix}.`;
}

export function getBulkActionButtonLabel(action: Exclude<BulkLedgerAction, null>, pending: boolean): string {
  if (!pending) {
    if (action === "start") return "Start";
    if (action === "pin") return "Pin";
    if (action === "unpin") return "Unpin";
    return "Delete";
  }
  if (action === "start") return "Starting";
  if (action === "pin") return "Pinning";
  if (action === "unpin") return "Unpinning";
  return "Deleting";
}

export function getBulkPendingReason(action: BulkLedgerAction, selectedCount: number): string {
  const suffix = `${selectedCount} selected sprint${selectedCount === 1 ? "" : "s"}`;
  if (selectedCount === 0) {
    return "Bulk controls are disabled because no sprints are selected.";
  }
  if (action === "start") {
    return `Bulk controls are disabled while starting ${suffix}.`;
  }
  if (action === "pin") {
    return `Bulk controls are disabled while pinning ${suffix}.`;
  }
  if (action === "unpin") {
    return `Bulk controls are disabled while unpinning ${suffix}.`;
  }
  if (action === "delete") {
    return `Bulk controls are disabled while deleting ${suffix}.`;
  }
  return `Bulk controls are disabled while an action runs for ${suffix}.`;
}

export function getSortAriaSort(sort: LedgerSort, key: SprintTableSortKey): "none" | "ascending" | "descending" {
  if (sort.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

export function getSortButtonLabel(sort: LedgerSort, key: SprintTableSortKey): string {
  return `Sort by ${SPRINT_TABLE_SORT_LABELS[key]}`;
}

export function getSortButtonDescription(sort: LedgerSort, key: SprintTableSortKey): string {
  const currentState = sort.key === key
    ? `Currently sorted ${sort.direction === "asc" ? "ascending" : "descending"}`
    : "Not currently sorted";
  const next = nextSort(sort, key);
  return `${currentState}. Activate to sort ${SPRINT_TABLE_SORT_LABELS[key]} ${next.direction === "asc" ? "ascending" : "descending"}.`;
}

/**
 * Cycle sort direction or set default for a new column.
 */
export function nextSort(current: LedgerSort, key: SprintTableSortKey): LedgerSort {
  if (current.key === key) {
    return {
      key,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }
  return {
    key,
    direction: key === "name" || key === "status" || key === "showcasePinned" || key === "sprintKey" ? "asc" : "desc",
  };
}
