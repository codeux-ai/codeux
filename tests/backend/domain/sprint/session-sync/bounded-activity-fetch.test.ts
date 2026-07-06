import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchActivitiesBounded } from "../../../../../src/domain/sprint/session-sync/bounded-activity-fetch.js";
import type { JulesActivity } from "../../../../../src/contracts/app-types.js";
import type { Logger } from "../../../../../src/shared/logging/logger.js";

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

    // fetchRecentActivities returning items that resolve out of order to ensure order is preserved by logic, not execution speed
    const mockFetch = vi.fn().mockImplementation(async (sessionName: string) => {
      const delay = sessionName === "session1" ? 30 : sessionName === "session2" ? 10 : 20;
      return new Promise((resolve) => setTimeout(() => resolve([{ id: `act_${sessionName}` }]), delay));
    });

    const result = await fetchActivitiesBounded(sessionNames, 2, 5, mockFetch, mockLogger);

    const keys = Array.from(result.keys());
    expect(keys).toEqual(["session1", "session2", "session3"]);

    expect(result.get("session1")).toEqual([{ id: "act_session1" }]);
    expect(result.get("session2")).toEqual([{ id: "act_session2" }]);
    expect(result.get("session3")).toEqual([{ id: "act_session3" }]);
  });

  it("bounds concurrency", async () => {
    const sessionNames = ["s1", "s2", "s3", "s4", "s5"];
    let currentConcurrency = 0;
    let maxConcurrency = 0;

    const mockFetch = vi.fn().mockImplementation(async () => {
      currentConcurrency++;
      maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
      await new Promise(resolve => setTimeout(resolve, 10));
      currentConcurrency--;
      return [];
    });

    await fetchActivitiesBounded(sessionNames, 2, 5, mockFetch, mockLogger);

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
      expect.objectContaining({
        sessionName: "s_fail",
        pageSize: 5,
        concurrency: 5,
        timeoutMs: 30_000,
        errorName: "Error",
        errorMessage: "Fetch failed",
      }),
    );
  });

  it("times out a slow provider activity API with fake timers", async () => {
    vi.useFakeTimers();

    const mockFetch = vi.fn(() => new Promise<JulesActivity[]>(() => {}));
    const resultPromise = fetchActivitiesBounded(["slow-session"], 1, 5, mockFetch, mockLogger, 2_500);

    await vi.advanceTimersByTimeAsync(2_499);
    expect(mockLogger.warn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;

    expect(result.get("slow-session")).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Could not fetch activities for session",
      expect.objectContaining({
        sessionName: "slow-session",
        pageSize: 5,
        concurrency: 1,
        timeoutMs: 2_500,
        elapsedMs: 2_500,
        errorName: "Error",
        errorMessage: "Timed out fetching activities for slow-session after 2500ms",
      }),
    );
  });

  it("handles provider rejection under fake timers without retrying or waiting", async () => {
    vi.useFakeTimers();

    const mockFetch = vi.fn().mockRejectedValue(new TypeError("provider rejected"));
    const result = await fetchActivitiesBounded(["rejected-session"], 1, 5, mockFetch, mockLogger, 1_000);

    expect(result.get("rejected-session")).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Could not fetch activities for session",
      expect.objectContaining({
        sessionName: "rejected-session",
        timeoutMs: 1_000,
        errorName: "TypeError",
        errorMessage: "provider rejected",
      }),
    );
  });

  it("preserves a real empty activity response under fake timers", async () => {
    vi.useFakeTimers();

    const mockFetch = vi.fn().mockResolvedValue([]);
    const result = await fetchActivitiesBounded(["empty-session"], 1, 5, mockFetch, mockLogger, 1_000);

    expect(result.get("empty-session")).toEqual([]);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("handles empty session list without error", async () => {
    const mockFetch = vi.fn();
    const result = await fetchActivitiesBounded([], 5, 5, mockFetch, mockLogger);

    expect(result.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
