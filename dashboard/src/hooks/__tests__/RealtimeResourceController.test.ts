// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RealtimeResourceController } from "../use-realtime-resource.js";

describe("RealtimeResourceController", () => {
  const installWindow = (overrides: Partial<Window> = {}) => {
    globalThis.window = {
      requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16)),
      cancelAnimationFrame: vi.fn((id: number) => clearTimeout(id)),
      setTimeout: setTimeout as any,
      clearTimeout: clearTimeout as any,
      ...overrides,
    } as any;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as any).window;
  });

  it("coalesces burst direct updates into a single render within one animation frame", () => {
    let finalData: any = null;
    let loadingData: boolean = true;
    let errorData: any = "error";

    const setData = vi.fn((updater) => { finalData = updater(null); });
    const setError = vi.fn((e) => { errorData = e; });
    const setLoading = vi.fn((updater) => { loadingData = updater(loadingData); });
    const refreshInternal = vi.fn();

    installWindow();

    const controller = new RealtimeResourceController<any>(setData, setError, setLoading, (a,b)=>false, refreshInternal, undefined, undefined);

    controller.scheduleDirectUpdate({ value: 1 });
    controller.scheduleDirectUpdate({ value: 2 });
    controller.scheduleDirectUpdate({ value: 5 });

    expect(setData).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);

    expect(setData).toHaveBeenCalledTimes(1);
    expect(finalData).toEqual({ value: 5 });
    expect(errorData).toBeNull();
    expect(loadingData).toBe(false);
  });

  it("deduplicates silent refetches from repeated snapshot_required messages", () => {
    const setData = vi.fn();
    const setError = vi.fn();
    const setLoading = vi.fn();
    const refreshInternal = vi.fn();

    installWindow();

    const controller = new RealtimeResourceController<any>(setData, setError, setLoading, (a,b)=>false, refreshInternal, undefined, undefined);

    controller.scheduleSilentRefresh();
    controller.scheduleSilentRefresh();
    controller.scheduleSilentRefresh();

    expect(refreshInternal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);

    expect(refreshInternal).toHaveBeenCalledTimes(1);
    expect(refreshInternal).toHaveBeenCalledWith({ silent: true });
  });

  it("marks each direct update so stale REST responses can be suppressed", () => {
    installWindow();

    const markDirectUpdate = vi.fn();
    const controller = new RealtimeResourceController<any>(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      (a, b) => a === b,
      vi.fn(),
      undefined,
      undefined,
      markDirectUpdate
    );

    controller.scheduleDirectUpdate({ value: 1 });
    controller.scheduleDirectUpdate({ value: 2 });
    controller.scheduleDirectUpdate({ value: 3 });

    expect(markDirectUpdate).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(16);
  });

  it("cancels pending silent refresh when a direct update supersedes it", () => {
    installWindow();

    const refreshInternal = vi.fn();
    const controller = new RealtimeResourceController<any>(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      (a, b) => a === b,
      refreshInternal
    );

    controller.scheduleSilentRefresh();
    controller.scheduleSilentRefresh();
    controller.scheduleDirectUpdate({ value: "direct" });

    vi.advanceTimersByTime(150);

    expect(refreshInternal).not.toHaveBeenCalled();
  });

  it("allows an explicit refresh to supersede a pending silent refresh", () => {
    installWindow();

    const refreshInternal = vi.fn();
    const controller = new RealtimeResourceController<any>(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      (a, b) => a === b,
      refreshInternal
    );

    controller.scheduleSilentRefresh();
    controller.cancelSilentRefresh();
    void controller.refreshInternal({ silent: false });

    vi.advanceTimersByTime(150);

    expect(refreshInternal).toHaveBeenCalledTimes(1);
    expect(refreshInternal).toHaveBeenCalledWith({ silent: false });
  });

  it("aborts in-flight requests and clears frame, direct timeout, and refresh timers on cleanup", () => {
    const requestAnimationFrame = vi.fn(() => 10);
    const cancelAnimationFrame = vi.fn();
    let timeoutId = 20;
    const setTimeoutMock = vi.fn(() => timeoutId++);
    const clearTimeoutMock = vi.fn();
    installWindow({
      requestAnimationFrame: requestAnimationFrame as any,
      cancelAnimationFrame: cancelAnimationFrame as any,
      setTimeout: setTimeoutMock as any,
      clearTimeout: clearTimeoutMock as any,
    });

    const abortInFlight = vi.fn();
    const controller = new RealtimeResourceController<any>(
      vi.fn(),
      vi.fn(),
      vi.fn(),
      (a, b) => a === b,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      abortInFlight
    );

    controller.scheduleDirectUpdate({ value: "direct" });
    controller.scheduleSilentRefresh();
    controller.cleanup();

    expect(abortInFlight).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(10);
    expect(clearTimeoutMock).toHaveBeenCalledWith(20);
    expect(clearTimeoutMock).toHaveBeenCalledWith(21);
  });
});
