/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/preact";
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
vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../dashboard/src/v2/hooks/use-reduced-motion.js")>(),
  useReducedMotion: () => true,
}));
vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: () => ({ data: null }),
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
import { classifyCinematicRuntimeState } from "../../../dashboard/src/v2/lib/cinematic-runtime-state.js";
import type { AgentPresetRecord, ExecutionInvocationRecord, Source } from "../../../dashboard/src/v2/types.js";

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

const renderStageForInvocation = (
  invocation: Pick<ExecutionInvocationRecord, "agentPresetId" | "status" | "type">,
) => {
  const runtimeState = classifyCinematicRuntimeState({
    hasAwaitedReply: false,
    invocations: [invocation],
    projectManagerAgentPresetId: projectManagerPreset.id,
  });

  return render(
    <CinematicStage
      selectedProject={mockProject as Source}
      selectedThread={null}
      messages={[]}
      threadMessagesLoading={false}
      projectManagerActive={runtimeState.projectManagerActive}
      backgroundActivityCount={runtimeState.backgroundActivityCount}
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
  afterEach(cleanup);

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
    expect(getByRole("button", { name: "Create Game" })).toBeDisabled();
    expect(getByText("Create app quick actions are unavailable until a project is selected.")).toBeInTheDocument();
  });

  it("omits initial-only app actions for an ineligible project", () => {
    const { getByRole, queryByRole } = render(
      <ChatCreateAppQuickActions
        hasProject
        showInitialCreateActions={false}
        onSelect={vi.fn()}
      />
    );

    expect(queryByRole("button", { name: "Create Web App" })).not.toBeInTheDocument();
    expect(queryByRole("button", { name: "Create Desktop App" })).not.toBeInTheDocument();
    expect(getByRole("button", { name: "Create Onlineshop" })).toBeEnabled();
    expect(getByRole("button", { name: "Create Portfolio" })).toBeEnabled();
    expect(getByRole("button", { name: "Create Game" })).toBeEnabled();
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
    expect(queryByText("Spinning up a workspace")).not.toBeInTheDocument();
  });

  it("activates the Project Manager for its matching dashboard-reply invocation", () => {
    const { getByTestId, getByText } = renderStageForInvocation({
      agentPresetId: "pm-agent",
      status: "running",
      type: "dashboard_reply",
    });

    expect(getByTestId("cinematic-stage")).toHaveAttribute("data-background-activity-count", "0");
    expect(getByTestId("agent-avatar-scene")).toHaveAttribute("data-expression", "thinking");
    expect(getByText("Spinning up a workspace")).toBeInTheDocument();
  });
});
