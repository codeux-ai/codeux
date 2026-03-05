import { commandRunner } from "../../shared/subprocess/command-runner.js";
import * as fs from "fs/promises";

export interface BranchAvailability {
  existsLocal: boolean;
  existsRemote: boolean;
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
