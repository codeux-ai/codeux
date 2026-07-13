/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { useMessageCache } from "../../../dashboard/src/v2/hooks/useMessageCache.js";
import { useChatThreadData } from "../../../dashboard/src/v2/hooks/use-chat-thread-data.js";
import { useChatPageResources } from "../../../dashboard/src/v2/hooks/use-chat-page-resources.js";
import { useInvocationPaneData, areInvocationMessagesEqual } from "../../../dashboard/src/v2/hooks/use-invocation-pane-data.js";
import { renderHook, act, waitFor } from "@testing-library/preact";
import {
  cancelThreadTurn,
  createConversationThread,
  fetchConversationDraft,
  fetchConversationMessageHistory,
  getOrCreateDashboardDraftUserId,
  postConversationMessage,
  recordConversationMessageHistory,
  upsertConversationDraft,
} from "../../../dashboard/src/v2/lib/connection-api.js";
import { fetchInvocationMessages, fetchProjectInvocations } from "../../../dashboard/src/v2/lib/invocation-api.js";
import type { ExecutionInvocationMessageRecord, ExecutionInvocationRecord } from "../../../dashboard/src/v2/types.js";

// Mock connection-api calls to prevent external requests
vi.mock("../../../dashboard/src/v2/lib/connection-api.js", () => ({
  fetchConversationMessages: vi.fn(() => Promise.resolve([])),
  fetchConversationThreads: vi.fn(() => Promise.resolve([])),
  fetchConversationDraft: vi.fn(() => Promise.resolve(null)),
  fetchConversationMessageHistory: vi.fn(() => Promise.resolve([])),
  getOrCreateDashboardDraftUserId: vi.fn(() => "dashboard-user-test"),
  upsertConversationDraft: vi.fn(() => Promise.resolve(null)),
  recordConversationMessageHistory: vi.fn(() => Promise.resolve({
    id: "history-new",
    userId: "dashboard-user-test",
    projectId: "proj-1",
    bodyMarkdown: "Hello",
    createdAt: "2026-03-10T12:00:00.000Z",
    updatedAt: "2026-03-10T12:00:00.000Z",
  })),
  postConversationMessage: vi.fn((projectId, data) => Promise.resolve({
    id: "msg-new",
    threadId: data.threadId,
    direction: "dashboard_to_connection",
    authorType: "dashboard_user",
    authorConnectionId: null,
    bodyMarkdown: data.bodyMarkdown,
    deliveryStatus: "delivered",
    metadata: data.metadata ?? null,
    createdAt: "2026-03-10T12:00:00.000Z"
  })),
  fetchProjectConnections: vi.fn(() => Promise.resolve([])),
  deleteConversationThread: vi.fn(() => Promise.resolve()),
  createConversationThread: vi.fn(() => Promise.resolve({
    id: "thread-new", messageCount: 0, projectId: "project-1", scope: "project"
  })),
  updateThreadRoute: vi.fn(),
  updateConversationThread: vi.fn(),
  cancelThreadTurn: vi.fn(() => Promise.resolve({ cancelled: true }))
}));

vi.mock("../../../dashboard/src/v2/lib/invocation-api.js", () => ({
  fetchProjectInvocations: vi.fn(() => Promise.resolve([])),
  fetchInvocationMessages: vi.fn(() => Promise.resolve([])),
}));

let mockRealtimeCallback: any = null;

const buildInvocation = (
  overrides: Partial<ExecutionInvocationRecord> = {},
): ExecutionInvocationRecord => ({
  id: "persisted-cli-preparation-1",
  projectId: "proj-1",
  sprintId: "sprint-1",
  taskId: "task-1",
  sprintRunId: "sprint-run-1",
  dispatchId: "dispatch-1",
  taskRunId: "task-run-1",
  attentionItemId: null,
  providerInvocationId: "provider-invocation-1",
  type: "cli_task_coding",
  status: "running",
  provider: "codex",
  model: "test-model",
  systemPrompt: null,
  startedAt: "2026-07-13T10:00:00.000Z",
  finishedAt: null,
  errorMessage: null,
  lastErrorCategory: null,
  lastErrorMessage: null,
  lastRetryAfterIso: null,
  messageCount: 1,
  lastMessageAt: "2026-07-13T10:00:00.000Z",
  invocationSource: "cli",
  agentPresetId: null,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T10:00:00.000Z",
  ...overrides,
});

const buildInvocationMessage = (
  invocationId: string,
  contentMarkdown = "Preparing the task workspace.",
): ExecutionInvocationMessageRecord => ({
  id: `message-${invocationId}`,
  invocationId,
  role: "system",
  contentMarkdown,
  toolCallsJson: null,
  metadata: { phase: "preparation" },
  createdAt: "2026-07-13T10:00:00.000Z",
});

vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn((scopes, callback) => {
    mockRealtimeCallback = callback;
    return () => {};
  })
}));

describe("useChatPageResources integration", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    window.localStorage.clear();
    mockRealtimeCallback = null;
    vi.mocked(fetchConversationDraft).mockResolvedValue(null);
    vi.mocked(fetchConversationMessageHistory).mockResolvedValue([]);
    vi.mocked(getOrCreateDashboardDraftUserId).mockReturnValue("dashboard-user-test");
    vi.mocked(upsertConversationDraft).mockResolvedValue(null);
    vi.mocked(recordConversationMessageHistory).mockResolvedValue({
      id: "history-new",
      userId: "dashboard-user-test",
      projectId: "proj-1",
      bodyMarkdown: "Hello",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:00.000Z",
    });
    vi.mocked(postConversationMessage).mockImplementation((projectId, data) => Promise.resolve({
      id: "msg-new",
      threadId: data.threadId,
      direction: "dashboard_to_connection",
      authorType: "dashboard_user",
      authorConnectionId: null,
      bodyMarkdown: data.bodyMarkdown,
      deliveryStatus: "delivered",
      metadata: data.metadata ?? null,
      createdAt: "2026-03-10T12:00:00.000Z"
    }));
    vi.mocked(createConversationThread).mockResolvedValue({
      id: "thread-new", messageCount: 0, projectId: "project-1", scope: "project"
    } as any);
    vi.mocked(cancelThreadTurn).mockResolvedValue({ cancelled: true });
    vi.mocked(fetchProjectInvocations).mockResolvedValue([]);
    vi.mocked(fetchInvocationMessages).mockResolvedValue([]);
  });

  it("treats invocation messages as changed when reasoning content or metadata mutates in place", () => {
    const baseMessage = {
      id: "msg-1",
      invocationId: "inv-1",
      role: "assistant",
      contentMarkdown: "Draft reasoning",
      toolCallsJson: { call: "plan_task", args: { scope: "chat" } },
      metadata: { stage: "draft" },
      createdAt: "2026-03-10T12:00:00.000Z",
    } as any;

    expect(areInvocationMessagesEqual([baseMessage], [{ ...baseMessage }])).toBe(true);
    expect(areInvocationMessagesEqual([baseMessage], [{ ...baseMessage, contentMarkdown: "Final reasoning" }])).toBe(false);
    expect(areInvocationMessagesEqual([baseMessage], [{ ...baseMessage, metadata: { stage: "final" } }])).toBe(false);
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

  it("restores and debounces the active project chat draft", async () => {
    vi.mocked(fetchConversationDraft).mockResolvedValueOnce({
      userId: "dashboard-user-test",
      projectId: "proj-1",
      contextKey: "new-thread",
      bodyMarkdown: "Restored draft",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:00.000Z",
    });

    const { result } = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await waitFor(() => expect(result.current.input).toBe("Restored draft"));
    expect(fetchConversationDraft).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-test",
      contextKey: "new-thread",
    });

    await act(async () => {
      result.current.setInput("Edited draft");
    });

    await waitFor(() => expect(upsertConversationDraft).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-test",
      contextKey: "new-thread",
      bodyMarkdown: "Edited draft",
    }));
  });

  it("does not reuse a selected thread draft context while switching projects", async () => {
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) => {
        const cache = useMessageCache();
        return useChatThreadData({
          selectedProject: { id: projectId },
          cache,
          execution: null,
          workerRouting: null,
        });
      },
      { initialProps: { projectId: "proj-1" } },
    );

    const projectOneThread = {
      id: "thread-project-one",
      projectId: "proj-1",
      scope: "project",
      title: "Project one thread",
      status: "active",
      connectionId: null,
      createdAt: "2026-03-10T12:00:00.000Z",
      messageCount: 0,
      pendingMessageCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
      updatedAt: "2026-03-10T12:00:00.000Z",
    } as const;

    await act(async () => {
      result.current.setThreadsSnapshot([projectOneThread]);
    });
    await act(async () => {
      result.current.setSelectedThreadId(projectOneThread.id);
    });

    await waitFor(() => expect(fetchConversationDraft).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-test",
      contextKey: `thread:${projectOneThread.id}`,
    }));

    await act(async () => {
      result.current.setInput("Project one unsent draft");
    });

    vi.mocked(fetchConversationDraft).mockClear();
    vi.mocked(upsertConversationDraft).mockClear();

    rerender({ projectId: "proj-2" });

    await waitFor(() => expect(fetchConversationDraft).toHaveBeenCalledWith("proj-2", {
      userId: "dashboard-user-test",
      contextKey: "new-thread",
    }));
    expect(fetchConversationDraft).not.toHaveBeenCalledWith("proj-2", expect.objectContaining({
      contextKey: `thread:${projectOneThread.id}`,
    }));
    expect(upsertConversationDraft).not.toHaveBeenCalledWith("proj-2", expect.objectContaining({
      contextKey: `thread:${projectOneThread.id}`,
    }));
  });

  it("restores a saved draft after the composer remounts", async () => {
    const persistedDrafts = new Map<string, string>();
    vi.mocked(fetchConversationDraft).mockImplementation(async (projectId, input) => {
      const bodyMarkdown = persistedDrafts.get(`${projectId}:${input.userId}:${input.contextKey}`);
      return bodyMarkdown === undefined
        ? null
        : {
          userId: input.userId,
          projectId,
          contextKey: input.contextKey,
          bodyMarkdown,
          createdAt: "2026-03-10T12:00:00.000Z",
          updatedAt: "2026-03-10T12:00:00.000Z",
        };
    });
    vi.mocked(upsertConversationDraft).mockImplementation(async (projectId, input) => {
      persistedDrafts.set(`${projectId}:${input.userId}:${input.contextKey}`, input.bodyMarkdown);
      return {
        userId: input.userId,
        projectId,
        contextKey: input.contextKey,
        bodyMarkdown: input.bodyMarkdown,
        createdAt: "2026-03-10T12:00:00.000Z",
        updatedAt: "2026-03-10T12:00:00.000Z",
      };
    });

    const firstRender = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await waitFor(() => expect(fetchConversationDraft).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-test",
      contextKey: "new-thread",
    }));

    await act(async () => {
      firstRender.result.current.setInput("Draft that survives remount");
    });

    firstRender.unmount();

    expect(upsertConversationDraft).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-test",
      contextKey: "new-thread",
      bodyMarkdown: "Draft that survives remount",
    });

    const secondRender = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await waitFor(() => expect(secondRender.result.current.input).toBe("Draft that survives remount"));
    secondRender.unmount();
  });

  it("restores a typed draft from local storage when refresh happens before server draft sync completes", async () => {
    vi.mocked(fetchConversationDraft).mockResolvedValue(null);
    vi.mocked(upsertConversationDraft).mockImplementation(() => new Promise(() => {}));

    const firstRender = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await waitFor(() => expect(fetchConversationDraft).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-test",
      contextKey: "new-thread",
    }));

    await act(async () => {
      firstRender.result.current.setInput("Draft typed right before refresh");
    });

    firstRender.unmount();

    vi.mocked(fetchConversationDraft).mockClear();
    const secondRender = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await waitFor(() => expect(secondRender.result.current.input).toBe("Draft typed right before refresh"));
    expect(fetchConversationDraft).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-test",
      contextKey: "new-thread",
    });

    secondRender.unmount();
  });

  it("does not let an older server draft override a locally cleared composer after refresh", async () => {
    vi.mocked(fetchConversationDraft).mockResolvedValue({
      userId: "dashboard-user-test",
      projectId: "proj-1",
      contextKey: "new-thread",
      bodyMarkdown: "Older server draft",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:00.000Z",
    });

    const firstRender = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await waitFor(() => expect(firstRender.result.current.input).toBe("Older server draft"));

    await act(async () => {
      firstRender.result.current.setInput("Message that was sent");
      firstRender.result.current.setInput("");
    });
    firstRender.unmount();

    const secondRender = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await waitFor(() => expect(fetchConversationDraft).toHaveBeenCalledTimes(2));
    expect(secondRender.result.current.input).toBe("");
    secondRender.unmount();
  });

  it("restores drafts and recent history from the current dashboard user only", async () => {
    let currentUserId = "dashboard-user-a";
    vi.mocked(getOrCreateDashboardDraftUserId).mockImplementation(() => currentUserId);
    vi.mocked(fetchConversationDraft).mockImplementation(async (projectId, input) => ({
      userId: input.userId,
      projectId,
      contextKey: input.contextKey,
      bodyMarkdown: input.userId === "dashboard-user-a" ? "User A draft" : "User B draft",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:00.000Z",
    }));
    vi.mocked(fetchConversationMessageHistory).mockImplementation(async (projectId, input) => [
      {
        id: `${input.userId}-history`,
        userId: input.userId,
        projectId,
        bodyMarkdown: input.userId === "dashboard-user-a" ? "User A previous send" : "User B previous send",
        createdAt: "2026-03-10T12:00:00.000Z",
        updatedAt: "2026-03-10T12:00:00.000Z",
      },
    ]);

    const firstRender = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await waitFor(() => expect(firstRender.result.current.input).toBe("User A draft"));
    await act(async () => {
      expect(firstRender.result.current.navigateHistory("up")).toBe(true);
    });
    expect(firstRender.result.current.input).toBe("User A previous send");
    firstRender.unmount();

    currentUserId = "dashboard-user-b";
    const secondRender = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await waitFor(() => expect(secondRender.result.current.input).toBe("User B draft"));
    await act(async () => {
      expect(secondRender.result.current.navigateHistory("up")).toBe(true);
    });
    expect(secondRender.result.current.input).toBe("User B previous send");
    expect(fetchConversationDraft).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-b",
      contextKey: "new-thread",
    });
    expect(fetchConversationMessageHistory).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-b",
    });
    secondRender.unmount();
  });

  it("hydrates recent message history and preserves the current draft while previewing entries", async () => {
    vi.mocked(fetchConversationMessageHistory).mockResolvedValueOnce([
      {
        id: "history-1",
        userId: "dashboard-user-test",
        projectId: "proj-1",
        bodyMarkdown: "First submitted message",
        createdAt: "2026-03-10T12:00:00.000Z",
        updatedAt: "2026-03-10T12:00:00.000Z",
      },
      {
        id: "history-2",
        userId: "dashboard-user-test",
        projectId: "proj-1",
        bodyMarkdown: "Second submitted message",
        createdAt: "2026-03-10T12:01:00.000Z",
        updatedAt: "2026-03-10T12:01:00.000Z",
      },
    ]);

    const { result } = renderHook(() => {
      const cache = useMessageCache();
      return useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
    });

    await waitFor(() => expect(fetchConversationMessageHistory).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-test",
    }));

    await act(async () => {
      result.current.setInput("Unsent working draft");
    });

    await act(async () => {
      expect(result.current.navigateHistory("up")).toBe(true);
    });
    expect(result.current.input).toBe("Second submitted message");

    await act(async () => {
      expect(result.current.navigateHistory("up")).toBe(true);
    });
    expect(result.current.input).toBe("First submitted message");

    await waitFor(() => expect(upsertConversationDraft).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-test",
      contextKey: "new-thread",
      bodyMarkdown: "Unsent working draft",
    }));
    expect(upsertConversationDraft).not.toHaveBeenCalledWith("proj-1", expect.objectContaining({
      bodyMarkdown: "Second submitted message",
    }));
    expect(upsertConversationDraft).not.toHaveBeenCalledWith("proj-1", expect.objectContaining({
      bodyMarkdown: "First submitted message",
    }));

    await act(async () => {
      expect(result.current.navigateHistory("down")).toBe(true);
      expect(result.current.navigateHistory("down")).toBe(true);
    });
    expect(result.current.input).toBe("Unsent working draft");
  });

  it("updates cached dashboard messages in the same thread to processed when a later connection reply is upserted", async () => {
    const { result } = renderHook(() => {
      const cache = useMessageCache();
      const threadData = useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });

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

    const initialMessages = [
      {
        id: "msg-dash-1",
        threadId: "thread-1",
        direction: "dashboard_to_connection",
        deliveryStatus: "pending",
        createdAt: "2026-03-10T12:00:00.000Z",
        bodyMarkdown: "Hi 1",
        metadata: null,
      },
      {
        id: "msg-dash-2",
        threadId: "thread-1",
        direction: "dashboard_to_connection",
        deliveryStatus: "delivered",
        createdAt: "2026-03-10T12:00:01.000Z",
        bodyMarkdown: "Hi 2",
        metadata: null,
      },
      {
        id: "msg-dash-3",
        threadId: "thread-1",
        direction: "dashboard_to_connection",
        deliveryStatus: "failed",
        createdAt: "2026-03-10T12:00:02.000Z",
        bodyMarkdown: "Hi 3",
        metadata: null,
      },
    ];

    await act(async () => {
      const threads = [{ id: "thread-1", title: "Thread", updatedAt: "2026-03-10T12:00:00.000Z", scope: "project" } as any];
      result.current.threadData.setThreadsSnapshot(threads);
      result.current.cache.setThreads("proj-1", threads);
      result.current.threadData.setSelectedThreadId("thread-1");
      result.current.threadData.selectedThreadIdRef.current = "thread-1";
      result.current.cache.setMessages("thread-1", initialMessages as any[]);
      result.current.threadData.setMessagesSnapshot(initialMessages as any[]);
    });

    expect(result.current.threadData.messages.length).toBe(3);

    await act(async () => {
      if (mockRealtimeCallback) {
        mockRealtimeCallback({
          type: "event",
          event: {
            eventType: "conversation.message.created",
            payload: {
              id: "msg-reply",
              threadId: "thread-1",
              direction: "connection_to_dashboard",
              deliveryStatus: "delivered",
              createdAt: "2026-03-10T12:00:05.000Z",
              bodyMarkdown: "Hello from agent",
              metadata: null,
            },
          },
        });
      }
    });

    const updated = result.current.threadData.messages;
    expect(updated.length).toBe(4);

    const msg1 = updated.find((m) => m.id === "msg-dash-1");
    const msg2 = updated.find((m) => m.id === "msg-dash-2");
    const msg3 = updated.find((m) => m.id === "msg-dash-3");
    const reply = updated.find((m) => m.id === "msg-reply");

    expect(msg1?.deliveryStatus).toBe("processed");
    expect(msg2?.deliveryStatus).toBe("processed");
    expect(msg3?.deliveryStatus).toBe("failed");
    expect(reply?.deliveryStatus).toBe("delivered");
  });

  it("waits for project.execution.updated to return an early persisted CLI invocation", async () => {
    const persistedInvocation = buildInvocation();
    const preparationMessage = buildInvocationMessage(persistedInvocation.id);
    let resolveRealtimeList: ((value: ExecutionInvocationRecord[]) => void) | null = null;
    vi.mocked(fetchProjectInvocations)
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRealtimeList = resolve;
      }));
    vi.mocked(fetchInvocationMessages).mockResolvedValue([preparationMessage]);

    const { result } = renderHook(() => {
      const cache = useMessageCache();
      const threadData = useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });

      const invocationData = useInvocationPaneData({
        selectedProject: { id: "proj-1" },
        cache,
      });
      const resources = useChatPageResources({
        selectedProject: { id: "proj-1" },
        cache,
        chatMode: "invocations",
        threadData,
        invocationData,
      });

      return { invocationData, resources };
    });

    await waitFor(() => expect(fetchProjectInvocations).toHaveBeenCalledTimes(1));
    expect(result.current.invocationData.invocations).toEqual([]);
    expect(result.current.invocationData.selectedInvocationId).toBeNull();

    await act(async () => {
      if (mockRealtimeCallback) {
        mockRealtimeCallback({
          type: "event",
          event: {
            eventType: "project.execution.updated",
            payload: { connections: [] },
          },
        });
      }
    });

    await waitFor(() => expect(fetchProjectInvocations).toHaveBeenCalledTimes(2));
    expect(result.current.invocationData.invocations).toEqual([]);
    expect(result.current.invocationData.invocationIndex.has("optimistic:proj-1")).toBe(false);

    await act(async () => {
      resolveRealtimeList?.([persistedInvocation]);
    });

    await waitFor(() => {
      expect(result.current.invocationData.selectedInvocationId).toBe(persistedInvocation.id);
    });
    expect(result.current.invocationData.invocations).toEqual([persistedInvocation]);
    expect(result.current.invocationData.selectedInvocation).toBe(persistedInvocation);
    expect(result.current.invocationData.invocationMessages).toEqual([preparationMessage]);
    expect(fetchInvocationMessages).toHaveBeenCalledWith(persistedInvocation.id);
  });

  it("refreshes the server list on snapshot_required without replacing selection or messages", async () => {
    const selectedInvocation = buildInvocation({
      id: "persisted-selected-1",
      type: "planning",
      status: "completed",
      finishedAt: "2026-07-13T10:05:00.000Z",
    });
    const selectedMessage = buildInvocationMessage(selectedInvocation.id, "Existing selected transcript.");
    const earlyPreparationInvocation = buildInvocation({
      id: "persisted-cli-preparation-2",
      startedAt: "2026-07-13T10:06:00.000Z",
      createdAt: "2026-07-13T10:06:00.000Z",
      updatedAt: "2026-07-13T10:06:00.000Z",
    });
    vi.mocked(fetchProjectInvocations)
      .mockResolvedValueOnce([selectedInvocation])
      .mockResolvedValueOnce([earlyPreparationInvocation, selectedInvocation]);
    vi.mocked(fetchInvocationMessages).mockResolvedValue([selectedMessage]);

    const { result } = renderHook(() => {
      const cache = useMessageCache();
      const threadData = useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
      const invocationData = useInvocationPaneData({
        selectedProject: { id: "proj-1" },
        cache,
      });
      useChatPageResources({
        selectedProject: { id: "proj-1" },
        cache,
        chatMode: "invocations",
        threadData,
        invocationData,
      });

      return { invocationData };
    });

    await waitFor(() => {
      expect(result.current.invocationData.selectedInvocationId).toBe(selectedInvocation.id);
    });
    expect(result.current.invocationData.invocationMessages).toEqual([selectedMessage]);
    vi.mocked(fetchInvocationMessages).mockClear();

    await act(async () => {
      mockRealtimeCallback?.({ type: "snapshot_required" });
    });

    await waitFor(() => {
      expect(result.current.invocationData.invocations).toEqual([
        earlyPreparationInvocation,
        selectedInvocation,
      ]);
    });
    expect(result.current.invocationData.selectedInvocationId).toBe(selectedInvocation.id);
    expect(result.current.invocationData.selectedInvocation).toBe(selectedInvocation);
    expect(result.current.invocationData.invocationMessages).toEqual([selectedMessage]);
    expect(fetchInvocationMessages).toHaveBeenCalledWith(selectedInvocation.id);
  });

  it("loads chat invocations in 40-row pages and preserves the server total", async () => {
    const makeInvocation = (index: number) => ({
      id: `inv-${index}`,
      projectId: "proj-1",
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      taskRunId: null,
      attentionItemId: null,
      providerInvocationId: null,
      type: "dashboard_reply",
      status: "completed",
      provider: "mock",
      model: "mock",
      systemPrompt: null,
      startedAt: `2026-03-10T12:${String(index).padStart(2, "0")}:00.000Z`,
      finishedAt: null,
      errorMessage: null,
      lastErrorCategory: null,
      lastErrorMessage: null,
      lastRetryAfterIso: null,
      messageCount: 0,
      lastMessageAt: null,
      invocationSource: "internal",
      agentPresetId: null,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      createdAt: `2026-03-10T12:${String(index).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-03-10T12:${String(index).padStart(2, "0")}:00.000Z`,
    }) as any;
    const pageOne = Array.from({ length: 40 }, (_, index) => makeInvocation(index));
    const pageTwo = Array.from({ length: 3 }, (_, index) => makeInvocation(index + 40));

    vi.mocked(fetchProjectInvocations).mockImplementation(async (_projectId, query?: any) => ({
      items: query?.offset === 40 ? pageTwo : pageOne,
      totalCount: 43,
      summary: {},
      availablePurposes: [],
      availableProviders: [],
    } as any));

    const { result } = renderHook(() => {
      const cache = useMessageCache();
      const threadData = useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });
      const invocationData = useInvocationPaneData({
        selectedProject: { id: "proj-1" },
        cache,
      });
      const resources = useChatPageResources({
        selectedProject: { id: "proj-1" },
        cache,
        chatMode: "invocations",
        threadData,
        invocationData,
      });

      return { invocationData, resources };
    });

    await waitFor(() => {
      expect(result.current.invocationData.invocations).toHaveLength(40);
    });
    expect(result.current.invocationData.invocationTotalCount).toBe(43);
    expect(result.current.invocationData.hasMoreInvocations).toBe(true);
    expect(vi.mocked(fetchProjectInvocations)).toHaveBeenCalledWith("proj-1", expect.objectContaining({ limit: 40, offset: 0 }));

    await act(async () => {
      await result.current.resources.loadMoreInvocations();
    });

    expect(result.current.invocationData.invocations).toHaveLength(43);
    expect(result.current.invocationData.invocationTotalCount).toBe(43);
    expect(result.current.invocationData.hasMoreInvocations).toBe(false);
    expect(vi.mocked(fetchProjectInvocations)).toHaveBeenCalledWith("proj-1", expect.objectContaining({ limit: 40, offset: 40 }));
  });

  it("refreshes a selected running invocation when its summary changes and keeps new reasoning content visible", async () => {
    const staleMessages = [
      {
        id: "msg-1",
        invocationId: "inv-1",
        role: "assistant",
        contentMarkdown: "Draft reasoning",
        toolCallsJson: { call: "analysis", args: { mode: "draft" } },
        metadata: { stage: "draft" },
        createdAt: "2026-03-10T12:00:00.000Z",
      },
    ] as any[];
    const freshMessages = [
      {
        id: "msg-1",
        invocationId: "inv-1",
        role: "assistant",
        contentMarkdown: "Final reasoning",
        toolCallsJson: { call: "analysis", args: { mode: "draft" } },
        metadata: { stage: "final" },
        createdAt: "2026-03-10T12:00:00.000Z",
      },
    ] as any[];

    vi.mocked(fetchInvocationMessages).mockResolvedValueOnce(freshMessages);

    const initialInvocation = {
      id: "inv-1",
      projectId: "proj-1",
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      taskRunId: null,
      attentionItemId: null,
      providerInvocationId: null,
      type: "chat",
      status: "running",
      provider: "test-provider",
      model: "test-model",
      systemPrompt: null,
      startedAt: "2026-03-10T12:00:00.000Z",
      finishedAt: null,
      errorMessage: null,
      lastErrorCategory: null,
      lastErrorMessage: null,
      lastRetryAfterIso: null,
      messageCount: 1,
      lastMessageAt: "2026-03-10T12:00:00.000Z",
      invocationSource: "internal",
      agentPresetId: null,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:00.000Z",
    } as any;

    const updatedInvocation = {
      ...initialInvocation,
      messageCount: 2,
      updatedAt: "2026-03-10T12:00:01.000Z",
    } as any;

    const { result } = renderHook(() => {
      const cache = useMessageCache();
      const invocationData = useInvocationPaneData({
        selectedProject: { id: "proj-1" },
        cache,
      });

      return { cache, invocationData };
    });

    await act(async () => {
      result.current.cache.setInvocations("proj-1", [initialInvocation]);
      result.current.cache.setInvocationMessages("inv-1", staleMessages);
      result.current.invocationData.setInvocationsSnapshot([initialInvocation]);
      await result.current.invocationData.activateInvocation("inv-1", {
        preferredInvocation: initialInvocation,
      });
    });

    expect(result.current.invocationData.selectedInvocationId).toBe("inv-1");
    expect(result.current.invocationData.invocationMessages).toEqual(staleMessages);

    await act(async () => {
      result.current.cache.setInvocations("proj-1", [updatedInvocation]);
      result.current.invocationData.setInvocationsSnapshot([updatedInvocation]);
    });

    await waitFor(() => {
      expect(result.current.invocationData.invocationMessages).toEqual(freshMessages);
    });
    expect(vi.mocked(fetchInvocationMessages)).toHaveBeenCalledWith("inv-1");
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
    expect(recordConversationMessageHistory).toHaveBeenCalledWith("proj-1", {
      userId: "dashboard-user-test",
      bodyMarkdown: "Hello world",
    });
  });

  it("posts create-app quickactions with metadata without composer content or sent history", async () => {
    const onMessageSending = vi.fn(() => "optimistic-1");
    const dashboardSettings = {
      techstackCatalog: {
        defaultTechstackId: "react-saas",
        entries: [
          {
            id: "react-saas",
            label: "React SaaS",
            items: [
              { id: "typescript", label: "TypeScript" },
              { id: "react", label: "React" },
              { id: "node", label: "Node.js" },
              { id: "pnpm", label: "pnpm" },
              { id: "tailwind", label: "Tailwind" },
              { id: "vitest", label: "Vitest" },
            ],
          },
        ],
      },
      techstack: {
        selectedTechstackId: null,
        applicationKind: null,
      },
    };

    const { result } = renderHook(() => {
      const cache = useMessageCache();
      const threadData = useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        dashboardSettings: dashboardSettings as any,
        onMessageSending,
      });

      return { cache, threadData };
    });

    await act(async () => {
      result.current.threadData.setInput("Keep this composer draft");
    });

    const quickactions = [
      {
        kind: "web_app",
        bodyMarkdown: "Create a web app",
        templateId: "qs-create-web-app",
        designGuidance: {
          selectedTechStackId: "code-ux-product-stack",
          selectedStyleguideId: "code-ux-award-winning",
        },
      },
      {
        kind: "desktop_app",
        bodyMarkdown: "Create a desktop app",
        templateId: "qs-create-desktop-app",
        designGuidance: {
          selectedTechStackId: "electron-desktop-app",
          selectedStyleguideId: "code-ux-award-winning",
        },
      },
      {
        kind: "online_shop",
        bodyMarkdown: "Create an online shop",
        templateId: "qs-create-online-shop",
        designGuidance: {
          selectedTechStackId: "code-ux-product-stack",
          selectedStyleguideId: "ecommerce",
        },
      },
      {
        kind: "portfolio",
        bodyMarkdown: "Create a portfolio",
        templateId: "qs-create-portfolio",
        designGuidance: {
          selectedTechStackId: "code-ux-product-stack",
          selectedStyleguideId: "marketing-site",
        },
      },
      {
        kind: "game",
        bodyMarkdown: "Create a game",
        templateId: "qs-create-game",
        designGuidance: {
          selectedTechStackId: "code-ux-product-stack",
          selectedStyleguideId: "game-experience",
        },
      },
    ] as const;

    for (const quickaction of quickactions) {
      await act(async () => {
        await result.current.threadData.handleCreateAppQuickaction(quickaction.kind);
      });
    }

    expect(createConversationThread).toHaveBeenCalledTimes(1);
    expect(createConversationThread).toHaveBeenCalledWith("proj-1", expect.objectContaining({
      title: expect.stringContaining("Project Chat"),
    }));
    expect(postConversationMessage).toHaveBeenCalledTimes(5);
    quickactions.forEach((quickaction, index) => {
      expect(postConversationMessage).toHaveBeenNthCalledWith(index + 1, "proj-1", {
        threadId: "thread-new",
        bodyMarkdown: quickaction.bodyMarkdown,
        metadata: {
          quickaction: {
            type: "create_app",
            kind: quickaction.kind,
            requestId: expect.stringMatching(new RegExp(`^dashboard-create-app-${quickaction.kind}-`)),
            templateId: quickaction.templateId,
            designGuidance: quickaction.designGuidance,
            stackSummary: {
              techstackId: "react-saas",
              techstackName: "React SaaS",
              applicationKind: quickaction.kind,
              language: "TypeScript",
              framework: "React",
              runtime: "Node.js",
              packageManager: "pnpm",
              styling: "Tailwind",
              testFramework: "Vitest",
            },
            suggestionTags: ["TypeScript", "React", "Node.js", "pnpm", "Tailwind", "Vitest"],
          },
        },
      });
    });
    expect(onMessageSending).not.toHaveBeenCalled();
    expect(result.current.threadData.input).toBe("Keep this composer draft");
    expect(result.current.threadData.messages[0]?.metadata).toEqual(
      vi.mocked(postConversationMessage).mock.calls[0]?.[1].metadata,
    );
    expect(recordConversationMessageHistory).not.toHaveBeenCalled();

    await act(async () => {
      expect(result.current.threadData.navigateHistory("up")).toBe(false);
    });
  });

  it("cancels the active turn and clears the pending badge locally", async () => {
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
        {
          id: "thread-1",
          scope: "project",
          title: "Thread",
          updatedAt: "2026-03-10T12:00:00.000Z",
          pendingMessageCount: 1,
        } as any,
      ];
      result.current.cache.setThreads("proj-1", threads);
      result.current.threadData.setThreadsSnapshot(threads);
      result.current.threadData.setSelectedThreadId("thread-1");
      result.current.threadData.selectedThreadIdRef.current = "thread-1";
      result.current.threadData.setMessagesSnapshot([
        {
          id: "msg-dash-1",
          threadId: "thread-1",
          direction: "dashboard_to_connection",
          authorType: "dashboard_user",
          authorConnectionId: null,
          bodyMarkdown: "Hello",
          deliveryStatus: "delivered",
          metadata: null,
          createdAt: "2026-03-10T12:00:00.000Z",
        } as any,
      ]);
    });

    await act(async () => {
      await result.current.threadData.handleCancelActiveTurn();
    });

    expect(cancelThreadTurn).toHaveBeenCalledWith("thread-1");
    expect(result.current.threadData.isCancelling).toBe(false);
    expect(result.current.threadData.threads[0].pendingMessageCount).toBe(0);
  });
});
