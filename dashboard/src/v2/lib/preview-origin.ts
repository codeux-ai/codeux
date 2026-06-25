import type { SprintPreviewSession } from "../../types.js";

/**
 * Normalizes a URL path to ensure it starts with a slash and drops the domain name if an absolute URL is provided.
 */
export const normalizePath = (value: string | null | undefined): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "/";
  try {
    // For absolute URLs provided with scheme, strip it by just parsing it
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      let p = parsed.pathname;
      if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
      p = p.replace(/\/+/g, "/"); // collapse redundant slashes
      return `${p}${parsed.search}${parsed.hash}` || "/";
    }

    const url = new URL(trimmed, "http://localhost");
    let p = url.pathname;
    // Collapse redundant slashes
    p = p.replace(/\/+/g, "/");
    if (p.length > 1 && p.endsWith("/")) {
      p = p.slice(0, -1);
    }
    return `${p}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
};

/**
 * Constructs the base origin for a preview session iframe depending on the current browser host.
 */
export const buildPreviewOrigin = (sessionId: string): string => {
  // If we're not running in a browser environment, return a fallback origin.
  if (typeof window === "undefined" || typeof window.location === "undefined") {
    return `http://preview-${sessionId}.localhost`;
  }

  const protocol = window.location.protocol;
  const port = window.location.port ? `:${window.location.port}` : "";
  const currentHost = window.location.hostname;
  const host = currentHost === "localhost" || currentHost === "127.0.0.1"
    ? `preview-${sessionId}.localhost`
    : `preview-${sessionId}.${currentHost}`;
  return `${protocol}//${host}${port}`;
};

/**
 * Helper to fully assemble a preview URL for an iframe.
 */
export const buildPreviewUrl = (sessionId: string, path: string | null | undefined): string => {
  return `${buildPreviewOrigin(sessionId)}${normalizePath(path)}`;
};
