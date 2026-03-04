import os from "os";
import * as path from "path";

/**
 * Returns a unique list of base directories to search in.
 * Precedence: Repo > CWD > Project > Home.
 *
 * @param projectRoot The root directory of the project.
 * @param repoPath An optional repository-specific path to search first.
 * @returns A unique list of base directories.
 */
export function buildSearchRoots(projectRoot: string, repoPath?: string): string[] {
  const roots: string[] = [];

  if (repoPath) {
    roots.push(path.resolve(repoPath));
  }

  roots.push(path.resolve(process.cwd()));
  roots.push(path.resolve(projectRoot));
  roots.push(path.resolve(os.homedir()));

  // Deduplicate while maintaining order
  return [...new Set(roots)];
}

/**
 * Combines search roots with a relative path to build candidate full paths.
 *
 * @param relativePath The path relative to the search roots.
 * @param projectRoot The root directory of the project.
 * @param repoPath An optional repository-specific path to search first.
 * @returns A unique list of candidate full paths.
 */
export function buildCandidatePaths(relativePath: string, projectRoot: string, repoPath?: string): string[] {
  const roots = buildSearchRoots(projectRoot, repoPath);
  const paths = roots.map((root) => path.resolve(path.join(root, relativePath)));

  // Deduplicate while maintaining order
  return [...new Set(paths)];
}
