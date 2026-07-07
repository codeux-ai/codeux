import type { DocsWebEntry } from "../../../../src/contracts/docs-web-types.js";

function splitHref(href: string): { path: string; suffix: string } {
  const hashIndex = href.indexOf("#");
  const queryIndex = href.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  const splitIndex = indexes.length > 0 ? Math.min(...indexes) : -1;
  if (splitIndex === -1) {
    return { path: href, suffix: "" };
  }
  return {
    path: href.slice(0, splitIndex),
    suffix: href.slice(splitIndex),
  };
}

function normalizeRelativePath(currentSourcePath: string, hrefPath: string): string {
  const currentSegments = currentSourcePath.split("/");
  currentSegments.pop();
  for (const segment of hrefPath.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      currentSegments.pop();
      continue;
    }
    currentSegments.push(segment);
  }
  return currentSegments.join("/");
}

export function resolveDocsWebHref(
  href: string,
  currentSourcePath: string,
  docs: DocsWebEntry[],
): string {
  const trimmed = href.trim();
  if (
    !trimmed
    || trimmed.startsWith("#")
    || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    || trimmed.startsWith("/")
  ) {
    return trimmed;
  }

  const { path, suffix } = splitHref(trimmed);
  if (!path.endsWith(".md")) {
    return trimmed;
  }

  const normalizedPath = normalizeRelativePath(currentSourcePath, path);
  const target = docs.find((doc) => doc.sourcePath === normalizedPath);
  return target ? `${target.path}${suffix}` : trimmed;
}
