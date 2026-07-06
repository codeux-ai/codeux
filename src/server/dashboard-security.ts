import type { Request, Response } from "express";
import { PREVIEW_HOST_PREFIX } from "./preview-host-utils.js";

type HeaderValue = string | string[] | undefined;

type CanonicalHost = {
  host: string;
  hostname: string;
  boundary: "dashboard" | "preview";
};

type ParsedHost = Pick<CanonicalHost, "host" | "hostname">;

const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
const HOST_FORBIDDEN_CHAR_PATTERN = /[/?#\\]/;
const LOCAL_DASHBOARD_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function readSingleHeaderValue(headerValue: HeaderValue): string | null {
  if (typeof headerValue !== "string") {
    return null;
  }
  const value = headerValue.trim();
  if (!value || CONTROL_CHAR_PATTERN.test(value) || value.includes(",")) {
    return null;
  }
  return value;
}

function parseHostSyntax(headerValue: HeaderValue): ParsedHost | null {
  const value = readSingleHeaderValue(headerValue);
  if (!value || value.includes("@") || HOST_FORBIDDEN_CHAR_PATTERN.test(value)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(`http://${value}/`);
  } catch {
    return null;
  }

  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const host = url.host.toLowerCase();
  if (!hostname || !host) {
    return null;
  }

  return { host, hostname };
}

function parseCanonicalHost(headerValue: HeaderValue): CanonicalHost | null {
  const parsed = parseHostSyntax(headerValue);
  if (!parsed) {
    return null;
  }

  if (LOCAL_DASHBOARD_HOSTS.has(parsed.hostname) || isConfiguredDashboardHostname(parsed.hostname)) {
    return { ...parsed, boundary: "dashboard" };
  }

  if (isLocalPreviewHostname(parsed.hostname)) {
    return { ...parsed, boundary: "preview" };
  }

  return null;
}

function parseCanonicalUrlHost(headerValue: HeaderValue): CanonicalHost | null {
  const value = readSingleHeaderValue(headerValue);
  if (!value) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    return null;
  }

  return parseCanonicalHost(url.host);
}

function isConfiguredDashboardHostname(hostname: string): boolean {
  const configuredHost = parseConfiguredDashboardHost();
  return configuredHost !== null && hostname === configuredHost.hostname;
}

function parseConfiguredDashboardHost(): CanonicalHost | null {
  const configuredHost = process.env.DASHBOARD_HOST?.trim();
  if (!configuredHost) {
    return null;
  }
  const parsed = parseRawConfiguredHost(configuredHost);
  if (!parsed || parsed.boundary !== "dashboard") {
    return null;
  }
  return parsed;
}

function parseRawConfiguredHost(configuredHost: string): CanonicalHost | null {
  const parsed = configuredHost.includes("://")
    ? parseConfiguredUrlHost(configuredHost)
    : parseHostSyntax(configuredHost);
  if (!parsed || isLocalPreviewHostname(parsed.hostname)) {
    return null;
  }
  return { ...parsed, boundary: "dashboard" };
}

function parseConfiguredUrlHost(configuredHost: string): ParsedHost | null {
  if (CONTROL_CHAR_PATTERN.test(configuredHost) || configuredHost.includes(",")) {
    return null;
  }
  try {
    const url = new URL(configuredHost);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return parseHostSyntax(url.host);
  } catch {
    return null;
  }
}

function isLocalPreviewHostname(hostname: string): boolean {
  if (!hostname.endsWith(".localhost") || !hostname.startsWith(PREVIEW_HOST_PREFIX)) {
    return false;
  }
  const firstSegment = hostname.slice(0, hostname.indexOf("."));
  const sessionId = firstSegment.slice(PREVIEW_HOST_PREFIX.length);
  return /^[a-z0-9][a-z0-9-]*$/i.test(sessionId);
}

function getAllowedRequestHosts(req: Request): CanonicalHost[] | null {
  const actualHost = parseCanonicalHost(req.headers.host);
  if (!actualHost) {
    return null;
  }

  const forwardedHostHeader = req.headers["x-forwarded-host"];
  if (forwardedHostHeader === undefined) {
    return [actualHost];
  }

  const forwardedHost = parseCanonicalHost(forwardedHostHeader);
  if (!forwardedHost || forwardedHost.boundary !== actualHost.boundary) {
    return null;
  }

  return [actualHost, forwardedHost];
}

/**
 * Validates if the given host header is considered a trusted local dashboard boundary.
 */
export function isTrustedDashboardHost(hostHeader: HeaderValue, forwardedHostHeader?: HeaderValue): boolean {
  const actualHost = parseCanonicalHost(hostHeader);
  if (!actualHost) {
    return false;
  }

  if (forwardedHostHeader === undefined) {
    return true;
  }

  const forwardedHost = parseCanonicalHost(forwardedHostHeader);
  return forwardedHost !== null && forwardedHost.boundary === actualHost.boundary;
}

export function isTrustedDashboardPreviewHost(hostHeader: HeaderValue): boolean {
  return parseCanonicalHost(hostHeader)?.boundary === "preview";
}

/**
 * Validates whether the incoming browser request is from a hostile cross-site origin.
 * Runtime data routes only accept browser origins that match the trusted request boundary.
 */
export function isHostileBrowserOrigin(req: Request): boolean {
  if (!req.path.startsWith("/api/") && req.path !== "/health" && req.path !== "/ready") {
    return false;
  }

  // Allow non-browser agents (CLI, cURL, etc) which don't send Sec-Fetch-Site, Origin, or Referer
  const secFetchSite = req.headers["sec-fetch-site"];
  const origin = req.headers.origin;
  const referer = req.headers.referer;

  if (!secFetchSite && !origin && !referer) {
    return false;
  }

  // Sec-Fetch-Site is the most modern and reliable check
  if (secFetchSite === "cross-site") {
    return true;
  }

  // If Sec-Fetch-Site is not cross-site (or missing), check Origin and Referer
  const requestHosts = getAllowedRequestHosts(req);
  if (!requestHosts) {
    return true;
  }

  if (origin) {
    const originHost = parseCanonicalUrlHost(origin);
    if (!originHost || !requestHosts.some((requestHost) => requestHost.host === originHost.host)) {
      return true;
    }
  }

  if (referer) {
    const refererHost = parseCanonicalUrlHost(referer);
    return !refererHost || !requestHosts.some((requestHost) => requestHost.host === refererHost.host);
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
