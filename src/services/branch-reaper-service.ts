import { runCommandStrict } from "./cli-process-runner.js";
import type { Logger } from "../shared/logging/logger.js";

/** Git config the reaper needs for one project, resolved from effective settings. */
export interface ReaperProjectGit {
  deleteMergedBranches: boolean;
  defaultBranch: string;
  featureBranchPrefix: string;
}

export interface BranchReaperServiceDeps {
  listProjects: () => Array<{ id: string; baseDir: string }>;
  resolveProjectGit: (projectId: string) => ReaperProjectGit | null;
  logger?: Logger;
}

export interface BranchReaperResult {
  reapedCount: number;
  reapedByProject: Record<string, number>;
}

const DELETE_BATCH_SIZE = 100;
/** Worker branches are created under `task/...` (see buildWorkerBranchPrefix). */
const WORKER_BRANCH_PREFIX = "task/";

/**
 * Deletes local Code UX-managed branches whose work is already contained in the project's default
 * branch. Long-lived repos accumulate thousands of per-task (`task/...`) and per-sprint
 * (`<featureBranchPrefix>...`) branches; once merged into the default branch they hold no unique
 * commits, so removing them is lossless and keeps git operations (notably the workspace seed, which
 * fetches every ref) cheap. Only fully-merged, managed branches are touched — never the default
 * branch, the checked-out branch, or the user's own branches.
 */
export class BranchReaperService {
  constructor(private readonly deps: BranchReaperServiceDeps) {}

  async reapOnStartup(): Promise<BranchReaperResult> {
    const reapedByProject: Record<string, number> = {};
    let reapedCount = 0;

    const seenRepos = new Set<string>();
    for (const project of this.deps.listProjects()) {
      // Several projects can point at the same checkout; only reap each repo once.
      if (!project.baseDir || seenRepos.has(project.baseDir)) {
        continue;
      }
      seenRepos.add(project.baseDir);

      const git = this.deps.resolveProjectGit(project.id);
      if (!git || !git.deleteMergedBranches) {
        continue;
      }
      const count = await this.reapProject(project.baseDir, git).catch((error) => {
        this.deps.logger?.debug("Branch reaper skipped a project", {
          projectId: project.id,
          error: error instanceof Error ? error.message : String(error),
        });
        return 0;
      });
      if (count > 0) {
        reapedByProject[project.id] = count;
        reapedCount += count;
      }
    }

    if (reapedCount > 0) {
      this.deps.logger?.info("Reaped merged Code UX branches on startup", { reapedCount });
    }
    return { reapedCount, reapedByProject };
  }

  private async reapProject(baseDir: string, git: ReaperProjectGit): Promise<number> {
    const defaultBranch = git.defaultBranch.trim();
    if (!defaultBranch) {
      return 0;
    }
    // Only proceed for a real git checkout that has the default branch locally.
    const hasDefault = await runCommandStrict("git", ["show-ref", "--verify", "--quiet", `refs/heads/${defaultBranch}`], baseDir)
      .then(() => true)
      .catch(() => false);
    if (!hasDefault) {
      return 0;
    }

    const merged = await runCommandStrict("git", ["branch", "--merged", defaultBranch, "--format=%(refname:short)"], baseDir)
      .catch(() => null);
    if (!merged) {
      return 0;
    }
    const current = (await runCommandStrict("git", ["rev-parse", "--abbrev-ref", "HEAD"], baseDir).catch(() => null))?.stdout.trim();

    const candidates = merged.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((name) => Boolean(name)
        && name !== defaultBranch
        && name !== current
        && this.isManagedBranch(name, git.featureBranchPrefix));

    let deleted = 0;
    for (let index = 0; index < candidates.length; index += DELETE_BATCH_SIZE) {
      const batch = candidates.slice(index, index + DELETE_BATCH_SIZE);
      // `-d` refuses unmerged branches; `--merged` already guarantees these are merged, but `-d`
      // keeps the operation conservative against any race with concurrent branch updates.
      const result = await runCommandStrict("git", ["branch", "-d", ...batch], baseDir).catch(() => null);
      if (result?.ok) {
        deleted += batch.length;
      } else {
        // A batch can fail if one branch became unmergeable mid-pass; fall back to per-branch.
        for (const branch of batch) {
          const single = await runCommandStrict("git", ["branch", "-d", branch], baseDir).catch(() => null);
          if (single?.ok) {
            deleted += 1;
          }
        }
      }
    }
    return deleted;
  }

  private isManagedBranch(name: string, featureBranchPrefix: string): boolean {
    const featurePrefix = featureBranchPrefix.trim();
    return name.startsWith(WORKER_BRANCH_PREFIX) || (featurePrefix.length > 0 && name.startsWith(featurePrefix));
  }
}
