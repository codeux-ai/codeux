/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { render, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { describe, expect, it, vi } from "vitest";

import { ChatMessageBubble } from "../../../dashboard/src/v2/components/chat/ChatMessageBubble.js";
import { InvocationMessageBubble } from "../../../dashboard/src/v2/components/chat/InvocationMessageBubble.js";
import { selectAgentHumorMessage } from "../../../dashboard/src/v2/lib/agent-humor-messages.js";
import type { ChatMessageRecord, ExecutionInvocationMessageRecord } from "../../../dashboard/src/v2/types.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/lib/markdown.js", () => ({
  renderMarkdown: (md: string) => `<p>${md}</p>`,
}));

const moodAside = (container: HTMLElement): HTMLElement | null => (
  within(container).queryByRole("note", { name: "Project manager thought" })
);

const createChatMessage = (overrides: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id: "msg_agent",
  threadId: "thread_1",
  direction: "connection_to_dashboard",
  authorType: "connection",
  authorConnectionId: "conn_1",
  bodyMarkdown: "Provider text stays visible.",
  deliveryStatus: "delivered",
  createdAt: "2026-03-10T12:00:00.000Z",
  metadata: null,
  ...overrides,
});

const createInvocationMessage = (
  overrides: Partial<ExecutionInvocationMessageRecord> = {},
): ExecutionInvocationMessageRecord => ({
  id: "msg_inv_agent",
  invocationId: "inv_1",
  role: "assistant",
  contentMarkdown: "Provider invocation text stays visible.",
  toolCallsJson: null,
  createdAt: "2026-03-10T12:00:00.000Z",
  metadata: null,
  ...overrides,
});

describe("assistant mood asides", () => {
  it("renders explicit metadata comments without replacing thread assistant markdown", () => {
    const explicitAside = "Quietly moving sticky notes into a less dramatic pile.";
    const message = createChatMessage({
      metadata: {
        moodComment: explicitAside,
      },
    });

    const { container } = render(<ChatMessageBubble message={message} />);
    const aside = moodAside(container);

    expect(container.textContent).toContain("Provider text stays visible.");
    expect(aside).toBeInTheDocument();
    expect(aside).toHaveTextContent(explicitAside);
  });

  it("renders explicit metadata comments without replacing invocation assistant markdown", () => {
    const explicitAside = "Checking the calendar twice, because optimism needs supervision.";
    const message = createInvocationMessage({
      metadata: {
        thinkingLine: explicitAside,
      },
    });

    const { container } = render(<InvocationMessageBubble message={message} />);
    const aside = moodAside(container);

    expect(container.textContent).toContain("Provider invocation text stays visible.");
    expect(aside).toBeInTheDocument();
    expect(aside).toHaveTextContent(explicitAside);
  });

  it("generates a deterministic fallback mood line for thread assistant messages", () => {
    const message = createChatMessage({
      id: "msg_fallback",
      bodyMarkdown: "The implementation is ready for review.",
    });
    const expected = selectAgentHumorMessage({
      category: "mood",
      seed: "msg_fallback|The implementation is ready for review.|Planner Pal",
      nowMs: 0,
    });

    const { container } = render(<ChatMessageBubble message={message} agentName="Planner Pal" />);
    const aside = moodAside(container);

    expect(aside).toBeInTheDocument();
    expect(aside).toHaveTextContent(expected);
  });

  it("does not render mood asides for user, system, or tool messages", () => {
    const userThreadMessage = createChatMessage({
      id: "msg_user",
      direction: "dashboard_to_connection",
      authorType: "dashboard_user",
      authorConnectionId: null,
      metadata: {
        pmAside: "This should not render.",
      },
    });
    const systemThreadMessage = createChatMessage({
      id: "msg_system",
      authorType: "system",
      authorConnectionId: null,
      metadata: {
        pmAside: "This should not render either.",
      },
    });
    const userInvocationMessage = createInvocationMessage({
      id: "msg_inv_user",
      role: "user",
      metadata: {
        pmAside: "No aside for users.",
      },
    });
    const systemInvocationMessage = createInvocationMessage({
      id: "msg_inv_system",
      role: "system",
      metadata: {
        pmAside: "No aside for systems.",
      },
    });
    const toolInvocationMessage = createInvocationMessage({
      id: "msg_inv_tool",
      role: "tool",
      metadata: {
        pmAside: "No aside for tools.",
      },
    });

    const { container: userThreadContainer } = render(<ChatMessageBubble message={userThreadMessage} />);
    const { container: systemThreadContainer } = render(<ChatMessageBubble message={systemThreadMessage} />);
    const { container: userInvocationContainer } = render(<InvocationMessageBubble message={userInvocationMessage} />);
    const { container: systemInvocationContainer } = render(<InvocationMessageBubble message={systemInvocationMessage} />);
    const { container: toolInvocationContainer } = render(<InvocationMessageBubble message={toolInvocationMessage} />);

    expect(moodAside(userThreadContainer)).not.toBeInTheDocument();
    expect(moodAside(systemThreadContainer)).not.toBeInTheDocument();
    expect(moodAside(userInvocationContainer)).not.toBeInTheDocument();
    expect(moodAside(systemInvocationContainer)).not.toBeInTheDocument();
    expect(moodAside(toolInvocationContainer)).not.toBeInTheDocument();
  });

  it("does not render mood asides on reasoning or tool invocation cards", () => {
    const reasoningMessage = createInvocationMessage({
      id: "msg_reasoning",
      contentMarkdown: "Internal reasoning should stay in its widget.",
      metadata: {
        kind: "reasoning",
        pmAside: "No aside for reasoning.",
      },
    });
    const toolCallMessage = createInvocationMessage({
      id: "msg_tool_call",
      toolCallsJson: { arguments: "{\"command\":\"pnpm test\"}" },
      metadata: {
        kind: "tool_call",
        toolName: "exec_command",
        pmAside: "No aside for tool calls.",
      },
    });
    const toolResultMessage = createInvocationMessage({
      id: "msg_tool_result",
      role: "tool",
      toolCallsJson: { output: "passed" },
      metadata: {
        kind: "tool_result",
        toolName: "exec_command",
        pmAside: "No aside for tool results.",
      },
    });

    const { container: reasoningContainer } = render(<InvocationMessageBubble message={reasoningMessage} />);
    const { container: toolCallContainer } = render(<InvocationMessageBubble message={toolCallMessage} />);
    const { container: toolResultContainer } = render(<InvocationMessageBubble message={toolResultMessage} />);

    expect(within(reasoningContainer).getByRole("region", { name: /Reasoning turn/i })).toBeInTheDocument();
    expect(within(toolCallContainer).getByText("exec_command")).toBeInTheDocument();
    expect(within(toolResultContainer).getByText("exec_command")).toBeInTheDocument();
    expect(moodAside(reasoningContainer)).not.toBeInTheDocument();
    expect(moodAside(toolCallContainer)).not.toBeInTheDocument();
    expect(moodAside(toolResultContainer)).not.toBeInTheDocument();
  });
});
