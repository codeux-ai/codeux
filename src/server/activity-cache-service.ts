import type { GitTrackingStatus, JulesActivity, Subtask } from "../contracts/app-types.js";
import type { Logger } from "../shared/logging/logger.js";

async function pMap<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await mapper(items[index]);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);

  return results;
}

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
  private liveActivitiesCache: Map<string, { timestamp: number; data: JulesActivity[] }> = new Map();
  private liveActivitiesFetchPromise: Promise<Record<string, JulesActivity[]>> | null = null;

  constructor(
    private readonly deps: ActivityCacheServiceDependencies,
    private readonly liveActivityCacheMs: number,
    private readonly gitStatusCacheMs: number,
    private readonly activityPageSize: number,
    private readonly activityFetchConcurrency: number = 3
  ) {}

  invalidateGitStatusCache(): void {
    this.deps.invalidateGitStatusCache?.(this.deps.resolveGitStatusRepoPath());
  }

  invalidateLiveActivitiesCache(): void {
    this.liveActivitiesCache.clear();
    this.liveActivitiesFetchPromise = null;
  }

  async getGitStatus(): Promise<GitTrackingStatus> {
    return this.deps.fetchGitStatusForRepo(this.deps.resolveGitStatusRepoPath(), this.gitStatusCacheMs);
  }

  async getLiveActivitiesForActiveTasks(): Promise<Record<string, JulesActivity[]>> {
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
        return {};
      }

      const now = Date.now();
      const result: Record<string, JulesActivity[]> = {};
      const missingSessions: string[] = [];

      for (const sessionName of activeSessionNames) {
        const cached = this.liveActivitiesCache.get(sessionName);
        if (cached && now - cached.timestamp < this.liveActivityCacheMs) {
          result[sessionName] = cached.data;
        } else {
          missingSessions.push(sessionName);
        }
      }

      if (missingSessions.length > 0) {
        const fetchResults = await pMap(
          missingSessions,
          async (sessionName) => {
            try {
              const activities = await this.deps.fetchRecentActivities(sessionName, this.activityPageSize);
              return [sessionName, activities] as [string, JulesActivity[]];
            } catch {
              this.deps.logger?.warn("Could not fetch live activities", { sessionName });
              return [sessionName, []] as [string, JulesActivity[]];
            }
          },
          this.activityFetchConcurrency
        );

        const fetchTimestamp = Date.now();
        for (const [sessionName, activities] of fetchResults) {
          result[sessionName] = activities;
          this.liveActivitiesCache.set(sessionName, { timestamp: fetchTimestamp, data: activities });
        }
      }

      return result;
    })().finally(() => {
      this.liveActivitiesFetchPromise = null;
    });

    return this.liveActivitiesFetchPromise;
  }
}
