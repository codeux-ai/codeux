import { describe, expect, it } from "vitest";
import {
  extractJsonContainer,
  normalizeUsageCounts,
  parseJsonContainer,
  parseUsageObject,
  toNumber,
} from "../../../../../src/infrastructure/providers/cli/provider-logs/usage-parse-utils.js";

describe("provider JSON extraction utilities", () => {
  it("extracts a JSON array from noisy bootstrap output", () => {
    const result = extractJsonContainer<unknown[]>(
      "provider-runner: booting runtime\n[{\"response\":{\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}}]\n",
      "array",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ response: { usage: { prompt_tokens: 3, completion_tokens: 2 } } }]);
      expect(result.startIndex).toBeGreaterThan(0);
    }
  });

  it("returns a typed malformed failure for incomplete JSON", () => {
    const result = extractJsonContainer("{\"api_key\":\"sk-test-secret\",\"response\":{\"usage\":", "object");

    expect(result).toMatchObject({
      ok: false,
      error: "malformed",
      startIndex: 0,
    });
    expect(result).not.toHaveProperty("jsonText");
  });

  it("returns a typed unexpected_type failure when the container kind is wrong", () => {
    const result = parseJsonContainer("[{\"api_key\":\"sk-test-secret\"}]", "object");

    expect(result).toMatchObject({
      ok: false,
      error: "unexpected_type",
    });
    expect(result).not.toHaveProperty("jsonText");
  });

  it("normalizes zero, missing, negative, and numeric-string token fields", () => {
    expect(toNumber(0)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber(-7)).toBe(0);
    expect(toNumber("-9")).toBe(0);
    expect(toNumber("12")).toBe(12);

    expect(normalizeUsageCounts({
      prompt_tokens: 0,
      input_tokens: "14",
      completion_tokens: -5,
      output_tokens: "6",
      total_tokens: -100,
    })).toEqual({
      promptTokens: 14,
      completionTokens: 6,
      totalTokens: 20,
    });
  });

  it("parses mixed usage objects without negative token leakage", () => {
    expect(parseUsageObject({
      input_tokens: 50,
      output_tokens: -1,
      total_tokens: 70,
      input_token_details: { cached_tokens: -10 },
      output_token_details: { reasoning_tokens: "8" },
    })).toEqual({
      inputTokens: 50,
      cachedInputTokens: 0,
      outputTokens: 20,
      reasoningOutputTokens: 8,
    });

    expect(parseUsageObject({
      prompt_tokens: 0,
      total_tokens: 0,
    })).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    });
  });
});
