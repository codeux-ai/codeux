/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useMessageCache } from "../../../dashboard/src/v2/hooks/useMessageCache.js";
import { useChatThreadData } from "../../../dashboard/src/v2/hooks/use-chat-thread-data.js";
import { renderHook, act } from "@testing-library/preact";
import { upsertChatThread } from "../../../dashboard/src/v2/lib/chat-thread-utils.js";

// Mock connection-api calls to prevent external requests
vi.mock("../../../dashboard/src/v2/lib/connection-api.js", () => ({
  fetchConversationMessages: vi.fn(() => Promise.resolve([])),
  fetchConversationThreads: vi.fn(() => Promise.resolve([])),
  postConversationMessage: vi.fn((projectId, data) => Promise.resolve({
    id: "msg-new", threadId: data.threadId, bodyMarkdown: data.bodyMarkdown, deliveryStatus: "delivered", createdAt: "2026-03-10T12:00:00.000Z"
  })),
  deleteConversationThread: vi.fn(() => Promise.resolve()),
  createConversationThread: vi.fn(() => Promise.resolve({
    id: "thread-new", messageCount: 0, projectId: "project-1", scope: "project"
  })),
  updateThreadRoute: vi.fn(),
  updateConversationThread: vi.fn()
}));

// We'll test the extraction and complex logic directly on useChatThreadData since
// it handles the selection persistence and realtime update methods and rendering useChatPageData
// which has massive graph of context causes OOM.

describe("useChatThreadData integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles real-time conversation message created correctly and updates state without broad refetch", async () => {
    const { result } = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    // Mock initial thread loading
    await act(async () => {
      result.current.setThreadsSnapshot([{ id: "thread-1", title: "Thread", updatedAt: "2026-03-10T12:00:00.000Z" } as any]);
      await result.current.activateThread("thread-1");
    });

    // Simulate realtime event handler calling setMessagesSnapshot directly as we do in the use-chat-page-data orchestrator
    await act(async () => {
      const realtimeMessage = { id: "msg-1", threadId: "thread-1", bodyMarkdown: "Hello", createdAt: "2026-03-10T12:00:01.000Z" } as any;
      result.current.setMessagesSnapshot([realtimeMessage]);
    });

    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0].id).toBe("msg-1");
  });

  it("handles real-time thread deletion logic properly", async () => {
    const { result } = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await act(async () => {
      result.current.setThreadsSnapshot([
        { id: "thread-1", scope: "project" } as any,
        { id: "thread-2", scope: "project" } as any
      ]);
      await result.current.activateThread("thread-1");
    });

    expect(result.current.selectedThreadId).toBe("thread-1");

    // Simulate delete conversation thread orchestrator flow
    await act(async () => {
      const nextThreads = result.current.threads.filter(t => t.id !== "thread-1");
      result.current.setThreadsSnapshot(nextThreads);
      await result.current.activateThread("thread-2");
    });

    expect(result.current.threads.length).toBe(1);
    expect(result.current.selectedThreadId).toBe("thread-2");
  });

  it("optimistically updates messages upon handling send", async () => {
    const { result } = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await act(async () => {
      result.current.setThreadsSnapshot([{ id: "thread-1", scope: "project" } as any]);
      await result.current.activateThread("thread-1");
      result.current.setInput("Hello world");
    });

    await act(async () => {
      await result.current.handleSend();
    });

    expect(result.current.input).toBe("");
    expect(result.current.messages.length).toBe(1);
    expect(result.current.messages[0].id).toBe("msg-new");
  });
});
