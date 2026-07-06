import * as pathPosix from "path/posix";

export const MAX_TREE_ENTRIES = 20_000;
export const MAX_FILE_BYTES = 2_000_000;
export const PRUNED_DIRECTORIES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  ".turbo",
  ".cache",
  ".vite",
  ".svelte-kit",
  "vendor",
];

export function isPrunedPath(relPath: string): boolean {
  return PRUNED_DIRECTORIES.some(pruned => relPath === pruned || relPath.startsWith(pruned + "/"));
}

export function normalizeAndValidatePath(requestedPath: string): string {
  const trimmed = (requestedPath || "").trim();

  if (!trimmed) {
    throw new Error(`Invalid file path: path cannot be empty`);
  }

  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    throw new Error(`Invalid file path: control characters are not allowed`);
  }

  const decoded = decodeRepeatedly(trimmed);
  const slashNormalized = decoded.replace(/\\/g, "/");

  if (/[\x00-\x1F\x7F]/.test(decoded)) {
    throw new Error(`Invalid file path: control characters are not allowed`);
  }

  if (/^[a-zA-Z]:/.test(decoded) || slashNormalized.startsWith("/") || slashNormalized.startsWith("//")) {
    throw new Error(`Invalid file path: absolute paths are not allowed`);
  }

  const decodedParts = slashNormalized.split("/");
  if (decodedParts.includes("..")) {
    throw new Error(`Invalid file path: encoded traversal is not allowed`);
  }

  const withoutLeading = slashNormalized.replace(/^\.\//, "");
  const normalized = pathPosix.normalize(withoutLeading);

  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("../")) {
    throw new Error(`Invalid file path: ${requestedPath}`);
  }

  if (normalized === ".git" || normalized.startsWith(".git/")) {
    throw new Error(`Invalid file path: .git internals are not allowed`);
  }

  return normalized;
}

function decodeRepeatedly(value: string): string {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    const decoded = decodeURIComponent(current);
    if (decoded === current) {
      return decoded;
    }
    current = decoded;
  }
  return current;
}
