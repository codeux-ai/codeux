import type {
  ExecutionInvocationMessageRecord,
  ExecutionInvocationRecord,
} from "../types.js";

export type CinematicFeedbackInvocation = Pick<
  ExecutionInvocationRecord,
  | "agentPresetId"
  | "id"
  | "lastMessageAt"
  | "messageCount"
  | "startedAt"
  | "status"
  | "type"
  | "updatedAt"
>;

export interface CinematicInvocationTranscriptFeedback {
  message: string | null;
  toolCount: number;
}

const REPLY_INVOCATION_TYPES = new Set(["dashboard_reply", "worker_reply"]);
const PROSE_MESSAGE_KINDS = new Set(["assistant"]);
const TOOL_MESSAGE_KINDS = new Set(["tool_call", "tool_result"]);

const readMetadataString = (
  message: ExecutionInvocationMessageRecord,
  key: string,
): string | null => {
  const value = message.metadata?.[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

/**
 * Selects only current Project Manager reply work. Invocation-pane selection
 * and unrelated project activity deliberately have no bearing on this result.
 */
export const selectCinematicFeedbackInvocation = <T extends CinematicFeedbackInvocation>(
  invocations: readonly T[],
  projectManagerAgentPresetId: string | null | undefined,
): T | null => {
  if (!projectManagerAgentPresetId) return null;

  let selected: T | null = null;
  for (const invocation of invocations) {
    if (
      invocation.status !== "running"
      || invocation.agentPresetId !== projectManagerAgentPresetId
      || !REPLY_INVOCATION_TYPES.has(invocation.type)
    ) {
      continue;
    }

    if (
      !selected
      || invocation.startedAt > selected.startedAt
      || (invocation.startedAt === selected.startedAt && invocation.id > selected.id)
    ) {
      selected = invocation;
    }
  }

  return selected;
};

const isAssistantProseMessage = (
  message: ExecutionInvocationMessageRecord,
): boolean => {
  if (message.role !== "assistant" || !message.contentMarkdown.trim()) {
    return false;
  }

  const kind = readMetadataString(message, "kind");
  return kind === null || PROSE_MESSAGE_KINDS.has(kind);
};

/** Returns the latest safe assistant prose without exposing internal turns. */
export const selectLatestCinematicAssistantMessage = (
  messages: readonly ExecutionInvocationMessageRecord[],
): string | null => {
  let selected: ExecutionInvocationMessageRecord | null = null;

  for (const message of messages) {
    if (!isAssistantProseMessage(message)) continue;
    // The invocation API returns the persisted transcript in sequence order.
    selected = message;
  }

  return selected?.contentMarkdown.trim() || null;
};

/**
 * Counts logical tool activity from normalized turn metadata. Calls and their
 * paired results share one key; stable message ids cover providers without a
 * call id and keep repeated transcript refreshes idempotent.
 */
export const countUniqueCinematicToolCalls = (
  messages: readonly ExecutionInvocationMessageRecord[],
): number => {
  const toolKeys = new Set<string>();

  for (const message of messages) {
    const kind = readMetadataString(message, "kind");
    if (!kind || !TOOL_MESSAGE_KINDS.has(kind)) continue;

    const toolCallId = readMetadataString(message, "toolCallId");
    toolKeys.add(toolCallId ? `call:${toolCallId}` : `message:${message.id}`);
  }

  return toolKeys.size;
};

export const projectCinematicInvocationFeedback = (
  messages: readonly ExecutionInvocationMessageRecord[],
): CinematicInvocationTranscriptFeedback => ({
  message: selectLatestCinematicAssistantMessage(messages),
  toolCount: countUniqueCinematicToolCalls(messages),
});
