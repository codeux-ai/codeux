import type { Sprint, SprintStatus } from "../types.js";
import { createDashboardFormatters } from "../i18n/formatters.js";
import {
  translateDashboardMessage,
  translateDashboardPlural,
  type DashboardLocale,
} from "../i18n/locales.js";
import { sprintsMessages } from "../i18n/messages/sprints.js";

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

const SPRINT_TABLE_SORT_MESSAGE_KEYS: Record<SprintTableSortKey, "showcase" | "sprintId" | "sprint" | "status" | "tasks" | "completion" | "created"> = {
  showcasePinned: "showcase",
  sprintKey: "sprintId",
  name: "sprint",
  status: "status",
  tasksCount: "tasks",
  completion: "completion",
  createdAt: "created",
};

export const getSprintTableSortLabel = (key: SprintTableSortKey, locale: DashboardLocale = "en"): string => (
  translateDashboardMessage(sprintsMessages, locale, SPRINT_TABLE_SORT_MESSAGE_KEYS[key])
);

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

const STATUS_MESSAGE_KEYS: Record<SprintStatus, "statusRunning" | "statusPaused" | "statusCompleted" | "statusFailed" | "statusCancelled" | "statusDraft"> = {
  running: "statusRunning",
  paused: "statusPaused",
  completed: "statusCompleted",
  failed: "statusFailed",
  cancelled: "statusCancelled",
  idle: "statusDraft",
};

export const getSprintStatusLabel = (status: SprintStatus, locale: DashboardLocale = "en"): string => (
  translateDashboardMessage(sprintsMessages, locale, STATUS_MESSAGE_KEYS[status])
);

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
export function filterSprints(sprints: Sprint[], filters: LedgerFilters, sprintKeyPrefix: string = "SPR", locale: DashboardLocale = "en"): Sprint[] {
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
    const statusLabel = getSprintStatusLabel(sprint.status, locale).toLocaleLowerCase(locale);
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
export function getLedgerSprints(sprints: Sprint[], filters: LedgerFilters, sort: LedgerSort, sprintKeyPrefix: string = "SPR", locale: DashboardLocale = "en"): Sprint[] {
  return sortSprints(filterSprints(sprints, filters, sprintKeyPrefix, locale), sort, sprintKeyPrefix);
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

export function formatSprintCount(count: number, locale: DashboardLocale = "en"): string {
  return translateDashboardPlural(sprintsMessages, locale, "sprintCount", count, {
    count: createDashboardFormatters(locale).formatNumber(count),
  });
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
  locale: DashboardLocale = "en",
): string {
  const { formatNumber } = createDashboardFormatters(locale);
  const visibleCopy = typeof options.filteredCount === "number" && options.filteredCount !== visibleCount
    ? translateDashboardPlural(sprintsMessages, locale, "showingFilteredPlural", options.filteredCount, { visible: formatNumber(visibleCount), total: formatNumber(options.filteredCount) })
    : typeof options.totalCount === "number"
      ? translateDashboardPlural(sprintsMessages, locale, "showingTotalPlural", options.totalCount, { visible: formatNumber(visibleCount), total: formatNumber(options.totalCount) })
      : translateDashboardPlural(sprintsMessages, locale, "visibleSprintsPlural", visibleCount, { count: formatNumber(visibleCount) });
  const selectedCopy = typeof options.selectedCount === "number"
    ? options.selectedCount === 0
      ? translateDashboardMessage(sprintsMessages, locale, "noSprintsSelected")
      : translateDashboardMessage(sprintsMessages, locale, "selectedShort", { count: formatNumber(options.selectedCount) })
    : "";
  const removedCopy = options.removedSelectedCount
    ? translateDashboardPlural(sprintsMessages, locale, "hiddenSelectionsRemoved", options.removedSelectedCount, { count: formatNumber(options.removedSelectedCount) })
    : "";

  return [outcome, visibleCopy, selectedCopy, removedCopy].filter(Boolean).join(" ");
}

export function formatSelectedSprintNamesForConfirmation(sprints: Sprint[], maxNames: number = 3, locale: DashboardLocale = "en"): string {
  if (sprints.length === 0) {
    return translateDashboardMessage(sprintsMessages, locale, "noSelectedSprints");
  }
  const visibleNames = sprints.slice(0, maxNames).map((sprint) => `"${sprint.name}"`);
  const names = createDashboardFormatters(locale).formatList(visibleNames, { type: "conjunction" });
  const remainingCount = sprints.length - visibleNames.length;
  if (remainingCount <= 0) {
    return translateDashboardMessage(sprintsMessages, locale, "affectedSprints", { names });
  }
  return translateDashboardPlural(sprintsMessages, locale, "affectedSprintsMore", remainingCount, {
    names,
    count: createDashboardFormatters(locale).formatNumber(remainingCount),
  });
}

export function getBulkActionMessage(action: BulkLedgerAction, selectedCount: number, pending: boolean, locale: DashboardLocale = "en"): string {
  if (selectedCount === 0) {
    return translateDashboardMessage(sprintsMessages, locale, "noSprintsSelected");
  }
  const selection = translateDashboardPlural(sprintsMessages, locale, "selectedSprintsNoun", selectedCount, {
    count: createDashboardFormatters(locale).formatNumber(selectedCount),
  });
  if (!action) {
    return translateDashboardMessage(sprintsMessages, locale, "bulkControlsApplyLocalized", { selection });
  }
  const actionLabel = getBulkActionButtonLabel(action, pending, locale);
  if (pending) {
    return translateDashboardMessage(sprintsMessages, locale, "bulkActionRunningLocalized", { action: actionLabel, selection });
  }
  return translateDashboardMessage(sprintsMessages, locale, "bulkActionWillApplyLocalized", { action: actionLabel, selection });
}

export function getBulkActionButtonLabel(action: Exclude<BulkLedgerAction, null>, pending: boolean, locale: DashboardLocale = "en"): string {
  if (!pending) {
    if (action === "start") return translateDashboardMessage(sprintsMessages, locale, "start");
    if (action === "pin") return translateDashboardMessage(sprintsMessages, locale, "pin");
    if (action === "unpin") return translateDashboardMessage(sprintsMessages, locale, "unpin");
    return translateDashboardMessage(sprintsMessages, locale, "delete");
  }
  if (action === "start") return translateDashboardMessage(sprintsMessages, locale, "starting");
  if (action === "pin") return translateDashboardMessage(sprintsMessages, locale, "pinning");
  if (action === "unpin") return translateDashboardMessage(sprintsMessages, locale, "unpinning");
  return translateDashboardMessage(sprintsMessages, locale, "deleting");
}

export function getBulkPendingReason(action: BulkLedgerAction, selectedCount: number, locale: DashboardLocale = "en"): string {
  if (selectedCount === 0) {
    return translateDashboardMessage(sprintsMessages, locale, "bulkDisabledNone");
  }
  const selection = translateDashboardPlural(sprintsMessages, locale, "selectedSprintsNoun", selectedCount, {
    count: createDashboardFormatters(locale).formatNumber(selectedCount),
  });
  if (action) {
    return translateDashboardMessage(sprintsMessages, locale, "bulkDisabledRunningLocalized", {
      action: getBulkActionButtonLabel(action, true, locale).toLocaleLowerCase(locale),
      selection,
    });
  }
  return translateDashboardMessage(sprintsMessages, locale, "bulkDisabledGenericLocalized", { selection });
}

export function getSortAriaSort(sort: LedgerSort, key: SprintTableSortKey): "none" | "ascending" | "descending" {
  if (sort.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

export function getSortButtonLabel(sort: LedgerSort, key: SprintTableSortKey, locale: DashboardLocale = "en"): string {
  return translateDashboardMessage(sprintsMessages, locale, "sortBy", { column: getSprintTableSortLabel(key, locale) });
}

export function getSortButtonDescription(sort: LedgerSort, key: SprintTableSortKey, locale: DashboardLocale = "en"): string {
  const direction = (value: SprintTableSortDirection): string => translateDashboardMessage(sprintsMessages, locale, value === "asc" ? "ascending" : "descending");
  const currentState = sort.key === key
    ? translateDashboardMessage(sprintsMessages, locale, "currentlySorted", { direction: direction(sort.direction) })
    : translateDashboardMessage(sprintsMessages, locale, "notCurrentlySorted");
  const next = nextSort(sort, key);
  return translateDashboardMessage(sprintsMessages, locale, "activateSort", {
    current: currentState,
    column: getSprintTableSortLabel(key, locale),
    direction: direction(next.direction),
  });
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
