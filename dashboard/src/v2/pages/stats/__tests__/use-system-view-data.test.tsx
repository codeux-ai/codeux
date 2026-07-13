/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardRealtimeServerMessage } from "../../../../types.js";
import type { ExecutionInvocationRecord } from "../../../types.js";
import { subscribeToDashboardRealtime } from "../../../../lib/realtime/dashboard-realtime-client.js";
import { fetchProjectInvocations } from "../../../lib/invocation-api.js";
import { useSystemViewData } from "../hooks/use-system-view-data.js";

vi.mock("../../../../lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn(),
}));

vi.mock("../../../lib/invocation-api.js", () => ({
  fetchProjectInvocations: vi.fn(),
}));

const mockedSubscribeToDashboardRealtime = vi.mocked(subscribeToDashboardRealtime);
const mockedFetchProjectInvocations = vi.mocked(fetchProjectInvocations);

const getRealtimeListener = (): ((message: DashboardRealtimeServerMessage) => void) => {
  const subscriptionCall = mockedSubscribeToDashboardRealtime.mock.calls.at(-1);
  if (!subscriptionCall) {
    throw new Error("Expected a dashboard realtime subscription");
  }
  return subscriptionCall[1];
};

const createExecutionEvent = (projectId = "project-1"): DashboardRealtimeServerMessage => ({
  type: "event",
  event: {
    sequence: 1,
    emittedAt: "2026-06-01T10:06:00.000Z",
    scopeType: "project",
    scopeId: projectId,
    scope: `project:${projectId}`,
    eventType: "project.execution.updated",
    entityType: "project",
    entityId: projectId,
    projectId,
    sprintId: null,
    threadId: null,
    taskId: null,
    dispatchId: null,
    sprintRunId: null,
    taskRunId: null,
    connectionId: null,
    correlationId: null,
    payload: null,
  },
});

const snapshotRequiredMessage: DashboardRealtimeServerMessage = {
  type: "snapshot_required",
  reason: "replay_gap",
};

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
    mockedSubscribeToDashboardRealtime.mockReset();
    mockedSubscribeToDashboardRealtime.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
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

    expect(mockedFetchProjectInvocations).toHaveBeenLastCalledWith(
      "project-1",
      expect.objectContaining({
        search: "test search",
        limit: 100,
        offset: 0
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );

    expect(result.current.invocations).toHaveLength(1);
    expect(result.current.invocations[0].id).toBe("inv-server");
    expect(result.current.totalCount).toBe(150);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.summaryMetrics.totalInvocations).toBe(150);
    expect(result.current.summaryMetrics.completedCount).toBe(135);
  });

  it.each([
    ["project.execution.updated", createExecutionEvent()],
    ["snapshot_required", snapshotRequiredMessage],
  ])("refetches the current ledger query for %s", async (_eventType, message) => {
    (mockedFetchProjectInvocations as any)
      .mockResolvedValueOnce([createInvocation({ id: "inv-before" })])
      .mockResolvedValueOnce([createInvocation({ id: "inv-after" })]);

    const { result } = renderHook(() => useSystemViewData("project-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mockedSubscribeToDashboardRealtime).toHaveBeenCalledWith(
      ["project:project-1"],
      expect.any(Function),
    );

    vi.useFakeTimers();
    act(() => {
      getRealtimeListener()(message);
      vi.advanceTimersByTime(150);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(mockedFetchProjectInvocations).toHaveBeenCalledTimes(2);
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.invocations[0]?.id).toBe("inv-after");
  });

  it("coalesces bursts of execution and snapshot invalidations into one refetch", async () => {
    (mockedFetchProjectInvocations as any).mockResolvedValue([createInvocation({ id: "inv-1" })]);
    const { result } = renderHook(() => useSystemViewData("project-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    vi.useFakeTimers();
    act(() => {
      const listener = getRealtimeListener();
      listener(createExecutionEvent());
      listener(snapshotRequiredMessage);
      listener(createExecutionEvent());
      vi.advanceTimersByTime(149);
    });
    expect(mockedFetchProjectInvocations).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(mockedFetchProjectInvocations).toHaveBeenCalledTimes(2);
      expect(result.current.loading).toBe(false);
    });
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

  it("aborts a superseded request and rejects its stale response when abort is ignored", async () => {
    let resolveFirstRequest!: (value: ExecutionInvocationRecord[]) => void;
    let resolveSecondRequest!: (value: ExecutionInvocationRecord[]) => void;
    const firstRequest = new Promise<ExecutionInvocationRecord[]>((resolve) => {
      resolveFirstRequest = resolve;
    });
    const secondRequest = new Promise<ExecutionInvocationRecord[]>((resolve) => {
      resolveSecondRequest = resolve;
    });

    (mockedFetchProjectInvocations as any)
      .mockReturnValueOnce(firstRequest)
      .mockReturnValueOnce(secondRequest);

    const { result } = renderHook(() => useSystemViewData("project-1"));

    await waitFor(() => {
      expect(mockedFetchProjectInvocations).toHaveBeenCalledTimes(1);
      expect(mockedSubscribeToDashboardRealtime).toHaveBeenCalledTimes(1);
    });
    const firstSignal = mockedFetchProjectInvocations.mock.calls[0]?.[2]?.signal;

    vi.useFakeTimers();
    act(() => {
      getRealtimeListener()(createExecutionEvent());
      vi.advanceTimersByTime(150);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(mockedFetchProjectInvocations).toHaveBeenCalledTimes(2);
    });
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      resolveSecondRequest([createInvocation({ id: "inv-newest" })]);
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.invocations[0]?.id).toBe("inv-newest");
    });

    await act(async () => {
      resolveFirstRequest([createInvocation({ id: "inv-stale" })]);
    });
    expect(result.current.invocations[0]?.id).toBe("inv-newest");
    expect(result.current.error).toBeNull();
  });

  it("preserves rows, filters, sorting, search, and the current page during realtime refresh", async () => {
    const currentPageResponse = {
      items: [createInvocation({ id: "inv-current-page" })],
      totalCount: 500,
    } as any;
    mockedFetchProjectInvocations.mockResolvedValue(currentPageResponse);

    const { result } = renderHook(() => useSystemViewData("project-1"));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSearch("telemetry");
      result.current.setFilters({
        status: ["failed"],
        purpose: ["analysis"],
        provider: ["codex"],
        errorCategories: ["timeout", "rateLimit"],
      });
      result.current.setSort({ key: "totalTokens", dir: "asc" });
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.page).toBe(0);
    });

    act(() => {
      result.current.setPage(2);
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(mockedFetchProjectInvocations).toHaveBeenLastCalledWith(
        "project-1",
        expect.objectContaining({ offset: 200 }),
        expect.any(Object),
      );
    });

    let resolveRefresh!: (value: typeof currentPageResponse) => void;
    mockedFetchProjectInvocations.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const callCountBeforeRefresh = mockedFetchProjectInvocations.mock.calls.length;

    vi.useFakeTimers();
    act(() => {
      getRealtimeListener()(createExecutionEvent());
      vi.advanceTimersByTime(150);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(mockedFetchProjectInvocations).toHaveBeenCalledTimes(callCountBeforeRefresh + 1);
      expect(result.current.loading).toBe(true);
    });
    expect(result.current.invocations[0]?.id).toBe("inv-current-page");
    expect(result.current.page).toBe(2);
    expect(result.current.search).toBe("telemetry");
    expect(result.current.filters).toEqual({
      status: ["failed"],
      purpose: ["analysis"],
      provider: ["codex"],
      errorCategories: ["timeout", "rateLimit"],
    });
    expect(result.current.sort).toEqual({ key: "totalTokens", dir: "asc" });
    expect(mockedFetchProjectInvocations).toHaveBeenLastCalledWith(
      "project-1",
      {
        limit: 100,
        offset: 200,
        search: "telemetry",
        sortKey: "totalTokens",
        sortDir: "asc",
        status: "failed",
        purpose: "analysis",
        provider: "codex",
        errorCategories: ["timeout", "rateLimit"],
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      resolveRefresh({
        ...currentPageResponse,
        items: [createInvocation({ id: "inv-refreshed-page" })],
      });
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.invocations[0]?.id).toBe("inv-refreshed-page");
    });
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
