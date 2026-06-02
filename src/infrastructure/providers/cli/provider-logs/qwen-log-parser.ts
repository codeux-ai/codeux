import * as fs from "fs/promises";
import * as path from "path";
import type { ParsedConversationTurn } from "./provider-conversation-types.js";
import { parseUsageObject, toNumber } from "./usage-parse-utils.js";

export interface QwenUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

/**
 * Extracts token usage from a single qwen-code OpenAI log record. Each log file
 * is `{ timestamp, request, response, error, context, system }`, where the
 * provider-reported usage lives on the OpenAI `response.usage` object. Older
 * loggers (and our tests) place a bare `usage` at the top level, so we fall back
 * to that. Returns null when no usage object is present (e.g. error-only logs).
 */
export function extractQwenUsageRecord(record: unknown): QwenUsageTotals | null {
  const root = asRecord(record);
  if (!root) return null;
  const response = asRecord(root.response);
  const usage = asRecord(response?.usage) ?? asRecord(root.usage);
  if (!usage) return null;

  const cachedDetails = asRecord(usage.prompt_tokens_details);

  return {
    inputTokens: toNumber(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    outputTokens: toNumber(usage.completion_tokens ?? usage.output_tokens ?? 0),
    cachedInputTokens: toNumber(cachedDetails?.cached_tokens ?? usage.cached_tokens ?? 0),
  };
}

/** Sums usage across many qwen-code log records. Returns null when none report usage. */
export function sumQwenOpenAiUsage(records: unknown[]): QwenUsageTotals | null {
  const totals: QwenUsageTotals = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  let found = false;
  for (const record of records) {
    const usage = extractQwenUsageRecord(record);
    if (usage) {
      totals.inputTokens += usage.inputTokens;
      totals.cachedInputTokens += usage.cachedInputTokens;
      totals.outputTokens += usage.outputTokens;
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
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (rec && typeof rec.text === "string") {
      parts.push(rec.text);
    } else if (typeof item === "string") {
      parts.push(item);
    }
  }
  return parts.join("").trim();
}

/** Extracts the assistant response message from a single log record. */
function responseMessageFromRecord(record: unknown): Record<string, unknown> | null {
  const root = asRecord(record);
  const response = asRecord(root?.response);
  if (!response) return null;
  const choices = Array.isArray(response.choices) ? response.choices : [];
  return asRecord(asRecord(choices[0])?.message) ?? asRecord(response.message);
}

/** Pulls the chain-of-thought text from a message's `reasoning_content`/`reasoning` field. */
function reasoningFromMessage(message: Record<string, unknown>): string {
  return flattenOpenAiContent(message.reasoning_content ?? message.reasoning);
}

/** Reads the id of an OpenAI tool-call entry. */
function toolCallId(call: unknown): string | undefined {
  const id = asRecord(call)?.id;
  return typeof id === "string" ? id : undefined;
}

/**
 * Maps a single OpenAI chat message to zero or more conversation turns.
 *
 * `reasoningByCallId` lets us recover the per-step chain-of-thought: the API
 * strips `reasoning_content` from history messages when it resends them, but
 * each call's own response still carries it, keyed here by the tool-call ids
 * that step produced. We prepend a reasoning turn before the matching step.
 */
function turnsFromOpenAiMessage(
  message: Record<string, unknown>,
  tokens?: ParsedConversationTurn["tokens"],
  reasoningByCallId?: Map<string, string>,
): ParsedConversationTurn[] {
  const role = typeof message.role === "string" ? message.role : "";
  const text = flattenOpenAiContent(message.content);
  const turns: ParsedConversationTurn[] = [];

  if (role === "user") {
    if (text) turns.push({ kind: "user", text });
    return turns;
  }
  if (role === "tool") {
    turns.push({
      kind: "tool_result",
      text: "",
      toolCallId: typeof message.tool_call_id === "string" ? message.tool_call_id : undefined,
      toolOutput: text,
    });
    return turns;
  }
  if (role === "assistant") {
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    // Thinking models (qwen3-thinking, deepseek-reasoner, …) carry their
    // chain-of-thought in a separate `reasoning_content` / `reasoning` field
    // rather than in `content`. Surface it as a reasoning turn so the
    // transcript shows the model's deliberation, not just the final text.
    let reasoning = reasoningFromMessage(message);
    if (!reasoning && reasoningByCallId) {
      const firstId = toolCalls.map(toolCallId).find((id): id is string => Boolean(id));
      if (firstId) reasoning = reasoningByCallId.get(firstId) ?? "";
    }
    if (reasoning) {
      turns.push({ kind: "reasoning", text: reasoning });
    }
    if (text) {
      turns.push({ kind: "assistant", text, tokens });
    }
    for (const call of toolCalls) {
      const callRec = asRecord(call);
      const fn = asRecord(callRec?.function);
      turns.push({
        kind: "tool_call",
        text: "",
        toolName: typeof fn?.name === "string" ? fn.name : undefined,
        toolCallId: typeof callRec?.id === "string" ? callRec.id : undefined,
        toolArguments: typeof fn?.arguments === "string" ? fn.arguments : undefined,
      });
    }
    // Attach turn tokens to the tool_call when there was no assistant text.
    if (!text && turns.length > 0 && tokens) {
      turns[turns.length - 1].tokens = tokens;
    }
    return turns;
  }
  // Skip system / developer scaffolding.
  return turns;
}

/**
 * Builds the conversation from qwen-code OpenAI request/response logs. The
 * newest record's `request.messages` carries the full prior history
 * (system/user/assistant/tool), and its `response` holds the final assistant
 * turn that is not yet present in any request. We therefore take the newest
 * record's request history and append its response message.
 */
export function buildQwenConversation(records: unknown[]): ParsedConversationTurn[] {
  const sorted = [...records].sort((a, b) => {
    const ta = typeof asRecord(a)?.timestamp === "string" ? Date.parse(asRecord(a)!.timestamp as string) : 0;
    const tb = typeof asRecord(b)?.timestamp === "string" ? Date.parse(asRecord(b)!.timestamp as string) : 0;
    return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
  });
  const newest = asRecord(sorted[sorted.length - 1]);
  if (!newest) {
    return [];
  }

  // Recover per-step reasoning that history messages no longer carry: every
  // record's own response keeps its `reasoning_content`, keyed by the tool-call
  // ids that step emitted, so we can re-attach it during reconstruction.
  const reasoningByCallId = new Map<string, string>();
  for (const record of sorted) {
    const responseMsg = responseMessageFromRecord(record);
    if (!responseMsg) continue;
    const reasoning = reasoningFromMessage(responseMsg);
    if (!reasoning) continue;
    const calls = Array.isArray(responseMsg.tool_calls) ? responseMsg.tool_calls : [];
    for (const call of calls) {
      const id = toolCallId(call);
      if (id) reasoningByCallId.set(id, reasoning);
    }
  }

  const conversation: ParsedConversationTurn[] = [];
  const request = asRecord(newest.request);
  const messages = Array.isArray(request?.messages) ? request!.messages : [];
  for (const message of messages) {
    const rec = asRecord(message);
    if (rec) {
      conversation.push(...turnsFromOpenAiMessage(rec, undefined, reasoningByCallId));
    }
  }

  const response = asRecord(newest.response);
  const usage = asRecord(response?.usage);
  const tokens = usage
    ? (() => {
        const parsed = parseUsageObject(usage);
        return {
          input: parsed.inputTokens,
          cached: parsed.cachedInputTokens,
          output: parsed.outputTokens,
          reasoning: parsed.reasoningOutputTokens,
        };
      })()
    : undefined;
  const choices = Array.isArray(response?.choices) ? response!.choices : [];
  const responseMessage = asRecord(asRecord(choices[0])?.message) ?? asRecord(response?.message);
  if (responseMessage) {
    conversation.push(...turnsFromOpenAiMessage(responseMessage, tokens));
  }

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

    const records: unknown[] = [];
    for (const file of jsonFiles) {
      const filePath = path.join(logDir, file);
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat && stat.mtimeMs >= startTimeMs - 2000) {
        const content = await fs.readFile(filePath, "utf8").catch(() => "");
        try {
          records.push(JSON.parse(content));
        } catch {
          // ignore unparseable log files
        }
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
  return records.length > 0 ? sumQwenOpenAiUsage(records) : null;
}
