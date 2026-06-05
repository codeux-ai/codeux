const RUNTIME_DATA_PATH_PREFIX = "/api/";
const RUNTIME_DATA_PATHS = new Set(["/health", "/ready"]);

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
