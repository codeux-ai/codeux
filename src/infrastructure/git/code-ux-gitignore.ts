import * as fs from "node:fs/promises";
import * as path from "node:path";

export const CODE_UX_REPO_DIR = ".code-ux";
export const CODE_UX_GITIGNORE_ENTRY = `${CODE_UX_REPO_DIR}/`;
export const CODE_UX_GIT_PATHSPEC_EXCLUDE = `:(exclude)${CODE_UX_REPO_DIR}`;

export async function ensureCodeUxGitignoreEntry(repoPath: string): Promise<boolean> {
  const gitignorePath = path.join(repoPath, ".gitignore");
  let current = "";
  try {
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
  await fs.appendFile(gitignorePath, `${prefix}${CODE_UX_GITIGNORE_ENTRY}\n`, "utf8");
  return true;
}
