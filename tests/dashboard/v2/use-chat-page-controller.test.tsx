/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useChatPageController } from "../../../dashboard/src/v2/hooks/use-chat-page-controller.js";

vi.mock("gsap", () => ({ default: { fromTo: vi.fn() } }));

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: () => ({ selectedProject: { id: "proj-1", name: "Test Project" } }),
}));

vi.mock("../../../dashboard/src/hooks/useExecutions.js", () => ({
  useExecutions: () => ({ data: [], loading: false }),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: () => ({ data: null, loading: false }),
}));

vi.mock("../../../dashboard/src/v2/lib/project-worker-options.js", () => ({
  getProjectWorkerOptions: () => ({ options: [], selectedOption: null }),
}));

let mockMessages: any[] = [];
let mockThreads: any[] = [];
let mockInvocations: any[] = [];

vi.mock("../../../dashboard/src/v2/lib/connection-api.js", () => ({
  fetchConversationThreads: vi.fn(async () => mockThreads),
  fetchProjectConnections: vi.fn(async () => []),
  fetchConversationMessages: vi.fn(async () => mockMessages),
  createConversationThread: vi.fn(async () => {
    const thread = { id: "thread-new", title: "New Thread", messageCount: 0 };
    mockThreads.push(thread);
    return thread;
  }),
  postConversationMessage: vi.fn(async (projectId, req) => {
    const msg = { id: "msg-new", threadId: req.threadId, bodyMarkdown: req.bodyMarkdown, direction: "dashboard_to_connection", deliveryStatus: "pending", createdAt: new Date().toISOString() };
    mockMessages.push(msg);
    return msg;
  }),
  deleteConversationThread: vi.fn(async () => {}),
  updateConversationThread: vi.fn(),
  updateThreadRoute: vi.fn(),
  compactThreadSession: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/invocation-api.js", () => ({
  fetchProjectInvocations: vi.fn(async () => mockInvocations),
  fetchInvocationMessages: vi.fn(async () => []),
}));

let currentRealtimeCallback: any = null;
vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn((projectIds, callback) => {
    currentRealtimeCallback = callback;
    return () => { currentRealtimeCallback = null; };
  }),
}));

describe("useChatPageController", () => {
  beforeEach(() => {
    mockMessages = [];
    mockThreads = [
      { id: "thread-1", title: "Thread 1", messageCount: 1, updatedAt: new Date().toISOString() },
      { id: "thread-2", title: "Thread 2", messageCount: 0, updatedAt: new Date().toISOString() },
    ];
    mockInvocations = [];
    currentRealtimeCallback = null;
    vi.clearAllMocks();
  });

  it("loads threads and selects the first one initially", async () => {
    const { result } = renderHook(() => useChatPageController());

    await act(async () => {
      await result.current.refreshThreads();
    });

    expect(result.current.threads).toHaveLength(2);
    expect(result.current.selectedThreadId).toBe("thread-1");
  });

  it("optimistically adds a message when sending", async () => {
    const { result } = renderHook(() => useChatPageController());

    await act(async () => {
      await result.current.refreshThreads();
    });

    await act(async () => {
      await result.current.handleSend("Hello world", () => {});
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].bodyMarkdown).toBe("Hello world");
  });

  it("preserves selection when realtime thread update arrives", async () => {
    const { result } = renderHook(() => useChatPageController());

    await act(async () => {
      await result.current.refreshThreads();
    });

    expect(result.current.selectedThreadId).toBe("thread-1");

    await act(async () => {
      if (currentRealtimeCallback) {
        currentRealtimeCallback({
          type: "event",
          event: {
            eventType: "conversation.thread.updated",
            payload: { id: "thread-1", projectId: "proj-1", title: "Thread 1 Updated", messageCount: 1, updatedAt: new Date().toISOString() }
          }
        });
      }
    });

    expect(result.current.threads[0].title).toBe("Thread 1 Updated");
    expect(result.current.selectedThreadId).toBe("thread-1");
  });

  it("handles thread deletion optimistically", async () => {
    const { result } = renderHook(() => useChatPageController());

    await act(async () => {
      await result.current.refreshThreads();
    });

    expect(result.current.threads).toHaveLength(2);

    await act(async () => {
      await result.current.handleDeleteThread("thread-1");
    });

    expect(result.current.threads).toHaveLength(1);
    expect(result.current.threads[0].id).toBe("thread-2");
  });
});
