/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessageBubble } from "../ChatMessageBubble.js";
import type { ChatLiveTaskWidget } from "../../../lib/chat-live-entities.js";
import type { ChatMessageRecord } from "../../../types.js";

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
  },
}));

const createMessage = (overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id: "msg-1",
  threadId: "thread-1",
  direction: "connection_to_dashboard",
  authorType: "connection",
  authorConnectionId: "connection-1",
  bodyMarkdown: "Thread body with **markdown**.",
  deliveryStatus: "delivered",
  createdAt: "2026-03-10T12:00:00.000Z",
  metadata: null,
  ...overrides,
});

const createLiveTaskEntity = (overrides: Partial<ChatLiveTaskWidget> = {}): ChatLiveTaskWidget => ({
  kind: "task",
  recordId: "task-42",
  displayKey: "TASK-42",
  name: "Render live task context",
  status: "completed",
  href: "/tasks?sprintId=sprint-7&taskId=task-42",
  sprintId: "sprint-7",
  sprintKey: "SPR-7",
  sprintName: "Operator transcript widgets",
  priority: "high",
  executorType: "docker_cli",
  isMerged: false,
  mergeIndicator: null,
  ...overrides,
});

describe("ChatMessageBubble live entities", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a live task widget in a thread bubble while keeping markdown visible", () => {
    const { container } = render(
      <ChatMessageBubble
        message={createMessage({ bodyMarkdown: "Track **TASK-42** from this response." })}
        liveEntities={[createLiveTaskEntity()]}
      />,
    );

    expect(container.textContent).toContain("Track TASK-42 from this response.");
    expect(screen.getByText("Live sprint context")).toBeInTheDocument();

    const taskLink = screen.getByRole("link", {
      name: "Open task TASK-42: Render live task context. Live status: Completed.",
    });
    expect(taskLink).toHaveAttribute("href", "/tasks?sprintId=sprint-7&taskId=task-42");
    expect(within(taskLink).getByText("Render live task context")).toBeInTheDocument();
  });

  it("renders planning and live entity widgets together with separated slot content", () => {
    const { container } = render(
      <ChatMessageBubble
        message={createMessage({
          bodyMarkdown: "Plan the sprint and keep TASK-42 attached.",
          metadata: {
            type: "planning",
            status: "queued",
            planName: "Sprint materialization",
          },
        })}
        liveEntities={[createLiveTaskEntity({ status: "in_progress" })]}
      />,
    );

    expect(container.textContent).toContain("Plan the sprint and keep TASK-42 attached.");
    expect(screen.getByText("Sprint materialization")).toBeInTheDocument();
    expect(screen.getByText("Preparing to plan...")).toBeInTheDocument();
    expect(screen.getByText("Live sprint context")).toBeInTheDocument();
    expect(screen.getByRole("link", {
      name: "Open task TASK-42: Render live task context. Live status: In Progress.",
    })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /Widget:/ })).toHaveLength(2);

    const liveWidgetWrapper = screen.getByText("Live sprint context").closest(".border-t");
    expect(liveWidgetWrapper).toHaveClass("pt-4");
  });

  it("does not render empty live widget chrome when no live entities are supplied", () => {
    const { container } = render(
      <ChatMessageBubble
        message={createMessage({ bodyMarkdown: "Plain thread message." })}
        liveEntities={[]}
      />,
    );

    expect(container.textContent).toContain("Plain thread message.");
    expect(screen.queryByText("Live sprint context")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Widget:/ })).not.toBeInTheDocument();
  });
});
