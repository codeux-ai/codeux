import * as fs from "fs/promises";
import * as path from "path";
import { createHash } from "crypto";
import { sanitizeToken } from "../../../services/cli-workflow-utils.js";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
import { runCommandStrict } from "../../../services/cli-process-runner.js";
import { extractPathHints } from "../../../services/cli-workflow-text-utils.js";
import { getHomeSprintOsPath, getRepoSprintOsPath } from "../../../shared/config/sprint-os-paths.js";

export interface IWorkspaceManager {
  buildWorktreePath(repoPath: string, sessionId: string, executionMode: CliWorkflowSettings["executionMode"]): string;
  resolveResumeWorktreePath(repoPath: string, sessionId: string, executionMode: CliWorkflowSettings["executionMode"]): Promise<string | undefined>;
  prepareWorktree(repoPath: string, worktreePath: string, workerBranch: string, featureBranch: string, resumeSessionId?: string): Promise<{ worktreePath: string; resumed: boolean }>;
  removeWorktree(repoPath: string, worktreePath: string): Promise<void>;
  buildWorkspaceGuidance(taskPrompt: string, worktreePath: string): Promise<string>;
}

export class WorkspaceManager implements IWorkspaceManager {
  private readonly repoLocks = new Map<string, Promise<void>>();

  buildWorktreePath(repoPath: string, sessionId: string, executionMode: CliWorkflowSettings["executionMode"]): string {
    if (executionMode === "DOCKER") {
      return getRepoSprintOsPath(repoPath, "worktrees", sanitizeToken(sessionId));
    }
    const normalizedRepoPath = path.resolve(repoPath);
    const repoName = sanitizeToken(path.basename(normalizedRepoPath)) || "repo";
    const repoHash = createHash("sha256").update(normalizedRepoPath).digest("hex").slice(0, 12);
    return getHomeSprintOsPath("worktrees", `${repoName}-${repoHash}`, sanitizeToken(sessionId));
  }

  async resolveResumeWorktreePath(
    repoPath: string,
    sessionId: string,
    executionMode: CliWorkflowSettings["executionMode"]
  ): Promise<string | undefined> {
    const primary = this.buildWorktreePath(repoPath, sessionId, executionMode);
    if (await this.pathExists(primary)) {
      return primary;
    }
    return executionMode !== "DOCKER" ? primary : undefined;
  }

  async prepareWorktree(
    repoPath: string,
    worktreePath: string,
    workerBranch: string,
    featureBranch: string,
    resumeSessionId?: string
  ): Promise<{ worktreePath: string; resumed: boolean }> {
    let resumed = false;
    let finalWorktreePath = worktreePath;

    await this.withRepoLock(repoPath, async () => {
      await fs.mkdir(path.dirname(finalWorktreePath), { recursive: true });
      await runCommandStrict("git", ["worktree", "prune"], repoPath);
      try {
        await runCommandStrict("git", ["fetch", "origin"], repoPath);
      } catch {
        // Fetch can fail when stale worktrees or dangling branch refs
        // reference bad objects. Clean up and retry.
        await this.repairStaleGitState(repoPath);
        await runCommandStrict("git", ["fetch", "origin"], repoPath);
      }

      if (resumeSessionId) {
        const resumablePath = await this.resolveResumableWorktreePath(repoPath, workerBranch, finalWorktreePath);
        if (resumablePath) {
          finalWorktreePath = resumablePath;
          resumed = true;
          return;
        }
      }

      await this.removeWorktreeInternal(repoPath, finalWorktreePath);
      // Remove any existing worktree that has the target branch checked out
      // (e.g. from a previous failed merge attempt with a different session ID)
      const existingWorktree = await this.findWorktreePathForBranch(repoPath, workerBranch);
      if (existingWorktree) {
        await this.removeWorktreeInternal(repoPath, existingWorktree);
      }
      await runCommandStrict("git", ["worktree", "prune"], repoPath);
      await runCommandStrict(
        "git",
        ["worktree", "add", "--force", "-B", workerBranch, finalWorktreePath, `origin/${featureBranch}`],
        repoPath
      );
    });

    return { worktreePath: finalWorktreePath, resumed };
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    await this.withRepoLock(repoPath, async () => {
      await this.removeWorktreeInternal(repoPath, worktreePath);
    });
  }

  private async removeWorktreeInternal(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await runCommandStrict("git", ["worktree", "remove", "--force", worktreePath], repoPath);
    } catch {
      // ignore
    }
    await fs.rm(worktreePath, { recursive: true, force: true });
  }

  async buildWorkspaceGuidance(taskPrompt: string, worktreePath: string): Promise<string> {
    const repoRoot = (await runCommandStrict("git", ["rev-parse", "--show-toplevel"], worktreePath)).stdout.trim();
    const hints = extractPathHints(taskPrompt).slice(0, 10);
    const hintStatuses = await Promise.all(
      hints.map(async (hint) => {
        const safePath = path.resolve(worktreePath, hint);
        if (!safePath.startsWith(worktreePath)) {
          return `- ${hint}: outside-workspace`;
        }
        try {
          await fs.access(safePath);
          return `- ${hint}: exists`;
        } catch {
          return `- ${hint}: not-found`;
        }
      })
    );

    const hintSection = hintStatuses.length > 0
      ? [
        "Task path hints (from prompt) with existence pre-check:",
        ...hintStatuses,
      ].join("\n")
      : "Task path hints (from prompt): none detected.";

    return [
      "## Workspace Context (Headless Session)",
      `Repository root: ${repoRoot}`,
      `Current working directory: ${worktreePath}`,
      "",
      "Path safety requirements:",
      "- Before any read_file call, discover exact paths first (glob/grep/find).",
      "- Use repo-relative paths from the repository root shown above.",
      "- Do not assume filenames or directories. Verify existence before reading.",
      "- If a hinted path is not found, locate the nearest real file and continue.",
      "",
      hintSection,
    ].join("\n");
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveResumableWorktreePath(repoPath: string, expectedBranch: string, preferredPath: string): Promise<string | undefined> {
    if (await this.canResumeExistingWorktree(preferredPath, expectedBranch)) {
      return preferredPath;
    }
    const branchWorktreePath = await this.findWorktreePathForBranch(repoPath, expectedBranch);
    if (branchWorktreePath && branchWorktreePath !== preferredPath) {
      if (await this.canResumeExistingWorktree(branchWorktreePath, expectedBranch)) {
        return branchWorktreePath;
      }
      await this.removeStaleWorktreeRegistration(repoPath, branchWorktreePath);
    }
    return undefined;
  }

  private async canResumeExistingWorktree(worktreePath: string, expectedBranch: string): Promise<boolean> {
    try {
      await fs.access(worktreePath);
      const result = await runCommandStrict("git", ["rev-parse", "--is-inside-work-tree"], worktreePath);
      if (result.stdout.trim() !== "true") return false;
      const currentBranch = (await runCommandStrict("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktreePath)).stdout.trim();
      if (currentBranch !== expectedBranch) {
        await runCommandStrict("git", ["checkout", expectedBranch], worktreePath);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async findWorktreePathForBranch(repoPath: string, branch: string): Promise<string | undefined> {
    const listing = await runCommandStrict("git", ["worktree", "list", "--porcelain"], repoPath);
    const targetRef = `refs/heads/${branch}`;
    let currentPath: string | undefined;

    for (const rawLine of listing.stdout.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("worktree ")) {
        currentPath = line.slice("worktree ".length).trim();
        continue;
      }
      if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        if (ref === targetRef && currentPath) return currentPath;
      }
      if (line.length === 0) currentPath = undefined;
    }
    return undefined;
  }

  private async repairStaleGitState(repoPath: string): Promise<void> {
    // 1. Remove stale worktree registrations whose physical dirs are gone.
    const gitWorktreesDir = path.join(repoPath, ".git", "worktrees");
    try {
      const entries = await fs.readdir(gitWorktreesDir);
      for (const entry of entries) {
        const entryPath = path.join(gitWorktreesDir, entry);
        const gitdirFile = path.join(entryPath, "gitdir");
        try {
          const gitdir = (await fs.readFile(gitdirFile, "utf-8")).trim();
          await fs.access(gitdir);
        } catch {
          await fs.rm(entryPath, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    } catch { /* worktrees dir may not exist */ }
    try {
      await runCommandStrict("git", ["worktree", "prune"], repoPath);
    } catch { /* ignore */ }

    // 2. Remove broken local branch refs by scanning the filesystem directly.
    //    git for-each-ref silently skips refs it can't parse (e.g. empty files),
    //    so we must walk refs/heads/ ourselves.
    await this.removeCorruptRefsInDir(repoPath, path.join(repoPath, ".git", "refs", "heads"));
  }

  private async removeCorruptRefsInDir(repoPath: string, dirPath: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.removeCorruptRefsInDir(repoPath, fullPath);
        continue;
      }
      try {
        const content = (await fs.readFile(fullPath, "utf-8")).trim();
        if (!content || !/^[0-9a-f]{40}$/.test(content)) {
          // Empty or malformed ref file — remove it.
          await fs.rm(fullPath, { force: true }).catch(() => undefined);
          continue;
        }
        await runCommandStrict("git", ["cat-file", "-t", content], repoPath);
      } catch {
        await fs.rm(fullPath, { force: true }).catch(() => undefined);
      }
    }
  }

  private async removeStaleWorktreeRegistration(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await runCommandStrict("git", ["worktree", "remove", "--force", worktreePath], repoPath);
    } catch { /* ignore */ }
    try {
      await runCommandStrict("git", ["worktree", "prune"], repoPath);
    } catch { /* ignore */ }
  }

  private async withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
    const current = this.repoLocks.get(repoPath) || Promise.resolve();
    let releaseLock: () => void = () => { };
    const next = new Promise<void>((resolve) => { releaseLock = resolve; });
    const queueEntry = current.then(() => next);
    this.repoLocks.set(repoPath, queueEntry);
    await current;
    try {
      return await fn();
    } finally {
      releaseLock();
      if (this.repoLocks.get(repoPath) === queueEntry) this.repoLocks.delete(repoPath);
    }
  }
}
