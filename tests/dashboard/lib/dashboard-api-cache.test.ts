import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchLivePayload,
  getCachedLivePayload,
  clearLivePayloadCacheForTests,
  invalidateLivePayloadCache,
} from "../../../dashboard/src/lib/api/dashboard-api.js";
import * as fetchJsonModule from "../../../dashboard/src/lib/api/fetch-json.js";

describe("Dashboard API Cache", () => {
  beforeEach(() => {
    clearLivePayloadCacheForTests();
    vi.spyOn(fetchJsonModule, "fetchJson").mockImplementation(async (url) => {
      const projectId = url.includes("projectId=p") ? url.split("projectId=")[1] : "default";
      return {
        projectId,
        selectedSprintId: projectId === "p1" ? "s1" : null,
        status: { project_id: projectId, subtasks: [], timestamp: null },
        execution: { projectId },
      } as any;
    });
  });

  it("should cache live payload and deduplicate inflight requests", async () => {
    const req1 = fetchLivePayload("p1");
    const req2 = fetchLivePayload("p1");

    // Inflight promises might be wrapped or identical, deduplication is verified by network call count below

    const res1 = await req1;
    const res2 = await req2;
    expect(res1).toBe(res2);
    expect(fetchJsonModule.fetchJson).toHaveBeenCalledTimes(1);

    const cached = getCachedLivePayload("p1");
    expect(cached?.projectId).toBe("p1");
    expect(cached?.selectedSprintId).toBe("s1");
  });

  it("should use project cache fallback when no sprint scope is known", async () => {
    await fetchLivePayload("p1");

    expect(getCachedLivePayload("p1")?.selectedSprintId).toBe("s1");
  });

  it("should miss project cache entries when the requested sprint scope differs", async () => {
    await fetchLivePayload("p1");

    expect(getCachedLivePayload("p1", { selectedSprintId: "s1" })?.projectId).toBe("p1");
    expect(getCachedLivePayload("p1", { selectedSprintId: "s2" })).toBeNull();
  });

  it("should evict oldest entry when bounded LRU limit is exceeded", async () => {
    // MAX_CACHE_SIZE is 5
    await fetchLivePayload("p1");
    await fetchLivePayload("p2");
    await fetchLivePayload("p3");
    await fetchLivePayload("p4");
    await fetchLivePayload("p5");

    expect(getCachedLivePayload("p1")).not.toBeNull();

    await fetchLivePayload("p6");

    // Because p1 was accessed recently, p2 should be evicted (LRU behavior)
    expect(getCachedLivePayload("p2")).toBeNull();
    expect(getCachedLivePayload("p1")).not.toBeNull();
    expect(getCachedLivePayload("p6")).not.toBeNull();
  });

  it("should allow targeted invalidation", async () => {
    await fetchLivePayload("p1");
    await fetchLivePayload("p2");

    expect(getCachedLivePayload("p1")).not.toBeNull();
    invalidateLivePayloadCache("p1");
    expect(getCachedLivePayload("p1")).toBeNull();
    expect(getCachedLivePayload("p2")).not.toBeNull();
  });

  it("should support clearLivePayloadCacheForTests", async () => {
    await fetchLivePayload("p1");
    clearLivePayloadCacheForTests();
    expect(getCachedLivePayload("p1")).toBeNull();
  });
});
