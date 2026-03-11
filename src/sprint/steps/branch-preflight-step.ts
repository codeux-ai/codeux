import { commandRunner } from "../../shared/subprocess/command-runner.js";
import * as fs from "fs/promises";

export interface BranchAvailability {
  existsLocal: boolean;
  existsRemote: boolean;
}

export interface BranchPreflightAutomationResult extends BranchAvailability {
  ready: boolean;
  action:
    | "checked_out_existing_local"
    | "checked_out_remote_tracking"
    | "pushed_existing_local"
    | "created_and_pushed";
  summary: string;
}

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

const hasRemoteBranch = async (repoPath: string, branch: string): Promise<boolean> => {
  try {
    const result = await commandRunner.run("git", ["ls-remote", "--heads", "origin", branch], { cwd: repoPath });
    return result.ok && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
};

export const runBranchPreflightStep = async (repoPath: string, branch: string): Promise<BranchAvailability> => {
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

  return {
    existsLocal: await hasLocalBranch(repoPath, branch),
    existsRemote: await hasRemoteBranch(repoPath, branch),
  };
};

async function ensureRepoReady(repoPath: string): Promise<void> {
  const stats = await fs.stat(repoPath).catch(() => null);
  if (!stats?.isDirectory()) {
    throw new Error(`Project repo path does not exist or is not a directory: ${repoPath}`);
  }

  if (!(await isGitRepository(repoPath))) {
    throw new Error(`Project repo path is not a git repository: ${repoPath}`);
  }
}

async function checkoutExistingLocalBranch(repoPath: string, branch: string): Promise<void> {
  await commandRunner.runStrict("git", ["checkout", branch], { cwd: repoPath });
}

async function checkoutRemoteTrackingBranch(repoPath: string, branch: string): Promise<void> {
  await commandRunner.runStrict("git", ["fetch", "origin", branch], { cwd: repoPath });
  await commandRunner.runStrict("git", ["checkout", "-b", branch, "--track", `origin/${branch}`], { cwd: repoPath });
}

async function pushExistingLocalBranch(repoPath: string, branch: string): Promise<void> {
  await commandRunner.runStrict("git", ["checkout", branch], { cwd: repoPath });
  await commandRunner.runStrict("git", ["push", "-u", "origin", branch], { cwd: repoPath });
}

async function createAndPushBranch(repoPath: string, branch: string, defaultBranch: string): Promise<void> {
  const remoteDefaultExists = await hasRemoteBranch(repoPath, defaultBranch);
  const localDefaultExists = await hasLocalBranch(repoPath, defaultBranch);

  if (remoteDefaultExists) {
    await commandRunner.runStrict("git", ["fetch", "origin", defaultBranch], { cwd: repoPath });
    await commandRunner.runStrict("git", ["checkout", "-B", branch, `origin/${defaultBranch}`], { cwd: repoPath });
  } else if (localDefaultExists) {
    await commandRunner.runStrict("git", ["checkout", defaultBranch], { cwd: repoPath });
    await commandRunner.runStrict("git", ["checkout", "-b", branch], { cwd: repoPath });
  } else {
    throw new Error(`Default branch ${defaultBranch} was not found locally or on origin.`);
  }

  await commandRunner.runStrict("git", ["push", "-u", "origin", branch], { cwd: repoPath });
}

export async function ensureSprintBranchReady(
  repoPath: string,
  branch: string,
  defaultBranch: string,
): Promise<BranchPreflightAutomationResult> {
  await ensureRepoReady(repoPath);
  const availability = await runBranchPreflightStep(repoPath, branch);

  if (availability.existsLocal && availability.existsRemote) {
    await checkoutExistingLocalBranch(repoPath, branch);
    return {
      ...availability,
      ready: true,
      action: "checked_out_existing_local",
      summary: `Checked out existing sprint branch ${branch}.`,
    };
  }

  if (!availability.existsLocal && availability.existsRemote) {
    await checkoutRemoteTrackingBranch(repoPath, branch);
    return {
      existsLocal: true,
      existsRemote: true,
      ready: true,
      action: "checked_out_remote_tracking",
      summary: `Checked out local tracking branch for origin/${branch}.`,
    };
  }

  if (availability.existsLocal && !availability.existsRemote) {
    await pushExistingLocalBranch(repoPath, branch);
    return {
      existsLocal: true,
      existsRemote: true,
      ready: true,
      action: "pushed_existing_local",
      summary: `Pushed existing local sprint branch ${branch} to origin.`,
    };
  }

  await createAndPushBranch(repoPath, branch, defaultBranch);
  return {
    existsLocal: true,
    existsRemote: true,
    ready: true,
    action: "created_and_pushed",
    summary: `Created sprint branch ${branch} from ${defaultBranch} and pushed it to origin.`,
  };
}
