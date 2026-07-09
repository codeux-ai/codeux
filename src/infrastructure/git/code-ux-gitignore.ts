import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isPathInside } from "../../utils/path-validator.js";

export const CODE_UX_REPO_DIR = ".code-ux";
export const CODE_UX_GITIGNORE_ENTRY = `${CODE_UX_REPO_DIR}/`;
export const CODE_UX_GIT_PATHSPEC_EXCLUDE = `:(exclude)${CODE_UX_REPO_DIR}`;

async function resolveRepoGitignorePath(repoPath: string): Promise<string> {
  // repoPath is canonicalized before deriving the fixed .gitignore child path.
  // codeql[js/path-injection]
  const repoRoot = await fs.realpath(path.resolve(repoPath));
  const gitignorePath = path.resolve(repoRoot, ".gitignore");
  if (!isPathInside(repoRoot, gitignorePath)) {
    throw new Error(".gitignore path must stay inside the repository.");
  }
  // gitignorePath is fixed to the .gitignore child of repoRoot above.
  // codeql[js/path-injection]
  const existingAncestor = await fs.realpath(path.dirname(gitignorePath));
  let canonicalGitignorePath: string;
  try {
    // If .gitignore already exists, follow symlinks and keep only targets that
    // still resolve inside the canonical repository root.
    // codeql[js/path-injection]
    canonicalGitignorePath = await fs.realpath(gitignorePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    canonicalGitignorePath = path.join(existingAncestor, path.basename(gitignorePath));
  }
  if (!isPathInside(repoRoot, canonicalGitignorePath)) {
    throw new Error(".gitignore path must stay inside the repository.");
  }
  return canonicalGitignorePath;
}

export async function ensureCodeUxGitignoreEntry(repoPath: string): Promise<boolean> {
  const gitignorePath = await resolveRepoGitignorePath(repoPath);
  let current = "";
  try {
    // gitignorePath is canonicalized against the repository root immediately
    // before this read.
    // codeql[js/path-injection]
    current = await fs.readFile(gitignorePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const entries = current
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (entries.includes(CODE_UX_GITIGNORE_ENTRY) || entries.includes(CODE_UX_REPO_DIR)) {
    return false;
  }

  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  // gitignorePath is canonicalized against the repository root immediately
  // before this write.
  // codeql[js/path-injection]
  await fs.appendFile(gitignorePath, `${prefix}${CODE_UX_GITIGNORE_ENTRY}\n`, "utf8");
  return true;
}
