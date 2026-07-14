import { commandRunner } from "../../shared/subprocess/command-runner.js";
import * as fs from "fs/promises";
import { resolveHttpsAuthOrFallback, type GitHttpAuthOptions } from "../../services/git-http-auth.js";

export interface BranchAvailability {
  existsLocal: boolean;
  existsRemote: boolean;
}

export interface BranchPreparationResult extends BranchAvailability {
  hasRemoteOrigin: boolean;
  createdLocal: boolean;
  checkedOutLocal: boolean;
  pushedRemote: boolean;
  /**
   * The commit the feature branch was forked from, captured only when this call
   * created the branch. This is the stable diff checkpoint: it must be recorded
   * now, while the branch still diverges from the default branch, because once the
   * sprint is merged back the fork point can no longer be recovered from the refs.
   */
  baseCommitSha: string | null;
  /**
   * Present when a caller requested synchronization with the default branch.
   * Feature history is never rewritten: a diverged branch is preserved.
   */
  defaultBranchSync?: "advanced" | "already_current" | "preserved_feature_changes" | "failed";
}

export interface BranchPreflightOptions extends GitHttpAuthOptions {
  authEnv?: NodeJS.ProcessEnv;
  networkTimeoutMs?: number;
  localOnly?: boolean;
  fastForwardFromDefault?: boolean;
  expectedFeatureCommitSha?: string | null;
}

const DEFAULT_GIT_NETWORK_TIMEOUT_MS = 30_000;

const runGit = async (
  repoPath: string,
  args: string[],
  options?: BranchPreflightOptions,
) => {
  return commandRunner.run("git", args, {
    cwd: repoPath,
    ...(options?.authEnv ? { env: options.authEnv } : {}),
    ...(options ? { timeout: options.networkTimeoutMs ?? DEFAULT_GIT_NETWORK_TIMEOUT_MS } : {}),
  });
};

const getRemoteOriginUrl = async (repoPath: string): Promise<string | null> => {
  try {
    const result = await commandRunner.run("git", ["remote", "get-url", "origin"], { cwd: repoPath });
    const remoteUrl = result.stdout.trim();
    return result.ok && remoteUrl.length > 0 ? remoteUrl : null;
  } catch {
    return null;
  }
};

const withResolvedAuthEnv = async (
  remoteUrl: string | null,
  options?: BranchPreflightOptions,
): Promise<BranchPreflightOptions | undefined> => {
  const authEnv = options?.authEnv || await resolveHttpsAuthOrFallback(remoteUrl, options);
  if (!authEnv && !options) {
    return undefined;
  }
  return {
    ...options,
    authEnv,
  };
};

const shouldResolveAuthEnv = (options?: BranchPreflightOptions): boolean => Boolean(options && !options.localOnly);

const isGitRepository = async (repoPath: string): Promise<boolean> => {
  try {
    const result = await commandRunner.run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repoPath });
    return result.ok;
  } catch {
    return false;
  }
};

const hasLocalBranch = async (repoPath: string, branch: string): Promise<boolean> => {
  try {
    const result = await commandRunner.run("git", ["show-ref", "--verify", `refs/heads/${branch}`], { cwd: repoPath });
    return result.ok;
  } catch {
    return false;
  }
};

const hasRemoteBranch = async (
  repoPath: string,
  branch: string,
  options?: BranchPreflightOptions,
): Promise<boolean> => {
  try {
    const result = await runGit(repoPath, ["ls-remote", "--heads", "origin", branch], options);
    if (result.ok) {
      return result.stdout.trim().length > 0;
    }
    return await remoteTrackingRefExists(repoPath, branch);
  } catch {
    return await remoteTrackingRefExists(repoPath, branch);
  }
};

const hasRemoteOrigin = async (repoPath: string): Promise<boolean> => {
  try {
    const result = await commandRunner.run("git", ["remote", "get-url", "origin"], { cwd: repoPath });
    return result.ok && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
};

const fetchOrigin = async (
  repoPath: string,
  options?: BranchPreflightOptions,
): Promise<void> => {
  try {
    await runGit(repoPath, ["fetch", "origin", "--prune"], options);
  } catch {
    // Branch preflight remains best-effort when origin is temporarily unavailable.
  }
};

const resolveCommitSha = async (repoPath: string, ref: string): Promise<string | null> => {
  try {
    const result = await commandRunner.run("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: repoPath });
    return result.ok ? result.stdout.trim() || null : null;
  } catch {
    return null;
  }
};

const remoteTrackingRefExists = async (repoPath: string, branch: string): Promise<boolean> => {
  try {
    const result = await commandRunner.run("git", ["show-ref", "--verify", `refs/remotes/origin/${branch}`], { cwd: repoPath });
    return result.ok;
  } catch {
    return false;
  }
};

const createLocalBranch = async (
  repoPath: string,
  branch: string,
  defaultBranch: string,
  localOnly = false,
): Promise<boolean> => {
  try {
    if (!localOnly && await remoteTrackingRefExists(repoPath, branch)) {
      const result = await commandRunner.run("git", ["branch", "--track", branch, `origin/${branch}`], { cwd: repoPath });
      return result.ok;
    }

    if (!localOnly) {
      const hasRemoteDefaultBranch = await commandRunner.run("git", ["show-ref", "--verify", `refs/remotes/origin/${defaultBranch}`], { cwd: repoPath });
      if (hasRemoteDefaultBranch.ok) {
        const result = await commandRunner.run("git", ["branch", branch, `origin/${defaultBranch}`], { cwd: repoPath });
        return result.ok;
      }
    }

    const hasLocalDefaultBranch = await commandRunner.run("git", ["show-ref", "--verify", `refs/heads/${defaultBranch}`], { cwd: repoPath });
    if (hasLocalDefaultBranch.ok) {
      const result = await commandRunner.run("git", ["branch", branch, defaultBranch], { cwd: repoPath });
      return result.ok;
    }

    return (await commandRunner.run("git", ["branch", branch], { cwd: repoPath })).ok;
  } catch {
    return false;
  }
};

const fastForwardLocalBranchFromOrigin = async (repoPath: string, branch: string): Promise<boolean> => {
  if (!(await remoteTrackingRefExists(repoPath, branch))) {
    return false;
  }

  try {
    const canFastForward = await commandRunner.run("git", ["merge-base", "--is-ancestor", branch, `origin/${branch}`], { cwd: repoPath });
    if (!canFastForward.ok) {
      return false;
    }

    const localHead = await commandRunner.run("git", ["rev-parse", branch], { cwd: repoPath });
    const remoteHead = await commandRunner.run("git", ["rev-parse", `origin/${branch}`], { cwd: repoPath });
    if (localHead.stdout.trim() === remoteHead.stdout.trim()) {
      return false;
    }

    const currentBranch = await commandRunner.run("git", ["branch", "--show-current"], { cwd: repoPath });
    if (currentBranch.stdout.trim() === branch) {
      const status = await commandRunner.run("git", ["status", "--porcelain"], { cwd: repoPath });
      if (status.stdout.trim().length > 0) {
        return false;
      }
      return (await commandRunner.run("git", ["merge", "--ff-only", `origin/${branch}`], { cwd: repoPath })).ok;
    }

    return (await commandRunner.run("git", ["branch", "-f", branch, `origin/${branch}`], { cwd: repoPath })).ok;
  } catch {
    return false;
  }
};

const resolveDefaultBranchRef = async (
  repoPath: string,
  defaultBranch: string,
  localOnly: boolean,
): Promise<string | null> => {
  if (!localOnly && await remoteTrackingRefExists(repoPath, defaultBranch)) {
    return `origin/${defaultBranch}`;
  }
  if (await hasLocalBranch(repoPath, defaultBranch)) {
    return defaultBranch;
  }
  return null;
};

const isAncestor = async (repoPath: string, ancestor: string, descendant: string): Promise<boolean> => {
  try {
    return (await commandRunner.run("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: repoPath })).ok;
  } catch {
    return false;
  }
};

const refsResolveToSameCommit = async (repoPath: string, left: string, right: string): Promise<boolean> => {
  const [leftSha, rightSha] = await Promise.all([
    resolveCommitSha(repoPath, left),
    resolveCommitSha(repoPath, right),
  ]);
  return Boolean(leftSha && rightSha && leftSha === rightSha);
};

const fastForwardFeatureBranchFromDefault = async (
  repoPath: string,
  branch: string,
  defaultBranch: string,
  localOnly: boolean,
  expectedFeatureCommitSha?: string | null,
): Promise<Exclude<BranchPreparationResult["defaultBranchSync"], undefined>> => {
  const defaultRef = await resolveDefaultBranchRef(repoPath, defaultBranch, localOnly);
  if (!defaultRef || !(await hasLocalBranch(repoPath, branch))) {
    return "failed";
  }

  const featureRefs = [branch];
  if (!localOnly && await remoteTrackingRefExists(repoPath, branch)) {
    featureRefs.push(`origin/${branch}`);
  }

  if (expectedFeatureCommitSha) {
    for (const featureRef of featureRefs) {
      const featureSha = await resolveCommitSha(repoPath, featureRef);
      if (!featureSha) {
        return "failed";
      }
      if (featureSha !== expectedFeatureCommitSha) {
        return "preserved_feature_changes";
      }
    }
  }

  for (const featureRef of featureRefs) {
    if (!(await isAncestor(repoPath, featureRef, defaultRef))) {
      return "preserved_feature_changes";
    }
  }

  if (await refsResolveToSameCommit(repoPath, branch, defaultRef)) {
    return "already_current";
  }

  try {
    const currentBranch = await commandRunner.run("git", ["branch", "--show-current"], { cwd: repoPath });
    if (currentBranch.stdout.trim() === branch) {
      const status = await commandRunner.run("git", ["status", "--porcelain"], { cwd: repoPath });
      if (!status.ok || status.stdout.trim().length > 0) {
        return "failed";
      }
      const merged = await commandRunner.run("git", ["merge", "--ff-only", defaultRef], { cwd: repoPath });
      return merged.ok ? "advanced" : "failed";
    }

    const updated = await commandRunner.run("git", ["branch", "-f", branch, defaultRef], { cwd: repoPath });
    return updated.ok ? "advanced" : "failed";
  } catch {
    return "failed";
  }
};

const pushRemoteBranch = async (
  repoPath: string,
  branch: string,
  options?: BranchPreflightOptions,
): Promise<boolean> => {
  try {
    const result = await runGit(repoPath, ["push", "-u", "origin", `refs/heads/${branch}:refs/heads/${branch}`], options);
    return result.ok;
  } catch {
    return false;
  }
};

export const runBranchPreflightStep = async (
  repoPath: string,
  branch: string,
  options?: BranchPreflightOptions,
): Promise<BranchAvailability> => {
  try {
    const stats = await fs.stat(repoPath);
    if (!stats.isDirectory()) {
      return { existsLocal: false, existsRemote: false };
    }
  } catch {
    return { existsLocal: false, existsRemote: false };
  }

  if (!(await isGitRepository(repoPath))) {
    return { existsLocal: false, existsRemote: false };
  }

  const remoteUrl = shouldResolveAuthEnv(options) && !options?.authEnv
    ? await getRemoteOriginUrl(repoPath)
    : null;
  const resolvedOptions = options?.localOnly
    ? options
    : shouldResolveAuthEnv(options)
      ? await withResolvedAuthEnv(remoteUrl, options)
      : undefined;

  return {
    existsLocal: await hasLocalBranch(repoPath, branch),
    existsRemote: options?.localOnly ? false : await hasRemoteBranch(repoPath, branch, resolvedOptions),
  };
};

export const resolveUniqueSprintBranchName = async (
  repoPath: string,
  candidateBranch: string,
  options?: BranchPreflightOptions,
): Promise<string> => {
  const candidate = candidateBranch.trim();
  if (!candidate) {
    return candidateBranch;
  }

  const remoteUrl = shouldResolveAuthEnv(options) && !options?.authEnv
    ? await getRemoteOriginUrl(repoPath)
    : null;
  const resolvedOptions = options?.localOnly
    ? options
    : shouldResolveAuthEnv(options)
      ? await withResolvedAuthEnv(remoteUrl, options)
      : undefined;

  if (!options?.localOnly) {
    await fetchOrigin(repoPath, resolvedOptions);
  }

  for (let index = 0; index < 1_000; index += 1) {
    const branch = index === 0 ? candidate : `${candidate}-${index}`;
    const existsLocal = await hasLocalBranch(repoPath, branch);
    const existsRemote = options?.localOnly ? false : await hasRemoteBranch(repoPath, branch, resolvedOptions);
    if (!existsLocal && !existsRemote) {
      return branch;
    }
  }

  return `${candidate}-${Date.now().toString(36)}`;
};

export const prepareBranchForOrchestration = async (
  repoPath: string,
  branch: string,
  defaultBranch: string,
  options?: BranchPreflightOptions,
): Promise<BranchPreparationResult> => {
  const remoteUrl = shouldResolveAuthEnv(options) && !options?.authEnv
    ? await getRemoteOriginUrl(repoPath)
    : null;
  const resolvedOptions = options?.localOnly
    ? options
    : shouldResolveAuthEnv(options)
      ? await withResolvedAuthEnv(remoteUrl, options)
      : undefined;
  if (!options?.localOnly) {
    await fetchOrigin(repoPath, resolvedOptions);
  }
  const initial = await runBranchPreflightStep(repoPath, branch, resolvedOptions);
  const remoteOrigin = options?.localOnly ? false : Boolean(remoteUrl) || await hasRemoteOrigin(repoPath);

  let createdLocal = false;
  let checkedOutLocal = false;
  let pushedRemote = false;
  let baseCommitSha: string | null = null;
  let defaultBranchSync: BranchPreparationResult["defaultBranchSync"];

  if (initial.existsLocal) {
    checkedOutLocal = true;
    if (!options?.localOnly) {
      await fastForwardLocalBranchFromOrigin(repoPath, branch);
    }
  } else {
    createdLocal = await createLocalBranch(repoPath, branch, defaultBranch, options?.localOnly);
    checkedOutLocal = createdLocal;
  }

  let existsLocal = initial.existsLocal || createdLocal;
  let existsRemote = initial.existsRemote;

  if (existsLocal && options?.fastForwardFromDefault) {
    defaultBranchSync = await fastForwardFeatureBranchFromDefault(
      repoPath,
      branch,
      defaultBranch,
      options.localOnly === true,
      initial.existsLocal || initial.existsRemote ? options.expectedFeatureCommitSha : null,
    );
  }

  const remoteNeedsUpdate = existsLocal
    && remoteOrigin
    && existsRemote
    && (defaultBranchSync === "advanced" || defaultBranchSync === "already_current")
    && !(await refsResolveToSameCommit(repoPath, branch, `origin/${branch}`));
  if (existsLocal && remoteOrigin && (!existsRemote || remoteNeedsUpdate)) {
    pushedRemote = await pushRemoteBranch(repoPath, branch, resolvedOptions);
    existsRemote = pushedRemote || await hasRemoteBranch(repoPath, branch, resolvedOptions);
    if (remoteNeedsUpdate && !pushedRemote) {
      defaultBranchSync = "failed";
    } else if (remoteNeedsUpdate && pushedRemote) {
      defaultBranchSync = "advanced";
    }
  }

  if ((createdLocal && !initial.existsRemote) || defaultBranchSync === "advanced" || defaultBranchSync === "already_current") {
    // Capture the default-aligned branch tip as the stable sprint fork point. A
    // local tracking branch created from an existing remote feature branch is not
    // assumed to be a clean fork unless the explicit default sync proved it.
    baseCommitSha = await resolveCommitSha(repoPath, branch);
  }

  return {
    existsLocal,
    existsRemote,
    hasRemoteOrigin: remoteOrigin,
    createdLocal,
    checkedOutLocal,
    pushedRemote,
    baseCommitSha,
    ...(defaultBranchSync ? { defaultBranchSync } : {}),
  };
};
