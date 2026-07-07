const RUNTIME_DATA_PATH_PREFIX = "/api/";
const RUNTIME_DATA_PATHS = new Set(["/health", "/ready"]);
const SAFE_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const PREVIEW_HOST_PATTERN = /^preview-([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.localhost$/i;

export type NavigationDecision = "allow-internal" | "open-external" | "deny";

export function isDashboardRuntimeDataUrl(rawUrl: string, dashboardOrigin: string | null): boolean {
  if (!dashboardOrigin) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    const dashboardUrl = new URL(dashboardOrigin);
    const isDashboardHost = url.hostname === dashboardUrl.hostname
      || (dashboardUrl.hostname === "127.0.0.1" && url.hostname === "localhost");
    const isDashboardPort = url.protocol === dashboardUrl.protocol && url.port === dashboardUrl.port;
    const isRuntimePath = url.pathname.startsWith(RUNTIME_DATA_PATH_PREFIX)
      || RUNTIME_DATA_PATHS.has(url.pathname);
    return isDashboardHost && isDashboardPort && isRuntimePath;
  } catch {
    return false;
  }
}

export function shouldAddRuntimeNoCacheRequestHeaders(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === "GET" || normalized === "HEAD";
}

export function isSafeInternalUrl(rawUrl: string, dashboardOrigin: string | null): boolean {
  if (!dashboardOrigin) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    const dashboardUrl = new URL(dashboardOrigin);
    if (url.origin === dashboardUrl.origin) {
      return true;
    }
    return url.protocol === "http:"
      && url.port === dashboardUrl.port
      && PREVIEW_HOST_PATTERN.test(url.hostname);
  } catch {
    return false;
  }
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

export function classifyNavigationTarget(rawUrl: string, dashboardOrigin: string | null): NavigationDecision {
  if (isSafeInternalUrl(rawUrl, dashboardOrigin)) {
    return "allow-internal";
  }
  return isSafeExternalUrl(rawUrl) ? "open-external" : "deny";
}

export function shouldAllowPermissionRequest(
  rawRequestingUrl: string,
  dashboardOrigin: string | null,
  _permission: string,
): boolean {
  if (!isSafeInternalUrl(rawRequestingUrl, dashboardOrigin)) {
    return false;
  }

  return false;
}

export function resolveDirectoryPickerDefaultPath(
  defaultPath: unknown,
  homeDirectory: string,
  resolvePath: (basePath: string, relativePath: string) => string,
  isAbsolutePath: (candidatePath: string) => boolean,
): string {
  if (defaultPath === undefined || defaultPath === null) {
    return homeDirectory;
  }
  if (typeof defaultPath !== "string") {
    throw new TypeError("Directory picker default path must be a string when provided.");
  }
  if (CONTROL_CHARACTER_PATTERN.test(defaultPath)) {
    throw new TypeError("Directory picker default path cannot contain control characters.");
  }

  const trimmedDefaultPath = defaultPath.trim();
  if (!trimmedDefaultPath) {
    return homeDirectory;
  }
  return isAbsolutePath(trimmedDefaultPath)
    ? trimmedDefaultPath
    : resolvePath(homeDirectory, trimmedDefaultPath);
}

export function normalizeZoomFactor(factor: unknown): number {
  if (typeof factor !== "number" || !Number.isFinite(factor)) {
    throw new TypeError("Zoom factor must be a finite number.");
  }
  return Math.min(2.5, Math.max(0.5, factor));
}
