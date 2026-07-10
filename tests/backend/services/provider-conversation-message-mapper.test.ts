import { describe, it, expect } from "vitest";
import { conversationTurnToMessage } from "../../../src/services/provider-conversation-message-mapper.js";
import type { ParsedConversationTurn } from "../../../src/infrastructure/providers/cli/provider-usage.js";
import { MAX_MESSAGE_CONTENT_CHARS, MAX_TOOL_PAYLOAD_CHARS } from "../../../src/services/invocation-message-limits.js";

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

  it("preserves long user turns verbatim", () => {
    const text = [
      "Prompt start",
      "fatal: your current branch 'code-ux-bootstrap-123' does not have any commits yet",
      "x".repeat(MAX_MESSAGE_CONTENT_CHARS + 100),
      "Prompt end",
    ].join("\n");
    const turn: ParsedConversationTurn = {
      kind: "user",
      text,
    };
    const result = conversationTurnToMessage(turn, "codex", "gpt-5.5");
    expect(result.role).toBe("user");
    expect(result.contentMarkdown).toBe(text);
    expect(result.contentMarkdown).toContain("fatal: your current branch");
    expect(result.contentMarkdown).not.toContain("characters truncated");
  });

  it("maps an injected_context turn to a system message", () => {
    const turn: ParsedConversationTurn = {
      kind: "injected_context",
      text: "<system-reminder>computer_use__click ...</system-reminder>",
    };
    const result = conversationTurnToMessage(turn, "qwen-code", "google/gemma");
    expect(result).toEqual({
      role: "system",
      contentMarkdown: "<system-reminder>computer_use__click ...</system-reminder>",
      metadata: { provider: "qwen-code", model: "google/gemma", kind: "injected_context" },
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

  it("keeps reasoning turns as assistant messages while preserving metadata and sanitizing/truncating content", () => {
    const turn: ParsedConversationTurn = {
      kind: "reasoning",
      text: [
        "Here is the output:",
        "fatal: your current branch 'code-ux-bootstrap-123' does not have any commits yet",
        "x".repeat(MAX_MESSAGE_CONTENT_CHARS + 100),
      ].join("\n"),
    };
    const result = conversationTurnToMessage(turn, "qwen-code", "qwq-32b");
    expect(result.role).toBe("assistant");
    expect(result.metadata).toEqual({
      provider: "qwen-code",
      model: "qwq-32b",
      kind: "reasoning",
    });
    expect(result.contentMarkdown).not.toContain("fatal: your current branch");
    expect(result.contentMarkdown).toContain("characters truncated");
    expect(result.contentMarkdown.length).toBeLessThanOrEqual(MAX_MESSAGE_CONTENT_CHARS);
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
        toolStatus: null,
      },
    });
  });

  it("preserves result status, timestamp, and tokens in metadata for live rewrite signatures", () => {
    const turn: ParsedConversationTurn = {
      kind: "tool_result",
      text: "Data fetched",
      toolCallId: "call_123",
      toolName: "fetch_data",
      toolOutput: "Success data",
      toolStatus: "failed",
      timestampMs: 123456,
      tokens: { input: 10, output: 2 },
    };
    const result = conversationTurnToMessage(turn, "opencode", "anthropic/claude-sonnet");
    expect(result.metadata).toEqual({
      provider: "opencode",
      model: "anthropic/claude-sonnet",
      toolCallId: "call_123",
      timestampMs: 123456,
      tokens: { input: 10, output: 2 },
      kind: "tool_result",
      toolName: "fetch_data",
      toolStatus: "failed",
    });
  });

  it("truncates tool arguments and tool output payloads while preserving provider metadata", () => {
    const toolArguments = `{"query":"${"a".repeat(MAX_TOOL_PAYLOAD_CHARS + 100)}"}`;
    const toolOutput = "b".repeat(MAX_TOOL_PAYLOAD_CHARS + 100);

    const callResult = conversationTurnToMessage(
      {
        kind: "tool_call",
        text: "Using tool",
        toolCallId: "call_123",
        toolName: "fetch_data",
        toolArguments,
        toolStatus: "completed",
      },
      "claude-code",
      "claude-3-5-sonnet-20241022",
    );
    expect(callResult.toolCallsJson).toEqual({
      arguments: expect.stringContaining("characters truncated"),
      callId: "call_123",
    });
    expect(callResult.metadata).toEqual(expect.objectContaining({
      provider: "claude-code",
      model: "claude-3-5-sonnet-20241022",
      kind: "tool_call",
      toolName: "fetch_data",
      toolStatus: "completed",
    }));

    const resultResult = conversationTurnToMessage(
      {
        kind: "tool_result",
        text: "Data fetched",
        toolCallId: "call_123",
        toolName: "fetch_data",
        toolOutput,
      },
      "claude-code",
      "claude-3-5-sonnet-20241022",
    );
    expect(resultResult.toolCallsJson).toEqual({
      output: expect.stringContaining("characters truncated"),
    });
    expect(resultResult.metadata).toEqual(expect.objectContaining({
      provider: "claude-code",
      model: "claude-3-5-sonnet-20241022",
      kind: "tool_result",
      toolName: "fetch_data",
    }));
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
