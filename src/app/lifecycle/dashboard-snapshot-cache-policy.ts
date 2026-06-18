import type { ProjectStatsQuery } from "../../contracts/app-types.js";

/**
 * Snapshots returned by the cache are considered immutable by callers.
 * Cache reads do not mutate cached snapshots.
 */
export class DashboardSnapshotCachePolicy {
  static readonly PROJECT_EXECUTION_CACHE_TTL_MS = 2_000;
  static readonly PROJECT_STATS_CACHE_TTL_MS = 2_000;
  static readonly OVERVIEW_CACHE_TTL_MS = 500;
  static readonly PROJECTS_CACHE_TTL_MS = 500;

  static getProjectStatsCacheKey(projectId: string, query: ProjectStatsQuery): string {
    return `${projectId}:${JSON.stringify(query)}`;
  }

  static isProjectStatsCacheKeyMatch(key: string, projectId: string): boolean {
    return key.startsWith(`${projectId}:`);
  }
}
