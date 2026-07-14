import type { SprintPreviewPortMapping, SprintPreviewSession } from "../../types.js";
import { browserPreviewMessages } from "../i18n/messages/browser-preview.js";
import {
  DEFAULT_DASHBOARD_LOCALE,
  translateDashboardMessage,
  type DashboardLocale,
} from "../i18n/locales.js";

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
    return session.portMappings.filter((mapping) => Number.isInteger(mapping.containerPort) && mapping.containerPort > 0 && mapping.containerPort <= 65_535);
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

export const formatPreviewPortMapping = (
  mapping: SprintPreviewPortMapping,
  locale: DashboardLocale = DEFAULT_DASHBOARD_LOCALE,
): string => {
  const target = mapping.hostPort && Number.isInteger(mapping.hostPort) && mapping.hostPort > 0 && mapping.hostPort <= 65_535
    ? `:${mapping.hostPort}`
    : translateDashboardMessage(browserPreviewMessages, locale, "pending");
  return `${formatPreviewPortTabLabel(mapping)} -> ${target}`;
};

export const formatPreviewPortMappingsSummary = (
  session: Pick<SprintPreviewSession, "containerAppPort" | "hostPort" | "portMappings">,
  locale: DashboardLocale = DEFAULT_DASHBOARD_LOCALE,
): string => {
  const mappings = getPreviewPortMappings(session).filter((mapping) => (
    Number.isInteger(mapping.containerPort) && mapping.containerPort > 0 && mapping.containerPort <= 65_535
  ));
  if (mappings.length === 0) {
    return translateDashboardMessage(browserPreviewMessages, locale, "portPending");
  }
  if (mappings.length === 1) {
    return formatPreviewPortMapping(mappings[0]!, locale);
  }
  return mappings.map((mapping) => formatPreviewPortMapping(mapping, locale)).join(" · ");
};
