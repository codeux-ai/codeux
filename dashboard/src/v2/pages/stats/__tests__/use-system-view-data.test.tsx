/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionInvocationRecord } from "../../../types.js";
import { fetchProjectInvocations } from "../../../lib/invocation-api.js";
import { useSystemViewData } from "../hooks/use-system-view-data.js";

vi.mock("../../../lib/invocation-api.js", () => ({
  fetchProjectInvocations: vi.fn(),
}));

const mockedFetchProjectInvocations = vi.mocked(fetchProjectInvocations);

const createInvocation = (overrides: Partial<ExecutionInvocationRecord>): ExecutionInvocationRecord => ({
  id: "inv-1",
  projectId: "project-1",
  sprintId: null,
  taskId: null,
  sprintRunId: null,
  dispatchId: null,
  taskRunId: null,
  attentionItemId: null,
  providerInvocationId: null,
  type: "analysis",
  status: "completed",
  provider: "gemini",
  model: "gemini-2.0-flash",
  systemPrompt: null,
  startedAt: "2026-06-01T10:00:00.000Z",
  finishedAt: "2026-06-01T10:05:00.000Z",
  errorMessage: null,
  lastErrorCategory: null,
  lastErrorMessage: null,
  lastRetryAfterIso: null,
  messageCount: 2,
  lastMessageAt: "2026-06-01T10:05:00.000Z",
  invocationSource: "internal",
  agentPresetId: null,
  inputTokens: 10,
  cachedInputTokens: 2,
  outputTokens: 20,
  totalTokens: 30,
  sprintNumber: null,
  sprintName: null,
  sprintSlug: null,
  taskKey: null,
  taskTitle: "Refine telemetry aggregation",
  createdAt: "2026-06-01T10:00:00.000Z",
  updatedAt: "2026-06-01T10:05:00.000Z",
  ...overrides,
});

describe("useSystemViewData", () => {
  beforeEach(() => {
    mockedFetchProjectInvocations.mockReset();
  });

  it("returns the documented view model shape", async () => {
    mockedFetchProjectInvocations.mockResolvedValue([
      createInvocation({ id: "inv-1", type: "analysis", provider: "gemini", status: "completed" }),
      createInvocation({
        id: "inv-2",
        type: "deployment",
        provider: "codex",
        status: "running",
        finishedAt: null,
        lastMessageAt: null,
        taskTitle: "Deploy the dashboard",
      }),
    ]);

    const { result } = renderHook(() => useSystemViewData("project-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current).toHaveProperty("invocations");
    expect(result.current).toHaveProperty("allInvocations");
    expect(result.current).toHaveProperty("summaryMetrics");
    expect(result.current).toHaveProperty("availablePurposes");
    expect(result.current).toHaveProperty("availableProviders");
    expect(result.current).toHaveProperty("filters");
    expect(result.current).toHaveProperty("setFilters");
    expect(result.current).toHaveProperty("search");
    expect(result.current).toHaveProperty("setSearch");
    expect(result.current).toHaveProperty("sort");
    expect(result.current).toHaveProperty("setSort");
    expect(result.current).toHaveProperty("loading");
    expect(result.current).toHaveProperty("error");
    expect(result.current).toHaveProperty("refetch");

    expect(result.current.availablePurposes).toEqual(["analysis", "deployment"]);
    expect(result.current.availableProviders).toEqual(["codex", "gemini"]);
    expect(result.current.summaryMetrics.totalInvocations).toBe(2);
    expect(result.current.summaryMetrics.runningCount).toBe(1);
    expect(result.current.summaryMetrics.failedCount).toBe(0);
    expect(result.current.summaryMetrics.totalTokens).toBe(60);
    expect(result.current.summaryMetrics.avgDurationMs).toBe(300000);
    expect(result.current.error === null || typeof result.current.error === "string").toBe(true);
  });

  it("filters invocations by failed status", async () => {
    mockedFetchProjectInvocations.mockResolvedValue([
      createInvocation({ id: "inv-1", status: "completed", type: "analysis", provider: "gemini" }),
      createInvocation({ id: "inv-2", status: "failed", type: "deployment", provider: "codex", errorMessage: "boom" }),
      createInvocation({ id: "inv-3", status: "running", type: "analysis", provider: "codex", finishedAt: null }),
    ]);

    const { result } = renderHook(() => useSystemViewData("project-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setFilters({
        status: ["failed"],
        purpose: [],
        provider: [],
      });
    });

    await waitFor(() => {
      expect(result.current.invocations).toHaveLength(1);
    });

    expect(result.current.invocations[0]?.status).toBe("failed");
    expect(result.current.invocations.every((invocation) => invocation.status === "failed")).toBe(true);
  });
});
