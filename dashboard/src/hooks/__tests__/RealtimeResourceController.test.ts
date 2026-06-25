// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RealtimeResourceController } from "../use-realtime-resource.js";

describe("RealtimeResourceController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces burst direct updates into a single render within one animation frame", () => {
    let finalData: any = null;
    let loadingData: boolean = true;
    let errorData: any = "error";

    const setData = vi.fn((updater) => { finalData = updater(null); });
    const setError = vi.fn((e) => { errorData = e; });
    const setLoading = vi.fn((updater) => { loadingData = updater(loadingData); });
    const refreshInternal = vi.fn();

    // Simulate window API in node environment for the controller
    globalThis.window = {
      requestAnimationFrame: vi.fn((cb: any) => setTimeout(cb, 16)),
      cancelAnimationFrame: vi.fn((id: any) => clearTimeout(id)),
      setTimeout: setTimeout as any,
      clearTimeout: clearTimeout as any,
    } as any;

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

    delete (globalThis as any).window;
  });

  it("deduplicates silent refetches from repeated snapshot_required messages", () => {
    const setData = vi.fn();
    const setError = vi.fn();
    const setLoading = vi.fn();
    const refreshInternal = vi.fn();

    globalThis.window = {
      setTimeout: setTimeout as any,
      clearTimeout: clearTimeout as any,
    } as any;

    const controller = new RealtimeResourceController<any>(setData, setError, setLoading, (a,b)=>false, refreshInternal, undefined, undefined);

    controller.scheduleSilentRefresh();
    controller.scheduleSilentRefresh();
    controller.scheduleSilentRefresh();

    expect(refreshInternal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(150);

    expect(refreshInternal).toHaveBeenCalledTimes(1);
    expect(refreshInternal).toHaveBeenCalledWith({ silent: true });

    delete (globalThis as any).window;
  });
});
