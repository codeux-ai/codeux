import { createHash, randomUUID } from "crypto";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import os from "os";
import * as path from "path";
import type { DashboardSettings, JulesSession, ProviderId, Subtask, ThinkingMode } from "./types.js";
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
  provider: Extract<ProviderId, "gemini" | "codex">;
  task: Subtask;
  repoPath: string;
  featureBranch: string;
  sprintNumber: number;
}

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

  constructor(private readonly deps: CliWorkflowServiceDependencies) {}

  async startTask(input: StartCliTaskInput): Promise<JulesSession> {
    const settings = this.deps.getDashboardSettings();
    const workflowSettings = settings.cliWorkflow || {
      cleanupWorktreeOnSuccess: true,
      cleanupWorktreeOnFailure: false,
      retryOnReadFileNotFound: true,
      resumeFailedTaskInSameWorkspace: true,
    };

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
      ? await this.resolveResumeWorktreePath(input.repoPath, resumeTarget.sessionId)
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
        description: `Retry configured to resume failed workspace from ${resumeTarget.sessionId} at ${resumeWorktreePath}.`,
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
    const worktreePath = args.resumeWorktreePath || this.buildWorktreePath(args.repoPath, workspaceSessionId);
    let workflowSucceeded = false;
    let cleanupWorktreeOnSuccess = true;
    let cleanupWorktreeOnFailure = false;
    let resumedExistingWorkspace = false;
    try {
      const settings = this.deps.getDashboardSettings();
      const workflowSettings = settings.cliWorkflow || {
        cleanupWorktreeOnSuccess: true,
        cleanupWorktreeOnFailure: false,
        retryOnReadFileNotFound: true,
        resumeFailedTaskInSameWorkspace: true,
      };
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
          const canResume = await this.canResumeExistingWorktree(worktreePath, args.workerBranch);
          if (canResume) {
            resumedExistingWorkspace = true;
            return;
          }
        }
        await this.removeWorktree(args.repoPath, worktreePath);
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

      let providerResult = args.provider === "gemini"
        ? await this.runGemini(providerPrompt, worktreePath, providerSettings.model, providerSettings.apiKey, args.sessionId)
        : await this.runCodex(providerPrompt, worktreePath, providerSettings.model, providerSettings.apiKey, args.sessionId);
      if (!providerResult.ok && workflowSettings.retryOnReadFileNotFound && this.isReadFileNotFoundToolError(providerResult)) {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: "system",
          description: "Provider failed on missing file during tool read. Retrying once with file-discovery guidance.",
        });
        const retryPrompt = this.buildReadFileRetryPrompt(providerPrompt);
        providerResult = args.provider === "gemini"
          ? await this.runGemini(retryPrompt, worktreePath, providerSettings.model, providerSettings.apiKey, args.sessionId)
          : await this.runCodex(retryPrompt, worktreePath, providerSettings.model, providerSettings.apiKey, args.sessionId);
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

  private buildWorktreePath(repoPath: string, sessionId: string): string {
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

  private async resolveResumeWorktreePath(repoPath: string, sessionId: string): Promise<string> {
    const primary = this.buildWorktreePath(repoPath, sessionId);
    if (await this.pathExists(primary)) {
      return primary;
    }
    const legacy = this.buildLegacyWorktreePath(repoPath, sessionId);
    if (await this.pathExists(legacy)) {
      return legacy;
    }
    return primary;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
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

  private withGithubToken(): NodeJS.ProcessEnv {
    const token = this.deps.getGithubToken();
    if (!token) {
      return process.env;
    }
    return {
      ...process.env,
      GH_TOKEN: token,
      GITHUB_TOKEN: token,
    };
  }

  private withProviderEnv(provider: Extract<ProviderId, "gemini" | "codex">, model: string, apiKey: string): NodeJS.ProcessEnv {
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

    if (model && model !== "default") {
      env.CODEX_MODEL = model;
    }
    if (apiKey.trim().length > 0) {
      env.OPENAI_API_KEY = apiKey;
    }
    return env;
  }

  private async runGemini(
    prompt: string,
    cwd: string,
    model: string,
    apiKey: string,
    sessionId: string
  ): Promise<CommandResult> {
    const args = ["--yolo", prompt];
    return this.runStreamingCommand(
      "gemini",
      args,
      cwd,
      this.withProviderEnv("gemini", model, apiKey),
      sessionId,
      "gemini"
    );
  }

  private async runCodex(
    prompt: string,
    cwd: string,
    model: string,
    apiKey: string,
    sessionId: string
  ): Promise<CommandResult> {
    const args = ["exec", "--full-auto", "--yolo", "--output-last-message"];
    if (model && model !== "default") {
      args.push("--model", model);
    }
    args.push(prompt);
    return this.runStreamingCommand(
      "codex",
      args,
      cwd,
      this.withProviderEnv("codex", model, apiKey),
      sessionId,
      "codex"
    );
  }

  private async runStreamingCommand(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    sessionId: string,
    providerLabel: "gemini" | "codex"
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
