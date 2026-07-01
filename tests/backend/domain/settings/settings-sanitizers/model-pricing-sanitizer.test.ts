import { describe, expect, it } from "vitest";
import { sanitizeModelPricing } from "../../../../../src/domain/settings/settings-sanitizers/model-pricing-sanitizer.js";

describe("sanitizeModelPricing", () => {
  it("returns an empty overrides map for missing/malformed input", () => {
    expect(sanitizeModelPricing(undefined)).toEqual({ overrides: {} });
    expect(sanitizeModelPricing(null)).toEqual({ overrides: {} });
    expect(sanitizeModelPricing({})).toEqual({ overrides: {} });
    expect(sanitizeModelPricing({ overrides: "not-an-object" })).toEqual({ overrides: {} });
  });

  it("keeps a valid override and coerces missing/invalid numeric fields to 0", () => {
    const result = sanitizeModelPricing({
      overrides: {
        "anthropic/claude-sonnet-4-5": { inputTokens: 3, outputTokens: "bad", cachedInputTokens: 0.5 },
      },
    });
    expect(result).toEqual({
      overrides: {
        "anthropic/claude-sonnet-4-5": { inputTokens: 3, outputTokens: 0, cachedInputTokens: 0.5 },
      },
    });
  });

  it("drops an all-zero override, mirroring the old per-provider modal's clear-on-zero semantics", () => {
    const result = sanitizeModelPricing({
      overrides: {
        "openai/gpt-5.5": { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      },
    });
    expect(result).toEqual({ overrides: {} });
  });

  it("drops negative numbers and non-string keys", () => {
    const result = sanitizeModelPricing({
      overrides: {
        "openai/gpt-5.5": { inputTokens: -5, outputTokens: 10, cachedInputTokens: 0 },
        "": { inputTokens: 1, outputTokens: 1, cachedInputTokens: 1 },
      },
    });
    expect(result).toEqual({
      overrides: {
        "openai/gpt-5.5": { inputTokens: 0, outputTokens: 10, cachedInputTokens: 0 },
      },
    });
  });
});
