/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { h } from "preact";
import * as matchers from "@testing-library/jest-dom/matchers";
/** @jsx h */

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn((_el, vars) => vars?.onComplete?.()),
    timeline: vi.fn(() => ({
      fromTo: vi.fn().mockReturnThis(),
      to: vi.fn().mockReturnThis(),
    })),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
  },
}));

const chatMocks = vi.hoisted(() => ({
  data: null as any,
  restartExecutionInvocation: vi.fn(),
  cancelExecutionInvocation: vi.fn(),
  refreshThreads: vi.fn(),
  activateInvocation: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-chat-page-data.js", () => ({
  useChatPageData: () => chatMocks.data,
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: () => ({ data: { settings: { git: { sprintKeyPrefix: "SPR" } } } }),
}));

vi.mock("../../../dashboard/src/v2/lib/invocation-api.js", () => ({
  restartExecutionInvocation: chatMocks.restartExecutionInvocation,
  cancelExecutionInvocation: chatMocks.cancelExecutionInvocation,
}));

import { ChatPageShell } from "../../../dashboard/src/v2/components/chat/ChatPageShell.js";
import { ChatRail } from "../../../dashboard/src/v2/components/chat/ChatRail.js";
import { EmptyChat } from "../../../dashboard/src/v2/components/chat/ChatEmptyState.js";
import { ChatPage } from "../../../dashboard/src/v2/ChatPage.js";

const mockProject = {
  id: "proj-1",
  name: "Test Project",
  description: "Test description",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const createInvocation = (overrides: Partial<any> = {}) => ({
  id: "inv-1",
  projectId: "proj-1",
  sprintId: null,
  taskId: null,
  sprintRunId: null,
  dispatchId: null,
  taskRunId: null,
  attentionItemId: null,
  providerInvocationId: null,
  type: "planning",
  status: "failed",
  provider: "codex",
  model: "gpt-5",
  systemPrompt: null,
  startedAt: "2024-01-01T00:00:00Z",
  finishedAt: "2024-01-01T00:01:00Z",
  errorMessage: null,
  lastErrorCategory: null,
  lastErrorMessage: "Provider failed",
  lastRetryAfterIso: null,
  messageCount: 0,
  lastMessageAt: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:01:00Z",
  ...overrides,
});

const createChatPageData = (overrides: Partial<any> = {}) => {
  const selectedInvocation = overrides.selectedInvocation ?? createInvocation();
  return {
    chatMode: "invocations",
    setChatMode: vi.fn(),
    threads: [],
    invocations: [selectedInvocation],
    selectedThreadId: null,
    selectedInvocationId: selectedInvocation?.id ?? null,
    messages: [],
    invocationMessages: [],
    input: "",
    setInput: vi.fn(),
    deletingThreadId: null,
    sending: false,
    compacting: false,
    error: null,
    selectedThread: null,
    selectedInvocation,
    selectedAgentPreset: null,
    activeConnection: null,
    pendingDashboardMessages: 0,
    hasWorkingReply: false,
    threadsLoading: false,
    threadMessagesLoading: false,
    connections: [],
    invocationsLoading: false,
    invocationMessagesLoading: false,
    refreshThreads: chatMocks.refreshThreads,
    activateThread: vi.fn(),
    activateInvocation: chatMocks.activateInvocation,
    handleCompactThread: vi.fn(),
    handleCancelActiveTurn: vi.fn(),
    isCancelling: false,
    handleSend: vi.fn(),
    navigateHistory: vi.fn(),
    handleDeleteThread: vi.fn(),
    createThreadForCompose: vi.fn(),
    threadIndex: new Map(),
    invocationIndex: new Map([[selectedInvocation?.id, selectedInvocation]]),
    selectedProject: mockProject,
    agentPresets: [],
    feedback: { status: "idle", message: null },
    clearFeedback: vi.fn(),
    isConfirmOpen: false,
    confirmOptions: null,
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
    ...overrides,
  };
};

const waitForDialogFocus = async (buttonName: RegExp | string) => {
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(screen.getByRole("button", { name: buttonName })).toHaveFocus());
  return dialog;
};

const getPageButton = (name: string | RegExp) => (
  screen.getAllByRole("button", { name }).find((button) => !button.closest('[role="dialog"]')) as HTMLButtonElement
);

describe("ChatPageShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatMocks.restartExecutionInvocation.mockResolvedValue({ invocationId: "inv-next" });
    chatMocks.cancelExecutionInvocation.mockResolvedValue({ cancelled: true, invocationId: "inv-1" });
    chatMocks.refreshThreads.mockResolvedValue(undefined);
    chatMocks.activateInvocation.mockResolvedValue(undefined);
    chatMocks.data = createChatPageData();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the empty state correctly when no project is selected", () => {
    const { getByText } = render(
      <ChatPageShell
        selectedProject={null}
        chatMode="threads"
        onSetChatMode={vi.fn()}
        onCreateThread={vi.fn()}
        pendingDashboardMessages={0}
        error={null}
        railSlot={<div data-testid="empty-rail" />}
        detailSlot={
          <EmptyChat
            tone="project"
            message="Choose or add a project from the top navigation to unlock stored chat threads, listener routing, and project-scoped conversation history."
          />
        }
      />
    );

    expect(getByText("Project Required")).toBeInTheDocument();
    expect(getByText("Ready When a Project Exists")).toBeInTheDocument();
    expect(
      getByText(
        "Choose or add a project from the top navigation to unlock stored chat threads, listener routing, and project-scoped conversation history."
      )
    ).toBeInTheDocument();
  });

  it("renders thread mode with rail and detail slots", () => {
    const { container, getByTestId, getByText, queryAllByText } = render(
      <ChatPageShell
        selectedProject={mockProject}
        chatMode="threads"
        onSetChatMode={vi.fn()}
        onCreateThread={vi.fn()}
        pendingDashboardMessages={2}
        error={null}
        railSlot={
          <ChatRail title="Threads" count={5}>
            <div data-testid="thread-list">Thread Content</div>
          </ChatRail>
        }
        detailSlot={<div data-testid="thread-detail">Detail Content</div>}
      />
    );

    expect(queryAllByText("Threads").length).toBeGreaterThan(0);
    expect(getByText("5")).toBeInTheDocument();
    expect(getByTestId("thread-list")).toBeInTheDocument();
    expect(getByTestId("thread-detail")).toBeInTheDocument();
    expect(getByText("2 pending")).toBeInTheDocument();

    // The chat header no longer exposes a manual refresh control.
    const refreshButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Refresh")
    );
    expect(refreshButton).toBeUndefined();

    // Verify mode tab ARIA state
    expect(container.querySelector('button[id="tab-threads"]')).toHaveAttribute("aria-selected", "true");
    expect(container.querySelector('button[id="tab-invocations"]')).toHaveAttribute("aria-selected", "false");
    // Verify animated ping element is present for pending messages
    expect(container.querySelector('.animate-ping')).toBeInTheDocument();
  });

  it("renders invocation mode with thread-specific buttons grayed out, not hidden", () => {
    const { container, getByTestId, getByText } = render(
      <ChatPageShell
        selectedProject={mockProject}
        chatMode="invocations"
        onSetChatMode={vi.fn()}
        onCreateThread={vi.fn()}
        pendingDashboardMessages={0}
        error={null}
        railSlot={
          <ChatRail title="Invocations" count={10}>
            <div data-testid="invocation-list">Invocation Content</div>
          </ChatRail>
        }
        detailSlot={<div data-testid="invocation-detail">Detail Content</div>}
      />
    );

    expect(getByTestId("invocation-list")).toBeInTheDocument();
    expect(getByText("10")).toBeInTheDocument();
    expect(getByTestId("invocation-detail")).toBeInTheDocument();

    // The New Thread button stays mounted (no layout shift when switching tabs)
    // but is disabled/grayed out since it doesn't apply to invocation mode.
    const newThreadButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("New Thread")
    );
    expect(newThreadButton).toBeDisabled();

    // The pending-messages badge also stays mounted, showing a muted "Inbox clear".
    expect(container.textContent).toContain("Inbox clear");
  });

  it("renders error state correctly", () => {
    const { getByText } = render(
      <ChatPageShell
        selectedProject={mockProject}
        chatMode="threads"
        onSetChatMode={vi.fn()}
        onCreateThread={vi.fn()}
        pendingDashboardMessages={0}
        error="Network failure"
        railSlot={<div />}
        detailSlot={<div />}
      />
    );

    expect(getByText("Network failure")).toBeInTheDocument();
  });

  it("confirms invocation restart with an accessible dialog, safe focus, and one action", async () => {
    render(<ChatPage />);

    fireEvent.click(getPageButton("Restart invocation"));
    const dialog = await waitForDialogFocus(/Keep Failed Invocation/i);
    expect(dialog).toHaveAccessibleName("Restart Invocation?");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    within(dialog).getByRole("button", { name: "Restart" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: /Keep Failed Invocation/i })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "Restart" }));

    await waitFor(() => expect(chatMocks.restartExecutionInvocation).toHaveBeenCalledTimes(1));
    expect(chatMocks.restartExecutionInvocation).toHaveBeenCalledWith("inv-1", "retry_full_prompt");
    expect(chatMocks.refreshThreads).toHaveBeenCalledWith({ mode: "invocations" });
    expect(chatMocks.activateInvocation).toHaveBeenCalledWith("inv-next", { foreground: true });
  });

  it("leaves invocation restart untouched when the confirmation is cancelled with Escape", async () => {
    render(<ChatPage />);

    fireEvent.click(getPageButton("Restart invocation"));
    await waitForDialogFocus(/Keep Failed Invocation/i);
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(chatMocks.restartExecutionInvocation).not.toHaveBeenCalled();
  });

  it("confirms invocation continuation and surfaces async failure without leaving the invocation context", async () => {
    chatMocks.restartExecutionInvocation.mockRejectedValueOnce(new Error("Continuation failed"));
    render(<ChatPage />);

    fireEvent.click(getPageButton("Continue invocation"));
    const dialog = await waitForDialogFocus(/Keep Failed Invocation/i);
    expect(dialog).toHaveAccessibleName("Continue Invocation?");

    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(chatMocks.restartExecutionInvocation).toHaveBeenCalledTimes(1));
    expect(chatMocks.restartExecutionInvocation).toHaveBeenCalledWith("inv-1", "continue_session");
    expect(await screen.findByRole("alert")).toHaveTextContent("Continuation failed");
    expect(screen.getByText("Provider failed")).toBeInTheDocument();
  });

  it("confirms invocation cancellation with safe focus and avoids side effects on dialog cancellation", async () => {
    chatMocks.data = createChatPageData({
      selectedInvocation: createInvocation({ status: "running", finishedAt: null, lastErrorMessage: null, messageCount: 1 }),
    });
    render(<ChatPage />);

    fireEvent.click(getPageButton("Cancel invocation"));
    const dialog = await waitForDialogFocus(/Keep Running/i);
    expect(dialog).toHaveAccessibleName("Cancel Invocation?");

    fireEvent.click(within(dialog).getByRole("button", { name: /Keep Running/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(chatMocks.cancelExecutionInvocation).not.toHaveBeenCalled();
  });
});
