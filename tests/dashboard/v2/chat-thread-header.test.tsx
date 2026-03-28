// @vitest-environment jsdom
/** @jsx h */
import { describe, it, expect, vi } from "vitest";
import { h } from "preact";
import { render, screen, fireEvent } from "@testing-library/preact";
import * as matchers from '@testing-library/jest-dom/matchers';
import { ChatThreadHeader } from "../../../dashboard/src/v2/components/chat/ChatThreadHeader.js";

expect.extend(matchers);

describe("ChatThreadHeader", () => {
  const mockOptions = [
    { id: "conn-1", label: "Worker 1", status: "online", isPrimary: false, type: "connection", isSelectable: true },
    { id: "virtual:gemini", label: "Virtual Gemini", status: "available", isPrimary: true, type: "virtual", isSelectable: true, providerId: "gemini" },
  ];

  const baseThread = {
    id: "t1",
    projectId: "p1",
    connectionId: null,
    scope: "project",
    title: "Test Thread",
    status: "active",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
    messageCount: 5,
    pendingMessageCount: 0,
    lastMessageAt: null,
    lastMessagePreview: null,
  } as any;

  it("renders thread title and message count", () => {
    render(
      <ChatThreadHeader
        thread={baseThread}
        workerOptions={mockOptions as any}
        isAssigning={false}
        onAssignRoute={() => {}}
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
        workerOptions={mockOptions as any}
        isAssigning={false}
        onAssignRoute={() => {}}
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
        workerOptions={mockOptions as any}
        isAssigning={false}
        onAssignRoute={() => {}}
        onCompact={() => {}}
        isCompacting={false}
      />
    );
    expect(screen.getByText("Active Session")).toBeInTheDocument();

    const threadReplay = { ...baseThread, runtimeState: { replayRequired: true, sessionIds: ["sesh-1"] } };
    rerender(
      <ChatThreadHeader
        thread={threadReplay}
        workerOptions={mockOptions as any}
        isAssigning={false}
        onAssignRoute={() => {}}
        onCompact={() => {}}
        isCompacting={false}
      />
    );
    expect(screen.getAllByText("Replay Required")[0]).toBeInTheDocument();
    expect(screen.queryByText("Active Session")).not.toBeInTheDocument();
  });

  it("calls onCompact when compact button is clicked", () => {
    const onCompact = vi.fn();
    const { container } = render(
      <ChatThreadHeader
        thread={baseThread}
        workerOptions={mockOptions as any}
        isAssigning={false}
        onAssignRoute={() => {}}
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
        routeKind: "virtual",
        virtualProvider: "gemini",
      },
    };

    render(
      <ChatThreadHeader
        thread={thread}
        workerOptions={mockOptions as any}
        isAssigning={false}
        onAssignRoute={() => {}}
        onCompact={() => {}}
        isCompacting={false}
      />
    );

    const selects = screen.getAllByRole("combobox");
    const select = selects[selects.length - 1] as HTMLSelectElement;
    expect(select.value).toBe("virtual:gemini");
  });

  it("disables select when assigning", () => {
    const thread = { ...baseThread, title: "Select Test Thread" };
    render(
      <ChatThreadHeader
        thread={thread}
        workerOptions={mockOptions as any}
        isAssigning={true}
        onAssignRoute={() => {}}
        onCompact={() => {}}
        isCompacting={false}
      />
    );
    const selects = screen.getAllByRole("combobox");
    const select = selects[selects.length - 1]; // Use the last one to be sure
    expect(select).toBeDisabled();
  });

  it("calls onAssignRoute with correctly selected option when a new worker is selected", () => {
    const onAssignRoute = vi.fn();
    const thread = { ...baseThread, title: "Select Change Test Thread" };
    render(
      <ChatThreadHeader
        thread={thread}
        workerOptions={mockOptions as any}
        isAssigning={false}
        onAssignRoute={onAssignRoute}
        onCompact={() => {}}
        isCompacting={false}
      />
    );
    const selects = screen.getAllByRole("combobox");
    const select = selects[selects.length - 1];
    fireEvent.change(select, { target: { value: "virtual:gemini" } });
    expect(onAssignRoute).toHaveBeenCalledWith(mockOptions[1]);
  });
});
