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
    (mockedFetchProjectInvocations as any).mockResolvedValue([
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

  it("supports query-mode server responses and passes parameters", async () => {
    (mockedFetchProjectInvocations as any).mockResolvedValue({
      items: [
        createInvocation({ id: "inv-server", status: "completed", type: "analysis", provider: "gemini" })
      ],
      totalCount: 150,
      summary: {
        totalInvocations: 150,
        runningCount: 10,
        failedCount: 5,
        completedCount: 135,
        cancelledCount: 0,
        pausedCount: 0,
        totalTokens: 1000,
        totalInputTokens: 500,
        totalOutputTokens: 500,
        totalCachedTokens: 0,
        avgDurationMs: 1200,
        p95DurationMs: 3000,
        externalApiMetrics: {
          git: { calls: 0, avgDurationMs: 0 },
          jules: { calls: 0, avgDurationMs: 0 },
          jira: { calls: 0, avgDurationMs: 0 },
          other: { calls: 0, avgDurationMs: 0 },
        },
        sprintStateSummary: {
          totalSprints: 0,
          activeSprints: 0,
          completedSprints: 0,
          failedSprints: 0,
          totalTasks: 0,
          runningTasks: 0,
          blockedTasks: 0,
        },
        errorsByCategory: { timeout: 0, rateLimit: 0, apiError: 0, modelError: 0, cancelled: 0, other: 0 }
      }
    });

    const { result } = renderHook(() => useSystemViewData("project-1"));

    act(() => {
      result.current.setSearch("test search");
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockedFetchProjectInvocations).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        search: "test search",
        limit: 100,
        offset: 0
      })
    );

    expect(result.current.invocations).toHaveLength(1);
    expect(result.current.invocations[0].id).toBe("inv-server");
    expect(result.current.totalCount).toBe(150);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.summaryMetrics.totalInvocations).toBe(150);
    expect(result.current.summaryMetrics.completedCount).toBe(135);
  });

  it("filters invocations by failed status", async () => {
    (mockedFetchProjectInvocations as any).mockResolvedValue([
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

  it("calculates derived metrics (externalApiMetrics, sprintStateSummary, errorsByCategory)", async () => {
    (mockedFetchProjectInvocations as any).mockResolvedValue([
      createInvocation({ id: "inv-1", type: "git_push", sprintId: "sprint-1", status: "completed", finishedAt: "2026-06-01T10:05:00.000Z" }),
      createInvocation({ id: "inv-2", type: "jira_sync", sprintId: "sprint-1", status: "running", finishedAt: null }),
      createInvocation({ id: "inv-3", type: "coding", provider: "jules", sprintId: "sprint-2", status: "failed", lastErrorMessage: "timeout error" }),
      createInvocation({ id: "inv-4", type: "planning", sprintId: "sprint-2", status: "failed", lastErrorMessage: "Rate limit exceeded (429)" }),
      createInvocation({ id: "inv-5", type: "custom_type", sprintId: "sprint-3", status: "completed" }),
      createInvocation({ id: "inv-6", type: "custom_type", sprintId: "sprint-3", status: "cancelled", lastErrorMessage: "user cancelled" }),
    ]);

    const { result } = renderHook(() => useSystemViewData("project-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.externalApiMetrics.git.calls).toBe(1);
    expect(result.current.externalApiMetrics.jira.calls).toBe(1);
    expect(result.current.externalApiMetrics.jules.calls).toBe(1);
    expect(result.current.externalApiMetrics.other.calls).toBe(2);

    expect(result.current.sprintStateSummary.totalSprints).toBe(3);
    expect(result.current.sprintStateSummary.activeSprints).toBe(1);
    expect(result.current.sprintStateSummary.failedSprints).toBe(1);

    expect(result.current.errorsByCategory.timeout).toBe(1);
    expect(result.current.errorsByCategory.rateLimit).toBe(1);
    expect(result.current.errorsByCategory.cancelled).toBe(1);
  });

  it("suppresses stale responses using AbortController", async () => {
    let resolveFirstRequest: any;
    let resolveSecondRequest: any;

    const promise1 = new Promise((resolve) => {
      resolveFirstRequest = resolve;
    });
    const promise2 = new Promise((resolve) => {
      resolveSecondRequest = resolve;
    });

    (mockedFetchProjectInvocations as any)
      .mockReturnValueOnce(promise1)
      .mockReturnValueOnce(promise2);

    const { result } = renderHook(() => useSystemViewData("project-1"));

    // First request is pending. Trigger a search change to cause a second request.
    act(() => {
      result.current.setSearch("new search");
    });

    // The second request is now pending, and the first request's AbortController should have aborted it.
    // However, since we mock fetchProjectInvocations, we just resolve the first one and verify it's ignored.

    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    await act(async () => {
      // Simulate fetch rejecting due to abort
      try {
        resolveFirstRequest(Promise.reject(abortError));
      } catch (e) {}

      resolveSecondRequest({
        items: [
          createInvocation({ id: "inv-second", status: "completed", type: "analysis", provider: "gemini" })
        ],
        totalCount: 1,
      });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.invocations).toHaveLength(1);
    expect(result.current.invocations[0].id).toBe("inv-second");
    expect(result.current.error).toBeNull(); // AbortError shouldn't set error
  });

  it("resets page to 0 on filter, search, or sort change", async () => {
    (mockedFetchProjectInvocations as any).mockResolvedValue({
      items: [],
      totalCount: 0,
    });

    const { result } = renderHook(() => useSystemViewData("project-1"));

    act(() => {
      result.current.setPage(2);
    });

    expect(result.current.page).toBe(2);

    act(() => {
      result.current.setSearch("reset");
    });

    expect(result.current.page).toBe(0);

    act(() => {
      result.current.setPage(5);
    });

    expect(result.current.page).toBe(5);

    act(() => {
      result.current.setFilters({ status: ["failed"], purpose: [], provider: [] });
    });

    expect(result.current.page).toBe(0);
  });

  it("uses legacy fallback logic correctly when missing server summary", async () => {
    (mockedFetchProjectInvocations as any).mockResolvedValue([
      createInvocation({ id: "inv-leg-1", type: "git_push", status: "completed", finishedAt: "2026-06-01T10:05:00.000Z" }),
      createInvocation({ id: "inv-leg-2", type: "jira_sync", status: "failed", errorMessage: "fail" }),
    ]);

    const { result } = renderHook(() => useSystemViewData("project-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.invocations).toHaveLength(2);
    expect(result.current.summaryMetrics.totalInvocations).toBe(2);
    expect(result.current.summaryMetrics.completedCount).toBe(1);
    expect(result.current.summaryMetrics.failedCount).toBe(1);
    expect(result.current.externalApiMetrics.git.calls).toBe(1);
    expect(result.current.externalApiMetrics.jira.calls).toBe(1);
  });
});
