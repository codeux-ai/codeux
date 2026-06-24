import type { SprintStatus } from "../../types.js";
import type { Sprint } from "../../types.js";
import { filterShowcaseSprints, sortSprintsByRecency } from "../../lib/sprint-gallery.js";
import type { SystemSettings } from "../../../types.js";
import {
  getProviderDisplayMetadata,
  getVirtualProviderDisplayMetadata,
} from "../../lib/settings-view-models.js";

const ACTIVE_CONNECTION_STATUSES = new Set(["connected", "listening", "idle"]);
const IN_WORK_STATUSES = new Set<SprintStatus>(["running", "paused"]);

const PLANNING_ROLE_PRIORITY: Record<string, number> = {
  worker: 0,
  listener: 1,
};

const CONNECTION_STATUS_PRIORITY: Record<string, number> = {
  listening: 0,
  connected: 1,
  idle: 2,
  paused: 3,
  stale: 4,
  offline: 5,
};

export const compareString = (left: string, right: string): number => (
  left.localeCompare(right, undefined, { sensitivity: "base" })
);

export function buildActualActiveRunsMap(sprintRuns: any[]) {
  const map = new Map<string, { id: string; status: string }>();
  for (const run of sprintRuns) {
    if (run.status !== "running" && run.status !== "queued") {
      continue;
    }
    if (!map.has(run.sprintId)) {
      map.set(run.sprintId, { id: run.id, status: run.status });
    }
  }
  return map;
}

export function buildActiveRunsMap(
  actualActiveRunsBySprintId: Map<string, { id: string; status: string }>,
  suppressedRunningSprintIds: Set<string>
) {
  const map = new Map<string, { id: string; status: string }>();
  for (const [sprintId, run] of actualActiveRunsBySprintId.entries()) {
    if (suppressedRunningSprintIds.has(sprintId)) {
      continue;
    }
    map.set(sprintId, run);
  }
  return map;
}

export function buildPauseResumeRunsMap(sprintRuns: any[]) {
  const map = new Map<string, { id: string; status: string }>();
  for (const run of sprintRuns) {
    if (run.status !== "running" && run.status !== "queued" && run.status !== "paused") {
      continue;
    }
    if (!map.has(run.sprintId)) {
      map.set(run.sprintId, { id: run.id, status: run.status });
    }
  }
  return map;
}

export function buildDisplaySprints(
  sprints: Sprint[],
  optimisticStatuses: Record<string, string>,
  suppressedRunningSprintIds: Set<string>
) {
  return sprints.map((sprint: Sprint) => ({
    ...sprint,
    status: (optimisticStatuses[sprint.id]
      || (suppressedRunningSprintIds.has(sprint.id) && sprint.status === "running" ? "cancelled" : sprint.status)) as SprintStatus,
  }));
}

export function buildSortedSprints(displaySprints: Sprint[]) {
  return sortSprintsByRecency(displaySprints);
}

export function buildShowcaseSprints(sortedSprints: Sprint[]) {
  return filterShowcaseSprints(sortedSprints);
}

export function countSprintsByStatus(sortedSprints: Sprint[], status: string) {
  return sortedSprints.filter((sprint) => sprint.status === status).length;
}

export function countInWorkSprints(sortedSprints: Sprint[]) {
  return sortedSprints.filter((sprint) => IN_WORK_STATUSES.has(sprint.status)).length;
}

export function buildPlanningConnection(connections: any[]) {
  return [...connections]
    .filter((connection) => (
      connection.listenMode
      && ACTIVE_CONNECTION_STATUSES.has(connection.status)
      && (connection.role === "worker" || connection.role === "listener")
    ))
    .sort((left, right) => {
      const roleDelta = (PLANNING_ROLE_PRIORITY[left.role] ?? 99) - (PLANNING_ROLE_PRIORITY[right.role] ?? 99);
      if (roleDelta !== 0) {
        return roleDelta;
      }
      const statusDelta = (CONNECTION_STATUS_PRIORITY[left.status] ?? 99) - (CONNECTION_STATUS_PRIORITY[right.status] ?? 99);
      if (statusDelta !== 0) {
        return statusDelta;
      }
      return compareString(left.displayName, right.displayName);
    })[0] || null;
}

export function buildPlanningRoute(
  planningConnection: any | null,
  workerMode: any,
  systemSettings: SystemSettings | null = null,
  workerModel?: string | null,
) {
  if (workerMode?.executionMode === "VIRTUAL") {
    const providerMetadata = getProviderDisplayMetadata(
      systemSettings,
      workerMode.virtualWorkerProvider,
      workerModel,
    );
    return {
      available: true,
      label: providerMetadata?.displayLabel || "Virtual Worker",
    };
  }

  if (planningConnection) {
    return {
      available: true,
      label: planningConnection.displayName,
    };
  }

  return {
    available: false,
    label: null,
  };
}

export function buildVirtualProviders(systemSettings: SystemSettings | null) {
  return getVirtualProviderDisplayMetadata(systemSettings);
}
