import { describe, expect, it, beforeEach } from "vitest";
import {
  resolveDashboardSettings,
  invalidateSettingsCache,
  buildDefaultSystemSettings,
  toProjectSettingsOverride,
} from "../../../src/services/settings-resolution-service.js";

describe("SettingsResolutionService Caching Layer", () => {
  beforeEach(() => {
    // Clear cache before each test
    invalidateSettingsCache();
  });

  const defaultSystemSettings = buildDefaultSystemSettings();

  it("should return the exact same object reference for identical inputs (cache hit)", () => {
    const result1 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
    });

    const result2 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
    });

    // Object identity should match
    expect(result1).toBe(result2);
    expect(result1.settings).toBe(result2.settings);
  });

  it("should return a different object reference for different project IDs", () => {
    const result1 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
    });

    const result2 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-2",
    });

    // Object identity should NOT match
    expect(result1).not.toBe(result2);
  });

  it("should invalidate the cache and return a new object reference", () => {
    const result1 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
    });

    // Invalidate the specific project cache
    invalidateSettingsCache("proj-1");

    const result2 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
    });

    // Object identity should NOT match after invalidation
    expect(result1).not.toBe(result2);
    // Structural equality should still match
    expect(result1).toEqual(result2);
  });

  it("should invalidate sprint cache when project cache is invalidated", () => {
    const result1 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
    });

    const resultSprint = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
      sprintId: "sprint-1",
    });

    invalidateSettingsCache("proj-1");

    const result2 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
    });

    const resultSprint2 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
      sprintId: "sprint-1",
    });

    expect(result1).not.toBe(result2);
    expect(resultSprint).not.toBe(resultSprint2);
  });

  it("should invalidate all cache when no arguments are provided", () => {
    const result1 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
    });

    const resultSprint = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
      sprintId: "sprint-1",
    });

    // Invalidate all
    invalidateSettingsCache();

    const result2 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
    });

    const resultSprint2 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1",
      sprintId: "sprint-1",
    });

    expect(result1).not.toBe(result2);
    expect(resultSprint).not.toBe(resultSprint2);
  });

  it("should keep cache size bounded to 1000 items", () => {
    // Generate 1005 unique cache entries
    for (let i = 0; i < 1005; i++) {
      resolveDashboardSettings({
        systemSettings: defaultSystemSettings,
        projectId: `proj-${i}`,
      });
    }

    // The first 5 should have been evicted (proj-0 to proj-4)
    // Wait, testing eviction means verifying if an evicted item is re-calculated.
    // If we request proj-0 again, it should return a new reference because it was evicted.
    // Let's first save the reference for proj-0 to prove it was cached.
    invalidateSettingsCache(); // start fresh

    const initialResult0 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-0",
    });

    const initialResult1000 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-1000",
    });

    // Generate 1000 more (proj-1 to proj-1000 already has 1000, wait we need to push > 1000 distinct)
    // total distinct requested: 0 and 1000. That's 2.
    // Request 1000 more unique project IDs.
    for (let i = 1; i <= 1000; i++) {
      resolveDashboardSettings({
        systemSettings: defaultSystemSettings,
        projectId: `test-loop-${i}`,
      });
    }

    // Now the cache has processed > 1000 distinct keys.
    // proj-0 was requested first, so it should be evicted.
    const secondResult0 = resolveDashboardSettings({
      systemSettings: defaultSystemSettings,
      projectId: "proj-0",
    });

    expect(initialResult0).not.toBe(secondResult0);
  });
});
