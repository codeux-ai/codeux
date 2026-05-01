import { describe, it, expect } from "vitest";
import { computeNextParseAttempt } from "../../../../src/domain/llm/parse-retry-policy.js";

describe("parse-retry-policy", () => {
  describe("computeNextParseAttempt", () => {
    it("should return shouldRetry: true when current attempt is less than max", () => {
      const result = computeNextParseAttempt(0, 3);
      expect(result.shouldRetry).toBe(true);
      expect(result.errorMessage).toBeUndefined();
    });

    it("should return shouldRetry: false with error message when current attempt equals max", () => {
      const result = computeNextParseAttempt(3, 3);
      expect(result.shouldRetry).toBe(false);
      expect(result.errorMessage).toBe("Parse retry limit reached (3).");
    });

    it("should return shouldRetry: false with error message when current attempt exceeds max", () => {
      const result = computeNextParseAttempt(4, 3);
      expect(result.shouldRetry).toBe(false);
      expect(result.errorMessage).toBe("Parse retry limit reached (3).");
    });
  });
});
