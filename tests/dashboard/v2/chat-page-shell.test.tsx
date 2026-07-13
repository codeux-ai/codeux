/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/preact";
import { h } from "preact";
import * as matchers from "@testing-library/jest-dom/matchers";
/** @jsx h */

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    set: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
  },
}));
const motionPreference = vi.hoisted(() => ({ reduced: true }));
vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../dashboard/src/v2/hooks/use-reduced-motion.js")>(),
  useReducedMotion: () => motionPreference.reduced,
}));
vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: () => ({ data: null }),
}));
vi.mock("../../../dashboard/src/v2/lib/invocation-api.js", () => ({
  fetchInvocationMessages: vi.fn(),
}));
vi.mock("../../../dashboard/src/v2/components/agents/LazyAgentAvatarScene.js", () => ({
  LazyAgentAvatarScene: (props: { expression: string; tool: string | null }) => (
    <div
      data-testid="agent-avatar-scene"
      data-expression={props.expression}
      data-tool={props.tool ?? ""}
    />
  ),
}));
import { ChatPageShell } from "../../../dashboard/src/v2/components/chat/ChatPageShell.js";
import { ChatRail } from "../../../dashboard/src/v2/components/chat/ChatRail.js";
import { ChatCreateAppQuickActions } from "../../../dashboard/src/v2/components/chat/ChatCreateAppQuickActions.js";
import { CinematicStage } from "../../../dashboard/src/v2/components/chat/cinematic/CinematicStage.js";
import { CinematicInvocationProgressBubble } from "../../../dashboard/src/v2/components/chat/cinematic/CinematicInvocationProgressBubble.js";
import { StageActivityStrip } from "../../../dashboard/src/v2/components/chat/cinematic/StageActivityStrip.js";
import { fetchInvocationMessages } from "../../../dashboard/src/v2/lib/invocation-api.js";
import gsap from "gsap";
import type { AgentPresetRecord, ChatMessageRecord, ChatThread, ExecutionInvocationMessageRecord, ExecutionInvocationRecord, Source } from "../../../dashboard/src/v2/types.js";

const mockProject = {
  id: "proj-1",
  name: "Test Project",
  description: "Test description",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const projectManagerPreset = {
  id: "pm-agent",
  name: "Project Manager",
} as AgentPresetRecord;

const invocationRecord = (
  overrides: Partial<ExecutionInvocationRecord> = {},
): ExecutionInvocationRecord => ({
    id: "invocation-1",
    projectId: "proj-1",
    messageCount: 0,
    lastMessageAt: null,
    provider: "codex",
    providerInvocationId: null,
    startedAt: "2026-07-11T10:00:00.000Z",
    updatedAt: "2026-07-11T10:00:00.000Z",
    agentPresetId: "pm-agent",
    status: "running",
    type: "dashboard_reply",
    ...overrides,
  } as ExecutionInvocationRecord);

const invocationMessage = (
  overrides: Partial<ExecutionInvocationMessageRecord> = {},
): ExecutionInvocationMessageRecord => ({
  id: "invocation-message-1",
  invocationId: "invocation-1",
  role: "assistant",
  contentMarkdown: "Inspecting configuration.",
  toolCallsJson: null,
  metadata: null,
  createdAt: "2026-07-11T10:00:01.000Z",
  ...overrides,
});

const renderStageForInvocation = (
  invocation: Partial<ExecutionInvocationRecord>,
) => {
  const activityInvocation = invocationRecord(invocation);

  return render(
    <CinematicStage
      selectedProject={mockProject as Source}
      selectedThread={null}
      messages={[]}
      threadMessagesLoading={false}
      hasAwaitedReply={false}
      invocations={[activityInvocation]}
      sending={false}
      error={null}
      input=""
      setInput={vi.fn()}
      onSpeechTranscript={vi.fn()}
      handleSend={vi.fn(async () => undefined)}
      handleCreateAppQuickaction={vi.fn(async () => undefined)}
      initialEligibilityLoaded
      canCreateInitialAppQuickactions={false}
      navigateHistory={vi.fn(() => false)}
      composerRef={{ current: null }}
      activeConnection={null}
      agentPreset={projectManagerPreset}
      onOpenThreads={vi.fn()}
    />,
  );
};

describe("ChatPageShell", () => {
  beforeEach(() => {
    motionPreference.reduced = true;
    vi.clearAllMocks();
    vi.mocked(fetchInvocationMessages).mockResolvedValue([]);
  });

  afterEach(() => {
    motionPreference.reduced = true;
    cleanup();
  });

  it("renders onboarding mode without project chat controls when no project is selected", () => {
    const { getByText, queryByRole } = render(
      <ChatPageShell
        selectedProject={null}
        chatMode="stage"
        onSetChatMode={vi.fn()}
        onCreateThread={vi.fn()}
        pendingDashboardMessages={0}
        error={null}
        title="Code UX Assistant"
        subtitle="Ask setup questions before a project exists."
        showProjectControls={false}
        railSlot={null}
        detailSlot={<div>No-project assistant</div>}
      />
    );

    expect(getByText("Code UX Assistant")).toBeInTheDocument();
    expect(getByText("Ask setup questions before a project exists.")).toBeInTheDocument();
    expect(getByText("No-project assistant")).toBeInTheDocument();
    expect(queryByRole("tablist", { name: "Chat Mode" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: /new thread/i })).not.toBeInTheDocument();
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

  it("shows a clean planning label without background or provider prefixes", () => {
    const { getByText, queryByText } = render(
      <StageActivityStrip
        backgroundActivityCount={1}
        backgroundCue={{
          id: "planning-1",
          label: "Planning in progress",
          phase: "planning",
          providerLabel: "Codex",
          quote: "The team is doing the work; I’m protecting them from a meeting about the work.",
          tone: "active",
        }}
        foregroundCue={null}
      />,
    );

    expect(getByText("Planning in progress")).toBeInTheDocument();
    expect(queryByText(/Background|Codex/)).not.toBeInTheDocument();
  });

  it("renders create-app quickactions with accessible labels and disabled status text", () => {
    const onSelect = vi.fn();
    const { getByRole, getByText, rerender } = render(
      <ChatCreateAppQuickActions
        hasProject={true}
        sending={false}
        showInitialCreateActions={true}
        onSelect={onSelect}
      />
    );

    const desktopAction = getByRole("button", { name: "Create Desktop App" });
    const webAction = getByRole("button", { name: "Create Web App" });
    const shopAction = getByRole("button", { name: "Create Onlineshop" });
    const portfolioAction = getByRole("button", { name: "Create Portfolio" });
    const gameAction = getByRole("button", { name: "Create Game" });

    expect(desktopAction).toBeEnabled();
    expect(webAction).toBeEnabled();
    expect(shopAction).toBeEnabled();
    expect(portfolioAction).toBeEnabled();
    expect(gameAction).toBeEnabled();
    expect(getByText("Create app quick actions are available.")).toHaveAttribute("aria-live", "polite");

    fireEvent.click(desktopAction);
    expect(onSelect).toHaveBeenCalledWith("desktop_app");

    rerender(
      <ChatCreateAppQuickActions
        hasProject={false}
        sending={false}
        showInitialCreateActions={false}
        onSelect={onSelect}
      />
    );

    expect(() => getByRole("button", { name: "Create Desktop App" })).toThrow();
    expect(() => getByRole("button", { name: "Create Game" })).toThrow();
    expect(getByText("Create app quick actions are unavailable until a project is selected.")).toBeInTheDocument();
  });

  it("omits every create-app action for an ineligible project", () => {
    const { queryByRole } = render(
      <ChatCreateAppQuickActions
        hasProject
        showInitialCreateActions={false}
        onSelect={vi.fn()}
      />
    );

    expect(queryByRole("button", { name: "Create Web App" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Create Desktop App" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Create Onlineshop" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Create Portfolio" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Create Game" })).not.toBeInTheDocument();
  });

  it("keeps the Project Manager idle while another agent has a running invocation", () => {
    const { getByTestId, queryByText } = renderStageForInvocation({
      agentPresetId: "worker-agent",
      status: "running",
      type: "worker_reply",
    });

    expect(getByTestId("cinematic-stage")).toHaveAttribute("data-background-activity-count", "1");
    expect(getByTestId("agent-avatar-scene")).not.toHaveAttribute("data-expression", "thinking");
    expect(getByTestId("agent-avatar-scene")).toHaveAttribute("data-tool", "");
    expect(fetchInvocationMessages).not.toHaveBeenCalled();
    expect(queryByText("In progress")).not.toBeInTheDocument();
    expect(queryByText("Container starting")).toBeInTheDocument();
    expect(queryByText(/Background.*Codex/i)).not.toBeInTheDocument();
  });

  it("activates the Project Manager tool and progress bubble at zero-message startup", () => {
    const { container, getByTestId, getByText } = renderStageForInvocation({
      agentPresetId: "pm-agent",
      status: "running",
      type: "dashboard_reply",
    });

    expect(getByTestId("cinematic-stage")).toHaveAttribute("data-background-activity-count", "0");
    expect(getByTestId("agent-avatar-scene")).toHaveAttribute("data-expression", "thinking");
    expect(getByTestId("agent-avatar-scene").getAttribute("data-tool")).not.toBe("");
    expect(getByTestId("cinematic-invocation-progress")).toHaveAttribute("data-invocation-id", "invocation-1");
    expect(getByText("In progress")).toBeInTheDocument();
    expect(getByText("0 tools used")).toBeInTheDocument();
    expect(getByText("Preparing the first progress update…")).toBeInTheDocument();
    const activityLabel = getByText(/Container starting/);
    expect(activityLabel).toBeInTheDocument();
    expect(activityLabel.closest('[role="status"]')).toHaveAttribute("aria-atomic", "true");
    expect(container.querySelector(".stage-thinking-dot")).toHaveClass("motion-reduce:animate-none");
  });

  it("projects changing interim assistant markdown and a deduplicated tool count", async () => {
    vi.mocked(fetchInvocationMessages)
      .mockResolvedValueOnce([
        invocationMessage({ contentMarkdown: "Inspecting **configuration**." }),
        invocationMessage({ id: "tool-call", role: "tool", contentMarkdown: "", metadata: { kind: "tool_call", toolCallId: "call-1" } }),
        invocationMessage({ id: "tool-result", role: "tool", contentMarkdown: "", metadata: { kind: "tool_result", toolCallId: "call-1" } }),
      ])
      .mockResolvedValueOnce([
        invocationMessage({ id: "latest", contentMarkdown: "Applying the safe update." }),
        invocationMessage({ id: "tool-call", role: "tool", contentMarkdown: "", metadata: { kind: "tool_call", toolCallId: "call-1" } }),
        invocationMessage({ id: "tool-result", role: "tool", contentMarkdown: "", metadata: { kind: "tool_result", toolCallId: "call-1" } }),
        invocationMessage({ id: "tool-call-2", role: "tool", contentMarkdown: "", metadata: { kind: "tool_call", toolCallId: "call-2" } }),
      ]);
    const firstInvocation = invocationRecord({ messageCount: 3, lastMessageAt: "2026-07-11T10:00:01.000Z" });
    const renderStage = (invocation: ExecutionInvocationRecord) => (
      <CinematicStage
        selectedProject={mockProject as Source}
        selectedThread={null}
        messages={[]}
        threadMessagesLoading={false}
        hasAwaitedReply={false}
        invocations={[invocation]}
        sending={false}
        error={null}
        input=""
        setInput={vi.fn()}
        onSpeechTranscript={vi.fn()}
        handleSend={vi.fn(async () => undefined)}
        handleCreateAppQuickaction={vi.fn(async () => undefined)}
        initialEligibilityLoaded
        canCreateInitialAppQuickactions={false}
        navigateHistory={vi.fn(() => false)}
        composerRef={{ current: null }}
        activeConnection={null}
        agentPreset={projectManagerPreset}
        onOpenThreads={vi.fn()}
      />
    );
    const view = render(renderStage(firstInvocation));

    await waitFor(() => expect(view.getByTestId("cinematic-invocation-progress")).toHaveTextContent("Inspecting configuration."));
    expect(view.getByText("1 tool used")).toBeInTheDocument();
    expect(view.getByTestId("agent-avatar-scene").getAttribute("data-tool")).not.toBe("");

    view.rerender(renderStage(invocationRecord({
      messageCount: 4,
      lastMessageAt: "2026-07-11T10:00:02.000Z",
      updatedAt: "2026-07-11T10:00:02.000Z",
    })));

    await waitFor(() => expect(view.getByText("Applying the safe update.")).toBeInTheDocument());
    expect(view.getByTestId("cinematic-invocation-progress")).not.toHaveTextContent("Inspecting configuration.");
    expect(view.getByText("2 tools used")).toBeInTheDocument();
  });

  it("removes transient invocation feedback and its tool at terminal state", async () => {
    vi.mocked(fetchInvocationMessages).mockResolvedValue([
      invocationMessage({ contentMarkdown: "Final reply text." }),
    ]);
    const finalMessage = {
      id: "thread-message-1",
      threadId: "thread-1",
      direction: "connection_to_dashboard",
      authorType: "system",
      bodyMarkdown: "Final reply text.",
      metadata: null,
      createdAt: "2026-07-11T10:00:03.000Z",
    } as ChatMessageRecord;
    const stage = (
      invocation: ExecutionInvocationRecord,
      messages: ChatMessageRecord[] = [],
      selectedThread: ChatThread | null = null,
    ) => (
      <CinematicStage
        selectedProject={mockProject as Source}
        selectedThread={selectedThread}
        messages={messages}
        threadMessagesLoading={false}
        hasAwaitedReply={false}
        invocations={[invocation]}
        sending={false}
        error={null}
        input=""
        setInput={vi.fn()}
        onSpeechTranscript={vi.fn()}
        handleSend={vi.fn(async () => undefined)}
        handleCreateAppQuickaction={vi.fn(async () => undefined)}
        initialEligibilityLoaded
        canCreateInitialAppQuickactions={false}
        navigateHistory={vi.fn(() => false)}
        composerRef={{ current: null }}
        activeConnection={null}
        agentPreset={projectManagerPreset}
        onOpenThreads={vi.fn()}
      />
    );
    const initialThread = {
      id: "thread-1",
      title: "Active thread",
      messageCount: 0,
    } as ChatThread;
    const view = render(stage(invocationRecord(), [], initialThread));
    await waitFor(() => expect(view.getByTestId("cinematic-invocation-progress")).toBeInTheDocument());

    view.rerender(stage(invocationRecord(), [], {
      id: "thread-2",
      title: "Another thread",
      messageCount: 0,
    } as ChatThread));
    expect(view.queryByTestId("cinematic-invocation-progress")).not.toBeInTheDocument();
    expect(view.getByTestId("agent-avatar-scene")).toHaveAttribute("data-tool", "");

    view.rerender(stage(invocationRecord({ status: "completed" }), [finalMessage]));

    expect(view.queryByTestId("cinematic-invocation-progress")).not.toBeInTheDocument();
    expect(view.getByTestId("agent-avatar-scene")).toHaveAttribute("data-tool", "");
    expect(view.getAllByText("Final reply text.")).toHaveLength(1);
  });

  it("keeps reduced-motion progress semantic, static, and safely rendered", () => {
    const view = render(
      <CinematicInvocationProgressBubble
        invocationId="invocation-safe"
        message={'**Safe update** <script>alert("no")</script> [unsafe](javascript:alert(1))'}
        toolCount={1}
      />,
    );
    const status = view.getByRole("status");

    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(view.getByText("Safe update").tagName).toBe("STRONG");
    expect(view.container.querySelector("a")).not.toBeInTheDocument();
    expect(view.container.querySelector("script")).not.toBeInTheDocument();
    expect(view.getByText("1 tool used")).toBeInTheDocument();
    expect(vi.mocked(gsap.fromTo)).not.toHaveBeenCalled();
    expect(view.container.querySelector(".motion-reduce\\:animate-none")).toBeInTheDocument();
  });

  it("animates first appearance and meaningful interim-message changes", () => {
    motionPreference.reduced = false;
    const view = render(
      <CinematicInvocationProgressBubble invocationId="invocation-motion" message="First update" toolCount={0} />,
    );
    expect(vi.mocked(gsap.fromTo)).toHaveBeenCalledTimes(1);

    view.rerender(
      <CinematicInvocationProgressBubble invocationId="invocation-motion" message="Second update" toolCount={0} />,
    );
    expect(vi.mocked(gsap.fromTo)).toHaveBeenCalledTimes(2);
  });
});
