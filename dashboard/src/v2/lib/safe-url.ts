export const getSafeUrl = (url: string | null | undefined): string | undefined => {
  if (!url) return undefined;

  const trimmed = url.trim();
  if (!trimmed) return undefined;

  // Allow relative or absolute internal paths
  if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("?")) {
    return trimmed;
  }

  // Allow safe absolute URLs
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
    return undefined; // Block javascript:, data:, vbscript:, etc.
  } catch {
    return undefined; // Invalid URL
  }
};
