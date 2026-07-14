import { describe, it, expect } from "vitest";
import {
  formatDay,
  formatHourTick,
  formatMinuteTick,
  formatShortDate,
  toTimestamp,
  getAxisLabelStep,
  formatAxisLabel,
  getLedgerSortValue,
} from "../components/stats-formatters.js";

describe("stats-formatters", () => {
  describe("formatDay", () => {
    it("returns formatted day", () => {
      expect(formatDay("2023-10-15T00:00:00Z")).toMatch(/Oct 15|15 Oct/);
    });

    it("returns original value on invalid date", () => {
      expect(formatDay("invalid")).toBe("invalid");
    });
  });

  describe("formatHourTick", () => {
    it("returns formatted hour", () => {
      const formatted = formatHourTick("2023-10-15T14:30:00Z");
      expect(formatted).toMatch(/^\d{1,2}:00$/);
    });

    it("returns original value on invalid date", () => {
      expect(formatHourTick("invalid")).toBe("invalid");
    });
  });

  describe("formatMinuteTick", () => {
    it("returns formatted minute", () => {
      const formatted = formatMinuteTick("2023-10-15T14:35:00Z");
      expect(formatted).toMatch(/^\d{2}:\d{2}$/);
    });

    it("returns original value on invalid date", () => {
      expect(formatMinuteTick("invalid")).toBe("invalid");
    });
  });

  describe("formatShortDate", () => {
    it("returns formatted short date", () => {
      expect(formatShortDate("2023-10-15T00:00:00Z")).toMatch(/Oct 14|Oct 15/);
    });

    it("returns original value on invalid date", () => {
      expect(formatShortDate("invalid")).toBe("invalid");
    });
  });

  describe("toTimestamp", () => {
    it("returns timestamp for valid date", () => {
      expect(toTimestamp("2023-10-15T00:00:00Z")).toBeGreaterThan(0);
    });

    it("returns 0 for null", () => {
      expect(toTimestamp(null)).toBe(0);
    });

    it("returns 0 for invalid date", () => {
      expect(toTimestamp("invalid")).toBe(0);
    });
  });

  describe("getAxisLabelStep", () => {
    it("calculates step correctly for 5min resolution", () => {
      expect(getAxisLabelStep({ resolution: "5min", bucketCount: 12 } as any)).toBe(3);
    });

    it("calculates step correctly for hour resolution", () => {
      expect(getAxisLabelStep({ resolution: "hour", bucketCount: 10 } as any)).toBe(1);
      expect(getAxisLabelStep({ resolution: "hour", bucketCount: 20 } as any)).toBe(3);
    });

    it("calculates step correctly for week resolution", () => {
      expect(getAxisLabelStep({ resolution: "week", bucketCount: 10 } as any)).toBe(2);
      expect(getAxisLabelStep({ resolution: "week", bucketCount: 30 } as any)).toBe(4);
    });

    it("calculates step correctly for other resolutions", () => {
      expect(getAxisLabelStep({ resolution: "day", bucketCount: 10 } as any)).toBe(1);
      expect(getAxisLabelStep({ resolution: "day", bucketCount: 25 } as any)).toBe(5);
    });
  });

  describe("formatAxisLabel", () => {
    const bucket: any = {
      bucketStart: "2023-10-15T14:00:00Z",
      label: "W42",
      usage: {
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        activeTimeMs: 0,
        invocationCount: 0,
        estimatedInvocationCount: 0,
        reportedInvocationCount: 0,
        unavailableInvocationCount: 0,
        unsupportedInvocationCount: 0,
      },
    };

    it("formats 5min correctly", () => {
      expect(formatAxisLabel(bucket, { resolution: "5min", bucketCount: 12 } as any)).toMatch(/^\d{2}:\d{2}$/);
    });

    it("formats hour correctly", () => {
      expect(formatAxisLabel(bucket, { resolution: "hour", bucketCount: 1 } as any)).toMatch(/^\d{1,2}:00$/);
    });

    it("formats week correctly", () => {
      expect(formatAxisLabel(bucket, { resolution: "week", bucketCount: 1 } as any)).toBe("W42");
    });

    it("formats day correctly", () => {
      expect(formatAxisLabel(bucket, { resolution: "day", bucketCount: 1 } as any)).toMatch(/Oct 14|Oct 15/);
    });
  });

  describe("getLedgerSortValue", () => {
    const item: any = {
      id: "1",
      label: "Test",
      lastActivityAt: "2023-10-15T00:00:00Z",
      usage: {
        totalTokens: 100,
        inputTokens: 40,
        outputTokens: 60,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        activeTimeMs: 500,
        invocationCount: 1,
        estimatedInvocationCount: 0,
        reportedInvocationCount: 1,
        unavailableInvocationCount: 0,
        unsupportedInvocationCount: 0,
      },
      sources: [],
    };

    it("sorts by tokens", () => {
      expect(getLedgerSortValue(item, "tokens")).toBe(100);
    });

    it("sorts by active time", () => {
      expect(getLedgerSortValue(item, "active")).toBe(500);
    });

    it("sorts by input", () => {
      expect(getLedgerSortValue(item, "input")).toBe(40);
    });

    it("sorts by output", () => {
      expect(getLedgerSortValue(item, "output")).toBe(60);
    });

    it("sorts by name", () => {
      expect(getLedgerSortValue(item, "name")).toBe("test");
    });

    it("sorts by last activity", () => {
      expect(getLedgerSortValue(item, "last")).toBeGreaterThan(0);
    });
  });
});
