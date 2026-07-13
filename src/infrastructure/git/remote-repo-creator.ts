import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "node:url";
import { runCommandStrict } from "../../services/cli-process-runner.js";
import {
  isPathInside,
  validateSafeRepoName,
  validateSafeClonePath,
  validateNonEmptyDir,
} from "../../utils/path-validator.js";
import type { ValidatedPath } from "../../utils/path-validator.js";
import { buildGitHttpAuthEnvWithFallbacks, resolveGitHostTokenWithFallbacks } from "../../services/git-http-auth.js";
import { redactText } from "../../shared/security/redaction.js";
import { ensureCodeUxGitignoreEntry } from "./code-ux-gitignore.js";

export interface RemoteRepoResult {
  localPath: string;
  remoteUrl: string;
}

const API_TIMEOUT_MS = 30_000;
const NOFOLLOW_FLAG = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;

const parseApiError = (fallback: string, text: string): string => {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const message = parsed.message;
    return typeof message === "string" && message.trim().length > 0 ? message : fallback;
  } catch {
    return text.trim() || fallback;
  }
};

function remoteOperationErrorMessage(error: unknown, hostToken?: string | null): string {
  const raw = error instanceof Error ? error.message : String(error);
  const exactRedacted = hostToken ? raw.split(hostToken).join("[REDACTED]") : raw;
  return redactText(exactRedacted);
}

const cloneRepository = async (remoteUrl: string, cloneParentDir: string, repoName: string, hostToken?: string): Promise<void> => {
  const safeRepoName = validateSafeRepoName(repoName);
  const safeParentDir = validateSafeClonePath(cloneParentDir);
  const targetDir = path.resolve(safeParentDir, safeRepoName);
  validateNonEmptyDir(targetDir, safeParentDir);

  await runCommandStrict(
    "git",
    ["clone", remoteUrl, safeRepoName],
    safeParentDir,
    (await buildGitHttpAuthEnvWithFallbacks(remoteUrl, {
      githubToken: hostToken,
      gitlabToken: hostToken,
    })) || process.env,
  );
};

function resolveSeedReadmeFile(localPath: ValidatedPath): URL {
  const repoRoot = path.resolve(localPath);
  const readmePath = path.resolve(repoRoot, "README.md");
  if (!isPathInside(repoRoot, readmePath)) {
    throw new Error("README path must stay inside the repository.");
  }
  const repoRootForUrl = repoRoot.endsWith(path.sep) ? repoRoot : `${repoRoot}${path.sep}`;
  return new URL("README.md", pathToFileURL(repoRootForUrl));
}

function writeSeedReadme(localPath: ValidatedPath, contents: string): void {
  const readmeFile = resolveSeedReadmeFile(localPath);
  let descriptor: number;
  try {
    // The repository root passed clone-parent containment checks, the filename
    // is fixed, and O_NOFOLLOW prevents a raced symlink from redirecting the
    // initialization write.
    // codeql[js/path-injection]
    descriptor = fs.openSync(
      readmeFile,
      fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_WRONLY | NOFOLLOW_FLAG,
      0o666,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error("README path must stay inside the repository.");
    }
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, contents, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

async function seedEmptyRemoteRepository(
  remoteUrl: string,
  localPath: ValidatedPath,
  projectName: string,
  defaultBranch: string,
  hostToken?: string,
): Promise<void> {
  writeSeedReadme(localPath, `# ${projectName.trim() || "Project"}\n\nInitialized with Code UX.\n`);
  await ensureCodeUxGitignoreEntry(localPath);
  const env = (await buildGitHttpAuthEnvWithFallbacks(remoteUrl, {
    githubToken: hostToken,
    gitlabToken: hostToken,
  })) || process.env;
  await runCommandStrict("git", ["config", "user.email", "code-ux@local"], localPath);
  await runCommandStrict("git", ["config", "user.name", "Code UX"], localPath);
  await runCommandStrict("git", ["checkout", "-B", defaultBranch], localPath);
  await runCommandStrict("git", ["add", "README.md", ".gitignore"], localPath);
  await runCommandStrict("git", ["commit", "-m", "Initial commit"], localPath);
  await runCommandStrict("git", ["push", "-u", "origin", "HEAD"], localPath, env);
}

/**
 * Creates a new GitHub repository and clones it locally through the shared
 * containerized Git runner.
 */
export async function createGitHubRepo(opts: {
  repoName: string;
  isPrivate: boolean;
  cloneParentDir: string;
  hostToken?: string;
}): Promise<RemoteRepoResult> {
  let hostToken: string | null = null;
  try {
    const safeRepoName = validateSafeRepoName(opts.repoName);
    // Operate on the sanitized, resolved parent directory returned by the
    // validator rather than the raw request-supplied path.
    const safeParentDir = validateSafeClonePath(opts.cloneParentDir);
    const targetDir = path.resolve(safeParentDir, safeRepoName);
    const safeTargetDir = validateNonEmptyDir(targetDir, safeParentDir);
    // Local-first repository creation intentionally creates the user-selected
    // directory after validateSafeClonePath/validateNonEmptyDir constrain it.
    // codeql[js/path-injection]
    fs.mkdirSync(safeParentDir, { recursive: true });

    hostToken = await resolveGitHostTokenWithFallbacks("github", opts.hostToken);
    if (!hostToken) {
      throw new Error("GitHub token is required to create a remote repository.");
    }

    const response = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hostToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      // Seed locally after cloning so README.md and the Code UX .gitignore land
      // together in one initial commit.
      body: JSON.stringify({ name: safeRepoName, private: opts.isPrivate, auto_init: false }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(parseApiError(`GitHub API returned HTTP ${response.status}`, text));
    }

    const created = JSON.parse(text) as Record<string, unknown>;
    const remoteUrl = typeof created.clone_url === "string" ? created.clone_url : "";
    if (!remoteUrl) {
      throw new Error("GitHub API response did not include clone_url.");
    }

    await cloneRepository(remoteUrl, safeParentDir, safeRepoName, hostToken);
    const localPath = safeTargetDir;
    await seedEmptyRemoteRepository(remoteUrl, localPath, safeRepoName, "main", hostToken);
    return { localPath, remoteUrl };
  } catch (error: unknown) {
    throw new Error(`Failed to create GitHub repository: ${remoteOperationErrorMessage(error, hostToken)}`);
  } finally {
    hostToken = null;
  }
}

/**
 * Creates a new GitLab repository and clones it locally through the shared
 * containerized Git runner.
 */
export async function createGitLabRepo(opts: {
  repoName: string;
  isPrivate: boolean;
  cloneParentDir: string;
  hostToken?: string;
  defaultBranch?: string;
}): Promise<RemoteRepoResult> {
  let hostToken: string | null = null;
  try {
    const safeRepoName = validateSafeRepoName(opts.repoName);
    // Operate on the sanitized, resolved parent directory returned by the
    // validator rather than the raw request-supplied path.
    const safeParentDir = validateSafeClonePath(opts.cloneParentDir);
    const targetDir = path.resolve(safeParentDir, safeRepoName);
    const safeTargetDir = validateNonEmptyDir(targetDir, safeParentDir);
    // Local-first repository creation intentionally creates the user-selected
    // directory after validateSafeClonePath/validateNonEmptyDir constrain it.
    // codeql[js/path-injection]
    fs.mkdirSync(safeParentDir, { recursive: true });

    hostToken = await resolveGitHostTokenWithFallbacks("gitlab", opts.hostToken);
    if (!hostToken) {
      throw new Error("GitLab token is required to create a remote repository.");
    }

    const response = await fetch("https://gitlab.com/api/v4/projects", {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": hostToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: safeRepoName,
        path: safeRepoName,
        visibility: opts.isPrivate ? "private" : "public",
        // Seed locally after cloning so README.md and the Code UX .gitignore land
        // together in one initial commit.
        initialize_with_readme: false,
      }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(parseApiError(`GitLab API returned HTTP ${response.status}`, text));
    }

    const created = JSON.parse(text) as Record<string, unknown>;
    const remoteUrl = typeof created.http_url_to_repo === "string" ? created.http_url_to_repo : "";
    if (!remoteUrl) {
      throw new Error("GitLab API response did not include http_url_to_repo.");
    }
    const localPath = safeTargetDir;

    await cloneRepository(remoteUrl, safeParentDir, safeRepoName, hostToken);
    await seedEmptyRemoteRepository(
      remoteUrl,
      localPath,
      safeRepoName,
      opts.defaultBranch?.trim() || "main",
      hostToken,
    );

    return { localPath, remoteUrl };
  } catch (error: unknown) {
    throw new Error(`Failed to create GitLab repository: ${remoteOperationErrorMessage(error, hostToken)}`);
  } finally {
    hostToken = null;
  }
}
