export type SafeUrlKind = "link" | "image";

interface SafeUrlOptions {
  kind?: SafeUrlKind;
}

const CONTROL_CHARACTERS = /[\x00-\x1F\x7F-\x9F]/g;
const HTML_ENTITY_PATTERN = /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]+));?/g;
const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  colon: ":",
  gt: ">",
  lt: "<",
  quot: "\"",
  apos: "'",
};

const decodeHtmlEntities = (value: string): string => {
  return value.replace(HTML_ENTITY_PATTERN, (match, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
    if (decimal) {
      const codePoint = Number.parseInt(decimal, 10);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      } catch {
        return match;
      }
    }

    if (hex) {
      const codePoint = Number.parseInt(hex, 16);
      try {
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      } catch {
        return match;
      }
    }

    return named ? NAMED_HTML_ENTITIES[named.toLowerCase()] ?? match : match;
  });
};

const firstPathDelimiterIndex = (value: string): number => {
  const indexes = [value.indexOf("/"), value.indexOf("#"), value.indexOf("?")].filter((index) => index !== -1);
  return indexes.length > 0 ? Math.min(...indexes) : -1;
};

const hasSchemeBeforePathDelimiter = (value: string): boolean => {
  const colonIndex = value.indexOf(":");
  if (colonIndex === -1) return false;

  const delimiterIndex = firstPathDelimiterIndex(value);
  return delimiterIndex === -1 || colonIndex < delimiterIndex;
};

const normalizeUrlForValidation = (url: string): string | undefined => {
  const normalized = decodeHtmlEntities(url).replace(CONTROL_CHARACTERS, "").trim();
  if (!normalized) return undefined;
  return normalized;
};

export const getSafeUrl = (url: string | null | undefined, options: SafeUrlOptions = {}): string | undefined => {
  if (!url) return undefined;

  const trimmed = normalizeUrlForValidation(url);
  if (!trimmed) return undefined;

  if (trimmed.startsWith("//") || trimmed.startsWith("\\") || trimmed.startsWith("/\\")) {
    return undefined;
  }

  if (/\s/.test(trimmed)) {
    return undefined;
  }

  const kind = options.kind ?? "link";
  const allowedProtocols = kind === "image" ? new Set(["http:", "https:"]) : new Set(["http:", "https:", "mailto:"]);

  if (!hasSchemeBeforePathDelimiter(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    return allowedProtocols.has(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
};
