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
  postConversationMessage,
  upsertConversationDraft,
} from "../../../dashboard/src/v2/lib/connection-api.js";
import { fetchInvocationMessages, fetchProjectInvocations } from "../../../dashboard/src/v2/lib/invocation-api.js";

// Mock connection-api calls to prevent external requests
vi.mock("../../../dashboard/src/v2/lib/connection-api.js", () => ({
  fetchConversationMessages: vi.fn(() => Promise.resolve([])),
  fetchConversationThreads: vi.fn(() => Promise.resolve([])),
  fetchConversationDraft: vi.fn(() => Promise.resolve(null)),
  getOrCreateDashboardDraftUserId: vi.fn(() => "dashboard-user-test"),
  upsertConversationDraft: vi.fn(() => Promise.resolve(null)),
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
    mockRealtimeCallback = null;
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

  it("force-refreshes the selected invocation's messages on a project.execution.updated event", async () => {
    const refreshInvocationMessages = vi.fn();
    const selectedInvocationIdRef = { current: "inv-1" };

    renderHook(() => {
      const cache = useMessageCache();
      const threadData = useChatThreadData({
        selectedProject: { id: "proj-1" },
        cache,
        execution: null,
        workerRouting: null,
      });

      const invocationData = {
        selectedInvocationIdRef,
        setInvocationsSnapshot: vi.fn(),
        setInvocationMessagesSnapshot: vi.fn(),
        setSelectedInvocationId: vi.fn(),
        setError: vi.fn(),
        activateInvocation: vi.fn(),
        refreshInvocationMessages,
      } as any;

      useChatPageResources({
        selectedProject: { id: "proj-1" },
        cache,
        chatMode: "invocations",
        threadData,
        invocationData,
      });

      return { cache, threadData };
    });

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

    expect(refreshInvocationMessages).toHaveBeenCalledWith("inv-1", { force: true });
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
      await result.current.threadData.handleCreateAppQuickaction("web_app");
    });

    expect(createConversationThread).toHaveBeenCalledWith("proj-1", expect.objectContaining({
      title: expect.stringContaining("Project Chat"),
    }));
    expect(postConversationMessage).toHaveBeenCalledWith("proj-1", expect.objectContaining({
      threadId: "thread-new",
      bodyMarkdown: "Create a web app",
      metadata: {
        quickaction: expect.objectContaining({
          type: "create_app",
          kind: "web_app",
          requestId: expect.stringMatching(/^dashboard-create-app-web_app-/),
          templateId: "qs-create-web-app",
          stackSummary: {
            techstackId: "react-saas",
            techstackName: "React SaaS",
            applicationKind: "web_app",
            language: "TypeScript",
            framework: "React",
            runtime: "Node.js",
            packageManager: "pnpm",
            styling: "Tailwind",
            testFramework: "Vitest",
          },
          suggestionTags: ["TypeScript", "React", "Node.js", "pnpm", "Tailwind", "Vitest"],
        }),
      },
    }));
    const postedMetadata = vi.mocked(postConversationMessage).mock.calls[0]?.[1].metadata;
    expect(onMessageSending).not.toHaveBeenCalled();
    expect(result.current.threadData.input).toBe("");
    expect(result.current.threadData.messages[0]?.metadata).toEqual(postedMetadata);

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
