import type { Request, Response } from "express";
import { parsePreviewSessionIdFromHost } from "./preview-host-utils.js";

/**
 * Validates if the given host header is considered a trusted local dashboard boundary.
 */
export function isTrustedDashboardHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) {
    return false;
  }

  const hostWithoutPort = hostHeader.startsWith("[::1]") ? "[::1]" : hostHeader.split(":")[0]?.toLowerCase();
  if (!hostWithoutPort) {
    return false;
  }

  if (hostWithoutPort === "localhost" || hostWithoutPort === "127.0.0.1" || hostWithoutPort === "[::1]") {
    return true;
  }

  const configuredHost = process.env.DASHBOARD_HOST?.trim().toLowerCase();
  if (configuredHost && hostWithoutPort === configuredHost) {
    return true;
  }

  const previewSessionId = parsePreviewSessionIdFromHost(hostHeader);
  if (previewSessionId !== null) {
    return true;
  }

  return false;
}

/**
 * Validates whether the incoming browser request is from a hostile cross-site origin.
 * We only block mutation requests to sensitive paths if the browser indicates a cross-site context.
 */
export function isHostileBrowserOrigin(req: Request): boolean {
  // Only protect mutations to APIs and health endpoints
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return false;
  }
  if (!req.path.startsWith("/api/") && req.path !== "/health" && req.path !== "/ready") {
    return false;
  }

  // Allow non-browser agents (CLI, cURL, etc) which don't send Sec-Fetch-Site, Origin, or Referer
  const secFetchSite = req.headers["sec-fetch-site"];
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // Sec-Fetch-Site is the most modern and reliable check
  if (secFetchSite === "cross-site") {
    return true;
  }

  // If Sec-Fetch-Site is not cross-site (or missing), check Origin and Referer
  const requestHost = req.headers.host;

  if (origin && requestHost) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== requestHost) {
        return true; // Hostile Origin
      }
    } catch {
      return true; // Malformed Origin is considered hostile
    }
  }

  if (referer && requestHost && !origin) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host !== requestHost) {
         return true; // Hostile Referer
      }
    } catch {
       return true; // Malformed Referer
    }
  }

  return false;
}

/**
 * Applies baseline browser hardening response headers.
 */
export function applyDashboardSecurityHeaders(res: Response): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}
