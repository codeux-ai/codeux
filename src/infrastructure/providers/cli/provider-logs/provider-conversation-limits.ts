import {
  MAX_MESSAGE_CONTENT_CHARS,
  MAX_TOOL_PAYLOAD_CHARS,
  truncateForStorage,
} from "../../../../services/invocation-message-limits.js";
import type { ParsedConversationTurn } from "./provider-conversation-types.js";

export const MAX_RETAINED_PROVIDER_TURNS = 2_048;

export function boundProviderConversationTurn(
  turn: ParsedConversationTurn,
): ParsedConversationTurn {
  return {
    ...turn,
    text: truncateForStorage(turn.text, MAX_MESSAGE_CONTENT_CHARS),
    ...(turn.toolArguments !== undefined
      ? { toolArguments: truncateForStorage(turn.toolArguments, MAX_TOOL_PAYLOAD_CHARS) }
      : {}),
    ...(turn.toolOutput !== undefined
      ? { toolOutput: truncateForStorage(turn.toolOutput, MAX_TOOL_PAYLOAD_CHARS) }
      : {}),
  };
}

export function retainProviderConversationTail(
  turns: ParsedConversationTurn[],
  maxTurns = MAX_RETAINED_PROVIDER_TURNS,
): ParsedConversationTurn[] {
  const bounded = turns.map(boundProviderConversationTurn);
  if (bounded.length <= maxTurns) return bounded;
  const firstUser = bounded[0]?.kind === "user" ? bounded[0] : null;
  const tailCount = Math.max(0, maxTurns - (firstUser ? 1 : 0));
  return firstUser
    ? [firstUser, ...bounded.slice(-tailCount)]
    : bounded.slice(-maxTurns);
}

export function appendBoundedProviderTurns(
  target: ParsedConversationTurn[],
  turns: ParsedConversationTurn[],
  maxTurns = MAX_RETAINED_PROVIDER_TURNS,
): void {
  for (const turn of turns) {
    target.push(boundProviderConversationTurn(turn));
    if (target.length <= maxTurns) continue;
    if (target[0]?.kind === "user" && maxTurns > 1) {
      target.splice(1, target.length - maxTurns);
    } else {
      target.splice(0, target.length - maxTurns);
    }
  }
}
