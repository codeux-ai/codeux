import type { SprintPreviewSession } from "../../types.js";

/**
 * Normalizes a URL path to ensure it starts with a slash and drops the domain name if an absolute URL is provided.
 */
export const normalizePath = (value: string | null | undefined): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "/";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return `${url.pathname || "/"}${url.search}${url.hash}` || "/";
    } catch {
      return "/";
    }
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
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
