import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

declare const validatedPathBrand: unique symbol;

export type ValidatedPath = string & { readonly [validatedPathBrand]: true };

function asValidatedPath(candidate: string): ValidatedPath {
  return candidate as ValidatedPath;
}

export function isPathInside(basePath: string, targetPath: string): boolean {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);
  const relative = path.relative(base, target);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateSafeRepoName(name: string): string {
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
  return name;
}

export function validateSafeClonePath(requestedDir: string, allowedRoot?: string): ValidatedPath {
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
    if (!isPathInside(rootResolved, resolved)) {
      throw new Error(`Cannot initialize repository outside of allowed root: ${resolved}`);
    }
  }
  return asValidatedPath(resolved);
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
  // This function is a guard for path segments; these checks reject traversal
  // before callers join the value into any filesystem path.
  // codeql[js/path-injection]
  if (segment.includes("/") || segment.includes("\\")) throw new Error(`${label} cannot contain path separators`);
  // codeql[js/path-injection]
  if (segment.includes("..")) throw new Error(`${label} cannot contain path traversal sequences`);
  if (/[\x00-\x1F]/.test(segment)) throw new Error(`${label} cannot contain control characters`);
  // codeql[js/path-injection]
  if (segment === "." || segment === "..") throw new Error(`Invalid ${label}`);
  if (segment.startsWith("-")) throw new Error(`${label} cannot start with a hyphen`);
  if (!/^[A-Za-z0-9._-]+$/.test(segment)) throw new Error(`${label} contains invalid characters`);
  return segment;
}

/**
 * Confirms `targetPath` either doesn't exist yet or is an empty directory.
 * When `allowedRoot` is given, also verifies (inline, right before the
 * filesystem calls below) that the resolved path is contained within it —
 * this mirrors {@link validateSafeClonePath}'s containment check so a caller
 * that passes an unvalidated `targetPath` still can't probe or touch
 * directories outside the intended root through this function.
 *
 * Returns the resolved path so callers use the exact value that was checked.
 */
export function validateNonEmptyDir(targetPath: string, allowedRoot?: string): ValidatedPath {
  // Normalize to an absolute path before any filesystem access so the checks
  // operate on a single canonical location (and so untrusted relative inputs
  // can't be interpreted against an unexpected cwd).
  const resolved = path.resolve(targetPath);

  if (allowedRoot) {
    const rootResolved = path.resolve(allowedRoot);
    if (!isPathInside(rootResolved, resolved)) {
      throw new Error(`Cannot inspect directory outside of allowed root: ${resolved}`);
    }
  }

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
  return asValidatedPath(resolved);
}

export function validateExistingPathInside(basePath: string, targetPath: string): ValidatedPath {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(resolvedBase, targetPath);
  if (!isPathInside(resolvedBase, resolvedTarget)) {
    throw new Error("Path must be inside the project directory.");
  }

  const realBase = fs.existsSync(resolvedBase) ? fs.realpathSync(resolvedBase) : resolvedBase;
  if (!fs.existsSync(resolvedTarget)) {
    throw new Error("Path not found");
  }
  // resolvedTarget passed lexical containment against resolvedBase, and the
  // resulting realTarget is checked against realBase before being returned.
  // codeql[js/path-injection]
  const realTarget = fs.realpathSync(resolvedTarget);
  if (!isPathInside(realBase, realTarget)) {
    throw new Error("Path must be inside the project directory.");
  }

  return asValidatedPath(realTarget);
}
