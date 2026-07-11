import type { ParsedConversationTurn, ParsedProviderLogResult } from "./provider-conversation-types.js";
import {
  extractJsonContainer,
  normalizeUsageCounts,
  parseJsonObject,
  parseTimestampMs,
  toNumber,
} from "./usage-parse-utils.js";

export interface GeminiUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface GeminiLogResult extends ParsedProviderLogResult<GeminiUsageTotals> {
  transcriptText: string;
}

function emptyGeminiLogResult(): GeminiLogResult {
  return {
    usage: null,
    rawUsageJson: null,
    nativeSessionId: null,
    transcriptText: "",
    conversation: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function timestampFrom(...records: Array<Record<string, unknown> | null>): number | null {
  for (const record of records) {
    if (!record) continue;
    const timestampMs = parseTimestampMs(firstDefined(
      record.timestampMs,
      record.timestamp_ms,
      record.timestamp,
      record.createdAt,
      record.created_at,
      record.time,
    ));
    if (timestampMs !== null) return timestampMs;
  }
  return null;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function firstReportedNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    if (hasOwn(record, key)) return toNumber(record[key]);
  }
  return undefined;
}

function geminiTurnTokens(value: unknown): ParsedConversationTurn["tokens"] {
  const record = asRecord(value);
  if (!record) return undefined;
  const input = firstReportedNumber(record, ["input", "inputTokens", "input_tokens", "promptTokenCount", "prompt_tokens"]);
  const cached = firstReportedNumber(record, ["cached", "cachedInputTokens", "cached_input_tokens", "cachedContentTokenCount"]);
  const output = firstReportedNumber(record, ["output", "outputTokens", "output_tokens", "candidates", "candidatesTokenCount"]);
  const reasoning = firstReportedNumber(record, ["reasoning", "reasoningOutputTokens", "reasoning_output_tokens", "thoughts", "thoughtsTokenCount"]);
  const total = firstReportedNumber(record, ["total", "totalTokens", "total_tokens", "totalTokenCount"]);
  if (input === undefined && cached === undefined && output === undefined && reasoning === undefined && total === undefined) {
    return undefined;
  }
  return {
    ...(input !== undefined ? { input } : {}),
    ...(cached !== undefined ? { cached } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(total !== undefined ? { total } : {}),
  };
}

function tokensFrom(...records: Array<Record<string, unknown> | null>): ParsedConversationTurn["tokens"] {
  for (const record of records) {
    if (!record) continue;
    const tokens = geminiTurnTokens(record.tokens)
      ?? geminiTurnTokens(record.usageMetadata)
      ?? geminiTurnTokens(record.usage_metadata)
      ?? geminiTurnTokens(record.usage);
    if (tokens) return tokens;
  }
  return undefined;
}

function turnEvidence(
  tokens: ParsedConversationTurn["tokens"],
  timestampMs: number | null,
): Pick<ParsedConversationTurn, "tokens" | "timestampMs"> {
  return {
    ...(tokens ? { tokens } : {}),
    ...(timestampMs !== null ? { timestampMs } : {}),
  };
}

function flattenGeminiText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const itemText = flattenGeminiText(item);
      if (itemText) {
        parts.push(itemText);
      }
    }
    return parts.join("");
  }
  const rec = asRecord(value);
  if (!rec) {
    return "";
  }
  return flattenGeminiText(
    rec.text
      ?? rec.output_text
      ?? rec.content
      ?? rec.summary_text
      ?? rec.summary
      ?? rec.reasoning
      ?? rec.thinking,
  );
}

function geminiPartIsReasoning(part: Record<string, unknown>): boolean {
  const partType = typeof part.type === "string" ? part.type : null;
  return partType === "thinking"
    || partType === "reasoning"
    || partType === "thought"
    || part.thought === true
    || part.thought === "true"
    || part.reasoning != null
    || part.reasoning_content != null
    || part.thinking != null
    || part.summary != null
    || part.summary_text != null;
}

function geminiPartReasoningText(part: Record<string, unknown>): string {
  return flattenGeminiText(
    part.reasoning_content
      ?? part.reasoning
      ?? part.thinking
      ?? part.summary
      ?? part.summary_text
      ?? part.text
      ?? part.content,
  ).trim();
}

function geminiPartAssistantText(part: Record<string, unknown>): string {
  const partType = typeof part.type === "string" ? part.type : null;
  if (
    asRecord(part.functionCall)
    || asRecord(part.function_call)
    || asRecord(part.toolCall)
    || asRecord(part.tool_call)
    || asRecord(part.functionResponse)
    || asRecord(part.function_response)
  ) {
    return "";
  }
  if (partType === "function_call" || partType === "tool_call" || partType === "function_response" || partType === "tool_result") {
    return "";
  }
  if (partType === "text" || partType === "output_text" || partType === "message") {
    return flattenGeminiText(part.text ?? part.output_text ?? part.content).trim();
  }
  if ((typeof part.text === "string" || typeof part.output_text === "string" || typeof part.content === "string") && !geminiPartIsReasoning(part)) {
    return flattenGeminiText(part.text ?? part.output_text ?? part.content).trim();
  }
  return "";
}

function functionCallRecord(part: Record<string, unknown>): Record<string, unknown> | null {
  const nested = asRecord(part.functionCall) ?? asRecord(part.function_call) ?? asRecord(part.toolCall) ?? asRecord(part.tool_call);
  if (nested) {
    return nested;
  }
  const partType = typeof part.type === "string" ? part.type : null;
  return partType === "function_call" || partType === "tool_call" ? part : null;
}

function functionResponseRecord(part: Record<string, unknown>): Record<string, unknown> | null {
  const nested = asRecord(part.functionResponse) ?? asRecord(part.function_response) ?? asRecord(part.toolResult) ?? asRecord(part.tool_result);
  if (nested) {
    return nested;
  }
  const partType = typeof part.type === "string" ? part.type : null;
  return partType === "function_response" || partType === "tool_result" ? part : null;
}

function toolCallTurn(
  part: Record<string, unknown>,
  context: Record<string, unknown>[],
): ParsedConversationTurn | null {
  const call = functionCallRecord(part);
  if (!call) {
    return null;
  }
  const toolArguments = call.args !== undefined
    ? stringify(call.args)
    : call.arguments !== undefined
      ? stringify(call.arguments)
      : call.input !== undefined
        ? stringify(call.input)
        : undefined;
  return {
    kind: "tool_call",
    text: "",
    toolName: firstString(call.name, call.toolName, call.tool, part.name, part.toolName, part.tool),
    toolCallId: firstString(call.id, call.call_id, call.callId, call.tool_call_id, part.id, part.call_id, part.callId, part.tool_call_id),
    toolArguments,
    toolStatus: firstString(call.status, part.status),
    ...turnEvidence(tokensFrom(part, call), timestampFrom(part, call, ...context)),
  };
}

function toolResultTurn(
  part: Record<string, unknown>,
  context: Record<string, unknown>[],
): ParsedConversationTurn | null {
  const response = functionResponseRecord(part);
  if (!response) {
    return null;
  }
  const outputValue = response.response ?? response.output ?? response.result ?? response.content ?? response.text;
  return {
    kind: "tool_result",
    text: "",
    toolName: firstString(response.name, response.toolName, response.tool, part.name, part.toolName, part.tool),
    toolCallId: firstString(response.id, response.call_id, response.callId, response.tool_call_id, part.id, part.call_id, part.callId, part.tool_call_id),
    toolOutput: outputValue !== undefined ? stringify(outputValue) : undefined,
    toolStatus: firstString(response.status, part.status),
    ...turnEvidence(tokensFrom(part, response), timestampFrom(part, response, ...context)),
  };
}

function partsFromCandidate(candidate: unknown): unknown[] {
  const candidateRec = asRecord(candidate);
  if (!candidateRec) {
    return [];
  }
  const content = asRecord(candidateRec.content);
  if (Array.isArray(content?.parts)) {
    return content.parts;
  }
  if (Array.isArray(candidateRec.parts)) {
    return candidateRec.parts;
  }
  return [];
}

function parseGeminiParts(
  parts: unknown[],
  role: unknown,
  context: Record<string, unknown>[],
): ParsedConversationTurn[] {
  const conversation: ParsedConversationTurn[] = [];
  const textKind = role === "user" ? "user" : "assistant";
  let textParts: string[] = [];
  let textTimestampMs: number | null = null;
  let textTokens: ParsedConversationTurn["tokens"];
  const flushAssistant = (): void => {
    const text = textParts.join("").trim();
    textParts = [];
    if (text) {
      conversation.push({
        kind: textKind,
        text,
        ...turnEvidence(textTokens, textTimestampMs),
      });
    }
    textTimestampMs = null;
    textTokens = undefined;
  };

  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec) {
      continue;
    }

    const reasoningText = geminiPartReasoningText(rec);
    if (geminiPartIsReasoning(rec) && reasoningText) {
      flushAssistant();
      conversation.push({
        kind: "reasoning",
        text: reasoningText,
        ...turnEvidence(tokensFrom(rec), timestampFrom(rec, ...context)),
      });
      continue;
    }

    const callTurn = toolCallTurn(rec, context);
    if (callTurn) {
      flushAssistant();
      conversation.push(callTurn);
      continue;
    }

    const resultTurn = toolResultTurn(rec, context);
    if (resultTurn) {
      flushAssistant();
      conversation.push(resultTurn);
      continue;
    }

    const assistantText = geminiPartAssistantText(rec);
    if (assistantText) {
      const partTimestampMs = timestampFrom(rec, ...context);
      const partTokens = tokensFrom(rec);
      if (textParts.length > 0 && (partTimestampMs !== textTimestampMs || partTokens !== undefined)) {
        flushAssistant();
      }
      textTimestampMs = partTimestampMs;
      textTokens = partTokens;
      textParts.push(assistantText);
    }
  }

  flushAssistant();
  const contextualTokens = tokensFrom(...context);
  if (contextualTokens) {
    let preferredIndex = -1;
    for (let index = conversation.length - 1; index >= 0; index -= 1) {
      if (conversation[index]?.kind === textKind) {
        preferredIndex = index;
        break;
      }
    }
    const index = preferredIndex >= 0 ? preferredIndex : conversation.length - 1;
    if (index >= 0 && !conversation[index]?.tokens) {
      conversation[index] = { ...conversation[index], tokens: contextualTokens };
    }
  }
  return conversation;
}

function responseRecord(parsed: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(parsed.response);
}

function contentEntries(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const request = asRecord(parsed.request);
  const values = Array.isArray(request?.contents)
    ? request.contents
    : Array.isArray(parsed.contents)
      ? parsed.contents
      : [];
  return values.map(asRecord).filter((value): value is Record<string, unknown> => value !== null);
}

function fallbackResponseParts(parsed: Record<string, unknown>): unknown[] {
  const response = responseRecord(parsed);
  const content = asRecord(response?.content);
  return Array.isArray(content?.parts) ? content.parts : [];
}

export function parseGeminiConversation(parsed: Record<string, unknown>): ParsedConversationTurn[] {
  const conversation: ParsedConversationTurn[] = [];
  for (const content of contentEntries(parsed)) {
    if (Array.isArray(content.parts)) {
      conversation.push(...parseGeminiParts(content.parts, content.role, [content]));
    }
  }

  const response = responseRecord(parsed);
  const candidates = Array.isArray(response?.candidates)
    ? response.candidates
    : Array.isArray(parsed.candidates)
      ? parsed.candidates
      : [];
  for (const candidate of candidates) {
    const candidateRecord = asRecord(candidate);
    if (!candidateRecord) continue;
    const content = asRecord(candidateRecord.content);
    const parts = partsFromCandidate(candidateRecord);
    if (parts.length > 0) {
      conversation.push(...parseGeminiParts(
        parts,
        content?.role ?? candidateRecord.role ?? "assistant",
        [content, candidateRecord, response, parsed].filter((record): record is Record<string, unknown> => record !== null),
      ));
    }
  }

  if (conversation.length > 0) {
    return conversation;
  }

  const fallbackParts = fallbackResponseParts(parsed);
  return fallbackParts.length > 0
    ? parseGeminiParts(fallbackParts, asRecord(response?.content)?.role ?? "assistant", [response, parsed].filter((record): record is Record<string, unknown> => record !== null))
    : [];
}

export function parseGeminiTokens(stats: Record<string, unknown> | null): GeminiUsageTotals | null {
  if (!stats) {
    return null;
  }

  const directTokens = asRecord(stats.tokens);
  if (directTokens) {
    const normalized = normalizeUsageCounts(directTokens, {
      promptKeys: ["input", "input_tokens", "inputTokens", "prompt_tokens", "promptTokens"],
      completionKeys: ["candidates", "output", "output_tokens", "outputTokens", "completion_tokens", "completionTokens"],
      totalKeys: ["total", "total_tokens", "totalTokens", "totalTokenCount"],
    });
    const inputTokens = normalized.promptTokens;
    const cachedInputTokens = toNumber(directTokens.cached);
    const outputTokens = normalized.completionTokens;
    const reasoningOutputTokens = toNumber(directTokens.thoughts);
    const totalTokens = Math.max(normalized.totalTokens, inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens);
    if (totalTokens > 0) {
      return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
      };
    }
  }

  const usageMetadata = asRecord(stats.usageMetadata)
    ?? asRecord(stats.usage_metadata)
    ?? (hasOwn(stats, "promptTokenCount") || hasOwn(stats, "totalTokenCount") ? stats : null);
  if (usageMetadata) {
    const promptTokens = toNumber(usageMetadata.promptTokenCount ?? usageMetadata.inputTokens ?? usageMetadata.input_tokens);
    const cachedInputTokens = toNumber(usageMetadata.cachedContentTokenCount ?? usageMetadata.cachedInputTokens ?? usageMetadata.cached_input_tokens);
    const inputTokens = Math.max(0, promptTokens - cachedInputTokens);
    const outputTokens = toNumber(usageMetadata.candidatesTokenCount ?? usageMetadata.outputTokens ?? usageMetadata.output_tokens);
    const reasoningOutputTokens = toNumber(usageMetadata.thoughtsTokenCount ?? usageMetadata.reasoningOutputTokens ?? usageMetadata.reasoning_output_tokens);
    const reportedTotal = toNumber(usageMetadata.totalTokenCount ?? usageMetadata.totalTokens ?? usageMetadata.total_tokens);
    const totalTokens = Math.max(reportedTotal, inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens);
    if (totalTokens > 0) {
      return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens };
    }
  }

  const models = stats.models && typeof stats.models === "object" ? Object.values(stats.models as Record<string, unknown>) : [];
  if (models.length > 0) {
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let reasoningOutputTokens = 0;
    for (const entry of models) {
      const tokens = asRecord(asRecord(entry)?.tokens);
      if (!tokens) {
        continue;
      }
      const normalized = normalizeUsageCounts(tokens, {
        promptKeys: ["input", "input_tokens", "inputTokens", "prompt_tokens", "promptTokens"],
        completionKeys: ["candidates", "output", "output_tokens", "outputTokens", "completion_tokens", "completionTokens"],
        totalKeys: ["total", "total_tokens", "totalTokens", "totalTokenCount"],
      });
      inputTokens += normalized.promptTokens;
      cachedInputTokens += toNumber(tokens.cached);
      outputTokens += normalized.completionTokens;
      reasoningOutputTokens += toNumber(tokens.thoughts);
    }
    const totalTokens = inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens;
    if (totalTokens > 0) {
      return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
      };
    }
  }

  return null;
}

function geminiTranscriptText(parsed: Record<string, unknown>, conversation: ParsedConversationTurn[]): string {
  if (typeof parsed.response === "string") {
    return parsed.response.trim();
  }

  const assistantTranscript = conversation
    .filter((turn) => turn.kind === "assistant")
    .map((turn) => turn.text)
    .filter(Boolean)
    .join("\n")
    .trim();
  if (assistantTranscript) {
    return assistantTranscript;
  }

  const response = responseRecord(parsed);
  return flattenGeminiText(response?.content).trim();
}

function isGeminiLogRecord(value: Record<string, unknown>): boolean {
  return typeof value.response === "string"
    || asRecord(value.response) !== null
    || Array.isArray(value.candidates)
    || asRecord(value.stats) !== null
    || asRecord(value.usageMetadata) !== null
    || asRecord(value.usage_metadata) !== null;
}

function parseGeminiStdoutRecord(stdout: string): Record<string, unknown> | null {
  const direct = parseJsonObject(stdout);
  if (direct) {
    return isGeminiLogRecord(direct) ? direct : null;
  }

  let offset = 0;
  while (offset < stdout.length) {
    const extracted = extractJsonContainer<Record<string, unknown>>(stdout.slice(offset), "object");
    if (!extracted.ok) return null;
    if (isGeminiLogRecord(extracted.value)) return extracted.value;
    offset += extracted.endIndex;
  }
  return null;
}

export function parseGeminiLog(stdout: string): GeminiLogResult {
  const parsed = parseGeminiStdoutRecord(stdout);
  if (!parsed) {
    return emptyGeminiLogResult();
  }

  const response = responseRecord(parsed);
  const usageCandidates = [
    asRecord(parsed.stats),
    asRecord(parsed.usageMetadata) || asRecord(parsed.usage_metadata) ? parsed : null,
    asRecord(response?.usageMetadata) || asRecord(response?.usage_metadata) ? response : null,
  ];
  let usageRecord: Record<string, unknown> | null = null;
  let usage: GeminiUsageTotals | null = null;
  for (const candidate of usageCandidates) {
    const parsedUsage = parseGeminiTokens(candidate);
    if (parsedUsage) {
      usageRecord = candidate;
      usage = parsedUsage;
      break;
    }
  }
  const conversation = parseGeminiConversation(parsed);
  const nativeSessionId = firstString(parsed.session_id, parsed.sessionId, parsed.nativeSessionId) ?? null;

  return {
    usage,
    rawUsageJson: usage ? usageRecord : null,
    nativeSessionId,
    transcriptText: geminiTranscriptText(parsed, conversation),
    conversation,
  };
}
