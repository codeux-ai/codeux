import { spawn } from "child_process";
import { createReadStream } from "fs";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import {
  DockerHelperContainerPool,
  HELPER_LABEL,
} from "../../infrastructure/providers/cli/docker-helper-pool.js";
import {
  CommandSpawnerClient,
  HostUnavailableError,
} from "./command-spawner-client.js";
import type { SpawnerCommandOptions, SpawnerRawResult } from "./command-spawner-protocol.js";

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
  maxStdoutChars?: number;
  maxStderrChars?: number;
}

interface ResolvedCommand {
  command: string;
  args: string[];
  containerHostCwd?: string;
}

interface GitContainerPathMapping {
  hostPath: string;
  containerPath: string;
}

const GIT_HELPER_IMAGE = "alpine/git";
const CONTAINER_REPO_ROOT = "/workspace";
const CONTAINER_GIT_MOUNT_ROOT = "/mnt/code-ux/git-paths";
const GIT_PATH_ENV_KEYS = new Set([
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_WORK_TREE",
]);

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
  private static readonly DEFAULT_MAX_STDOUT_CHARS = 5242880; // 5MB
  private static readonly MAX_COMMAND_DISPLAY_CHARS = 2000;
  // The out-of-process spawner is a performance layer only. Disabled under tests (which spawn
  // in-process for determinism) and via the CODE_UX_SPAWNER_HOST=0 kill-switch for instant rollback.
  private static readonly spawnerEnabled =
    process.env.CODE_UX_SPAWNER_HOST !== "0"
    && !process.env.VITEST
    && process.env.NODE_ENV !== "test";

  private spawner: CommandSpawnerClient | null = null;

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
      const cwd = this.resolveHostPath(options.cwd ?? process.cwd());
      const env = options.env ?? process.env;
      if (this.buildGitContainerPathMappings(cwd, args, env).length === 0) {
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
    const execPrefix = ["exec", ...this.buildGitContainerEnvArgs(env, cwd, [])];
    const execCommand = ["git", ...this.rewriteGitArgsForContainer(cwd, args, [])];

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

  /**
   * Spawning a child does `fork()` of the calling process inline on the event loop, and `fork()`
   * cost scales with this (large) process's memory. Delegate to the out-of-process spawner host so
   * the fork happens off the main event loop and from a small address space. Falls back to spawning
   * in-process if the host is unavailable (disabled in tests, after a host crash, or by kill-switch),
   * so the spawner is purely a performance layer.
   */
  private async spawnProcess(
    resolvedCommand: ResolvedCommand,
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    const spawner = this.getSpawner();
    if (spawner) {
      try {
        const spawnerOptions: SpawnerCommandOptions = {
          ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
          ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
          ...(options.stdinFile !== undefined ? { stdinFile: options.stdinFile } : {}),
          ...(options.trimOutput !== undefined ? { trimOutput: options.trimOutput } : {}),
          maxStdoutChars: options.maxStdoutChars ?? CommandRunner.DEFAULT_MAX_STDOUT_CHARS,
          maxStderrChars: options.maxStderrChars ?? CommandRunner.DEFAULT_MAX_STDERR_CHARS,
          streamStdoutLines: Boolean(options.onStdoutLine),
          streamStderrLines: Boolean(options.onStderrLine),
          ...spawner.buildEnvPayload(options.env),
        };
        const raw = await spawner.run(
          resolvedCommand.command,
          resolvedCommand.args,
          spawnerOptions,
          {
            onStdoutLine: options.onStdoutLine,
            onStderrLine: options.onStderrLine,
            signal: options.signal,
          },
        );
        return this.finalizeResult(raw, options, resolvedCommand.containerHostCwd);
      } catch (error) {
        if (!(error instanceof HostUnavailableError)) {
          throw error;
        }
        // Host unavailable/aborted-before-dispatch: fall through to the in-process path.
      }
    }
    return this.spawnProcessInline(resolvedCommand, options);
  }

  /**
   * Shapes a raw spawner result into a CommandResult using the same trim/clip/container-path-mapping
   * rules as the in-process path, so both routes are behaviourally identical.
   */
  private finalizeResult(
    raw: SpawnerRawResult,
    options: CommandOptions,
    containerHostCwd?: string,
  ): CommandResult {
    const {
      timeout,
      trimOutput = true,
    } = options;

    let ok: boolean;
    let extra: string | undefined;
    if (raw.spawnError !== undefined) {
      ok = false;
      extra = raw.spawnError;
    } else {
      ok = raw.code === 0 && !raw.timedOut && !raw.aborted;
      extra = raw.timedOut
        ? `Command timed out after ${timeout}ms`
        : raw.aborted
          ? "Command aborted"
          : undefined;
    }

    let finalStderr = trimOutput ? raw.stderr.trim() : raw.stderr;
    if (extra) {
      const separator = finalStderr.length > 0 && !finalStderr.endsWith("\n") ? "\n" : "";
      finalStderr = `${finalStderr}${separator}${extra}`;
    }
    if (raw.stderrClipped) {
      finalStderr = `...${finalStderr}`;
    }

    let normalizedStdout = containerHostCwd
      ? this.mapContainerStdoutToHost(raw.stdout, containerHostCwd)
      : raw.stdout;
    normalizedStdout = trimOutput ? normalizedStdout.trim() : normalizedStdout;
    if (raw.stdoutClipped) {
      normalizedStdout = `...${normalizedStdout}`;
    }

    return {
      ok,
      code: raw.code,
      stdout: normalizedStdout,
      stderr: finalStderr,
    };
  }

  private getSpawner(): CommandSpawnerClient | null {
    if (!CommandRunner.spawnerEnabled) {
      return null;
    }
    if (!this.spawner) {
      this.spawner = new CommandSpawnerClient();
    }
    return this.spawner.isAvailable() ? this.spawner : null;
  }

  private spawnProcessInline(
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
      maxStdoutChars = CommandRunner.DEFAULT_MAX_STDOUT_CHARS,
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
      let stdoutClipped = false;
      let stderrClipped = false;
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
        if (stderrClipped) {
          finalStderr = `...${finalStderr}`;
        }

        let normalizedStdout = resolvedCommand.containerHostCwd
          ? this.mapContainerStdoutToHost(stdout, resolvedCommand.containerHostCwd)
          : stdout;
        normalizedStdout = trimOutput ? normalizedStdout.trim() : normalizedStdout;
        if (stdoutClipped) {
          normalizedStdout = `...${normalizedStdout}`;
        }

        resolve({
          ok,
          code,
          stdout: normalizedStdout,
          stderr: finalStderr,
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
          if (stderr.length > maxStderrChars) {
            stderr = stderr.slice(-maxStderrChars);
            stderrClipped = true;
          }
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
          if (stdout.length > maxStdoutChars) {
            stdout = stdout.slice(-maxStdoutChars);
            stdoutClipped = true;
          }
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
      const errorMessage = result.stderr || result.stdout || `Unknown error (exit code ${result.code ?? "unknown"}, no output captured)`;
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

    const cwd = options.cwd ? this.resolveHostPath(options.cwd) : process.cwd();
    const env = options.env ?? process.env;
    const pathMappings = this.buildGitContainerPathMappings(cwd, args, env);
    const mounts = this.buildGitContainerMountArgs(pathMappings);
    const envArgs = this.buildGitContainerEnvArgs(env, cwd, pathMappings);
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
        ...this.rewriteGitArgsForContainer(cwd, args, pathMappings),
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

  private buildGitContainerEnvArgs(
    env: NodeJS.ProcessEnv,
    cwd: string,
    pathMappings: GitContainerPathMapping[],
  ): string[] {
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
      args.push("-e", `${key}=${this.rewriteGitEnvValueForContainer(key, value, cwd, pathMappings)}`);
    }
    return args;
  }

  private buildGitContainerPathMappings(
    cwd: string,
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
  ): GitContainerPathMapping[] {
    const mappings: GitContainerPathMapping[] = [];
    const seen = new Set<string>([this.getPathIdentity(cwd)]);
    const addMountForPath = (candidate: string | undefined) => {
      if (!candidate || !this.isAbsoluteHostPath(candidate) || this.isPathWithin(cwd, candidate)) {
        return;
      }
      const pathApi = this.getHostPathApi(candidate);
      const mountPath = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
        ? candidate
        : pathApi.dirname(candidate);
      const resolvedMountPath = this.resolveHostPath(mountPath);
      const mountKey = this.getPathIdentity(resolvedMountPath);
      if (seen.has(mountKey) || !fs.existsSync(resolvedMountPath)) {
        return;
      }
      seen.add(mountKey);
      mappings.push({
        hostPath: resolvedMountPath,
        containerPath: path.posix.join(CONTAINER_GIT_MOUNT_ROOT, String(mappings.length)),
      });
    };
    for (const arg of args) {
      addMountForPath(arg);
    }
    for (const key of GIT_PATH_ENV_KEYS) {
      addMountForPath(env[key]);
    }
    for (const candidate of (env.GIT_ALTERNATE_OBJECT_DIRECTORIES || "").split(path.delimiter)) {
      addMountForPath(candidate);
    }
    return mappings;
  }

  private buildGitContainerMountArgs(pathMappings: GitContainerPathMapping[]): string[] {
    return pathMappings.flatMap((mapping) => [
      "--mount",
      `type=bind,source=${mapping.hostPath},target=${mapping.containerPath}`,
    ]);
  }

  private rewriteGitArgsForContainer(
    cwd: string,
    args: string[],
    pathMappings: GitContainerPathMapping[],
  ): string[] {
    return args.map((arg) => {
      return this.rewriteHostPathForContainer(arg, cwd, pathMappings);
    });
  }

  private rewriteGitEnvValueForContainer(
    key: string,
    value: string,
    cwd: string,
    pathMappings: GitContainerPathMapping[],
  ): string {
    if (key === "GIT_ALTERNATE_OBJECT_DIRECTORIES") {
      return value
        .split(path.delimiter)
        .map((entry) => this.rewriteHostPathForContainer(entry, cwd, pathMappings))
        .join(":");
    }
    if (!GIT_PATH_ENV_KEYS.has(key)) {
      return value;
    }
    return this.rewriteHostPathForContainer(value, cwd, pathMappings);
  }

  private rewriteHostPathForContainer(
    candidate: string,
    cwd: string,
    pathMappings: GitContainerPathMapping[],
  ): string {
    if (!this.isAbsoluteHostPath(candidate)) {
      return candidate;
    }
    if (this.isPathWithin(cwd, candidate)) {
      return this.mapHostPathToContainer(candidate, cwd, CONTAINER_REPO_ROOT);
    }
    const mapping = [...pathMappings]
      .sort((left, right) => right.hostPath.length - left.hostPath.length)
      .find((entry) => this.isPathWithin(entry.hostPath, candidate));
    return mapping
      ? this.mapHostPathToContainer(candidate, mapping.hostPath, mapping.containerPath)
      : candidate;
  }

  private mapHostPathToContainer(candidate: string, hostRoot: string, containerRoot: string): string {
    const pathApi = this.getHostPathApi(hostRoot);
    const relative = pathApi.relative(pathApi.resolve(hostRoot), pathApi.resolve(candidate));
    return relative.length === 0
      ? containerRoot
      : path.posix.join(containerRoot, ...relative.split(/[\\/]+/));
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
    const pathApi = this.getHostPathApi(cwd);
    return `${pathApi.join(cwd, ...relative.split("/"))}${hasCarriageReturn ? "\r" : ""}`;
  }

  private isPathWithin(basePath: string, targetPath: string): boolean {
    const pathApi = this.getHostPathApi(basePath);
    const normalizeCase = this.isWindowsHostPath(basePath)
      ? (value: string) => value.toLowerCase()
      : (value: string) => value;
    const base = normalizeCase(pathApi.resolve(basePath));
    const target = normalizeCase(pathApi.resolve(targetPath));
    const relative = pathApi.relative(base, target);
    return relative.length === 0 || (!relative.startsWith("..") && !pathApi.isAbsolute(relative));
  }

  private resolveHostPath(candidate: string): string {
    return this.getHostPathApi(candidate).resolve(candidate);
  }

  private isAbsoluteHostPath(candidate: string): boolean {
    return path.isAbsolute(candidate) || this.isWindowsHostPath(candidate);
  }

  private isWindowsHostPath(candidate: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(candidate) || /^\\\\/.test(candidate);
  }

  private getHostPathApi(candidate: string): typeof path.win32 | typeof path.posix {
    return this.isWindowsHostPath(candidate) ? path.win32 : path.posix;
  }

  private getPathIdentity(candidate: string): string {
    const resolved = this.resolveHostPath(candidate);
    return this.isWindowsHostPath(resolved) ? resolved.toLowerCase() : resolved;
  }
}

/**
 * Singleton instance of CommandRunner for project-wide use.
 */
export const commandRunner = new CommandRunner();
