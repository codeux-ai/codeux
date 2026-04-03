import { describe, it, expect } from "vitest";
import { normalizeProjectStatsQuery, startOfUtcDay } from "../../../../src/repositories/execution/project-stats-query.js";

describe("project-stats-query", () => {
  it("normalizes custom date range completely", () => {
    const dbMock = { prepare: () => ({ get: () => ({ first_started_at: "2023-01-01" }) }) } as any;
    const now = new Date("2023-12-31T00:00:00Z");
    const result = normalizeProjectStatsQuery(dbMock, "proj1", "all", now);
    expect(result.range.resolution).toBe("week");
  });

  it("handles empty and invalid custom date bounds", () => {
    const dbMock = {} as any;
    const now = new Date();
    expect(() => normalizeProjectStatsQuery(dbMock, "proj1", { window: "custom", from: "  ", to: "" }, now)).toThrow();
    expect(() => normalizeProjectStatsQuery(dbMock, "proj1", { window: "custom", from: "invalid", to: "2024-01-01" }, now)).toThrow();
  });

  it("handles reversed custom date bounds", () => {
    const dbMock = {} as any;
    const now = new Date();
    expect(() => normalizeProjectStatsQuery(dbMock, "proj1", { window: "custom", from: "2024-02-01", to: "2024-01-01" }, now)).toThrow();
  });

  it("uses hourly buckets for small spans", () => {
    const dbMock = { prepare: () => ({ get: () => ({ first_started_at: "2023-01-01T10:00:00Z" }) }) } as any;
    const now = new Date("2023-01-02T10:00:00Z"); // 24h span
    const result = normalizeProjectStatsQuery(dbMock, "proj1", "all", now);
    expect(result.range.resolution).toBe("hour");
  });

  it("builds daily buckets for medium spans", () => {
    const dbMock = { prepare: () => ({ get: () => ({ first_started_at: "2023-01-01T00:00:00Z" }) }) } as any;
    const now = new Date("2023-01-30T00:00:00Z"); // 30d span
    const result = normalizeProjectStatsQuery(dbMock, "proj1", "all", now);
    expect(result.range.resolution).toBe("day");
  });

  it("handles standard presets", () => {
    const dbMock = {} as any;
    const now = new Date("2023-01-30T10:15:00Z");

    const r24h = normalizeProjectStatsQuery(dbMock, "proj1", "24h", now);
    expect(r24h.range.resolution).toBe("hour");

    const r7d = normalizeProjectStatsQuery(dbMock, "proj1", "7d", now);
    expect(r7d.range.resolution).toBe("day");

    const r30d = normalizeProjectStatsQuery(dbMock, "proj1", "30d", now);
    expect(r30d.range.resolution).toBe("day");
  });
});
