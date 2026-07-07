// @vitest-environment happy-dom
/** @jsx h */
import { afterEach, describe, it, expect, vi } from "vitest";
import { h } from "preact";
import { cleanup, render, screen, fireEvent } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from '@testing-library/jest-dom/matchers';
import { ChatThreadHeader } from "../../../dashboard/src/v2/components/chat/ChatThreadHeader.js";
import { buildMockChatThread } from "../factories/chat-fixture-factory.js";

expect.extend(matchers);

describe("ChatThreadHeader", () => {
  afterEach(() => {
    cleanup();
  });

  const noopRename = vi.fn(() => Promise.resolve());
  const baseThread = buildMockChatThread({
    id: "t1",
    projectId: "p1",
    connectionId: null,
    scope: "project",
    title: "Test Thread",
    status: "open",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
    messageCount: 5,
    pendingMessageCount: 0,
    lastMessageAt: null,
    lastMessagePreview: null,
  });

  it("renders thread title and message count", () => {
    render(
      <ChatThreadHeader
        thread={baseThread}
        onCompact={() => {}}
        onCancelActiveTurn={() => {}}
        onRename={noopRename}
        isCompacting={false}
        isCancelling={false}
      />
    );
    expect(screen.getByText("Test Thread")).toBeInTheDocument();
    expect(screen.getByText("5 messages")).toBeInTheDocument();
  });

  it("shows replay warning if replayRequired is true", () => {
    const thread = { ...baseThread, runtimeState: { replayRequired: true } };
    render(
      <ChatThreadHeader
        thread={thread}
        onCompact={() => {}}
        onCancelActiveTurn={() => {}}
        onRename={noopRename}
        isCompacting={false}
        isCancelling={false}
      />
    );
    expect(screen.getAllByText("Replay Required")[0]).toBeInTheDocument();
  });

  it("shows active session and transitions to replay required after swap", () => {
    const threadActive = { ...baseThread, runtimeState: { replayRequired: false, sessionIds: ["sesh-1"] } };
    const { rerender } = render(
      <ChatThreadHeader
        thread={threadActive}
        onCompact={() => {}}
        onCancelActiveTurn={() => {}}
        onRename={noopRename}
        isCompacting={false}
        isCancelling={false}
      />
    );
    expect(screen.getByText("Active Session")).toBeInTheDocument();

    const threadReplay = { ...baseThread, runtimeState: { replayRequired: true, sessionIds: ["sesh-1"] } };
    rerender(
      <ChatThreadHeader
        thread={threadReplay}
        onCompact={() => {}}
        onCancelActiveTurn={() => {}}
        onRename={noopRename}
        isCompacting={false}
        isCancelling={false}
      />
    );
    expect(screen.getAllByText("Replay Required")[0]).toBeInTheDocument();
    expect(screen.queryByText("Active Session")).not.toBeInTheDocument();
  });

  it("shows compacting state styling when isCompacting is true", () => {
    const { container } = render(
      <ChatThreadHeader
        thread={baseThread}
        onCompact={() => {}}
        onCancelActiveTurn={() => {}}
        onRename={noopRename}
        isCompacting={true}
        isCancelling={false}
      />
    );
    const compactButton = container.querySelector('button[title="Compact Conversation"]');
    expect(compactButton).toHaveClass("cursor-wait");
    expect(compactButton).toHaveClass("opacity-70");
    expect(compactButton).toHaveAttribute("aria-busy", "true");
  });

  it("calls onCompact when compact button is clicked", () => {
    const onCompact = vi.fn();
    const { container } = render(
      <ChatThreadHeader
        thread={baseThread}
        onCompact={onCompact}
        onCancelActiveTurn={() => {}}
        onRename={noopRename}
        isCompacting={false}
        isCancelling={false}
      />
    );
    const compactButton = container.querySelector('button[title="Compact Conversation"]');
    if (compactButton) {
      fireEvent.click(compactButton);
    }
    expect(onCompact).toHaveBeenCalledOnce();
  });

  it("shows the selected virtual worker for an explicitly routed thread", () => {
    const thread = {
      ...baseThread,
      runtimeState: {
        routeKind: "virtual" as const,
        virtualProvider: "gemini",
      },
    };

    render(
      <ChatThreadHeader
        thread={thread}
        onCompact={() => {}}
        onCancelActiveTurn={() => {}}
        onRename={noopRename}
        isCompacting={false}
        isCancelling={false}
      />
    );

    expect(screen.getByText("Virtual gemini")).toBeInTheDocument();
  });

  it("shows unassigned when thread is unassigned", () => {
    const thread = { ...baseThread, connectionId: null, runtimeState: null };
    render(
      <ChatThreadHeader
        thread={thread}
        onCompact={() => {}}
        onCancelActiveTurn={() => {}}
        onRename={noopRename}
        isCompacting={false}
        isCancelling={false}
      />
    );

    expect(screen.getAllByText("Unassigned")[0]).toBeInTheDocument();
  });

  it("shows cancel request only while a thread has pending messages", () => {
    const onCancelActiveTurn = vi.fn();

    const { rerender } = render(
      <ChatThreadHeader
        thread={baseThread}
        onCompact={() => {}}
        onCancelActiveTurn={onCancelActiveTurn}
        onRename={noopRename}
        isCompacting={false}
        isCancelling={false}
      />
    );

    expect(screen.queryByRole("button", { name: "Cancel Request" })).not.toBeInTheDocument();

    rerender(
      <ChatThreadHeader
        thread={{ ...baseThread, pendingMessageCount: 1 }}
        onCompact={() => {}}
        onCancelActiveTurn={onCancelActiveTurn}
        onRename={noopRename}
        isCompacting={false}
        isCancelling={false}
      />
    );

    const cancelButton = screen.getByRole("button", { name: "Cancel Request" });
    expect(cancelButton).toBeInTheDocument();
    fireEvent.click(cancelButton);
    expect(onCancelActiveTurn).toHaveBeenCalledOnce();

    rerender(
      <ChatThreadHeader
        thread={{ ...baseThread, pendingMessageCount: 1 }}
        onCompact={() => {}}
        onCancelActiveTurn={onCancelActiveTurn}
        onRename={noopRename}
        isCompacting={false}
        isCancelling={true}
      />
    );

    const cancellingButton = screen.getByRole("button", { name: "Cancelling..." });
    expect(cancellingButton).toBeDisabled();
    expect(cancellingButton).toHaveAttribute("aria-busy", "true");
  });

  it("saves a renamed title from the keyboard", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn(() => Promise.resolve());
    render(
      <ChatThreadHeader
        thread={baseThread}
        onCompact={() => {}}
        onCancelActiveTurn={() => {}}
        onRename={onRename}
        isCompacting={false}
        isCancelling={false}
      />
    );

    await user.click(screen.getByRole("button", { name: "Rename Test Thread" }));
    const input = screen.getByRole("textbox", { name: "Thread title" });
    await user.clear(input);
    await user.type(input, "Renamed Thread{Enter}");

    expect(onRename).toHaveBeenCalledWith("Renamed Thread");
  });

  it("rejects empty renamed titles before calling the API", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn(() => Promise.resolve());
    render(
      <ChatThreadHeader
        thread={baseThread}
        onCompact={() => {}}
        onCancelActiveTurn={() => {}}
        onRename={onRename}
        isCompacting={false}
        isCancelling={false}
      />
    );

    await user.click(screen.getByRole("button", { name: "Rename Test Thread" }));
    const input = screen.getByRole("textbox", { name: "Thread title" });
    await user.clear(input);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Thread title is required.");
  });

  it("cancels rename edits with Escape", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn(() => Promise.resolve());
    render(
      <ChatThreadHeader
        thread={baseThread}
        onCompact={() => {}}
        onCancelActiveTurn={() => {}}
        onRename={onRename}
        isCompacting={false}
        isCancelling={false}
      />
    );

    await user.click(screen.getByRole("button", { name: "Rename Test Thread" }));
    const input = screen.getByRole("textbox", { name: "Thread title" });
    await user.clear(input);
    await user.type(input, "Draft");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Thread title" })).not.toBeInTheDocument();
    expect(screen.getByText("Test Thread")).toBeInTheDocument();
  });
});
