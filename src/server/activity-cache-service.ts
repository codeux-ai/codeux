import type { GitTrackingStatus, JulesActivity, Subtask } from "../contracts/app-types.js";
import {
  mapBoundedOrdered,
  normalizeActivityFetchError,
  withActivityFetchTimeout,
} from "../domain/sprint/session-sync/activity-fetch-utils.js";
import type { Logger } from "../shared/logging/logger.js";

const DEFAULT_LIVE_ACTIVITY_FETCH_TIMEOUT_MS = 30_000;
const LIVE_ACTIVITY_FETCH_TIMEOUT_ERROR_NAME = "ActivityFetchTimeoutError";

const getFetchFailureMetadata = (
  sessionName: string,
  error: unknown,
  cacheFallbackState: "empty" | "stale",
  cachedActivityCount: number,
  timeoutMs: number
) => {
  const { errorName, errorMessage } = normalizeActivityFetchError(error);
  const isTimeout = errorName === LIVE_ACTIVITY_FETCH_TIMEOUT_ERROR_NAME;
  return {
    sessionName,
    failureCause: isTimeout ? "timeout" : "error",
    errorName,
    errorMessage,
    cacheFallbackState,
    cachedActivityCount,
    ...(isTimeout ? { timeoutMs } : {}),
  };
};

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
  private liveActivitiesCache: Map<string, { timestamp: number; data: JulesActivity[]; isNegative: boolean }> = new Map();
  private liveActivitiesFetchPromise: Promise<Record<string, JulesActivity[]>> | null = null;

  constructor(
    private readonly deps: ActivityCacheServiceDependencies,
    private readonly liveActivityCacheMs: number,
    private readonly gitStatusCacheMs: number,
    private readonly activityPageSize: number,
    private readonly activityFetchConcurrency: number = 3,
    private readonly negativeActivityCacheMs: number = 2000,
    private readonly liveActivityFetchTimeoutMs: number = DEFAULT_LIVE_ACTIVITY_FETCH_TIMEOUT_MS
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
      const missingSessions: string[] = [];

      for (const sessionName of activeSessionNames) {
        const cached = this.liveActivitiesCache.get(sessionName);
        if (cached) {
          const ttl = cached.isNegative ? this.negativeActivityCacheMs : this.liveActivityCacheMs;
          if (now - cached.timestamp < ttl) {
            result[sessionName] = cached.data;
            continue;
          }
        }
        missingSessions.push(sessionName);
      }

      if (missingSessions.length > 0) {
        const fetchResults = await mapBoundedOrdered({
          items: missingSessions,
          concurrency: this.activityFetchConcurrency,
          mapper: async (sessionName) => {
            try {
              const activities = await withActivityFetchTimeout(
                this.deps.fetchRecentActivities(sessionName, this.activityPageSize),
                {
                  timeoutMs: this.liveActivityFetchTimeoutMs,
                  createTimeoutError: () => {
                    const error = new Error(`Timed out fetching live activities for ${sessionName} after ${this.liveActivityFetchTimeoutMs}ms`);
                    error.name = LIVE_ACTIVITY_FETCH_TIMEOUT_ERROR_NAME;
                    return error;
                  },
                },
              );
              return { sessionName, activities, isNegative: activities.length === 0, failed: false };
            } catch (error) {
              const cached = this.liveActivitiesCache.get(sessionName);
              if (cached && !cached.isNegative) {
                this.deps.logger?.warn("Could not fetch live activities; returning stale cached activities", {
                  ...getFetchFailureMetadata(sessionName, error, "stale", cached.data.length, this.liveActivityFetchTimeoutMs),
                });
                return { sessionName, activities: cached.data, isNegative: false, failed: true };
              }
              this.deps.logger?.warn("Could not fetch live activities", {
                ...getFetchFailureMetadata(sessionName, error, "empty", 0, this.liveActivityFetchTimeoutMs),
              });
              return { sessionName, activities: [], isNegative: false, failed: true };
            }
          },
        });

        const fetchTimestamp = Date.now();
        for (const { sessionName, activities, isNegative, failed } of fetchResults) {
          result[sessionName] = activities;
          if (!failed) {
            this.liveActivitiesCache.set(sessionName, { timestamp: fetchTimestamp, data: activities, isNegative });
          }
        }
      }

      return result;
    })().finally(() => {
      this.liveActivitiesFetchPromise = null;
    });

    return this.liveActivitiesFetchPromise;
  }
}
