// @vitest-environment happy-dom
/** @jsx h */
import { describe, it, expect, vi } from "vitest";
import { h } from "preact";
import { render, screen, fireEvent } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from '@testing-library/jest-dom/matchers';
import { ChatThreadHeader } from "../../../dashboard/src/v2/components/chat/ChatThreadHeader.js";
import { buildMockChatThread } from "../factories/chat-fixture-factory.js";

expect.extend(matchers);

describe("ChatThreadHeader", () => {
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
        isCompacting={false}
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
        isCompacting={false}
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
        isCompacting={false}
      />
    );
    expect(screen.getByText("Active Session")).toBeInTheDocument();

    const threadReplay = { ...baseThread, runtimeState: { replayRequired: true, sessionIds: ["sesh-1"] } };
    rerender(
      <ChatThreadHeader
        thread={threadReplay}
        onCompact={() => {}}
        isCompacting={false}
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
        isCompacting={true}
      />
    );
    const compactButton = container.querySelector('button[title="Compact Conversation"]');
    expect(compactButton).toHaveClass("cursor-wait");
    expect(compactButton).toHaveClass("opacity-70");
  });

  it("calls onCompact when compact button is clicked", () => {
    const onCompact = vi.fn();
    const { container } = render(
      <ChatThreadHeader
        thread={baseThread}
        onCompact={onCompact}
        isCompacting={false}
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
        isCompacting={false}
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
        isCompacting={false}
      />
    );

    expect(screen.getAllByText("Unassigned")[0]).toBeInTheDocument();
  });
});
