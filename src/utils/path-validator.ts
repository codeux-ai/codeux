import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

export function validateSafeRepoName(name: string): void {
  if (!name || name.trim() === '') throw new Error("Repository name cannot be empty");
  if (name.includes('/') || name.includes('\\')) throw new Error("Repository name cannot contain path separators");
  if (name.includes('..')) throw new Error("Repository name cannot contain path traversal characters");
  if (/[\x00-\x1F]/.test(name)) throw new Error("Repository name cannot contain control characters");
  // Check if it's only metacharacters (anything not letter, number)
  if (/^[^a-zA-Z0-9_-]+$/.test(name)) throw new Error("Repository name cannot consist solely of metacharacters");

  // Safe characters for github/gitlab: alphanumeric, dash, underscore, dot.
  // Must not start with a hyphen to avoid Git command-line option injection.
  if (!/^[a-zA-Z0-9_.][-a-zA-Z0-9_.]*$/.test(name)) throw new Error("Repository name contains invalid characters or starts with a hyphen");
  if (name === '.' || name === '..') throw new Error("Invalid repository name");
}

export function validateSafeClonePath(requestedDir: string, allowedRoot?: string): string {
  const resolved = path.resolve(requestedDir);
  const parsed = path.parse(resolved);

  if (resolved === parsed.root) {
    throw new Error(`Cannot initialize repository in filesystem root: ${resolved}`);
  }
  if (resolved === os.homedir()) {
    throw new Error(`Cannot initialize repository in home directory: ${resolved}`);
  }
  if (allowedRoot) {
    const rootResolved = path.resolve(allowedRoot);
    const relative = path.relative(rootResolved, resolved);
    // If the path is outside the allowed root, relative will start with '..' or be absolute.
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Cannot initialize repository outside of allowed root: ${resolved}`);
    }
  }
  return resolved;
}

/**
 * Validates that a string is safe to use as a single path segment (e.g. a
 * directory name derived from a user-supplied identifier). Rejects path
 * separators, traversal sequences, control characters, leading hyphens (to
 * avoid being parsed as a CLI option), and anything outside a conservative
 * filesystem-safe character set. Returns the segment unchanged on success.
 *
 * Use this before joining attacker-influenced identifiers into a filesystem
 * path, so the resulting path cannot escape its intended parent directory.
 */
export function assertSafePathSegment(segment: string, label = "identifier"): string {
  if (!segment || segment.trim() === "") throw new Error(`${label} cannot be empty`);
  if (segment.includes("/") || segment.includes("\\")) throw new Error(`${label} cannot contain path separators`);
  if (segment.includes("..")) throw new Error(`${label} cannot contain path traversal sequences`);
  if (/[\x00-\x1F]/.test(segment)) throw new Error(`${label} cannot contain control characters`);
  if (segment === "." || segment === "..") throw new Error(`Invalid ${label}`);
  if (segment.startsWith("-")) throw new Error(`${label} cannot start with a hyphen`);
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) throw new Error(`${label} contains invalid characters`);
  return segment;
}

export function validateNonEmptyDir(targetPath: string): void {
  // Normalize to an absolute path before any filesystem access so the checks
  // operate on a single canonical location (and so untrusted relative inputs
  // can't be interpreted against an unexpected cwd).
  const resolved = path.resolve(targetPath);
  if (fs.existsSync(resolved)) {
    const stats = fs.statSync(resolved);
    if (stats.isDirectory()) {
      const files = fs.readdirSync(resolved);
      if (files.length > 0) {
        throw new Error(`Target directory already exists and is not empty: ${resolved}`);
      }
    } else {
      throw new Error(`Target path exists and is not a directory: ${resolved}`);
    }
  }
}
