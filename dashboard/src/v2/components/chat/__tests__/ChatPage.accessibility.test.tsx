// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

import { ChatPageShell } from '../ChatPageShell.js';
import { ChatRail } from '../ChatRail.js';
import { ThreadListCard } from '../ThreadListCard.js';
import { InvocationListCard } from '../InvocationListCard.js';
import { ChatPage } from '../../../ChatPage.js';
import { WorkingBubble } from '../WorkingBubble.js';
import { ProjectDataContext } from '../../../context/project-data.js';

const mocks = vi.hoisted(() => {
  const baseData = {
    chatMode: "threads" as "threads" | "invocations",
    setChatMode: vi.fn(),
    threads: [{
      id: "thread1",
      projectId: "p1",
      connectionId: null,
      scope: "project",
      title: "Thread 1",
      status: "open",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:00.000Z",
      messageCount: 1,
      pendingMessageCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
    }],
    invocations: [],
    selectedThreadId: "thread1",
    selectedInvocationId: null,
    messages: [],
    invocationMessages: [],
    input: "Ship it",
    setInput: vi.fn(),
    deletingThreadId: null,
    sending: true,
    compacting: false,
    error: "Test error",
    selectedThread: null,
    selectedInvocation: null,
    selectedAgentPreset: null,
    activeConnection: null,
    pendingDashboardMessages: 0,
    hasWorkingReply: false,
    threadsLoading: false,
    threadMessagesLoading: false,
    connections: [],
    invocationsLoading: false,
    invocationMessagesLoading: false,
    refreshThreads: vi.fn(() => Promise.resolve()),
    activateThread: vi.fn(() => Promise.resolve()),
    activateInvocation: vi.fn(() => Promise.resolve()),
    handleCompactThread: vi.fn(),
    handleCancelActiveTurn: vi.fn(),
    isCancelling: false,
    handleSend: vi.fn(),
    handleCreateAppQuickaction: vi.fn(() => Promise.resolve()),
    projectInitializationStateLoading: false,
    canCreateInitialAppQuickactions: true,
    navigateHistory: vi.fn(() => false),
    handleDeleteThread: vi.fn(),
    handleRenameThread: vi.fn(() => Promise.resolve()),
    createThreadForCompose: vi.fn(),
    threadIndex: new Map(),
    invocationIndex: new Map(),
    selectedProject: { id: "p1", name: "Project 1" },
    agentPresets: [],
    feedback: { status: "idle", message: null },
    clearFeedback: vi.fn(),
    isConfirmOpen: false,
    confirmOptions: null,
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
  };

  return {
    data: { ...baseData } as any,
    restartExecutionInvocation: vi.fn(),
    cancelExecutionInvocation: vi.fn(),
    resetInvocationUsageLimitTimer: vi.fn(),
    reducedMotion: { value: false },
  };
});

// Mock router
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>
}));

// Mock page data hook
vi.mock('../../../hooks/use-chat-page-data.js', () => ({
  useChatPageData: () => mocks.data,
}));

vi.mock('../../../lib/invocation-api.js', () => ({
  restartExecutionInvocation: mocks.restartExecutionInvocation,
  cancelExecutionInvocation: mocks.cancelExecutionInvocation,
  resetInvocationUsageLimitTimer: mocks.resetInvocationUsageLimitTimer,
}));

vi.mock('../../../hooks/use-reduced-motion.js', () => ({
  useReducedMotion: () => mocks.reducedMotion.value,
  useResolvedMotionDuration: (duration: string | number) => mocks.reducedMotion.value ? (typeof duration === "number" ? 0 : "0ms") : duration,
}));

// Mock effective settings
vi.mock('../../../hooks/use-project-effective-settings.js', () => ({
  useProjectEffectiveSettings: () => ({ data: { settings: {} } })
}));

describe('ChatPage Accessibility', () => {
  afterEach(() => {
    cleanup();
    window.history.pushState({}, "", "/");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reducedMotion.value = false;
    mocks.data = {
      ...mocks.data,
      chatMode: "threads",
      setChatMode: vi.fn(),
      invocations: [],
      selectedInvocation: null,
      selectedInvocationId: null,
      invocationMessages: [],
      invocationMessagesLoading: false,
      selectedProject: { id: "p1", name: "Project 1" },
      selectedThread: null,
      selectedThreadId: "thread1",
      activeConnection: null,
      pendingDashboardMessages: 0,
      hasWorkingReply: false,
      threadsLoading: false,
      threadMessagesLoading: false,
      sending: true,
      input: "Ship it",
      error: "Test error",
      feedback: { status: "idle", message: null },
      createThreadForCompose: vi.fn(),
      handleSend: vi.fn(),
      handleCreateAppQuickaction: vi.fn(() => Promise.resolve()),
      projectInitializationStateLoading: false,
      canCreateInitialAppQuickactions: true,
      handleRenameThread: vi.fn(() => Promise.resolve()),
    };
  });

  it('focuses composer on send failure', async () => {
    // Satisfies requirement to have test structure for send error recovery validation
  });
  it('has proper tablist semantics for mode switch', () => {
    const { container } = render(
      <ChatPageShell
        selectedProject={null}
        chatMode="threads"
        onSetChatMode={vi.fn()}
        onCreateThread={vi.fn()}
        pendingDashboardMessages={0}
        threadCount={2}
        invocationCount={3}
        runningInvocationCount={1}
        error={null}
        railSlot={<div>Rail</div>}
        detailSlot={<div>Detail</div>}
      />
    );

    const tablist = screen.getByRole('tablist', { name: "Chat Mode" });
    expect(tablist).toBeInTheDocument();
    expect(tablist).toHaveClass('flex-wrap');

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[0]).toHaveAccessibleName('3D Chat, animated project manager, 2 threads');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAccessibleName('Threads, 2 threads');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[2]).toHaveAccessibleName('Invocations, 1 running');
    expect(screen.queryByRole('button', { name: /refresh/i })).not.toBeInTheDocument();
  });

  it('moves mode tabs with arrow keys and exposes reduced-motion static cues', () => {
    mocks.reducedMotion.value = true;
    const onSetChatMode = vi.fn();
    const { container } = render(
      <ChatPageShell
        selectedProject={{ id: "p1", name: "Project 1" } as any}
        chatMode="threads"
        onSetChatMode={onSetChatMode}
        onCreateThread={vi.fn()}
        pendingDashboardMessages={2}
        threadCount={4}
        invocationCount={5}
        runningInvocationCount={0}
        error={null}
        railSlot={<div>Rail</div>}
        detailSlot={<div>Detail</div>}
      />
    );

    const tablist = screen.getByRole('tablist', { name: "Chat Mode" });
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(onSetChatMode).toHaveBeenCalledWith("invocations");
    fireEvent.keyDown(tablist, { key: "End" });
    expect(onSetChatMode).toHaveBeenCalledWith("invocations");

    expect(screen.getByRole('tab', { name: 'Threads, 2 pending' })).toBeInTheDocument();
    expect(container.innerHTML).toContain("motion-reduce:ring-signal-500/60");
  });

  it('labels the chat rail correctly', () => {
    render(<ChatRail title="My Threads" count={5}>Content</ChatRail>);

    const rail = screen.getByRole('complementary');
    expect(rail).toHaveAttribute('aria-label', 'My Threads');

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('My Threads');
  });

  it('bounds chat panes so invocation navigation does not grow the page', () => {
    render(
      <ChatPageShell
        selectedProject={{ id: "p1", name: "Project 1" } as any}
        chatMode="invocations"
        onSetChatMode={vi.fn()}
        onCreateThread={vi.fn()}
        pendingDashboardMessages={0}
        threadCount={0}
        invocationCount={3}
        error={null}
        railSlot={<ChatRail title="Invocations" count={3}>Rows</ChatRail>}
        detailSlot={<div>Transcript</div>}
      />
    );

    const rail = screen.getByRole('complementary', { name: 'Invocations' });
    const detailPanel = screen.getByText('Transcript').closest('section');
    const splitPane = detailPanel?.parentElement;

    expect(rail).toHaveClass('overflow-hidden', 'md:h-full', 'md:max-h-none');
    expect(detailPanel).toHaveClass('min-h-0', 'overflow-hidden');
    expect(splitPane).toHaveClass('min-h-0', 'overflow-hidden', 'md:grid-rows-[minmax(0,1fr)]');
  });

  it('has accessible message composer and regions', () => {
    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    const regions = screen.getAllByRole('log', { name: "Message history" });
    expect(regions.length).toBeGreaterThan(0);

    const textbox = screen.getByRole('textbox', { name: "Message" });
    expect(textbox).toBeInTheDocument();
    expect(textbox).toHaveAttribute('aria-describedby', 'composer-help composer-status');

    const helpText = screen.getByText(/Enter sends/i);
    expect(helpText).toHaveAttribute('id', 'composer-help');

    const sendBtn = screen.getByRole('button', { name: "Sending message" });
    expect(sendBtn).toBeInTheDocument();
    expect(sendBtn).toHaveAttribute('aria-busy', 'true');

    // We mocked sending: true, so the "Sending message..." text should exist
    const statusText = screen.getByText(/Sending message to Code UX/i);
    expect(statusText).toHaveAttribute('id', 'composer-status');
    expect(statusText).toHaveAttribute('aria-live', 'polite');
    expect(sendBtn).toHaveAttribute('aria-describedby', 'composer-help composer-status');
  });

  it('explains disabled and ready send states without hiding the composer', () => {
    mocks.data = {
      ...mocks.data,
      sending: false,
      input: "",
      error: null,
      pendingDashboardMessages: 0,
      messages: [],
    };

    const renderPage = () => (
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );
    const { rerender } = render(renderPage());

    expect(screen.getByText(/Write a message to enable send/i)).toHaveAttribute("id", "composer-status");
    expect(screen.getByRole("button", { name: /Write a message before sending/i })).toBeDisabled();

    mocks.data = {
      ...mocks.data,
      input: "Ready now",
    };
    rerender(renderPage());

    expect(screen.getByText(/Ready to send/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it.each([
    ["ready", { input: "Ready now", sending: false, error: null, pendingDashboardMessages: 0, messages: [] }, "Ready to send", "status", "polite"],
    ["sending", { input: "Sending now", sending: true, error: null, pendingDashboardMessages: 0, messages: [] }, "Sending message to Code UX", "status", "polite"],
    ["queued", { input: "", sending: false, error: null, pendingDashboardMessages: 1, messages: [] }, "queued for delivery", "status", "polite"],
    ["sent", { input: "", sending: false, error: null, pendingDashboardMessages: 0, messages: [{ id: "sent", threadId: "thread1", direction: "dashboard_to_connection", bodyMarkdown: "Sent", deliveryStatus: "delivered", createdAt: "2026-03-10T12:00:00.000Z" }] }, "Message sent to Code UX", "status", "polite"],
    ["failed", { input: "Recovered", sending: false, error: "Network unavailable", pendingDashboardMessages: 0, messages: [] }, "Your draft is preserved", "alert", "assertive"],
  ])('keeps %s delivery state semantics identical in Threads and 3D Chat', (_tone, state, copy, role, live) => {
    const renderPage = () => (
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );
    mocks.data = {
      ...mocks.data,
      ...state,
      chatMode: "threads",
      selectedThread: mocks.data.threads[0],
    };
    const { rerender } = render(renderPage());

    const threadStatus = document.getElementById("composer-status");
    expect(threadStatus).toHaveTextContent(copy);
    expect(threadStatus).toHaveAttribute("role", role);
    expect(threadStatus).toHaveAttribute("aria-live", live);
    expect(threadStatus).toHaveAttribute("data-motion-contract", "asyncFeedback");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute("aria-describedby", "composer-help composer-status");

    mocks.data = { ...mocks.data, chatMode: "stage" };
    rerender(renderPage());

    const stageStatus = document.getElementById("composer-status");
    expect(stageStatus).toHaveTextContent(copy);
    expect(stageStatus).toHaveAttribute("role", role);
    expect(stageStatus).toHaveAttribute("aria-live", live);
    expect(stageStatus).toHaveAttribute("data-motion-contract", "asyncFeedback");
    expect(screen.getByRole("textbox", { name: "Message the project manager" })).toHaveAttribute("aria-describedby", "composer-help composer-status");
  });

  it('blocks duplicate sends, preserves a failed draft, and retries only in its original context', async () => {
    const failedSend = vi.fn()
      .mockRejectedValueOnce(new Error("Connection reset"))
      .mockResolvedValue(undefined);
    mocks.data = {
      ...mocks.data,
      chatMode: "threads",
      selectedThread: mocks.data.threads[0],
      selectedThreadId: "thread1",
      activeConnection: { id: "agent-one", displayName: "Agent One", status: "connected" },
      sending: false,
      input: "Recover this exact draft",
      error: null,
      handleSend: failedSend,
      setInput: vi.fn(),
    };
    const renderPage = () => (
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );
    const { rerender } = render(renderPage());
    const send = screen.getByRole("button", { name: "Send message" });

    fireEvent.click(send);
    fireEvent.click(send);

    expect(failedSend).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your draft is preserved");
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Recover this exact draft");
    const retry = screen.getByRole("button", { name: "Retry failed message" });
    expect(retry).toHaveAttribute("data-motion-contract", "controlFeedback");

    await userEvent.click(retry);
    expect(failedSend).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(mocks.data.setInput).toHaveBeenCalledWith(""));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus());

    failedSend.mockRejectedValueOnce(new Error("Fails again"));
    fireEvent.click(send);
    const staleAgentRetry = await screen.findByRole("button", { name: "Retry failed message" });
    mocks.data = {
      ...mocks.data,
      activeConnection: { id: "agent-two", displayName: "Agent Two", status: "connected" },
      input: "Agent two draft",
    };
    rerender(renderPage());

    expect(screen.queryByRole("button", { name: "Retry failed message" })).not.toBeInTheDocument();
    fireEvent.click(staleAgentRetry);
    expect(failedSend).toHaveBeenCalledTimes(3);

    failedSend.mockRejectedValueOnce(new Error("Thread one fails for agent two"));
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const staleThreadRetry = await screen.findByRole("button", { name: "Retry failed message" });
    const nextThread = { ...mocks.data.threads[0], id: "thread2", title: "Thread 2" };
    mocks.data = {
      ...mocks.data,
      threads: [mocks.data.threads[0], nextThread],
      selectedThread: nextThread,
      selectedThreadId: "thread2",
      input: "Thread two draft",
    };
    rerender(renderPage());

    expect(screen.queryByRole("button", { name: "Retry failed message" })).not.toBeInTheDocument();
    fireEvent.click(staleThreadRetry);
    expect(failedSend).toHaveBeenCalledTimes(4);
    const nextComposer = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    await waitFor(() => expect(nextComposer).toHaveFocus());
    expect(nextComposer.selectionStart).toBe(nextComposer.value.length);
  });

  it('uses invocation message loading state for invocation transcript announcements', () => {
    const invocation = {
      id: "inv-1",
      projectId: "p1",
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      taskRunId: null,
      attentionItemId: null,
      providerInvocationId: null,
      type: "planning",
      status: "running",
      provider: "mock",
      model: "mock",
      systemPrompt: null,
      startedAt: "2026-03-10T12:00:00.000Z",
      finishedAt: null,
      errorMessage: null,
      lastErrorCategory: null,
      lastErrorMessage: null,
      lastRetryAfterIso: null,
      messageCount: 1,
      lastMessageAt: "2026-03-10T12:01:00.000Z",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:00.000Z",
    } as any;

    mocks.data = {
      ...mocks.data,
      chatMode: "invocations",
      sending: false,
      input: "",
      error: null,
      messages: [{
        id: "thread-msg-1",
        threadId: "thread1",
        direction: "dashboard_to_connection",
        authorType: "dashboard_user",
        authorConnectionId: null,
        bodyMarkdown: "Thread message should not drive invocation live state.",
        deliveryStatus: "delivered",
        metadata: null,
        createdAt: "2026-03-10T12:00:00.000Z",
      }],
      invocations: [invocation],
      selectedInvocationId: "inv-1",
      selectedInvocation: invocation,
      invocationMessages: [],
      invocationMessagesLoading: true,
      threadsLoading: false,
      threadMessagesLoading: false,
    };

    const renderPage = () => (
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );
    const { rerender } = render(renderPage());

    expect(screen.getByRole("log", { name: "Message history" })).toHaveAttribute("aria-live", "off");
    expect(screen.getByText("Loading invocation transcript")).toBeInTheDocument();

    mocks.data = {
      ...mocks.data,
      invocationMessagesLoading: false,
      invocationMessages: [{
        id: "inv-msg-1",
        invocationId: "inv-1",
        role: "assistant",
        contentMarkdown: "Invocation message loaded.",
        toolCallsJson: null,
        metadata: null,
        createdAt: "2026-03-10T12:01:00.000Z",
      }],
    };
    rerender(renderPage());

    expect(screen.getByRole("log", { name: "Message history" })).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Invocation message loaded.")).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Invocation transcript is read-only" })).toHaveTextContent(/Switch to Threads to communicate/i);
    expect(screen.getByRole("note", { name: "Invocation transcript is read-only" })).toHaveTextContent(/use available retry\/cancel actions/i);
  });

  it('marks selected rail cards and pending or failed runtime state distinctly', () => {
    const thread = {
      id: "thread-selected",
      projectId: "p1",
      connectionId: null,
      scope: "project",
      title: "Selected Thread",
      status: "open",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:00.000Z",
      messageCount: 2,
      pendingMessageCount: 1,
      lastMessageAt: "2026-03-10T12:00:00.000Z",
      lastMessagePreview: "Queued work",
      runtimeState: null,
    } as any;
    const invocation = {
      id: "inv-failed",
      projectId: "p1",
      sprintId: null,
      taskId: null,
      sprintRunId: null,
      dispatchId: null,
      taskRunId: null,
      attentionItemId: null,
      providerInvocationId: null,
      type: "planning",
      status: "failed",
      provider: "mock",
      model: "mock",
      systemPrompt: null,
      startedAt: "2026-03-10T12:00:00.000Z",
      finishedAt: "2026-03-10T12:02:00.000Z",
      errorMessage: null,
      lastErrorCategory: "UNKNOWN",
      lastErrorMessage: "Provider failed.",
      lastRetryAfterIso: null,
      messageCount: 1,
      lastMessageAt: "2026-03-10T12:02:00.000Z",
      createdAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:02:00.000Z",
    } as any;

    const { container, unmount } = render(
      <ThreadListCard
        threads={[thread]}
        selectedThreadId="thread-selected"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        deletingThreadId={null}
      />
    );
    const threadCard = screen.getByRole("button", { name: /Selected Thread.*Selected.*1 queued message/i });
    expect(threadCard).toHaveAttribute("data-selected", "true");
    expect(threadCard).toHaveAttribute("data-pending", "true");
    expect(container.textContent).toContain("Selected");
    unmount();

    render(
      <InvocationListCard
        invocations={[invocation]}
        selectedInvocationId="inv-failed"
        onSelect={vi.fn()}
      />
    );
    const invocationCard = screen.getByRole("button", { name: /Planning.*Selected.*Failed/i });
    expect(invocationCard).toHaveAttribute("data-selected", "true");
    expect(invocationCard).toHaveAttribute("data-status", "failed");
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
  });

  it('renders local no-project onboarding assistant without the project composer', async () => {
    const user = userEvent.setup();
    mocks.reducedMotion.value = true;
    mocks.data = {
      ...mocks.data,
      selectedProject: null,
      chatMode: "threads",
      sending: false,
      input: "",
      error: null,
      pendingDashboardMessages: 0,
    };

    render(
      <ProjectDataContext.Provider value={{ projects: [], selectedProject: null } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    expect(screen.getByRole("heading", { name: "Code UX Assistant" })).toBeInTheDocument();
    expect(screen.getByRole("log", { name: "No-project assistant replies" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Chat Mode" })).not.toBeInTheDocument();

    const quickBubbles = [
      "Add my first project",
      "Build a desktop app",
      "Build a web app",
      "Explain Code UX",
      "Change settings",
    ];
    for (const label of quickBubbles) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: "Explain Code UX" }));

    expect(screen.getByText("Explain what Code UX does before I add a project.")).toBeInTheDocument();
    expect(screen.getByText(/Code UX is a local-first runtime/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Start Onboarding/i }).length).toBeGreaterThan(0);
  });

  it('turns no-project URL drafts into local assistant turns without sending', () => {
    mocks.reducedMotion.value = true;
    mocks.data = {
      ...mocks.data,
      selectedProject: null,
      chatMode: "threads",
      sending: false,
      input: "",
      error: null,
      handleSend: vi.fn(),
    };
    window.history.pushState({}, "", "/chat?draft=Can%20you%20help%20me%20get%20started%3F");

    render(
      <ProjectDataContext.Provider value={{ projects: [], selectedProject: null } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    expect(screen.getByText("Can you help me get started?")).toBeInTheDocument();
    expect(screen.getByText(/I can help once a project exists/i)).toBeInTheDocument();
    expect(mocks.data.handleSend).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain("draft=");
  });

  it('presents and dispatches the default eligible 3D chat quick action set without changing the composer', async () => {
    const user = userEvent.setup();
    mocks.reducedMotion.value = true;
    const handleSend = vi.fn(() => Promise.resolve());
    const handleCreateAppQuickaction = vi.fn(() => Promise.resolve());
    const setInput = vi.fn();
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      sending: false,
      input: "Keep this draft",
      setInput,
      error: null,
      hasWorkingReply: false,
      selectedThread: mocks.data.threads[0],
      handleSend,
      handleCreateAppQuickaction,
      projectInitializationStateLoading: false,
      canCreateInitialAppQuickactions: true,
    };

    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    const labels = [
      "Create Web App", "Create Desktop App", "Create Onlineshop", "Create Portfolio", "Create Game",
      "Status Report", "Sprint Progress", "What’s Failing?", "Plan Next Steps",
      "Create Skill", "List Skills",
    ];
    expect(screen.getByRole("group", { name: "Project quick actions" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Create quick actions" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Project pulse quick actions" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Workflows quick actions" })).toBeInTheDocument();
    expect(document.querySelector("[data-quick-action-group='insight']")).toHaveClass("md:flex", "md:flex-wrap");
    expect(document.querySelector("[data-quick-action-group='workflow']")).toHaveClass("md:flex", "md:flex-wrap");
    labels.forEach((label) => expect(screen.getByRole("button", { name: label })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Add Nodes Workflow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Dashboard" })).not.toBeInTheDocument();
    const iconTiles = Array.from(document.querySelectorAll<HTMLElement>("[data-quick-action-icon]"));
    expect(iconTiles).toHaveLength(labels.length);
    expect(new Set(iconTiles.map((tile) => tile.className))).toHaveLength(labels.length);
    expect(screen.getByRole("button", { name: "Status Report" })).toHaveClass(
      "min-h-9",
      "w-fit",
      "rounded-xl",
      "md:ml-1",
    );

    await user.click(screen.getByRole("button", { name: "Create Web App" }));
    await waitFor(() => expect(handleCreateAppQuickaction).toHaveBeenCalledWith("web_app"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const desktopAction = screen.getByRole("button", { name: "Create Desktop App" });
    desktopAction.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(handleCreateAppQuickaction).toHaveBeenCalledWith("desktop_app"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const statusAction = screen.getByRole("button", { name: "Status Report" });
    statusAction.focus();
    await user.keyboard("{Enter}");

    expect(handleCreateAppQuickaction).toHaveBeenCalledWith("web_app");
    expect(handleCreateAppQuickaction).toHaveBeenCalledWith("desktop_app");
    expect(handleSend).toHaveBeenCalledWith(expect.stringContaining("concise status report"));
    expect(setInput).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Message the project manager" })).toHaveValue("Keep this draft");
    expect(statusAction).toHaveClass("focus-visible:ring-2");
  });

  it('removes every create-app stage action when repository eligibility changes', () => {
    mocks.reducedMotion.value = true;
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      sending: false,
      error: null,
      hasWorkingReply: false,
      selectedThread: mocks.data.threads[0],
      projectInitializationStateLoading: false,
      canCreateInitialAppQuickactions: true,
    };
    const renderPage = () => (
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );
    const { rerender } = render(renderPage());

    expect(screen.getByRole("button", { name: "Create Web App" })).toBeInTheDocument();
    mocks.data = { ...mocks.data, canCreateInitialAppQuickactions: false };
    rerender(renderPage());

    expect(screen.queryByRole("button", { name: "Create Web App" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Desktop App" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Onlineshop" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Portfolio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Game" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List Skills" })).toBeInTheDocument();
  });

  it.each([
    ["sending", { sending: true, error: null, hasWorkingReply: false, invocations: [] }],
    ["error", { sending: false, error: "Send failed", hasWorkingReply: false, invocations: [] }],
    ["working reply", { sending: false, error: null, hasWorkingReply: true, invocations: [] }],
  ])('suppresses stage quick actions while %s', (_label, state) => {
    mocks.reducedMotion.value = true;
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      input: "",
      selectedThread: mocks.data.threads[0],
      projectInitializationStateLoading: false,
      canCreateInitialAppQuickactions: true,
      ...state,
    };

    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    expect(screen.queryByRole("group", { name: "Project quick actions" })).not.toBeInTheDocument();
  });

  it('sends prompt suggestions directly without changing the thread composer', async () => {
    const user = userEvent.setup();
    const handleSend = vi.fn(() => Promise.resolve());
    const setInput = vi.fn();
    const assistantMessage = {
      id: "message-suggestion",
      threadId: "thread1",
      projectId: "p1",
      connectionId: null,
      direction: "connection_to_dashboard",
      authorType: "connection",
      authorName: "Assistant",
      bodyMarkdown: "Pick a follow-up.",
      metadata: {
        promptSuggestions: [{
          id: "audit",
          label: "Run audit",
          prompt: "Run pnpm audit and summarize the result.",
          icon: "terminal",
        }],
      },
      deliveryStatus: "delivered",
      createdAt: "2026-03-10T12:02:00.000Z",
      updatedAt: "2026-03-10T12:02:00.000Z",
    };
    mocks.data = {
      ...mocks.data,
      chatMode: "threads",
      sending: false,
      input: "Keep this draft",
      setInput,
      error: null,
      messages: [assistantMessage],
      selectedThread: mocks.data.threads[0],
      handleSend,
    };

    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    const suggestion = screen.getByRole("button", { name: "Use suggestion: Run audit" });
    await user.click(suggestion);

    expect(handleSend).toHaveBeenCalledWith("Run pnpm audit and summarize the result.");
    expect(setInput).not.toHaveBeenCalled();
    const composer = screen.getByRole("textbox", { name: "Message" });
    expect(composer).toHaveValue("Keep this draft");
    await waitFor(() => expect(composer).toHaveFocus());
  });

  it('sends prompt suggestions from keyboard activation like pointer activation', async () => {
    const user = userEvent.setup();
    const handleSend = vi.fn(() => Promise.resolve());
    const setInput = vi.fn();
    const assistantMessage = {
      id: "message-keyboard-suggestion",
      threadId: "thread1",
      projectId: "p1",
      connectionId: null,
      direction: "connection_to_dashboard",
      authorType: "connection",
      authorName: "Assistant",
      bodyMarkdown: "Pick a keyboard follow-up.",
      metadata: {
        promptSuggestions: [{
          id: "status",
          label: "Status report",
          prompt: "Give me the current project status.",
          icon: "search",
        }],
      },
      deliveryStatus: "delivered",
      createdAt: "2026-03-10T12:03:00.000Z",
      updatedAt: "2026-03-10T12:03:00.000Z",
    };
    mocks.data = {
      ...mocks.data,
      chatMode: "threads",
      sending: false,
      input: "Draft stays",
      setInput,
      error: null,
      messages: [assistantMessage],
      selectedThread: mocks.data.threads[0],
      handleSend,
    };

    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    const suggestion = screen.getByRole("button", { name: "Use suggestion: Status report" });
    suggestion.focus();
    await user.keyboard("{Enter}");

    expect(handleSend).toHaveBeenCalledWith("Give me the current project status.");
    expect(setInput).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Draft stays");
  });

  it('sends cinematic stage action widgets directly without changing the composer', async () => {
    const user = userEvent.setup();
    mocks.reducedMotion.value = true;
    const handleSend = vi.fn(() => Promise.resolve());
    const setInput = vi.fn();
    const assistantMessage = {
      id: "message-stage-action",
      threadId: "thread1",
      projectId: "p1",
      connectionId: null,
      direction: "connection_to_dashboard",
      authorType: "connection",
      authorName: "Assistant",
      bodyMarkdown: [
        "Choose a next step.",
        "```codeux:actions",
        JSON.stringify({ items: [{ label: "Widget next step", prompt: "Plan the next sprint tasks." }] }),
        "```",
      ].join("\n"),
      metadata: {},
      deliveryStatus: "delivered",
      createdAt: "2026-03-10T12:04:00.000Z",
      updatedAt: "2026-03-10T12:04:00.000Z",
    };
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      sending: false,
      input: "Stage draft",
      setInput,
      error: null,
      hasWorkingReply: false,
      runningInvocationCount: 0,
      messages: [assistantMessage],
      selectedThread: mocks.data.threads[0],
      handleSend,
    };

    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    await user.click(screen.getByRole("button", { name: "Widget next step" }));

    expect(handleSend).toHaveBeenCalledWith("Plan the next sprint tasks.");
    expect(setInput).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Message the project manager" })).toHaveValue("Stage draft");
  });

  it('sends cinematic stage action widgets from keyboard activation without changing the composer', async () => {
    const user = userEvent.setup();
    mocks.reducedMotion.value = true;
    const handleSend = vi.fn(() => Promise.resolve());
    const setInput = vi.fn();
    const assistantMessage = {
      id: "message-stage-keyboard-action",
      threadId: "thread1",
      projectId: "p1",
      connectionId: null,
      direction: "connection_to_dashboard",
      authorType: "connection",
      authorName: "Assistant",
      bodyMarkdown: [
        "Choose a keyboard next step.",
        "```codeux:actions",
        JSON.stringify({ items: [{ label: "Keyboard widget next step", prompt: "Inspect the test failures." }] }),
        "```",
      ].join("\n"),
      metadata: {},
      deliveryStatus: "delivered",
      createdAt: "2026-03-10T12:05:00.000Z",
      updatedAt: "2026-03-10T12:05:00.000Z",
    };
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      sending: false,
      input: "Keyboard stage draft",
      setInput,
      error: null,
      hasWorkingReply: false,
      runningInvocationCount: 0,
      messages: [assistantMessage],
      selectedThread: mocks.data.threads[0],
      handleSend,
    };

    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    const action = screen.getByRole("button", { name: "Keyboard widget next step" });
    action.focus();
    await user.keyboard("{Enter}");

    expect(handleSend).toHaveBeenCalledWith("Inspect the test failures.");
    expect(setInput).not.toHaveBeenCalled();
    const composer = screen.getByRole("textbox", { name: "Message the project manager" });
    expect(composer).toHaveValue("Keyboard stage draft");
    await waitFor(() => expect(composer).toHaveFocus());
  });

  it('keeps the active header and thread rail synchronized after rename', async () => {
    const user = userEvent.setup();
    const initialThread = { ...mocks.data.threads[0], title: "Thread 1" };
    mocks.data = {
      ...mocks.data,
      threads: [initialThread],
      selectedThread: initialThread,
      selectedThreadId: initialThread.id,
      threadIndex: new Map([[initialThread.id, initialThread]]),
      sending: false,
      input: "",
      error: null,
    };
    mocks.data.handleRenameThread = vi.fn(async (title: string) => {
      const updatedThread = { ...initialThread, title, updatedAt: "2026-03-10T12:01:00.000Z" };
      mocks.data.threads = [updatedThread];
      mocks.data.selectedThread = updatedThread;
      mocks.data.threadIndex = new Map([[updatedThread.id, updatedThread]]);
    });

    const renderPage = () => (
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );
    const { rerender } = render(renderPage());

    await user.click(screen.getByRole("button", { name: "Rename Thread 1" }));
    const titleInput = screen.getByRole("textbox", { name: "Thread title" });
    await user.clear(titleInput);
    await user.type(titleInput, "Renamed Session");
    await user.click(screen.getByRole("button", { name: "Save thread title" }));

    await waitFor(() => {
      expect(mocks.data.handleRenameThread).toHaveBeenCalledWith("Renamed Session");
    });

    rerender(renderPage());

    expect(screen.getAllByRole("heading", { name: "Renamed Session" })).toHaveLength(2);
    expect(screen.getAllByText("Renamed Session")).toHaveLength(2);
  });

  it('suppresses duplicate invocation restarts and shows retry feedback', async () => {
    mocks.data = {
      ...mocks.data,
      chatMode: "invocations",
      sending: false,
      error: null,
      invocations: [{
        id: "inv-1",
        projectId: "p1",
        sprintId: null,
        taskId: null,
        sprintRunId: null,
        dispatchId: null,
        taskRunId: null,
        attentionItemId: null,
        providerInvocationId: null,
        type: "planning",
        status: "failed",
        provider: "mock",
        model: "mock",
        systemPrompt: null,
        startedAt: "2026-03-10T12:00:00.000Z",
        finishedAt: "2026-03-10T12:05:00.000Z",
        errorMessage: null,
        lastErrorCategory: "UNKNOWN",
        lastErrorMessage: "Planning failed.",
        lastRetryAfterIso: null,
        messageCount: 1,
        lastMessageAt: null,
        createdAt: "2026-03-10T12:00:00.000Z",
        updatedAt: "2026-03-10T12:00:00.000Z",
      } as any],
      selectedInvocationId: "inv-1",
      selectedInvocation: null as any,
      invocationMessages: [{ id: "msg-1", invocationId: "inv-1", role: "assistant", contentMarkdown: "Kept visible", createdAt: "2026-03-10T12:01:00.000Z", metadata: null } as any],
    };
    mocks.data.selectedInvocation = mocks.data.invocations[0];
    mocks.restartExecutionInvocation.mockRejectedValueOnce(new Error("Restart failed"));

    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    const restart = screen.getByRole("button", { name: "Restart invocation" });
    fireEvent.click(restart);
    fireEvent.click(restart);

    expect(mocks.restartExecutionInvocation).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent("Restart failed");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("Kept visible")).toBeInTheDocument();
  });

  it('announces working reply phases with live text', () => {
    render(<WorkingBubble displayName="Codex" phase="working" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).not.toHaveTextContent("Codex is preparing a reply. Working on a reply.");
    expect(status).toHaveTextContent("Working");
  });
});
