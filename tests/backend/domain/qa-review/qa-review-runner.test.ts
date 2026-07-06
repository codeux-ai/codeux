import { describe, it, expect, vi, beforeEach } from "vitest";
import { QaReviewRunner } from "../../../../src/domain/qa-review/qa-review-runner.js";
import type { StructuredAgentRequestService } from "../../../../src/services/structured-agent-request-service.js";
import type { QaReviewRunRecord } from "../../../../src/repositories/qa-review-repository.js";
import type { ProviderId } from "../../../../src/contracts/app-types.js";

describe("QaReviewRunner", () => {
  let structuredAgentRequestService: ReturnType<typeof vi.mocked<StructuredAgentRequestService>>;
  let runner: QaReviewRunner;

  beforeEach(() => {
    structuredAgentRequestService = {
      executeRequest: vi.fn(),
    } as unknown as ReturnType<typeof vi.mocked<StructuredAgentRequestService>>;

    runner = new QaReviewRunner({
      structuredAgentRequestService,
    });
  });

  const defaultArgs = {
    projectId: "proj-1",
    sprintId: "sprint-1",
    taskId: "task-1",
    provider: "openai" as ProviderId,
    model: "gpt-4",
    apiKey: "test-key",
    providerPrompt: "Review this.",
    repoPath: "/test/repo",
    settings: {},
    agentInstructions: "You are a QA bot.",
    runRecord: { id: "run-1" } as QaReviewRunRecord,
    parseFn: vi.fn(),
  };

  it("should return success when execution parses successfully", async () => {
    const mockReview = { verdict: "pass", summary: "Looks good" };
    structuredAgentRequestService.executeRequest.mockResolvedValueOnce({
      parsed: mockReview,
    } as any);

    const outcome = await runner.runQaReview(defaultArgs);

    expect(outcome).toEqual({
      status: "success",
      review: mockReview,
    });
  });

  it("should return explicit errored outcome with parse_failure when parse fails", async () => {
    structuredAgentRequestService.executeRequest.mockRejectedValueOnce(new Error("Invalid JSON format: Failed to extract valid JSON from text."));

    const outcome = await runner.runQaReview(defaultArgs);

    expect(outcome).toEqual({
      status: "error",
      error: expect.objectContaining({
        code: "PARSE_FAILURE",
        message: "Invalid JSON format: Failed to extract valid JSON from text.",
        isRetryable: false,
      }),
    });
  });

  it("should return explicit errored outcome with transport_error when network fails", async () => {
    structuredAgentRequestService.executeRequest.mockRejectedValueOnce(new Error("Network timeout"));

    const outcome = await runner.runQaReview(defaultArgs);

    expect(outcome).toEqual({
      status: "error",
      error: expect.objectContaining({
        code: "API_TIMEOUT",
        message: "Network timeout",
        isRetryable: true,
      }),
    });
  });

  it("should return api_failure for arbitrary unknown errors", async () => {
    structuredAgentRequestService.executeRequest.mockRejectedValueOnce(new Error("Unknown server error 500"));

    const outcome = await runner.runQaReview(defaultArgs);

    expect(outcome).toEqual({
      status: "error",
      error: expect.objectContaining({
        code: "UNKNOWN",
        message: "Unknown server error 500",
        isRetryable: false,
      }),
    });
  });
});
