import { describe, it, expect } from "vitest";
import { mapUsageRowToTotals } from "../../../../src/repositories/execution/execution-usage-query.js";

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
});
