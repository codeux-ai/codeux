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

  it("classifies an aborted provider command during restart as cancelled", () => {
    const error = new Error("Virtual QA worker failed: mockup-cli failed: Command aborted");

    expect(isQaReviewCancellationError(error)).toBe(true);
    expect(parseQaError(error)).toMatchObject({
      code: "CANCELLED",
      isRetryable: true,
      message: "Virtual QA worker failed: mockup-cli failed: Command aborted",
    });
  });

  it.each([
    "Helper container pool is shutting down.",
    "Workspace sidecar pool is shutting down.",
    "Workspace sidecar fallback is unavailable while the runtime is shutting down.",
  ])("classifies shutdown infrastructure errors as cancelled: %s", (message) => {
    const error = new Error(`Virtual QA worker failed: ${message}`);

    expect(isQaReviewCancellationError(error)).toBe(true);
    expect(parseQaError(error)).toMatchObject({
      code: "CANCELLED",
      isRetryable: true,
    });
  });
});
