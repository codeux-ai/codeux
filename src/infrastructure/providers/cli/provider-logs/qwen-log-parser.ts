import * as fs from "fs/promises";
import * as path from "path";
import type { ParsedConversationTurn } from "./provider-conversation-types.js";
import { extractJsonContainer, parseTimestampMs, parseUsageObject, toNumber } from "./usage-parse-utils.js";

export interface QwenUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function recordTimestampMs(record: unknown): number | null {
  return parseTimestampMs(asRecord(record)?.timestamp);
}

function isWithinInvocationWindow(record: unknown, sinceMs?: number): boolean {
  if (typeof sinceMs !== "number") {
    return true;
  }
  const timestampMs = recordTimestampMs(record);
  return timestampMs === null || timestampMs >= sinceMs;
}

function qwenResponsePayload(record: Record<string, unknown>): Record<string, unknown> | null {
  const response = asRecord(record.response);
  return asRecord(response?.body) ?? asRecord(response?.data) ?? response;
}

function qwenUsageObject(record: Record<string, unknown>): Record<string, unknown> | null {
  const response = asRecord(record.response);
  const responseBody = asRecord(response?.body) ?? asRecord(response?.data);
  return asRecord(response?.usage)
    ?? asRecord(responseBody?.usage)
    ?? asRecord(record.usage);
}

function qwenUsageDedupeKey(record: Record<string, unknown>): string | null {
  const response = asRecord(record.response);
  const responsePayload = qwenResponsePayload(record);
  const responseId = response?.id ?? responsePayload?.id ?? record.id;
  if (typeof responseId === "string" && responseId.trim()) {
    return `response:${responseId}`;
  }
  return null;
}

/**
 * Extracts token usage from a single qwen-code OpenAI log record. Each log file
 * is `{ timestamp, request, response, error, context, system }`, where the
 * provider-reported usage lives on the OpenAI `response.usage` object. Older
 * loggers (and our tests) place a bare `usage` at the top level, so we fall back
 * to that. Returns null when no usage object is present (e.g. error-only logs).
 *
 * Delegates to the shared `parseUsageObject` so cached/reasoning token
 * detection stays in sync with Codex — including the Anthropic-shaped
 * `cache_read_input_tokens` fallback, which matters here because qwen-code can
 * be configured with `qwenProtocol: "anthropic"` against an Anthropic-compatible
 * backend, whose usage payload won't carry OpenAI's `prompt_tokens_details`.
 */
export function extractQwenUsageRecord(record: unknown): QwenUsageTotals | null {
  const root = asRecord(record);
  if (!root) return null;
  const usage = qwenUsageObject(root);
  if (!usage) return null;

  const parsed = parseUsageObject(usage);
  return {
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    cachedInputTokens: parsed.cachedInputTokens,
    reasoningOutputTokens: parsed.reasoningOutputTokens,
  };
}

/** Sums usage across many qwen-code log records. Returns null when none report usage. */
export function sumQwenOpenAiUsage(records: unknown[], sinceMs?: number): QwenUsageTotals | null {
  const totals: QwenUsageTotals = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 };
  let found = false;
  const seenKeys = new Set<string>();
  for (const record of records) {
    if (!isWithinInvocationWindow(record, sinceMs)) {
      continue;
    }
    const root = asRecord(record);
    if (!root) {
      continue;
    }
    const dedupeKey = qwenUsageDedupeKey(root);
    if (dedupeKey && seenKeys.has(dedupeKey)) {
      continue;
    }
    const usage = extractQwenUsageRecord(record);
    if (usage) {
      if (dedupeKey) {
        seenKeys.add(dedupeKey);
      }
      totals.inputTokens += usage.inputTokens;
      totals.cachedInputTokens += usage.cachedInputTokens;
      totals.outputTokens += usage.outputTokens;
      totals.reasoningOutputTokens += usage.reasoningOutputTokens;
      found = true;
    }
  }
  return found ? totals : null;
}

/** Flattens an OpenAI `content` field (string or array of `{type:"text", text}` parts) to plain text. */
function flattenOpenAiContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  const rec = asRecord(content);
  if (rec && !Array.isArray(content)) {
    if (typeof rec.text === "string") {
      return rec.text.trim();
    }
    if (typeof rec.content === "string" || Array.isArray(rec.content)) {
      return flattenOpenAiContent(rec.content);
    }
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    const type = typeof rec?.type === "string" ? rec.type : null;
    if (rec && typeof rec.text === "string" && (type === null || type === "text" || type === "input_text" || type === "output_text")) {
      parts.push(rec.text);
    } else if (rec && typeof rec.input_text === "string") {
      parts.push(rec.input_text);
    } else if (rec && typeof rec.output_text === "string") {
      parts.push(rec.output_text);
    } else if (typeof item === "string") {
      parts.push(item);
    }
  }
  return parts.join("").trim();
}

/** Extracts the assistant response message from a single log record. */
function responseMessageFromRecord(record: unknown): Record<string, unknown> | null {
  const root = asRecord(record);
  if (!root) return null;
  const response = qwenResponsePayload(root);
  if (!response) return null;
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const firstChoice = asRecord(choices[0]);
  return asRecord(firstChoice?.message)
    ?? asRecord(firstChoice?.delta)
    ?? asRecord(response.message)
    ?? (typeof response.role === "string" && response.content !== undefined ? response : null);
}

/** Pulls the chain-of-thought text from a message's `reasoning_content`/`reasoning` field. */
function reasoningFromMessage(message: Record<string, unknown>): string {
  const reasoningContent = message.reasoning_content ?? message.reasoning ?? message.thinking ?? message.summary;
  if (typeof reasoningContent === "string") {
    return reasoningContent.trim();
  }
  const reasoningRecord = asRecord(reasoningContent);
  if (reasoningRecord && !Array.isArray(reasoningContent)) {
    for (const key of ["text", "summary_text", "summary", "reasoning", "thinking", "content"]) {
      const text = flattenOpenAiContent(reasoningRecord[key]);
      if (text) {
        return text;
      }
    }
    return "";
  }
  if (!Array.isArray(reasoningContent)) {
    if (!Array.isArray(message.content)) return "";
    return message.content
      .map(asRecord)
      .filter((block): block is Record<string, unknown> => block?.type === "thinking" || block?.type === "reasoning")
      .map((block) => flattenOpenAiContent(block.thinking ?? block.reasoning ?? block.text ?? block.content))
      .filter(Boolean)
      .join("")
      .trim();
  }
  const parts: string[] = [];
  for (const item of reasoningContent) {
    const rec = asRecord(item);
    if (!rec) {
      if (typeof item === "string") {
        parts.push(item);
      }
      continue;
    }
    if (typeof rec.text === "string") {
      parts.push(rec.text);
    } else if (typeof rec.summary_text === "string") {
      parts.push(rec.summary_text);
    } else if (typeof rec.summary === "string") {
      parts.push(rec.summary);
    } else if (typeof rec.reasoning === "string") {
      parts.push(rec.reasoning);
    } else if (typeof rec.thinking === "string") {
      parts.push(rec.thinking);
    }
  }
  return parts.join("").trim();
}

function stringifyToolArguments(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Reads the id of an OpenAI tool-call entry. */
function toolCallId(call: unknown): string | undefined {
  const id = asRecord(call)?.id;
  return typeof id === "string" ? id : undefined;
}

function openAiToolCalls(message: Record<string, unknown>): Record<string, unknown>[] {
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const records = calls.map(asRecord).filter((call): call is Record<string, unknown> => Boolean(call));
  const functionCall = asRecord(message.function_call);
  if (functionCall) {
    records.push({ type: "function", function: functionCall });
  }
  const toolCall = asRecord(message.tool_call);
  if (toolCall) {
    records.push(toolCall);
  }
  if (Array.isArray(message.content)) {
    for (const item of message.content) {
      const block = asRecord(item);
      if (block?.type === "tool_use") {
        records.push(block);
      }
    }
  }
  return records;
}

function requestMessagesFromRecord(record: Record<string, unknown>): unknown[] {
  const request = asRecord(record.request);
  const requestBody = asRecord(request?.body) ?? asRecord(request?.data);
  const sources = [
    request?.messages,
    requestBody?.messages,
    request?.history,
    requestBody?.history,
    record.history,
    record.requestHistory,
  ];
  for (const source of sources) {
    if (Array.isArray(source)) {
      return source;
    }
  }
  return [];
}

function tokensFromUsage(usage: Record<string, unknown> | null): ParsedConversationTurn["tokens"] | undefined {
  if (!usage) {
    return undefined;
  }
  const parsed = parseUsageObject(usage);
  const total = toNumber(usage.total_tokens ?? usage.totalTokens ?? usage.total);
  return {
    input: parsed.inputTokens,
    cached: parsed.cachedInputTokens,
    output: parsed.outputTokens,
    reasoning: parsed.reasoningOutputTokens,
    ...(total > 0 ? { total } : {}),
  };
}

/**
 * qwen-code's CLI harness prepends its own ephemeral `<system-reminder>` blocks
 * (the deferred tool-search registry, available skills, etc.) directly into the
 * user message before sending it to the model — they arrive merged with our
 * prompt inside a single OpenAI `user` message, not as a separate `system`
 * message. Split the leading run of those blocks off so the transcript records
 * the harness-injected context separately from the prompt Code UX authored.
 */
function splitLeadingSystemReminders(text: string): { injected: string; prompt: string } {
  const match = text.match(/^(?:\s*<system-reminder>[\s\S]*?<\/system-reminder>\s*)+/);
  if (!match) {
    return { injected: "", prompt: text };
  }
  return { injected: match[0].trim(), prompt: text.slice(match[0].length).trim() };
}

/**
 * Maps a single OpenAI chat message to zero or more conversation turns.
 *
 * `reasoningByCallId` lets us recover the per-step chain-of-thought: the API
 * strips `reasoning_content` from history messages when it resends them, but
 * each call's own response still carries it, keyed here by the tool-call ids
 * that step produced. We prepend a reasoning turn before the matching step.
 */
export function turnsFromOpenAiMessage(
  message: Record<string, unknown>,
  tokens?: ParsedConversationTurn["tokens"],
  reasoningByCallId?: Map<string, string>,
  tokensByCallId?: Map<string, ParsedConversationTurn["tokens"]>,
): ParsedConversationTurn[] {
  const role = typeof message.role === "string" ? message.role : "";
  const turns: ParsedConversationTurn[] = [];

  const pushUserText = (text: string): void => {
    const { injected, prompt } = splitLeadingSystemReminders(text);
    if (injected) turns.push({ kind: "injected_context", text: injected });
    if (prompt) turns.push({ kind: "user", text: prompt });
  };

  if (role === "user") {
    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        const block = asRecord(item);
        if (block?.type === "tool_result") {
          turns.push({
            kind: "tool_result",
            text: "",
            toolCallId: typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
            toolOutput: flattenOpenAiContent(block.content),
            toolStatus: block.is_error === true ? "error" : "success",
          });
        } else {
          const blockText = flattenOpenAiContent(item);
          if (blockText) pushUserText(blockText);
        }
      }
    } else {
      const text = flattenOpenAiContent(message.content);
      if (text) pushUserText(text);
    }
    return turns;
  }
  if (role === "tool" || role === "function") {
    const text = flattenOpenAiContent(message.content);
    turns.push({
      kind: "tool_result",
      text: "",
      toolCallId: typeof message.tool_call_id === "string" ? message.tool_call_id : undefined,
      toolName: typeof message.name === "string" ? message.name : undefined,
      toolOutput: text,
    });
    return turns;
  }
  if (role === "assistant") {
    const toolCalls = openAiToolCalls(message);
    // Thinking models (qwen3-thinking, deepseek-reasoner, …) carry their
    // chain-of-thought in a separate `reasoning_content` / `reasoning` field
    // rather than in `content`. Surface it as a reasoning turn so the
    // transcript shows the model's deliberation, not just the final text.
    let reasoning = reasoningFromMessage(message);
    if (!reasoning && reasoningByCallId) {
      const firstId = toolCalls.map(toolCallId).find((id): id is string => Boolean(id));
      if (firstId) reasoning = reasoningByCallId.get(firstId) ?? "";
    }
    let turnTokens = tokens;
    if (!turnTokens && tokensByCallId) {
      const firstId = toolCalls.map(toolCallId).find((id): id is string => Boolean(id));
      if (firstId) turnTokens = tokensByCallId.get(firstId);
    }
    const contentHasStructuredBlocks = Array.isArray(message.content) && message.content.some((item) => {
      const type = asRecord(item)?.type;
      return type === "thinking" || type === "reasoning" || type === "redacted_thinking" || type === "tool_use";
    });
    let tokensAttached = false;

    if (reasoning && !contentHasStructuredBlocks) {
      turns.push({ kind: "reasoning", text: reasoning });
    }
    if (contentHasStructuredBlocks && Array.isArray(message.content)) {
      for (const item of message.content) {
        const block = asRecord(item);
        if (!block) continue;
        if (block.type === "thinking" || block.type === "reasoning") {
          const blockReasoning = flattenOpenAiContent(block.thinking ?? block.reasoning ?? block.text ?? block.content);
          if (blockReasoning) turns.push({ kind: "reasoning", text: blockReasoning });
        } else if (block.type === "text" || block.type === "output_text") {
          const blockText = flattenOpenAiContent(block);
          if (blockText) {
            turns.push({ kind: "assistant", text: blockText, tokens: tokensAttached ? undefined : turnTokens });
            tokensAttached = true;
          }
        } else if (block.type === "tool_use") {
          turns.push({
            kind: "tool_call",
            text: "",
            toolName: typeof block.name === "string" ? block.name : undefined,
            toolCallId: typeof block.id === "string" ? block.id : undefined,
            toolArguments: stringifyToolArguments(block.input),
            tokens: tokensAttached ? undefined : turnTokens,
          });
          tokensAttached = true;
        }
        // Redacted/opaque thinking blocks are deliberately not readable turns.
      }
    } else {
      const text = flattenOpenAiContent(message.content);
      if (text) {
        turns.push({ kind: "assistant", text, tokens: turnTokens });
        tokensAttached = true;
      }
    }
    for (const call of toolCalls.filter((candidate) => asRecord(candidate)?.type !== "tool_use")) {
      const callRec = asRecord(call);
      const fn = asRecord(callRec?.function);
      const callId = typeof callRec?.id === "string" ? callRec.id : undefined;
      turns.push({
        kind: "tool_call",
        text: "",
        toolName: typeof fn?.name === "string"
          ? fn.name
          : (typeof callRec?.name === "string" ? callRec.name : undefined),
        toolCallId: callId,
        toolArguments: stringifyToolArguments(fn?.arguments ?? callRec?.arguments),
        tokens: tokensAttached
          ? undefined
          : (callId && tokensByCallId ? tokensByCallId.get(callId) : turnTokens),
      });
      tokensAttached = true;
    }
    return turns;
  }
  // Skip system / developer scaffolding.
  return turns;
}

function conversationTurnSignature(turn: ParsedConversationTurn): string {
  return JSON.stringify({
    kind: turn.kind,
    text: turn.text,
    toolName: turn.toolName,
    toolCallId: turn.toolCallId,
    toolArguments: turn.toolArguments,
    toolOutput: turn.toolOutput,
    toolStatus: turn.toolStatus,
  });
}

function commonConversationPrefix(
  existing: ParsedConversationTurn[],
  candidate: ParsedConversationTurn[],
): number {
  const limit = Math.min(existing.length, candidate.length);
  let index = 0;
  while (index < limit && conversationTurnSignature(existing[index]) === conversationTurnSignature(candidate[index])) {
    index += 1;
  }
  return index;
}

function containsTurnSequence(
  conversation: ParsedConversationTurn[],
  candidate: ParsedConversationTurn[],
): boolean {
  if (candidate.length === 0 || candidate.length > conversation.length) return false;
  for (let start = 0; start <= conversation.length - candidate.length; start += 1) {
    if (candidate.every((turn, index) => (
      conversationTurnSignature(turn) === conversationTurnSignature(conversation[start + index])
    ))) {
      return true;
    }
  }
  return false;
}

/** Builds an ordered conversation across cumulative or per-call Qwen logs. */
export function buildQwenConversation(records: unknown[], sinceMs?: number): ParsedConversationTurn[] {
  const eligible = records.filter((record) => isWithinInvocationWindow(record, sinceMs));
  const sorted = eligible.every((record) => recordTimestampMs(record) !== null)
    ? [...eligible].sort((a, b) => recordTimestampMs(a)! - recordTimestampMs(b)!)
    : eligible;
  if (sorted.length === 0) {
    return [];
  }

  // Recover per-step reasoning that history messages no longer carry: every
  // record's own response keeps its `reasoning_content`, keyed by the tool-call
  // ids that step emitted, so we can re-attach it during reconstruction.
  const reasoningByCallId = new Map<string, string>();
  const tokensByCallId = new Map<string, ParsedConversationTurn["tokens"]>();
  const lastResponseIndexById = new Map<string, number>();
  for (const record of sorted) {
    const responseMsg = responseMessageFromRecord(record);
    if (!responseMsg) continue;
    const reasoning = reasoningFromMessage(responseMsg);
    const usage = qwenUsageObject(asRecord(record) ?? {});
    const tokens = tokensFromUsage(usage);
    const calls = openAiToolCalls(responseMsg);
    for (const call of calls) {
      const id = toolCallId(call);
      if (!id) continue;
      if (reasoning) reasoningByCallId.set(id, reasoning);
      if (tokens) tokensByCallId.set(id, tokens);
    }
  }
  sorted.forEach((record, index) => {
    const root = asRecord(record);
    if (!root) return;
    const key = qwenUsageDedupeKey(root);
    if (key) lastResponseIndexById.set(key, index);
  });

  const conversation: ParsedConversationTurn[] = [];
  const messageLists = sorted.map((record) => requestMessagesFromRecord(asRecord(record) ?? {}));
  const richestHistoryIndex = messageLists.reduce((richest, messages, index) => (
    messages.length >= messageLists[richest].length ? index : richest
  ), 0);
  const hasCumulativeHistory = messageLists[richestHistoryIndex].length > 1;

  if (hasCumulativeHistory) {
    const root = asRecord(sorted[richestHistoryIndex]) ?? {};
    const timestampMs = recordTimestampMs(root);
    for (const message of messageLists[richestHistoryIndex]) {
      const rec = asRecord(message);
      if (!rec) continue;
      conversation.push(...turnsFromOpenAiMessage(rec, undefined, reasoningByCallId, tokensByCallId)
        .map((turn) => ({ ...turn, timestampMs: turn.timestampMs ?? timestampMs })));
    }
  }

  sorted.forEach((record, recordIndex) => {
    const root = asRecord(record);
    if (!root) return;
    const timestampMs = recordTimestampMs(root);
    if (!hasCumulativeHistory) {
      const historyTurns: ParsedConversationTurn[] = [];
      for (const message of messageLists[recordIndex]) {
        const rec = asRecord(message);
        if (rec) {
          historyTurns.push(...turnsFromOpenAiMessage(rec, undefined, reasoningByCallId, tokensByCallId));
        }
      }
      const commonPrefix = commonConversationPrefix(conversation, historyTurns);
      const historyToAppend = commonPrefix > 0 ? historyTurns.slice(commonPrefix) : historyTurns;
      conversation.push(...historyToAppend.map((turn) => ({ ...turn, timestampMs: turn.timestampMs ?? timestampMs })));
    }

    const responseKey = qwenUsageDedupeKey(root);
    if (responseKey && lastResponseIndexById.get(responseKey) !== recordIndex) return;
    const responseMessage = responseMessageFromRecord(root);
    if (!responseMessage) return;
    const responseTurns = turnsFromOpenAiMessage(responseMessage, tokensFromUsage(qwenUsageObject(root)))
      .map((turn) => ({ ...turn, timestampMs: turn.timestampMs ?? timestampMs }));
    if (!containsTurnSequence(conversation, responseTurns)) {
      conversation.push(...responseTurns);
    }
  });

  return conversation;
}

/**
 * Reads qwen-code OpenAI log files from a host-visible directory, returning the
 * parsed records. Only files modified at/after the invocation start are kept so
 * stale logs from earlier runs sharing the directory are ignored.
 */
export async function readQwenOpenAiLogRecords(
  logDir: string,
  startTimeMs: number,
): Promise<unknown[]> {
  try {
    const files = await fs.readdir(logDir);
    const jsonFiles = files.filter(f => f.endsWith(".json"));
    if (jsonFiles.length === 0) return [];

    const candidates = (await Promise.all(jsonFiles.map(async (file) => {
      const filePath = path.join(logDir, file);
      const stat = await fs.stat(filePath).catch(() => null);
      return stat && stat.mtimeMs >= startTimeMs - 2000
        ? { file, filePath, mtimeMs: stat.mtimeMs }
        : null;
    })))
      .filter((candidate): candidate is { file: string; filePath: string; mtimeMs: number } => Boolean(candidate))
      .sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));

    const records: unknown[] = [];
    for (const candidate of candidates) {
      const content = await fs.readFile(candidate.filePath, "utf8").catch(() => "");
      const parsed = extractJsonContainer<Record<string, unknown>>(content, "object");
      if (parsed.ok) {
        records.push(parsed.value);
      }
    }
    return records;
  } catch {
    return [];
  }
}

/** Aggregates usage from qwen-code OpenAI logs in a host-visible directory. */
export async function parseQwenOpenAiLogs(
  logDir: string,
  startTimeMs: number,
): Promise<QwenUsageTotals | null> {
  const records = await readQwenOpenAiLogRecords(logDir, startTimeMs);
  return records.length > 0 ? sumQwenOpenAiUsage(records, startTimeMs) : null;
}
