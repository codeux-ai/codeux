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

export const buildPreviewOrigin = (sessionId: string, currentHost: string | null = null): string => {
  const isLocalHost = !currentHost || currentHost === "localhost" || currentHost === "127.0.0.1";
  const host = isLocalHost
    ? `preview-${sessionId}.localhost`
    : `preview-${sessionId}.${currentHost}`;

  const protocol = isLocalHost ? "http:" : "https:";
  return `${protocol}//${host}`;
};

export const buildPreviewUrl = (sessionId: string, path: string | null | undefined, currentHost: string | null = null): string => {
  return `${buildPreviewOrigin(sessionId, currentHost)}${normalizePath(path)}`;
};
