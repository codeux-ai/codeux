import { spawn } from "child_process";
import { createReadStream } from "fs";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import {
  DockerHelperContainerPool,
  HELPER_LABEL,
} from "../../infrastructure/providers/cli/docker-helper-pool.js";

export interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  signal?: AbortSignal;
  stdinFile?: string;
  trimOutput?: boolean;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  maxStderrChars?: number;
}

interface ResolvedCommand {
  command: string;
  args: string[];
  containerHostCwd?: string;
}

const GIT_HELPER_IMAGE = "alpine/git";
const CONTAINER_REPO_ROOT = "/workspace";

/**
 * Lazily-created, process-wide pool of persistent `alpine/git` helper containers — one per
 * (repo working directory, uid:gid). Read/write git commands that only need the working tree
 * mounted are run via `docker exec` into the warm container instead of a throwaway
 * `docker run --rm` per command, which previously produced constant container churn during
 * polling (status, fetch, branch sync, …). Created lazily so the module import cycle with
 * cli-process-runner resolves before first use.
 */
let gitHelperPool: DockerHelperContainerPool | null = null;
function getGitHelperPool(): DockerHelperContainerPool {
  if (!gitHelperPool) {
    gitHelperPool = new DockerHelperContainerPool({
      nameFor: (key) => `code-ux-git-helper-${createHash("sha1").update(key).digest("hex").slice(0, 24)}`,
      buildCreateArgs: (key, name) => {
        const parsed = JSON.parse(key) as { cwd: string; uid?: number; gid?: number };
        const userArgs = parsed.uid !== undefined && parsed.gid !== undefined && parsed.uid !== 0
          ? ["--user", `${parsed.uid}:${parsed.gid}`]
          : [];
        return [
          "run",
          "-d",
          "--name",
          name,
          "--label",
          `${HELPER_LABEL}=git`,
          "--workdir",
          CONTAINER_REPO_ROOT,
          "--mount",
          `type=bind,source=${parsed.cwd},target=${CONTAINER_REPO_ROOT}`,
          ...userArgs,
          "-e",
          `HOME=${CONTAINER_REPO_ROOT}/.code-ux-home`,
          "--entrypoint",
          "sh",
          GIT_HELPER_IMAGE,
          "-c",
          "tail -f /dev/null",
        ];
      },
    });
  }
  return gitHelperPool;
}

/** Removes the persistent git helper container bound to a working directory (call before deleting it). */
export async function releaseGitHelperForCwd(cwd: string): Promise<void> {
  if (!gitHelperPool) {
    return;
  }
  const resolved = path.resolve(cwd);
  const getUid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
  const getGid = (process as NodeJS.Process & { getgid?: () => number }).getgid;
  const uid = getUid ? getUid() : undefined;
  const gid = getGid ? getGid() : undefined;
  await gitHelperPool.release(JSON.stringify({ cwd: resolved, uid, gid })).catch(() => undefined);
}

export class CommandRunner {
  private static readonly DEFAULT_MAX_STDERR_CHARS = 4096;
  private static readonly MAX_COMMAND_DISPLAY_CHARS = 2000;

  /**
   * Runs a command and returns a Promise that resolves with the execution result.
   */
  async run(
    command: string,
    args: string[],
    options: CommandOptions = {}
  ): Promise<CommandResult> {
    // Poolable git commands (containerized, only the working tree mounted, no stdin) are
    // executed inside a persistent helper container instead of a throwaway `docker run --rm`.
    if (command === "git" && this.shouldRunGitInContainer(options) && !options.stdinFile) {
      const cwd = path.resolve(options.cwd ?? process.cwd());
      const env = options.env ?? process.env;
      if (this.buildGitContainerMountArgs(cwd, args, env).length === 0) {
        return this.runPooledGitCommand(cwd, args, env, options);
      }
    }

    const resolvedCommand = this.resolveCommand(command, args, options);
    return this.spawnProcess(resolvedCommand, options);
  }

  private async runPooledGitCommand(
    cwd: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    options: CommandOptions,
  ): Promise<CommandResult> {
    const pool = getGitHelperPool();
    const getUid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
    const getGid = (process as NodeJS.Process & { getgid?: () => number }).getgid;
    const poolKey = JSON.stringify({
      cwd,
      uid: getUid ? getUid() : undefined,
      gid: getGid ? getGid() : undefined,
    });
    const execPrefix = ["exec", ...this.buildGitContainerEnvArgs(env)];
    const execCommand = ["git", ...this.rewriteGitArgsForContainer(cwd, args)];

    const runViaExec = async (): Promise<CommandResult> => {
      const containerId = await pool.ensure(poolKey);
      pool.touch(poolKey);
      return this.spawnProcess(
        { command: "docker", args: [...execPrefix, containerId, ...execCommand], containerHostCwd: cwd },
        options,
      );
    };

    let result: CommandResult;
    try {
      result = await runViaExec();
    } catch {
      // Could not start/reach the helper — fall back to a one-shot run --rm so the op still works.
      return this.spawnProcess(this.resolveCommand("git", args, options), options);
    }

    if (!result.ok && pool.isContainerGone(result)) {
      pool.invalidate(poolKey);
      try {
        result = await runViaExec();
      } catch {
        return this.spawnProcess(this.resolveCommand("git", args, options), options);
      }
    }
    return result;
  }

  private spawnProcess(
    resolvedCommand: ResolvedCommand,
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    const {
      cwd,
      env = process.env,
      timeout,
      signal,
      stdinFile,
      trimOutput = true,
      onStdoutLine,
      onStderrLine,
      maxStderrChars = CommandRunner.DEFAULT_MAX_STDERR_CHARS,
    } = options;

    return new Promise((resolve) => {
      const child = spawn(resolvedCommand.command, resolvedCommand.args, {
        cwd,
        env,
        stdio: [stdinFile ? "pipe" : "ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let stdoutBuffer = "";
      let stderrBuffer = "";
      let timedOut = false;
      let aborted = false;
      let resolved = false;
      let killTimer: NodeJS.Timeout | null = null;

      const clearKillTimer = () => {
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
      };

      const finish = (ok: boolean, code: number | null, extraStderr?: string) => {
        if (resolved) return;
        resolved = true;
        if (timer) clearTimeout(timer);
        clearKillTimer();
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
        }

        let finalStderr = trimOutput ? stderr.trim() : stderr;
        if (extraStderr) {
          const separator = finalStderr.length > 0 && !finalStderr.endsWith("\n") ? "\n" : "";
          finalStderr = `${finalStderr}${separator}${extraStderr}`;
        }

        const clippedStderr = finalStderr.length > maxStderrChars
          ? `...${finalStderr.slice(-maxStderrChars)}`
          : finalStderr;

        const normalizedStdout = resolvedCommand.containerHostCwd
          ? this.mapContainerStdoutToHost(stdout, resolvedCommand.containerHostCwd)
          : stdout;

        resolve({
          ok,
          code,
          stdout: trimOutput ? normalizedStdout.trim() : normalizedStdout,
          stderr: clippedStderr,
        });
      };

      const timer = timeout
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => {
              if (!resolved) {
                child.kill("SIGKILL");
              }
            }, 2_000);
          }, timeout)
        : null;

      const abortHandler = signal
        ? () => {
            if (resolved || timedOut || aborted) {
              return;
            }
            aborted = true;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => {
              if (!resolved) {
                child.kill("SIGKILL");
              }
            }, 2_000);
          }
        : null;

      if (signal?.aborted) {
        aborted = true;
        child.kill("SIGTERM");
      } else if (signal && abortHandler) {
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      if (stdinFile) {
        const stdinStream = createReadStream(stdinFile);
        stdinStream.on("error", (error) => {
          child.kill("SIGTERM");
          finish(false, null, error.message);
        });
        child.stdin?.on("error", () => {
          // The child may exit before consuming all input; the close handler reports the command result.
        });
        if (child.stdin) {
          stdinStream.pipe(child.stdin);
        } else {
          finish(false, null, "Command stdin is unavailable");
        }
      }

      const handleData = (data: Buffer, isStderr: boolean, callback?: (line: string) => void) => {
        const text = data.toString();
        if (isStderr) {
          stderr += text;
          if (callback) {
            stderrBuffer += text;
            const lines = stderrBuffer.split("\n");
            stderrBuffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.length > 0) {
                callback(trimmed);
              }
            }
          }
        } else {
          stdout += text;
          if (callback) {
            stdoutBuffer += text;
            const lines = stdoutBuffer.split("\n");
            stdoutBuffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.length > 0) {
                callback(trimmed);
              }
            }
          }
        }
      };

      child.stdout?.on("data", (data) => handleData(data, false, onStdoutLine));
      child.stderr?.on("data", (data) => handleData(data, true, onStderrLine));

      child.on("error", (error) => {
        // Handle common errors like ENOENT
        finish(false, null, error.message);
      });

      child.on("close", (code) => {
        if (onStdoutLine && stdoutBuffer.trim().length > 0) {
          onStdoutLine(stdoutBuffer.trim());
        }
        if (onStderrLine && stderrBuffer.trim().length > 0) {
          onStderrLine(stderrBuffer.trim());
        }

        const ok = code === 0 && !timedOut && !aborted;
        const extra = timedOut
          ? `Command timed out after ${timeout}ms`
          : aborted
            ? "Command aborted"
            : undefined;
        finish(ok, code, extra);
      });
    });
  }

  /**
   * Runs a command and throws an Error if the execution fails (non-zero exit code or timeout).
   */
  async runStrict(
    command: string,
    args: string[],
    options: CommandOptions = {}
  ): Promise<CommandResult> {
    const result = await this.run(command, args, options);
    if (!result.ok) {
      const commandString = this.formatCommandForError(command, args);
      const errorMessage = result.stderr || result.stdout || "Unknown error";
      throw new Error(`${commandString} failed: ${errorMessage}`);
    }
    return result;
  }

  private formatCommandForError(command: string, args: string[]): string {
    const rendered = `${command} ${args.join(" ")}`;
    if (rendered.length <= CommandRunner.MAX_COMMAND_DISPLAY_CHARS) {
      return rendered;
    }
    return `${rendered.slice(0, CommandRunner.MAX_COMMAND_DISPLAY_CHARS)}... [truncated ${rendered.length - CommandRunner.MAX_COMMAND_DISPLAY_CHARS} chars]`;
  }

  private resolveCommand(command: string, args: string[], options: CommandOptions): ResolvedCommand {
    if (command !== "git" || !this.shouldRunGitInContainer(options)) {
      return { command, args };
    }

    const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    const env = options.env ?? process.env;
    const mounts = this.buildGitContainerMountArgs(cwd, args, env);
    const envArgs = this.buildGitContainerEnvArgs(env);
    const userArgs = this.buildContainerUserArgs();

    return {
      command: "docker",
      containerHostCwd: cwd,
      args: [
        "run",
        "--rm",
        "-i",
        "--workdir",
        CONTAINER_REPO_ROOT,
        "--mount",
        `type=bind,source=${cwd},target=${CONTAINER_REPO_ROOT}`,
        ...mounts,
        ...userArgs,
        "-e",
        `HOME=${CONTAINER_REPO_ROOT}/.code-ux-home`,
        ...envArgs,
        "--entrypoint",
        "git",
        GIT_HELPER_IMAGE,
        ...this.rewriteGitArgsForContainer(cwd, args),
      ],
    };
  }

  private shouldRunGitInContainer(options: CommandOptions): boolean {
    if (process.env.NODE_ENV === "test") {
      return process.env.CODE_UX_CONTAINERIZED_GIT === "1";
    }
    if (process.env.CODE_UX_CONTAINERIZED_GIT === "0" || process.env.CODE_UX_GIT_CONTAINER_MODE === "host") {
      return false;
    }
    return Boolean(options.cwd);
  }

  private buildContainerUserArgs(): string[] {
    const getUid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
    const getGid = (process as NodeJS.Process & { getgid?: () => number }).getgid;
    if (!getUid || !getGid) {
      return [];
    }
    const uid = getUid();
    const gid = getGid();
    return uid === 0 ? [] : ["--user", `${uid}:${gid}`];
  }

  private buildGitContainerEnvArgs(env: NodeJS.ProcessEnv): string[] {
    const args: string[] = [];
    const forwardedPrefixes = ["GIT_", "GITHUB_", "GITLAB_"];
    const forwardedKeys = new Set(["GH_TOKEN", "GLAB_TOKEN", "SSH_ASKPASS", "GCM_INTERACTIVE"]);
    for (const [key, value] of Object.entries(env)) {
      if (typeof value !== "string" || value.length === 0) {
        continue;
      }
      if (!forwardedKeys.has(key) && !forwardedPrefixes.some((prefix) => key.startsWith(prefix))) {
        continue;
      }
      args.push("-e", `${key}=${value}`);
    }
    return args;
  }

  private buildGitContainerMountArgs(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string[] {
    const mounts: string[] = [];
    const seen = new Set<string>([cwd]);
    const addMountForPath = (candidate: string | undefined) => {
      if (!candidate || !path.isAbsolute(candidate) || this.isPathWithin(cwd, candidate)) {
        return;
      }
      const mountPath = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
        ? candidate
        : path.dirname(candidate);
      if (seen.has(mountPath) || !fs.existsSync(mountPath)) {
        return;
      }
      seen.add(mountPath);
      mounts.push("--mount", `type=bind,source=${mountPath},target=${mountPath}`);
    };
    for (const arg of args) {
      addMountForPath(arg);
    }
    for (const key of ["GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_DIR", "GIT_WORK_TREE"]) {
      addMountForPath(env[key]);
    }
    for (const candidate of (env.GIT_ALTERNATE_OBJECT_DIRECTORIES || "").split(path.delimiter)) {
      addMountForPath(candidate);
    }
    return mounts;
  }

  private rewriteGitArgsForContainer(cwd: string, args: string[]): string[] {
    return args.map((arg) => {
      if (!path.isAbsolute(arg) || !this.isPathWithin(cwd, arg)) {
        return arg;
      }
      const relative = path.relative(cwd, arg);
      return relative.length === 0
        ? CONTAINER_REPO_ROOT
        : path.posix.join(CONTAINER_REPO_ROOT, ...relative.split(path.sep));
    });
  }

  private mapContainerStdoutToHost(stdout: string, cwd: string): string {
    return stdout
      .split("\n")
      .map((line) => this.mapContainerPathLineToHost(line, cwd))
      .join("\n");
  }

  private mapContainerPathLineToHost(line: string, cwd: string): string {
    const hasCarriageReturn = line.endsWith("\r");
    const cleanLine = hasCarriageReturn ? line.slice(0, -1) : line;
    if (cleanLine === CONTAINER_REPO_ROOT) {
      return `${cwd}${hasCarriageReturn ? "\r" : ""}`;
    }
    const prefix = `${CONTAINER_REPO_ROOT}/`;
    if (!cleanLine.startsWith(prefix)) {
      return line;
    }
    const relative = cleanLine.slice(prefix.length);
    return `${path.join(cwd, ...relative.split("/"))}${hasCarriageReturn ? "\r" : ""}`;
  }

  private isPathWithin(basePath: string, targetPath: string): boolean {
    const base = path.resolve(basePath);
    const target = path.resolve(targetPath);
    return target === base || target.startsWith(`${base}${path.sep}`);
  }
}

/**
 * Singleton instance of CommandRunner for project-wide use.
 */
export const commandRunner = new CommandRunner();
