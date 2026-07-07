/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { getActiveInvocationPollingKey } from "../../../dashboard/src/v2/hooks/use-chat-page-data.js";
import { useInvocationPaneData } from "../../../dashboard/src/v2/hooks/use-invocation-pane-data.js";
import { useMessageCache } from "../../../dashboard/src/v2/hooks/useMessageCache.js";
import type { ExecutionInvocationRecord } from "../../../dashboard/src/v2/types.js";

const buildServerInvocation = (createdAt: string): ExecutionInvocationRecord => ({
  id: "invocation-1",
  projectId: "project-1",
  sprintId: null,
  taskId: null,
  sprintRunId: null,
  dispatchId: null,
  taskRunId: null,
  attentionItemId: null,
  providerInvocationId: null,
  type: "dashboard_reply",
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
    expect(result.current.invocationIndex.get("invocation-1")).toEqual(invocation);
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
