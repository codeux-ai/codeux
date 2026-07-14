/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { getActiveInvocationPollingKey } from "../../../dashboard/src/v2/hooks/use-chat-page-data.js";
import { useInvocationPaneData } from "../../../dashboard/src/v2/hooks/use-invocation-pane-data.js";
import { useMessageCache } from "../../../dashboard/src/v2/hooks/useMessageCache.js";
import type { ExecutionInvocationRecord } from "../../../dashboard/src/v2/types.js";

const buildServerInvocation = (
  createdAt: string,
  overrides: Partial<ExecutionInvocationRecord> = {},
): ExecutionInvocationRecord => ({
  id: "persisted-cli-preparation-1",
  projectId: "project-1",
  sprintId: null,
  taskId: null,
  sprintRunId: null,
  dispatchId: null,
  taskRunId: null,
  attentionItemId: null,
  providerInvocationId: null,
  type: "cli_task_coding",
  status: "running",
  provider: null,
  model: null,
  systemPrompt: null,
  startedAt: createdAt,
  finishedAt: null,
  errorMessage: null,
  lastErrorCategory: null,
  lastErrorMessage: null,
  lastRetryAfterIso: null,
  messageCount: 0,
  lastMessageAt: createdAt,
  invocationSource: "internal",
  agentPresetId: null,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

describe("invocation server snapshots", () => {
  it("exposes only invocation records from server snapshots", () => {
    const { result } = renderHook(() => {
      const cache = useMessageCache();
      return useInvocationPaneData({
        selectedProject: { id: "project-1" },
        cache,
      });
    });

    expect(result.current.invocations).toEqual([]);
    expect(Object.keys(result.current).some((key) => key.toLowerCase().includes("optimistic"))).toBe(false);

    const sentAt = new Date().toISOString();
    const invocation = buildServerInvocation(sentAt);

    act(() => {
      result.current.setInvocationsSnapshot([invocation], 2);
    });

    expect(result.current.invocations).toEqual([invocation]);
    expect(result.current.serverInvocationCount).toBe(1);
    expect(result.current.invocationTotalCount).toBe(2);
    expect(result.current.hasMoreInvocations).toBe(true);
    expect(result.current.invocationIndex.get(invocation.id)).toEqual(invocation);
  });

  it("exposes only persisted ids to invocation detail and lifecycle action consumers", async () => {
    const { result } = renderHook(() => {
      const cache = useMessageCache();
      return useInvocationPaneData({
        selectedProject: { id: "project-1" },
        cache,
      });
    });
    const createdAt = "2026-07-13T10:00:00.000Z";
    const runningInvocation = buildServerInvocation(createdAt);
    const openDetail = vi.fn();
    const cancelInvocation = vi.fn();
    const restartInvocation = vi.fn();

    expect(result.current.selectedInvocation).toBeNull();

    await act(async () => {
      result.current.setInvocationsSnapshot([runningInvocation]);
      await result.current.activateInvocation(runningInvocation.id, {
        preferredInvocation: runningInvocation,
      });
    });

    const indexedInvocation = result.current.invocationIndex.get(runningInvocation.id);
    expect(indexedInvocation).toBe(runningInvocation);
    expect(result.current.selectedInvocation).toBe(runningInvocation);
    openDetail(indexedInvocation?.id);
    cancelInvocation(result.current.selectedInvocation?.id);

    const failedInvocation = buildServerInvocation(createdAt, {
      id: "persisted-planning-failure-2",
      type: "planning",
      status: "failed",
      finishedAt: "2026-07-13T10:01:00.000Z",
    });
    await act(async () => {
      result.current.setInvocationsSnapshot([failedInvocation]);
      await result.current.activateInvocation(failedInvocation.id, {
        preferredInvocation: failedInvocation,
      });
    });
    restartInvocation(result.current.selectedInvocation?.id);

    expect(openDetail).toHaveBeenCalledWith("persisted-cli-preparation-1");
    expect(cancelInvocation).toHaveBeenCalledWith("persisted-cli-preparation-1");
    expect(restartInvocation).toHaveBeenCalledWith("persisted-planning-failure-2");
    expect([
      openDetail.mock.calls[0]?.[0],
      cancelInvocation.mock.calls[0]?.[0],
      restartInvocation.mock.calls[0]?.[0],
    ]).not.toContain(expect.stringMatching(/^optimistic:/));
  });

  it("polls only running invocation records", () => {
    const invocations: Pick<ExecutionInvocationRecord, "id" | "status">[] = [
      { id: "inv-completed", status: "completed" },
      { id: "inv-running-b", status: "running" },
      { id: "inv-queued", status: "queued" },
      { id: "inv-running-a", status: "running" },
    ];

    expect(getActiveInvocationPollingKey(invocations)).toBe("inv-running-a,inv-running-b");
  });
});
