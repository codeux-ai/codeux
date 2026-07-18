import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mapBoundedOrdered,
  withAbortableActivityFetchTimeout,
} from "../../../../../src/domain/sprint/session-sync/activity-fetch-utils.js";

describe("activity fetch utilities", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves input order while bounding concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await mapBoundedOrdered({
      items: [30, 10, 20, 5],
      concurrency: 2,
      mapper: async (delay, index) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, delay));
        active -= 1;
        return index;
      },
    });

    expect(result).toEqual([0, 1, 2, 3]);
    expect(maxActive).toBe(2);
  });

  it("does not invoke the mapper for an empty input", async () => {
    const mapper = vi.fn();
    await expect(mapBoundedOrdered({ items: [], concurrency: 3, mapper })).resolves.toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it("aborts the underlying fetch when the total deadline expires", async () => {
    vi.useFakeTimers();
    let observedAbort = false;
    const fetch = vi.fn((signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        observedAbort = true;
        reject(signal.reason);
      }, { once: true });
    }));
    const timeoutError = new Error("activity fetch timed out");
    timeoutError.name = "ActivityFetchTimeoutError";

    const result = withAbortableActivityFetchTimeout(fetch, {
      timeoutMs: 2_500,
      createTimeoutError: () => timeoutError,
    });
    const assertion = expect(result).rejects.toBe(timeoutError);
    await vi.advanceTimersByTimeAsync(2_500);

    await assertion;
    expect(observedAbort).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes a non-positive deadline through without scheduling a timeout", async () => {
    vi.useFakeTimers();
    const result = withAbortableActivityFetchTimeout(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("done"), 5_000)),
      {
        timeoutMs: 0,
        createTimeoutError: () => new Error("should not timeout"),
      },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toBe("done");
  });
});
