import type { GitTrackingStatus, JulesActivity, Subtask } from "../contracts/app-types.js";

export interface ActivityCacheServiceDependencies {
  getSubtasks: () => Subtask[];
  resolveSessionNameFromTask: (task: Subtask) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>;
  resolveGitStatusRepoPath: () => string;
  fetchGitStatusForRepo: (repoPath: string) => Promise<GitTrackingStatus>;
}

export class ActivityCacheService {
  private liveActivitiesCache: { timestamp: number; data: Record<string, JulesActivity[]> } = { timestamp: 0, data: {} };
  private liveActivitiesFetchPromise: Promise<Record<string, JulesActivity[]>> | null = null;
  private gitStatusCache: { timestamp: number; data: GitTrackingStatus | null; repoPath: string | null } = {
    timestamp: 0,
    data: null,
    repoPath: null,
  };
  private gitStatusFetchPromise: Promise<GitTrackingStatus> | null = null;

  constructor(
    private readonly deps: ActivityCacheServiceDependencies,
    private readonly liveActivityCacheMs: number,
    private readonly gitStatusCacheMs: number,
    private readonly activityPageSize: number
  ) {}

  invalidateGitStatusCache(): void {
    this.gitStatusCache = { timestamp: 0, data: null, repoPath: null };
  }

  async getGitStatus(): Promise<GitTrackingStatus> {
    const repoPath = this.deps.resolveGitStatusRepoPath();
    const now = Date.now();
    if (
      this.gitStatusCache.data &&
      this.gitStatusCache.repoPath === repoPath &&
      now - this.gitStatusCache.timestamp < this.gitStatusCacheMs
    ) {
      return this.gitStatusCache.data;
    }
    if (this.gitStatusFetchPromise) {
      return this.gitStatusFetchPromise;
    }

    this.gitStatusFetchPromise = this.deps
      .fetchGitStatusForRepo(repoPath)
      .then((status) => {
        this.gitStatusCache = { timestamp: Date.now(), data: status, repoPath };
        return status;
      })
      .finally(() => {
        this.gitStatusFetchPromise = null;
      });

    return this.gitStatusFetchPromise;
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
            console.error(`Warning: Could not fetch live activities for ${sessionName}`);
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
