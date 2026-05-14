import { commandRunner } from "../../shared/subprocess/command-runner.js";
import * as fs from "fs/promises";
import { buildGitHttpAuthEnv, type GitHttpAuthOptions } from "../../services/git-http-auth.js";

export interface BranchAvailability {
  existsLocal: boolean;
  existsRemote: boolean;
}

export interface BranchPreparationResult extends BranchAvailability {
  hasRemoteOrigin: boolean;
  createdLocal: boolean;
  checkedOutLocal: boolean;
  pushedRemote: boolean;
}

export interface BranchPreflightOptions extends GitHttpAuthOptions {
  authEnv?: NodeJS.ProcessEnv;
  networkTimeoutMs?: number;
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

const withResolvedAuthEnv = (
  remoteUrl: string | null,
  options?: BranchPreflightOptions,
): BranchPreflightOptions | undefined => {
  const authEnv = options?.authEnv || buildNonInteractiveHttpEnv(remoteUrl, options);
  if (!authEnv && !options) {
    return undefined;
  }
  return {
    ...options,
    authEnv,
  };
};

const isHttpRemote = (remoteUrl: string): boolean => /^https?:\/\//i.test(remoteUrl.trim());

const buildNonInteractiveHttpEnv = (
  remoteUrl: string | null,
  options?: BranchPreflightOptions,
): NodeJS.ProcessEnv | undefined => {
  const normalizedRemote = remoteUrl?.trim();
  if (!normalizedRemote || !isHttpRemote(normalizedRemote)) {
    return options?.authEnv;
  }

  return {
    ...(buildGitHttpAuthEnv(normalizedRemote, options) || process.env),
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "true",
    SSH_ASKPASS: "true",
    GCM_INTERACTIVE: "never",
  };
};

const shouldResolveAuthEnv = (options?: BranchPreflightOptions): boolean => Boolean(options);

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

const remoteTrackingRefExists = async (repoPath: string, branch: string): Promise<boolean> => {
  try {
    const result = await commandRunner.run("git", ["show-ref", "--verify", `refs/remotes/origin/${branch}`], { cwd: repoPath });
    return result.ok;
  } catch {
    return false;
  }
};

const createLocalBranch = async (repoPath: string, branch: string, defaultBranch: string): Promise<boolean> => {
  try {
    if (await remoteTrackingRefExists(repoPath, branch)) {
      const result = await commandRunner.run("git", ["branch", "--track", branch, `origin/${branch}`], { cwd: repoPath });
      return result.ok;
    }

    const hasRemoteDefaultBranch = await commandRunner.run("git", ["show-ref", "--verify", `refs/remotes/origin/${defaultBranch}`], { cwd: repoPath });
    if (hasRemoteDefaultBranch.ok) {
      const result = await commandRunner.run("git", ["branch", branch, `origin/${defaultBranch}`], { cwd: repoPath });
      return result.ok;
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
  const resolvedOptions = shouldResolveAuthEnv(options)
    ? withResolvedAuthEnv(remoteUrl, options)
    : undefined;

  return {
    existsLocal: await hasLocalBranch(repoPath, branch),
    existsRemote: await hasRemoteBranch(repoPath, branch, resolvedOptions),
  };
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
  const resolvedOptions = shouldResolveAuthEnv(options)
    ? withResolvedAuthEnv(remoteUrl, options)
    : undefined;
  await fetchOrigin(repoPath, resolvedOptions);
  const initial = await runBranchPreflightStep(repoPath, branch, resolvedOptions);
  const remoteOrigin = Boolean(remoteUrl) || await hasRemoteOrigin(repoPath);

  let createdLocal = false;
  let checkedOutLocal = false;
  let pushedRemote = false;

  if (initial.existsLocal) {
    checkedOutLocal = true;
    await fastForwardLocalBranchFromOrigin(repoPath, branch);
  } else {
    createdLocal = await createLocalBranch(repoPath, branch, defaultBranch);
    checkedOutLocal = createdLocal;
  }

  let existsLocal = initial.existsLocal || createdLocal;
  let existsRemote = initial.existsRemote;

  if (existsLocal && remoteOrigin && !existsRemote) {
    pushedRemote = await pushRemoteBranch(repoPath, branch, resolvedOptions);
    existsRemote = pushedRemote || await hasRemoteBranch(repoPath, branch, resolvedOptions);
  }

  return {
    existsLocal,
    existsRemote,
    hasRemoteOrigin: remoteOrigin,
    createdLocal,
    checkedOutLocal,
    pushedRemote,
  };
};
