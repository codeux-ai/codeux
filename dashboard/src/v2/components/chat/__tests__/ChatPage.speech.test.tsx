// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

expect.extend(matchers);

import { ChatPage } from "../../../ChatPage.js";
import { ProjectDataContext } from "../../../context/project-data.js";

const speechButtonMock = vi.hoisted(() => ({
  transcript: "Dictated task",
  lastDisabled: false,
  lastProjectId: null as string | null,
  lastSprintId: null as string | null,
}));

const mocks = vi.hoisted(() => {
  const thread = {
    id: "thread1",
    projectId: "p1",
    connectionId: null,
    scope: "project",
    title: "Thread 1",
    status: "open",
    createdAt: "2026-03-10T12:00:00.000Z",
    updatedAt: "2026-03-10T12:00:00.000Z",
    messageCount: 0,
    pendingMessageCount: 0,
    lastMessageAt: null,
    lastMessagePreview: null,
  };

  const baseData = {
    chatMode: "threads" as "stage" | "threads" | "invocations",
    setChatMode: vi.fn(),
    threads: [thread],
    invocations: [],
    invocationTotalCount: 0,
    hasMoreInvocations: false,
    selectedThreadId: "thread1",
    selectedInvocationId: null,
    messages: [],
    invocationMessages: [],
    input: "",
    setInput: vi.fn(),
    deletingThreadId: null,
    sending: false,
    compacting: false,
    error: null,
    selectedThread: thread,
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
    invocationsLoadingMore: false,
    refreshThreads: vi.fn(() => Promise.resolve()),
    loadMoreInvocations: vi.fn(() => Promise.resolve()),
    activateThread: vi.fn(() => Promise.resolve()),
    activateInvocation: vi.fn(() => Promise.resolve()),
    handleCompactThread: vi.fn(),
    handleCancelActiveTurn: vi.fn(),
    isCancelling: false,
    handleSend: vi.fn(),
    handleCreateAppQuickaction: vi.fn(),
    navigateHistory: vi.fn(() => false),
    handleDeleteThread: vi.fn(),
    handleRenameThread: vi.fn(() => Promise.resolve()),
    createThreadForCompose: vi.fn(),
    threadIndex: new Map([["thread1", thread]]),
    invocationIndex: new Map(),
    selectedProject: { id: "p1", name: "Project 1" },
    agentPresets: [],
    feedback: { status: "idle", message: null },
    clearFeedback: vi.fn(),
    isConfirmOpen: false,
    confirmOptions: null,
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
    execution: null,
    executionLoading: false,
    executionLoaded: false,
    projectTasks: [],
    projectTasksLoading: false,
    projectTasksLoaded: true,
    sprintKeyPrefix: "SPR",
  };

  return {
    baseData,
    data: { ...baseData } as any,
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));

vi.mock("../../../hooks/use-chat-page-data.js", () => ({
  useChatPageData: () => mocks.data,
}));

vi.mock("../../../components/speech/SpeechInputButton.js", () => ({
  SpeechInputButton: ({ disabled = false, projectId = null, sprintId = null, onTranscript }: any) => {
    speechButtonMock.lastDisabled = disabled;
    speechButtonMock.lastProjectId = projectId;
    speechButtonMock.lastSprintId = sprintId;
    return (
      <button
        type="button"
        aria-label="Start speech recording"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            onTranscript(speechButtonMock.transcript, { appendMode: true, result: { ok: true, text: speechButtonMock.transcript } });
          }
        }}
      >
        Record
      </button>
    );
  },
}));

const renderChatPage = () => render(
  <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: mocks.data.selectedProject } as any}>
    <ChatPage />
  </ProjectDataContext.Provider>,
);

describe("ChatPage speech input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    speechButtonMock.transcript = "Dictated task";
    speechButtonMock.lastDisabled = false;
    speechButtonMock.lastProjectId = null;
    speechButtonMock.lastSprintId = null;
    mocks.data = {
      ...mocks.baseData,
      setChatMode: vi.fn(),
      setInput: vi.fn(),
      handleSend: vi.fn(),
      handleCreateAppQuickaction: vi.fn(),
      createThreadForCompose: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("inserts a transcript into an empty thread composer", () => {
    renderChatPage();

    fireEvent.click(screen.getByRole("button", { name: "Start speech recording" }));

    expect(mocks.data.setInput).toHaveBeenCalledWith("Dictated task");
    expect(speechButtonMock.lastProjectId).toBe("p1");
    expect(speechButtonMock.lastSprintId).toBeNull();
  });

  it("routes ArrowUp and ArrowDown from the composer into message history navigation", () => {
    mocks.data = {
      ...mocks.data,
      input: "Current draft",
      navigateHistory: vi.fn(() => true),
    };
    renderChatPage();

    const composer = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    composer.setSelectionRange(0, 0);
    fireEvent.keyDown(composer, { key: "ArrowUp" });
    composer.setSelectionRange(composer.value.length, composer.value.length);
    fireEvent.keyDown(composer, { key: "ArrowDown" });

    expect(mocks.data.navigateHistory).toHaveBeenNthCalledWith(1, "up");
    expect(mocks.data.navigateHistory).toHaveBeenNthCalledWith(2, "down");
  });

  it("inserts a transcript at the current caret with sensible spacing", () => {
    speechButtonMock.transcript = "review";
    mocks.data = {
      ...mocks.data,
      input: "Please  now",
    };
    renderChatPage();

    const composer = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    composer.setSelectionRange(7, 7);
    fireEvent.select(composer);
    fireEvent.click(screen.getByRole("button", { name: "Start speech recording" }));

    expect(mocks.data.setInput).toHaveBeenCalledWith("Please review now");
  });

  it("disables speech while sending and does not render project speech controls without a selected project", () => {
    mocks.data = {
      ...mocks.data,
      input: "Ship it",
      sending: true,
    };
    const { rerender } = renderChatPage();

    const speechButton = screen.getByRole("button", { name: "Start speech recording" });
    expect(speechButton).toBeDisabled();
    fireEvent.click(speechButton);
    expect(mocks.data.setInput).not.toHaveBeenCalled();

    mocks.data = {
      ...mocks.data,
      selectedProject: null,
      sending: false,
    };
    rerender(
      <ProjectDataContext.Provider value={{ projects: [], selectedProject: null } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>,
    );

    expect(screen.queryByRole("button", { name: "Start speech recording" })).not.toBeInTheDocument();
  });

  it("does not render speech controls in invocation mode", () => {
    mocks.data = {
      ...mocks.data,
      chatMode: "invocations",
      selectedInvocation: {
        id: "inv-1",
        projectId: "p1",
        type: "planning",
        status: "completed",
        provider: "codex",
        model: "gpt",
        startedAt: "2026-03-10T12:00:00.000Z",
        finishedAt: "2026-03-10T12:02:00.000Z",
        createdAt: "2026-03-10T12:00:00.000Z",
        updatedAt: "2026-03-10T12:02:00.000Z",
        messageCount: 0,
      },
      selectedInvocationId: "inv-1",
    };

    renderChatPage();

    expect(screen.getByLabelText("Invocation transcript is read-only")).toHaveTextContent(
      "Invocation execution logs are read-only. Switch to Threads to communicate.",
    );
    expect(screen.queryByRole("button", { name: "Start speech recording" })).not.toBeInTheDocument();
  });
});
