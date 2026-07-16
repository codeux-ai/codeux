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

    service = new ActivityCacheService(mockDeps, LIVE_CACHE_MS, GIT_CACHE_MS, PAGE_SIZE, 3, 2000);
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

    const expectWarnMetadata = (message: string) => {
      const warn = vi.mocked(mockDeps.logger?.warn);
      expect(warn).toHaveBeenCalledWith(message, expect.any(Object));
      return warn?.mock.calls.find((call) => call[0] === message)?.[1] as Record<string, unknown>;
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

    it('evicts inactive sessions and bounds oversized live activity previews', async () => {
      const oversizedActivity = {
        ...mockActivity,
        description: `${'a'.repeat(70_000)}TAIL`,
      };
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockResolvedValue([oversizedActivity]);

      const first = await service.getLiveActivitiesForActiveTasks();
      expect(first['session-1'][0].description).toHaveLength(64 * 1024);
      expect(first['session-1'][0].description).toContain('[activity preview truncated]');
      expect(first['session-1'][0].description?.endsWith('TAIL')).toBe(true);

      const secondTask = { ...mockTask, id: 'task-2' };
      mockDeps.getSubtasks.mockReturnValue([secondTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-2');
      mockDeps.fetchRecentActivities.mockResolvedValue([{ ...mockActivity, id: 'act-2' }]);
      await service.getLiveActivitiesForActiveTasks();

      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockClear();
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);
      await service.getLiveActivitiesForActiveTasks();

      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledWith('session-1', PAGE_SIZE);
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

    it('should skip terminal sessions even when stale activities are cached', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      (mockDeps.isSessionTerminal as any).mockReturnValue(false);
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);

      await service.getLiveActivitiesForActiveTasks();

      mockDeps.fetchRecentActivities.mockClear();
      (mockDeps.isSessionTerminal as any).mockReturnValue(true);

      const result = await service.getLiveActivitiesForActiveTasks();

      expect(mockDeps.isSessionTerminal).toHaveBeenCalledWith('session-1');
      expect(mockDeps.fetchRecentActivities).not.toHaveBeenCalled();
      expect(result).toEqual({});
    });

    it('should filter terminal sessions while fetching active non-terminal sessions', async () => {
      const mockTask2 = { ...mockTask, id: 'task-2' };
      mockDeps.getSubtasks.mockReturnValue([mockTask, mockTask2]);
      mockDeps.resolveSessionNameFromTask.mockImplementation((task) => {
        return task.id === 'task-1' ? 'session-terminal' : 'session-active';
      });
      (mockDeps.isSessionTerminal as any).mockImplementation((sessionName: string) => {
        return sessionName === 'session-terminal';
      });
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);

      const result = await service.getLiveActivitiesForActiveTasks();

      expect(mockDeps.isSessionTerminal).toHaveBeenCalledWith('session-terminal');
      expect(mockDeps.isSessionTerminal).toHaveBeenCalledWith('session-active');
      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(1);
      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledWith('session-active', PAGE_SIZE);
      expect(result).toEqual({ 'session-active': [mockActivity] });
    });

    it('should handle fetch failures gracefully', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockRejectedValue(new Error('Fetch failed'));

      const result = await service.getLiveActivitiesForActiveTasks();

      expect(result).toEqual({ 'session-1': [] });
      const metadata = expectWarnMetadata('Could not fetch live activities');
      expect(metadata).toEqual({
        sessionName: 'session-1',
        failureCause: 'error',
        errorName: 'Error',
        errorMessage: 'Fetch failed',
        cacheFallbackState: 'empty',
        cachedActivityCount: 0,
      });
    });

    it('should return stale cached activities when a refresh times out through the shared fetch helper', async () => {
      service = new ActivityCacheService(mockDeps, LIVE_CACHE_MS, GIT_CACHE_MS, PAGE_SIZE, 3, 2000, 25);
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);

      await service.getLiveActivitiesForActiveTasks();

      vi.advanceTimersByTime(LIVE_CACHE_MS + 100);
      mockDeps.fetchRecentActivities.mockClear();
      mockDeps.fetchRecentActivities.mockReturnValue(new Promise<JulesActivity[]>(() => {}));

      const resultPromise = service.getLiveActivitiesForActiveTasks();
      await vi.advanceTimersByTimeAsync(25);
      const result = await resultPromise;

      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ 'session-1': [mockActivity] });
      const metadata = expectWarnMetadata('Could not fetch live activities; returning stale cached activities');
      expect(metadata).toEqual({
        sessionName: 'session-1',
        failureCause: 'timeout',
        errorName: 'ActivityFetchTimeoutError',
        errorMessage: 'Timed out fetching live activities for session-1 after 25ms',
        cacheFallbackState: 'stale',
        cachedActivityCount: 1,
        timeoutMs: 25,
      });
      expect(JSON.stringify(metadata)).not.toContain('BASH_COMMAND');
    });

    it('should return stale cached activities when a refresh fails', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);

      await service.getLiveActivitiesForActiveTasks();

      vi.advanceTimersByTime(LIVE_CACHE_MS + 100);
      mockDeps.fetchRecentActivities.mockRejectedValue(new Error('Fetch failed'));

      const result = await service.getLiveActivitiesForActiveTasks();

      expect(result).toEqual({ 'session-1': [mockActivity] });
      const metadata = expectWarnMetadata('Could not fetch live activities; returning stale cached activities');
      expect(metadata).toEqual({
        sessionName: 'session-1',
        failureCause: 'error',
        errorName: 'Error',
        errorMessage: 'Fetch failed',
        cacheFallbackState: 'stale',
        cachedActivityCount: 1,
      });
    });

    it('should preserve stale cached activities across repeated refresh failures', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);

      await service.getLiveActivitiesForActiveTasks();

      vi.advanceTimersByTime(LIVE_CACHE_MS + 100);
      mockDeps.fetchRecentActivities.mockRejectedValue(new Error('provider rejected'));

      const firstFallback = await service.getLiveActivitiesForActiveTasks();
      const secondFallback = await service.getLiveActivitiesForActiveTasks();

      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(3);
      expect(firstFallback).toEqual({ 'session-1': [mockActivity] });
      expect(secondFallback).toEqual({ 'session-1': [mockActivity] });

      const warn = vi.mocked(mockDeps.logger?.warn);
      expect(warn).toHaveBeenCalledTimes(2);
      for (const [, metadata] of warn?.mock.calls ?? []) {
        expect(metadata).toMatchObject({
          sessionName: 'session-1',
          failureCause: 'error',
          errorName: 'Error',
          errorMessage: 'provider rejected',
          cacheFallbackState: 'stale',
          cachedActivityCount: 1,
        });
        expect(JSON.stringify(metadata)).not.toContain('BASH_COMMAND');
      }
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
      expect(res1).toBe(res2); // Should be the exact same object reference
    });

    it('should reuse one deduped fetch for concurrent callers', async () => {
      const mockTask2 = { ...mockTask, id: 'task-2' };
      mockDeps.getSubtasks.mockReturnValue([mockTask, mockTask2]);
      mockDeps.resolveSessionNameFromTask.mockImplementation((task) => {
        return task.id === 'task-1' ? 'session-1' : 'session-2';
      });

      let resolveFetch: ((activities: JulesActivity[]) => void) | undefined;
      const fetchPromise = new Promise<JulesActivity[]>((resolve) => {
        resolveFetch = resolve;
      });
      mockDeps.fetchRecentActivities.mockReturnValue(fetchPromise);

      const promise1 = service.getLiveActivitiesForActiveTasks();
      const promise2 = service.getLiveActivitiesForActiveTasks();

      resolveFetch?.([mockActivity]);
      const [res1, res2] = await Promise.all([promise1, promise2]);

      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(2);
      expect(mockDeps.getSubtasks).toHaveBeenCalledTimes(1);
      expect(res1).toBe(res2);
      expect(res1).toEqual({
        'session-1': [mockActivity],
        'session-2': [mockActivity],
      });
    });

    it('should preserve session ordering when concurrent missing-session fetches resolve out of order', async () => {
      const mockTask2 = { ...mockTask, id: 'task-2' };
      const mockTask3 = { ...mockTask, id: 'task-3' };
      const activity1 = { ...mockActivity, id: 'act-1', taskId: 'task-1' };
      const activity2 = { ...mockActivity, id: 'act-2', taskId: 'task-2' };
      const activity3 = { ...mockActivity, id: 'act-3', taskId: 'task-3' };
      const fetchResolutions = new Map<string, (activities: JulesActivity[]) => void>();

      service = new ActivityCacheService(mockDeps, LIVE_CACHE_MS, GIT_CACHE_MS, PAGE_SIZE, 2, 2000);
      mockDeps.getSubtasks.mockReturnValue([mockTask, mockTask2, mockTask3]);
      mockDeps.resolveSessionNameFromTask.mockImplementation((task) => `session-${task.id.slice(-1)}`);
      mockDeps.fetchRecentActivities.mockImplementation((sessionName) => {
        return new Promise<JulesActivity[]>((resolve) => {
          fetchResolutions.set(sessionName, resolve);
        });
      });

      const resultPromise = service.getLiveActivitiesForActiveTasks();
      await vi.waitFor(() => {
        expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(2);
      });

      fetchResolutions.get('session-2')?.([activity2]);
      await vi.waitFor(() => {
        expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(3);
      });

      fetchResolutions.get('session-3')?.([activity3]);
      fetchResolutions.get('session-1')?.([activity1]);

      const result = await resultPromise;

      expect(Object.keys(result)).toEqual(['session-1', 'session-2', 'session-3']);
      expect(result).toEqual({
        'session-1': [activity1],
        'session-2': [activity2],
        'session-3': [activity3],
      });
    });

    it('should cache genuinely empty activity results only until the negative TTL expires', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockResolvedValue([]);

      // First call returns no activities, should cache as negative
      await service.getLiveActivitiesForActiveTasks();
      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(1);

      mockDeps.fetchRecentActivities.mockClear();

      // Second call immediately after should hit negative cache
      const result2 = await service.getLiveActivitiesForActiveTasks();
      expect(mockDeps.fetchRecentActivities).not.toHaveBeenCalled();
      expect(result2).toEqual({ 'session-1': [] });

      vi.advanceTimersByTime(1999);

      const result3 = await service.getLiveActivitiesForActiveTasks();
      expect(mockDeps.fetchRecentActivities).not.toHaveBeenCalled();
      expect(result3).toEqual({ 'session-1': [] });

      // Advance time past negative TTL (2000ms)
      vi.advanceTimersByTime(1);

      // Third call should fetch again
      mockDeps.fetchRecentActivities.mockResolvedValue([mockActivity]);
      const result4 = await service.getLiveActivitiesForActiveTasks();
      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(1);
      expect(result4).toEqual({ 'session-1': [mockActivity] });
    });

    it('should not negative-cache provider failures', async () => {
      mockDeps.getSubtasks.mockReturnValue([mockTask]);
      mockDeps.resolveSessionNameFromTask.mockReturnValue('session-1');
      mockDeps.fetchRecentActivities.mockRejectedValue(new Error('Fetch failed'));

      await service.getLiveActivitiesForActiveTasks();
      await service.getLiveActivitiesForActiveTasks();

      expect(mockDeps.fetchRecentActivities).toHaveBeenCalledTimes(2);
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
