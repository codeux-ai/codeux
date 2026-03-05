import type { GitTrackingStatus, JulesActivity, Subtask } from "../contracts/app-types.js";
import type { Logger } from "../shared/logging/logger.js";

export interface ActivityCacheServiceDependencies {
  getSubtasks: () => Subtask[];
  resolveSessionNameFromTask: (task: Subtask) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>;
  resolveGitStatusRepoPath: () => string;
  fetchGitStatusForRepo: (repoPath: string, cacheTtlMs?: number) => Promise<GitTrackingStatus>;
  invalidateGitStatusCache?: (repoPath: string) => void;
  logger?: Logger;
}

export class ActivityCacheService {
  private liveActivitiesCache: { timestamp: number; data: Record<string, JulesActivity[]> } = { timestamp: 0, data: {} };
  private liveActivitiesFetchPromise: Promise<Record<string, JulesActivity[]>> | null = null;

  constructor(
    private readonly deps: ActivityCacheServiceDependencies,
    private readonly liveActivityCacheMs: number,
    private readonly gitStatusCacheMs: number,
    private readonly activityPageSize: number
  ) {}

  invalidateGitStatusCache(): void {
    this.deps.invalidateGitStatusCache?.(this.deps.resolveGitStatusRepoPath());
  }

  invalidateLiveActivitiesCache(): void {
    this.liveActivitiesCache = { timestamp: 0, data: {} };
    this.liveActivitiesFetchPromise = null;
  }

  async getGitStatus(): Promise<GitTrackingStatus> {
    return this.deps.fetchGitStatusForRepo(this.deps.resolveGitStatusRepoPath(), this.gitStatusCacheMs);
  }

  async getLiveActivitiesForActiveTasks(): Promise<Record<string, JulesActivity[]>> {
    const now = Date.now();
    if (now - this.liveActivitiesCache.timestamp < this.liveActivityCacheMs) {
      return this.liveActivitiesCache.data;
    }

    if (this.liveActivitiesFetchPromise) {
      return this.liveActivitiesFetchPromise;
    }

    this.liveActivitiesFetchPromise = (async () => {
      const subtasks = this.deps.getSubtasks();
      const activeSessionNames = Array.from(
        new Set(
          subtasks
            .filter((task) => task.status === "RUNNING")
            .map((task) => this.deps.resolveSessionNameFromTask(task))
            .filter((value): value is string => Boolean(value))
        )
      );

      if (activeSessionNames.length === 0) {
        const empty: Record<string, JulesActivity[]> = {};
        this.liveActivitiesCache = { timestamp: Date.now(), data: empty };
        return empty;
      }

      const results = await Promise.all(
        activeSessionNames.map(async (sessionName) => {
          try {
            const activities = await this.deps.fetchRecentActivities(sessionName, this.activityPageSize);
            return [sessionName, activities] as const;
          } catch {
            this.deps.logger?.warn("Could not fetch live activities", { sessionName });
            return [sessionName, []] as const;
          }
        })
      );

      const data = Object.fromEntries(results);
      this.liveActivitiesCache = { timestamp: Date.now(), data };
      return data;
    })().finally(() => {
      this.liveActivitiesFetchPromise = null;
    });

    return this.liveActivitiesFetchPromise;
  }
}
