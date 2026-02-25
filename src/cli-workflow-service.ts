import { randomUUID } from "crypto";
import { spawn } from "child_process";
import * as fs from "fs/promises";
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
    const sessionId = `cli-${input.provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const workerBranch = buildWorkerBranch(input.featureBranch, input.task.id, input.provider);
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

    void this.runTaskWorkflow({
      ...input,
      sessionId,
      workerBranch,
      title,
    });

    return session;
  }

  private async runTaskWorkflow(args: StartCliTaskInput & { sessionId: string; workerBranch: string; title: string }): Promise<void> {
    const worktreePath = this.buildWorktreePath(args.repoPath, args.sessionId);
    try {
      const settings = this.deps.getDashboardSettings();
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
      const providerPrompt = buildProviderPrompt(promptBody, providerSettings.thinkingMode);

      await this.withRepoLock(args.repoPath, async () => {
        await fs.mkdir(path.dirname(worktreePath), { recursive: true });
        await this.removeWorktree(args.repoPath, worktreePath);
        await this.runCommand("git", ["fetch", "origin"], args.repoPath);
        await this.runCommand(
          "git",
          ["worktree", "add", "--force", "-B", args.workerBranch, worktreePath, `origin/${args.featureBranch}`],
          args.repoPath
        );
      });
      const initialHead = (await this.runCommand("git", ["rev-parse", "HEAD"], worktreePath)).stdout.trim();

      this.deps.sessionTracking.appendActivity(args.sessionId, {
        originator: "system",
        description: `Running ${args.provider} prompt on ${args.workerBranch} (workspace: ${worktreePath}).`,
      });

      const providerResult = args.provider === "gemini"
        ? await this.runGemini(providerPrompt, worktreePath, providerSettings.model, providerSettings.apiKey, args.sessionId)
        : await this.runCodex(providerPrompt, worktreePath, providerSettings.model, providerSettings.apiKey, args.sessionId);

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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.sessionTracking.updateSession(args.sessionId, { state: "FAILED" });
      this.deps.sessionTracking.appendActivity(args.sessionId, {
        originator: "system",
        description: `Workflow failed: ${message}`,
      });
      console.error(`[CLI Workflow] ${args.sessionId} failed: ${message}`);
    } finally {
      await this.withRepoLock(args.repoPath, async () => {
        await this.removeWorktree(args.repoPath, worktreePath);
      });
    }
  }

  private buildWorktreePath(repoPath: string, sessionId: string): string {
    return path.join(repoPath, ".jules-subagents", "worktrees", sanitizeToken(sessionId));
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
      sessionId
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
      sessionId
    );
  }

  private async runStreamingCommand(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    sessionId: string
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
            originator: "system",
            description: line.slice(0, 2000),
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
