import * as fs from "node:fs/promises";
import * as path from "node:path";

async function resolveCommonGitDirectory(repoPath: string): Promise<string | null> {
  const dotGitPath = path.join(repoPath, ".git");
  try {
    const stat = await fs.stat(dotGitPath);
    if (stat.isDirectory()) {
      return dotGitPath;
    }
    if (!stat.isFile()) {
      return null;
    }
    const match = /^gitdir:\s*(.+)$/i.exec((await fs.readFile(dotGitPath, "utf8")).trim());
    if (!match) {
      return null;
    }
    const gitDirectory = path.resolve(repoPath, match[1]);
    try {
      const commonDir = (await fs.readFile(path.join(gitDirectory, "commondir"), "utf8")).trim();
      return commonDir ? path.resolve(gitDirectory, commonDir) : gitDirectory;
    } catch {
      return gitDirectory;
    }
  } catch {
    return null;
  }
}

/** Creates transient Git files inside the persistent project helper's existing bind mount. */
export async function createRepositoryGitTempDirectory(
  repoPath: string,
  prefix: string,
): Promise<string | null> {
  const commonGitDirectory = await resolveCommonGitDirectory(repoPath);
  if (!commonGitDirectory) {
    return null;
  }
  const root = path.join(commonGitDirectory, "code-ux-runtime");
  await fs.mkdir(root, { recursive: true });
  return await fs.mkdtemp(path.join(root, prefix));
}
