import type { Sprint, SprintStatus } from "../types.js";

export type SprintTableSortKey = "showcasePinned" | "sprintKey" | "name" | "status" | "tasksCount" | "completion" | "createdAt";
export type SprintTableSortDirection = "asc" | "desc";

export interface LedgerSort {
  key: SprintTableSortKey;
  direction: SprintTableSortDirection;
}

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
