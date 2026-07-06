import { afterEach, describe, it, expect, vi } from "vitest";
import { waitUntil } from "../../../../src/shared/polling/wait-until.js";

describe("waitUntil", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve when predicate is met without depending on wall-clock time", async () => {
    vi.useFakeTimers();
    let count = 0;
    const action = async () => {
      count++;
      return count;
    };
    const predicate = (val: number) => val === 3;

    const resultPromise = waitUntil({
      action,
      predicate,
      intervalMs: 10,
      timeoutMs: 100,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result).toBe(3);
    expect(count).toBe(3);
  });

  it("should timeout if predicate is never met", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const action = async () => {
      attempts++;
      if (attempts === 2) {
        vi.setSystemTime(Date.now() + 51);
      }
      return "pending";
    };
    const predicate = (val: string) => val === "done";

    const resultPromise = waitUntil({
      action,
      predicate,
      intervalMs: 10,
      timeoutMs: 50,
      description: "test condition",
    });
    const expectation = expect(resultPromise).rejects.toThrow("Timeout waiting for test condition after 50ms");

    await vi.advanceTimersByTimeAsync(10);

    await expectation;
    expect(attempts).toBe(2);
  });

  it("should support AbortSignal", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const action = async () => "pending";
    const predicate = () => false;

    setTimeout(() => controller.abort(), 25);

    const resultPromise = waitUntil({
      action,
      predicate,
      intervalMs: 10,
      timeoutMs: 100,
      signal: controller.signal,
      description: "aborted task",
    });
    const expectation = expect(resultPromise).rejects.toThrow("Wait for aborted task aborted");

    await vi.advanceTimersByTimeAsync(25);

    await expectation;
  });

  it("should call onTimeout when timing out", async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let attempts = 0;
    const action = async () => {
      attempts++;
      if (attempts === 2) {
        vi.setSystemTime(Date.now() + 51);
      }
      return "pending";
    };
    const predicate = () => false;

    const resultPromise = waitUntil({
      action,
      predicate,
      intervalMs: 10,
      timeoutMs: 50,
      onTimeout,
    });
    const expectation = expect(resultPromise).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(10);

    await expectation;

    expect(onTimeout).toHaveBeenCalled();
  });

  it("should handle async predicates", async () => {
    vi.useFakeTimers();
    const action = async () => "done";
    const predicate = async (val: string) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return val === "done";
    };

    const resultPromise = waitUntil({
      action,
      predicate,
      intervalMs: 10,
      timeoutMs: 100,
    });

    await vi.advanceTimersByTimeAsync(5);

    const result = await resultPromise;
    expect(result).toBe("done");
  });
});
