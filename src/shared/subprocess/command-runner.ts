import { spawn } from "child_process";
import { createReadStream } from "fs";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createHash } from "crypto";
import {
  DockerHelperContainerPool,
  HELPER_LABEL,
  HELPER_OWNER_NAME_SUFFIX,
} from "../../infrastructure/providers/cli/docker-helper-pool.js";
import { getRuntimeOwnerDockerArgs } from "../config/runtime-owner.js";
import {
  CommandSpawnerClient,
  HostUnavailableError,
} from "./command-spawner-client.js";
import type { SpawnerCommandOptions, SpawnerRawResult } from "./command-spawner-protocol.js";
import { isRuntimeShutdownInProgress } from "../../services/shutdown-state.js";
import { BoundedTextBuffer } from "./bounded-text-buffer.js";
import { expandHomePath } from "../config/home-path.js";
import pLimit from "p-limit";

declare const spawnCommandBrand: unique symbol;
declare const spawnArgumentBrand: unique symbol;
declare const spawnPathBrand: unique symbol;

type SpawnCommand = string & { readonly [spawnCommandBrand]: true };
type SpawnArgument = string & { readonly [spawnArgumentBrand]: true };
type SpawnPath = string & { readonly [spawnPathBrand]: true };

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

interface GitPoolContext {
  poolKey: string;
  mountRoot: string;
  requestedCwd: string;
  containerCwd: string;
  uid?: number;
  gid?: number;
}

const GIT_HELPER_IMAGE = "alpine/git";
const CONTAINER_REPO_ROOT = "/workspace";
const CONTAINER_GIT_MOUNT_ROOT = "/mnt/code-ux/git-paths";
const COMMAND_NAME_PATTERN = /^[A-Za-z0-9._+-]+$/;

/**
 * Builds a `--mount` flag value. Docker's `--mount` syntax is a comma-separated
 * list of `key=value` fields with no escape mechanism for a literal comma inside
 * a value, so a host path containing a comma (e.g. from a crafted
 * GIT_ALTERNATE_OBJECT_DIRECTORIES env value) could inject extra mount options
 * such as `readonly` or `bind-propagation=...`. Reject any host path or
 * container path containing a comma before it reaches the docker CLI.
 */
function formatBindMountArg(hostPath: string, containerPath: string): string {
  if (hostPath.includes(",") || containerPath.includes(",")) {
    throw new Error(`Cannot mount path containing a comma: ${hostPath.includes(",") ? hostPath : containerPath}`);
  }
  return `type=bind,source=${hostPath},target=${containerPath}`;
}
const GIT_PATH_ENV_KEYS = new Set([
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_WORK_TREE",
]);

/**
 * Lazily-created, process-wide pool of persistent `alpine/git` helper containers — one per
 * (project Git common directory, uid:gid). Read/write git commands that only need the project tree
 * mounted are run via `docker exec` into the warm container instead of a throwaway
 * `docker run --rm` per command, which previously produced constant container churn during
 * polling (status, fetch, branch sync, …). Created lazily so the module import cycle with
 * cli-process-runner resolves before first use.
 */
let gitHelperPool: DockerHelperContainerPool | null = null;
const PROJECT_GIT_EXEC_CONCURRENCY = 4;
type GitExecLimit = ReturnType<typeof pLimit>;
interface ProjectGitHelperLease {
  holders: number;
  releaseReservation: (() => void) | null;
}
const projectGitHelperLeases = new Map<string, ProjectGitHelperLease>();
const projectGitExecLimits = new Map<string, GitExecLimit>();
const projectGitInFlight = new Map<string, Set<Promise<CommandResult>>>();
const projectGitHelpersReleasing = new Set<string>();

function getGitHelperPool(): DockerHelperContainerPool {
  if (!gitHelperPool) {
    gitHelperPool = new DockerHelperContainerPool({
      nameFor: (key) => `code-ux-git-helper-${HELPER_OWNER_NAME_SUFFIX}-${createHash("sha1").update(key).digest("hex").slice(0, 24)}`,
      buildCreateArgs: (key, name) => {
        const parsed = JSON.parse(key) as { mountRoot: string; uid?: number; gid?: number };
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
          ...getRuntimeOwnerDockerArgs(),
          "--workdir",
          CONTAINER_REPO_ROOT,
          "--mount",
          formatBindMountArg(parsed.mountRoot, CONTAINER_REPO_ROOT),
          "--mount",
          "type=tmpfs,target=/git",
          ...userArgs,
          "-e",
          "HOME=/tmp/code-ux-git-home",
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

function getProjectGitExecLimit(poolKey: string): GitExecLimit {
  const existing = projectGitExecLimits.get(poolKey);
  if (existing) {
    return existing;
  }
  const created = pLimit(PROJECT_GIT_EXEC_CONCURRENCY);
  projectGitExecLimits.set(poolKey, created);
  return created;
}

async function drainProjectGitExecutions(poolKey: string): Promise<void> {
  for (;;) {
    const current = [...(projectGitInFlight.get(poolKey) || [])];
    if (current.length === 0) {
      return;
    }
    await Promise.allSettled(current);
  }
}

/**
 * Keeps one lazy Git helper warm while a project has an active sprint. Multiple sprints for the
 * same project share a reference-counted lease; the final release drains commands and removes the
 * helper. Outside an active lease, Git uses the isolated one-shot path and leaves no warm helper.
 */
export function acquireProjectGitHelperForSprint(cwd: string): () => Promise<void> {
  const context = CommandRunner.resolveGitPoolContextForPath(cwd);
  if (!context) {
    return async () => undefined;
  }
  const existing = projectGitHelperLeases.get(context.poolKey);
  if (existing) {
    existing.holders += 1;
  } else {
    projectGitHelperLeases.set(context.poolKey, {
      holders: 1,
      releaseReservation: null,
    });
  }

  let released = false;
  return async () => {
    if (released) {
      return;
    }
    released = true;
    const lease = projectGitHelperLeases.get(context.poolKey);
    if (!lease) {
      return;
    }
    lease.holders = Math.max(0, lease.holders - 1);
    if (lease.holders > 0) {
      return;
    }

    projectGitHelperLeases.delete(context.poolKey);
    projectGitHelpersReleasing.add(context.poolKey);
    try {
      await drainProjectGitExecutions(context.poolKey);
      lease.releaseReservation?.();
      await gitHelperPool?.release(context.poolKey);
    } finally {
      projectGitHelpersReleasing.delete(context.poolKey);
      if (!projectGitHelperLeases.has(context.poolKey)) {
        projectGitExecLimits.delete(context.poolKey);
        projectGitInFlight.delete(context.poolKey);
      }
    }
  };
}

/** Removes the persistent git helper container bound to a project root. */
export async function releaseGitHelperForCwd(cwd: string): Promise<void> {
  if (!gitHelperPool) {
    return;
  }
  const context = CommandRunner.resolveGitPoolContextForPath(cwd);
  if (!context) {
    return;
  }
  const lease = projectGitHelperLeases.get(context.poolKey);
  projectGitHelperLeases.delete(context.poolKey);
  projectGitHelpersReleasing.add(context.poolKey);
  try {
    await drainProjectGitExecutions(context.poolKey);
    lease?.releaseReservation?.();
    await gitHelperPool.release(context.poolKey).catch(() => undefined);
  } finally {
    projectGitHelpersReleasing.delete(context.poolKey);
    projectGitExecLimits.delete(context.poolKey);
    projectGitInFlight.delete(context.poolKey);
  }
}

/** Drains the process-wide git helper pool during server shutdown. */
export async function shutdownGitHelperPool(): Promise<void> {
  const pool = gitHelperPool;
  const keys = new Set([
    ...projectGitHelperLeases.keys(),
    ...projectGitInFlight.keys(),
  ]);
  for (const key of keys) {
    projectGitHelpersReleasing.add(key);
  }
  await Promise.all([...keys].map((key) => drainProjectGitExecutions(key)));
  for (const lease of projectGitHelperLeases.values()) {
    lease.releaseReservation?.();
  }
  projectGitHelperLeases.clear();
  await pool?.shutdown();
  gitHelperPool = null;
  projectGitExecLimits.clear();
  projectGitInFlight.clear();
  projectGitHelpersReleasing.clear();
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
    // Poolable git commands (containerized and only the project tree mounted) are
    // executed inside a persistent helper container instead of a throwaway `docker run --rm`.
    if (command === "git" && this.shouldRunGitInContainer(options)) {
      // Validate caller-controlled spawn inputs before `pool.ensure()` can create a helper.
      // stdin files stay on the host and are streamed through `docker exec -i`; they do not
      // require another bind mount and therefore remain eligible for the warm helper.
      this.validateSpawnArgs(args);
      const safeCwd = this.validateSpawnCwd(options.cwd);
      const cwd = safeCwd ?? this.resolveHostPath(process.cwd());
      const safeStdinFile = options.stdinFile
        ? this.validateStdinFile(options.stdinFile, safeCwd)
        : undefined;
      const env = options.env ?? process.env;
      const poolContext = this.resolveGitPoolContext(cwd);
      // Once shutdown starts, the server drains the warm pool. Late Git work must stay on the
      // containerized one-shot path so it cannot recreate a persistent helper behind that drain.
      if (
        poolContext
        && !isRuntimeShutdownInProgress()
        && projectGitHelperLeases.has(poolContext.poolKey)
        && !projectGitHelpersReleasing.has(poolContext.poolKey)
        && this.buildGitContainerPathMappings(poolContext.mountRoot, args, env).length === 0
      ) {
        const pooledOptions = safeCwd === undefined && safeStdinFile === undefined
          ? options
          : { ...options, cwd: safeCwd, stdinFile: safeStdinFile };
        return this.runPooledGitCommand(poolContext, args, env, pooledOptions);
      }
    }

    const resolvedCommand = this.resolveCommand(command, args, options);
    return this.spawnProcess(resolvedCommand, options);
  }

  private async runPooledGitCommand(
    context: GitPoolContext,
    args: string[],
    env: NodeJS.ProcessEnv,
    options: CommandOptions,
  ): Promise<CommandResult> {
    const pool = getGitHelperPool();
    const projectLease = projectGitHelperLeases.get(context.poolKey);
    if (projectLease && !projectLease.releaseReservation) {
      projectLease.releaseReservation = pool.reserve(context.poolKey);
    }
    const execPrefix = [
      "exec",
      ...(options.stdinFile ? ["-i"] : []),
      "--workdir",
      context.containerCwd,
      ...this.buildGitContainerEnvArgs(env, context.mountRoot, []),
    ];
    const execCommand = ["git", ...this.rewriteGitArgsForContainer(context.mountRoot, args, [])];
    // This includes command-scoped auth/config environment values. Validate the complete exec
    // argv before helper creation so malformed environment cannot cause container churn.
    this.validateSpawnArgs([...execPrefix, ...execCommand]);

    const runOneShot = (): Promise<CommandResult> => (
      this.spawnProcess(this.resolveCommand("git", args, options), options)
    );
    const runViaExec = async (containerId: string): Promise<CommandResult> => {
      pool.touch(context.poolKey);
      return this.spawnProcess(
        { command: "docker", args: [...execPrefix, containerId, ...execCommand], containerHostCwd: context.mountRoot },
        options,
      );
    };

    const runPinnedGeneration = async (): Promise<{ containerId: string; result: CommandResult }> => {
      let commandStarted = false;
      try {
        return await pool.withContainer(context.poolKey, async (containerId) => {
          commandStarted = true;
          return { containerId, result: await runViaExec(containerId) };
        });
      } catch (error) {
        if (commandStarted) {
          throw error;
        }
        return { containerId: "", result: await runOneShot() };
      }
    };

    const execute = async (): Promise<CommandResult> => {
      let attempt = await runPinnedGeneration();
      if (attempt.containerId && !attempt.result.ok && pool.isContainerGone(attempt.result)) {
        pool.invalidate(context.poolKey, attempt.containerId);
        attempt = await runPinnedGeneration();
        if (attempt.containerId && !attempt.result.ok && pool.isContainerGone(attempt.result)) {
          pool.invalidate(context.poolKey, attempt.containerId);
          return runOneShot();
        }
      }
      return attempt.result;
    };

    const operation = getProjectGitExecLimit(context.poolKey)(execute);
    const inFlight = projectGitInFlight.get(context.poolKey) || new Set<Promise<CommandResult>>();
    inFlight.add(operation);
    projectGitInFlight.set(context.poolKey, inFlight);
    try {
      return await operation;
    } finally {
      inFlight.delete(operation);
      if (inFlight.size === 0) {
        projectGitInFlight.delete(context.poolKey);
      }
    }
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
    const safeCwd = this.validateSpawnCwd(options.cwd);
    const safeStdinFile = options.stdinFile
      ? this.validateStdinFile(options.stdinFile, safeCwd)
      : undefined;
    const safeOptions: CommandOptions = safeCwd === undefined && safeStdinFile === undefined
      ? options
      : { ...options, cwd: safeCwd, stdinFile: safeStdinFile };
    const spawner = this.getSpawner();
    if (spawner) {
      try {
        const spawnerOptions: SpawnerCommandOptions = {
          ...(safeOptions.cwd !== undefined ? { cwd: safeOptions.cwd } : {}),
          ...(safeOptions.timeout !== undefined ? { timeout: safeOptions.timeout } : {}),
          ...(safeOptions.stdinFile !== undefined ? { stdinFile: safeOptions.stdinFile } : {}),
          ...(safeOptions.trimOutput !== undefined ? { trimOutput: safeOptions.trimOutput } : {}),
          maxStdoutChars: safeOptions.maxStdoutChars ?? CommandRunner.DEFAULT_MAX_STDOUT_CHARS,
          maxStderrChars: safeOptions.maxStderrChars ?? CommandRunner.DEFAULT_MAX_STDERR_CHARS,
          streamStdoutLines: Boolean(safeOptions.onStdoutLine),
          streamStderrLines: Boolean(safeOptions.onStderrLine),
          ...spawner.buildEnvPayload(safeOptions.env),
        };
        const raw = await spawner.run(
          resolvedCommand.command,
          resolvedCommand.args,
          spawnerOptions,
          {
            onStdoutLine: safeOptions.onStdoutLine,
            onStderrLine: safeOptions.onStderrLine,
            signal: safeOptions.signal,
          },
        );
        return this.finalizeResult(raw, safeOptions, resolvedCommand.containerHostCwd);
      } catch (error) {
        if (!(error instanceof HostUnavailableError)) {
          throw error;
        }
        // Host unavailable/aborted-before-dispatch: fall through to the in-process path.
      }
    }
    return this.spawnProcessInline(resolvedCommand, safeOptions);
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
    if (!CommandRunner.spawnerEnabled || isRuntimeShutdownInProgress()) {
      return null;
    }
    if (!this.spawner) {
      this.spawner = new CommandSpawnerClient();
    }
    return this.spawner.isAvailable() ? this.spawner : null;
  }

  dispose(): void {
    this.spawner?.dispose();
    this.spawner = null;
  }

  private validateSpawnCommand(command: string): SpawnCommand {
    if (!command || command.includes("\0")) {
      throw new Error("Command cannot be empty or contain null bytes");
    }

    if (path.isAbsolute(command)) {
      return path.resolve(command) as SpawnCommand;
    }

    if (command.includes("/") || command.includes("\\") || !COMMAND_NAME_PATTERN.test(command)) {
      throw new Error(`Unsafe command name: ${command}`);
    }

    return command as SpawnCommand;
  }

  private validateSpawnArgs(args: string[]): SpawnArgument[] {
    return args.map((arg) => {
      if (arg.includes("\0")) {
        throw new Error("Command arguments cannot contain null bytes");
      }
      return arg as SpawnArgument;
    });
  }

  private validateSpawnCwd(cwd: string | undefined): SpawnPath | undefined {
    if (cwd === undefined) {
      return undefined;
    }
    if (!cwd.trim() || cwd.includes("\0")) {
      throw new Error("cwd cannot be empty or contain null bytes");
    }

    const resolved = path.resolve(cwd);
    let canonical: string;
    try {
      // cwd is selected from a registered local project or a runtime-owned
      // workspace. Canonicalize it immediately before dispatch so relative
      // segments and symlink aliases cannot change the directory boundary
      // observed by the child process.
      canonical = fs.realpathSync(resolved);
    } catch {
      throw new Error(`cwd is not an existing directory: ${resolved}`);
    }

    const trustedRoots = [
      os.homedir(),
      process.cwd(),
      os.tmpdir(),
      ...(process.env.CODE_UX_DIRECTORY_BROWSER_ROOTS ?? "").split(","),
    ].filter((root) => root.trim().length > 0).map((root) => {
      const resolvedRoot = path.resolve(expandHomePath(root.trim()));
      try {
        return fs.realpathSync(resolvedRoot);
      } catch {
        return resolvedRoot;
      }
    });
    for (const root of trustedRoots) {
      // Keep the filesystem check and the returned value in the branch guarded
      // by the normalized absolute-path prefix check. The relative-path test
      // then enforces the separator boundary so sibling prefixes do not match.
      if (canonical.startsWith(root)) {
        const relative = path.relative(root, canonical);
        const isInsideRoot = relative === ""
          || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
        if (isInsideRoot) {
          if (!fs.statSync(canonical).isDirectory()) {
            throw new Error(`cwd is not an existing directory: ${canonical}`);
          }
          return canonical as SpawnPath;
        }
      }
    }
    throw new Error("cwd must be inside the home, application, temporary, or configured local roots");
  }

  private validateStdinFile(stdinFile: string, cwd?: string): SpawnPath {
    if (!stdinFile || stdinFile.includes("\0")) {
      throw new Error("stdinFile cannot be empty or contain null bytes");
    }

    const resolved = path.resolve(cwd ?? process.cwd(), stdinFile);
    // stdinFile is caller-selected local input. We reject empty/null-byte paths,
    // resolve relative paths against cwd, require an existing file, and pass the
    // resolved value to createReadStream below.
    // codeql[js/path-injection]
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(`stdinFile is not a readable file: ${resolved}`);
    }

    return resolved as SpawnPath;
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
      const spawnCommand = this.validateSpawnCommand(resolvedCommand.command);
      const spawnArgs = this.validateSpawnArgs(resolvedCommand.args);
      const safeCwd = this.validateSpawnCwd(cwd);
      const safeStdinFile = stdinFile ? this.validateStdinFile(stdinFile, safeCwd) : null;

      // shell:false (explicit) — the command and its arguments are passed
      // directly to execvp without any shell interpretation, so argument values
      // (including any derived from the environment) cannot be parsed as shell
      // syntax. The executable name and args are resolved by the command-spec
      // layer, never assembled from raw user-supplied strings.
      // codeql[js/path-injection]
      const child = spawn(spawnCommand, spawnArgs, {
        // safeCwd is the canonical existing directory returned by
        // validateSpawnCwd immediately above.
        cwd: safeCwd,
        env,
        shell: false,
        stdio: [safeStdinFile ? "pipe" : "ignore", "pipe", "pipe"],
      });

      const stdout = new BoundedTextBuffer(maxStdoutChars);
      const stderr = new BoundedTextBuffer(maxStderrChars);
      const stdoutLineBuffer = new BoundedTextBuffer(maxStdoutChars);
      const stderrLineBuffer = new BoundedTextBuffer(maxStderrChars);
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

        const retainedStderr = stderr.takeString();
        let finalStderr = trimOutput ? retainedStderr.trim() : retainedStderr;
        if (extraStderr) {
          const separator = finalStderr.length > 0 && !finalStderr.endsWith("\n") ? "\n" : "";
          finalStderr = `${finalStderr}${separator}${extraStderr}`;
        }
        if (stderrClipped) {
          finalStderr = `...${finalStderr}`;
        }

        const retainedStdout = stdout.takeString();
        let normalizedStdout = resolvedCommand.containerHostCwd
          ? this.mapContainerStdoutToHost(retainedStdout, resolvedCommand.containerHostCwd)
          : retainedStdout;
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

      if (safeStdinFile) {
        // safeStdinFile is the resolved existing file returned by
        // validateStdinFile above.
        // codeql[js/path-injection]
        const stdinStream = createReadStream(safeStdinFile);
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
          stderr.append(text);
          stderrClipped = stderr.clipped;
          if (callback) {
            this.emitCompletedLines(stderrLineBuffer, text, callback);
          }
        } else {
          stdout.append(text);
          stdoutClipped = stdout.clipped;
          if (callback) {
            this.emitCompletedLines(stdoutLineBuffer, text, callback);
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
        const finalStdoutLine = stdoutLineBuffer.takeString().trim();
        if (onStdoutLine && finalStdoutLine.length > 0) {
          onStdoutLine(finalStdoutLine);
        }
        const finalStderrLine = stderrLineBuffer.takeString().trim();
        if (onStderrLine && finalStderrLine.length > 0) {
          onStderrLine(finalStderrLine);
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

  private emitCompletedLines(
    pending: BoundedTextBuffer,
    chunk: string,
    callback: (line: string) => void,
  ): void {
    const lastNewline = chunk.lastIndexOf("\n");
    if (lastNewline < 0) {
      pending.append(chunk);
      return;
    }
    const completed = `${pending.takeString()}${chunk.slice(0, lastNewline)}`;
    for (const line of completed.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        callback(trimmed);
      }
    }
    pending.append(chunk.slice(lastNewline + 1));
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
    const poolContext = this.resolveGitPoolContext(cwd);
    const mountRoot = poolContext?.mountRoot ?? cwd;
    const containerCwd = poolContext?.containerCwd ?? CONTAINER_REPO_ROOT;
    const pathMappings = this.buildGitContainerPathMappings(mountRoot, args, env);
    const mounts = this.buildGitContainerMountArgs(pathMappings);
    const envArgs = this.buildGitContainerEnvArgs(env, mountRoot, pathMappings);
    const userArgs = this.buildContainerUserArgs();

    return {
      command: "docker",
      containerHostCwd: mountRoot,
      args: [
        "run",
        "--rm",
        "-i",
        ...getRuntimeOwnerDockerArgs(),
        "--workdir",
        containerCwd,
        "--mount",
        formatBindMountArg(mountRoot, CONTAINER_REPO_ROOT),
        "--mount",
        "type=tmpfs,target=/git",
        ...mounts,
        ...userArgs,
        "-e",
        "HOME=/tmp/code-ux-git-home",
        ...envArgs,
        "--entrypoint",
        "git",
        GIT_HELPER_IMAGE,
        ...this.rewriteGitArgsForContainer(mountRoot, args, pathMappings),
      ],
    };
  }

  private shouldRunGitInContainer(options: CommandOptions): boolean {
    const env = options.env ?? process.env;
    if (process.env.NODE_ENV === "test" || env.CODEUX_E2E_PROVIDER_CLI_SHIM) {
      return env.CODE_UX_CONTAINERIZED_GIT === "1" && env.CODE_UX_GIT_CONTAINER_MODE !== "host";
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
      // Normalize (collapse any "." / ".." segments) before touching the
      // filesystem so the path that is stat'd is the canonical one.
      const normalizedCandidate = pathApi.normalize(candidate);
      const mountPath = fs.existsSync(normalizedCandidate) && fs.statSync(normalizedCandidate).isDirectory()
        ? normalizedCandidate
        : pathApi.dirname(normalizedCandidate);
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
      formatBindMountArg(mapping.hostPath, mapping.containerPath),
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

  private resolveGitPoolContext(cwd: string): GitPoolContext | null {
    return CommandRunner.resolveGitPoolContextForPath(cwd);
  }

  static resolveGitPoolContextForPath(cwd: string): GitPoolContext | null {
    const resolvedCwd = path.resolve(cwd);
    const metadata = CommandRunner.findGitMetadata(resolvedCwd);
    const mountRoot = metadata?.projectRoot ?? resolvedCwd;
    if (!CommandRunner.isPathWithinStatic(mountRoot, resolvedCwd)) {
      return null;
    }
    const getUid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
    const getGid = (process as NodeJS.Process & { getgid?: () => number }).getgid;
    const uid = getUid ? getUid() : undefined;
    const gid = getGid ? getGid() : undefined;
    const pathApi = CommandRunner.getHostPathApiStatic(mountRoot);
    const relative = pathApi.relative(pathApi.resolve(mountRoot), pathApi.resolve(resolvedCwd));
    const containerCwd = relative.length === 0
      ? CONTAINER_REPO_ROOT
      : path.posix.join(CONTAINER_REPO_ROOT, ...relative.split(/[\\/]+/));
    const poolKey = JSON.stringify({
      mountRoot: CommandRunner.pathIdentityStatic(mountRoot),
      uid,
      gid,
    });
    return {
      poolKey,
      mountRoot,
      requestedCwd: resolvedCwd,
      containerCwd,
      uid,
      gid,
    };
  }

  private static findGitMetadata(startPath: string): { projectRoot: string } | null {
    const start = path.resolve(startPath);
    let current = start;
    while (true) {
      const dotGit = path.join(current, ".git");
      if (fs.existsSync(dotGit)) {
        const projectRoot = CommandRunner.resolveProjectRootFromDotGit(current, dotGit);
        return projectRoot ? { projectRoot } : null;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  }

  private static resolveProjectRootFromDotGit(worktreeRoot: string, dotGit: string): string | null {
    try {
      const stat = fs.statSync(dotGit);
      if (stat.isDirectory()) {
        return CommandRunner.isValidGitDirectory(dotGit) ? path.resolve(worktreeRoot) : null;
      }
      if (!stat.isFile()) {
        return null;
      }
      const content = fs.readFileSync(dotGit, "utf8").trim();
      const match = /^gitdir:\s*(.+)$/i.exec(content);
      if (!match) {
        return null;
      }
      const gitDir = path.resolve(worktreeRoot, match[1]);
      if (!CommandRunner.isValidGitDirectory(gitDir)) {
        return null;
      }
      const commonDirFile = path.join(gitDir, "commondir");
      if (!fs.existsSync(commonDirFile)) {
        return path.resolve(worktreeRoot);
      }
      const commonDir = fs.readFileSync(commonDirFile, "utf8").trim();
      if (!commonDir) {
        return path.resolve(worktreeRoot);
      }
      const resolvedCommonDir = path.resolve(gitDir, commonDir);
      const parent = path.dirname(resolvedCommonDir);
      const projectGitDir = path.join(parent, ".git");
      return CommandRunner.pathIdentityStatic(resolvedCommonDir) === CommandRunner.pathIdentityStatic(projectGitDir)
        && CommandRunner.isValidGitDirectory(projectGitDir)
        ? parent
        : path.resolve(worktreeRoot);
    } catch {
      return null;
    }
  }

  private static isValidGitDirectory(candidate: string): boolean {
    try {
      return fs.statSync(candidate).isDirectory() && fs.statSync(path.join(candidate, "HEAD")).isFile();
    } catch {
      return false;
    }
  }

  private static isPathWithinStatic(basePath: string, targetPath: string): boolean {
    const pathApi = CommandRunner.getHostPathApiStatic(basePath);
    const normalizeCase = CommandRunner.isWindowsHostPathStatic(basePath)
      ? (value: string) => value.toLowerCase()
      : (value: string) => value;
    const base = normalizeCase(pathApi.resolve(basePath));
    const target = normalizeCase(pathApi.resolve(targetPath));
    const relative = pathApi.relative(base, target);
    return relative.length === 0 || (!relative.startsWith("..") && !pathApi.isAbsolute(relative));
  }

  private static pathIdentityStatic(candidate: string): string {
    const resolved = CommandRunner.getHostPathApiStatic(candidate).resolve(candidate);
    return CommandRunner.isWindowsHostPathStatic(resolved) ? resolved.toLowerCase() : resolved;
  }

  private static isWindowsHostPathStatic(candidate: string): boolean {
    return /^[A-Za-z]:[\\/]/.test(candidate) || /^\\\\/.test(candidate);
  }

  private static getHostPathApiStatic(candidate: string): typeof path.win32 | typeof path.posix {
    return CommandRunner.isWindowsHostPathStatic(candidate) ? path.win32 : path.posix;
  }
}

/**
 * Singleton instance of CommandRunner for project-wide use.
 */
export const commandRunner = new CommandRunner();

export function disposeCommandSpawner(): void {
  commandRunner.dispose();
}
