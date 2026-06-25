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

type ResetTimeExtractor = NonNullable<ErrorPattern["resetTimeExtractor"]>;

interface CliProviderPatternOptions {
  quotaExtras?: RegExp[];
  authEnvKeys?: RegExp[];
  authExtras?: RegExp[];
  rateLimitExtras?: RegExp[];
  quotaResetTimeExtractor?: ResetTimeExtractor;
  rateLimitResetTimeExtractor?: ResetTimeExtractor;
}

const OPENROUTER_KEY_LIMIT_PATTERNS: RegExp[] = [
  /Key limit exceeded/i,
  /\bweekly limit\b/i,
  /\bmonthly limit\b/i,
];

const COMMON_CLI_PROVIDER_QUOTA_PATTERNS: RegExp[] = [
  /quota.*exceeded/i,
  /billing.*limit/i,
  /insufficient.*quota/i,
  /insufficient_quota/i,
  /usage limit/i,
  /hit your.*limit/i,
  /purchase more credits/i,
  /credit.*exhausted/i,
  /Out of funds/i,
  ...OPENROUTER_KEY_LIMIT_PATTERNS,
];

const COMMON_CLI_PROVIDER_AUTH_PATTERNS: RegExp[] = [
  /invalid.*api.?key/i,
  /authentication.*failed/i,
  /unauthorized/i,
  /Incorrect API key/i,
  /invalid_api_key/i,
  /authentication_error/i,
];

const COMMON_CLI_PROVIDER_RATE_LIMIT_PATTERNS: RegExp[] = [
  /rate.?limit/i,
  /too many requests/i,
  /code:\s*429\b/,
  /requests per minute/i,
];

function createCliProviderPatterns(options: CliProviderPatternOptions = {}): ErrorPattern[] {
  const quotaPatterns = [
    ...COMMON_CLI_PROVIDER_QUOTA_PATTERNS,
    ...(options.quotaExtras ?? []),
  ];
  const authPatterns = [
    ...COMMON_CLI_PROVIDER_AUTH_PATTERNS,
    ...(options.authEnvKeys ?? []),
    ...(options.authExtras ?? []),
  ];
  return [
    {
      category: "QUOTA_EXHAUSTED",
      patterns: quotaPatterns,
      ...(options.quotaResetTimeExtractor ? { resetTimeExtractor: options.quotaResetTimeExtractor } : {}),
    },
    {
      category: "AUTH_FAILURE",
      patterns: authPatterns,
    },
    {
      category: "RATE_LIMITED",
      patterns: [
        ...COMMON_CLI_PROVIDER_RATE_LIMIT_PATTERNS,
        ...(options.rateLimitExtras ?? []),
      ],
      ...(options.rateLimitResetTimeExtractor ? { resetTimeExtractor: options.rateLimitResetTimeExtractor } : {}),
    },
  ];
}

const GEMINI_PATTERNS: ErrorPattern[] = createCliProviderPatterns({
  quotaExtras: [
    /TerminalQuotaError/i,
    /QUOTA_EXHAUSTED/i,
    /quota will reset after/i,
    /exhausted your capacity/i,
    /exhausted your.*quota/i,
    /reason:\s*'QUOTA_EXHAUSTED'/i,
    // Auto-fallback notice printed when a daily-quota limit forces a model switch.
    /Possible quota limitations/i,
  ],
  authExtras: [
    /HybridTokenStorage/i,
    /FileTokenStorage/i,
    /uv_os_get_passwd/i,
    /apiKeyCredentialStorage/i,
    /Config\.refreshAuth/i,
    /invalid api key/i,
    // Gemini renders a 401 as "Session expired or is unauthorized." and the backend
    // returns INVALID_ARGUMENT bodies for bad keys: "API key not valid", "API Key not
    // found", "API key expired", plus the API_KEY_INVALID reason tag.
    /Session expired/i,
    /API.?key not (?:valid|found)/i,
    /API key expired/i,
    /API_KEY_INVALID/i,
  ],
  rateLimitExtras: [
    /no capacity available for model/i,
    /Resource has been exhausted/i,
    // Transient capacity / high-demand backoff prompts.
    /high demand/i,
  ],
  quotaResetTimeExtractor: (text: string): string | null => {
    const resetMatch = text.match(/quota will reset after\s+(\d+h\d+m\d+s|\d+m\d+s|\d+h\d+m|\d+s)/i);
    if (resetMatch) {
      return resetMatch[1];
    }
    // Gemini's quota classifier appends "Suggested retry after 60s." (a duration).
    const retryMatch = text.match(/Suggested retry after\s+(\d+)\s*s\b/i);
    return retryMatch ? `${retryMatch[1]}s` : null;
  },
  rateLimitResetTimeExtractor: (text: string): string | null => {
    const match = text.match(/retry.?after[:\s]+(\d+)/i);
    return match ? `${match[1]}s` : null;
  },
});

// Claude Code authenticates via API key, bearer token, OAuth token, or /login, so
// the same underlying auth failure surfaces with different wording depending on the
// path. The shared patterns already catch the plain "Invalid API key" /
// "authentication_error" / "unauthorized" forms; these add the bearer-token,
// OAuth-token, missing-key, forbidden, and bridge variants. The "· Please run /login"
// recovery hint is itself a reliable auth signal across surface messages.
const CLAUDE_CODE_AUTH_EXTRAS: RegExp[] = [
  /ANTHROPIC_API_KEY/i,
  /credentials.*expired/i,
  /Missing API key/i,
  /Failed to authenticate/i,
  /Invalid bearer token/i,
  /OAuth token/i,
  /token (?:has|is) expired/i,
  /invalid claims/i,
  /Request not allowed/i,
  /"type"\s*:\s*"forbidden"/i,
  /Invalid token or user mismatch/i,
  /run \/login/i,
];

const CLAUDE_CODE_PATTERNS: ErrorPattern[] = createCliProviderPatterns({
  authExtras: CLAUDE_CODE_AUTH_EXTRAS,
  rateLimitExtras: [/overloaded/i],
});

/**
 * Claude Code's "Extra usage is required …" messages (1M / long-context) carry the
 * API `rate_limit_error` type but are NOT transient: retrying never clears them —
 * the user must enable extra usage or switch model. Detect them so they are routed
 * to a terminal UNKNOWN (which surfaces the actionable message) instead of being
 * swept into the rate-limit retry loop by the shared rate_limit pattern.
 */
function isClaudeExtraUsageRequired(text: string): boolean {
  return /Extra usage is required/i.test(text);
}

// Codex surfaces the same core error string through several wrappers depending on
// mode — the interactive TUI prefixes it with "■ ", `codex exec` human output with
// "ERROR: ", and `codex exec --json` embeds it in
// {"type":"error","message":"…"} / {"type":"turn.failed","error":{"message":"…"}}.
// Classification runs on the combined stdout+stderr with substring matching, so the
// wrappers don't matter here; the patterns below only need to match the inner text.

// AUTH_FAILURE: the stored ChatGPT/Codex login can no longer authenticate and the
// run needs a re-login or a key with the right scopes. Covers RefreshTokenFailedError
// display strings, the transient "Failed to refresh token" template, 401 missing-auth
// / insufficient-scope renderings, and provider JWT/clerk token-invalid bodies. (Plain
// "401 Unauthorized" already matches the shared /unauthorized/ pattern.)
const CODEX_AUTH_EXTRAS: RegExp[] = [
  /OPENAI_API_KEY/i,
  /access token could not be refreshed/i,
  /refresh token (?:has expired|was already used|was revoked)/i,
  /log ?out and sign in again/i,
  /Failed to refresh token/i,
  /Missing bearer or basic authentication/i,
  /insufficient permissions for this operation/i,
  /Missing scopes:/i,
  /Invalid JWT/i,
  /token-invalid/i,
];

// QUOTA_EXHAUSTED: plan usage caps, workspace credit/spend-cap exhaustion, and the
// two-line "Quota exceeded." message. The bare "You've hit your usage limit" and
// "purchase more credits" forms already match the shared quota patterns; these add
// the plan/credit-specific variants. The reset hint, when present, is a wall-clock
// time ("try again at 3:54 AM"), parsed by computeResetAfterFromClockTime.
const CODEX_QUOTA_EXTRAS: RegExp[] = [
  /Upgrade to Pro\b/i,
  /Upgrade to Plus\b/i,
  /out of credits/i,
  /spend cap/i,
  /send a request to your admin/i,
  /Switch to another model now/i,
  /Check your plan and billing details/i,
];

// RATE_LIMITED: transient throttling that should retry after a short wait. The 429
// retry-exhaustion line ("exceeded retry limit, last status: 429 Too Many Requests")
// already matches the shared /too many requests/ pattern (and a non-429 retry
// exhaustion must stay UNKNOWN, so we deliberately do not match "exceeded retry
// limit" on its own). These add the OpenAI TPM body and the backend slow-down body.
const CODEX_RATE_LIMIT_EXTRAS: RegExp[] = [
  /rate limit reached/i,
  /slow down and try again/i,
];

/**
 * Parses Codex rate-limit reset hints expressed as a duration in seconds, e.g.
 * "Please try again in 30s" or "try again after 60 seconds". Distinct from the
 * quota path's wall-clock "try again at 3:54 AM" hint. Returns an `Ns` string the
 * shared pipeline understands, or null when no duration is present.
 */
function extractCodexRateLimitReset(text: string): string | null {
  const match = text.match(/try again (?:in|after)\s+(\d+)\s*s(?:ec(?:ond)?s?)?\b/i);
  return match ? `${match[1]}s` : null;
}

const CODEX_PATTERNS: ErrorPattern[] = createCliProviderPatterns({
  quotaExtras: CODEX_QUOTA_EXTRAS,
  authExtras: CODEX_AUTH_EXTRAS,
  rateLimitExtras: CODEX_RATE_LIMIT_EXTRAS,
  quotaResetTimeExtractor: computeResetAfterFromClockTime,
  rateLimitResetTimeExtractor: extractCodexRateLimitReset,
});

const QWEN_CODE_PATTERNS: ErrorPattern[] = createCliProviderPatterns({
  authEnvKeys: [
    /OPENAI_API_KEY/i,
    /DASHSCOPE_API_KEY/i,
    /BAILIAN_CODING_PLAN_API_KEY/i,
    /QWEN_API_KEY/i,
  ],
  quotaResetTimeExtractor: computeResetAfterFromClockTime,
});

const OPENCODE_PATTERNS: ErrorPattern[] = createCliProviderPatterns({
  authEnvKeys: [/OPENCODE_API_KEY/i],
  quotaResetTimeExtractor: computeResetAfterFromClockTime,
});

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
  // Baseline / model / individual quota and weekly-window forms.
  /quota reached/i,
  /Quota Limit reached/i,
];

// Antigravity authenticates via the system keyring with a Google Sign-In fallback,
// so auth failures surface as login prompts, "Invalid Token"/"Login Expired" states,
// keyring load/persist failures, and "not logged into Antigravity" / "No auth token
// found" token-source errors (all written to its glog log, which the runner folds
// into stderr before classification).
const ANTIGRAVITY_AUTH_EXTRAS: RegExp[] = [
  /ANTIGRAVITY_API_KEY/i,
  /Authentication[\s_]?required/i,
  /Please visit the URL to log in/i,
  /Please sign in/i,
  /Invalid Token/i,
  /Login Expired/i,
  /Not Eligible/i,
  /No auth token found/i,
  /not logged into Antigravity/i,
  /failed to (?:load|persist|set) (?:auth )?token/i,
  /error getting token source/i,
];

const ANTIGRAVITY_PATTERNS: ErrorPattern[] = createCliProviderPatterns({
  quotaExtras: ANTIGRAVITY_QUOTA_PATTERNS,
  authExtras: ANTIGRAVITY_AUTH_EXTRAS,
  quotaResetTimeExtractor: (text: string): string | null => {
    const durationMatch = text.match(/Resets in\s+(\d+h\d+m\d+s|\d+h\d+m|\d+m\d+s|\d+h|\d+m|\d+s)/i);
    if (durationMatch) {
      return durationMatch[1];
    }
    // Weekly-window form: "Quota Limit reached and resets after 6 days." Convert the
    // day count to hours so it flows through the shared HhMmSs reset pipeline.
    const daysMatch = text.match(/resets? after\s+(\d+)\s*days?/i);
    return daysMatch ? `${parseInt(daysMatch[1], 10) * 24}h` : null;
  },
});

const PROVIDER_PATTERNS: Record<string, ErrorPattern[]> = {
  gemini: GEMINI_PATTERNS,
  "claude-code": CLAUDE_CODE_PATTERNS,
  codex: CODEX_PATTERNS,
  "qwen-code": QWEN_CODE_PATTERNS,
  opencode: OPENCODE_PATTERNS,
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
  detail?: string | null,
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
      return detail
        ? `${label} failed: ${detail}`
        : `${label} failed with an unexpected error.`;
  }
}

// Provider output lines that carry no diagnostic value and must never be surfaced
// as "the error" — e.g. Codex prints this to stderr on every `exec` run while it
// waits for (optional) piped stdin, and it was masking the real failure reason.
const NOISE_OUTPUT_PATTERNS: RegExp[] = [
  /^Reading additional input from stdin/i,
  /^\s*$/,
];

const ERROR_LIKE_PATTERN = /error|fail|exception|not supported|unsupported|denied|refused|invalid|unauthor/i;

/**
 * Unwraps Codex's doubly-encoded error string. Codex `exec --json` emits
 * `{"type":"error","message":"<stringified-json>"}` where the inner string is
 * itself `{"type":"error","status":400,"error":{"message":"<human reason>"}}`.
 * Returns the innermost human-readable message when present, else the input.
 */
function unwrapCodexErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.startsWith("{")) {
    try {
      const inner = JSON.parse(trimmed) as { error?: { message?: unknown }; message?: unknown };
      if (inner.error && typeof inner.error.message === "string") {
        return inner.error.message;
      }
      if (typeof inner.message === "string") {
        return inner.message;
      }
    } catch {
      // not nested JSON — fall through to the raw message
    }
  }
  return trimmed;
}

/**
 * Extracts the real failure reason from Codex `exec --json` output. Codex reports
 * failures as structured `{"type":"error",...}` / `{"type":"turn.failed","error":{...}}`
 * JSONL events on stdout while exiting non-zero, so the actionable message (e.g.
 * "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.")
 * is otherwise lost behind the generic "unexpected error" text. Returns the latest
 * such message, or null when none is present.
 */
export function extractCodexStructuredError(combined: string): string | null {
  let latest: string | null = null;
  for (const rawLine of combined.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    let obj: { type?: unknown; message?: unknown; error?: { message?: unknown } };
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const type = typeof obj.type === "string" ? obj.type : null;
    let message: string | null = null;
    if (type === "error" && typeof obj.message === "string") {
      message = obj.message;
    } else if (type === "turn.failed" && obj.error && typeof obj.error.message === "string") {
      message = obj.error.message;
    }
    if (message) {
      latest = unwrapCodexErrorMessage(message);
    }
  }
  return latest;
}

/**
 * Pulls the most informative single line out of arbitrary provider output for
 * surfacing as the failure reason. Drops known-noise lines, prefers the last
 * error-looking line, and otherwise falls back to the last non-empty line.
 * Truncated so the dashboard message stays readable. Returns null when nothing
 * meaningful remains.
 */
function extractGenericErrorDetail(combined: string): string | null {
  const lines = combined
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !NOISE_OUTPUT_PATTERNS.some((pattern) => pattern.test(line)))
    // JSON event lines are not human-readable on their own; skip them here.
    .filter((line) => !line.startsWith("{"));
  if (lines.length === 0) {
    return null;
  }
  const errorLine = [...lines].reverse().find((line) => ERROR_LIKE_PATTERN.test(line));
  const chosen = errorLine ?? lines[lines.length - 1];
  return chosen.length > 300 ? `${chosen.slice(0, 297)}...` : chosen;
}

/**
 * Builds an UNKNOWN classification whose userMessage carries the real failure
 * reason extracted from provider output, instead of the opaque
 * "<provider> failed with an unexpected error." The dashboard renders
 * `userMessage` as the headline error, so this is what makes the actual cause
 * (bad model, transport refusal, etc.) visible without digging into raw logs.
 */
function buildUnknownClassification(
  provider: Exclude<ProviderId, "jules">,
  combined: string,
): ProviderErrorClassification {
  const detail = (provider === "codex" ? extractCodexStructuredError(combined) : null)
    ?? extractGenericErrorDetail(combined);
  return {
    category: "UNKNOWN",
    provider,
    userMessage: buildUserMessage(provider, "UNKNOWN", null, detail),
    resetAfter: null,
    resetAtIso: null,
  };
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

  // Route Claude Code's non-transient "Extra usage is required" entitlement errors
  // to a terminal UNKNOWN (with the actionable detail surfaced) before the shared
  // rate_limit pattern can sweep them into the retry loop.
  if (provider === "claude-code" && isClaudeExtraUsageRequired(combined)) {
    return buildUnknownClassification(provider, combined);
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

  return buildUnknownClassification(provider, combined);
}

export function isTransientCodexTransportError(result: CommandResult): boolean {
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return text.includes("stream disconnected before completion") || text.includes("error sending request for url") || text.includes("channel closed");
}

export function isClaudeConversationNotFoundError(result: CommandResult): boolean {
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return text.includes("no conversation found");
}
