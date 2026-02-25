import { execFileSync } from "child_process";
import * as fs from "fs";

export interface BranchAvailability {
  existsLocal: boolean;
  existsRemote: boolean;
}

const isGitRepository = (repoPath: string): boolean => {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repoPath, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const hasLocalBranch = (repoPath: string, branch: string): boolean => {
  try {
    execFileSync("git", ["show-ref", "--verify", `refs/heads/${branch}`], { cwd: repoPath, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const hasRemoteBranch = (repoPath: string, branch: string): boolean => {
  try {
    const output = execFileSync("git", ["ls-remote", "--heads", "origin", branch], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
};

export const runBranchPreflightStep = (repoPath: string, branch: string): BranchAvailability => {
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    return { existsLocal: false, existsRemote: false };
  }

  if (!isGitRepository(repoPath)) {
    return { existsLocal: false, existsRemote: false };
  }

  return {
    existsLocal: hasLocalBranch(repoPath, branch),
    existsRemote: hasRemoteBranch(repoPath, branch),
  };
};
