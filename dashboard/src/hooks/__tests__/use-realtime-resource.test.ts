/* @vitest-environment happy-dom */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useRealtimeResource } from "../use-realtime-resource.js";
import { RealtimeResourceController } from "../use-realtime-resource.js";

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

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
    const initialRequest = createDeferred<{ id: string }>();
    const abortedRequest = createDeferred<{ id: string }>();
    const nextSilentRequest = createDeferred<{ id: string }>();
    const mockFetch = vi.fn()
      .mockReturnValueOnce(initialRequest.promise)
      .mockReturnValueOnce(abortedRequest.promise)
      .mockReturnValueOnce(nextSilentRequest.promise);
    const initialData = { id: "1" };

    const { result, unmount } = renderHook(() => useRealtimeResource({
      initialData,
      fetchResource: mockFetch,
    }));

    await act(async () => {
      initialRequest.resolve({ id: "1" });
      await initialRequest.promise;
    });

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
      abortedRequest.reject(err);
      await refetchPromise;
    });

    // Subsequence silent refresh should fetch again because the aborted one wasn't cached
    act(() => {
      result.current.refetch({ silent: true });
    });

    // 1 initial, 1 aborted, 1 subsequent
    expect(mockFetch).toHaveBeenCalledTimes(3);

    await act(async () => {
      nextSilentRequest.resolve({ id: "1" });
      await nextSilentRequest.promise;
    });

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

  it("starts a fresh request after invalidating a resource with an in-flight silent fetch", async () => {
    const initialRequest = createDeferred<{ id: string }>();
    const staleSilentRequest = createDeferred<{ id: string }>();
    const freshProjectRequest = createDeferred<{ id: string }>();
    const followUpSilentRequest = createDeferred<{ id: string }>();

    const firstProjectFetch = vi.fn()
      .mockReturnValueOnce(initialRequest.promise)
      .mockReturnValueOnce(staleSilentRequest.promise);
    const nextProjectFetch = vi.fn()
      .mockReturnValueOnce(freshProjectRequest.promise)
      .mockReturnValueOnce(followUpSilentRequest.promise);

    let projectId = "p1";
    const initialDataByProject = {
      p1: { id: "p1:empty" },
      p2: { id: "p2:empty" },
    };
    const { result, rerender, unmount } = renderHook(() => useRealtimeResource({
      initialData: projectId === "p1" ? initialDataByProject.p1 : initialDataByProject.p2,
      fetchResource: projectId === "p1" ? firstProjectFetch : nextProjectFetch,
      isAlreadyLoaded: false,
    }));

    await act(async () => {
      initialRequest.resolve({ id: "p1:loaded" });
      await initialRequest.promise;
    });

    expect(result.current.data.id).toBe("p1:loaded");

    act(() => {
      void result.current.refetch({ silent: true });
    });

    expect(firstProjectFetch).toHaveBeenCalledTimes(2);
    const staleSilentSignal = firstProjectFetch.mock.calls[1][0] as AbortSignal;

    projectId = "p2";
    rerender();

    expect(staleSilentSignal.aborted).toBe(true);
    expect(result.current.data.id).toBe("p2:empty");
    expect(nextProjectFetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      freshProjectRequest.resolve({ id: "p2:loaded" });
      await freshProjectRequest.promise;
    });

    expect(result.current.data.id).toBe("p2:loaded");

    act(() => {
      void result.current.refetch({ silent: true });
    });

    expect(nextProjectFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      followUpSilentRequest.resolve({ id: "p2:fresh" });
      await followUpSilentRequest.promise;
    });

    expect(result.current.data.id).toBe("p2:fresh");

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
