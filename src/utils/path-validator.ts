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

export function validateNonEmptyDir(targetPath: string): void {
  if (fs.existsSync(targetPath)) {
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      const files = fs.readdirSync(targetPath);
      if (files.length > 0) {
        throw new Error(`Target directory already exists and is not empty: ${targetPath}`);
      }
    } else {
      throw new Error(`Target path exists and is not a directory: ${targetPath}`);
    }
  }
}
