import { describe, expect, it } from "vitest";
import type { ExecutionInvocationRecord } from "../../../../src/contracts/invocation-types.js";
import {
  MCP_PLANNING_RECHECK_INTERVAL_MS,
  buildInitialMcpPlanningGuidance,
  buildSubsequentMcpPlanningGuidance,
} from "../../../../src/domain/planning/mcp-planning-guidance.js";

function invocation(
  overrides: Partial<ExecutionInvocationRecord> = {}
): ExecutionInvocationRecord {
  return {
    id: "planning-current",
    projectId: "project",
    sprintId: "sprint",
    taskId: null,
    sprintRunId: null,
    dispatchId: null,
    taskRunId: null,
    attentionItemId: null,
    providerInvocationId: null,
    type: "planning",
    status: "running",
    provider: null,
    model: null,
    systemPrompt: null,
    startedAt: "2026-07-13T10:00:00.000Z",
    finishedAt: null,
    errorMessage: null,
    lastErrorCategory: null,
    lastErrorMessage: null,
    lastRetryAfterIso: null,
    messageCount: 0,
    lastMessageAt: null,
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
}

const completedSamples = [
  invocation({
    id: "sample-new",
    status: "completed",
    startedAt: "2026-07-13T09:00:00.000Z",
    finishedAt: "2026-07-13T09:02:00.000Z",
  }),
  invocation({
    id: "sample-old",
    status: "completed",
    startedAt: "2026-07-12T09:00:00.000Z",
    finishedAt: "2026-07-12T09:04:00.000Z",
  }),
];

describe("buildInitialMcpPlanningGuidance", () => {
  it("checks at the calculated ETA and reports the shared historical estimate", () => {
    const result = buildInitialMcpPlanningGuidance({
      invocation: invocation(),
      projectInvocations: completedSamples,
      currentTime: new Date("2026-07-13T10:00:05.000Z"),
    });

    expect(result).toMatchObject({
      status: "in_progress",
      asynchronous: true,
      isTerminal: false,
      invocationId: "planning-current",
      startedAt: "2026-07-13T10:00:00.000Z",
      estimatedDurationMs: 180_000,
      estimatedCompletionAt: "2026-07-13T10:03:00.000Z",
      nextCheckAt: "2026-07-13T10:03:00.000Z",
      recheckIntervalMs: 60_000,
      sampleSize: 2,
      isFallbackEstimate: false,
    });
    expect(result.message).toContain("asynchronously");
    expect(result.message).toContain("not evidence of failure");
    expect(result.message).toContain("Do not requeue, resubmit, or change settings");
  });

  it("retains the three-minute fallback when no completed samples exist", () => {
    const result = buildInitialMcpPlanningGuidance({
      invocation: invocation(),
      projectInvocations: [],
      currentTime: new Date("2026-07-13T10:00:00.000Z"),
    });

    expect(result.estimatedDurationMs).toBe(180_000);
    expect(result.sampleSize).toBe(0);
    expect(result.isFallbackEstimate).toBe(true);
    expect(result.nextCheckAt).toBe("2026-07-13T10:03:00.000Z");
  });
});

describe("buildSubsequentMcpPlanningGuidance", () => {
  it("checks an unfinished invocation exactly one minute later after its ETA elapsed", () => {
    const currentTime = new Date("2026-07-13T10:10:15.250Z");
    const result = buildSubsequentMcpPlanningGuidance({
      invocation: invocation(),
      projectInvocations: completedSamples,
      currentTime,
    });

    expect(result.status).toBe("in_progress");
    expect(result.isTerminal).toBe(false);
    expect(result.estimatedCompletionAt).toBe("2026-07-13T10:03:00.000Z");
    expect(result.nextCheckAt).toBe("2026-07-13T10:11:15.250Z");
    expect(Date.parse(result.nextCheckAt!) - currentTime.getTime()).toBe(
      MCP_PLANNING_RECHECK_INTERVAL_MS
    );
    expect(result.message).toContain("not evidence of failure");
  });

  it.each([
    ["completed", "succeeded"],
    ["failed", "failed"],
    ["cancelled", "cancelled"],
    ["paused", "paused"],
  ] as const)("maps %s to terminal %s guidance with no next check", (invocationStatus, guidanceStatus) => {
    const result = buildSubsequentMcpPlanningGuidance({
      invocation: invocation({ status: invocationStatus }),
      projectInvocations: completedSamples,
      currentTime: new Date("2026-07-13T10:10:00.000Z"),
    });

    expect(result.status).toBe(guidanceStatus);
    expect(result.isTerminal).toBe(true);
    expect(result.nextCheckAt).toBeNull();
  });

  it("preserves the available primary failure detail", () => {
    const result = buildSubsequentMcpPlanningGuidance({
      invocation: invocation({
        status: "failed",
        errorMessage: "Provider exited unexpectedly.",
        lastErrorMessage: "Older retry detail.",
      }),
      projectInvocations: completedSamples,
      currentTime: new Date("2026-07-13T10:10:00.000Z"),
    });

    expect(result.errorMessage).toBe("Provider exited unexpectedly.");
    expect(result.message).toContain("Provider exited unexpectedly.");
  });

  it("does not expose stale error details after successful completion", () => {
    const result = buildSubsequentMcpPlanningGuidance({
      invocation: invocation({
        status: "completed",
        errorMessage: "Recovered transient failure.",
      }),
      projectInvocations: completedSamples,
      currentTime: new Date("2026-07-13T10:10:00.000Z"),
    });

    expect(result.errorMessage).toBeUndefined();
    expect(result.message).toBe("Planning completed successfully.");
  });

  it("falls back to the last provider error detail for terminal interruptions", () => {
    const result = buildSubsequentMcpPlanningGuidance({
      invocation: invocation({
        status: "paused",
        lastErrorMessage: "Waiting for operator input.",
      }),
      projectInvocations: completedSamples,
      currentTime: new Date("2026-07-13T10:10:00.000Z"),
    });

    expect(result.errorMessage).toBe("Waiting for operator input.");
    expect(result.message).toContain("Waiting for operator input.");
  });
});
