/**
 * @vitest-environment jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import { cleanup, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it } from "vitest";
import { LiveEntityStatusWidget } from "../LiveEntityStatusWidget.js";
import type { ChatLiveSprintWidget, ChatLiveTaskWidget } from "../../../../lib/chat-live-entities.js";

expect.extend(matchers);

const createSprintEntity = (overrides: Partial<ChatLiveSprintWidget> = {}): ChatLiveSprintWidget => ({
  kind: "sprint",
  recordId: "sprint-7",
  displayKey: "SPR-7",
  name: "Build payment flow",
  status: "running",
  href: "/sprints?sprintId=sprint-7&sprintKey=SPR-7",
  sprintNumber: 7,
  tasksCount: 4,
  completedTasks: 2,
  completion: 50,
  ...overrides,
});

const createTaskEntity = (overrides: Partial<ChatLiveTaskWidget> = {}): ChatLiveTaskWidget => ({
  kind: "task",
  recordId: "task-42",
  displayKey: "T42",
  name: "Wire the checkout task status panel",
  status: "completed",
  href: "/tasks?sprintId=sprint-7&taskId=task-42",
  sprintId: "sprint-7",
  sprintKey: "SPR-7",
  sprintName: "Build payment flow",
  priority: "critical",
  executorType: "docker_cli",
  isMerged: false,
  mergeIndicator: "Review pending",
  ...overrides,
});

describe("LiveEntityStatusWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing for an empty entity list", () => {
    const { container } = render(<LiveEntityStatusWidget entities={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders a linked sprint card with status, completion, and task counts", () => {
    render(<LiveEntityStatusWidget entities={[createSprintEntity()]} />);

    const link = screen.getByRole("link", {
      name: /Open sprint SPR-7: Build payment flow\. Live status: Running\./,
    });

    expect(link).toHaveAttribute("href", "/sprints?sprintKey=SPR-7");
    expect(within(link).getByText("SPR-7")).toBeInTheDocument();
    expect(within(link).getByText("Build payment flow")).toBeInTheDocument();
    expect(within(link).getByText("Running")).toBeInTheDocument();
    expect(within(link).getByText("50% complete")).toBeInTheDocument();
    expect(within(link).getByText("2/4 complete")).toBeInTheDocument();
    expect(within(link).getByText("4 tasks")).toBeInTheDocument();

    const progress = within(link).getByRole("progressbar", { name: "Sprint completion for SPR-7" });
    expect(progress).toHaveAttribute("aria-valuenow", "50");
  });

  it("renders a linked task card with status, priority, executor, and review indicator", () => {
    render(<LiveEntityStatusWidget entities={[createTaskEntity()]} />);

    const link = screen.getByRole("link", {
      name: /Open task T42: Wire the checkout task status panel\. Live status: Completed\./,
    });

    expect(link).toHaveAttribute("href", "/tasks?sprintId=sprint-7&taskId=task-42");
    expect(within(link).getByText("T42")).toBeInTheDocument();
    expect(within(link).getByText("Wire the checkout task status panel")).toBeInTheDocument();
    expect(within(link).getByText("Completed")).toBeInTheDocument();
    expect(within(link).getByText("Critical")).toBeInTheDocument();
    expect(within(link).getByText("CLI")).toBeInTheDocument();
    expect(within(link).getByText("Review pending")).toBeInTheDocument();
    expect(within(link).getByText("SPR-7")).toBeInTheDocument();
  });

  it("announces each linked entity by kind, key, title, and live status", () => {
    render(<LiveEntityStatusWidget entities={[createSprintEntity(), createTaskEntity()]} />);

    expect(screen.getByRole("link", {
      name: "Open sprint SPR-7: Build payment flow. Live status: Running.",
    })).toBeInTheDocument();
    expect(screen.getByRole("link", {
      name: "Open task T42: Wire the checkout task status panel. Live status: Completed.",
    })).toBeInTheDocument();
  });

  it("keeps long titles wrapped inside stable link cards", () => {
    const longTitle = "Implement-super-long-live-entity-title-without-natural-breakpoints-for-chat-rendering";

    render(<LiveEntityStatusWidget entities={[createTaskEntity({ name: longTitle })]} />);

    const title = screen.getByTestId("live-entity-title-task-42");
    expect(title).toHaveTextContent(longTitle);
    expect(title.className).toContain("break-words");
    expect(title.className).toContain("whitespace-normal");

    const link = screen.getByRole("link", {
      name: `Open task T42: ${longTitle}. Live status: Completed.`,
    });
    expect(link.className).toContain("min-w-0");
    expect(link.className).toContain("focus-visible:outline");
  });
});
