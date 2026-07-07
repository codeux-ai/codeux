/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/preact";
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
import { ChatPageShell } from "../../../dashboard/src/v2/components/chat/ChatPageShell.js";
import { ChatRail } from "../../../dashboard/src/v2/components/chat/ChatRail.js";
import { ChatCreateAppQuickActions } from "../../../dashboard/src/v2/components/chat/ChatCreateAppQuickActions.js";

const mockProject = {
  id: "proj-1",
  name: "Test Project",
  description: "Test description",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("ChatPageShell", () => {
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
        onSelect={onSelect}
      />
    );

    const desktopAction = getByRole("button", { name: "Create Desktop App" });
    const webAction = getByRole("button", { name: "Create Web App" });

    expect(desktopAction).toBeEnabled();
    expect(webAction).toBeEnabled();
    expect(getByText("Create app quick actions are available.")).toHaveAttribute("aria-live", "polite");

    fireEvent.click(desktopAction);
    expect(onSelect).toHaveBeenCalledWith("desktop_app");

    rerender(
      <ChatCreateAppQuickActions
        hasProject={false}
        sending={false}
        onSelect={onSelect}
      />
    );

    expect(getByRole("button", { name: "Create Desktop App" })).toBeDisabled();
    expect(getByText("Create app quick actions are unavailable until a project is selected.")).toBeInTheDocument();
  });
});
