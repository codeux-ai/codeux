/**
 * Shared conversation model produced by the per-provider log parsers.
 * Each provider writes its own JSON log format; the parsers normalise those
 * into an ordered list of turns so the dashboard can render the full agent
 * session with rich, per-type UI.
 */

export type ParsedTurnKind = "user" | "assistant" | "reasoning" | "tool_call" | "tool_result" | "injected_context";

export interface ParsedTurnTokens {
  input?: number;
  cached?: number;
  output?: number;
  reasoning?: number;
  total?: number;
}

export interface ParsedConversationTurn {
  kind: ParsedTurnKind;
  /** Human-readable content for the turn (assistant text, reasoning summary,
   *  or a one-line tool summary). May be empty for tool turns that carry their
   *  payload in toolArguments/toolOutput. */
  text: string;
  /** Tool name for tool_call / tool_result turns (e.g. "exec_command", "apply_patch"). */
  toolName?: string;
  /** Correlates a tool_call with its matching tool_result. */
  toolCallId?: string;
  /** Raw arguments / command / patch for a tool_call. */
  toolArguments?: string;
  /** Raw output text for a tool_result. */
  toolOutput?: string;
  /** Provider-reported tool status (e.g. "completed", "failed"). */
  toolStatus?: string;
  /** Per-turn token usage when the provider reports it. */
  tokens?: ParsedTurnTokens;
  /** Event timestamp in ms; used to isolate the current run's turns from a
   *  resumed session's accumulated history. */
  timestampMs?: number | null;
}

export interface ParsedProviderLogResult<TUsage> {
  /** Provider usage counts when the log exposes them; null when unavailable. */
  usage: TUsage | null;
  /** Provider-native usage payload for raw telemetry storage; null when unavailable. */
  rawUsageJson: Record<string, unknown> | null;
  /** Ordered provider conversation turns; empty when no turns are available. */
  conversation: ParsedConversationTurn[];
  nativeSessionId: string | null;
}
