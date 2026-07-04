import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchActivitiesBounded } from "../../../../../src/domain/sprint/session-sync/bounded-activity-fetch.js";
import type { JulesActivity } from "../../../../../src/contracts/app-types.js";
import type { Logger } from "../../../../../src/shared/logging/logger.js";

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("fetchActivitiesBounded", () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    } as unknown as Logger;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches activities preserving input array order", async () => {
    const sessionNames = ["session1", "session2", "session3"];
    const pending = new Map<string, ReturnType<typeof createDeferred<JulesActivity[]>>>();

    const mockFetch = vi.fn().mockImplementation(async (sessionName: string) => {
      const deferred = createDeferred<JulesActivity[]>();
      pending.set(sessionName, deferred);
      return deferred.promise;
    });

    const resultPromise = fetchActivitiesBounded(sessionNames, 2, 5, mockFetch, mockLogger);
    await flushMicrotasks();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    pending.get("session2")?.resolve([{ id: "act_session2" }]);
    await flushMicrotasks();
    expect(mockFetch).toHaveBeenCalledTimes(3);

    pending.get("session3")?.resolve([{ id: "act_session3" }]);
    pending.get("session1")?.resolve([{ id: "act_session1" }]);

    const result = await resultPromise;

    const keys = Array.from(result.keys());
    expect(keys).toEqual(["session1", "session2", "session3"]);

    expect(result.get("session1")).toEqual([{ id: "act_session1" }]);
    expect(result.get("session2")).toEqual([{ id: "act_session2" }]);
    expect(result.get("session3")).toEqual([{ id: "act_session3" }]);
  });

  it("bounds concurrency", async () => {
    const sessionNames = ["s1", "s2", "s3", "s4", "s5"];
    const pending = new Map<string, ReturnType<typeof createDeferred<JulesActivity[]>>>();
    let currentConcurrency = 0;
    let maxConcurrency = 0;

    const mockFetch = vi.fn().mockImplementation(async (sessionName: string) => {
      currentConcurrency++;
      maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
      const deferred = createDeferred<JulesActivity[]>();
      pending.set(sessionName, deferred);
      await deferred.promise;
      currentConcurrency--;
      return [];
    });

    const resultPromise = fetchActivitiesBounded(sessionNames, 2, 5, mockFetch, mockLogger);
    await flushMicrotasks();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    pending.get("s1")?.resolve([]);
    await flushMicrotasks();
    expect(mockFetch).toHaveBeenCalledTimes(3);

    pending.get("s2")?.resolve([]);
    pending.get("s3")?.resolve([]);
    await flushMicrotasks();
    expect(mockFetch).toHaveBeenCalledTimes(5);

    pending.get("s4")?.resolve([]);
    pending.get("s5")?.resolve([]);
    await resultPromise;

    expect(maxConcurrency).toBeLessThanOrEqual(2);
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it("isolates failures and returns an empty array for failed fetches while logging a warning", async () => {
    const sessionNames = ["s1", "s_fail", "s3"];

    const mockFetch = vi.fn().mockImplementation(async (sessionName: string) => {
      if (sessionName === "s_fail") {
        throw new Error("Fetch failed");
      }
      return [{ id: `act_${sessionName}` }];
    });

    const result = await fetchActivitiesBounded(sessionNames, 5, 5, mockFetch, mockLogger);

    expect(result.get("s1")).toEqual([{ id: "act_s1" }]);
    expect(result.get("s_fail")).toEqual([]);
    expect(result.get("s3")).toEqual([{ id: "act_s3" }]);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Could not fetch activities for session",
      expect.objectContaining({ sessionName: "s_fail", fetchPhase: "session_sync_activity_fetch" }),
    );
  });

  it("returns an empty list and logs timeout details for a timed-out session without blocking later sessions", async () => {
    vi.useFakeTimers();

    const sessionNames = ["slow", "fast", "after"];
    const pendingSlow = createDeferred<JulesActivity[]>();

    const mockFetch = vi.fn().mockImplementation(async (sessionName: string) => {
      if (sessionName === "slow") {
        return pendingSlow.promise;
      }
      return [{ id: `act_${sessionName}` }];
    });

    const resultPromise = fetchActivitiesBounded(sessionNames, 2, 5, mockFetch, mockLogger, {
      timeoutMs: 25,
      fetchPhase: "test_phase",
    });

    await flushMicrotasks();
    expect(mockFetch).toHaveBeenCalledWith("slow", 5);
    expect(mockFetch).toHaveBeenCalledWith("fast", 5);
    expect(mockFetch).toHaveBeenCalledWith("after", 5);

    await vi.advanceTimersByTimeAsync(25);
    const result = await resultPromise;

    expect(Array.from(result.keys())).toEqual(["slow", "fast", "after"]);
    expect(result.get("slow")).toEqual([]);
    expect(result.get("fast")).toEqual([{ id: "act_fast" }]);
    expect(result.get("after")).toEqual([{ id: "act_after" }]);
    expect(mockLogger.warn).toHaveBeenCalledWith("Timed out fetching activities for session", {
      sessionName: "slow",
      timeoutMs: 25,
      fetchPhase: "test_phase",
    });
  });

  it("handles empty session list without error", async () => {
    const mockFetch = vi.fn();
    const result = await fetchActivitiesBounded([], 5, 5, mockFetch, mockLogger);

    expect(result.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
