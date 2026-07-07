import type { SprintPreviewPortMapping, SprintPreviewSession } from "../../types.js";

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

export const getPreviewPortMappings = (
  session: Pick<SprintPreviewSession, "containerAppPort" | "hostPort" | "portMappings"> | null | undefined,
): SprintPreviewPortMapping[] => {
  if (session && Array.isArray(session.portMappings) && session.portMappings.length > 0) {
    return session.portMappings;
  }
  if (!session) {
    return [];
  }
  return [{
    containerPort: session.containerAppPort,
    hostPort: session.hostPort,
    isPrimary: true,
  }];
};

export const getPrimaryPreviewPortMapping = (
  session: Pick<SprintPreviewSession, "containerAppPort" | "hostPort" | "portMappings"> | null | undefined,
): SprintPreviewPortMapping | null => {
  const mappings = getPreviewPortMappings(session);
  return mappings.find((mapping) => mapping.isPrimary === true) ?? mappings[0] ?? null;
};

export const buildPreviewPath = (
  path: string | null | undefined,
  selectedContainerPort?: number | null,
): string => {
  const normalizedPath = normalizePath(path);
  if (!selectedContainerPort) {
    return normalizedPath;
  }
  const url = new URL(normalizedPath, "http://preview.local");
  url.searchParams.set("containerPort", String(selectedContainerPort));
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
};

/**
 * Helper to fully assemble a preview URL for an iframe.
 */
export const buildPreviewUrl = (
  sessionId: string,
  path: string | null | undefined,
  selectedContainerPort?: number | null,
): string => {
  return `${buildPreviewOrigin(sessionId)}${buildPreviewPath(path, selectedContainerPort)}`;
};

export const formatPreviewPortTabLabel = (mapping: SprintPreviewPortMapping): string => {
  const portLabel = `:${mapping.containerPort}`;
  const label = mapping.label?.trim();
  return label ? `${label} ${portLabel}` : portLabel;
};

export const formatPreviewPortMapping = (mapping: SprintPreviewPortMapping): string => {
  const target = mapping.hostPort ? `:${mapping.hostPort}` : "pending";
  return `${formatPreviewPortTabLabel(mapping)} -> ${target}`;
};

export const formatPreviewPortMappingsSummary = (
  session: Pick<SprintPreviewSession, "containerAppPort" | "hostPort" | "portMappings">,
): string => {
  const mappings = getPreviewPortMappings(session);
  if (mappings.length === 0) {
    return "port pending";
  }
  if (mappings.length === 1) {
    return formatPreviewPortMapping(mappings[0]!);
  }
  return mappings.map(formatPreviewPortMapping).join(" · ");
};
