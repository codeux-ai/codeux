import { runCommandStrict, type CommandResult } from "./cli-process-runner.js";

export type GitBranchSyncRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<CommandResult>;

export async function fetchOriginIfAvailable(
  repoPath: string,
  runner: GitBranchSyncRunner = runCommandStrict,
): Promise<boolean> {
  try {
    await runner("git", ["remote", "get-url", "origin"], repoPath);
  } catch {
    return false;
  }

  await runner("git", ["fetch", "origin", "--prune"], repoPath);
  return true;
}

export async function syncRemoteBranchIfAvailable(
  repoPath: string,
  branch: string | undefined,
  runner: GitBranchSyncRunner = runCommandStrict,
): Promise<boolean> {
  const fetched = await fetchOriginIfAvailable(repoPath, runner);
  const branchName = branch?.trim();
  if (!fetched || !branchName) {
    return fetched;
  }

  try {
    await runner("git", ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branchName}`], repoPath);
  } catch {
    return fetched;
  }

  try {
    await runner("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], repoPath);
  } catch {
    await runner("git", ["branch", "--track", branchName, `origin/${branchName}`], repoPath);
    return true;
  }

  try {
    await runner("git", ["merge-base", "--is-ancestor", branchName, `origin/${branchName}`], repoPath);
  } catch {
    return true;
  }

  const localHead = (await runner("git", ["rev-parse", branchName], repoPath)).stdout.trim();
  const remoteHead = (await runner("git", ["rev-parse", `origin/${branchName}`], repoPath)).stdout.trim();
  if (localHead === remoteHead) {
    return true;
  }

  const currentBranch = (await runner("git", ["branch", "--show-current"], repoPath)).stdout.trim();
  if (currentBranch === branchName) {
    const status = (await runner("git", ["status", "--porcelain"], repoPath)).stdout.trim();
    if (status.length > 0) {
      return true;
    }
    await runner("git", ["merge", "--ff-only", `origin/${branchName}`], repoPath);
    return true;
  }

  try {
    await runner("git", ["branch", "-f", branchName, `origin/${branchName}`], repoPath);
  } catch {
    // The branch may be checked out in another worktree. Isolated workspaces still
    // prefer origin/<branch>, so a local ref update failure is non-fatal.
  }
  return true;
}
