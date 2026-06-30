import { describe, it, expect } from "vitest";
import {
  mapUsageRowToTotals,
  mergeUsageTotals,
  withWallTime,
  groupUsageBy,
  getUsageTotalsByTaskIds,
  getUsageTotalsBySprintRunIds,
} from "../../../../src/repositories/execution/execution-usage-query.js";
import { createEmptyUsageTotals } from "../../../../src/repositories/execution/stats-buckets.js";
import type { ProviderInvocationUsageRecord } from "../../../../src/contracts/execution-types.js";

function makeRecord(overrides: Partial<ProviderInvocationUsageRecord> = {}): ProviderInvocationUsageRecord {
  return {
    id: "inv-1",
    projectId: "proj",
    sprintId: null,
    taskId: null,
    sprintRunId: null,
    dispatchId: null,
    taskRunId: null,
    attentionItemId: null,
    connectionId: null,
    sessionId: "sess",
    provider: "codex",
    purpose: "task" as ProviderInvocationUsageRecord["purpose"],
    status: "succeeded" as ProviderInvocationUsageRecord["status"],
    model: "gpt",
    executionMode: null,
    nativeSessionId: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    durationMs: 1000,
    promptChars: 0,
    transcriptChars: 0,
    inputTokens: 10,
    cachedInputTokens: 2,
    outputTokens: 5,
    reasoningOutputTokens: 1,
    totalTokens: 16,
    toolCallCount: 3,
    julesTokens: 0,
    usageSource: "reported" as ProviderInvocationUsageRecord["usageSource"],
    invocationSource: "cli" as ProviderInvocationUsageRecord["invocationSource"],
    costCents: null,
    rawUsageJson: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("execution-usage-query", () => {
  describe("mapUsageRowToTotals", () => {
    it("maps a valid row to ExecutionUsageTotals", () => {
      const row = {
        invocation_count: 5,
        duration_ms: 1000,
        input_tokens: 100,
        cached_input_tokens: 20,
        output_tokens: 50,
        reasoning_output_tokens: 10,
        total_tokens: 150,
        reported_invocation_count: 3,
        estimated_invocation_count: 2,
        unsupported_invocation_count: 0,
        unavailable_invocation_count: 0
      };

      const result = mapUsageRowToTotals(row);

      expect(result).toMatchObject({
        invocationCount: 5,
        activeTimeMs: 1000,
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 50,
        reasoningOutputTokens: 10,
        totalTokens: 150,
        reportedInvocationCount: 3,
        estimatedInvocationCount: 2,
        unsupportedInvocationCount: 0,
        unavailableInvocationCount: 0
      });
    });

    it("handles explicit null row gracefully", () => {
      const result = mapUsageRowToTotals(null);

      expect(result).toMatchObject({
        invocationCount: 0,
        activeTimeMs: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        reportedInvocationCount: 0,
        estimatedInvocationCount: 0,
        unsupportedInvocationCount: 0,
        unavailableInvocationCount: 0
      });
    });

    it("handles undefined row gracefully", () => {
      const result = mapUsageRowToTotals(undefined);

      expect(result).toMatchObject({
        invocationCount: 0,
        activeTimeMs: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        reportedInvocationCount: 0,
        estimatedInvocationCount: 0,
        unsupportedInvocationCount: 0,
        unavailableInvocationCount: 0
      });
    });

    it("handles missing or null values gracefully", () => {
      const row = {};
      const result = mapUsageRowToTotals(row);

      expect(result).toMatchObject({
        invocationCount: 0,
        activeTimeMs: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        reportedInvocationCount: 0,
        estimatedInvocationCount: 0,
        unsupportedInvocationCount: 0,
        unavailableInvocationCount: 0
      });
    });

    it("preserves backend-normalized total tokens instead of recomputing from parts", () => {
      const row = {
        input_tokens: 300,
        output_tokens: 170,
        reasoning_output_tokens: 40,
        total_tokens: 470,
      };
      const result = mapUsageRowToTotals(row);
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(170);
      expect(result.reasoningOutputTokens).toBe(40);
      expect(result.totalTokens).toBe(470);
    });
  });

  describe("mergeUsageTotals", () => {
    it("accumulates token, duration and tool-call totals across records", () => {
      const target = createEmptyUsageTotals();
      mergeUsageTotals(target, makeRecord({ usageSource: "reported" as never }));
      mergeUsageTotals(target, makeRecord({ usageSource: "estimated" as never, durationMs: 500, toolCallCount: 2 }));

      expect(target.invocationCount).toBe(2);
      expect(target.activeTimeMs).toBe(1500);
      expect(target.inputTokens).toBe(20);
      expect(target.totalTokens).toBe(32);
      expect(target.toolCallCount).toBe(5);
      expect(target.reportedInvocationCount).toBe(1);
      expect(target.estimatedInvocationCount).toBe(1);
    });

    it("classifies unsupported and unavailable usage sources", () => {
      const target = createEmptyUsageTotals();
      mergeUsageTotals(target, makeRecord({ usageSource: "unsupported" as never }));
      mergeUsageTotals(target, makeRecord({ usageSource: "unknown" as never }));

      expect(target.unsupportedInvocationCount).toBe(1);
      expect(target.unavailableInvocationCount).toBe(1);
    });

    it("treats null duration and tool-call counts as zero", () => {
      const target = createEmptyUsageTotals();
      mergeUsageTotals(target, makeRecord({ durationMs: null, toolCallCount: null as never }));
      expect(target.activeTimeMs).toBe(0);
      expect(target.toolCallCount).toBe(0);
    });
  });

  describe("withWallTime", () => {
    it("returns an empty-totals object with wall time when usage is missing", () => {
      const result = withWallTime(undefined, 1234);
      expect(result.wallTimeMs).toBe(1234);
      expect(result.invocationCount).toBe(0);
    });

    it("preserves existing usage and overrides only the wall time", () => {
      const usage = { ...createEmptyUsageTotals(), invocationCount: 7 };
      const result = withWallTime(usage, 99);
      expect(result.invocationCount).toBe(7);
      expect(result.wallTimeMs).toBe(99);
    });
  });

  describe("groupUsageBy", () => {
    it("buckets records by the selected key and skips null keys", () => {
      const records = [
        makeRecord({ taskId: "t1" }),
        makeRecord({ taskId: "t1" }),
        makeRecord({ taskId: "t2" }),
        makeRecord({ taskId: null }),
      ];
      const grouped = groupUsageBy(records, (r) => r.taskId);

      expect([...grouped.keys()].sort()).toEqual(["t1", "t2"]);
      expect(grouped.get("t1")?.invocationCount).toBe(2);
      expect(grouped.get("t2")?.invocationCount).toBe(1);
    });
  });

  describe("getUsageTotalsByTaskIds / getUsageTotalsBySprintRunIds", () => {
    const fakeStorage = (rows: Record<string, unknown>[]) => ({
      executeChunkedInQuery: <T,>() => rows as T[],
    }) as never;
    const noopMapper = (() => ({})) as never;

    it("returns an empty map without querying when no task ids are supplied", () => {
      const result = getUsageTotalsByTaskIds(fakeStorage([]), "proj", [], noopMapper);
      expect(result.size).toBe(0);
    });

    it("maps aggregated rows keyed by task id", () => {
      const rows = [{ task_id: "t1", invocation_count: 3, total_tokens: 90 }];
      const result = getUsageTotalsByTaskIds(fakeStorage(rows), "proj", ["t1"], noopMapper);
      expect(result.get("t1")?.invocationCount).toBe(3);
      expect(result.get("t1")?.totalTokens).toBe(90);
    });

    it("returns an empty map without querying when no sprint run ids are supplied", () => {
      const result = getUsageTotalsBySprintRunIds(fakeStorage([]), "proj", [], noopMapper);
      expect(result.size).toBe(0);
    });

    it("maps aggregated rows keyed by sprint run id", () => {
      const rows = [{ sprint_run_id: "r1", invocation_count: 4 }];
      const result = getUsageTotalsBySprintRunIds(fakeStorage(rows), "proj", ["r1"], noopMapper);
      expect(result.get("r1")?.invocationCount).toBe(4);
    });

    it("skips rows that have neither a task id nor a sprint run id", () => {
      const rows = [{ invocation_count: 1 }];
      const result = getUsageTotalsByTaskIds(fakeStorage(rows), "proj", ["t1"], noopMapper);
      expect(result.size).toBe(0);
    });
  });
});
