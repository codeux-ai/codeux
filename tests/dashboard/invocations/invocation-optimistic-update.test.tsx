/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/preact";
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

describe("invocation optimistic updates", () => {
  it("shows optimistic invocation immediately and reconciles when server record arrives", async () => {
    const { result } = renderHook(() => {
      const cache = useMessageCache();
      return useInvocationPaneData({
        selectedProject: { id: "project-1" },
        cache,
      });
    });

    const sentAt = new Date().toISOString();
    act(() => {
      result.current.addOptimisticInvocation({ projectId: "project-1", createdAt: sentAt });
    });

    await waitFor(() => {
      expect(result.current.invocations).toHaveLength(1);
    });
    expect(result.current.invocations[0].id.startsWith("optimistic:")).toBe(true);

    act(() => {
      result.current.setInvocationsSnapshot([buildServerInvocation(sentAt)]);
    });

    expect(result.current.invocations).toHaveLength(1);
    expect(result.current.invocations[0].id).toBe("invocation-1");
  });
});
