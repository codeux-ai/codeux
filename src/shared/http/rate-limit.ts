import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";

/**
 * Builds a generous fixed-window rate limiter for first-party HTTP surfaces.
 *
 * Code UX is a local-first tool, so the intent here is abuse / runaway-loop and
 * brute-force protection — and closing the CodeQL `js/missing-rate-limiting`
 * findings on the file-serving dashboard handler and the network-exposed MCP
 * HTTPS gateway — not throttling normal interactive use. Limits are therefore
 * deliberately high; a single dashboard page load or a busy worker host stays
 * comfortably under them, while a flood is capped.
 */
export function createHttpRateLimiter(options: { windowMs?: number; max?: number } = {}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs ?? 60_000, // 1 minute
    max: options.max ?? 2_000, // ~33 req/s sustained per client before 429
    standardHeaders: true,
    legacyHeaders: false,
  });
}
