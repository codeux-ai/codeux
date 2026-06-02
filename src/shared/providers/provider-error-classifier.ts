import type { ProviderId } from "../../contracts/app-types.js";
import type { CommandResult } from "../subprocess/command-runner.js";

export function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as Record<string, unknown>).message === "string"
  );
}

export function getErrorMessage(error: unknown, fallback: string = "An unknown error occurred"): string {
  if (typeof error === "string") {
    return error;
  }
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  return fallback;
}

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
      /invalid api key/i,
    ],
  },
  {
    category: "RATE_LIMITED",
    patterns: [
      /rate.?limit/i,
      /too many requests/i,
      /no capacity available for model/i,
      /code:\s*429\b/,
      /Resource has been exhausted/i,
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
      /insufficient_quota/i,
      /Out of funds/i,
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
      /invalid_api_key/i,
      /authentication_error/i,
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

// Codex's `codex exec` prints its usage cap as a single ERROR line, e.g.:
//   "ERROR: You've hit your usage limit. Upgrade to Pro (...), visit
//    https://chatgpt.com/codex/settings/usage to purchase more credits or
//    try again at 3:54 AM."
// It exits non-zero, so it reaches classifyProviderError on the failure path.
// The reset hint is a wall-clock time ("try again at 3:54 AM"), not a duration,
// so it needs its own extractor (computeResetAfterFromClockTime) rather than the
// shared HhMmSs parser used by the other providers.
const CODEX_PATTERNS: ErrorPattern[] = [
  {
    category: "QUOTA_EXHAUSTED",
    patterns: [
      /quota.*exceeded/i,
      /billing.*limit/i,
      /insufficient.*quota/i,
      /usage limit/i,
      /hit your.*limit/i,
      /purchase more credits/i,
      /Upgrade to Pro/i,
    ],
    resetTimeExtractor: computeResetAfterFromClockTime,
  },
  {
    category: "AUTH_FAILURE",
    patterns: [
      /invalid.*api.?key/i,
      /authentication.*failed/i,
      /unauthorized/i,
      /OPENAI_API_KEY/i,
      /Incorrect API key/i,
      /invalid_api_key/i,
      /authentication_error/i,
    ],
  },
  {
    category: "RATE_LIMITED",
    patterns: [
      /rate.?limit/i,
      /too many requests/i,
      /code:\s*429\b/,
      /requests per minute/i,
    ],
  },
];

// Antigravity's `agy` CLI surfaces an exhausted allowance with a message like:
//   "Individual quota reached. Contact your administrator to enable overages. Resets in 3h4m52s."
// Critically, it prints this to its normal output and exits 0, so it must be matched
// both when classifying an explicit failure and when scanning an apparently-successful
// run (see resultHasSilentQuotaSignal).
const ANTIGRAVITY_QUOTA_PATTERNS: RegExp[] = [
  /Individual quota reached/i,
  /Contact your administrator to enable overages/i,
  /enable overages/i,
  /RESOURCE_EXHAUSTED/i,
];

const ANTIGRAVITY_PATTERNS: ErrorPattern[] = [
  {
    category: "QUOTA_EXHAUSTED",
    patterns: ANTIGRAVITY_QUOTA_PATTERNS,
    resetTimeExtractor: (text: string): string | null => {
      const match = text.match(/Resets in\s+(\d+h\d+m\d+s|\d+h\d+m|\d+m\d+s|\d+h|\d+m|\d+s)/i);
      return match?.[1] ?? null;
    },
  },
  {
    category: "AUTH_FAILURE",
    patterns: [
      /invalid.*api.?key/i,
      /authentication.*failed/i,
      /unauthorized/i,
      /ANTIGRAVITY_API_KEY/i,
      /invalid_api_key/i,
      /authentication_error/i,
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
  "qwen-code": CODEX_PATTERNS,
  antigravity: ANTIGRAVITY_PATTERNS,
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
  "qwen-code": "Qwen Code",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

/**
 * Detects whether an apparently-successful provider result actually carries a quota
 * signal. Some CLIs (notably Antigravity's `agy`) print a quota/limit message and
 * still exit 0, so callers only consulting classifyProviderError on non-zero exits
 * would treat the run as a successful, truncated "completion" — stranding the task as
 * done mid-sprint. Use this to re-route such results through the normal failure/quota
 * handling path. Scoped to providers known to exit 0 on quota to avoid false positives
 * from agents that merely mention "quota" in their normal output.
 */
export function resultHasSilentQuotaSignal(
  provider: Exclude<ProviderId, "jules">,
  result: CommandResult,
): boolean {
  if (provider !== "antigravity") {
    return false;
  }
  const combined = `${result.stdout}\n${result.stderr}`;
  return ANTIGRAVITY_QUOTA_PATTERNS.some((pattern) => pattern.test(combined));
}

function isGeminiRuntimeStorageError(text: string): boolean {
  return /ENOENT/i.test(text)
    && /\.code-ux-home\/\.gemini\//i.test(text);
}

function isCodexTransportServerError(text: string): boolean {
  return /responses_websocket/i.test(text)
    && /HTTP error:\s*5\d\d/i.test(text);
}

/**
 * Parses Codex's "try again at 3:54 AM" wall-clock reset hint into the same
 * `HhMmSs` duration string the rest of the pipeline expects, measured from now.
 * Codex reports a clock time without a date, so we resolve it to the next future
 * occurrence of that time (rolling to tomorrow when it has already passed today).
 * The duration then flows through computeResetAtIso like every other provider's
 * reset hint. Returns null when no clock time is present.
 */
export function computeResetAfterFromClockTime(text: string, nowMs: number = Date.now()): string | null {
  const match = text.match(/try again at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) {
    return null;
  }
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return null;
  }
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hour !== 12) {
    hour += 12;
  } else if (meridiem === "AM" && hour === 12) {
    hour = 0;
  }

  const now = new Date(nowMs);
  const target = new Date(nowMs);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  const diffSeconds = Math.round((target.getTime() - now.getTime()) / 1000);
  if (diffSeconds <= 0) {
    return null;
  }
  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;
  return `${hours}h${minutes}m${seconds}s`;
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
  provider: Exclude<ProviderId, "jules">,
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
