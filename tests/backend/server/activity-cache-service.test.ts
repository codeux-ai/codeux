import { describe, expect, it, vi, beforeEach } from "vitest";
import { ActivityCacheService, type ActivityCacheServiceDependencies } from "../../../src/server/activity-cache-service.js";
import type { Subtask, GitTrackingStatus, JulesActivity } from "../../../src/contracts/app-types.js";

describe("ActivityCacheService", () => {
  let mockDeps: ActivityCacheServiceDependencies;

  beforeEach(() => {
    mockDeps = {
      getSubtasks: vi.fn().mockReturnValue([]),
      resolveSessionNameFromTask: vi.fn(),
      fetchRecentActivities: vi.fn().mockResolvedValue([]),
      resolveGitStatusRepoPath: vi.fn().mockReturnValue("/mock/repo"),
      fetchGitStatusForRepo: vi.fn().mockResolvedValue({ currentBranch: "main" } as GitTrackingStatus),
      invalidateGitStatusCache: vi.fn(),
      logger: { warn: vi.fn() } as any,
    };
  });

  it("invalidates git status cache using correct repo path", () => {
    const service = new ActivityCacheService(mockDeps, 1000, 1000, 10);
    service.invalidateGitStatusCache();
    expect(mockDeps.resolveGitStatusRepoPath).toHaveBeenCalled();
    expect(mockDeps.invalidateGitStatusCache).toHaveBeenCalledWith("/mock/repo");
  });

  it("fetches git status delegating to deps", async () => {
    const service = new ActivityCacheService(mockDeps, 1000, 1000, 10);
    const status = await service.getGitStatus();
    expect(status).toEqual({ currentBranch: "main" });
    expect(mockDeps.fetchGitStatusForRepo).toHaveBeenCalledWith("/mock/repo", 1000);
  });

  it("handles live activities without active tasks", async () => {
    const service = new ActivityCacheService(mockDeps, 1000, 1000, 10);
    const activities = await service.getLiveActivitiesForActiveTasks();
    expect(activities).toEqual({});
  });

  it("fetches and caches live activities for running tasks", async () => {
    const mockTasks: Partial<Subtask>[] = [
      { id: "1", status: "RUNNING" },
      { id: "2", status: "PENDING" },
    ];
    mockDeps.getSubtasks = vi.fn().mockReturnValue(mockTasks);
    mockDeps.resolveSessionNameFromTask = vi.fn().mockReturnValue("session-1");
    mockDeps.fetchRecentActivities = vi.fn().mockResolvedValue([{ id: "act1" } as JulesActivity]);

    const service = new ActivityCacheService(mockDeps, 1000, 1000, 10);
    const activities = await service.getLiveActivitiesForActiveTasks();

    expect(activities).toEqual({ "session-1": [{ id: "act1" }] });
    expect(mockDeps.fetchRecentActivities).toHaveBeenCalledWith("session-1", 10);

    // Call again to verify cache
    const activities2 = await service.getLiveActivitiesForActiveTasks();
    expect(activities2).toBe(activities); // Same reference
    expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(1); // Cached
  });

  it("handles fetch errors gracefully via catch block", async () => {
    const mockTasks: Partial<Subtask>[] = [{ id: "1", status: "RUNNING" }];
    mockDeps.getSubtasks = vi.fn().mockReturnValue(mockTasks);
    mockDeps.resolveSessionNameFromTask = vi.fn().mockReturnValue("session-1");
    mockDeps.fetchRecentActivities = vi.fn().mockRejectedValue(new Error("Network Error"));

    const service = new ActivityCacheService(mockDeps, 1000, 1000, 10);
    const activities = await service.getLiveActivitiesForActiveTasks();

    expect(activities).toEqual({ "session-1": [] });
    expect(mockDeps.logger!.warn).toHaveBeenCalled();
  });

  it("clears live activities cache on invalidate", async () => {
     const service = new ActivityCacheService(mockDeps, 1000, 1000, 10);
     service.invalidateLiveActivitiesCache();
     expect((service as any).liveActivitiesCache.timestamp).toBe(0);
  });
});
