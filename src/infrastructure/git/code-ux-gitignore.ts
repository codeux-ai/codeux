import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isPathInside, type ValidatedPath } from "../../utils/path-validator.js";

export const CODE_UX_REPO_DIR = ".code-ux";
export const CODE_UX_GITIGNORE_ENTRY = `${CODE_UX_REPO_DIR}/`;
export const CODE_UX_GIT_PATHSPEC_EXCLUDE = `:(exclude)${CODE_UX_REPO_DIR}`;

async function resolveRepoGitignorePath(repoPath: ValidatedPath): Promise<string> {
  const repoRoot = path.resolve(repoPath);
  const gitignorePath = path.resolve(repoRoot, ".gitignore");
  if (!isPathInside(repoRoot, gitignorePath)) {
    throw new Error(".gitignore path must stay inside the repository.");
  }
  try {
    const stats = await fs.lstat(gitignorePath);
    if (stats.isSymbolicLink()) {
      throw new Error(".gitignore path must stay inside the repository.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return gitignorePath;
}

export async function ensureCodeUxGitignoreEntry(repoPath: ValidatedPath): Promise<boolean> {
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
