/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { ChatMessageBubble } from "../../../dashboard/src/v2/components/chat/ChatMessageBubble.js";
import { InvocationMessageBubble } from "../../../dashboard/src/v2/components/chat/InvocationMessageBubble.js";
import { InvocationListCard } from "../../../dashboard/src/v2/components/chat/InvocationListCard.js";
import { ThreadListCard } from "../../../dashboard/src/v2/components/chat/ThreadListCard.js";
import { WorkingBubble } from "../../../dashboard/src/v2/components/chat/WorkingBubble.js";
import type { ChatMessageRecord, ExecutionInvocationMessageRecord, ConversationRuntimeState, ExecutionInvocationRecord, ChatThread } from "../../../dashboard/src/v2/types.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/lib/markdown.js", () => ({
  renderMarkdown: (md: string) => `<p>${md}</p>`
}));

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

    it("resolves dashboard message initially showing Queued to Processed when a later agent reply is present", () => {
      const dashboardMessage: ChatMessageRecord = {
        id: "msg_dash_1",
        threadId: "thread_1",
        direction: "dashboard_to_connection",
        authorType: "dashboard_user",
        authorConnectionId: null,
        bodyMarkdown: "Hello worker",
        deliveryStatus: "pending",
        createdAt: "2026-03-10T12:00:00.000Z",
        metadata: null,
      };

      // Initially renders as Queued when no siblings
      const { container: container1 } = render(<ChatMessageBubble message={dashboardMessage} />);
      expect(container1.textContent).toContain("Queued");

      const agentReply: ChatMessageRecord = {
        id: "msg_agent_1",
        threadId: "thread_1",
        direction: "connection_to_dashboard",
        authorType: "connection",
        authorConnectionId: "conn_1",
        bodyMarkdown: "I am working on it",
        deliveryStatus: "delivered",
        createdAt: "2026-03-10T12:00:05.000Z",
        metadata: null,
      };

      // With later reply sibling, resolves to Processed
      const { container: container2 } = render(
        <ChatMessageBubble message={dashboardMessage} allMessages={[dashboardMessage, agentReply]} />
      );
      expect(container2.textContent).toContain("Processed");
    });

    it("preserves Failed state even if a later agent reply is present", () => {
      const dashboardMessage: ChatMessageRecord = {
        id: "msg_dash_1",
        threadId: "thread_1",
        direction: "dashboard_to_connection",
        authorType: "dashboard_user",
        authorConnectionId: null,
        bodyMarkdown: "Hello worker",
        deliveryStatus: "failed",
        createdAt: "2026-03-10T12:00:00.000Z",
        metadata: null,
      };

      const agentReply: ChatMessageRecord = {
        id: "msg_agent_1",
        threadId: "thread_1",
        direction: "connection_to_dashboard",
        authorType: "connection",
        authorConnectionId: "conn_1",
        bodyMarkdown: "I am working on it",
        deliveryStatus: "delivered",
        createdAt: "2026-03-10T12:00:05.000Z",
        metadata: null,
      };

      const { container } = render(
        <ChatMessageBubble message={dashboardMessage} allMessages={[dashboardMessage, agentReply]} />
      );
      expect(container.textContent).toContain("Failed");
      expect(container.textContent).not.toContain("Processed");
    });

    it("does not mark messages in other threads as processed", () => {
      const dashboardMessage: ChatMessageRecord = {
        id: "msg_dash_1",
        threadId: "thread_1",
        direction: "dashboard_to_connection",
        authorType: "dashboard_user",
        authorConnectionId: null,
        bodyMarkdown: "Hello worker in thread 1",
        deliveryStatus: "pending",
        createdAt: "2026-03-10T12:00:00.000Z",
        metadata: null,
      };

      const agentReplyInOtherThread: ChatMessageRecord = {
        id: "msg_agent_1",
        threadId: "thread_2",
        direction: "connection_to_dashboard",
        authorType: "connection",
        authorConnectionId: "conn_1",
        bodyMarkdown: "Reply in thread 2",
        deliveryStatus: "delivered",
        createdAt: "2026-03-10T12:00:05.000Z",
        metadata: null,
      };

      const { container } = render(
        <ChatMessageBubble message={dashboardMessage} allMessages={[dashboardMessage, agentReplyInOtherThread]} />
      );
      expect(container.textContent).toContain("Queued");
      expect(container.textContent).not.toContain("Processed");
    });

    it("keeps timestamp comparison using toChatTimestampMs semantics (does not update to processed if reply is older)", () => {
      const dashboardMessage: ChatMessageRecord = {
        id: "msg_dash_1",
        threadId: "thread_1",
        direction: "dashboard_to_connection",
        authorType: "dashboard_user",
        authorConnectionId: null,
        bodyMarkdown: "New message",
        deliveryStatus: "delivered",
        createdAt: "2026-03-10T12:00:00.000Z",
        metadata: null,
      };

      const olderAgentReply: ChatMessageRecord = {
        id: "msg_agent_1",
        threadId: "thread_1",
        direction: "connection_to_dashboard",
        authorType: "connection",
        authorConnectionId: "conn_1",
        bodyMarkdown: "Old reply",
        deliveryStatus: "delivered",
        createdAt: "2026-03-10T11:59:59.000Z",
        metadata: null,
      };

      const { container } = render(
        <ChatMessageBubble message={dashboardMessage} allMessages={[dashboardMessage, olderAgentReply]} />
      );
      expect(container.textContent).toContain("Delivered");
      expect(container.textContent).not.toContain("Processed");
    });

    it("renders AgentAvatarSvg when an agent preset avatar config is supplied", () => {
      const message: ChatMessageRecord = {
        id: "msg_preset_avatar",
        threadId: "thread_1",
        direction: "connection_to_dashboard",
        authorType: "connection",
        authorConnectionId: "conn_1",
        bodyMarkdown: "Hello preset agent",
        deliveryStatus: "delivered",
        createdAt: new Date().toISOString(),
        metadata: null,
      };

      const avatarConfig = { chassis: 'classic', accent: 'jade', eyes: 'happy' } as any;
      const { container } = render(
        <ChatMessageBubble
          message={message}
          agentAvatarConfig={avatarConfig}
          agentName="MyAgent"
        />
      );

      const svg = container.querySelector('svg[data-testid="agent-avatar-svg"]');
      expect(svg).toBeInTheDocument();
      expect(container.innerHTML).toContain('data-cux-agent-name="MyAgent"');
      expect(container.textContent).toContain("MyAgent");
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

    it("renders AgentAvatarSvg when a linked preset avatar config is supplied for assistant", () => {
      const message: ExecutionInvocationMessageRecord = {
        id: "msg_inv_preset",
        invocationId: "inv_1",
        role: "assistant",
        contentMarkdown: "Assistant with preset avatar",
        toolCallsJson: null,
        createdAt: new Date().toISOString(),
      };

      const avatarConfig = { chassis: 'square', accent: 'amber', eyes: 'smile' } as any;
      const { container, getByText } = render(
        <InvocationMessageBubble
          message={message}
          agentAvatarConfig={avatarConfig}
          agentName="PresetAssistant"
        />
      );

      const svg = container.querySelector('svg[data-testid="agent-avatar-svg"]');
      expect(svg).toBeInTheDocument();

      expect(getByText("PresetAssistant")).toBeInTheDocument();
    });

    it("hides bootstrap branch unborn fatal lines while keeping other output", () => {
      const message: ExecutionInvocationMessageRecord = {
        id: "msg_bootstrap_noise",
        invocationId: "inv_1",
        role: "tool",
        contentMarkdown: [
          "fatal: your current branch 'code-ux-bootstrap-1' does not have any commits yet",
          "actual output line",
        ].join("\n"),
        toolCallsJson: {
          output: [
            "fatal: your current branch 'code-ux-bootstrap-1' does not have any commits yet",
            "tool result kept",
          ].join("\n"),
        },
        createdAt: new Date().toISOString(),
        metadata: {
          kind: "tool_result",
          toolName: "git",
          toolCallId: "call-1",
        },
      };

      const { container } = render(<InvocationMessageBubble message={message} />);
      expect(container.textContent).not.toContain("code-ux-bootstrap-1");
      expect(container.textContent).toContain("git");
    });

    it("keeps non-bootstrap unborn-branch fatal lines visible", () => {
      const line = "fatal: your current branch 'feature/my-branch' does not have any commits yet";
      const message: ExecutionInvocationMessageRecord = {
        id: "msg_non_bootstrap",
        invocationId: "inv_1",
        role: "assistant",
        contentMarkdown: line,
        toolCallsJson: null,
        createdAt: new Date().toISOString(),
      };

      const { container } = render(<InvocationMessageBubble message={message} />);
      expect(container.textContent).toContain(line);
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
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
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

    it("renders sprint key, task key, and token usage stats on cards when available", () => {
      const invocation: ExecutionInvocationRecord = {
        id: "inv-2",
        projectId: "project-1",
        sprintId: "sprint-uuid-12345",
        taskId: "task-uuid-67890",
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
        lastErrorCategory: null,
        lastErrorMessage: null,
        lastRetryAfterIso: null,
        messageCount: 0,
        lastMessageAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        inputTokens: 1200,
        cachedInputTokens: 300,
        outputTokens: 450,
        totalTokens: 1950,
        sprintNumber: 12,
        sprintName: "Smoke test",
        taskKey: "T05",
        taskTitle: "Create alpha.md",
      };

      const { container } = render(
        <InvocationListCard
          invocations={[invocation]}
          selectedInvocationId={null}
          onSelect={vi.fn()}
        />
      );

      // Sprint key (prefix + number) and task key chips, linked to their pages.
      expect(container.textContent).toContain("SPR-12");
      expect(container.textContent).toContain("T05");
      // Token usage now lives in the stat table as label/value pairs.
      expect(container.textContent).toContain("Input");
      expect(container.textContent).toContain("1,200");
      expect(container.textContent).toContain("Cached");
      expect(container.textContent).toContain("300");
      expect(container.textContent).toContain("Output");
      expect(container.textContent).toContain("450");
    });

    it("reserves border width in both selected and unselected states to prevent layout shift", () => {
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
        lastErrorCategory: null,
        lastErrorMessage: null,
        lastRetryAfterIso: null,
        messageCount: 0,
        lastMessageAt: new Date().toISOString(),
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Unselected
      const { container: containerUnselected, unmount: unmountUnselected } = render(
        <InvocationListCard
          invocations={[invocation]}
          selectedInvocationId={null}
          onSelect={vi.fn()}
        />
      );
      const buttonUnselected = containerUnselected.querySelector('[role="button"]');
      expect(buttonUnselected).not.toBeNull();
      const classesUnselected = buttonUnselected!.className.split(/\s+/);
      expect(classesUnselected).toContain("border-2");
      expect(classesUnselected).not.toContain("border");
      unmountUnselected();

      // Selected
      const { container: containerSelected } = render(
        <InvocationListCard
          invocations={[invocation]}
          selectedInvocationId="inv-1"
          onSelect={vi.fn()}
        />
      );
      const buttonSelected = containerSelected.querySelector('[role="button"]');
      expect(buttonSelected).not.toBeNull();
      const classesSelected = buttonSelected!.className.split(/\s+/);
      expect(classesSelected).toContain("border-2");
      expect(classesSelected).not.toContain("border");
    });
  });

  describe("WorkingBubble", () => {
    it("renders the default listener pulsing message when not planning", () => {
      const { getByText } = render(<WorkingBubble displayName="TestWorker" runtimeState={null} />);
      expect(getByText("TestWorker is preparing a reply")).toBeInTheDocument();
    });

    it("renders the starting phase label when phase is starting", () => {
      const { getByText } = render(<WorkingBubble displayName="TestWorker" runtimeState={null} phase="starting" />);
      expect(getByText("Starting")).toBeInTheDocument();
    });

    it("renders an animated planning widget when routeKind is virtual", () => {
      const runtimeState: ConversationRuntimeState = {
        routeKind: "virtual"
      };

      const { getAllByText } = render(<WorkingBubble displayName="TestWorker" runtimeState={runtimeState} />);
      expect(getAllByText("Execution Plan").length).toBeGreaterThan(0);
      expect(getAllByText("Working").length).toBeGreaterThan(0);
    });
  });

  describe("ThreadListCard", () => {
    it("reserves border width in both selected and unselected states to prevent layout shift", () => {
      const thread: ChatThread = {
        id: "thread-1",
        projectId: "project-1",
        title: "Test Thread",
        lastMessagePreview: "Hello",
        pendingMessageCount: 0,
        messageCount: 1,
        lastMessageAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        runtimeState: null,
      };

      // Unselected
      const { container: containerUnselected, unmount: unmountUnselected } = render(
        <ThreadListCard
          threads={[thread]}
          selectedThreadId={null}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          deletingThreadId={null}
        />
      );
      const buttonUnselected = containerUnselected.querySelector("button");
      expect(buttonUnselected).not.toBeNull();
      const classesUnselected = buttonUnselected!.className.split(/\s+/);
      expect(classesUnselected).toContain("border-2");
      expect(classesUnselected).not.toContain("border");
      unmountUnselected();

      // Selected
      const { container: containerSelected } = render(
        <ThreadListCard
          threads={[thread]}
          selectedThreadId="thread-1"
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          deletingThreadId={null}
        />
      );
      const buttonSelected = containerSelected.querySelector("button");
      expect(buttonSelected).not.toBeNull();
      const classesSelected = buttonSelected!.className.split(/\s+/);
      expect(classesSelected).toContain("border-2");
      expect(classesSelected).not.toContain("border");
    });
  });
});
