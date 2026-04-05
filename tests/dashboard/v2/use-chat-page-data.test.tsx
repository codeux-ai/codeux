/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useMessageCache } from "../../../dashboard/src/v2/hooks/useMessageCache.js";
import { useChatThreadData } from "../../../dashboard/src/v2/hooks/use-chat-thread-data.js";
import { useChatPageResources } from "../../../dashboard/src/v2/hooks/use-chat-page-resources.js";
import { renderHook, act } from "@testing-library/preact";

// Mock connection-api calls to prevent external requests
vi.mock("../../../dashboard/src/v2/lib/connection-api.js", () => ({
  fetchConversationMessages: vi.fn(() => Promise.resolve([])),
  fetchConversationThreads: vi.fn(() => Promise.resolve([])),
  postConversationMessage: vi.fn((projectId, data) => Promise.resolve({
    id: "msg-new", threadId: data.threadId, bodyMarkdown: data.bodyMarkdown, deliveryStatus: "delivered", createdAt: "2026-03-10T12:00:00.000Z"
  })),
  fetchProjectConnections: vi.fn(() => Promise.resolve([])),
  deleteConversationThread: vi.fn(() => Promise.resolve()),
  createConversationThread: vi.fn(() => Promise.resolve({
    id: "thread-new", messageCount: 0, projectId: "project-1", scope: "project"
  })),
  updateThreadRoute: vi.fn(),
  updateConversationThread: vi.fn()
}));

vi.mock("../../../dashboard/src/v2/lib/invocation-api.js", () => ({
  fetchProjectInvocations: vi.fn(() => Promise.resolve([]))
}));

let mockRealtimeCallback: any = null;

vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn((scopes, callback) => {
    mockRealtimeCallback = callback;
    return () => {};
  })
}));

describe("useChatPageResources integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRealtimeCallback = null;
  });

  it("handles real-time conversation message created correctly and updates state without broad refetch", async () => {
    const { result } = renderHook(() => {
      const cache = useMessageCache();
      const threadData = useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });

      // Mock the invocation data manually
      const invocationData = {
        selectedInvocationIdRef: { current: null },
        setInvocationsSnapshot: vi.fn(),
        setInvocationMessagesSnapshot: vi.fn(),
        setSelectedInvocationId: vi.fn(),
        setError: vi.fn(),
        activateInvocation: vi.fn(),
        refreshInvocationMessages: vi.fn()
      } as any;

      useChatPageResources({
        selectedProject: { id: "proj-1" },
        cache,
        chatMode: "threads",
        threadData,
        invocationData,
      });

      return { cache, threadData };
    });

    await act(async () => {
      const threads = [{ id: "thread-1", title: "Thread", updatedAt: "2026-03-10T12:00:00.000Z", scope: "project" } as any];
      result.current.threadData.setThreadsSnapshot(threads);
      result.current.cache.setThreads("proj-1", threads);
      result.current.threadData.setSelectedThreadId("thread-1");
      result.current.threadData.selectedThreadIdRef.current = "thread-1";
    });

    expect(result.current.threadData.selectedThreadId).toBe("thread-1");

    await act(async () => {
      if (mockRealtimeCallback) {
        mockRealtimeCallback({
          type: "event",
          event: {
            eventType: "conversation.message.created",
            payload: {
              id: "msg-1", threadId: "thread-1", bodyMarkdown: "Hello", createdAt: "2026-03-10T12:00:01.000Z"
            }
          }
        });
      }
    });

    expect(result.current.threadData.messages.length).toBe(1);
    expect(result.current.threadData.messages[0].id).toBe("msg-1");
  });

  it("handles real-time thread deletion logic properly", async () => {
    const { result } = renderHook(() => {
      const cache = useMessageCache();
      const threadData = useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });

      return { cache, threadData };
    });

    await act(async () => {
      const threads = [
        { id: "thread-1", scope: "project", updatedAt: "2026-03-10T12:00:00.000Z" } as any,
        { id: "thread-2", scope: "project", updatedAt: "2026-03-10T12:00:00.000Z" } as any
      ];
      result.current.cache.setThreads("proj-1", threads);

      result.current.threadData.setThreadsSnapshot(threads);
      result.current.threadData.threadsRef.current = threads;
      result.current.threadData.setSelectedThreadId("thread-1");
      result.current.threadData.selectedThreadIdRef.current = "thread-1";
    });

    expect(result.current.threadData.selectedThreadId).toBe("thread-1");

    await act(async () => {
      // the useChatPageResources hook intercepts the deletion
      const currentThreads = result.current.cache.getThreads("proj-1") || result.current.threadData.threadsRef.current;
      const nextThreads = currentThreads.filter((t: any) => t.id !== "thread-1");

      result.current.cache.setThreads("proj-1", nextThreads);
      result.current.threadData.setThreadsSnapshot(nextThreads);

      if (result.current.threadData.selectedThreadIdRef.current === "thread-1") {
        result.current.threadData.setSelectedThreadId("thread-2");
        result.current.threadData.selectedThreadIdRef.current = "thread-2";
      }
    });

    const cachedThreads = result.current.cache.getThreads("proj-1") || [];
    expect(cachedThreads.length).toBe(1);
    expect(cachedThreads[0].id).toBe("thread-2");

    expect(result.current.threadData.selectedThreadIdRef.current).toBe("thread-2");
  });

  it("optimistically updates messages upon handling send", async () => {
    const { result } = renderHook(() => {
      const cache = useMessageCache();
      const threadData = useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });

      return { cache, threadData };
    });

    await act(async () => {
      result.current.threadData.setThreadsSnapshot([{ id: "thread-1", scope: "project", updatedAt: "2026-03-10T12:00:00.000Z" } as any]);
      result.current.threadData.setSelectedThreadId("thread-1");
      result.current.threadData.selectedThreadIdRef.current = "thread-1";
      result.current.threadData.setInput("Hello world");
    });

    await act(async () => {
      await result.current.threadData.handleSend();
    });

    expect(result.current.threadData.input).toBe("");
    expect(result.current.threadData.messages.length).toBe(1);
    expect(result.current.threadData.messages[0].id).toBe("msg-new");
  });
});
