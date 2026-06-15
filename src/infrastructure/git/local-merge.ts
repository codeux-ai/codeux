import { runCommandStrict, type CommandResult } from "../../services/cli-process-runner.js";

/**
 * Minimal command runner used by the local-merge helpers. Defaults to
 * {@link runCommandStrict} (throws on a non-zero exit); injectable for tests.
 */
export type LocalMergeRunner = (command: string, args: string[], cwd: string) => Promise<CommandResult>;

const defaultRunner: LocalMergeRunner = (command, args, cwd) => runCommandStrict(command, args, cwd);

export interface LocalMergeResult {
  ok: boolean;
  /** True when the merge failed specifically because of a merge conflict (vs. a setup error such as a dirty tree or a branch checked out in another worktree). */
  conflict: boolean;
  error?: string;
}

/** A ref that was checked out before the orchestrator started mutating branches. */
export interface CheckedOutRef {
  ref: string;
  detached: boolean;
}

/**
 * Records whichever ref is currently checked out on the host repo so it can be
 * restored after a sequence of local merges. Returns null when HEAD cannot be
 * resolved (e.g. a brand-new repo with no commits).
 */
export async function getCheckedOutRef(
  repoPath: string,
  runner: LocalMergeRunner = defaultRunner,
): Promise<CheckedOutRef | null> {
  try {
    const branch = (await runner("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], repoPath)).stdout.trim();
    if (branch) return { ref: branch, detached: false };
  } catch {
    // Detached HEAD — fall through to the commit SHA.
  }
  try {
    const sha = (await runner("git", ["rev-parse", "HEAD"], repoPath)).stdout.trim();
    if (sha) return { ref: sha, detached: true };
  } catch {
    // No commits yet — nothing to restore.
  }
  return null;
}

/**
 * Restores a ref captured by {@link getCheckedOutRef}. Best-effort: a restore
 * failure never masks the result of the merge that preceded it.
 */
export async function restoreCheckedOutRef(
  repoPath: string,
  original: CheckedOutRef | null,
  runner: LocalMergeRunner = defaultRunner,
): Promise<void> {
  if (!original) return;
  try {
    await runner(
      "git",
      original.detached ? ["checkout", "--detach", original.ref] : ["checkout", original.ref],
      repoPath,
    );
  } catch {
    // Leave HEAD where the merge left it rather than throwing during cleanup.
  }
}

/**
 * Recovers a task's worker branch from local refs when its recorded `worker_branch`
 * evidence was lost. Lists local `task/…` branches whose name starts with
 * `branchPrefix` (the stable part of the worker-branch name minus its time suffix),
 * keeps only those that carry commits ahead of `featureBranch` (i.e. real, unmerged
 * work), and returns the most recently committed one. Returns null when no such
 * branch exists — so callers never resurrect a phantom branch with nothing to merge.
 */
export async function findRecoverableWorkerBranch(args: {
  repoPath: string;
  featureBranch: string;
  branchPrefix: string;
  runner?: LocalMergeRunner;
}): Promise<string | null> {
  const runner = args.runner ?? defaultRunner;
  let names: string[];
  try {
    const out = await runner("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/"], args.repoPath);
    names = out.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }

  let best: { name: string; when: number } | null = null;
  for (const name of names) {
    if (!name.startsWith(args.branchPrefix)) continue;
    let ahead = 0;
    try {
      const res = await runner("git", ["rev-list", "--count", `${args.featureBranch}..${name}`], args.repoPath);
      ahead = Number.parseInt(res.stdout.trim(), 10) || 0;
    } catch {
      continue;
    }
    if (ahead <= 0) continue;
    let when = 0;
    try {
      const res = await runner("git", ["log", "-1", "--format=%ct", name], args.repoPath);
      when = Number.parseInt(res.stdout.trim(), 10) || 0;
    } catch {
      when = 0;
    }
    if (!best || when > best.when) best = { name, when };
  }
  return best?.name ?? null;
}

/**
 * Merges `sourceBranch` into `targetBranch` with a `--no-ff` merge commit, entirely
 * on the local host repo (LOCAL git mode has no remote PR to merge). Checks out the
 * target branch, performs the merge, and aborts cleanly on conflict.
 *
 * Does NOT restore the previously checked-out branch — callers wrap one or more
 * merges with {@link getCheckedOutRef}/{@link restoreCheckedOutRef} so the host repo
 * is checked out at most once and restored once, instead of churning the working
 * tree per merge. This matters because the host repo is the user's own working
 * directory; the orchestrator must not silently leave it on a different branch.
 */
export async function mergeBranchLocally(args: {
  repoPath: string;
  targetBranch: string;
  sourceBranch: string;
  commitMessage: string;
  runner?: LocalMergeRunner;
}): Promise<LocalMergeResult> {
  const runner = args.runner ?? defaultRunner;
  try {
    await runner("git", ["checkout", args.targetBranch], args.repoPath);
  } catch (err) {
    return { ok: false, conflict: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    await runner(
      "git",
      ["merge", "--no-ff", "-m", args.commitMessage, args.sourceBranch],
      args.repoPath,
    );
    return { ok: true, conflict: false };
  } catch (err) {
    try {
      await runner("git", ["merge", "--abort"], args.repoPath);
    } catch {
      // Abort can itself fail if there was nothing to abort; ignore.
    }
    return { ok: false, conflict: true, error: err instanceof Error ? err.message : String(err) };
  }
}
