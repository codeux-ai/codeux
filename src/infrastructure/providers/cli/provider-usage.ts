import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { countTokens as countAnthropicTokens } from "@anthropic-ai/tokenizer";
import { encodingForModel } from "js-tiktoken";
import type { TokenUsageSource } from "../../../contracts/execution-types.js";

export interface ProviderUsageTelemetry {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  usageSource: TokenUsageSource;
  rawUsageJson: Record<string, unknown> | null;
  transcriptText: string;
  nativeSessionId: string | null;
}

function emptyTelemetry(): ProviderUsageTelemetry {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    usageSource: "unavailable",
    rawUsageJson: null,
    transcriptText: "",
    nativeSessionId: null,
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function tokenizeWithCodexModel(model: string | null | undefined, text: string): number {
  const normalized = typeof model === "string" && model.trim().length > 0 ? model.trim() : "gpt-4o";
  try {
    const encoding = encodingForModel(normalized as Parameters<typeof encodingForModel>[0]);
    return encoding.encode(text).length;
  } catch {
    const encoding = encodingForModel("gpt-4o");
    return encoding.encode(text).length;
  }
}

function estimateTextTokens(provider: "gemini" | "codex" | "claude-code" | "qwen-code", model: string | null | undefined, text: string): number {
  if (!text.trim()) {
    return 0;
  }
  if (provider === "claude-code") {
    return countAnthropicTokens(text);
  }
  if (provider === "codex") {
    return tokenizeWithCodexModel(model, text);
  }

  // Gemini CLI can suppress machine-readable stats when native MCP tools are enabled.
  // Use the same conservative character heuristic used for non-native telemetry.
  return Math.ceil(text.length / 4);
}

function estimateTelemetry(provider: "gemini" | "codex" | "claude-code" | "qwen-code", model: string | null | undefined, inputText: string, outputText: string): ProviderUsageTelemetry {
  const inputTokens = estimateTextTokens(provider, model, inputText);
  const outputTokens = estimateTextTokens(provider, model, outputText);
  return {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    reasoningOutputTokens: 0,
    totalTokens: inputTokens + outputTokens,
    usageSource: "estimated",
    rawUsageJson: null,
    transcriptText: outputText,
    nativeSessionId: null,
  };
}

function parseGeminiTokens(stats: Record<string, unknown> | null): ProviderUsageTelemetry | null {
  if (!stats) {
    return null;
  }

  const directTokens = stats.tokens && typeof stats.tokens === "object" ? stats.tokens as Record<string, unknown> : null;
  if (directTokens) {
    const inputTokens = toNumber(directTokens.input);
    const cachedInputTokens = toNumber(directTokens.cached);
    const outputTokens = toNumber(directTokens.candidates);
    const reasoningOutputTokens = toNumber(directTokens.thoughts);
    const totalTokens = inputTokens + outputTokens + reasoningOutputTokens;
    if (totalTokens > 0) {
      return {
        ...emptyTelemetry(),
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
        usageSource: "reported",
        rawUsageJson: stats,
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
      const tokens = entry && typeof entry === "object" ? (entry as Record<string, unknown>).tokens : null;
      if (!tokens || typeof tokens !== "object") {
        continue;
      }
      inputTokens += toNumber((tokens as Record<string, unknown>).input);
      cachedInputTokens += toNumber((tokens as Record<string, unknown>).cached);
      outputTokens += toNumber((tokens as Record<string, unknown>).candidates);
      reasoningOutputTokens += toNumber((tokens as Record<string, unknown>).thoughts);
    }
    const totalTokens = inputTokens + outputTokens + reasoningOutputTokens;
    if (totalTokens > 0) {
      return {
        ...emptyTelemetry(),
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
        usageSource: "reported",
        rawUsageJson: stats,
      };
    }
  }

  return null;
}

function parseCodexJsonLines(stdout: string): ProviderUsageTelemetry | null {
  let latestUsage: Record<string, unknown> | null = null;
  for (const line of stdout.split("\n")) {
    const parsed = parseJsonObject(line.trim());
    if (!parsed) {
      continue;
    }
    const payload = parsed.payload && typeof parsed.payload === "object" ? parsed.payload as Record<string, unknown> : null;
    const type = typeof parsed.type === "string" ? parsed.type : typeof payload?.type === "string" ? payload.type : null;
    if (type !== "token_count" || !payload) {
      continue;
    }
    const info = payload.info && typeof payload.info === "object" ? payload.info as Record<string, unknown> : null;
    const totalUsage = info?.total_token_usage && typeof info.total_token_usage === "object"
      ? info.total_token_usage as Record<string, unknown>
      : null;
    if (totalUsage) {
      latestUsage = totalUsage;
    }
  }

  if (!latestUsage) {
    return null;
  }

  return {
    ...emptyTelemetry(),
    inputTokens: toNumber(latestUsage.input_tokens),
    cachedInputTokens: toNumber(latestUsage.cached_input_tokens),
    outputTokens: toNumber(latestUsage.output_tokens),
    reasoningOutputTokens: toNumber(latestUsage.reasoning_output_tokens),
    totalTokens: toNumber(latestUsage.input_tokens) + toNumber(latestUsage.output_tokens),
    usageSource: "reported",
    rawUsageJson: latestUsage,
  };
}

function extractClaudeTranscript(lines: Array<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const line of lines) {
    const message = line.message && typeof line.message === "object" ? line.message as Record<string, unknown> : null;
    const content = Array.isArray(message?.content) ? message!.content as Array<Record<string, unknown>> : [];
    for (const item of content) {
      if (item?.type === "text" && typeof item.text === "string") {
        parts.push(item.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function parseClaudeSessionTelemetry(cwd: string, nativeSessionId: string): Promise<ProviderUsageTelemetry | null> {
  const slug = cwd.replaceAll(path.sep, "-");
  const sessionPath = path.join(os.homedir(), ".claude", "projects", slug, `${nativeSessionId}.jsonl`);
  const raw = await fs.readFile(sessionPath, "utf8").catch(() => "");
  return parseClaudeSessionJsonl(raw, nativeSessionId, { sessionPath });
}

function parseClaudeSessionJsonl(
  raw: string,
  nativeSessionId: string,
  rawUsageJson: Record<string, unknown> | null,
): ProviderUsageTelemetry | null {
  if (!raw.trim()) {
    return null;
  }

  const parsedLines = raw.split("\n")
    .map((line) => parseJsonObject(line.trim()))
    .filter((line): line is Record<string, unknown> => Boolean(line));
  if (parsedLines.length === 0) {
    return null;
  }

  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  for (const line of parsedLines) {
    const message = line.message && typeof line.message === "object" ? line.message as Record<string, unknown> : null;
    const usage = message?.usage && typeof message.usage === "object" ? message.usage as Record<string, unknown> : null;
    if (!usage) {
      continue;
    }
    inputTokens += toNumber(usage.input_tokens);
    cachedInputTokens += toNumber(usage.cache_creation_input_tokens) + toNumber(usage.cache_read_input_tokens);
    outputTokens += toNumber(usage.output_tokens);
  }

  const totalTokens = inputTokens + outputTokens;
  if (totalTokens === 0) {
    return {
      ...emptyTelemetry(),
      transcriptText: extractClaudeTranscript(parsedLines),
      nativeSessionId,
    };
  }

  return {
    ...emptyTelemetry(),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    usageSource: "reported",
    rawUsageJson,
    transcriptText: extractClaudeTranscript(parsedLines),
    nativeSessionId,
  };
}

export async function collectProviderUsageTelemetry(args: {
  provider: "gemini" | "codex" | "claude-code" | "qwen-code";
  model: string;
  prompt: string;
  cwd: string;
  stdout: string;
  stderr: string;
  capturedText?: string;
  nativeSessionId?: string | null;
  claudeSessionJsonl?: string | null;
}): Promise<ProviderUsageTelemetry> {
  const fallbackOutput = [args.capturedText || "", args.stdout || "", args.stderr || ""].filter(Boolean).join("\n").trim();

  if (args.provider === "gemini") {
    const parsed = parseJsonObject(args.stdout);
    const stats = parsed?.stats && typeof parsed.stats === "object" ? parsed.stats as Record<string, unknown> : null;
    const usage = parseGeminiTokens(stats);
    if (usage) {
      usage.transcriptText = typeof parsed?.response === "string" ? parsed.response : fallbackOutput;
      usage.nativeSessionId = typeof parsed?.session_id === "string" ? parsed.session_id : null;
      return usage;
    }
    const estimated = estimateTelemetry("gemini", args.model, args.prompt, typeof parsed?.response === "string" ? parsed.response : fallbackOutput);
    estimated.nativeSessionId = typeof parsed?.session_id === "string" ? parsed.session_id : null;
    return estimated;
  }

  if (args.provider === "codex") {
    const usage = parseCodexJsonLines(args.stdout);
    if (usage) {
      usage.transcriptText = args.capturedText?.trim() || fallbackOutput;
      return usage;
    }
    return estimateTelemetry("codex", args.model, args.prompt, args.capturedText?.trim() || fallbackOutput);
  }

  if (args.nativeSessionId) {
    if (args.claudeSessionJsonl) {
      const usage = parseClaudeSessionJsonl(args.claudeSessionJsonl, args.nativeSessionId, { source: "container-session-jsonl" });
      if (usage && usage.totalTokens > 0) {
        return usage;
      }
      if (usage) {
        return estimateTelemetry("claude-code", args.model, args.prompt, usage.transcriptText || fallbackOutput);
      }
    }
    const usage = await parseClaudeSessionTelemetry(args.cwd, args.nativeSessionId);
    if (usage && usage.totalTokens > 0) {
      return usage;
    }
    if (usage) {
      return estimateTelemetry("claude-code", args.model, args.prompt, usage.transcriptText || fallbackOutput);
    }
  }

  return estimateTelemetry("claude-code", args.model, args.prompt, fallbackOutput);
}
