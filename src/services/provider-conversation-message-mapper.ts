import type { ParsedConversationTurn } from "../infrastructure/providers/cli/provider-usage.js";
import type { AppendExecutionInvocationMessageInput } from "../contracts/invocation-types.js";
import { sanitizeInvocationOutputText } from "./invocation-output-sanitizer.js";

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
  const sanitizedTurnText = sanitizeInvocationOutputText(turn.text || "");
  const base: Record<string, unknown> = { provider, model };
  if (turn.toolCallId) base.toolCallId = turn.toolCallId;

  switch (turn.kind) {
    case "user":
      return { role: "user", contentMarkdown: sanitizedTurnText, metadata: base };
    case "assistant":
      return { role: "assistant", contentMarkdown: sanitizedTurnText, metadata: base };
    case "reasoning":
      return { role: "assistant", contentMarkdown: sanitizedTurnText, metadata: { ...base, kind: "reasoning" } };
    case "tool_call":
      return {
        role: "tool",
        contentMarkdown: sanitizedTurnText,
        toolCallsJson: { arguments: turn.toolArguments ?? null, callId: turn.toolCallId ?? null },
        metadata: {
          ...base,
          kind: "tool_call",
          toolName: turn.toolName ?? null,
          toolStatus: turn.toolStatus ?? null,
          ...(turn.tokens ? { tokens: turn.tokens } : {}),
        },
      };
    case "tool_result":
      return {
        role: "tool",
        contentMarkdown: sanitizedTurnText,
        toolCallsJson: { output: turn.toolOutput ?? null },
        metadata: { ...base, kind: "tool_result", toolName: turn.toolName ?? null },
      };
  }
}
