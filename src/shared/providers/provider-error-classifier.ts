import type { ProviderId } from "../../contracts/app-types.js";
import type { CommandResult } from "../subprocess/command-runner.js";

export class ProviderQuotaError extends Error {
  readonly category: ProviderErrorCategory;
  readonly retryAfterIso: string | null;

  constructor(classification: ProviderErrorClassification) {
    const categoryTag = classification.category !== "UNKNOWN"
      ? ` [ERROR_CATEGORY:${classification.category}]`
      : "";
    const retryTag = classification.resetAtIso ? ` [RETRY_AFTER:${classification.resetAtIso}]` : "";
    super(`${classification.userMessage}${categoryTag}${retryTag}`);
    this.name = "ProviderQuotaError";
    this.category = classification.category;
    this.retryAfterIso = classification.resetAtIso;
  }
}

const ERROR_CATEGORY_PATTERN = /\[ERROR_CATEGORY:([A-Z_]+)\]/;
const RETRY_AFTER_PATTERN = /\[RETRY_AFTER:(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/;

export function extractProviderErrorCategory(errorMessage: string): ProviderErrorCategory | null {
  const match = errorMessage.match(ERROR_CATEGORY_PATTERN);
  const category = match?.[1] ?? null;
  switch (category) {
    case "QUOTA_EXHAUSTED":
    case "AUTH_FAILURE":
    case "RATE_LIMITED":
    case "PROVIDER_NOT_FOUND":
    case "UNKNOWN":
      return category;
    default:
      return null;
  }
}

export function extractRetryAfterIso(errorMessage: string): string | null {
  const match = errorMessage.match(RETRY_AFTER_PATTERN);
  return match?.[1] ?? null;
}

export function isRetryAfterActive(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  const iso = extractRetryAfterIso(errorMessage);
  if (!iso) return false;
  return new Date(iso).getTime() > Date.now();
}

export function isQuotaCooldownActive(errorMessage: string | null | undefined): boolean {
  return isRetryAfterActive(errorMessage);
}

export type ProviderErrorCategory =
  | "QUOTA_EXHAUSTED"
  | "AUTH_FAILURE"
  | "RATE_LIMITED"
  | "PROVIDER_NOT_FOUND"
  | "UNKNOWN";

export interface ProviderErrorClassification {
  category: ProviderErrorCategory;
  provider: string;
  userMessage: string;
  resetAfter: string | null;
  resetAtIso: string | null;
}

interface ErrorPattern {
  category: ProviderErrorCategory;
  patterns: RegExp[];
  resetTimeExtractor?: (text: string) => string | null;
}

const GEMINI_PATTERNS: ErrorPattern[] = [
  {
    category: "QUOTA_EXHAUSTED",
    patterns: [
      /TerminalQuotaError/i,
      /QUOTA_EXHAUSTED/i,
      /quota will reset after/i,
      /exhausted your capacity/i,
      /reason:\s*'QUOTA_EXHAUSTED'/i,
    ],
    resetTimeExtractor: (text: string): string | null => {
      const match = text.match(/quota will reset after\s+(\d+h\d+m\d+s|\d+m\d+s|\d+h\d+m|\d+s)/i);
      return match?.[1] ?? null;
    },
  },
  {
    category: "AUTH_FAILURE",
    patterns: [
      /HybridTokenStorage/i,
      /FileTokenStorage/i,
      /uv_os_get_passwd/i,
      /apiKeyCredentialStorage/i,
      /Config\.refreshAuth/i,
    ],
  },
  {
    category: "RATE_LIMITED",
    patterns: [
      /rate.?limit/i,
      /too many requests/i,
      /no capacity available for model/i,
      /code:\s*429\b/,
    ],
    resetTimeExtractor: (text: string): string | null => {
      const match = text.match(/retry.?after[:\s]+(\d+)/i);
      return match ? `${match[1]}s` : null;
    },
  },
];

const CLAUDE_CODE_PATTERNS: ErrorPattern[] = [
  {
    category: "QUOTA_EXHAUSTED",
    patterns: [
      /usage limit/i,
      /quota.*exceeded/i,
      /billing.*limit/i,
      /credit.*exhausted/i,
    ],
  },
  {
    category: "AUTH_FAILURE",
    patterns: [
      /invalid.*api.?key/i,
      /authentication.*failed/i,
      /unauthorized/i,
      /ANTHROPIC_API_KEY/i,
      /credentials.*expired/i,
    ],
  },
  {
    category: "RATE_LIMITED",
    patterns: [
      /rate.?limit/i,
      /too many requests/i,
      /overloaded/i,
      /code:\s*429\b/,
    ],
  },
];

const CODEX_PATTERNS: ErrorPattern[] = [
  {
    category: "QUOTA_EXHAUSTED",
    patterns: [
      /quota.*exceeded/i,
      /billing.*limit/i,
      /insufficient.*quota/i,
    ],
  },
  {
    category: "AUTH_FAILURE",
    patterns: [
      /invalid.*api.?key/i,
      /authentication.*failed/i,
      /unauthorized/i,
      /OPENAI_API_KEY/i,
      /Incorrect API key/i,
    ],
  },
  {
    category: "RATE_LIMITED",
    patterns: [
      /rate.?limit/i,
      /too many requests/i,
      /code:\s*429\b/,
    ],
  },
];

const PROVIDER_PATTERNS: Record<string, ErrorPattern[]> = {
  gemini: GEMINI_PATTERNS,
  "claude-code": CLAUDE_CODE_PATTERNS,
  codex: CODEX_PATTERNS,
};

const PROVIDER_NOT_FOUND_PATTERNS: RegExp[] = [
  /ENOENT/i,
  /command not found/i,
  /not recognized as/i,
];

const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini",
  "claude-code": "Claude Code",
  codex: "Codex",
};

function isGeminiRuntimeStorageError(text: string): boolean {
  return /ENOENT/i.test(text)
    && /\.sprint-os-home\/\.gemini\//i.test(text);
}

function isCodexTransportServerError(text: string): boolean {
  return /responses_websocket/i.test(text)
    && /HTTP error:\s*5\d\d/i.test(text);
}

function computeResetAtIso(resetAfter: string): string | null {
  const hours = parseInt(resetAfter.match(/(\d+)h/)?.[1] ?? "0", 10);
  const minutes = parseInt(resetAfter.match(/(\d+)m/)?.[1] ?? "0", 10);
  const seconds = parseInt(resetAfter.match(/(\d+)s/)?.[1] ?? "0", 10);
  const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
  if (totalMs <= 0) return null;
  return new Date(Date.now() + totalMs).toISOString();
}

function buildUserMessage(
  provider: string,
  category: ProviderErrorCategory,
  resetAfter: string | null,
): string {
  const label = PROVIDER_LABELS[provider] ?? provider;
  switch (category) {
    case "QUOTA_EXHAUSTED":
      return resetAfter
        ? `${label} quota exhausted. Resets in ${resetAfter}.`
        : `${label} quota exhausted.`;
    case "AUTH_FAILURE":
      return `${label} authentication failed. The copied credentials may be expired or invalid. Re-authenticate the provider locally and retry.`;
    case "RATE_LIMITED":
      return resetAfter
        ? `${label} rate-limited. Retry after ${resetAfter}.`
        : `${label} rate-limited. Retry after a short wait.`;
    case "PROVIDER_NOT_FOUND":
      return `${label} CLI not found. Ensure the provider is installed and available in PATH.`;
    case "UNKNOWN":
      return `${label} failed with an unexpected error.`;
  }
}

export function classifyProviderError(
  provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">,
  result: CommandResult,
): ProviderErrorClassification {
  const combined = `${result.stdout}\n${result.stderr}`;
  const providerPatterns = PROVIDER_PATTERNS[provider] ?? [];

  if (provider === "codex" && isCodexTransportServerError(combined)) {
    return {
      category: "UNKNOWN",
      provider,
      userMessage: buildUserMessage(provider, "UNKNOWN", null),
      resetAfter: null,
      resetAtIso: null,
    };
  }

  for (const entry of providerPatterns) {
    if (entry.patterns.some((pattern) => pattern.test(combined))) {
      const resetAfter = entry.resetTimeExtractor?.(combined) ?? null;
      const resetAtIso = resetAfter ? computeResetAtIso(resetAfter) : null;
      return {
        category: entry.category,
        provider,
        userMessage: buildUserMessage(provider, entry.category, resetAfter),
        resetAfter,
        resetAtIso,
      };
    }
  }

  if (provider === "gemini" && isGeminiRuntimeStorageError(combined)) {
    return {
      category: "UNKNOWN",
      provider,
      userMessage: buildUserMessage(provider, "UNKNOWN", null),
      resetAfter: null,
      resetAtIso: null,
    };
  }

  if (PROVIDER_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(combined))) {
    return {
      category: "PROVIDER_NOT_FOUND",
      provider,
      userMessage: buildUserMessage(provider, "PROVIDER_NOT_FOUND", null),
      resetAfter: null,
      resetAtIso: null,
    };
  }

  return {
    category: "UNKNOWN",
    provider,
    userMessage: buildUserMessage(provider, "UNKNOWN", null),
    resetAfter: null,
    resetAtIso: null,
  };
}
