import { createHash, randomUUID } from "crypto";
import * as fs from "fs/promises";
import os from "os";
import * as path from "path";
import type { CliWorkflowSettings, DashboardSettings, JulesSession, ProviderId, Subtask } from "../contracts/app-types.js";
import { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import { runCommandStrict, runStreamingCommand, type CommandResult } from "./cli-process-runner.js";
import {
  getDockerUserSpec,
  getProviderFallbackInstallCommand,
  isDockerWorkspaceMountError,
  mapPathPrefix,
  pickContainerEnv,
  resolveConfiguredPath,
  toDockerMountArg,
  type ContainerMount,
} from "./cli-docker-utils.js";
import { buildReadFileRetryPrompt, extractPathHints, isReadFileNotFoundToolError } from "./cli-workflow-text-utils.js";
import {
  buildProviderPrompt,
  buildWorkerBranch,
  CONTAINER_SETUP_SCRIPT,
  DEFAULT_CLI_WORKFLOW_SETTINGS,
  sanitizeToken,
} from "./cli-workflow-utils.js";

const CODEX_CREDENTIALS_MOUNT = "/opt/credentials/codex";
const GITHUB_CREDENTIALS_MOUNT = "/opt/credentials/gh";
const GEMINI_CREDENTIALS_MOUNT = "/opt/credentials/gemini";
const CLAUDE_CODE_CREDENTIALS_MOUNT = "/opt/credentials/claude-code";
const CLAUDE_CODE_AUTH_JSON_MOUNT = "/opt/credentials/claude-code-auth.json";
const GITCONFIG_CREDENTIALS_MOUNT = "/opt/credentials/gitconfig";

interface CliWorkflowServiceDependencies {
  sessionTracking: SessionTrackingRepository;
  getDashboardSettings: () => DashboardSettings;
  getGuideContent: (guideName: string, repoPath?: string) => Promise<string>;
  getGithubToken: () => string | undefined;
}

interface StartCliTaskInput {
  provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
  task: Subtask;
  repoPath: string;
  featureBranch: string;
  sprintNumber: number;
}

export class CliWorkflowService {
  private readonly repoLocks = new Map<string, Promise<void>>();
  private readonly dockerHintLoggedSessions = new Set<string>();

  constructor(private readonly deps: CliWorkflowServiceDependencies) { }

  async startTask(input: StartCliTaskInput): Promise<JulesSession> {
    const settings = this.deps.getDashboardSettings();
    const workflowSettings = this.resolveWorkflowSettings(settings);

    const sessionId = `cli-${input.provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const resumeTarget = workflowSettings.resumeFailedTaskInSameWorkspace
      ? this.deps.sessionTracking.findLatestFailedCliSessionForTask({
        provider: input.provider,
        taskId: input.task.id,
        featureBranch: input.featureBranch,
        repoPath: input.repoPath,
      })
      : null;
    const workerBranch = resumeTarget?.workerBranch || buildWorkerBranch(input.featureBranch, input.task.id, input.provider);
    const resumeWorktreePath = resumeTarget
      ? await this.resolveResumeWorktreePath(input.repoPath, resumeTarget.sessionId, workflowSettings.executionMode)
      : undefined;
    const title = `Sprint ${input.sprintNumber}: [${input.task.id}] ${input.task.title}`;

    const session = this.deps.sessionTracking.createSession({
      id: sessionId,
      provider: input.provider,
      taskId: input.task.id,
      title,
      prompt: input.task.prompt,
      state: "RUNNING",
      featureBranch: input.featureBranch,
      workerBranch,
      repoPath: input.repoPath,
    });
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `Started ${input.provider} background workflow on branch ${workerBranch}.`,
    });
    if (resumeTarget) {
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: resumeWorktreePath
          ? `Retry configured to resume failed workspace from ${resumeTarget.sessionId} at ${resumeWorktreePath}.`
          : `Retry configured to resume failed workspace from ${resumeTarget.sessionId}.`,
      });
    }

    void this.runTaskWorkflow({
      ...input,
      sessionId,
      workerBranch,
      title,
      resumeFromFailedSessionId: resumeTarget?.sessionId,
      resumeWorktreePath,
    });

    return session;
  }

  private async runTaskWorkflow(args: StartCliTaskInput & {
    sessionId: string;
    workerBranch: string;
    title: string;
    resumeFromFailedSessionId?: string;
    resumeWorktreePath?: string;
  }): Promise<void> {
    const workspaceSessionId = args.resumeFromFailedSessionId || args.sessionId;
    let worktreePath = args.resumeWorktreePath || "";
    let workflowSucceeded = false;
    let cleanupWorktreeOnSuccess = true;
    let cleanupWorktreeOnFailure = false;
    let resumedExistingWorkspace = false;
    try {
      const settings = this.deps.getDashboardSettings();
      const workflowSettings = this.resolveWorkflowSettings(settings);
      const preferredWorktreePath = this.buildWorktreePath(args.repoPath, workspaceSessionId, workflowSettings.executionMode);
      worktreePath = worktreePath || preferredWorktreePath;
      if (workflowSettings.executionMode === "DOCKER" && !this.isDockerCompatibleWorktreePath(args.repoPath, worktreePath)) {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: `Skipping resume workspace outside repository for Docker mode: ${worktreePath}. Creating Docker-compatible workspace path.`,
        });
        worktreePath = preferredWorktreePath;
      }
      cleanupWorktreeOnSuccess = workflowSettings.cleanupWorktreeOnSuccess;
      cleanupWorktreeOnFailure = workflowSettings.cleanupWorktreeOnFailure;
      const providerSettings = settings.aiProvider.providers[args.provider];
      let workerGuide = "";
      try {
        workerGuide = await this.deps.getGuideContent("worker.md", args.repoPath);
      } catch {
        // optional
      }

      const promptBody = workerGuide
        ? `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerGuide}\n\n---\n\n## SUBTASK TO EXECUTE\n\n${args.task.prompt}`
        : args.task.prompt;

      await this.withRepoLock(args.repoPath, async () => {
        await fs.mkdir(path.dirname(worktreePath), { recursive: true });
        await this.runCommand("git", ["fetch", "origin"], args.repoPath);
        if (args.resumeFromFailedSessionId) {
          const resumablePath = await this.resolveResumableWorktreePath(
            args.repoPath,
            args.workerBranch,
            worktreePath,
            workflowSettings.executionMode
          );
          if (resumablePath) {
            worktreePath = resumablePath;
            resumedExistingWorkspace = true;
            return;
          }
        }
        await this.removeWorktree(args.repoPath, worktreePath);
        await this.runCommand("git", ["worktree", "prune"], args.repoPath);
        await this.runCommand(
          "git",
          ["worktree", "add", "--force", "-B", args.workerBranch, worktreePath, `origin/${args.featureBranch}`],
          args.repoPath
        );
      });
      const workspaceGuidance = await this.buildWorkspaceGuidance(args.task.prompt, worktreePath);
      const providerPrompt = buildProviderPrompt(
        `${promptBody}\n\n${workspaceGuidance}`,
        providerSettings.thinkingMode
      );
      const initialHead = (await this.runCommand("git", ["rev-parse", "HEAD"], worktreePath)).stdout.trim();
      if (resumedExistingWorkspace) {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: `Resumed failed workspace from ${args.resumeFromFailedSessionId} on branch ${args.workerBranch}.`,
        });
        try {
          await this.runCommand("git", ["merge", "--ff-only", `origin/${args.featureBranch}`], worktreePath);
          this.deps.sessionTracking.appendActivity(args.sessionId, {
            originator: "system",
            description: `Synced resumed workspace with latest origin/${args.featureBranch} (fast-forward).`,
          });
        } catch {
          this.deps.sessionTracking.appendActivity(args.sessionId, {
            originator: "system",
            description: `Resumed workspace has task commits and could not fast-forward to origin/${args.featureBranch}; continuing on existing branch state.`,
          });
        }
      } else if (args.resumeFromFailedSessionId) {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: `Resume target ${args.resumeFromFailedSessionId} was unavailable. Started a fresh workspace.`,
        });
      }

      this.deps.sessionTracking.appendActivity(args.sessionId, {
        originator: "system",
        description: `Running ${args.provider} prompt on ${args.workerBranch} (workspace: ${worktreePath}).`,
      });

      const runProvider = (prompt: string): Promise<CommandResult> => {
        if (args.provider === "gemini") {
          return this.runGemini(prompt, worktreePath, providerSettings.model, providerSettings.apiKey, args.sessionId, workflowSettings, args.repoPath);
        }
        if (args.provider === "claude-code") {
          return this.runClaudeCode(prompt, worktreePath, providerSettings.model, providerSettings.apiKey, args.sessionId, workflowSettings, args.repoPath);
        }
        return this.runCodex(prompt, worktreePath, providerSettings.model, providerSettings.apiKey, args.sessionId, workflowSettings, args.repoPath);
      };

      let providerResult = await runProvider(providerPrompt);
      if (!providerResult.ok && workflowSettings.retryOnReadFileNotFound && isReadFileNotFoundToolError(providerResult)) {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: "Provider failed on missing file during tool read. Retrying once with file-discovery guidance.",
        });
        providerResult = await runProvider(buildReadFileRetryPrompt(providerPrompt));
      }

      if (!providerResult.ok) {
        throw new Error(providerResult.stderr || providerResult.stdout || `${args.provider} command failed`);
      }

      const currentBranch = (await this.runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktreePath)).stdout.trim();
      if (currentBranch !== args.workerBranch) {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: `Provider changed branch to ${currentBranch}. Switching back to ${args.workerBranch}.`,
        });
        await this.runCommand("git", ["checkout", args.workerBranch], worktreePath);
      }

      const finalHead = (await this.runCommand("git", ["rev-parse", "HEAD"], worktreePath)).stdout.trim();
      const statusResult = await this.runCommand("git", ["status", "--porcelain"], worktreePath);
      const hasWorkingTreeChanges = statusResult.stdout.trim().length > 0;
      const hasCommittedChanges = finalHead !== initialHead;
      const hasUnpushedCommits = await this.hasUnpushedWorkerBranchCommits(
        worktreePath,
        args.workerBranch,
        args.featureBranch
      );
      const hasWorkerBranchCommitsForPr = await this.hasWorkerBranchCommitsAgainstFeature(
        worktreePath,
        args.featureBranch
      );

      if (!hasWorkingTreeChanges && !hasCommittedChanges && !hasUnpushedCommits && !hasWorkerBranchCommitsForPr) {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: `No file changes produced by ${args.provider}.`,
        });
        this.deps.sessionTracking.updateSession(args.sessionId, { state: "COMPLETED" });
        workflowSucceeded = true;
        return;
      }

      if (hasWorkingTreeChanges) {
        await this.runCommand("git", ["add", "-A"], worktreePath);
        await this.runCommand(
          "git",
          ["commit", "-m", `feat(task ${args.task.id}): implement via ${args.provider}`],
          worktreePath
        );
      } else {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: hasUnpushedCommits
            ? "Detected existing unpushed commit(s) without pending working tree changes."
            : hasWorkerBranchCommitsForPr
              ? "Detected existing worker-branch commit(s) ahead of feature branch without pending working tree changes."
              : `Detected provider-created commit(s) without pending working tree changes.`,
        });
      }
      await this.runCommand("git", ["push", "-u", "origin", args.workerBranch], worktreePath);

      let prUrl: string | undefined;
      if (settings.git.autoCreatePr) {
        prUrl = await this.resolveOrCreateFeaturePr(
          {
            taskId: args.task.id,
            provider: args.provider,
            title: args.title,
            featureBranch: args.featureBranch,
            workerBranch: args.workerBranch,
          },
          worktreePath
        );
        if (!prUrl) {
          this.deps.sessionTracking.appendActivity(args.sessionId, {
            originator: "system",
            description: "Workflow completed, but no PR URL could be resolved or created automatically.",
          });
        }
      }

      this.deps.sessionTracking.updateSession(args.sessionId, {
        state: "COMPLETED",
        prUrl,
      });
      this.deps.sessionTracking.appendActivity(args.sessionId, {
        originator: "system",
        description: prUrl
          ? `Workflow completed. PR created: ${prUrl}`
          : "Workflow completed.",
      });
      workflowSucceeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.sessionTracking.updateSession(args.sessionId, { state: "FAILED" });
      this.deps.sessionTracking.appendActivity(args.sessionId, {
        originator: "system",
        description: `Workflow failed: ${message}`,
      });
      console.error(`[CLI Workflow] ${args.sessionId} failed: ${message}`);
    } finally {
      const shouldCleanupWorktree = workflowSucceeded ? cleanupWorktreeOnSuccess : cleanupWorktreeOnFailure;
      if (shouldCleanupWorktree) {
        await this.withRepoLock(args.repoPath, async () => {
          await this.removeWorktree(args.repoPath, worktreePath);
        });
      } else {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: `Preserving worktree for follow-up: ${worktreePath} (branch: ${args.workerBranch}).`,
        });
      }
    }
  }

  private buildWorktreePath(repoPath: string, sessionId: string, executionMode: CliWorkflowSettings["executionMode"]): string {
    if (executionMode === "DOCKER") {
      return this.buildLegacyWorktreePath(repoPath, sessionId);
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

  private buildLegacyWorktreePath(repoPath: string, sessionId: string): string {
    return path.join(repoPath, ".jules-subagents", "worktrees", sanitizeToken(sessionId));
  }

  private async resolveResumeWorktreePath(
    repoPath: string,
    sessionId: string,
    executionMode: CliWorkflowSettings["executionMode"]
  ): Promise<string | undefined> {
    const primary = this.buildWorktreePath(repoPath, sessionId, executionMode);
    if (await this.pathExists(primary)) {
      return primary;
    }
    if (executionMode !== "DOCKER") {
      const legacy = this.buildLegacyWorktreePath(repoPath, sessionId);
      if (await this.pathExists(legacy)) {
        return legacy;
      }
      return primary;
    }
    return undefined;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async hasUnpushedWorkerBranchCommits(
    worktreePath: string,
    workerBranch: string,
    featureBranch: string
  ): Promise<boolean> {
    const remoteWorkerRef = `refs/remotes/origin/${workerBranch}`;
    if (await this.gitRefExists(worktreePath, remoteWorkerRef)) {
      const aheadCount = await this.gitRevListCount(worktreePath, `origin/${workerBranch}..HEAD`);
      return aheadCount > 0;
    }
    const remoteFeatureRef = `refs/remotes/origin/${featureBranch}`;
    if (await this.gitRefExists(worktreePath, remoteFeatureRef)) {
      const aheadOfFeature = await this.gitRevListCount(worktreePath, `origin/${featureBranch}..HEAD`);
      return aheadOfFeature > 0;
    }
    return false;
  }

  private async hasWorkerBranchCommitsAgainstFeature(
    worktreePath: string,
    featureBranch: string
  ): Promise<boolean> {
    const remoteFeatureRef = `refs/remotes/origin/${featureBranch}`;
    if (await this.gitRefExists(worktreePath, remoteFeatureRef)) {
      const aheadOfFeature = await this.gitRevListCount(worktreePath, `origin/${featureBranch}..HEAD`);
      return aheadOfFeature > 0;
    }
    const localFeatureRef = `refs/heads/${featureBranch}`;
    if (await this.gitRefExists(worktreePath, localFeatureRef)) {
      const aheadOfFeature = await this.gitRevListCount(worktreePath, `${featureBranch}..HEAD`);
      return aheadOfFeature > 0;
    }
    return false;
  }

  private async gitRefExists(worktreePath: string, ref: string): Promise<boolean> {
    try {
      await this.runCommand("git", ["show-ref", "--verify", "--quiet", ref], worktreePath);
      return true;
    } catch {
      return false;
    }
  }

  private async gitRevListCount(worktreePath: string, range: string): Promise<number> {
    try {
      const result = await this.runCommand("git", ["rev-list", "--count", range], worktreePath);
      const parsed = Number.parseInt(result.stdout.trim(), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }

  private async resolveOrCreateFeaturePr(
    args: {
      taskId: string;
      provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
      title: string;
      featureBranch: string;
      workerBranch: string;
    },
    worktreePath: string
  ): Promise<string | undefined> {
    try {
      const existingResult = await this.runCommand(
        "gh",
        [
          "pr",
          "list",
          "--state",
          "open",
          "--base",
          args.featureBranch,
          "--head",
          args.workerBranch,
          "--json",
          "url",
          "--limit",
          "1",
        ],
        worktreePath,
        this.withGithubToken()
      );
      const parsed = JSON.parse(existingResult.stdout) as Array<{ url?: string }>;
      const existingUrl = parsed.find((entry) => typeof entry.url === "string" && entry.url.trim().length > 0)?.url?.trim();
      if (existingUrl) {
        return existingUrl;
      }
    } catch {
      // fall through to create attempt
    }

    try {
      const bodyLines = [
        `Automated task execution for \`${args.taskId}\` via ${args.provider}.`,
        "",
        `Base: \`${args.featureBranch}\``,
        `Head: \`${args.workerBranch}\``,
      ];
      const prTitle = `${args.title} (${args.provider})`;
      const createResult = await this.runCommand(
        "gh",
        [
          "pr",
          "create",
          "--base",
          args.featureBranch,
          "--head",
          args.workerBranch,
          "--title",
          prTitle,
          "--body",
          bodyLines.join("\n"),
        ],
        worktreePath,
        this.withGithubToken()
      );
      return createResult.stdout.trim().split("\n").find((line) => line.startsWith("http"));
    } catch {
      return undefined;
    }
  }

  private async resolveDockerUserSpec(workspacePath: string): Promise<string | undefined> {
    try {
      const stats = await fs.stat(workspacePath);
      if (typeof stats.uid === "number" && typeof stats.gid === "number") {
        return `${stats.uid}:${stats.gid}`;
      }
    } catch {
      // fallback below
    }
    return getDockerUserSpec();
  }

  private async isDirectory(targetPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(targetPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  private async resolveResumableWorktreePath(
    repoPath: string,
    expectedBranch: string,
    preferredPath: string,
    executionMode: CliWorkflowSettings["executionMode"]
  ): Promise<string | undefined> {
    if (
      (executionMode !== "DOCKER" || this.isDockerCompatibleWorktreePath(repoPath, preferredPath))
      && await this.canResumeExistingWorktree(preferredPath, expectedBranch)
    ) {
      return preferredPath;
    }

    const branchWorktreePath = await this.findWorktreePathForBranch(repoPath, expectedBranch);
    if (branchWorktreePath && branchWorktreePath !== preferredPath) {
      if (executionMode === "DOCKER" && !this.isDockerCompatibleWorktreePath(repoPath, branchWorktreePath)) {
        await this.removeStaleWorktreeRegistration(repoPath, branchWorktreePath);
        return undefined;
      }
      if (await this.canResumeExistingWorktree(branchWorktreePath, expectedBranch)) {
        return branchWorktreePath;
      }
      await this.removeStaleWorktreeRegistration(repoPath, branchWorktreePath);
    }

    return undefined;
  }

  private isDockerCompatibleWorktreePath(repoPath: string, worktreePath: string): boolean {
    const normalizedRepoPath = path.resolve(repoPath);
    const normalizedWorktreePath = path.resolve(worktreePath);
    return normalizedWorktreePath === normalizedRepoPath
      || normalizedWorktreePath.startsWith(`${normalizedRepoPath}${path.sep}`);
  }

  private async findWorktreePathForBranch(repoPath: string, branch: string): Promise<string | undefined> {
    const listing = await this.runCommand("git", ["worktree", "list", "--porcelain"], repoPath);
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
        if (ref === targetRef && currentPath) {
          return currentPath;
        }
      }
      if (line.length === 0) {
        currentPath = undefined;
      }
    }

    return undefined;
  }

  private async removeStaleWorktreeRegistration(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await this.runCommand("git", ["worktree", "remove", "--force", worktreePath], repoPath);
    } catch {
      // ignore stale worktree removal failures; prune below handles metadata cleanup.
    }
    try {
      await this.runCommand("git", ["worktree", "prune"], repoPath);
    } catch {
      // ignore prune failures; fresh workspace creation will still error explicitly if needed.
    }
  }

  private async canResumeExistingWorktree(worktreePath: string, expectedBranch: string): Promise<boolean> {
    try {
      await fs.access(worktreePath);
      const inside = (await this.runCommand("git", ["rev-parse", "--is-inside-work-tree"], worktreePath)).stdout.trim();
      if (inside !== "true") {
        return false;
      }
      const currentBranch = (await this.runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktreePath)).stdout.trim();
      if (currentBranch !== expectedBranch) {
        await this.runCommand("git", ["checkout", expectedBranch], worktreePath);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async buildWorkspaceGuidance(taskPrompt: string, worktreePath: string): Promise<string> {
    const repoRoot = (await this.runCommand("git", ["rev-parse", "--show-toplevel"], worktreePath)).stdout.trim();
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

  private resolveWorkflowSettings(settings: DashboardSettings): CliWorkflowSettings {
    const merged: CliWorkflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...(settings.cliWorkflow || {}),
    };
    merged.containerImage = merged.containerImage.trim() || DEFAULT_CLI_WORKFLOW_SETTINGS.containerImage;
    return merged;
  }

  private async withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
    const current = this.repoLocks.get(repoPath) || Promise.resolve();
    let releaseLock: () => void = () => { };
    const next = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const queueEntry = current.then(() => next);
    this.repoLocks.set(repoPath, queueEntry);

    await current;
    try {
      return await fn();
    } finally {
      releaseLock();
      if (this.repoLocks.get(repoPath) === queueEntry) {
        this.repoLocks.delete(repoPath);
      }
    }
  }

  private async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await this.runCommand("git", ["worktree", "remove", "--force", worktreePath], repoPath);
    } catch {
      // ignore if missing/broken; ensure path is cleaned.
    }
    await fs.rm(worktreePath, { recursive: true, force: true });
  }

  private withGithubToken(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const token = this.deps.getGithubToken();
    if (!token) {
      return baseEnv;
    }
    return {
      ...baseEnv,
      GH_TOKEN: token,
      GITHUB_TOKEN: token,
    };
  }

  private withProviderEnv(provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">, model: string, apiKey: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (provider === "gemini") {
      if (model && model !== "default") {
        env.GEMINI_MODEL = model;
      }
      if (apiKey.trim().length > 0) {
        env.GEMINI_API_KEY = apiKey;
      }
      return env;
    }

    if (provider === "claude-code") {
      if (apiKey.trim().length > 0) {
        env.ANTHROPIC_API_KEY = apiKey;
      }
      return env;
    }

    if (model && model !== "default") {
      env.CODEX_MODEL = model;
    }
    if (apiKey.trim().length > 0) {
      env.OPENAI_API_KEY = apiKey;
    }
    return env;
  }

  private async resolveContainerSetupScriptPath(
    workflowSettings: CliWorkflowSettings,
    repoPath: string,
    sessionId: string
  ): Promise<string | undefined> {
    const configured = workflowSettings.containerSetupScriptPath.trim();
    if (configured.length > 0) {
      const configuredCandidates = [resolveConfiguredPath(repoPath, configured)];
      if (!path.isAbsolute(configured) && !configured.startsWith("~")) {
        configuredCandidates.push(path.resolve(process.cwd(), configured));
      }
      const uniqueConfiguredCandidates = [...new Set(configuredCandidates)];
      for (const configuredPath of uniqueConfiguredCandidates) {
        if (await this.pathExists(configuredPath)) {
          return configuredPath;
        }
      }
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Configured container setup script not found: ${uniqueConfiguredCandidates.join(", ")}`,
      });
      return undefined;
    }

    const candidates = [...new Set([
      path.join(repoPath, ".jules-subagents", "container", "setup.sh"),
      path.join(process.cwd(), ".jules-subagents", "container", "setup.sh"),
      path.join(os.homedir(), ".jules-subagents", "container", "setup.sh"),
    ])];
    for (const candidate of candidates) {
      if (await this.pathExists(candidate)) {
        return candidate;
      }
    }
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `No container setup script found. Checked: ${candidates.join(", ")}`,
    });
    return undefined;
  }

  private async buildCredentialMounts(
    workflowSettings: CliWorkflowSettings,
    repoPath: string,
    sessionId: string
  ): Promise<ContainerMount[]> {
    if (!workflowSettings.containerMountCredentials) {
      return [];
    }

    const mounts: ContainerMount[] = [];
    if (workflowSettings.containerMountGitConfig) {
      const gitConfigPath = resolveConfiguredPath(repoPath, "~/.gitconfig");
      if (await this.pathExists(gitConfigPath)) {
        mounts.push({
          source: gitConfigPath,
          destination: GITCONFIG_CREDENTIALS_MOUNT,
          readonly: true,
        });
      }
    }

    const requestedMounts: Array<{ enabled: boolean; sourcePath: string; mountBase: string; label: string }> = [
      {
        enabled: workflowSettings.containerMountGithubAuth,
        sourcePath: workflowSettings.containerGithubAuthPath,
        mountBase: GITHUB_CREDENTIALS_MOUNT,
        label: "GitHub auth",
      },
      {
        enabled: workflowSettings.containerMountGeminiAuth,
        sourcePath: workflowSettings.containerGeminiAuthPath,
        mountBase: GEMINI_CREDENTIALS_MOUNT,
        label: "Gemini auth",
      },
      {
        enabled: workflowSettings.containerMountCodexAuth,
        sourcePath: workflowSettings.containerCodexAuthPath,
        mountBase: CODEX_CREDENTIALS_MOUNT,
        label: "Codex auth",
      },
      {
        enabled: workflowSettings.containerMountClaudeCodeAuth,
        sourcePath: workflowSettings.containerClaudeCodeAuthPath,
        mountBase: CLAUDE_CODE_CREDENTIALS_MOUNT,
        label: "Claude Code auth",
      },
    ];

    for (const mount of requestedMounts) {
      if (!mount.enabled) {
        continue;
      }
      const sourcePath = resolveConfiguredPath(repoPath, mount.sourcePath);
      if (await this.pathExists(sourcePath)) {
        mounts.push({
          source: sourcePath,
          destination: await this.isDirectory(sourcePath)
            ? mount.mountBase
            : `${mount.mountBase}/${path.basename(sourcePath)}`,
          readonly: true,
        });
        if (mount.label === "Claude Code auth" && await this.isDirectory(sourcePath)) {
          const authJsonPath = path.join(path.dirname(sourcePath), ".claude.json");
          if (await this.pathExists(authJsonPath)) {
            mounts.push({
              source: authJsonPath,
              destination: CLAUDE_CODE_AUTH_JSON_MOUNT,
              readonly: true,
            });
          }
        }
      } else {
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "system",
          description: `${mount.label} mount skipped; path not found: ${sourcePath}`,
        });
      }
    }
    return mounts;
  }

  private async runProviderInDocker(
    command: string,
    args: string[],
    cwd: string,
    providerEnv: NodeJS.ProcessEnv,
    sessionId: string,
    providerLabel: "gemini" | "codex" | "claude-code",
    workflowSettings: CliWorkflowSettings,
    repoPath: string
  ): Promise<CommandResult> {
    await this.maybeLogDockerPathMappingHint(sessionId, repoPath);
    const runtimeRoot = this.resolveDockerRuntimeRoot(repoPath);
    const runtimeHome = providerLabel === "codex"
      ? path.join(runtimeRoot, `home-codex-${sanitizeToken(sessionId)}`)
      : path.join(runtimeRoot, "home");
    const runtimeNpmPrefix = path.join(runtimeRoot, "npm-global");
    const runtimeNpmCache = path.join(runtimeRoot, "npm-cache");
    await fs.mkdir(path.join(runtimeHome, ".config"), { recursive: true });
    await fs.mkdir(path.join(runtimeHome, ".codex"), { recursive: true });
    await fs.mkdir(runtimeNpmPrefix, { recursive: true });
    await fs.mkdir(runtimeNpmCache, { recursive: true });

    const repoSource = this.mapDockerSourcePathForDaemon(repoPath, repoPath, sessionId, "workspace");
    const runtimeSource = this.mapDockerSourcePathForDaemon(runtimeRoot, repoPath, sessionId, "runtime");
    const dockerArgs = [
      "run",
      "--rm",
      "-i",
      "--network",
      "host",
      "--workdir",
      cwd,
      "--mount",
      toDockerMountArg({
        source: repoSource,
        destination: repoPath,
        readonly: false,
      }),
      "--mount",
      toDockerMountArg({
        source: runtimeSource,
        destination: runtimeRoot,
        readonly: false,
      }),
      "-e",
      `HOME=${runtimeHome}`,
    ];
    const userSpec = await this.resolveDockerUserSpec(cwd);
    if (userSpec) {
      dockerArgs.push("--user", userSpec);
    }

    const passthroughEnv = pickContainerEnv(providerEnv);
    for (const variable of passthroughEnv) {
      dockerArgs.push("-e", `${variable.key}=${variable.value}`);
    }
    const setupScriptPath = await this.resolveContainerSetupScriptPath(workflowSettings, repoPath, sessionId);
    if (setupScriptPath) {
      const setupScriptSource = this.mapDockerSourcePathForDaemon(setupScriptPath, repoPath, sessionId, "setup script");
      dockerArgs.push("--mount", toDockerMountArg({
        source: setupScriptSource,
        destination: CONTAINER_SETUP_SCRIPT,
        readonly: true,
      }));
    }

    const credentialMounts = await this.buildCredentialMounts(workflowSettings, repoPath, sessionId);
    for (const mount of credentialMounts) {
      const source = this.mapDockerSourcePathForDaemon(mount.source, repoPath, sessionId, "credentials");
      dockerArgs.push("--mount", toDockerMountArg({
        ...mount,
        source,
      }));
    }

    const image = workflowSettings.containerImage.trim() || DEFAULT_CLI_WORKFLOW_SETTINGS.containerImage;
    const fallbackInstallCases = ["gemini", "codex", "claude"].flatMap((providerCommand) => {
      const installCommand = getProviderFallbackInstallCommand(providerCommand);
      return installCommand ? [`    ${providerCommand}) ${installCommand} ;;`] : [];
    });
    const bootstrapScript = [
      "set -euo pipefail",
      "mkdir -p \"$HOME/.config\" \"$HOME/.codex\" \"$HOME/.claude\" \"$HOME/.gemini\"",
      "sync_dir_contents() {",
      "  local source=\"$1\"",
      "  local destination=\"$2\"",
      "  local label=\"$3\"",
      "  mkdir -p \"$destination\"",
      "  if ! cp -r \"$source/.\" \"$destination/\"; then",
      "    echo \"provider-runner: warning: failed to copy $label credentials\" >&2",
      "  fi",
      "}",
      `if [ -e "${GITCONFIG_CREDENTIALS_MOUNT}" ]; then`,
      `  if ! cp -f "${GITCONFIG_CREDENTIALS_MOUNT}" "$HOME/.gitconfig"; then`,
      "    echo \"provider-runner: warning: failed to copy .gitconfig\" >&2",
      "  fi",
      "fi",
      `if [ -d "${CODEX_CREDENTIALS_MOUNT}" ]; then`,
      `  if [ -f "${CODEX_CREDENTIALS_MOUNT}/auth.json" ]; then`,
      `    cp -f "${CODEX_CREDENTIALS_MOUNT}/auth.json" "$HOME/.codex/auth.json" || echo "provider-runner: warning: failed to copy codex auth.json" >&2`,
      "  fi",
      `  if [ -f "${CODEX_CREDENTIALS_MOUNT}/config.toml" ]; then`,
      `    cp -f "${CODEX_CREDENTIALS_MOUNT}/config.toml" "$HOME/.codex/config.toml" || echo "provider-runner: warning: failed to copy codex config.toml" >&2`,
      "  fi",
      "fi",
      `if [ -d "${GITHUB_CREDENTIALS_MOUNT}" ]; then`,
      `  sync_dir_contents "${GITHUB_CREDENTIALS_MOUNT}" "$HOME/.config/gh" "gh"`,
      "fi",
      `if [ -d "${GEMINI_CREDENTIALS_MOUNT}" ]; then`,
      `  sync_dir_contents "${GEMINI_CREDENTIALS_MOUNT}" "$HOME/.gemini" "gemini"`,
      "fi",
      `export NPM_CONFIG_PREFIX="${runtimeNpmPrefix}"`,
      `export NPM_CONFIG_CACHE="${runtimeNpmCache}"`,
      "export npm_config_cache=\"$NPM_CONFIG_CACHE\"",
      "mkdir -p \"$NPM_CONFIG_PREFIX\" \"$NPM_CONFIG_CACHE\"",
      "export PATH=\"$HOME/.local/bin:$NPM_CONFIG_PREFIX/bin:$PATH\"",
      "sync_claude_auth() {",
      "  local copied=0",
      `  if [ -f "${CLAUDE_CODE_CREDENTIALS_MOUNT}/.credentials.json" ]; then`,
      `    cp -f "${CLAUDE_CODE_CREDENTIALS_MOUNT}/.credentials.json" "$HOME/.claude/.credentials.json" || echo "provider-runner: warning: failed to copy claude-code .credentials.json" >&2`,
      "    copied=1",
      "  fi",
      `  if [ -f "${CLAUDE_CODE_AUTH_JSON_MOUNT}" ]; then`,
      `    cp -f "${CLAUDE_CODE_AUTH_JSON_MOUNT}" "$HOME/.claude.json" || echo "provider-runner: warning: failed to copy claude-code auth json" >&2`,
      "    copied=1",
      "  fi",
      "  if [ \"$copied\" -eq 0 ]; then",
      "    echo \"provider-runner: warning: no claude auth files were mounted (.credentials.json/.claude.json)\" >&2",
      "  fi",
      "}",
      `if [ -f "${CONTAINER_SETUP_SCRIPT}" ]; then`,
      `  if ! bash "${CONTAINER_SETUP_SCRIPT}"; then`,
      "    echo \"provider-runner: setup script failed; continuing with provider fallback install\" >&2",
      "  fi",
      "fi",
      "if ! command -v \"$1\" >/dev/null 2>&1; then",
      "  case \"$1\" in",
      ...fallbackInstallCases,
      "  esac",
      "fi",
      "if [ \"$1\" = \"claude\" ]; then",
      "  sync_claude_auth",
      "fi",
      "if ! command -v \"$1\" >/dev/null 2>&1; then",
      "  echo \"provider-runner: required command '$1' not found in PATH: $PATH\" >&2",
      "  exit 127",
      "fi",
      "if [ \"$1\" = \"claude\" ]; then",
      "  if [ -n \"${ANTHROPIC_API_KEY:-}\" ]; then",
      "    echo \"provider-runner: claude auth: ANTHROPIC_API_KEY is set\" >&2",
      "  elif [ -f \"$HOME/.claude/.credentials.json\" ] || [ -f \"$HOME/.claude.json\" ]; then",
      "    echo \"provider-runner: claude auth: mounted local claude credentials\" >&2",
      "  else",
      "    echo \"provider-runner: warning: claude auth is missing (no ANTHROPIC_API_KEY and no ~/.claude/.credentials.json or ~/.claude.json); command may wait for login\" >&2",
      "  fi",
      "fi",
      "if [ \"$1\" = \"gemini\" ] && [ -z \"${GEMINI_API_KEY:-}\" ] && [ ! -e \"$HOME/.gemini\" ]; then",
      "  echo \"provider-runner: warning: GEMINI_API_KEY is empty and $HOME/.gemini is not mounted; gemini may wait for auth.\" >&2",
      "fi",
      "echo \"provider-runner: launching $1\" >&2",
      "exec \"$@\"",
    ].join("\n");
    dockerArgs.push(
      image,
      "bash",
      "-c",
      bootstrapScript,
      "provider-runner",
      command,
      ...args
    );
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `Running ${providerLabel} in Docker image ${image} (credentials mounted: ${credentialMounts.length > 0 ? "yes" : "no"}).`,
    });
    const mountSummary = [
      `workspace:${repoSource}->${repoPath}`,
      `runtime:${runtimeSource}->${runtimeRoot}`,
      setupScriptPath ? `setup:${setupScriptPath}->${CONTAINER_SETUP_SCRIPT}` : "setup:none",
      ...credentialMounts.map((mount) => `${mount.source}->${mount.destination}${mount.readonly ? ":ro" : ""}`),
    ];
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `Docker debug: provider=${providerLabel} command=${command} mounts=${mountSummary.join(" | ")}`,
    });
    const result = await this.runStreamingCommand("docker", dockerArgs, cwd, process.env, sessionId, providerLabel);
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: result.ok
        ? `Docker provider run completed successfully (${providerLabel}).`
        : `Docker provider run failed (${providerLabel}). stderr=${result.stderr.slice(0, 600).replace(/\s+/g, " ").trim() || "(empty)"}`,
    });
    return result;
  }

  private resolveDockerRuntimeRoot(repoPath: string): string {
    const configured = (process.env.JULES_DOCKER_RUNTIME_ROOT || "").trim();
    if (configured.length > 0) {
      return resolveConfiguredPath(repoPath, configured);
    }
    const repoHash = createHash("sha1").update(path.resolve(repoPath)).digest("hex").slice(0, 12);
    return path.join(os.homedir(), ".jules-subagents", "runtime", "docker", repoHash);
  }

  private async maybeLogDockerPathMappingHint(sessionId: string, repoPath: string): Promise<void> {
    if (this.dockerHintLoggedSessions.has(sessionId)) {
      return;
    }
    this.dockerHintLoggedSessions.add(sessionId);
    if (!(await this.pathExists("/.dockerenv"))) {
      return;
    }
    const workspaceMapping = (process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT || "").trim();
    const homeMapping = (process.env.JULES_DOCKER_HOST_HOME_ROOT || "").trim();
    if (workspaceMapping.length > 0) {
      return;
    }
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: [
        "Docker mode is running inside a container.",
        `If docker daemon is outside this container, set JULES_DOCKER_HOST_WORKSPACE_ROOT to host-visible path for ${repoPath}.`,
        homeMapping.length > 0 ? "" : "Optionally set JULES_DOCKER_HOST_HOME_ROOT for host-visible credential paths.",
      ].filter((line) => line.length > 0).join(" "),
    });
  }

  private mapDockerSourcePathForDaemon(
    sourcePath: string,
    repoPath: string,
    sessionId: string,
    mountLabel: "workspace" | "setup script" | "credentials" | "runtime"
  ): string {
    const normalizedSource = path.resolve(sourcePath);
    const workspaceMapping = (process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT || "").trim();
    const homeMapping = (process.env.JULES_DOCKER_HOST_HOME_ROOT || "").trim();

    let mapped = normalizedSource;
    if (workspaceMapping.length > 0) {
      mapped = mapPathPrefix(mapped, repoPath, workspaceMapping);
    }
    if (homeMapping.length > 0) {
      mapped = mapPathPrefix(mapped, os.homedir(), homeMapping);
    }

    if (mapped !== normalizedSource) {
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Mapped Docker ${mountLabel} mount source from ${normalizedSource} to ${mapped}.`,
      });
    }
    return mapped;
  }

  private async runProviderCommand(
    command: string,
    args: string[],
    cwd: string,
    providerEnv: NodeJS.ProcessEnv,
    sessionId: string,
    providerLabel: "gemini" | "codex" | "claude-code",
    workflowSettings: CliWorkflowSettings,
    repoPath: string
  ): Promise<CommandResult> {
    if (workflowSettings.executionMode !== "DOCKER") {
      return this.runStreamingCommand(command, args, cwd, providerEnv, sessionId, providerLabel);
    }

    const dockerResult = await this.runProviderInDocker(
      command,
      args,
      cwd,
      providerEnv,
      sessionId,
      providerLabel,
      workflowSettings,
      repoPath
    );
    if (dockerResult.ok) {
      return dockerResult;
    }

    if (isDockerWorkspaceMountError(dockerResult) && await this.pathExists(cwd)) {
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Docker could not mount workspace path (${cwd}) even though it exists locally. This indicates daemon path visibility mismatch; Docker mode requires daemon-visible worktree paths.`,
      });
    }

    return dockerResult;
  }

  private async runGemini(
    prompt: string,
    cwd: string,
    model: string,
    apiKey: string,
    sessionId: string,
    workflowSettings: CliWorkflowSettings,
    repoPath: string
  ): Promise<CommandResult> {
    const args = ["--yolo", "--p", prompt];
    return this.runProviderCommand(
      "gemini",
      args,
      cwd,
      this.withGithubToken(this.withProviderEnv("gemini", model, apiKey)),
      sessionId,
      "gemini",
      workflowSettings,
      repoPath
    );
  }

  private async runCodex(
    prompt: string,
    cwd: string,
    model: string,
    apiKey: string,
    sessionId: string,
    workflowSettings: CliWorkflowSettings,
    repoPath: string
  ): Promise<CommandResult> {
    const args = ["exec", "--yolo", "--output-last-message", "/tmp/codex-last-message.txt"];
    if (model && model !== "default") {
      args.push("--model", model);
    }
    args.push(prompt);
    const result = await this.runProviderCommand(
      "codex",
      args,
      cwd,
      this.withGithubToken(this.withProviderEnv("codex", model, apiKey)),
      sessionId,
      "codex",
      workflowSettings,
      repoPath
    );
    if (result.ok || !this.isTransientCodexTransportError(result)) {
      return result;
    }

    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: "Codex transport disconnected. Retrying once automatically...",
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return this.runProviderCommand(
      "codex",
      args,
      cwd,
      this.withGithubToken(this.withProviderEnv("codex", model, apiKey)),
      sessionId,
      "codex",
      workflowSettings,
      repoPath
    );
  }

  private isTransientCodexTransportError(result: CommandResult): boolean {
    const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return text.includes("stream disconnected before completion")
      || text.includes("error sending request for url")
      || text.includes("channel closed");
  }

  private async runClaudeCode(
    prompt: string,
    cwd: string,
    model: string,
    apiKey: string,
    sessionId: string,
    workflowSettings: CliWorkflowSettings,
    repoPath: string
  ): Promise<CommandResult> {
    const args = ["--dangerously-skip-permissions"];
    if (model && model !== "default") {
      args.push("--model", model);
    }
    args.push("-p", prompt);
    return this.runProviderCommand(
      "claude",
      args,
      cwd,
      this.withGithubToken(this.withProviderEnv("claude-code", model, apiKey)),
      sessionId,
      "claude-code",
      workflowSettings,
      repoPath
    );
  }

  private async runStreamingCommand(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    sessionId: string,
    providerLabel: "gemini" | "codex" | "claude-code"
  ): Promise<CommandResult> {
    return await runStreamingCommand(command, args, cwd, env, {
      onStdoutLine: (line) => {
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "agent",
          description: line.slice(0, 2000),
        });
      },
      onStderrLine: (line) => {
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "provider",
          description: `[${providerLabel}] ${line}`.slice(0, 2000),
        });
      },
    });
  }

  private async runCommand(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv = process.env
  ): Promise<CommandResult> {
    return await runCommandStrict(command, args, cwd, env);
  }
}
