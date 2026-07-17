// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
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

const synthesisMock = vi.hoisted(() => ({
  synthesizeSpeech: vi.fn<(
    text: string,
    projectId?: string | null,
    voice?: string | null,
    signal?: AbortSignal,
  ) => Promise<Blob>>(),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

class FakeAudio {
  static instances: FakeAudio[] = [];

  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly pause = vi.fn();
  readonly play = vi.fn(() => Promise.resolve());

  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }

  end(): void {
    this.onended?.();
  }
}

const speechBlobLabels = new WeakMap<Blob, string>();
const speechBlob = (label: string): Blob => {
  const blob = new Blob([label], { type: "audio/wav" });
  speechBlobLabels.set(blob, label);
  return blob;
};

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

vi.mock("../../../hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: () => ({
    data: { settings: { speech: { synthesis: { enabled: true } } } },
  }),
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

vi.mock("../../../lib/speech-api.js", () => ({
  synthesizeSpeech: synthesisMock.synthesizeSpeech,
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
    window.localStorage.clear();
    synthesisMock.synthesizeSpeech.mockReset();
    synthesisMock.synthesizeSpeech.mockReturnValue(new Promise(() => {}));
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
    const NativeUrl = globalThis.URL;
    class UrlWithObjectUrls extends NativeUrl {}
    Object.assign(UrlWithObjectUrls, {
      createObjectURL: vi.fn((blob: Blob) => `blob:${speechBlobLabels.get(blob) ?? "unknown"}`),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("URL", UrlWithObjectUrls);
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
    vi.unstubAllGlobals();
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

  it("keeps the 3D microphone and agent mute control on the stage, outside the composer", async () => {
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      sending: false,
      input: "",
    };

    renderChatPage();

    const controls = screen.getByRole("group", { name: "3D chat voice controls" });
    const microphone = screen.getByRole("button", { name: "Start speech recording" });
    const composer = screen.getByRole("textbox", { name: "Message the project manager" });
    expect(controls).toContainElement(microphone);
    expect(composer.parentElement).not.toContainElement(microphone);
    expect(await screen.findByRole("button", { name: "Mute project manager" })).toBeInTheDocument();

    fireEvent.click(microphone);
    expect(mocks.data.setInput).toHaveBeenCalledWith("Dictated task");
  });

  it("uses the shared 3D caret insertion and restores focus when the routed agent changes", async () => {
    speechButtonMock.transcript = "go";
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      input: "Please  now",
      activeConnection: { id: "agent-one", displayName: "Agent One", status: "connected" },
    };
    const view = renderChatPage();
    const composer = screen.getByRole("textbox", { name: "Message the project manager" }) as HTMLTextAreaElement;
    composer.focus();
    composer.setSelectionRange(7, 7);
    fireEvent.select(composer);

    fireEvent.click(screen.getByRole("button", { name: "Start speech recording" }));

    expect(mocks.data.setInput).toHaveBeenCalledWith("Please go now");
    await waitFor(() => expect(composer).toHaveFocus());
    await waitFor(() => expect(composer.selectionStart).toBe(9));

    mocks.data = {
      ...mocks.data,
      input: "Draft for agent two",
      activeConnection: { id: "agent-two", displayName: "Agent Two", status: "connected" },
    };
    view.rerender(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: mocks.data.selectedProject } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>,
    );

    const nextComposer = screen.getByRole("textbox", { name: "Message the project manager" }) as HTMLTextAreaElement;
    await waitFor(() => expect(nextComposer).toHaveFocus());
    expect(nextComposer.selectionStart).toBe(nextComposer.value.length);
  });

  it("seeds loaded 3D history without speaking it, then auto-plays one newly appended agent reply", async () => {
    const historicalReply = {
      id: "reply-historical",
      threadId: "thread1",
      direction: "connection_to_dashboard",
      authorType: "connection",
      authorConnectionId: "connection-1",
      bodyMarkdown: "Historical reply",
      deliveryStatus: "delivered",
      createdAt: "2026-03-10T12:00:00.000Z",
      metadata: null,
    };
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      messages: [historicalReply],
    };

    const view = renderChatPage();
    await screen.findByRole("button", { name: "Mute project manager" });
    expect(synthesisMock.synthesizeSpeech).not.toHaveBeenCalled();

    const freshReply = {
      ...historicalReply,
      id: "reply-fresh",
      bodyMarkdown: "Fresh **agent** reply",
      createdAt: "2026-03-10T12:01:00.000Z",
    };
    mocks.data = { ...mocks.data, messages: [historicalReply, freshReply] };
    view.rerender(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: mocks.data.selectedProject } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>,
    );

    await waitFor(() => expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledTimes(1));
    expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledWith(
      "Fresh agent reply",
      "p1",
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("replays the staged agent message only after its explicit replay control is clicked", async () => {
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      messages: [{
        id: "reply-1",
        threadId: "thread1",
        direction: "connection_to_dashboard",
        authorType: "connection",
        authorConnectionId: "connection-1",
        bodyMarkdown: "Replay this reply",
        deliveryStatus: "delivered",
        createdAt: "2026-03-10T12:00:00.000Z",
        metadata: null,
      }],
    };

    renderChatPage();
    const replay = await screen.findByRole("button", { name: "Replay message from Project Manager" });
    expect(synthesisMock.synthesizeSpeech).not.toHaveBeenCalled();
    fireEvent.click(replay);

    await waitFor(() => expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledWith(
      "Replay this reply",
      "p1",
      undefined,
      expect.any(AbortSignal),
    ));
  });

  it("reports a 3D voice synthesis failure instead of silently discarding it", async () => {
    synthesisMock.synthesizeSpeech.mockRejectedValueOnce(new Error("Configured voice is unavailable."));
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      messages: [{
        id: "reply-error",
        threadId: "thread1",
        direction: "connection_to_dashboard",
        authorType: "connection",
        authorConnectionId: "connection-1",
        bodyMarkdown: "Replay this reply",
        deliveryStatus: "delivered",
        createdAt: "2026-03-10T12:00:00.000Z",
        metadata: null,
      }],
    };

    renderChatPage();
    fireEvent.click(await screen.findByRole("button", { name: "Replay message from Project Manager" }));

    const voiceError = await screen.findByText("Voice error: Configured voice is unavailable.");
    expect(voiceError).toHaveAttribute("role", "status");
  });

  it("reports thread replay failures through the existing composer status without hiding the transcript", async () => {
    synthesisMock.synthesizeSpeech.mockRejectedValueOnce(new Error("Speech provider timed out."));
    mocks.data = {
      ...mocks.data,
      chatMode: "threads",
      messages: [{
        id: "thread-replay-error",
        threadId: "thread1",
        direction: "connection_to_dashboard",
        authorType: "connection",
        authorConnectionId: "connection-1",
        bodyMarkdown: "The transcript remains visible.",
        deliveryStatus: "delivered",
        createdAt: "2026-03-10T12:00:00.000Z",
        metadata: null,
      }],
    };

    renderChatPage();
    fireEvent.click(await screen.findByRole("button", { name: "Replay message from Assistant" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Voice playback failed: Speech provider timed out. The transcript is still available.",
    );
    expect(screen.getByText("The transcript remains visible.")).toBeInTheDocument();
  });

  it("auto-plays the first reply after sending in a brand-new empty 3D thread", async () => {
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      input: "First question",
      selectedThread: null,
      selectedThreadId: null,
      threads: [],
      messages: [],
      handleSend: vi.fn(() => Promise.resolve()),
    };

    const view = renderChatPage();
    await screen.findByRole("button", { name: "Mute project manager" });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    const createdThread = {
      ...mocks.baseData.selectedThread,
      id: "thread-created-after-send",
      title: "New thread",
    };
    const userMessage = {
      id: "first-user-message",
      threadId: createdThread.id,
      direction: "dashboard_to_connection",
      authorType: "user",
      authorConnectionId: null,
      bodyMarkdown: "First question",
      deliveryStatus: "processed",
      createdAt: "2026-03-10T12:00:00.000Z",
      metadata: null,
    };
    const firstReply = {
      ...userMessage,
      id: "first-agent-reply",
      direction: "connection_to_dashboard",
      authorType: "connection",
      authorConnectionId: "connection-1",
      bodyMarkdown: "First answer",
      createdAt: "2026-03-10T12:00:01.000Z",
    };
    mocks.data = {
      ...mocks.data,
      input: "",
      selectedThread: createdThread,
      selectedThreadId: createdThread.id,
      threads: [createdThread],
      messages: [userMessage, firstReply],
    };
    view.rerender(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: mocks.data.selectedProject } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>,
    );

    await waitFor(() => expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledTimes(1));
    expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledWith(
      "First answer",
      "p1",
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("streams a long 3D reply in order, cancels stale playback, and keeps thread replay explicit", async () => {
    const firstSentence = `${"First ".repeat(700)}starts quickly.`;
    const secondSentence = `${"Second ".repeat(700)}continues in order.`;
    const thirdSentence = `${"Third ".repeat(700)}finishes completely.`;
    const longReplyMarkdown = `${firstSentence} ${secondSentence} ${thirdSentence}`;
    const initialChunks = [deferred<Blob>(), deferred<Blob>(), deferred<Blob>()];
    const staleChunks = [deferred<Blob>(), deferred<Blob>(), deferred<Blob>()];
    const replacementSynthesis = deferred<Blob>();
    const threadReplaySynthesis = deferred<Blob>();
    let phase: "initial" | "stale" | "replacement" | "thread" = "initial";
    let phaseCallIndex = 0;
    synthesisMock.synthesizeSpeech.mockImplementation((text) => {
      if (phase === "initial") return initialChunks[phaseCallIndex++].promise;
      if (phase === "stale") return staleChunks[phaseCallIndex++].promise;
      if (phase === "replacement") return replacementSynthesis.promise;
      expect(text).toBe("Thread replay stays explicit.");
      return threadReplaySynthesis.promise;
    });

    const historicalReply = {
      id: "reply-historical-streaming",
      threadId: "thread1",
      direction: "connection_to_dashboard",
      authorType: "connection",
      authorConnectionId: "connection-1",
      bodyMarkdown: "Historical reply remains silent.",
      deliveryStatus: "delivered",
      createdAt: "2026-03-10T12:00:00.000Z",
      metadata: null,
    };
    mocks.data = {
      ...mocks.data,
      chatMode: "stage",
      messages: [historicalReply],
    };

    const view = renderChatPage();
    await screen.findByRole("button", { name: "Mute project manager" });
    expect(synthesisMock.synthesizeSpeech).not.toHaveBeenCalled();

    const longReply = {
      ...historicalReply,
      id: "reply-long-streaming",
      bodyMarkdown: longReplyMarkdown,
      createdAt: "2026-03-10T12:01:00.000Z",
    };
    mocks.data = { ...mocks.data, messages: [historicalReply, longReply] };
    view.rerender(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: mocks.data.selectedProject } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>,
    );

    await waitFor(() => expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledTimes(1));
    expect(synthesisMock.synthesizeSpeech.mock.calls[0]?.[0]).toBe(firstSentence);

    initialChunks[0].resolve(speechBlob("initial-first"));
    await waitFor(() => {
      expect(FakeAudio.instances.map((audio) => audio.src)).toEqual(["blob:initial-first"]);
      expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledTimes(3);
    });
    expect(FakeAudio.instances[0]?.play).toHaveBeenCalledTimes(1);

    initialChunks[2].resolve(speechBlob("initial-third"));
    FakeAudio.instances[0]?.end();
    await Promise.resolve();
    expect(FakeAudio.instances.map((audio) => audio.src)).toEqual(["blob:initial-first"]);

    initialChunks[1].resolve(speechBlob("initial-second"));
    await waitFor(() => expect(FakeAudio.instances.map((audio) => audio.src)).toEqual([
      "blob:initial-first",
      "blob:initial-second",
    ]));
    FakeAudio.instances[1]?.end();
    await waitFor(() => expect(FakeAudio.instances.map((audio) => audio.src)).toEqual([
      "blob:initial-first",
      "blob:initial-second",
      "blob:initial-third",
    ]));
    FakeAudio.instances[2]?.end();
    await waitFor(() => expect(screen.getByRole("button", { name: "Replay message from Project Manager" })).not.toBeDisabled());

    phase = "stale";
    phaseCallIndex = 0;
    fireEvent.click(screen.getByRole("button", { name: "Replay message from Project Manager" }));
    await waitFor(() => expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledTimes(4));
    staleChunks[0].resolve(speechBlob("stale-first"));
    await waitFor(() => {
      expect(FakeAudio.instances.map((audio) => audio.src)).toEqual([
        "blob:initial-first",
        "blob:initial-second",
        "blob:initial-third",
        "blob:stale-first",
      ]);
      expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledTimes(6);
    });
    const staleSignals = synthesisMock.synthesizeSpeech.mock.calls.slice(3, 6).map((call) => call[3] as AbortSignal);

    phase = "replacement";
    phaseCallIndex = 0;
    const replacementReply = {
      ...historicalReply,
      id: "reply-replacement",
      bodyMarkdown: "Replacement playback wins.",
      createdAt: "2026-03-10T12:02:00.000Z",
    };
    mocks.data = { ...mocks.data, messages: [historicalReply, longReply, replacementReply] };
    view.rerender(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: mocks.data.selectedProject } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>,
    );

    await waitFor(() => expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledTimes(7));
    expect(staleSignals.every((signal) => signal.aborted)).toBe(true);
    expect(FakeAudio.instances[3]?.pause).toHaveBeenCalledTimes(1);
    replacementSynthesis.resolve(speechBlob("replacement"));
    await waitFor(() => expect(FakeAudio.instances.at(-1)?.src).toBe("blob:replacement"));
    FakeAudio.instances.at(-1)?.end();

    phase = "thread";
    const synthesisCountBeforeThreadMode = synthesisMock.synthesizeSpeech.mock.calls.length;
    const threadReply = {
      ...historicalReply,
      id: "reply-thread-explicit",
      bodyMarkdown: "Thread replay stays explicit.",
      createdAt: "2026-03-10T12:03:00.000Z",
    };
    mocks.data = {
      ...mocks.data,
      chatMode: "threads",
      messages: [threadReply],
    };
    view.rerender(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: mocks.data.selectedProject } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>,
    );

    const threadReplay = await screen.findByRole("button", { name: "Replay message from Assistant" });
    expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledTimes(synthesisCountBeforeThreadMode);
    fireEvent.click(threadReplay);
    await waitFor(() => expect(synthesisMock.synthesizeSpeech).toHaveBeenCalledTimes(synthesisCountBeforeThreadMode + 1));
  });

  it("keeps loaded thread and invocation transcripts silent until replay is requested", async () => {
    const threadReply = {
      id: "thread-agent-reply",
      threadId: "thread1",
      direction: "connection_to_dashboard",
      authorType: "connection",
      authorConnectionId: "connection-1",
      bodyMarkdown: "Loaded thread reply",
      deliveryStatus: "delivered",
      createdAt: "2026-03-10T12:00:00.000Z",
      metadata: null,
    };
    mocks.data = { ...mocks.data, chatMode: "threads", messages: [threadReply] };
    const view = renderChatPage();

    expect(await screen.findByRole("button", { name: "Replay message from Assistant" })).toBeInTheDocument();
    expect(synthesisMock.synthesizeSpeech).not.toHaveBeenCalled();

    const invocation = {
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
      messageCount: 1,
    };
    mocks.data = {
      ...mocks.data,
      chatMode: "invocations",
      selectedInvocation: invocation,
      selectedInvocationId: invocation.id,
      invocationMessages: [{
        id: "invocation-agent-reply",
        invocationId: invocation.id,
        role: "assistant",
        contentMarkdown: "Loaded invocation reply",
        toolCallsJson: null,
        createdAt: "2026-03-10T12:01:00.000Z",
        metadata: null,
      }],
    };
    view.rerender(
      <ProjectDataContext.Provider value={{ projects: [{ id: "p1", name: "P" } as any], selectedProject: mocks.data.selectedProject } as any}>
        <ChatPage />
      </ProjectDataContext.Provider>,
    );

    expect(await screen.findByRole("button", { name: "Replay message from Assistant" })).toBeInTheDocument();
    expect(synthesisMock.synthesizeSpeech).not.toHaveBeenCalled();

    synthesisMock.synthesizeSpeech.mockRejectedValueOnce(new Error("Invocation replay failed."));
    fireEvent.click(screen.getByRole("button", { name: "Replay message from Assistant" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Voice playback failed: Invocation replay failed. The transcript is still available.",
    );
    expect(screen.getByText("Loaded invocation reply")).toBeInTheDocument();
  });
});
