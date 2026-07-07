/**
 * @vitest-environment jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import { cleanup, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it } from "vitest";
import { InvocationMessageBubble } from "../InvocationMessageBubble.js";
import type { ChatLiveSprintWidget, ChatLiveTaskWidget } from "../../../lib/chat-live-entities.js";
import type { ExecutionInvocationMessageRecord } from "../../../types.js";

expect.extend(matchers);

const createInvocationMessage = (
  overrides: Partial<ExecutionInvocationMessageRecord> = {},
): ExecutionInvocationMessageRecord => ({
  id: "msg-inv-live",
  invocationId: "inv-1",
  role: "assistant",
  contentMarkdown: "Working against SPR-7 and TASK-42.",
  toolCallsJson: null,
  createdAt: "2026-03-10T12:00:00.000Z",
  metadata: null,
  ...overrides,
});

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
  displayKey: "TASK-42",
  name: "Wire live entity status cards",
  status: "completed",
  href: "/tasks?sprintId=sprint-7&taskId=task-42",
  sprintId: "sprint-7",
  sprintKey: "SPR-7",
  sprintName: "Build payment flow",
  priority: "critical",
  executorType: "docker_cli",
  isMerged: false,
  mergeIndicator: null,
  ...overrides,
});

describe("InvocationMessageBubble live entities", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders sprint and task live entity widgets in a normal invocation bubble", () => {
    const message = createInvocationMessage({
      metadata: {
        provider: "codex",
        model: "gpt-5",
        status: "queued",
        response: "accepted",
      },
    });

    render(
      <InvocationMessageBubble
        message={message}
        liveEntities={[createSprintEntity(), createTaskEntity()]}
      />,
    );

    expect(screen.getByText("Working against SPR-7 and TASK-42.")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.getByText("processed")).toBeInTheDocument();
    expect(screen.getAllByText(/From Assistant at .*Status: processed\./).length).toBeGreaterThan(0);

    const liveRegion = screen.getByLabelText("Live sprint and task status");
    expect(screen.getByText("Live sprint context")).toBeInTheDocument();
    expect(within(liveRegion).getByText("Build payment flow")).toBeInTheDocument();
    expect(screen.getByRole("link", {
      name: "Open sprint SPR-7: Build payment flow. Live status: Running.",
    })).toHaveAttribute("href", "/sprints?sprintKey=SPR-7");
    expect(screen.getByRole("link", {
      name: "Open task TASK-42: Wire live entity status cards. Live status: Completed.",
    })).toHaveAttribute("href", "/tasks?sprintId=sprint-7&taskId=task-42");
  });

  it("renders planning and live entity widgets together with stable spacing", () => {
    const message = createInvocationMessage({
      contentMarkdown: "Planning the sprint.",
      metadata: {
        routeKind: "virtual",
        status: "queued",
      },
    });

    const { container } = render(
      <InvocationMessageBubble
        message={message}
        liveEntities={[createSprintEntity()]}
      />,
    );

    expect(screen.getByText("Execution Plan")).toBeInTheDocument();
    expect(screen.getByText("Preparing to plan...")).toBeInTheDocument();
    expect(screen.getByText("Live sprint context")).toBeInTheDocument();
    expect(screen.getByRole("link", {
      name: "Open sprint SPR-7: Build payment flow. Live status: Running.",
    })).toBeInTheDocument();

    const liveContext = screen.getByText("Live sprint context");
    const textContent = container.textContent ?? "";
    expect(liveContext.closest(".mt-3")).toBeInTheDocument();
    expect(textContent.indexOf("Execution Plan")).toBeLessThan(textContent.indexOf("Live sprint context"));
  });

  it("keeps tool-call turns rendered as ToolCallWidget without live entity chrome", () => {
    const message = createInvocationMessage({
      id: "msg-tool-call",
      role: "assistant",
      contentMarkdown: "",
      toolCallsJson: {
        arguments: JSON.stringify({ path: "src/app.ts" }),
      },
      metadata: {
        kind: "tool_call",
        toolName: "read_file",
        toolStatus: "completed",
        toolCallId: "call-1",
      },
    });

    render(
      <InvocationMessageBubble
        message={message}
        liveEntities={[createSprintEntity(), createTaskEntity()]}
      />,
    );

    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(screen.queryByText("Live sprint context")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Live sprint and task status")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", {
      name: /Open sprint SPR-7/,
    })).not.toBeInTheDocument();
  });
});
