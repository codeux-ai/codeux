/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { ChatMessageBubble } from "../../../dashboard/src/v2/components/chat/ChatMessageBubble.js";
import { InvocationMessageBubble } from "../../../dashboard/src/v2/components/chat/InvocationMessageBubble.js";
import { InvocationListCard } from "../../../dashboard/src/v2/components/chat/InvocationListCard.js";
import { WorkingBubble } from "../../../dashboard/src/v2/components/chat/WorkingBubble.js";
import type { ChatMessageRecord, ExecutionInvocationMessageRecord, ConversationRuntimeState, ExecutionInvocationRecord } from "../../../dashboard/src/v2/types.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/lib/markdown.js", () => ({
  renderMarkdown: (md: string) => `<p>${md}</p>`
}));

vi.mock("../../../dashboard/src/v2/lib/chat-time.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../dashboard/src/v2/lib/chat-time.js")>();
  return {
    ...actual,
    formatChatTime: () => "2026-06-03 12:34",
  };
});

describe("Chat Message Bubbles", () => {
  describe("ChatMessageBubble", () => {
    it("renders plain markdown when no planning metadata is present", () => {
      const message: ChatMessageRecord = {
        id: "msg_1",
        threadId: "thread_1",
        direction: "connection_to_dashboard",
        authorType: "connection",
        authorConnectionId: "conn_1",
        bodyMarkdown: "Hello world",
        deliveryStatus: "delivered",
        createdAt: new Date().toISOString(),
        metadata: null,
      };

      const { container } = render(<ChatMessageBubble message={message} />);
      expect(container.innerHTML).toContain("Hello world");
    });

    it("does not render Invalid Date when the timestamp is missing or malformed", () => {
      const message: ChatMessageRecord = {
        id: "msg_invalid",
        threadId: "thread_1",
        direction: "connection_to_dashboard",
        authorType: "connection",
        authorConnectionId: "conn_1",
        bodyMarkdown: "No timestamp",
        deliveryStatus: "processed",
        createdAt: "",
        metadata: null,
      };

      const { container } = render(<ChatMessageBubble message={message} />);
      expect(container.textContent).not.toContain("Invalid Date");
    });

    it("renders a planning widget when planning metadata is present", () => {
      const message: ChatMessageRecord = {
        id: "msg_2",
        threadId: "thread_1",
        direction: "dashboard_to_connection",
        authorType: "dashboard_user",
        authorConnectionId: null,
        bodyMarkdown: "Make a plan",
        deliveryStatus: "delivered",
        createdAt: new Date().toISOString(),
        metadata: {
          type: "planning",
          status: "running",
          planName: "My special plan"
        },
      };

      const { container, getByText } = render(<ChatMessageBubble message={message} />);
      expect(getByText("My special plan")).toBeInTheDocument();
      expect(getByText("Navigating solutions...")).toBeInTheDocument();
    });

    it("uses light-mode contrast tokens for the message shell and body", () => {
      const message: ChatMessageRecord = {
        id: "msg_3",
        threadId: "thread_1",
        direction: "connection_to_dashboard",
        authorType: "connection",
        authorConnectionId: "conn_1",
        bodyMarkdown: "Contrast check",
        deliveryStatus: "delivered",
        createdAt: "2026-06-03T12:34:56.000Z",
        metadata: {
          provider: "gemini",
          agentName: "Assistant",
        },
      };

      const { container, getByText, queryAllByText } = render(<ChatMessageBubble message={message} />);
      const sender = queryAllByText("Assistant")[0];
      const bubble = sender.parentElement?.parentElement;
      const body = getByText("Contrast check").parentElement;
      const providerChip = getByText("gemini");
      const createdAt = queryAllByText("2026-06-03 12:34")[0];

      expect(bubble).toHaveClass("bg-black/[0.03]", "dark:bg-white/5");
      expect(bubble).toHaveClass("border-black/[0.06]", "dark:border-white/10");
      expect(sender).toHaveClass("text-slate-700", "dark:text-slate-300");
      expect(providerChip).toHaveClass("bg-black/[0.03]", "dark:bg-white/5", "text-slate-700", "dark:text-slate-300");
      expect(createdAt.parentElement).toHaveClass("text-slate-500", "dark:text-slate-400");
      expect(body).toHaveClass("text-slate-700", "dark:text-slate-300");
      expect(container.textContent).toContain("Contrast check");
    });
  });

  describe("InvocationMessageBubble", () => {
    it("renders plain markdown and tool calls for standard messages", () => {
      const message: ExecutionInvocationMessageRecord = {
        id: "msg_1",
        invocationId: "inv_1",
        role: "assistant",
        contentMarkdown: "Using tool",
        toolCallsJson: { tool: "test" },
        createdAt: new Date().toISOString(),
      };

      const { container } = render(<InvocationMessageBubble message={message} />);
      expect(container.innerHTML).toContain("Using tool");
      expect(container.innerHTML).toContain('"tool": "test"');
    });

    it("does not render Invalid Date for malformed invocation timestamps", () => {
      const message: ExecutionInvocationMessageRecord = {
        id: "msg_invalid",
        invocationId: "inv_1",
        role: "assistant",
        contentMarkdown: "Still valid",
        toolCallsJson: null,
        createdAt: "",
      };

      const { container } = render(<InvocationMessageBubble message={message} />);
      expect(container.textContent).not.toContain("Invalid Date");
    });

    it("renders a planning widget when metadata indicates virtual route", () => {
      const message: ExecutionInvocationMessageRecord = {
        id: "msg_2",
        invocationId: "inv_1",
        role: "assistant",
        contentMarkdown: "Working on it",
        toolCallsJson: null,
        createdAt: new Date().toISOString(),
        metadata: {
          routeKind: "virtual",
          status: "queued"
        }
      };

      const { getByText } = render(<InvocationMessageBubble message={message} />);
      expect(getByText("Execution Plan")).toBeInTheDocument();
      expect(getByText("Preparing to plan...")).toBeInTheDocument();
    });

    it("renders a classified error badge when invocation metadata includes an error category", () => {
      const message: ExecutionInvocationMessageRecord = {
        id: "msg_3",
        invocationId: "inv_1",
        role: "system",
        contentMarkdown: "Provider error (RATE_LIMITED): Gemini rate-limited.",
        toolCallsJson: null,
        createdAt: new Date().toISOString(),
        metadata: {
          provider: "gemini",
          model: "default",
          errorCategory: "RATE_LIMITED",
        },
      };

      const { getByText } = render(<InvocationMessageBubble message={message} />);
      expect(getByText("Rate limit")).toBeInTheDocument();
      expect(getByText("default")).toBeInTheDocument();
    });

    it("uses light-mode contrast tokens for the invocation shell and metadata chips", () => {
      const message: ExecutionInvocationMessageRecord = {
        id: "msg_4",
        invocationId: "inv_1",
        role: "assistant",
        contentMarkdown: "Invocation contrast",
        toolCallsJson: { tool: "test" },
        createdAt: "2026-06-03T12:34:56.000Z",
        metadata: {
          provider: "gemini",
          model: "flash",
        },
      };

      const { container, getByText, queryAllByText } = render(<InvocationMessageBubble message={message} />);
      const sender = queryAllByText("assistant")[0];
      const bubble = sender.parentElement?.parentElement;
      const body = getByText("Invocation contrast").parentElement;
      const providerChip = queryAllByText("gemini")[0];
      const modelChip = queryAllByText("flash")[0];
      const toolCalls = container.querySelector("pre")?.parentElement;

      expect(bubble).toHaveClass("bg-black/[0.03]", "dark:bg-white/5");
      expect(bubble).toHaveClass("border-black/[0.06]", "dark:border-white/10");
      expect(sender).toHaveClass("text-slate-700", "dark:text-slate-300");
      expect(providerChip).toHaveClass("bg-black/[0.03]", "dark:bg-white/5", "text-slate-700", "dark:text-slate-300");
      expect(modelChip).toHaveClass("bg-black/[0.03]", "dark:bg-white/5", "text-slate-700", "dark:text-slate-300");
      expect(body).toHaveClass("text-slate-700", "dark:text-slate-300");
      expect(toolCalls).toHaveClass("border-black/[0.06]", "dark:border-white/10", "bg-black/[0.03]", "dark:bg-white/5");
      expect(container.textContent).toContain("Invocation contrast");
    });
  });

  describe("InvocationListCard", () => {
    it("shows the model and latest error tag on invocation cards", () => {
      const invocation: ExecutionInvocationRecord = {
        id: "inv-1",
        projectId: "project-1",
        sprintId: null,
        taskId: null,
        sprintRunId: null,
        dispatchId: null,
        taskRunId: null,
        attentionItemId: null,
        providerInvocationId: null,
        type: "planning",
        status: "completed",
        provider: "gemini",
        model: "default",
        systemPrompt: null,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        errorMessage: null,
        lastErrorCategory: "RATE_LIMITED",
        lastErrorMessage: "Gemini rate-limited.",
        lastRetryAfterIso: null,
        messageCount: 2,
        lastMessageAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const { container } = render(
        <InvocationListCard
          invocations={[invocation]}
          selectedInvocationId={null}
          onSelect={vi.fn()}
        />
      );

      expect(container.textContent).toContain("Rate limit");
      expect(container.textContent).toContain("gemini");
      expect(container.textContent).toContain("default");
    });
  });

  describe("WorkingBubble", () => {
    it("renders the default listener pulsing message when not planning", () => {
      const { getByText } = render(<WorkingBubble displayName="TestWorker" runtimeState={null} />);
      expect(getByText("TestWorker is preparing a reply")).toBeInTheDocument();
    });

    it("renders an animated planning widget when routeKind is virtual", () => {
      const runtimeState: ConversationRuntimeState = {
        routeKind: "virtual"
      };

      const { getAllByText } = render(<WorkingBubble displayName="TestWorker" runtimeState={runtimeState} />);
      expect(getAllByText("Execution Plan").length).toBeGreaterThan(0);
      expect(getAllByText("Working").length).toBeGreaterThan(0);
    });

    it("uses light-mode contrast tokens for the working state shell and labels", () => {
      const { container, getByText, queryAllByText } = render(<WorkingBubble displayName="TestWorker" runtimeState={null} />);
      const bubble = queryAllByText("TestWorker is preparing a reply")[0].parentElement?.parentElement;
      const footer = queryAllByText("Working")[0];

      expect(bubble).toHaveClass("bg-black/[0.03]", "dark:bg-white/5");
      expect(bubble).toHaveClass("border-black/[0.06]", "dark:border-white/10");
      expect(queryAllByText("TestWorker is preparing a reply")[0]).toHaveClass("text-slate-700", "dark:text-slate-300");
      expect(footer).toHaveClass("text-slate-500", "dark:text-slate-400");
      expect(container.textContent).toContain("Pending Reply");
    });
  });
});
