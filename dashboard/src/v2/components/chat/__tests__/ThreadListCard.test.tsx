/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/preact";
import { ThreadListCard } from "../ThreadListCard.js";
import type { ChatThread } from "../../../types.js";

afterEach(() => {
  cleanup();
});

const threads = [
  {
    id: "thread-1",
    projectId: "project-1",
    connectionId: null,
    scope: "project",
    title: "First Thread",
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    pendingMessageCount: 0,
    lastMessageAt: "2026-01-01T00:00:00.000Z",
    lastMessagePreview: "Hello",
    runtimeState: null,
  },
  {
    id: "thread-2",
    projectId: "project-1",
    connectionId: null,
    scope: "project",
    title: "Second Thread",
    status: "open",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messageCount: 2,
    pendingMessageCount: 1,
    lastMessageAt: "2026-01-01T00:00:00.000Z",
    lastMessagePreview: "Pending",
    runtimeState: null,
  },
] satisfies ChatThread[];

describe("ThreadListCard", () => {
  it("marks selected item and preserves selected visual hook", () => {
    const { getByRole } = render(
      <ThreadListCard
        threads={threads}
        selectedThreadId="thread-2"
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        deletingThreadId={null}
      />
    );

    const selected = getByRole("option", { name: /Second Thread/i });
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.getAttribute("data-state")).toBe("selected");

    const idle = getByRole("option", { name: /First Thread/i });
    expect(idle.getAttribute("aria-selected")).toBe("false");
    expect(idle.getAttribute("data-state")).toBe("idle");
  });

  it("keeps delete action independent from selection", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const { getByLabelText } = render(
      <ThreadListCard
        threads={threads}
        selectedThreadId={null}
        onSelect={onSelect}
        onDelete={onDelete}
        deletingThreadId={null}
      />
    );

    fireEvent.click(getByLabelText("Delete First Thread"));
    expect(onDelete).toHaveBeenCalledWith("thread-1");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
