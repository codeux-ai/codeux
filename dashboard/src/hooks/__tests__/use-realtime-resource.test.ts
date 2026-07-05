/* @vitest-environment happy-dom */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useRealtimeResource } from "../use-realtime-resource.js";
import { RealtimeResourceController } from "../use-realtime-resource.js";

describe("useRealtimeResource (Hook Integration)", () => {
  it("skips isEqual check if stabilizeNext returns prev reference", async () => {
    const mockData = { id: "1" };
    let fetchResolve: (val: any) => void;
    const fetchPromise = new Promise(resolve => { fetchResolve = resolve; });
    const mockFetch = vi.fn().mockReturnValue(fetchPromise);
    const mockIsEqual = vi.fn().mockReturnValue(true);
    const mockStabilizeNext = vi.fn().mockReturnValue(mockData);

    const { unmount } = renderHook(() => useRealtimeResource({
      initialData: mockData,
      fetchResource: mockFetch,
      isEqual: mockIsEqual,
      stabilizeNext: mockStabilizeNext
    }));

    await act(async () => {
      fetchResolve({ id: "1", newField: true });
    });

    expect(mockStabilizeNext).toHaveBeenCalled();
    expect(mockIsEqual).not.toHaveBeenCalled();
    unmount();
  });

  it("removes abort listeners and does not cache aborted promises", async () => {
    let rejectFetch: (val: any) => void;
    const fetchPromise = new Promise((_, reject) => { rejectFetch = reject; });
    const mockFetch = vi.fn().mockReturnValue(fetchPromise);

    const { result, unmount } = renderHook(() => useRealtimeResource({
      initialData: { id: "1" },
      fetchResource: mockFetch,
    }));

    const ac = new AbortController();
    let refetchPromise: Promise<void> | undefined;
    act(() => {
      refetchPromise = (result.current.refetch as any)({ silent: true, signal: ac.signal });
    });

    act(() => {
      ac.abort();
    });

    await act(async () => {
      const err = new Error("AbortError");
      err.name = "AbortError";
      rejectFetch(err);
    });

    // Subsequence silent refresh should fetch again because the aborted one wasn't cached
    act(() => {
      result.current.refetch({ silent: true });
    });

    // 1 initial, 1 aborted, 1 subsequent
    expect(mockFetch).toHaveBeenCalledTimes(3);

    unmount();
  });

  it("coalesces overlapping silent refreshes", () => {
    const fetchPromise = new Promise(() => {}); // never resolves to force overlap
    const mockFetch = vi.fn().mockReturnValue(fetchPromise);

    const { result, unmount } = renderHook(() => useRealtimeResource({
      initialData: { id: "1" },
      fetchResource: mockFetch,
    }));

    let pRefetch1: Promise<void> | undefined;
    let pRefetch2: Promise<void> | undefined;

    // Call refetch twice, should return the same promise
    act(() => {
      pRefetch1 = result.current.refetch({ silent: true });
      pRefetch2 = result.current.refetch({ silent: true });
    });

    expect(pRefetch1).toBeDefined();
    expect(pRefetch1).toBe(pRefetch2);

    unmount();
  });
});

describe("RealtimeResourceController", () => {
  it("batches direct event updates into one requestAnimationFrame", () => {
    let rafCb: FrameRequestCallback | null = null;
    const mockRaf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafCb = cb;
      return 1;
    });
    const mockClearRaf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const setData = vi.fn();
    const setError = vi.fn();
    const setLoading = vi.fn();
    const isDeepEqual = vi.fn();
    const refreshInternal = vi.fn();

    const controller = new RealtimeResourceController<any>(
      setData, setError, setLoading, isDeepEqual, refreshInternal
    );

    controller.scheduleDirectUpdate({ id: "1" });
    controller.scheduleDirectUpdate({ id: "2" });

    expect(mockRaf).toHaveBeenCalledTimes(1);

    // Simulate frame flush
    if (rafCb) {
      (rafCb as any)();
    }

    expect(setData).toHaveBeenCalledTimes(1);

    mockRaf.mockRestore();
    mockClearRaf.mockRestore();
  });

  it("clears timeouts and frames on cleanup", () => {
    const mockRaf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    const mockClearRaf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const mockSetTimeout = vi.spyOn(window, "setTimeout").mockReturnValue(2 as any);
    const mockClearTimeout = vi.spyOn(window, "clearTimeout").mockImplementation(() => {});

    const controller = new RealtimeResourceController<any>(
      vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()
    );

    controller.scheduleDirectUpdate({ id: "1" });
    controller.scheduleSilentRefresh();

    controller.cleanup();

    expect(mockClearRaf).toHaveBeenCalledWith(1);
    expect(mockClearTimeout).toHaveBeenCalledWith(2); // From scheduleDirectUpdate fallback
    expect(mockClearTimeout).toHaveBeenCalledWith(2); // From scheduleSilentRefresh

    mockRaf.mockRestore();
    mockClearRaf.mockRestore();
    mockSetTimeout.mockRestore();
    mockClearTimeout.mockRestore();
  });
});
