import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActivityCacheService } from '../../../src/server/activity-cache-service.js';
import type { ActivityCacheServiceDependencies } from '../../../src/server/activity-cache-service.js';
import type { JulesActivity, Subtask, GitTrackingStatus } from '../../../src/contracts/app-types.js';

describe('ActivityCacheService', () => {
  let mockDeps: ReturnType<typeof vi.mocked<ActivityCacheServiceDependencies>>;
  let service: ActivityCacheService;

  const LIVE_CACHE_MS = 1000;
  const GIT_CACHE_MS = 5000;
  const PAGE_SIZE = 10;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(10000));

    mockDeps = {
      getSubtasks: vi.fn(),
      resolveSessionNameFromTask: vi.fn(),
      fetchRecentActivities: vi.fn(),
      resolveGitStatusRepoPath: vi.fn().mockReturnValue('/test/repo'),
      fetchGitStatusForRepo: vi.fn(),
      invalidateGitStatusCache: vi.fn(),
      isSessionTerminal: vi.fn(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      } as any,
    };

    service = new ActivityCacheService(mockDeps, LIVE_CACHE_MS, GIT_CACHE_MS, PAGE_SIZE);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Live Activities Cache (set, get, invalidate, TTL)', () => {
    const mockTask: Subtask = {
      id: 'task-1',
      description: 'Test task',
      status: 'RUNNING',
      dependsOn: [],
    };

    const mockActivity: JulesActivity = {
      id: 'act-1',
      taskId: 'task-1',
      timestamp: Date.now(),
      type: 'BASH_COMMAND',
      status: 'COMPLETED',
      metadata: {}
    };

    it('should fetch and cache activities when no cache exists ("set" logic)', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);

      const result = await service.getLiveActivitiesForActiveTasks();

      expect(mockDeps.getSubtasks).toHaveBeenCalledTimes(1);
      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledWith('session-1', PAGE_SIZE);
      expect(result).toEqual({ 'session-1': [mockActivity] });
    });

    it('should retrieve activities from cache without fetching again ("get" logic)', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);

      // First call fetches and sets cache
      await service.getLiveActivitiesForActiveTasks();

      // Clear mock calls to verify no new fetches
      mockDeps.getSubtasks.mockClear();
      mockDeps.fetchRecentActivities.mockClear();

      // Need to re-mock getSubtasks so it returns the tasks that trigger cache check
      mockDeps.getSubtasks.mockReturnValue([mockTask]);

      // Second call within TTL should return cached data
      const result2 = await service.getLiveActivitiesForActiveTasks();

      expect(mockDeps.getSubtasks).toHaveBeenCalledTimes(1);
      expect(mockDeps.fetchRecentActivities).not.toHaveBeenCalled();
      expect(result2).toEqual({ 'session-1': [mockActivity] });
    });

    it('should invalidate items after TTL expires', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);

      // First call to cache
      await service.getLiveActivitiesForActiveTasks();

      // Advance time past TTL
      vi.advanceTimersByTime(LIVE_CACHE_MS + 100);

      // Clear mock to see if it fetches again
      mockDeps.fetchRecentActivities.mockClear();

      // Change mocked return value to ensure we get fresh data
      const newActivity = { ...mockActivity, id: 'act-2' };
      mockDeps.fetchRecentActivities.mockResolvedValue([newActivity]);

      const result = await service.getLiveActivitiesForActiveTasks();

      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ 'session-1': [newActivity] });
    });

    it('should manually invalidate cache', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);

      await service.getLiveActivitiesForActiveTasks();

      // Manually invalidate
      service.invalidateLiveActivitiesCache();

      mockDeps.fetchRecentActivities.mockClear();

      // Should fetch again even though TTL hasn't passed
      await service.getLiveActivitiesForActiveTasks();

      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(1);
    });

    it('should partially reuse cache and only fetch missing/stale sessions', async () => {
      const mockTask2 = { ...mockTask, id: 'task-2' };
      const mockActivity2 = { ...mockActivity, id: 'act-2', taskId: 'task-2' };

      mockDeps.getSubtasks.mockReturnValue([mockTask, mockTask2]);
      mockDeps.resolveSessionNameFromTask.mockImplementation((t) => {
        if (t.id === 'task-1') return 'session-1';
        return 'session-2';
      });
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);

      // Populate session-1 cache
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      await service.getLiveActivitiesForActiveTasks();

      // Now both session-1 and session-2 are active, but session-1 is cached
      mockDeps.getSubtasks.mockReturnValue([mockTask, mockTask2]);
      mockDeps.fetchRecentActivities.mockClear();
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity2]);

      const result = await service.getLiveActivitiesForActiveTasks();

      // Should only fetch session-2
      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(1);
      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledWith('session-2', PAGE_SIZE);

      // Should combine both cached and new data
      expect(result).toEqual({
        'session-1': [mockActivity],
        'session-2': [mockActivity2],
      });
    });

    it('should return empty object if no active tasks', async () => {
      const inactiveTask = { ...mockTask, status: 'COMPLETED' as const };
      mockDeps.getSubtasks.mockReturnValue([inactiveTask]);

      const result = await service.getLiveActivitiesForActiveTasks();

      expect(result).toEqual({});
      expect(mockDeps.fetchRecentActivities).not.toHaveBeenCalled();
    });

    it('should skip fetching activities if a session is terminal', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      (mockDeps.isSessionTerminal as any).mockReturnValue(true);

      const result = await service.getLiveActivitiesForActiveTasks();

      expect(mockDeps.getSubtasks).toHaveBeenCalledTimes(1);
      expect(mockDeps.isSessionTerminal).toHaveBeenCalledWith('session-1');
      expect(mockDeps.fetchRecentActivities).not.toHaveBeenCalled();
      expect(result).toEqual({});
    });

    it('should handle fetch failures gracefully', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockRejectedValue(new Error('Fetch failed'));

      const result = await service.getLiveActivitiesForActiveTasks();

      expect(result).toEqual({ 'session-1': [] });
      expect(mockDeps.logger?.warn).toHaveBeenCalledWith(
        'Could not fetch live activities',
        { sessionName: 'session-1' }
      );
    });

    it('should reuse ongoing fetch promise if called concurrently', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');

      let resolveFetch: any;
      const fetchPromise = new Promise<JulesActivity[]>((resolve) => {
        resolveFetch = resolve;
      });
      mockDeps.fetchRecentActivities.mockReturnValue(fetchPromise);

      const promise1 = service.getLiveActivitiesForActiveTasks();
      const promise2 = service.getLiveActivitiesForActiveTasks();

      // Resolve the fetch after both are pending
      resolveFetch([mockActivity]);

      const [res1, res2] = await Promise.all([promise1, promise2]);

      // Should only fetch once
      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(1);
      // In the new implementation, each call returns a new object but with the same data
      expect(res1).toEqual(res2);
    });
  });

  describe('Git Status Cache', () => {
    it('should fetch git status for repo', async () => {
      const mockGitStatus: GitTrackingStatus = {
        branch: 'main',
        hasUncommittedChanges: false,
        stagedFiles: [],
        unstagedFiles: [],
        untrackedFiles: [],
      };
      mockDeps.fetchGitStatusForRepo.mockResolvedValue(mockGitStatus);

      const result = await service.getGitStatus();

      expect(mockDeps.resolveGitStatusRepoPath).toHaveBeenCalledTimes(1);
      expect(mockDeps.fetchGitStatusForRepo).toHaveBeenCalledWith('/test/repo', GIT_CACHE_MS);
      expect(result).toEqual(mockGitStatus);
    });

    it('should call invalidate dependency', () => {
      service.invalidateGitStatusCache();

      expect(mockDeps.resolveGitStatusRepoPath).toHaveBeenCalledTimes(1);
      expect(mockDeps.invalidateGitStatusCache).toHaveBeenCalledWith('/test/repo');
    });
  });
});
