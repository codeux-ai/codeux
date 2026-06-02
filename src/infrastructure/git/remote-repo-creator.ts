import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface RemoteRepoResult {
  localPath: string;
  remoteUrl: string;
}

/**
 * Creates a new GitHub repository and clones it locally.
 * Requires the `gh` CLI to be installed and authenticated.
 */
export async function createGitHubRepo(opts: {
  repoName: string;
  isPrivate: boolean;
  cloneParentDir: string;
  hostToken?: string;
}): Promise<RemoteRepoResult> {
  try {
    fs.mkdirSync(opts.cloneParentDir, { recursive: true });

    const env = {
      ...process.env,
      ...(opts.hostToken ? { GH_TOKEN: opts.hostToken, GITHUB_TOKEN: opts.hostToken } : {}),
    };

    // gh repo create clones into <repoName> subdirectory inside cwd if --clone is used
    execFileSync(
      "gh",
      ["repo", "create", opts.repoName, opts.isPrivate ? "--private" : "--public", "--clone"],
      {
        cwd: opts.cloneParentDir,
        stdio: "pipe",
        env,
      }
    );

    const localPath = path.join(opts.cloneParentDir, opts.repoName);

    const remoteUrl = execFileSync("git", ["-C", localPath, "remote", "get-url", "origin"], {
      stdio: "pipe",
    })
      .toString()
      .trim();

    return { localPath, remoteUrl };
  } catch (error: any) {
    const message = error.stderr?.toString() || error.message;
    throw new Error(`Failed to create GitHub repository: ${message}`);
  }
}

/**
 * Creates a new GitLab repository and clones it locally.
 * Requires the `glab` CLI to be installed and authenticated.
 */
export async function createGitLabRepo(opts: {
  repoName: string;
  isPrivate: boolean;
  cloneParentDir: string;
}): Promise<RemoteRepoResult> {
  try {
    fs.mkdirSync(opts.cloneParentDir, { recursive: true });

    const result = execFileSync(
      "glab",
      ["repo", "create", opts.repoName, opts.isPrivate ? "--private" : "--public"],
      {
        cwd: opts.cloneParentDir,
        stdio: "pipe",
      }
    ).toString();

    // Parse the output for a https:// or git@ URL
    const urlMatch = result.match(/(https?:\/\/[^\s]+|git@[^\s]+)/);
    const parsedUrl = urlMatch ? urlMatch[0].replace(/\.git$/, "") : "";

    if (!parsedUrl) {
      throw new Error("Could not determine remote URL from glab output");
    }

    const localPath = path.join(opts.cloneParentDir, opts.repoName);

    // Check if glab repo create auto-cloned (unlikely by default without flags)
    if (!fs.existsSync(path.join(localPath, ".git"))) {
      execFileSync("git", ["clone", parsedUrl, opts.repoName], {
        cwd: opts.cloneParentDir,
        stdio: "pipe",
      });
    }

    return { localPath, remoteUrl: parsedUrl };
  } catch (error: any) {
    const message = error.stderr?.toString() || error.message;
    throw new Error(`Failed to create GitLab repository: ${message}`);
  }
}
