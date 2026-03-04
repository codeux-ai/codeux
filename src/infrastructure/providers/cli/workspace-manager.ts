import * as fs from "fs/promises";
import * as path from "path";
import os from "os";
import { createHash } from "crypto";
import { sanitizeToken } from "../../../services/cli-workflow-utils.js";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
import { runCommandStrict } from "../../../services/cli-process-runner.js";
import { extractPathHints } from "../../../services/cli-workflow-text-utils.js";

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
      return path.join(repoPath, ".jules-subagents", "worktrees", sanitizeToken(sessionId));
    }
    const normalizedRepoPath = path.resolve(repoPath);
    const repoName = sanitizeToken(path.basename(normalizedRepoPath)) || "repo";
    const repoHash = createHash("sha256").update(normalizedRepoPath).digest("hex").slice(0, 12);
    return path.join(
      os.homedir(),
      ".jules-subagents",
      "worktrees",
      `${repoName}-${repoHash}`,
      sanitizeToken(sessionId)
    );
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
    if (executionMode !== "DOCKER") {
      const legacy = path.join(repoPath, ".jules-subagents", "worktrees", sanitizeToken(sessionId));
      if (await this.pathExists(legacy)) {
        return legacy;
      }
      return primary;
    }
    return undefined;
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
      await runCommandStrict("git", ["fetch", "origin"], repoPath);

      if (resumeSessionId) {
        const resumablePath = await this.resolveResumableWorktreePath(repoPath, workerBranch, finalWorktreePath);
        if (resumablePath) {
          finalWorktreePath = resumablePath;
          resumed = true;
          return;
        }
      }

      await this.removeWorktreeInternal(repoPath, finalWorktreePath);
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
