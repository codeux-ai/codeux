import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProjectResourceStore } from "../../../dashboard/src/v2/hooks/project-resource-store.js";

// Mock global window functions used by the store
global.window = {
  setInterval: vi.fn().mockReturnValue(123),
  clearInterval: vi.fn(),
} as any;

vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => {
  return {
    subscribeToDashboardRealtime: vi.fn().mockImplementation(() => {
      return vi.fn(); // unsubscribe function
    }),
  };
});

describe("ProjectResourceStore", () => {
  let fetchCount = 0;
  let mockFetcher: any;
  let mockIsEqual: any;
  let store: ProjectResourceStore<string>;

  beforeEach(() => {
    fetchCount = 0;
    mockFetcher = vi.fn().mockImplementation(async (projectId: string, args: any) => {
      fetchCount++;
      // Return a simulated delay and distinct string
      await new Promise(resolve => setTimeout(resolve, 10));
      return `data-${projectId}-${args.keySuffix}-${fetchCount}`;
    });

    mockIsEqual = vi.fn().mockImplementation((current, next) => current === next);

    store = new ProjectResourceStore<string>({
      resourceType: "test",
      fetcher: mockFetcher,
      isEqual: mockIsEqual,
      emptyData: "empty",
      getRealtimeScopes: (projectId) => [`test:${projectId}`],
      shouldRefreshOnRealtimeEvent: () => true,
    });
  });

  it("deduplicates in-flight fetches for the same key", async () => {
    const p1 = store.fetch("proj-1", "suf-1", { keySuffix: "suf-1" });
    const p2 = store.fetch("proj-1", "suf-1", { keySuffix: "suf-1" });

    await Promise.all([p1, p2]);

    expect(fetchCount).toBe(1);
    expect(store.getCachedData("proj-1", "suf-1")).toBe("data-proj-1-suf-1-1");
  });

  it("fans out updates to multiple subscribers", async () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    const p1 = store.subscribe("proj-1", "suf-1", { keySuffix: "suf-1" }, cb1);
    const p2 = store.subscribe("proj-1", "suf-1", { keySuffix: "suf-1" }, cb2);

    // The first subscriber triggers the fetch, which sets isLoading = true and calls notifySubscribers.
    // However, when the second subscriber is added, the fetch is already in-flight.
    // The second subscriber does not trigger a new fetch, but because the entry is not yet "loaded",
    // it will register the callback and immediately be called with the current loading state.
    expect(cb1).toHaveBeenCalledWith("empty", null, true);
    expect(cb2).toHaveBeenCalledWith("empty", null, true);

    // Wait for fetch to complete
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(fetchCount).toBe(1);
    expect(cb1).toHaveBeenCalledWith("data-proj-1-suf-1-1", null, false);
    expect(cb2).toHaveBeenCalledWith("data-proj-1-suf-1-1", null, false);
  });

  it("skips subscriber updates when equality function returns true", async () => {
    mockIsEqual.mockReturnValue(true);

    const cb1 = vi.fn();
    store.subscribe("proj-1", "suf-1", { keySuffix: "suf-1" }, cb1);

    await new Promise(resolve => setTimeout(resolve, 20));

    // After fetch completes, but isEqual returned true, data remains "empty"
    // So final callback state should reflect that.
    expect(cb1).toHaveBeenLastCalledWith("empty", null, false);
  });

  it("handles cache invalidation and transparent background refresh", async () => {
    const cb1 = vi.fn();
    store.subscribe("proj-1", "suf-1", { keySuffix: "suf-1" }, cb1);

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(fetchCount).toBe(1);
    expect(cb1).toHaveBeenCalledWith("data-proj-1-suf-1-1", null, false);

    // Now invalidation refresh (silent fetch)
    await store.fetch("proj-1", "suf-1", { keySuffix: "suf-1" }, { silent: true });

    expect(fetchCount).toBe(2);
    // Silent fetch means isLoading remains false
    expect(cb1).toHaveBeenLastCalledWith("data-proj-1-suf-1-2", null, false);
  });
});
