import { describe, it, expect, beforeEach, vi } from "vitest";
import { 
  mapUsageRowToTotals, 
  mergeUsageTotals, 
  getUsageTotalsByTaskIds, 
  getUsageTotalsBySprintRunIds,
  UsageRowRaw
} from "../../../../src/repositories/execution/execution-usage-aggregate-query.js";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { createEmptyUsageTotals } from "../../../../src/repositories/execution/stats-buckets.js";

describe("ExecutionUsageAggregateQuery", () => {
  describe("mapUsageRowToTotals", () => {
    it("returns empty usage for null/undefined row", () => {
      const empty = createEmptyUsageTotals();
      const result = mapUsageRowToTotals(null);
      expect(result).toMatchObject(empty);
      expect((result as any).durationSamples).toEqual([]);
    });

    it("maps a full row correctly", () => {
      const row: UsageRowRaw = {
        invocationCount: 5,
        activeTimeMs: 1000,
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 50,
        reasoningOutputTokens: 10,
        totalTokens: 150,
        reportedInvocationCount: 3,
        estimatedInvocationCount: 1,
        unsupportedInvocationCount: 1,
        unavailableInvocationCount: 0,
        durationSamples: "100,200,300"
      };

      const result = mapUsageRowToTotals(row);
      expect(result).toMatchObject({
        invocationCount: 5,
        activeTimeMs: 1000,
        wallTimeMs: 0,
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 50,
        reasoningOutputTokens: 10,
        totalTokens: 150,
        reportedInvocationCount: 3,
        estimatedInvocationCount: 1,
        unsupportedInvocationCount: 1,
        unavailableInvocationCount: 0
      });
      expect((result as any).durationSamples).toEqual([100, 200, 300]);
    });

    it("handles null values in row by defaulting to 0", () => {
      const row: UsageRowRaw = {
        invocationCount: null,
        activeTimeMs: null,
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningOutputTokens: null,
        totalTokens: null,
        reportedInvocationCount: null,
        estimatedInvocationCount: null,
        unsupportedInvocationCount: null,
        unavailableInvocationCount: null
      };

      const result = mapUsageRowToTotals(row);
      expect(result).toMatchObject(createEmptyUsageTotals());
    });
  });

  describe("mergeUsageTotals", () => {
    it("correctly merges two usage objects", () => {
      const target = createEmptyUsageTotals();
      const source = mapUsageRowToTotals({
        invocationCount: 5,
        activeTimeMs: 1000,
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 50,
        reasoningOutputTokens: 10,
        totalTokens: 150,
        reportedInvocationCount: 3,
        estimatedInvocationCount: 1,
        unsupportedInvocationCount: 1,
        unavailableInvocationCount: 0,
        durationSamples: "100,200"
      } as any);

      mergeUsageTotals(target, source);
      expect(target).toMatchObject(source);

      mergeUsageTotals(target, source);
      expect(target.invocationCount).toBe(10);
      expect(target.inputTokens).toBe(200);
      expect((target as any).durationSamples).toEqual([100, 200, 100, 200]);
    });
  });

  describe("query functions", () => {
    let mockStorage: any;

    beforeEach(() => {
      mockStorage = {
        executeChunkedInQuery: vi.fn()
      };
    });

    it("getUsageTotalsByTaskIds returns empty map for empty taskIds", () => {
      const result = getUsageTotalsByTaskIds(mockStorage, "proj-1", []);
      expect(result.size).toBe(0);
      expect(mockStorage.executeChunkedInQuery).not.toHaveBeenCalled();
    });

    it("getUsageTotalsByTaskIds calls storage and maps results", () => {
      mockStorage.executeChunkedInQuery.mockReturnValue([
        { task_id: "task-1", invocationCount: 1, inputTokens: 10 }
      ]);

      const result = getUsageTotalsByTaskIds(mockStorage, "proj-1", ["task-1"]);
      
      expect(mockStorage.executeChunkedInQuery).toHaveBeenCalled();
      expect(result.get("task-1")?.inputTokens).toBe(10);
    });

    it("getUsageTotalsBySprintRunIds returns empty map for empty ids", () => {
      const result = getUsageTotalsBySprintRunIds(mockStorage, "proj-1", []);
      expect(result.size).toBe(0);
      expect(mockStorage.executeChunkedInQuery).not.toHaveBeenCalled();
    });

    it("getUsageTotalsBySprintRunIds calls storage and maps results", () => {
      mockStorage.executeChunkedInQuery.mockReturnValue([
        { sprint_run_id: "run-1", invocationCount: 2, outputTokens: 20 }
      ]);

      const result = getUsageTotalsBySprintRunIds(mockStorage, "proj-1", ["run-1"]);
      
      expect(mockStorage.executeChunkedInQuery).toHaveBeenCalled();
      expect(result.get("run-1")?.outputTokens).toBe(20);
    });

    it("handles chunked ID lists by passing items to storage", () => {
      const manyIds = Array.from({ length: 150 }, (_, i) => `task-${i}`);
      mockStorage.executeChunkedInQuery.mockReturnValue([
        { task_id: "task-0", invocationCount: 1 },
        { task_id: "task-149", invocationCount: 1 }
      ]);

      const result = getUsageTotalsByTaskIds(mockStorage, "proj-1", manyIds);
      
      expect(mockStorage.executeChunkedInQuery).toHaveBeenCalledWith(expect.objectContaining({
        items: manyIds
      }));
      expect(result.has("task-0")).toBe(true);
      expect(result.has("task-149")).toBe(true);
    });

    it("handles null token sums in results", () => {
      mockStorage.executeChunkedInQuery.mockReturnValue([
        { 
          task_id: "task-null", 
          invocationCount: 1, 
          inputTokens: null, 
          outputTokens: null,
          totalTokens: null 
        }
      ]);

      const result = getUsageTotalsByTaskIds(mockStorage, "proj-1", ["task-null"]);
      const totals = result.get("task-null");
      expect(totals?.inputTokens).toBe(0);
      expect(totals?.outputTokens).toBe(0);
      expect(totals?.totalTokens).toBe(0);
    });
  });
});

