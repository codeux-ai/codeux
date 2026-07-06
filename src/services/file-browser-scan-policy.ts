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
  const trimmed = (requestedPath || "").trim().replace(/\\/g, "/");

  if (!trimmed) {
    throw new Error(`Invalid file path: path cannot be empty`);
  }

  const decoded = decodeURIComponent(trimmed);
  if (decoded.includes("../") || decoded.includes("..\\") || decoded === "..") {
    throw new Error(`Invalid file path: encoded traversal is not allowed`);
  }

  if (/^[a-zA-Z]:[\\\/]/.test(trimmed) || trimmed.startsWith("/")) {
    throw new Error(`Invalid file path: absolute paths are not allowed`);
  }

  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    throw new Error(`Invalid file path: control characters are not allowed`);
  }

  const withoutLeading = trimmed.replace(/^\.\//, "").replace(/^\/+/, "");
  const normalized = pathPosix.normalize(withoutLeading);

  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("../")) {
    throw new Error(`Invalid file path: ${requestedPath}`);
  }

  if (normalized === ".git" || normalized.startsWith(".git/")) {
    throw new Error(`Invalid file path: .git internals are not allowed`);
  }

  return normalized;
}
