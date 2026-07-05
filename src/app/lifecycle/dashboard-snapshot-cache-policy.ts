import type { ProjectStatsQuery } from "../../contracts/app-types.js";
import type { ProjectExecutionSnapshotOptions } from "../../repositories/execution/project-execution-snapshot-query.js";

export type ProjectExecutionSelectedSprintCacheScope =
  | { readonly state: "none" }
  | { readonly state: "selected"; readonly sprintId: string };

export interface ProjectExecutionSnapshotCacheScope {
  readonly projectId: string;
  readonly selectedSprint: ProjectExecutionSelectedSprintCacheScope;
}

export type ProjectExecutionSnapshotCacheKey = string & {
  readonly __projectExecutionSnapshotCacheKey: unique symbol;
};

/**
 * Snapshots returned by the cache are considered immutable by callers.
 * Cache reads do not mutate cached snapshots.
 */
export class DashboardSnapshotCachePolicy {
  static readonly PROJECT_EXECUTION_CACHE_TTL_MS = 2_000;
  static readonly PROJECT_STATS_CACHE_TTL_MS = 2_000;
  static readonly OVERVIEW_CACHE_TTL_MS = 500;
  static readonly PROJECTS_CACHE_TTL_MS = 500;

  static getProjectExecutionSnapshotCacheScope(
    projectId: string,
    options: ProjectExecutionSnapshotOptions = {},
  ): ProjectExecutionSnapshotCacheScope {
    const selectedSprintId = options.selectedSprintId;
    return {
      projectId,
      selectedSprint: typeof selectedSprintId === "string" && selectedSprintId.length > 0
        ? { state: "selected", sprintId: selectedSprintId }
        : { state: "none" },
    };
  }

  static getProjectExecutionSnapshotCacheKey(
    projectId: string,
    options: ProjectExecutionSnapshotOptions = {},
  ): ProjectExecutionSnapshotCacheKey {
    const scope = DashboardSnapshotCachePolicy.getProjectExecutionSnapshotCacheScope(projectId, options);
    const selectedSprintKey = scope.selectedSprint.state === "selected"
      ? `selected:${encodeURIComponent(scope.selectedSprint.sprintId)}`
      : "none";
    return `project-execution:${encodeURIComponent(scope.projectId)}:selected-sprint:${selectedSprintKey}` as ProjectExecutionSnapshotCacheKey;
  }

  static isProjectExecutionSnapshotCacheKeyMatch(
    key: ProjectExecutionSnapshotCacheKey,
    projectId: string,
  ): boolean {
    return key.startsWith(`project-execution:${encodeURIComponent(projectId)}:selected-sprint:`);
  }

  static getProjectStatsCacheKey(projectId: string, query: ProjectStatsQuery): string {
    return `${projectId}:${JSON.stringify(query)}`;
  }

  static isProjectStatsCacheKeyMatch(key: string, projectId: string): boolean {
    return key.startsWith(`${projectId}:`);
  }
}
