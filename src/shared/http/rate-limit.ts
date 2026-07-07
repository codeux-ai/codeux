import type { Request, Response } from "express";
import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";

interface HttpRateLimiterOptions {
  windowMs?: number;
  max?: number;
  jsonRpc?: boolean;
  onLimited?: (req: Request) => void;
}

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
export function createHttpRateLimiter(options: HttpRateLimiterOptions = {}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs ?? 60_000, // 1 minute
    max: options.max ?? 2_000, // ~33 req/s sustained per client before 429
    standardHeaders: true,
    legacyHeaders: false,
    handler: options.jsonRpc
      ? (req: Request, res: Response) => {
          options.onLimited?.(req);
          res.status(429).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Too many requests",
            },
            id: null,
          });
        }
      : undefined,
  });
}
