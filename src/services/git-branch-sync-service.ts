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

const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

const getDefaultFetchTimeoutMs = (): number => {
  const raw = process.env.CODE_UX_GIT_FETCH_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_FETCH_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_FETCH_TIMEOUT_MS;
  }
  return Math.max(10_000, Math.min(parsed, 600_000));
};

const isSafeBranchRefName = (branch: string): boolean => {
  if (branch.length === 0 || branch.startsWith("-") || branch.endsWith("/") || branch.endsWith(".")) {
    return false;
  }
  if (branch.includes("..") || branch.includes("//") || branch.includes("@{") || branch.includes("\\")) {
    return false;
  }
  return !/[\x00-\x20\x7f~^:?*\[]/.test(branch);
};

const PRUNE_FETCH_ARGS = ["fetch", "origin", "--prune"];

const buildFetchArgs = (branch?: string): string[] => {
  const branchName = branch?.trim();
  if (!branchName || !isSafeBranchRefName(branchName)) {
    return [...PRUNE_FETCH_ARGS];
  }
  return [
    "fetch",
    "origin",
    "--prune",
    `+refs/heads/${branchName}:refs/remotes/origin/${branchName}`,
  ];
};

// A targeted refspec fetch fails hard when the branch was never pushed (e.g. a task
// that completed without producing any file changes or a PR). Git reports this as
// "couldn't find remote ref refs/heads/<branch>". In that case the branch simply does
// not exist on the remote, which is not an error for our callers — they only need
// origin refreshed so downstream ref checks can observe its absence.
const isMissingRemoteRefError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /couldn't find remote ref/i.test(message);
};

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
  branch?: string,
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
  const fetchTimeout = { timeoutMs: options.fetchTimeoutMs ?? getDefaultFetchTimeoutMs() };
  const fetchArgs = buildFetchArgs(branch);
  try {
    await runGit(runner, fetchArgs, repoPath, fetchEnv, fetchTimeout);
  } catch (error) {
    // If the targeted branch was never pushed to the remote, fall back to a plain prune
    // fetch so origin is still refreshed instead of failing the whole operation.
    const isTargetedFetch = fetchArgs.length > PRUNE_FETCH_ARGS.length;
    if (!isTargetedFetch || !isMissingRemoteRefError(error)) {
      throw error;
    }
    await runGit(runner, [...PRUNE_FETCH_ARGS], repoPath, fetchEnv, fetchTimeout);
  }
  return true;
}

export async function syncRemoteBranchIfAvailable(
  repoPath: string,
  branch: string | undefined,
  runnerOrOptions?: GitBranchSyncRunner | GitBranchSyncOptions,
): Promise<boolean> {
  const options = normalizeOptions(runnerOrOptions);
  const runner = options.runner || defaultGitRunner;
  const branchName = branch?.trim();
  const fetched = await fetchOriginIfAvailable(repoPath, options, branchName);
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
