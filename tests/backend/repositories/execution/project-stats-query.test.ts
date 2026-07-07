import { describe, it, expect } from "vitest";
import { normalizeProjectStatsQuery, startOfHour, startOfUtcDay } from "../../../../src/repositories/execution/project-stats-query.js";

describe("project-stats-query", () => {
  it("normalizes custom date range completely", () => {
    const dbMock = { prepare: () => ({ get: () => ({ first_started_at: "2023-01-01" }) }) } as any;
    const now = new Date("2023-12-31T00:00:00Z");
    const result = normalizeProjectStatsQuery(dbMock, "proj1", "all", now);
    expect(result.range.resolution).toBe("week");
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

  it("throws on invalid custom ranges", () => {
    const dbMock = {} as any;
    const now = new Date("2023-01-30T10:15:00Z");

    expect(() => normalizeProjectStatsQuery(dbMock, "proj1", { window: "custom" }, now)).toThrow(/Missing or invalid required fields/);
    expect(() => normalizeProjectStatsQuery(dbMock, "proj1", { window: "custom", from: "invalid" }, now)).toThrow(/Missing or invalid required fields/);
    expect(() => normalizeProjectStatsQuery(dbMock, "proj1", { window: "custom", from: "2023-01-02", to: "2023-01-01" }, now)).toThrow(/Invalid custom stats window: start must be earlier/);
    expect(() => normalizeProjectStatsQuery(dbMock, "proj1", { window: "custom", from: "1999-01-01", to: "2023-01-01" }, now)).toThrow(/Invalid custom stats window: from date is outside/);
    expect(() => normalizeProjectStatsQuery(dbMock, "proj1", { window: "custom", from: "2023-01-01", to: "2099-01-01" }, now)).toThrow(/Invalid custom stats window: to date is outside/);
  });

  it("handles standard presets", () => {
    const dbMock = {} as any;
    const now = new Date("2023-01-30T10:17:33Z");

    const r1h = normalizeProjectStatsQuery(dbMock, "proj1", "1h", now);
    expect(r1h.range.resolution).toBe("5min");
    expect(r1h.range.bucketCount).toBe(12);
    expect(r1h.range.label).toBe("Last 1 hour");
    expect(r1h.range.from).toBe("2023-01-30T09:20:00.000Z");
    expect(r1h.range.to).toBe("2023-01-30T10:20:00.000Z");

    const r24h = normalizeProjectStatsQuery(dbMock, "proj1", "24h", now);
    expect(r24h.range.resolution).toBe("hour");
    expect(r24h.range.bucketCount).toBe(24);
    expect(r24h.range.from).toBe("2023-01-29T11:00:00.000Z");
    expect(r24h.range.to).toBe("2023-01-30T11:00:00.000Z");

    const r7d = normalizeProjectStatsQuery(dbMock, "proj1", "7d", now);
    expect(r7d.range.resolution).toBe("day");
    expect(r7d.range.bucketCount).toBe(7);
    expect(r7d.range.from).toBe("2023-01-24T00:00:00.000Z");
    expect(r7d.range.to).toBe("2023-01-31T00:00:00.000Z");

    const r30d = normalizeProjectStatsQuery(dbMock, "proj1", "30d", now);
    expect(r30d.range.resolution).toBe("day");
    expect(r30d.range.bucketCount).toBe(30);
    expect(r30d.range.from).toBe("2023-01-01T00:00:00.000Z");
    expect(r30d.range.to).toBe("2023-01-31T00:00:00.000Z");
  });

  it("includes the current 5-minute bucket for 1h windows", () => {
    const dbMock = {} as any;
    const now = new Date("2023-01-30T10:17:33Z");
    const result = normalizeProjectStatsQuery(dbMock, "proj1", "1h", now);

    expect(result.range.bucketCount).toBe(12);
    expect(result.range.to).toBe("2023-01-30T10:20:00.000Z");
    expect(result.range.from).toBe("2023-01-30T09:20:00.000Z");
    expect(new Date(result.range.to).getTime() - new Date(result.range.from).getTime()).toBe(60 * 60 * 1000);
    expect(new Date(result.range.from).getTime() + 11 * result.bucketSizeMs).toBe(new Date("2023-01-30T10:15:00.000Z").getTime());
  });

  it("includes the current partial hour for 24h windows", () => {
    const dbMock = {} as any;
    const now = new Date("2023-01-30T10:17:33Z");
    const result = normalizeProjectStatsQuery(dbMock, "proj1", "24h", now);

    expect(result.range.bucketCount).toBe(24);
    expect(result.range.to).toBe("2023-01-30T11:00:00.000Z");
    expect(result.range.from).toBe("2023-01-29T11:00:00.000Z");
  });

  it("includes the selected end bucket for all and custom ranges", () => {
    const dbMock = { prepare: () => ({ get: () => ({ first_started_at: "2023-01-01T10:00:00Z" }) }) } as any;
    const now = new Date("2023-01-30T10:17:33Z");

    const all = normalizeProjectStatsQuery(dbMock, "proj1", "all", now);
    expect(all.range.resolution).toBe("day");
    expect(all.range.from).toBe("2023-01-01T00:00:00.000Z");
    expect(all.range.to).toBe("2023-01-31T00:00:00.000Z");

    const customHour = normalizeProjectStatsQuery(dbMock, "proj1", {
      window: "custom",
      from: "2023-01-30T09:05:00Z",
      to: "2023-01-30T10:17:33Z",
    }, now);
    expect(customHour.range.resolution).toBe("hour");
    expect(customHour.range.from).toBe("2023-01-30T09:00:00.000Z");
    expect(customHour.range.to).toBe("2023-01-30T11:00:00.000Z");

    const customDay = normalizeProjectStatsQuery(dbMock, "proj1", {
      window: "custom",
      from: "2023-01-01",
      to: "2023-01-30",
    }, now);
    expect(customDay.range.resolution).toBe("day");
    expect(customDay.range.from).toBe("2023-01-01T00:00:00.000Z");
    expect(customDay.range.to).toBe("2023-01-31T00:00:00.000Z");

    const customWeek = normalizeProjectStatsQuery(dbMock, "proj1", {
      window: "custom",
      from: "2023-01-01",
      to: "2023-05-03",
    }, new Date("2023-05-03T12:00:00Z"));
    expect(customWeek.range.resolution).toBe("week");
    expect(customWeek.range.from).toBe("2022-12-26T00:00:00.000Z");
    expect(customWeek.range.to).toBe("2023-05-08T00:00:00.000Z");
  });

  it("uses UTC-safe alignment helpers", () => {
    expect(startOfHour(new Date("2023-01-30T10:17:33Z")).toISOString()).toBe("2023-01-30T10:00:00.000Z");
    expect(startOfUtcDay(new Date("2023-01-30T10:17:33Z")).toISOString()).toBe("2023-01-30T00:00:00.000Z");
  });
});
