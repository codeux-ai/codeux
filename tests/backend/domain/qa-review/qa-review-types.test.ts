import { describe, expect, it } from "vitest";
import { isQaReviewCancellationError, parseQaError } from "../../../../src/domain/qa-review/qa-review-types.js";

describe("qa review error classification", () => {
  it("classifies dashboard invocation cancellation as cancelled", () => {
    const error = new Error("Provider invocation cancelled.");

    expect(isQaReviewCancellationError(error)).toBe(true);
    expect(parseQaError(error)).toMatchObject({
      code: "CANCELLED",
      isRetryable: true,
      message: "Provider invocation cancelled.",
    });
  });
});
