import * as fs from "fs";
import * as path from "path";
import { runCommandStrict } from "../../services/cli-process-runner.js";
import { buildGitHttpAuthEnvWithFallbacks } from "../../services/git-http-auth.js";

export interface RemoteRepoResult {
  localPath: string;
  remoteUrl: string;
}

const API_TIMEOUT_MS = 30_000;

const parseApiError = (fallback: string, text: string): string => {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const message = parsed.message;
    return typeof message === "string" && message.trim().length > 0 ? message : fallback;
  } catch {
    return text.trim() || fallback;
  }
};

const cloneRepository = async (remoteUrl: string, cloneParentDir: string, repoName: string, hostToken?: string): Promise<void> => {
  await runCommandStrict(
    "git",
    ["clone", remoteUrl, repoName],
    cloneParentDir,
    (await buildGitHttpAuthEnvWithFallbacks(remoteUrl, {
      githubToken: hostToken,
      gitlabToken: hostToken,
    })) || process.env,
  );
};

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
  try {
    fs.mkdirSync(opts.cloneParentDir, { recursive: true });

    if (!opts.hostToken?.trim()) {
      throw new Error("GitHub token is required to create a remote repository.");
    }

    const response = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.hostToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ name: opts.repoName, private: opts.isPrivate }),
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

    await cloneRepository(remoteUrl, opts.cloneParentDir, opts.repoName, opts.hostToken);
    const localPath = path.join(opts.cloneParentDir, opts.repoName);
    return { localPath, remoteUrl };
  } catch (error: any) {
    const message = error.stderr?.toString() || error.message;
    throw new Error(`Failed to create GitHub repository: ${message}`);
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
}): Promise<RemoteRepoResult> {
  try {
    fs.mkdirSync(opts.cloneParentDir, { recursive: true });

    if (!opts.hostToken?.trim()) {
      throw new Error("GitLab token is required to create a remote repository.");
    }

    const response = await fetch("https://gitlab.com/api/v4/projects", {
      method: "POST",
      headers: {
        "PRIVATE-TOKEN": opts.hostToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: opts.repoName,
        path: opts.repoName,
        visibility: opts.isPrivate ? "private" : "public",
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
    const localPath = path.join(opts.cloneParentDir, opts.repoName);

    await cloneRepository(remoteUrl, opts.cloneParentDir, opts.repoName, opts.hostToken);

    return { localPath, remoteUrl };
  } catch (error: any) {
    const message = error.stderr?.toString() || error.message;
    throw new Error(`Failed to create GitLab repository: ${message}`);
  }
}
