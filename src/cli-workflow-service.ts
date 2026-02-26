import { createHash, randomUUID } from "crypto";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import os from "os";
import * as path from "path";
import type { CliWorkflowSettings, DashboardSettings, JulesSession, ProviderId, Subtask, ThinkingMode } from "./types.js";
import { SessionTrackingRepository } from "./session-tracking-repository.js";

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

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

interface ContainerMount {
  source: string;
  destination: string;
  readonly: boolean;
}

const DEFAULT_CLI_WORKFLOW_SETTINGS: CliWorkflowSettings = {
  cleanupWorktreeOnSuccess: true,
  cleanupWorktreeOnFailure: false,
  retryOnReadFileNotFound: true,
  resumeFailedTaskInSameWorkspace: true,
  executionMode: "HOST",
  containerImage: "node:22-bookworm-slim",
  containerSetupScriptPath: "",
  containerMountCredentials: false,
  containerMountGitConfig: true,
  containerMountGithubAuth: true,
  containerMountGeminiAuth: true,
  containerMountCodexAuth: true,
  containerMountClaudeCodeAuth: true,
  containerGithubAuthPath: "~/.config/gh",
  containerGeminiAuthPath: "~/.gemini",
  containerCodexAuthPath: "~/.codex",
  containerClaudeCodeAuthPath: "~/.claude",
};

const CONTAINER_HOME = "/tmp/jules-home";
const CONTAINER_SETUP_SCRIPT = "/opt/jules/setup.sh";

const sanitizeToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const buildWorkerBranch = (featureBranch: string, taskId: string, provider: ProviderId): string => {
  const feature = sanitizeToken(featureBranch.replace(/\//g, "-"));
  const task = sanitizeToken(taskId);
  const suffix = Date.now().toString(36);
  return `task/${feature}-${task}-${provider}-${suffix}`;
};

const buildProviderPrompt = (prompt: string, thinkingMode: ThinkingMode): string => {
  return [
    `# Thinking Mode`,
    `Use ${thinkingMode} reasoning depth.`,
    "",
    prompt,
  ].join("\n");
};

export class CliWorkflowService {
  private readonly repoLocks = new Map<string, Promise<void>>();
  private readonly dockerHintLoggedSessions = new Set<string>();

  constructor(private readonly deps: CliWorkflowServiceDependencies) {}

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
        await this.runCommand("git", ["fetch", "origin"], args.repoPath);
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
      if (!providerResult.ok && workflowSettings.retryOnReadFileNotFound && this.isReadFileNotFoundToolError(providerResult)) {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: "Provider failed on missing file during tool read. Retrying once with file-discovery guidance.",
        });
        providerResult = await runProvider(this.buildReadFileRetryPrompt(providerPrompt));
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

      if (!hasWorkingTreeChanges && !hasCommittedChanges) {
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
          description: `Detected provider-created commit(s) without pending working tree changes.`,
        });
      }
      await this.runCommand("git", ["push", "-u", "origin", args.workerBranch], worktreePath);

      let prUrl: string | undefined;
      if (settings.git.autoCreatePr) {
        const bodyLines = [
          `Automated task execution for \`${args.task.id}\` via ${args.provider}.`,
          "",
          `Base: \`${args.featureBranch}\``,
          `Head: \`${args.workerBranch}\``,
        ];
        const prTitle = `${args.title} (${args.provider})`;
        const prResult = await this.runCommand("gh", [
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
        ], worktreePath, this.withGithubToken());
        if (prResult.ok) {
          prUrl = prResult.stdout.trim().split("\n").find((line) => line.startsWith("http"));
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
    const hints = this.extractPathHints(taskPrompt).slice(0, 10);
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

  private extractPathHints(text: string): string[] {
    const candidates = new Set<string>();
    const backtickMatches = text.match(/`[^`\n]+`/g) || [];
    for (const token of backtickMatches) {
      const normalized = token.slice(1, -1).trim();
      if (this.looksLikeRelativePath(normalized)) {
        candidates.add(normalized);
      }
    }
    const lineMatches = text.match(/(?:^|\n)\s*-\s+([^\n]+)/g) || [];
    for (const rawLine of lineMatches) {
      const normalized = rawLine.replace(/^\s*-\s+/, "").trim();
      if (this.looksLikeRelativePath(normalized)) {
        candidates.add(normalized);
      }
    }
    return Array.from(candidates);
  }

  private looksLikeRelativePath(value: string): boolean {
    if (!value || value.length > 180) return false;
    if (value.startsWith("/") || value.startsWith("~")) return false;
    if (value.includes("..")) return false;
    const cleaned = value.replace(/[.,;:!?]+$/g, "");
    return /[a-zA-Z0-9_-]+\//.test(cleaned) || /\.[a-zA-Z0-9]{1,6}$/.test(cleaned);
  }

  private isReadFileNotFoundToolError(result: CommandResult): boolean {
    const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return combined.includes("error executing tool read_file: file not found");
  }

  private buildReadFileRetryPrompt(basePrompt: string): string {
    return [
      basePrompt,
      "",
      "## Retry Guidance",
      "Previous attempt failed with a file-not-found read.",
      "Before any read_file call, first enumerate files in the relevant area and use exact existing paths.",
      "Do not assume filenames; verify paths then continue implementation.",
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
    let releaseLock: () => void = () => {};
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

  private resolveConfiguredPath(repoPath: string, rawValue: string): string {
    const value = rawValue.trim();
    if (!value) {
      return "";
    }
    if (value === "~") {
      return os.homedir();
    }
    if (value.startsWith("~/")) {
      return path.join(os.homedir(), value.slice(2));
    }
    if (path.isAbsolute(value)) {
      return value;
    }
    return path.resolve(repoPath, value);
  }

  private getDockerUserSpec(): string | undefined {
    const getUid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
    const getGid = (process as NodeJS.Process & { getgid?: () => number }).getgid;
    if (!getUid || !getGid) {
      return undefined;
    }
    return `${getUid()}:${getGid()}`;
  }

  private toDockerMountArg(mount: ContainerMount): string {
    const parts = [
      "type=bind",
      `source=${mount.source}`,
      `target=${mount.destination}`,
    ];
    if (mount.readonly) {
      parts.push("readonly");
    }
    return parts.join(",");
  }

  private pickContainerEnv(env: NodeJS.ProcessEnv): Array<{ key: string; value: string }> {
    const allowed = new Set<string>([
      "GEMINI_MODEL",
      "GEMINI_API_KEY",
      "CODEX_MODEL",
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_ORG_ID",
      "OPENAI_PROJECT_ID",
      "ANTHROPIC_API_KEY",
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
    ]);
    const result: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(env)) {
      if (!allowed.has(key) || typeof value !== "string" || value.length === 0) {
        continue;
      }
      result.push({ key, value });
    }
    return result;
  }

  private async resolveContainerSetupScriptPath(
    workflowSettings: CliWorkflowSettings,
    repoPath: string,
    sessionId: string
  ): Promise<string | undefined> {
    const configured = workflowSettings.containerSetupScriptPath.trim();
    if (configured.length > 0) {
      const configuredPath = this.resolveConfiguredPath(repoPath, configured);
      if (await this.pathExists(configuredPath)) {
        return configuredPath;
      }
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Configured container setup script not found: ${configuredPath}`,
      });
      return undefined;
    }

    const candidates = [
      path.join(repoPath, ".jules-subagents", "container", "setup.sh"),
      path.join(os.homedir(), ".jules-subagents", "container", "setup.sh"),
    ];
    for (const candidate of candidates) {
      if (await this.pathExists(candidate)) {
        return candidate;
      }
    }
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
      const gitConfigPath = this.resolveConfiguredPath(repoPath, "~/.gitconfig");
      if (await this.pathExists(gitConfigPath)) {
        mounts.push({
          source: gitConfigPath,
          destination: `${CONTAINER_HOME}/.gitconfig`,
          readonly: true,
        });
      }
    }

    const requestedMounts: Array<{ enabled: boolean; sourcePath: string; targetPath: string; label: string }> = [
      {
        enabled: workflowSettings.containerMountGithubAuth,
        sourcePath: workflowSettings.containerGithubAuthPath,
        targetPath: `${CONTAINER_HOME}/.config/gh`,
        label: "GitHub auth",
      },
      {
        enabled: workflowSettings.containerMountGeminiAuth,
        sourcePath: workflowSettings.containerGeminiAuthPath,
        targetPath: `${CONTAINER_HOME}/.gemini`,
        label: "Gemini auth",
      },
      {
        enabled: workflowSettings.containerMountCodexAuth,
        sourcePath: workflowSettings.containerCodexAuthPath,
        targetPath: `${CONTAINER_HOME}/.codex`,
        label: "Codex auth",
      },
      {
        enabled: workflowSettings.containerMountClaudeCodeAuth,
        sourcePath: workflowSettings.containerClaudeCodeAuthPath,
        targetPath: `${CONTAINER_HOME}/.claude`,
        label: "Claude Code auth",
      },
    ];

    for (const mount of requestedMounts) {
      if (!mount.enabled) {
        continue;
      }
      const sourcePath = this.resolveConfiguredPath(repoPath, mount.sourcePath);
      if (await this.pathExists(sourcePath)) {
        mounts.push({
          source: sourcePath,
          destination: mount.targetPath,
          readonly: true,
        });
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
    const workspaceSource = this.mapDockerSourcePathForDaemon(cwd, repoPath, sessionId, "workspace");
    const dockerArgs = [
      "run",
      "--rm",
      "-i",
      "--workdir",
      "/workspace",
      "--mount",
      this.toDockerMountArg({
        source: workspaceSource,
        destination: "/workspace",
        readonly: false,
      }),
      "-e",
      `HOME=${CONTAINER_HOME}`,
    ];
    const userSpec = this.getDockerUserSpec();
    if (userSpec) {
      dockerArgs.push("--user", userSpec);
    }

    const passthroughEnv = this.pickContainerEnv(providerEnv);
    for (const variable of passthroughEnv) {
      dockerArgs.push("-e", `${variable.key}=${variable.value}`);
    }

    const setupScriptPath = await this.resolveContainerSetupScriptPath(workflowSettings, repoPath, sessionId);
    if (setupScriptPath) {
      const setupScriptSource = this.mapDockerSourcePathForDaemon(setupScriptPath, repoPath, sessionId, "setup script");
      dockerArgs.push("--mount", this.toDockerMountArg({
        source: setupScriptSource,
        destination: CONTAINER_SETUP_SCRIPT,
        readonly: true,
      }));
    }

    const credentialMounts = await this.buildCredentialMounts(workflowSettings, repoPath, sessionId);
    for (const mount of credentialMounts) {
      const source = this.mapDockerSourcePathForDaemon(mount.source, repoPath, sessionId, "credentials");
      dockerArgs.push("--mount", this.toDockerMountArg({
        ...mount,
        source,
      }));
    }

    const image = workflowSettings.containerImage.trim() || DEFAULT_CLI_WORKFLOW_SETTINGS.containerImage;
    dockerArgs.push(
      image,
      "bash",
      "-lc",
      `set -euo pipefail; mkdir -p "${CONTAINER_HOME}" "${CONTAINER_HOME}/.config"; if [ -f "${CONTAINER_SETUP_SCRIPT}" ]; then bash "${CONTAINER_SETUP_SCRIPT}"; fi; exec "$@"`,
      "provider-runner",
      command,
      ...args
    );
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `Running ${providerLabel} in Docker image ${image} (credentials mounted: ${credentialMounts.length > 0 ? "yes" : "no"}).`,
    });
    return this.runStreamingCommand("docker", dockerArgs, cwd, process.env, sessionId, providerLabel);
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

  private isPathWithin(basePath: string, targetPath: string): boolean {
    const base = path.resolve(basePath);
    const target = path.resolve(targetPath);
    return target === base || target.startsWith(`${base}${path.sep}`);
  }

  private mapPathPrefix(sourcePath: string, fromPrefix: string, toPrefix: string): string {
    const source = path.resolve(sourcePath);
    const from = path.resolve(fromPrefix);
    const to = path.resolve(toPrefix);
    if (!this.isPathWithin(from, source)) {
      return source;
    }
    const relative = path.relative(from, source);
    return relative.length === 0 ? to : path.join(to, relative);
  }

  private mapDockerSourcePathForDaemon(
    sourcePath: string,
    repoPath: string,
    sessionId: string,
    mountLabel: "workspace" | "setup script" | "credentials"
  ): string {
    const normalizedSource = path.resolve(sourcePath);
    const workspaceMapping = (process.env.JULES_DOCKER_HOST_WORKSPACE_ROOT || "").trim();
    const homeMapping = (process.env.JULES_DOCKER_HOST_HOME_ROOT || "").trim();

    let mapped = normalizedSource;
    if (workspaceMapping.length > 0) {
      mapped = this.mapPathPrefix(mapped, repoPath, workspaceMapping);
    }
    if (homeMapping.length > 0) {
      mapped = this.mapPathPrefix(mapped, os.homedir(), homeMapping);
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

    if (this.isDockerWorkspaceMountError(dockerResult) && await this.pathExists(cwd)) {
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Docker could not mount workspace path (${cwd}) even though it exists locally. This indicates daemon path visibility mismatch; Docker mode requires daemon-visible worktree paths.`,
      });
    }

    return dockerResult;
  }

  private isDockerWorkspaceMountError(result: CommandResult): boolean {
    const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
    const bindSourceMissing = combined.includes("invalid mount config for type \"bind\"")
      && combined.includes("bind source path does not exist");
    const mountPermission = combined.includes("mounts denied") || combined.includes("permission denied");
    return bindSourceMissing || mountPermission;
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
    const args = ["--yolo", prompt];
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
    const args = ["exec", "--full-auto", "--yolo", "--output-last-message"];
    if (model && model !== "default") {
      args.push("--model", model);
    }
    args.push(prompt);
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

  private async runClaudeCode(
    prompt: string,
    cwd: string,
    model: string,
    apiKey: string,
    sessionId: string,
    workflowSettings: CliWorkflowSettings,
    repoPath: string
  ): Promise<CommandResult> {
    const args = ["--dangerously-skip-permissions", "--print"];
    if (model && model !== "default") {
      args.push("--model", model);
    }
    args.push(prompt);
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
    return new Promise<CommandResult>((resolve) => {
      const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        stdout += text;
        for (const line of text.split("\n").map((entry) => entry.trim()).filter((entry) => entry.length > 0)) {
          this.deps.sessionTracking.appendActivity(sessionId, {
            originator: "agent",
            description: line.slice(0, 2000),
          });
        }
      });

      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        stderr += text;
        for (const line of text.split("\n").map((entry) => entry.trim()).filter((entry) => entry.length > 0)) {
          this.deps.sessionTracking.appendActivity(sessionId, {
            originator: "provider",
            description: `[${providerLabel}] ${line}`.slice(0, 2000),
          });
        }
      });

      child.on("error", (error) => {
        resolve({
          ok: false,
          stdout,
          stderr: `${stderr}\n${error.message}`.trim(),
        });
      });

      child.on("close", (code) => {
        resolve({
          ok: code === 0,
          stdout,
          stderr,
        });
      });
    });
  }

  private async runCommand(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv = process.env
  ): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve) => {
      const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", (error) => {
        resolve({
          ok: false,
          stdout,
          stderr: `${stderr}\n${error.message}`.trim(),
        });
      });

      child.on("close", (code) => {
        resolve({
          ok: code === 0,
          stdout,
          stderr,
        });
      });
    }).then((result: CommandResult) => {
      if (!result.ok) {
        throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
      }
      return result;
    });
  }
}
