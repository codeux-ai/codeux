import { runCommandStrict, type CommandResult } from "./cli-process-runner.js";
import { resolveHttpsAuthOrFallback, type GitHttpAuthOptions } from "./git-http-auth.js";

export type GitBranchSyncRunner = (
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
  options?: { timeoutMs?: number },
) => Promise<CommandResult>;

export interface GitBranchSyncOptions extends GitHttpAuthOptions {
  runner?: GitBranchSyncRunner;
  fetchTimeoutMs?: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

const normalizeOptions = (
  runnerOrOptions?: GitBranchSyncRunner | GitBranchSyncOptions,
): GitBranchSyncOptions => {
  if (typeof runnerOrOptions === "function") {
    return { runner: runnerOrOptions };
  }
  return runnerOrOptions || {};
};

const runGit = (
  runner: GitBranchSyncRunner,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
  options?: { timeoutMs?: number },
): Promise<CommandResult> => {
  if (env || options) {
    return runner("git", args, cwd, env, options);
  }
  return runner("git", args, cwd);
};

const defaultGitRunner: GitBranchSyncRunner = (
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
  options?: { timeoutMs?: number },
): Promise<CommandResult> => runCommandStrict(command, args, cwd, env ?? process.env, {
  timeout: options?.timeoutMs,
});

export async function fetchOriginIfAvailable(
  repoPath: string,
  runnerOrOptions?: GitBranchSyncRunner | GitBranchSyncOptions,
): Promise<boolean> {
  const options = normalizeOptions(runnerOrOptions);
  const runner = options.runner || defaultGitRunner;
  let remoteUrl: string;
  try {
    remoteUrl = (await runGit(runner, ["remote", "get-url", "origin"], repoPath)).stdout.trim();
  } catch {
    return false;
  }

  const fetchEnv = await resolveHttpsAuthOrFallback(remoteUrl, options);
  await runGit(runner, ["fetch", "origin", "--prune"], repoPath, fetchEnv, {
    timeoutMs: options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
  });
  return true;
}

export async function syncRemoteBranchIfAvailable(
  repoPath: string,
  branch: string | undefined,
  runnerOrOptions?: GitBranchSyncRunner | GitBranchSyncOptions,
): Promise<boolean> {
  const options = normalizeOptions(runnerOrOptions);
  const runner = options.runner || defaultGitRunner;
  const fetched = await fetchOriginIfAvailable(repoPath, options);
  const branchName = branch?.trim();
  if (!fetched || !branchName) {
    return fetched;
  }

  try {
    await runGit(runner, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branchName}`], repoPath);
  } catch {
    return fetched;
  }

  try {
    await runGit(runner, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], repoPath);
  } catch {
    await runGit(runner, ["branch", "--track", branchName, `origin/${branchName}`], repoPath);
    return true;
  }

  try {
    await runGit(runner, ["merge-base", "--is-ancestor", branchName, `origin/${branchName}`], repoPath);
  } catch {
    return true;
  }

  const localHead = (await runGit(runner, ["rev-parse", branchName], repoPath)).stdout.trim();
  const remoteHead = (await runGit(runner, ["rev-parse", `origin/${branchName}`], repoPath)).stdout.trim();
  if (localHead === remoteHead) {
    return true;
  }

  const currentBranch = (await runGit(runner, ["branch", "--show-current"], repoPath)).stdout.trim();
  if (currentBranch === branchName) {
    const status = (await runGit(runner, ["status", "--porcelain"], repoPath)).stdout.trim();
    if (status.length > 0) {
      return true;
    }
    await runGit(runner, ["merge", "--ff-only", `origin/${branchName}`], repoPath);
    return true;
  }

  try {
    await runGit(runner, ["branch", "-f", branchName, `origin/${branchName}`], repoPath);
  } catch {
    // The branch may be checked out in another worktree. Isolated workspaces still
    // prefer origin/<branch>, so a local ref update failure is non-fatal.
  }
  return true;
}
