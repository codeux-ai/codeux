import { describe, it, expect } from "vitest";
import { conversationTurnToMessage } from "../../../src/services/provider-conversation-message-mapper.js";
import type { ParsedConversationTurn } from "../../../src/infrastructure/providers/cli/provider-usage.js";

describe("conversationTurnToMessage", () => {
  it("maps a user turn correctly", () => {
    const turn: ParsedConversationTurn = {
      kind: "user",
      text: "Hello world",
    };
    const result = conversationTurnToMessage(turn, "claude-code", "claude-3-5-sonnet-20241022");
    expect(result).toEqual({
      role: "user",
      contentMarkdown: "Hello world",
      metadata: { provider: "claude-code", model: "claude-3-5-sonnet-20241022" },
    });
  });

  it("maps an assistant turn correctly", () => {
    const turn: ParsedConversationTurn = {
      kind: "assistant",
      text: "I am here to help",
    };
    const result = conversationTurnToMessage(turn, "claude-code", "claude-3-5-sonnet-20241022");
    expect(result).toEqual({
      role: "assistant",
      contentMarkdown: "I am here to help",
      metadata: { provider: "claude-code", model: "claude-3-5-sonnet-20241022" },
    });
  });

  it("maps a reasoning turn correctly", () => {
    const turn: ParsedConversationTurn = {
      kind: "reasoning",
      text: "Let me think about this...",
    };
    const result = conversationTurnToMessage(turn, "qwen-code", "qwq-32b");
    expect(result).toEqual({
      role: "assistant",
      contentMarkdown: "Let me think about this...",
      metadata: { provider: "qwen-code", model: "qwq-32b", kind: "reasoning" },
    });
  });

  it("maps a tool_call turn correctly with tokens", () => {
    const turn: ParsedConversationTurn = {
      kind: "tool_call",
      text: "Using tool",
      toolCallId: "call_123",
      toolName: "fetch_data",
      toolArguments: '{"url":"https://example.com"}',
      toolStatus: "completed",
      tokens: { input: 10, output: 20 },
    };
    const result = conversationTurnToMessage(turn, "claude-code", "claude-3-5-sonnet-20241022");
    expect(result).toEqual({
      role: "tool",
      contentMarkdown: "Using tool",
      toolCallsJson: { arguments: '{"url":"https://example.com"}', callId: "call_123" },
      metadata: {
        provider: "claude-code",
        model: "claude-3-5-sonnet-20241022",
        toolCallId: "call_123",
        kind: "tool_call",
        toolName: "fetch_data",
        toolStatus: "completed",
        tokens: { input: 10, output: 20 },
      },
    });
  });

  it("maps a tool_result turn correctly", () => {
    const turn: ParsedConversationTurn = {
      kind: "tool_result",
      text: "Data fetched",
      toolCallId: "call_123",
      toolName: "fetch_data",
      toolOutput: "Success data",
    };
    const result = conversationTurnToMessage(turn, "claude-code", "claude-3-5-sonnet-20241022");
    expect(result).toEqual({
      role: "tool",
      contentMarkdown: "Data fetched",
      toolCallsJson: { output: "Success data" },
      metadata: {
        provider: "claude-code",
        model: "claude-3-5-sonnet-20241022",
        toolCallId: "call_123",
        kind: "tool_result",
        toolName: "fetch_data",
      },
    });
  });

  it("preserves sanitization behavior for fatal branch logs", () => {
    const turn: ParsedConversationTurn = {
      kind: "assistant",
      text: "Here is the output:\nfatal: your current branch 'code-ux-bootstrap-123' does not have any commits yet\nMore text",
    };
    const result = conversationTurnToMessage(turn, "claude-code", "claude-3-5-sonnet-20241022");
    expect(result).toEqual({
      role: "assistant",
      contentMarkdown: "Here is the output:\nMore text",
      metadata: { provider: "claude-code", model: "claude-3-5-sonnet-20241022" },
    });
  });
});
