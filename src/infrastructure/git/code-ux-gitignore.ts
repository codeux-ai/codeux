import * as fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { isPathInside, type ValidatedPath } from "../../utils/path-validator.js";

export const CODE_UX_REPO_DIR = ".code-ux";
export const CODE_UX_GITIGNORE_ENTRY = `${CODE_UX_REPO_DIR}/`;
export const CODE_UX_GIT_PATHSPEC_EXCLUDE = `:(exclude)${CODE_UX_REPO_DIR}`;

const NOFOLLOW_FLAG = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;

function resolveRepoGitignoreFile(repoPath: ValidatedPath): URL {
  const repoRoot = path.resolve(repoPath);
  const gitignorePath = path.resolve(repoRoot, ".gitignore");
  if (!isPathInside(repoRoot, gitignorePath)) {
    throw new Error(".gitignore path must stay inside the repository.");
  }
  const repoRootForUrl = repoRoot.endsWith(path.sep) ? repoRoot : `${repoRoot}${path.sep}`;
  return new URL(".gitignore", pathToFileURL(repoRootForUrl));
}

function rethrowUnsafeGitignore(error: unknown): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ELOOP") {
    throw new Error(".gitignore path must stay inside the repository.");
  }
  throw error;
}

async function readRepoGitignore(gitignoreFile: URL): Promise<string> {
  try {
    const handle = await fs.open(gitignoreFile, fsConstants.O_RDONLY | NOFOLLOW_FLAG);
    try {
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return "";
    }
    rethrowUnsafeGitignore(error);
  }
}

export async function ensureCodeUxGitignoreEntry(repoPath: ValidatedPath): Promise<boolean> {
  const gitignoreFile = resolveRepoGitignoreFile(repoPath);
  const current = await readRepoGitignore(gitignoreFile);

  const entries = current
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (entries.includes(CODE_UX_GITIGNORE_ENTRY) || entries.includes(CODE_UX_REPO_DIR)) {
    return false;
  }

  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  const handle = await fs.open(
    gitignoreFile,
    fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY | NOFOLLOW_FLAG,
    0o666,
  ).catch((error: unknown) => rethrowUnsafeGitignore(error));
  try {
    await handle.writeFile(`${prefix}${CODE_UX_GITIGNORE_ENTRY}\n`, "utf8");
  } finally {
    await handle.close();
  }
  return true;
}
