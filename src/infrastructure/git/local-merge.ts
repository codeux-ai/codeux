import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCommandStrict, type CommandResult } from "../../services/cli-process-runner.js";
import { CODE_UX_GIT_PATHSPEC_EXCLUDE, CODE_UX_REPO_DIR } from "./code-ux-gitignore.js";

/**
 * Minimal command runner used by the local-merge helpers. Defaults to
 * {@link runCommandStrict} (throws on a non-zero exit); injectable for tests.
 */
export type LocalMergeRunner = (command: string, args: string[], cwd: string) => Promise<CommandResult>;

const defaultRunner: LocalMergeRunner = (command, args, cwd) => runCommandStrict(command, args, cwd);
const CODE_UX_GIT_IDENTITY_ARGS = [
  "-c", "user.name=Code UX",
  "-c", "user.email=agents@codeux.ai",
];

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
): Promise<boolean> {
  if (!original) return true;
  try {
    await runner(
      "git",
      original.detached ? ["checkout", "--detach", original.ref] : ["checkout", original.ref],
      repoPath,
    );
    return true;
  } catch {
    // Leave HEAD where the merge left it rather than throwing during cleanup.
    return false;
  }
}

async function hasDirtyWorkingTree(repoPath: string, runner: LocalMergeRunner): Promise<boolean> {
  try {
    const status = await runner("git", ["status", "--porcelain", "--", ".", CODE_UX_GIT_PATHSPEC_EXCLUDE], repoPath);
    return status.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export interface DirtyCheckoutPreservationResult {
  dirtyRefBranch: string;
  originalRef: CheckedOutRef | null;
}

export interface DirtyCheckoutRestoreResult {
  ok: boolean;
  conflict: boolean;
  restoredPaths: string[];
  dirtyRefBranch: string;
  error?: string;
}

async function unstageCodeUxRepoDir(repoPath: string, runner: LocalMergeRunner): Promise<void> {
  await runner("git", ["reset", "--", CODE_UX_REPO_DIR], repoPath).catch(() => undefined);
}

async function runGitWithCodeUxIdentity(
  repoPath: string,
  args: string[],
  runner: LocalMergeRunner,
): Promise<CommandResult> {
  return runner("git", [...CODE_UX_GIT_IDENTITY_ARGS, ...args], repoPath);
}

/**
 * Captures the current dirty checkout on a dedicated `dirty-ref-<uuid>` branch,
 * commits all tracked and untracked work onto that branch, and restores the
 * original checked-out ref cleanly so the caller can continue with a separate
 * merge flow.
 */
export async function preserveDirtyCheckout(
  repoPath: string,
  runner: LocalMergeRunner = defaultRunner,
): Promise<DirtyCheckoutPreservationResult | null> {
  const originalRef = await getCheckedOutRef(repoPath, runner);
  if (!originalRef) {
    return null;
  }

  if (!(await hasDirtyWorkingTree(repoPath, runner))) {
    return null;
  }

  const dirtyRefBranch = `dirty-ref-${randomUUID()}`;
  try {
    await runner("git", ["checkout", "-b", dirtyRefBranch], repoPath);
    await unstageCodeUxRepoDir(repoPath, runner);
    await runner("git", ["add", "-A", "--", ".", CODE_UX_GIT_PATHSPEC_EXCLUDE], repoPath);
    await runGitWithCodeUxIdentity(repoPath, ["commit", "-m", `Preserve dirty work before local merge into ${originalRef.ref}`], runner);
    if (!(await restoreCheckedOutRef(repoPath, originalRef, runner))) {
      throw new Error(`Failed to restore the original ref ${originalRef.ref} after preserving dirty work.`);
    }
    return { dirtyRefBranch, originalRef };
  } catch (error) {
    try {
      await runner("git", ["merge", "--abort"], repoPath);
    } catch {
      // Best-effort cleanup. The caller will surface the failure.
    }
    throw error;
  }
}

/**
 * Re-applies a preserved dirty-checkout commit onto the visible checkout without
 * committing it. On conflict, the cherry-pick is aborted and the dirty branch is
 * left intact for manual recovery.
 */
export async function restorePreservedDirtyCheckout(
  repoPath: string,
  dirtyRefBranch: string,
  runner: LocalMergeRunner = defaultRunner,
): Promise<DirtyCheckoutRestoreResult> {
  const branch = dirtyRefBranch.trim();
  if (!branch) {
    return {
      ok: false,
      conflict: false,
      restoredPaths: [],
      dirtyRefBranch,
      error: "Dirty checkout branch is required.",
    };
  }
  if (!(await gitCommitExists(repoPath, branch, runner))) {
    return {
      ok: false,
      conflict: false,
      restoredPaths: [],
      dirtyRefBranch: branch,
      error: `Dirty checkout branch '${branch}' was not found or does not point to a commit.`,
    };
  }

  let restoredPaths: string[] = [];
  try {
    const files = await runner("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", branch], repoPath);
    restoredPaths = files.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    restoredPaths = [];
  }

  try {
    await runner("git", ["cherry-pick", "--no-commit", branch], repoPath);
    if (restoredPaths.length > 0) {
      await runner("git", ["reset", "--", ...restoredPaths], repoPath).catch(() => undefined);
    }
    return {
      ok: true,
      conflict: false,
      restoredPaths,
      dirtyRefBranch: branch,
    };
  } catch (err) {
    const conflictPaths = await listUnmergedConflictPaths(repoPath, runner);
    try {
      await runner("git", ["cherry-pick", "--abort"], repoPath);
    } catch {
      try {
        await runner("git", ["reset", "--merge"], repoPath);
      } catch {
        // Best-effort cleanup; the error below tells the caller what happened.
      }
    }
    return {
      ok: false,
      conflict: conflictPaths.length > 0,
      restoredPaths: conflictPaths.length > 0 ? conflictPaths : restoredPaths,
      dirtyRefBranch: branch,
      error: formatGitError(err),
    };
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

async function gitRefExists(
  repoPath: string,
  ref: string,
  runner: LocalMergeRunner,
): Promise<boolean> {
  try {
    await runner("git", ["show-ref", "--verify", "--quiet", ref], repoPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveTargetBranchStartPoint(
  repoPath: string,
  branch: string,
  fallbackBranches: string[],
  runner: LocalMergeRunner,
): Promise<string | null> {
  const candidateBranches = Array.from(new Set([
    branch,
    ...fallbackBranches,
  ].map((candidate) => candidate.trim()).filter(Boolean)));

  for (const candidate of candidateBranches) {
    const candidateRefs = [
      `refs/remotes/origin/${candidate}`,
      `refs/heads/${candidate}`,
    ];
    for (const ref of candidateRefs) {
      if (ref === `refs/heads/${branch}` || !(await gitRefExists(repoPath, ref, runner))) {
        continue;
      }
      return ref;
    }
  }
  return null;
}

async function gitCommitExists(
  repoPath: string,
  ref: string,
  runner: LocalMergeRunner,
): Promise<boolean> {
  try {
    await runner("git", ["rev-parse", "--verify", `${ref}^{commit}`], repoPath);
    return true;
  } catch {
    return false;
  }
}

async function gitRevListCount(
  repoPath: string,
  range: string,
  runner: LocalMergeRunner,
): Promise<number> {
  try {
    const res = await runner("git", ["rev-list", "--count", range], repoPath);
    return Number.parseInt(res.stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function gitResolveCommit(
  repoPath: string,
  ref: string,
  runner: LocalMergeRunner,
): Promise<string | null> {
  try {
    const res = await runner("git", ["rev-parse", "--verify", `${ref}^{commit}`], repoPath);
    return res.stdout.trim() || null;
  } catch {
    return null;
  }
}

function formatGitError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function hasUnmergedConflictEntries(
  repoPath: string,
  runner: LocalMergeRunner,
): Promise<boolean> {
  try {
    const res = await runner("git", ["diff", "--name-only", "--diff-filter=U"], repoPath);
    return res.stdout.trim().length > 0;
  } catch {
    try {
      const res = await runner("git", ["ls-files", "-u"], repoPath);
      return res.stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
}

async function listUnmergedConflictPaths(
  repoPath: string,
  runner: LocalMergeRunner,
): Promise<string[]> {
  try {
    const res = await runner("git", ["diff", "--name-only", "--diff-filter=U"], repoPath);
    return res.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    try {
      const res = await runner("git", ["ls-files", "-u"], repoPath);
      const paths = new Set<string>();
      for (const line of res.stdout.split("\n")) {
        const tabIndex = line.indexOf("\t");
        if (tabIndex >= 0) {
          const filePath = line.slice(tabIndex + 1).trim();
          if (filePath) paths.add(filePath);
        }
      }
      return [...paths];
    } catch {
      return [];
    }
  }
}

function isCodeUxRepoPath(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  return normalized === CODE_UX_REPO_DIR || normalized.startsWith(`${CODE_UX_REPO_DIR}/`);
}

async function resolveCodeUxOnlyMergeConflicts(
  repoPath: string,
  commitMessage: string,
  runner: LocalMergeRunner,
): Promise<LocalMergeResult | null> {
  const conflictPaths = await listUnmergedConflictPaths(repoPath, runner);
  if (conflictPaths.length === 0 || !conflictPaths.every(isCodeUxRepoPath)) {
    return null;
  }

  // `.code-ux/` is runtime metadata. During orchestration merges, keep the target
  // side and never let generated metadata block or contaminate task/sprint code.
  await runner("git", ["checkout", "--ours", "--", CODE_UX_REPO_DIR], repoPath).catch(() => undefined);
  await runner("git", ["add", "-A", "--", CODE_UX_REPO_DIR], repoPath).catch(() => undefined);

  const remainingConflicts = await listUnmergedConflictPaths(repoPath, runner);
  if (remainingConflicts.length > 0) {
    return {
      ok: false,
      conflict: true,
      error: `Only ${CODE_UX_REPO_DIR} paths conflicted, but they could not be resolved automatically: ${remainingConflicts.join(", ")}`,
    };
  }

  try {
    await runGitWithCodeUxIdentity(repoPath, ["commit", "-m", commitMessage], runner);
    return { ok: true, conflict: false };
  } catch (err) {
    return { ok: false, conflict: false, error: formatGitError(err) };
  }
}

async function normalizeTemporaryWorktreeGitMetadata(repoPath: string, worktreePath: string): Promise<void> {
  const dotGitPath = path.join(worktreePath, ".git");
  let content: string;
  try {
    content = (await readFile(dotGitPath, "utf8")).trim();
  } catch {
    return;
  }

  const match = /^gitdir:\s*(.+)$/i.exec(content);
  if (!match) {
    return;
  }

  const rawGitDir = match[1].trim();
  const currentGitDir = path.isAbsolute(rawGitDir)
    ? rawGitDir
    : path.resolve(worktreePath, rawGitDir);
  if (existsSync(currentGitDir)) {
    return;
  }

  const gitDirName = path.basename(rawGitDir);
  if (!gitDirName || gitDirName === "." || gitDirName === path.sep) {
    return;
  }

  const hostGitDir = path.join(repoPath, ".git", "worktrees", gitDirName);
  const relativeGitDir = path.relative(worktreePath, hostGitDir).replaceAll(path.sep, "/");
  if (!relativeGitDir || relativeGitDir.startsWith("/")) {
    return;
  }

  await writeFile(dotGitPath, `gitdir: ${relativeGitDir}\n`, "utf8");
}

/**
 * Returns true only when the recorded worker branch still exists and carries
 * commits that are not already in the feature branch. This is used to clear stale
 * branch names left behind by no-output runs without force-settling real work.
 */
export async function workerBranchHasMergeWork(args: {
  repoPath: string;
  featureBranch: string;
  workerBranch: string;
  runner?: LocalMergeRunner;
}): Promise<boolean> {
  const runner = args.runner ?? defaultRunner;
  const branch = args.workerBranch.trim();
  if (!branch) return false;

  const sourceRefs = [
    `refs/heads/${branch}`,
    `refs/remotes/origin/${branch}`,
  ];
  const existingSourceRefs: string[] = [];
  for (const ref of sourceRefs) {
    if (await gitRefExists(args.repoPath, ref, runner)) {
      existingSourceRefs.push(ref);
    }
  }
  if (existingSourceRefs.length === 0) {
    return false;
  }

  const baseRefs = [
    `refs/remotes/origin/${args.featureBranch}`,
    `refs/heads/${args.featureBranch}`,
  ];
  const existingBaseRefs: string[] = [];
  for (const ref of baseRefs) {
    if (await gitRefExists(args.repoPath, ref, runner)) {
      existingBaseRefs.push(ref);
    }
  }
  if (existingBaseRefs.length === 0) {
    return true;
  }

  for (const sourceRef of existingSourceRefs) {
    const sourceCommit = await gitResolveCommit(args.repoPath, sourceRef, runner);
    if (!sourceCommit) {
      continue;
    }
    for (const baseRef of existingBaseRefs) {
      const baseCommit = await gitResolveCommit(args.repoPath, baseRef, runner);
      if (!baseCommit) {
        continue;
      }
      if ((await gitRevListCount(args.repoPath, `${baseCommit}..${sourceCommit}`, runner)) > 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns true when the recorded worker branch still exists and every commit on
 * it is already reachable from the feature branch. This lets restart recovery
 * distinguish an interrupted post-merge persistence step from a missing or
 * genuinely no-output worker branch.
 */
export async function workerBranchIsMergedIntoFeature(args: {
  repoPath: string;
  featureBranch: string;
  workerBranch: string;
  runner?: LocalMergeRunner;
}): Promise<boolean> {
  const runner = args.runner ?? defaultRunner;
  const branch = args.workerBranch.trim();
  if (!branch) return false;

  const sourceRefs = [
    `refs/heads/${branch}`,
    `refs/remotes/origin/${branch}`,
  ];
  const baseRefs = [
    `refs/remotes/origin/${args.featureBranch}`,
    `refs/heads/${args.featureBranch}`,
  ];

  for (const sourceRef of sourceRefs) {
    if (!(await gitRefExists(args.repoPath, sourceRef, runner))) continue;
    const sourceCommit = await gitResolveCommit(args.repoPath, sourceRef, runner);
    if (!sourceCommit) continue;

    for (const baseRef of baseRefs) {
      if (!(await gitRefExists(args.repoPath, baseRef, runner))) continue;
      const baseCommit = await gitResolveCommit(args.repoPath, baseRef, runner);
      if (!baseCommit) continue;
      try {
        const result = await runner("git", ["rev-list", "--count", `${baseCommit}..${sourceCommit}`], args.repoPath);
        if (Number.parseInt(result.stdout.trim(), 10) === 0) return true;
      } catch {
        // Try the next local/remote ref pair before treating the merge as unproven.
      }
    }
  }

  return false;
}

/**
 * Deletes a local branch after its work has been merged. Never deletes the branch that is currently
 * checked out (git refuses anyway) and swallows errors — branch cleanup is best-effort and must
 * never fail a merge. Returns true when the branch was removed.
 */
export async function deleteBranchLocally(args: {
  repoPath: string;
  branch: string;
  runner?: LocalMergeRunner;
}): Promise<boolean> {
  const branch = args.branch.trim();
  if (!branch) {
    return false;
  }
  const runner = args.runner ?? defaultRunner;
  try {
    const current = await runner("git", ["rev-parse", "--abbrev-ref", "HEAD"], args.repoPath);
    if (current.stdout.trim() === branch) {
      return false;
    }
  } catch {
    // If HEAD cannot be resolved, fall through and let the delete attempt decide.
  }
  try {
    await runner("git", ["branch", "-D", branch], args.repoPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merges `sourceBranch` into `targetBranch` entirely on the local host repo (LOCAL
 * git mode has no remote PR to merge). Checks out the target branch, creates it
 * from the source when a freshly initialized local repo has no default-branch ref
 * yet, performs the merge, and aborts cleanly on conflict.
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
  fallbackTargetBranches?: string[];
  runner?: LocalMergeRunner;
}): Promise<LocalMergeResult> {
  const runner = args.runner ?? defaultRunner;
  const targetBranch = args.targetBranch.trim();
  const sourceBranch = args.sourceBranch.trim();
  if (!targetBranch) {
    return { ok: false, conflict: false, error: "Target branch is required for local merge." };
  }
  if (!sourceBranch) {
    return { ok: false, conflict: false, error: "Source branch is required for local merge." };
  }
  if (!(await gitCommitExists(args.repoPath, sourceBranch, runner))) {
    return {
      ok: false,
      conflict: false,
      error: `Source branch or ref '${sourceBranch}' was not found or does not point to a commit.`,
    };
  }
  try {
    if (await gitRefExists(args.repoPath, `refs/heads/${targetBranch}`, runner)) {
      await runner("git", ["checkout", targetBranch], args.repoPath);
    } else {
      const startPoint = await resolveTargetBranchStartPoint(
        args.repoPath,
        targetBranch,
        args.fallbackTargetBranches ?? [],
        runner,
      );
      if (startPoint) {
        await runner("git", ["branch", targetBranch, startPoint], args.repoPath);
        await runner("git", ["checkout", targetBranch], args.repoPath);
      } else {
        await runner("git", ["checkout", "-B", targetBranch, sourceBranch], args.repoPath);
        return { ok: true, conflict: false };
      }
    }
  } catch (err) {
    return { ok: false, conflict: false, error: formatGitError(err) };
  }
  try {
    await runGitWithCodeUxIdentity(args.repoPath, ["merge", "--no-ff", "-m", args.commitMessage, sourceBranch], runner);
    return { ok: true, conflict: false };
  } catch (err) {
    const resolvedCodeUxConflict = await resolveCodeUxOnlyMergeConflicts(args.repoPath, args.commitMessage, runner);
    if (resolvedCodeUxConflict?.ok) {
      return resolvedCodeUxConflict;
    }
    const conflict = resolvedCodeUxConflict ? true : await hasUnmergedConflictEntries(args.repoPath, runner);
    try {
      await runner("git", ["merge", "--abort"], args.repoPath);
    } catch {
      // Abort can itself fail if there was nothing to abort; ignore.
    }
    return { ok: false, conflict, error: formatGitError(err) };
  }
}

export interface TemporaryWorktreeBranchMerger {
  merge(sourceBranch: string, commitMessage: string): Promise<LocalMergeResult>;
  close(): Promise<void>;
}

/**
 * Creates a reusable detached-worktree merger. A batch keeps one worktree open
 * while applying independent worker branches to the same target, but publishes
 * the target ref after every successful merge. This avoids worktree setup and
 * cleanup for every leaf in a wide LOCAL-mode DAG without making a later merge
 * depend on uncommitted work from an earlier one.
 */
export function createTemporaryWorktreeBranchMerger(args: {
  repoPath: string;
  targetBranch: string;
  fallbackTargetBranches?: string[];
  runner?: LocalMergeRunner;
}): TemporaryWorktreeBranchMerger {
  const runner = args.runner ?? defaultRunner;
  const targetBranch = args.targetBranch.trim();
  let visibleCheckout: CheckedOutRef | null | undefined;
  let worktreePath: string | null = null;
  let worktreeCreated = false;
  let mergedTarget = false;
  let closed = false;

  const openWorktree = async (sourceBranch: string): Promise<LocalMergeResult | null> => {
    if (!targetBranch) {
      return { ok: false, conflict: false, error: "Target branch is required for local merge." };
    }
    if (worktreeCreated) {
      return null;
    }
    visibleCheckout ??= await getCheckedOutRef(args.repoPath, runner);
    const targetExists = await gitRefExists(args.repoPath, `refs/heads/${targetBranch}`, runner);
    if (!targetExists) {
      try {
        const startPoint = await resolveTargetBranchStartPoint(
          args.repoPath,
          targetBranch,
          args.fallbackTargetBranches ?? [],
          runner,
        );
        await runner("git", ["branch", targetBranch, startPoint ?? sourceBranch], args.repoPath);
        if (!startPoint) {
          mergedTarget = true;
          return { ok: true, conflict: false };
        }
      } catch (err) {
        return { ok: false, conflict: false, error: formatGitError(err) };
      }
    }

    const worktreeRoot = path.join(args.repoPath, ".worktrees");
    try {
      if (existsSync(args.repoPath)) {
        await mkdir(worktreeRoot, { recursive: true });
        worktreePath = await mkdtemp(path.join(worktreeRoot, "code-ux-local-merge-"));
      } else {
        worktreePath = path.join(worktreeRoot, `code-ux-local-merge-${randomUUID()}`);
      }
      await runner("git", ["worktree", "add", "--detach", worktreePath, targetBranch], args.repoPath);
      worktreeCreated = true;
      await normalizeTemporaryWorktreeGitMetadata(args.repoPath, worktreePath);
      return null;
    } catch (err) {
      return { ok: false, conflict: false, error: formatGitError(err) };
    }
  };

  return {
    async merge(sourceBranchInput: string, commitMessage: string): Promise<LocalMergeResult> {
      if (closed) {
        return { ok: false, conflict: false, error: "Temporary worktree merger is already closed." };
      }
      const sourceBranch = sourceBranchInput.trim();
      if (!sourceBranch) {
        return { ok: false, conflict: false, error: "Source branch is required for local merge." };
      }
      if (!(await gitCommitExists(args.repoPath, sourceBranch, runner))) {
        return {
          ok: false,
          conflict: false,
          error: `Source branch or ref '${sourceBranch}' was not found or does not point to a commit.`,
        };
      }

      const opened = await openWorktree(sourceBranch);
      if (opened) {
        return opened;
      }
      if (!worktreePath) {
        return { ok: false, conflict: false, error: "Temporary worktree was not created." };
      }

      try {
        await runGitWithCodeUxIdentity(worktreePath, ["merge", "--no-ff", "-m", commitMessage, sourceBranch], runner);
        await runner("git", ["update-ref", `refs/heads/${targetBranch}`, "HEAD"], worktreePath);
        mergedTarget = true;
        return { ok: true, conflict: false };
      } catch (err) {
        const resolvedCodeUxConflict = await resolveCodeUxOnlyMergeConflicts(worktreePath, commitMessage, runner);
        if (resolvedCodeUxConflict?.ok) {
          await runner("git", ["update-ref", `refs/heads/${targetBranch}`, "HEAD"], worktreePath);
          mergedTarget = true;
          return resolvedCodeUxConflict;
        }
        const conflict = resolvedCodeUxConflict ? true : await hasUnmergedConflictEntries(worktreePath, runner);
        try {
          await runner("git", ["merge", "--abort"], worktreePath);
        } catch {
          // Abort can itself fail if there was nothing to abort; ignore.
        }
        return { ok: false, conflict, error: formatGitError(err) };
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      if (mergedTarget && visibleCheckout && !visibleCheckout.detached && visibleCheckout.ref === targetBranch) {
        await runner("git", ["reset", "--hard", "HEAD"], args.repoPath).catch(() => undefined);
      }
      if (worktreeCreated && worktreePath) {
        await runner("git", ["worktree", "remove", "--force", worktreePath], args.repoPath).catch(() => undefined);
        await runner("git", ["worktree", "prune"], args.repoPath).catch(() => undefined);
      }
      if (worktreePath) {
        await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

/**
 * Merges one branch using a temporary worktree. Kept as the single-merge API
 * for callers outside the sprint batch gate.
 */
export async function mergeBranchLocallyInTemporaryWorktree(args: {
  repoPath: string;
  targetBranch: string;
  sourceBranch: string;
  commitMessage: string;
  fallbackTargetBranches?: string[];
  runner?: LocalMergeRunner;
}): Promise<LocalMergeResult> {
  const merger = createTemporaryWorktreeBranchMerger(args);
  try {
    return await merger.merge(args.sourceBranch, args.commitMessage);
  } finally {
    await merger.close();
  }
}
