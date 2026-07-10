import type { ParsedConversationTurn, ParsedProviderLogResult } from "./provider-conversation-types.js";
import { normalizeUsageCounts, parseJsonObject, toNumber } from "./usage-parse-utils.js";

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
  if (part.functionCall || part.function_call || part.toolCall || part.tool_call || part.functionResponse || part.function_response) {
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

function toolCallTurn(part: Record<string, unknown>): ParsedConversationTurn | null {
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
  };
}

function toolResultTurn(part: Record<string, unknown>): ParsedConversationTurn | null {
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

function parseGeminiParts(parts: unknown[]): ParsedConversationTurn[] {
  const conversation: ParsedConversationTurn[] = [];
  const assistantParts: string[] = [];
  const flushAssistant = (): void => {
    const text = assistantParts.join("").trim();
    assistantParts.length = 0;
    if (text) {
      conversation.push({ kind: "assistant", text });
    }
  };

  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec) {
      continue;
    }

    const reasoningText = geminiPartReasoningText(rec);
    if (geminiPartIsReasoning(rec) && reasoningText) {
      flushAssistant();
      conversation.push({ kind: "reasoning", text: reasoningText });
      continue;
    }

    const callTurn = toolCallTurn(rec);
    if (callTurn) {
      flushAssistant();
      conversation.push(callTurn);
      continue;
    }

    const resultTurn = toolResultTurn(rec);
    if (resultTurn) {
      flushAssistant();
      conversation.push(resultTurn);
      continue;
    }

    const assistantText = geminiPartAssistantText(rec);
    if (assistantText) {
      assistantParts.push(assistantText);
    }
  }

  flushAssistant();
  return conversation;
}

function responseRecord(parsed: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(parsed.response);
}

function candidateParts(parsed: Record<string, unknown>): unknown[][] {
  const response = responseRecord(parsed);
  const candidates = Array.isArray(response?.candidates)
    ? response.candidates
    : Array.isArray(parsed.candidates)
      ? parsed.candidates
      : [];
  return candidates.map(partsFromCandidate).filter((parts) => parts.length > 0);
}

function fallbackResponseParts(parsed: Record<string, unknown>): unknown[] {
  const response = responseRecord(parsed);
  const content = asRecord(response?.content);
  return Array.isArray(content?.parts) ? content.parts : [];
}

export function parseGeminiConversation(parsed: Record<string, unknown>): ParsedConversationTurn[] {
  const conversation: ParsedConversationTurn[] = [];
  for (const parts of candidateParts(parsed)) {
    conversation.push(...parseGeminiParts(parts));
  }

  if (conversation.length > 0) {
    return conversation;
  }

  const fallbackParts = fallbackResponseParts(parsed);
  return fallbackParts.length > 0 ? parseGeminiParts(fallbackParts) : [];
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

export function parseGeminiLog(stdout: string): GeminiLogResult {
  const parsed = parseJsonObject(stdout);
  if (!parsed) {
    return emptyGeminiLogResult();
  }

  const stats = asRecord(parsed.stats);
  const usage = parseGeminiTokens(stats);
  const conversation = parseGeminiConversation(parsed);
  const nativeSessionId = firstString(parsed.session_id, parsed.sessionId, parsed.nativeSessionId) ?? null;

  return {
    usage,
    rawUsageJson: usage ? stats : null,
    nativeSessionId,
    transcriptText: geminiTranscriptText(parsed, conversation),
    conversation,
  };
}
