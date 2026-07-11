import type { ParsedConversationTurn } from "../infrastructure/providers/cli/provider-usage.js";
import type { AppendExecutionInvocationMessageInput } from "../contracts/invocation-types.js";
import { sanitizeInvocationOutputText } from "./invocation-output-sanitizer.js";
import {
  MAX_MESSAGE_CONTENT_CHARS,
  MAX_TOOL_PAYLOAD_CHARS,
  truncateForStorage,
} from "./invocation-message-limits.js";

/**
 * Maps a parsed provider conversation turn to an invocation message. Reasoning
 * and tool turns stay within the existing role union (assistant / tool) and are
 * distinguished by `metadata.kind`, which the dashboard uses to pick a rich
 * widget. No DB/schema change is required.
 */
export function conversationTurnToMessage(
  turn: ParsedConversationTurn,
  provider: string,
  model: string | null,
): AppendExecutionInvocationMessageInput {
  const base: Record<string, unknown> = { provider, model };
  if (turn.toolCallId) base.toolCallId = turn.toolCallId;
  if (turn.timestampMs != null) base.timestampMs = turn.timestampMs;
  if (turn.tokens) base.tokens = turn.tokens;

  if (turn.kind === "user") {
    return { role: "user", contentMarkdown: turn.text || "", metadata: base };
  }

  const sanitizedTurnText = truncateForStorage(
    sanitizeInvocationOutputText(turn.text || ""),
    MAX_MESSAGE_CONTENT_CHARS,
  );

  const capPayload = (value: string | null | undefined): string | null =>
    value == null ? null : truncateForStorage(value, MAX_TOOL_PAYLOAD_CHARS);

  switch (turn.kind) {
    case "injected_context":
      return { role: "system", contentMarkdown: sanitizedTurnText, metadata: { ...base, kind: "injected_context" } };
    case "assistant":
      return { role: "assistant", contentMarkdown: sanitizedTurnText, metadata: base };
    case "reasoning":
      return { role: "assistant", contentMarkdown: sanitizedTurnText, metadata: { ...base, kind: "reasoning" } };
    case "tool_call":
      return {
        role: "tool",
        contentMarkdown: sanitizedTurnText,
        toolCallsJson: { arguments: capPayload(turn.toolArguments), callId: turn.toolCallId ?? null },
        metadata: {
          ...base,
          kind: "tool_call",
          toolName: turn.toolName ?? null,
          toolStatus: turn.toolStatus ?? null,
        },
      };
    case "tool_result":
      return {
        role: "tool",
        contentMarkdown: sanitizedTurnText,
        toolCallsJson: { output: capPayload(turn.toolOutput) },
        metadata: {
          ...base,
          kind: "tool_result",
          toolName: turn.toolName ?? null,
          toolStatus: turn.toolStatus ?? null,
        },
      };
  }
}
