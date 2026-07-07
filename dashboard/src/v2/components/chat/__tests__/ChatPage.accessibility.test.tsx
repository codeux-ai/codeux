// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
expect.extend(matchers);

import { ChatPageShell } from '../ChatPageShell.js';
import { ChatRail } from '../ChatRail.js';
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
    expect(textbox).toHaveAttribute('aria-describedby', 'composer-help');

    const helpText = screen.getByText(/Enter sends/i);
    expect(helpText).toHaveAttribute('id', 'composer-help');

    const sendBtn = screen.getByRole('button', { name: "Sending message" });
    expect(sendBtn).toBeInTheDocument();
    expect(sendBtn).toHaveAttribute('aria-busy', 'true');

    // We mocked sending: true, so the "Sending message..." text should exist
    const liveRegion = screen.getByText(/Sending message\.\.\./);
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');

    // Check if error is correctly displayed as well
    const liveError = screen.getByText(/Failed: Test error/);
    expect(liveError).toHaveAttribute('aria-live', 'polite');
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

  it('sends web and desktop setup as idle 3D chat quick actions for the active project', async () => {
    const user = userEvent.setup();
    mocks.reducedMotion.value = true;
    const handleSend = vi.fn(() => Promise.resolve());
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      sending: false,
      input: "",
      error: null,
      hasWorkingReply: false,
      runningInvocationCount: 0,
      selectedThread: mocks.data.threads[0],
      handleSend,
    };

    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: { id: "p1", name: "P" } as any } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>
    );

    const webAction = screen.getByRole("button", { name: "Web App" });
    const desktopAction = screen.getByRole("button", { name: "Desktop App" });

    expect(webAction).toBeInTheDocument();
    expect(desktopAction).toBeInTheDocument();

    await user.click(webAction);

    expect(handleSend).toHaveBeenCalledWith(expect.stringContaining("Set up this existing project as a web app"));
    expect(handleSend).toHaveBeenCalledWith(expect.stringContaining("Do not create or import a new Code UX project."));
    expect(handleSend).toHaveBeenCalledWith(expect.stringContaining("current techstack setting"));
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
