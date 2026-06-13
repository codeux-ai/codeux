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
  isSessionTerminal?: (sessionName: string) => boolean;
  logger?: Logger;
}

export class ActivityCacheService {
  private liveActivitiesCache: Map<string, { timestamp: number; data: JulesActivity[] }> = new Map();
  private inFlightFetches: Map<string, Promise<JulesActivity[]>> = new Map();

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
    this.inFlightFetches.clear();
  }

  async getGitStatus(): Promise<GitTrackingStatus> {
    return this.deps.fetchGitStatusForRepo(this.deps.resolveGitStatusRepoPath(), this.gitStatusCacheMs);
  }

  async getLiveActivitiesForActiveTasks(): Promise<Record<string, JulesActivity[]>> {
    const subtasks = this.deps.getSubtasks();
    const activeSessionNames = Array.from(
      new Set(
        subtasks
          .filter((task) => task.status === "RUNNING")
          .map((task) => this.deps.resolveSessionNameFromTask(task))
          .filter((value): value is string => {
            if (!value) return false;
            if (this.deps.isSessionTerminal?.(value)) return false;
            return true;
          })
      )
    );

    if (activeSessionNames.length === 0) {
      return {};
    }

    const now = Date.now();
    const result: Record<string, JulesActivity[]> = {};
    const sessionsToFetch: string[] = [];

    for (const sessionName of activeSessionNames) {
      const cached = this.liveActivitiesCache.get(sessionName);
      if (cached && now - cached.timestamp < this.liveActivityCacheMs) {
        result[sessionName] = cached.data;
      } else {
        sessionsToFetch.push(sessionName);
      }
    }

    if (sessionsToFetch.length > 0) {
      const fetchResults = await pMap(
        sessionsToFetch,
        async (sessionName) => {
          let fetchPromise = this.inFlightFetches.get(sessionName);

          if (!fetchPromise) {
            fetchPromise = (async () => {
              try {
                return await this.deps.fetchRecentActivities(sessionName, this.activityPageSize);
              } catch {
                this.deps.logger?.warn("Could not fetch live activities", { sessionName });
                return [];
              }
            })().finally(() => {
              this.inFlightFetches.delete(sessionName);
            });
            this.inFlightFetches.set(sessionName, fetchPromise);
          }

          const activities = await fetchPromise;
          this.liveActivitiesCache.set(sessionName, { timestamp: Date.now(), data: activities });
          return [sessionName, activities] as [string, JulesActivity[]];
        },
        this.activityFetchConcurrency
      );

      for (const [sessionName, activities] of fetchResults) {
        result[sessionName] = activities;
      }
    }

    return result;
  }
}
