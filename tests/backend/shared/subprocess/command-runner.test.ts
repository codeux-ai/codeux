import { describe, it, expect, vi } from "vitest";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import { CommandRunner } from "../../../../src/shared/subprocess/command-runner.js";
import { beginRuntimeShutdown, resetRuntimeShutdownForTests } from "../../../../src/services/shutdown-state.js";
import { HostUnavailableError } from "../../../../src/shared/subprocess/command-spawner-client.js";

const DOCKER_HELPER_POOL_MODULE = "../../../../src/infrastructure/providers/cli/docker-helper-pool.js";

async function createGitRepositoryFixture(prefix: string): Promise<{ tempDir: string; repoDir: string }> {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), prefix));
  const repoDir = path.join(tempDir, "repo");
  await fsPromises.mkdir(path.join(repoDir, ".git"), { recursive: true });
  await fsPromises.writeFile(path.join(repoDir, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  return { tempDir, repoDir };
}

async function loadCommandRunnerWithMockedGitPool() {
  vi.resetModules();
  let capturedSpec: unknown;
  const pool = {
    ensure: vi.fn(async (_key: string) => "git-helper-1"),
    reserve: vi.fn((_key: string) => vi.fn()),
    withContainer: vi.fn(async (key: string, operation: (containerId: string) => Promise<unknown>) => (
      operation(await pool.ensure(key))
    )),
    touch: vi.fn((_key: string) => undefined),
    invalidate: vi.fn((_key: string, _expectedId?: string) => true),
    release: vi.fn(async (_key: string) => undefined),
    shutdown: vi.fn(async () => undefined),
    isContainerGone: vi.fn((result: { stdout?: string; stderr?: string }) => (
      `${result.stderr ?? ""} ${result.stdout ?? ""}`.toLowerCase().includes("no such container")
    )),
  };

  vi.doMock(DOCKER_HELPER_POOL_MODULE, () => ({
    HELPER_LABEL: "code-ux.helper",
    HELPER_OWNER_NAME_SUFFIX: "test-owner",
    DockerHelperContainerPool: class MockDockerHelperContainerPool {
      constructor(spec: unknown) {
        capturedSpec = spec;
      }

      ensure(key: string): Promise<string> {
        return pool.ensure(key);
      }

      reserve(key: string): () => void {
        return pool.reserve(key);
      }

      withContainer<T>(key: string, operation: (containerId: string) => Promise<T>): Promise<T> {
        return pool.withContainer(key, operation) as Promise<T>;
      }

      touch(key: string): void {
        pool.touch(key);
      }

      invalidate(key: string, expectedId?: string): boolean {
        return pool.invalidate(key, expectedId);
      }

      release(key: string): Promise<void> {
        return pool.release(key);
      }

      shutdown(): Promise<void> {
        return pool.shutdown();
      }

      isContainerGone(result: { stdout?: string; stderr?: string }): boolean {
        return pool.isContainerGone(result);
      }
    },
  }));

  const commandRunnerModule = await import("../../../../src/shared/subprocess/command-runner.js");
  const isolatedRunner = new commandRunnerModule.CommandRunner();
  const spawnProcess = vi.fn(async () => ({
    ok: true,
    code: 0,
    stdout: "",
    stderr: "",
  }));
  (isolatedRunner as unknown as { spawnProcess: typeof spawnProcess }).spawnProcess = spawnProcess;
  (commandRunnerModule.commandRunner as unknown as { spawnProcess: typeof spawnProcess }).spawnProcess = spawnProcess;

  return {
    commandRunnerModule,
    isolatedRunner,
    pool,
    spawnProcess,
    activate: (repoDir: string) => commandRunnerModule.acquireProjectGitHelper(repoDir),
    getCapturedSpec: () => capturedSpec,
    cleanup: async () => {
      await commandRunnerModule.shutdownGitHelperPool();
      vi.doUnmock(DOCKER_HELPER_POOL_MODULE);
      vi.resetModules();
    },
  };
}

describe("CommandRunner", () => {
  const runner = new CommandRunner();
  const node = process.execPath;

  it("should run a simple command (echo)", async () => {
    const result = await runner.run(node, ["-e", "console.log('hello')"]);
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("hello");
    expect(result.code).toBe(0);
  });

  it("should return ok: false for non-existent command", async () => {
    const result = await runner.run("non-existent-command-12345", []);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(null);
    expect(result.stderr).toMatch(/ENOENT|EACCES/);
  });

  it("does not duplicate an aborted command inline when the spawner is disposed during shutdown", async () => {
    const isolatedRunner = new CommandRunner();
    const controller = new AbortController();
    controller.abort("runtime shutdown");
    const spawner = {
      buildEnvPayload: vi.fn(() => ({ useBaseEnv: true })),
      run: vi.fn().mockRejectedValue(new HostUnavailableError("Command spawner client disposed")),
    };
    vi.spyOn(isolatedRunner as any, "getSpawner").mockReturnValue(spawner);
    const inlineSpawn = vi.spyOn(isolatedRunner as any, "spawnProcessInline").mockResolvedValue({
      ok: true,
      code: 0,
      stdout: "",
      stderr: "",
    });

    const result = await (isolatedRunner as any).spawnProcess(
      { command: "docker", args: ["run", "--name", "same-session", "image"] },
      { signal: controller.signal },
    );

    expect(result).toEqual({
      ok: false,
      code: null,
      stdout: "",
      stderr: "Command aborted",
    });
    expect(spawner.run).toHaveBeenCalledOnce();
    expect(inlineSpawn).not.toHaveBeenCalled();
  });

  it("rejects unsafe command names before spawning", async () => {
    await expect(runner.run("bad/command", [])).rejects.toThrow(/Unsafe command name/);
  });

  it("keeps provider-like command names behind validation unless a test explicitly launches them", async () => {
    vi.resetModules();
    const spawn = vi.fn();
    vi.doMock("child_process", () => ({ spawn }));

    try {
      const { CommandRunner: IsolatedCommandRunner } = await import("../../../../src/shared/subprocess/command-runner.js");
      const isolatedRunner = new IsolatedCommandRunner();

      await expect(isolatedRunner.run("codex exec", ["--help"])).rejects.toThrow(/Unsafe command name/);
      await expect(isolatedRunner.run("docker run", ["hello-world"])).rejects.toThrow(/Unsafe command name/);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("child_process");
      vi.resetModules();
    }
  });

  it("rejects null bytes in command arguments before spawning", async () => {
    await expect(runner.run(node, ["ok\0bad"])).rejects.toThrow(/null bytes/);
  });

  it("canonicalizes an existing working directory before spawning", async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "code-ux-command-runner-cwd-"));
    const nestedDir = path.join(tempDir, "nested");
    const aliasDir = path.join(tempDir, "alias");
    try {
      await fsPromises.mkdir(nestedDir);
      await fsPromises.symlink(nestedDir, aliasDir, process.platform === "win32" ? "junction" : "dir");

      const result = await runner.run(node, ["-e", "process.stdout.write(process.cwd())"], { cwd: aliasDir });

      expect(result.ok).toBe(true);
      expect(result.stdout).toBe(await fsPromises.realpath(nestedDir));
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid working directories before spawning", async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "code-ux-command-runner-invalid-cwd-"));
    const filePath = path.join(tempDir, "file.txt");
    await fsPromises.writeFile(filePath, "not a directory", "utf8");
    try {
      await expect(runner.run(node, ["-e", "process.exit(0)"], { cwd: " " })).rejects.toThrow(/cwd cannot be empty/i);
      await expect(runner.run(node, ["-e", "process.exit(0)"], { cwd: `${tempDir}\0outside` })).rejects.toThrow(/null bytes/i);
      await expect(runner.run(node, ["-e", "process.exit(0)"], { cwd: path.join(tempDir, "missing") })).rejects.toThrow(/existing directory/i);
      await expect(runner.run(node, ["-e", "process.exit(0)"], { cwd: filePath })).rejects.toThrow(/existing directory/i);
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("requires working directories outside standard local roots to be explicitly configured", async () => {
    const filesystemRoot = path.parse(process.cwd()).root;
    const previousRoots = process.env.CODE_UX_DIRECTORY_BROWSER_ROOTS;
    delete process.env.CODE_UX_DIRECTORY_BROWSER_ROOTS;
    try {
      await expect(runner.run(node, ["-e", "process.exit(0)"], { cwd: filesystemRoot }))
        .rejects.toThrow(/configured local roots/i);

      process.env.CODE_UX_DIRECTORY_BROWSER_ROOTS = filesystemRoot;
      const result = await runner.run(node, ["-e", "process.stdout.write(process.cwd())"], { cwd: filesystemRoot });
      expect(result.ok).toBe(true);
      expect(result.stdout).toBe(await fsPromises.realpath(filesystemRoot));
    } finally {
      if (previousRoots === undefined) {
        delete process.env.CODE_UX_DIRECTORY_BROWSER_ROOTS;
      } else {
        process.env.CODE_UX_DIRECTORY_BROWSER_ROOTS = previousRoots;
      }
    }
  });

  it("should handle error exit code", async () => {
    const result = await runner.run(node, ["-e", "process.exit(1)"]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
  });

  it("should respect timeout", async () => {
    const result = await runner.run(node, ["-e", "setTimeout(() => {}, 10_000)"], { timeout: 100 });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("timed out");
  });

  it("should abort a running command when the signal is cancelled", async () => {
    const controller = new AbortController();
    const runPromise = runner.run(node, ["-e", "setTimeout(() => {}, 10_000)"], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort("test abort"), 50);

    const result = await runPromise;
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("aborted");
  });

  it("should call streaming callbacks", async () => {
    const stdoutLines: string[] = [];
    await runner.run(node, ["-e", "console.log('line1'); console.log('line2')"], {
      onStdoutLine: (line) => stdoutLines.push(line),
    });
    expect(stdoutLines).toContain("line1");
    expect(stdoutLines).toContain("line2");
  });

  it("should buffer and emit correct line boundaries for partial chunks", async () => {
    const stdoutLines: string[] = [];
    const script = `
      process.stdout.write('hel');
      setTimeout(() => {
        process.stdout.write('lo\\nwo');
        setTimeout(() => {
          process.stdout.write('rld\\n');
        }, 10);
      }, 10);
    `;
    await runner.run(node, ["-e", script], {
      onStdoutLine: (line) => stdoutLines.push(line),
    });
    expect(stdoutLines).toEqual(["hello", "world"]);
  });

  it("should flush remaining string in buffer on close", async () => {
    const stdoutLines: string[] = [];
    await runner.run(node, ["-e", "process.stdout.write('no_newline_at_end')"], {
      onStdoutLine: (line) => stdoutLines.push(line),
    });
    expect(stdoutLines).toEqual(["no_newline_at_end"]);
  });

  it("bounds an unfinished streamed line instead of retaining unbounded child output", async () => {
    const stdoutLines: string[] = [];
    const script = `
      process.stdout.write('0123456789');
      setTimeout(() => process.stdout.write('abcdefghij'), 10);
    `;
    await runner.run(node, ["-e", script], {
      maxStdoutChars: 10,
      onStdoutLine: (line) => stdoutLines.push(line),
    });
    expect(stdoutLines).toEqual(["abcdefghij"]);
  });

  it("should preserve raw stdout when trimOutput is disabled", async () => {
    const result = await runner.run(node, ["-e", "process.stdout.write('hello\\n   \\n')"], {
      trimOutput: false,
    });

    expect(result.stdout).toBe("hello\n   \n");
  });

  it("should stream a file into command stdin", async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "code-ux-command-runner-"));
    const inputPath = path.join(tempDir, "input.txt");
    try {
      await fsPromises.writeFile(inputPath, "from-file-stdin", "utf8");

      const result = await runner.run(node, ["-e", "process.stdin.pipe(process.stdout)"], {
        stdinFile: inputPath,
      });

      expect(result.ok).toBe(true);
      expect(result.stdout).toBe("from-file-stdin");
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects stdin paths that are not files", async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "code-ux-command-runner-stdin-"));
    try {
      await expect(runner.run(node, ["-e", "process.stdin.resume()"], {
        stdinFile: tempDir,
      })).rejects.toThrow(/stdinFile is not a readable file/);
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should clip stdout if too long", async () => {
    const result = await runner.run(node, ["-e", "process.stdout.write('b'.repeat(100))"], {
      maxStdoutChars: 10,
    });
    expect(result.stdout.length).toBeLessThanOrEqual(13); // "..." + 10 chars
    expect(result.stdout.startsWith("...")).toBe(true);
    expect(result.stdout.endsWith("bbbbbbbbbb")).toBe(true);
  });

  it("should not clip small stdout", async () => {
    const result = await runner.run(node, ["-e", "process.stdout.write('b'.repeat(5))"], {
      maxStdoutChars: 10,
    });
    expect(result.stdout).toBe("bbbbb");
    expect(result.stdout.startsWith("...")).toBe(false);
  });

  it("should clip stderr if too long", async () => {
    const result = await runner.run(node, ["-e", "process.stderr.write('a'.repeat(100))"], {
      maxStderrChars: 10,
    });
    expect(result.stderr.length).toBeLessThanOrEqual(13); // "..." + 10 chars
    expect(result.stderr.startsWith("...")).toBe(true);
    expect(result.stderr.endsWith("aaaaaaaaaa")).toBe(true);
  });

  it("should format timeout message and retain clipped outputs correctly", async () => {
    const result = await runner.run(node, ["-e", "process.stderr.write('x'.repeat(100)); setTimeout(() => {}, 10_000)"], {
      timeout: 100,
      maxStderrChars: 10,
    });
    expect(result.ok).toBe(false);
    expect(result.stderr.startsWith("...")).toBe(true);
    expect(result.stderr).toContain("xxxxxxxxxx\nCommand timed out after 100ms");
  });

  it("should have parity between raw spawner finalization and inline result shaping", () => {
    const options = { timeout: 100, maxStderrChars: 5, maxStdoutChars: 5 };
    const rawResult = {
      code: 0,
      stdout: "hello world",
      stderr: "big error",
      stdoutClipped: true,
      stderrClipped: true,
      timedOut: true,
      aborted: false,
    };

    // Test the internal finalizeResult shaping logic directly.
    const shaped = (runner as any).finalizeResult(rawResult, options);

    expect(shaped.ok).toBe(false);
    expect(shaped.stdout).toBe("...hello world");
    expect(shaped.stderr).toBe("...big error\nCommand timed out after 100ms");
  });

  it("disposes the command spawner host when requested", () => {
    const isolatedRunner = new CommandRunner();
    const dispose = vi.fn();
    (isolatedRunner as unknown as { spawner: { dispose: () => void } | null }).spawner = { dispose };

    isolatedRunner.dispose();

    expect(dispose).toHaveBeenCalledOnce();
    expect((isolatedRunner as unknown as { spawner: unknown }).spawner).toBeNull();
  });

  it("should pass full lines to streaming callbacks even when stdout/stderr buffer is clipped", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const script = `
      process.stdout.write('first line\\n');
      process.stdout.write('second line that makes it too long\\n');
      process.stderr.write('error line one\\n');
      process.stderr.write('error line two too long\\n');
    `;
    const result = await runner.run(node, ["-e", script], {
      maxStdoutChars: 10,
      maxStderrChars: 10,
      onStdoutLine: (line) => stdoutLines.push(line),
      onStderrLine: (line) => stderrLines.push(line),
    });

    expect(stdoutLines).toEqual(["first line", "second line that makes it too long"]);
    expect(result.stdout.startsWith("...")).toBe(true);
    expect(result.stdout.endsWith("o long")).toBe(true);

    expect(stderrLines).toEqual(["error line one", "error line two too long"]);
    expect(result.stderr.startsWith("...")).toBe(true);
    expect(result.stderr.endsWith("o long")).toBe(true);
  });

  it("runStrict should throw on failure", async () => {
    await expect(runner.runStrict(node, ["-e", "process.exit(1)"])).rejects.toThrow("failed");
  });

  it("runStrict truncates very long command arguments in failure messages", async () => {
    const longArg = "x".repeat(5000);
    let error: Error | null = null;

    try {
      await runner.runStrict(node, ["-e", "process.exit(1)", longArg]);
    } catch (caught) {
      error = caught as Error;
    }

    expect(error?.message).toContain("[truncated ");
    expect(error?.message).not.toContain(longArg);
  });

  it("runStrict should return result on success", async () => {
    const result = await runner.runStrict(node, ["-e", "console.log('ok')"]);
    expect(result.stdout).toBe("ok");
  });

  it("rewrites git commands to the helper container when containerized git is enabled", () => {
    const tempRoot = path.join(os.tmpdir(), "code-ux-command-runner-repo");
    const result = (runner as unknown as {
      resolveCommand: (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => { command: string; args: string[] };
    }).resolveCommand("git", ["status", "--porcelain"], { cwd: tempRoot });

    expect(result.command).toBe("git");

    const previous = process.env.CODE_UX_CONTAINERIZED_GIT;
    process.env.CODE_UX_CONTAINERIZED_GIT = "1";
    try {
      const containerized = (runner as unknown as {
        resolveCommand: (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => { command: string; args: string[] };
      }).resolveCommand("git", ["status", "--porcelain"], { cwd: tempRoot });

      expect(containerized.command).toBe("docker");
      expect(containerized.args).toEqual(expect.arrayContaining([
        "run",
        "--rm",
        "type=tmpfs,target=/git",
        "HOME=/tmp/code-ux-git-home",
        "--entrypoint",
        "git",
        "alpine/git",
        "status",
        "--porcelain",
      ]));
    } finally {
      if (previous === undefined) {
        delete process.env.CODE_UX_CONTAINERIZED_GIT;
      } else {
        process.env.CODE_UX_CONTAINERIZED_GIT = previous;
      }
    }
  });

  it("keeps git commands on the host when command env requests host git", () => {
    const tempRoot = path.join(os.tmpdir(), "code-ux-command-runner-repo");
    const previous = process.env.CODE_UX_CONTAINERIZED_GIT;
    process.env.CODE_UX_CONTAINERIZED_GIT = "1";
    try {
      const result = (runner as unknown as {
        resolveCommand: (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => { command: string; args: string[] };
      }).resolveCommand("git", ["status", "--porcelain"], {
        cwd: tempRoot,
        env: { ...process.env, CODE_UX_GIT_CONTAINER_MODE: "host" },
      });

      expect(result.command).toBe("git");
      expect(result.args).toEqual(["status", "--porcelain"]);
    } finally {
      if (previous === undefined) {
        delete process.env.CODE_UX_CONTAINERIZED_GIT;
      } else {
        process.env.CODE_UX_CONTAINERIZED_GIT = previous;
      }
    }
  });

  it("keeps git commands containerized after runtime shutdown begins", () => {
    const tempRoot = path.join(os.tmpdir(), "code-ux-command-runner-repo");
    const previous = process.env.CODE_UX_CONTAINERIZED_GIT;
    process.env.CODE_UX_CONTAINERIZED_GIT = "1";
    beginRuntimeShutdown();
    try {
      const resolved = (runner as unknown as {
        resolveCommand: (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => { command: string; args: string[] };
      }).resolveCommand("git", ["status", "--porcelain"], { cwd: tempRoot });

      expect(resolved.command).toBe("docker");
    } finally {
      resetRuntimeShutdownForTests();
      if (previous === undefined) {
        delete process.env.CODE_UX_CONTAINERIZED_GIT;
      } else {
        process.env.CODE_UX_CONTAINERIZED_GIT = previous;
      }
    }
  });

  it("maps helper-container workspace paths in stdout back to the host cwd", () => {
    const mapped = (runner as unknown as {
      mapContainerStdoutToHost: (stdout: string, cwd: string) => string;
    }).mapContainerStdoutToHost("/workspace\n/workspace/src/index.ts\nrelative.txt\n", "/home/pierre/project");

    expect(mapped).toBe("/home/pierre/project\n/home/pierre/project/src/index.ts\nrelative.txt\n");
  });

  it("mounts absolute Git env paths for helper-container commands", async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "code-ux-git-env-mount-"));
    const repoDir = path.join(tempDir, "repo");
    const indexDir = path.join(tempDir, "index");
    await fsPromises.mkdir(repoDir);
    await fsPromises.mkdir(indexDir);

    const previous = process.env.CODE_UX_CONTAINERIZED_GIT;
    process.env.CODE_UX_CONTAINERIZED_GIT = "1";
    try {
      const containerized = (runner as unknown as {
        resolveCommand: (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => { command: string; args: string[] };
      }).resolveCommand("git", ["read-tree", "HEAD"], {
        cwd: repoDir,
        env: {
          ...process.env,
          GIT_INDEX_FILE: path.join(indexDir, "workspace.index"),
        },
      });

      expect(containerized.args).toEqual(expect.arrayContaining([
        "--mount",
        `type=bind,source=${indexDir},target=/mnt/code-ux/git-paths/0`,
        "-e",
        "GIT_INDEX_FILE=/mnt/code-ux/git-paths/0/workspace.index",
      ]));
    } finally {
      if (previous === undefined) {
        delete process.env.CODE_UX_CONTAINERIZED_GIT;
      } else {
        process.env.CODE_UX_CONTAINERIZED_GIT = previous;
      }
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rewrites external absolute Git args to portable container mount targets", async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "code-ux-git-arg-mount-"));
    const repoDir = path.join(tempDir, "repo");
    const bundleDir = path.join(tempDir, "bundle");
    const bundlePath = path.join(bundleDir, "repo.bundle");
    await fsPromises.mkdir(repoDir);
    await fsPromises.mkdir(bundleDir);

    const previous = process.env.CODE_UX_CONTAINERIZED_GIT;
    process.env.CODE_UX_CONTAINERIZED_GIT = "1";
    try {
      const containerized = (runner as unknown as {
        resolveCommand: (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => { command: string; args: string[] };
      }).resolveCommand("git", ["bundle", "create", bundlePath, "--all"], { cwd: repoDir });

      expect(containerized.args).toEqual(expect.arrayContaining([
        "--mount",
        `type=bind,source=${bundleDir},target=/mnt/code-ux/git-paths/0`,
        "/mnt/code-ux/git-paths/0/repo.bundle",
      ]));
      expect(containerized.args).not.toContain(bundlePath);
    } finally {
      if (previous === undefined) {
        delete process.env.CODE_UX_CONTAINERIZED_GIT;
      } else {
        process.env.CODE_UX_CONTAINERIZED_GIT = previous;
      }
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not widen helper mounts for an invalid ancestor Git marker", async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "code-ux-invalid-git-ancestor-"));
    const repoDir = path.join(tempDir, "repo");
    const indexDir = path.join(tempDir, "index");
    await fsPromises.mkdir(path.join(tempDir, ".git"));
    await fsPromises.mkdir(repoDir);
    await fsPromises.mkdir(indexDir);

    const previous = process.env.CODE_UX_CONTAINERIZED_GIT;
    process.env.CODE_UX_CONTAINERIZED_GIT = "1";
    try {
      const containerized = (runner as unknown as {
        resolveCommand: (command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => { args: string[] };
      }).resolveCommand("git", ["read-tree", "HEAD"], {
        cwd: repoDir,
        env: {
          ...process.env,
          GIT_INDEX_FILE: path.join(indexDir, "workspace.index"),
        },
      });

      expect(containerized.args).toEqual(expect.arrayContaining([
        "--mount",
        `type=bind,source=${repoDir},target=/workspace`,
        "--mount",
        `type=bind,source=${indexDir},target=/mnt/code-ux/git-paths/0`,
      ]));
      expect(containerized.args).not.toContain(`type=bind,source=${tempDir},target=/workspace`);
    } finally {
      if (previous === undefined) {
        delete process.env.CODE_UX_CONTAINERIZED_GIT;
      } else {
        process.env.CODE_UX_CONTAINERIZED_GIT = previous;
      }
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps Windows Git bundle paths out of Docker mount targets", () => {
    const repoDir = "C:\\Users\\pierr\\Projects\\repo";
    const bundleDir = "C:\\Users\\pierr\\AppData\\Local\\Temp\\code-ux-bundle-Zh27Uz";
    const bundlePath = `${bundleDir}\\repo.bundle`;

    const rewritten = (runner as unknown as {
      rewriteHostPathForContainer: (
        candidate: string,
        cwd: string,
        mappings: Array<{ hostPath: string; containerPath: string }>,
      ) => string;
    }).rewriteHostPathForContainer(bundlePath, repoDir, [
      { hostPath: bundleDir, containerPath: "/mnt/code-ux/git-paths/0" },
    ]);
    const mountArgs = (runner as unknown as {
      buildGitContainerMountArgs: (mappings: Array<{ hostPath: string; containerPath: string }>) => string[];
    }).buildGitContainerMountArgs([
      { hostPath: bundleDir, containerPath: "/mnt/code-ux/git-paths/0" },
    ]);

    expect(rewritten).toBe("/mnt/code-ux/git-paths/0/repo.bundle");
    expect(mountArgs).toContain(
      "type=bind,source=C:\\Users\\pierr\\AppData\\Local\\Temp\\code-ux-bundle-Zh27Uz,target=/mnt/code-ux/git-paths/0",
    );
    for (let index = 0; index < mountArgs.length; index += 1) {
      if (mountArgs[index - 1] === "--mount") {
        expect(mountArgs[index]).not.toMatch(/target=[A-Za-z]:/);
      }
    }
  });

  it("uses the same git helper pool key for a project root and its repo-local worktree", async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "code-ux-git-pool-root-"));
    const repoDir = path.join(tempDir, "repo");
    const worktreeDir = path.join(repoDir, ".worktrees", "session-1");
    const gitDir = path.join(repoDir, ".git");
    const worktreeGitDir = path.join(gitDir, "worktrees", "session-1");
    try {
      await fsPromises.mkdir(worktreeGitDir, { recursive: true });
      await fsPromises.mkdir(worktreeDir, { recursive: true });
      await fsPromises.writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n", "utf8");
      await fsPromises.writeFile(path.join(worktreeGitDir, "HEAD"), "ref: refs/heads/session-1\n", "utf8");
      await fsPromises.writeFile(path.join(worktreeDir, ".git"), `gitdir: ${worktreeGitDir}\n`, "utf8");
      await fsPromises.writeFile(path.join(worktreeGitDir, "commondir"), "../..\n", "utf8");

      const rootContext = (CommandRunner as unknown as {
        resolveGitPoolContextForPath: (cwd: string) => { poolKey: string; mountRoot: string; containerCwd: string } | null;
      }).resolveGitPoolContextForPath(repoDir);
      const worktreeContext = (CommandRunner as unknown as {
        resolveGitPoolContextForPath: (cwd: string) => { poolKey: string; mountRoot: string; containerCwd: string } | null;
      }).resolveGitPoolContextForPath(worktreeDir);

      expect(rootContext).toMatchObject({
        mountRoot: repoDir,
        containerCwd: "/workspace",
      });
      expect(worktreeContext).toMatchObject({
        mountRoot: repoDir,
        containerCwd: "/workspace/.worktrees/session-1",
      });
      expect(worktreeContext?.poolKey).toBe(rootContext?.poolKey);
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses distinct git helper pool keys for separate repositories", async () => {
    const first = await createGitRepositoryFixture("code-ux-git-pool-first-");
    const second = await createGitRepositoryFixture("code-ux-git-pool-second-");
    try {
      const resolveContext = (CommandRunner as unknown as {
        resolveGitPoolContextForPath: (cwd: string) => { poolKey: string; mountRoot: string } | null;
      }).resolveGitPoolContextForPath;
      const firstContext = resolveContext(first.repoDir);
      const secondContext = resolveContext(second.repoDir);

      expect(firstContext?.mountRoot).toBe(first.repoDir);
      expect(secondContext?.mountRoot).toBe(second.repoDir);
      expect(firstContext?.poolKey).not.toBe(secondContext?.poolKey);
    } finally {
      await Promise.all([
        fsPromises.rm(first.tempDir, { recursive: true, force: true }),
        fsPromises.rm(second.tempDir, { recursive: true, force: true }),
      ]);
    }
  });

  it("streams Git stdin through the warm helper and keeps auth environment command-scoped", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-stdin-");
    const stdinFile = path.join(fixture.tempDir, "paths");
    await fsPromises.writeFile(stdinFile, "first.txt\0second.txt\0", "utf8");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLease = mocked.activate(fixture.repoDir);
    try {
      const firstResult = await mocked.isolatedRunner.run(
        "git",
        ["add", "--pathspec-from-file=-", "--pathspec-file-nul"],
        {
          cwd: fixture.repoDir,
          stdinFile,
          env: { CODE_UX_CONTAINERIZED_GIT: "1", GH_TOKEN: "project-one-token" },
        },
      );
      const secondResult = await mocked.isolatedRunner.run("git", ["status", "--porcelain"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1", GH_TOKEN: "project-two-token" },
      });

      expect(firstResult.ok).toBe(true);
      expect(secondResult.ok).toBe(true);
      expect(mocked.pool.ensure).toHaveBeenCalledTimes(2);
      expect(mocked.pool.ensure.mock.calls[0]?.[0]).toBe(mocked.pool.ensure.mock.calls[1]?.[0]);
      expect(mocked.spawnProcess).toHaveBeenCalledTimes(2);

      const [firstCommand, firstOptions] = mocked.spawnProcess.mock.calls[0] ?? [];
      expect(firstCommand).toMatchObject({ command: "docker", containerHostCwd: fixture.repoDir });
      expect(firstCommand?.args).toEqual(expect.arrayContaining([
        "exec",
        "-i",
        "--workdir",
        "/workspace",
        "-e",
        "GH_TOKEN=project-one-token",
        "git-helper-1",
        "git",
        "add",
        "--pathspec-from-file=-",
      ]));
      expect(firstCommand?.args).not.toContain("GH_TOKEN=project-two-token");
      expect(firstOptions).toMatchObject({ cwd: fixture.repoDir, stdinFile });

      const [secondCommand] = mocked.spawnProcess.mock.calls[1] ?? [];
      expect(secondCommand?.args).toEqual(expect.arrayContaining([
        "exec",
        "-e",
        "GH_TOKEN=project-two-token",
        "git-helper-1",
        "git",
        "status",
      ]));
      expect(secondCommand?.args).not.toContain("-i");
      expect(secondCommand?.args).not.toContain("GH_TOKEN=project-one-token");
      expect(mocked.getCapturedSpec()).toBeDefined();
    } finally {
      await releaseLease();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to a stdin-capable one-shot Git helper when warm helper startup fails", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-fallback-");
    const stdinFile = path.join(fixture.tempDir, "paths");
    await fsPromises.writeFile(stdinFile, "first.txt\0", "utf8");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLease = mocked.activate(fixture.repoDir);
    mocked.pool.ensure.mockRejectedValueOnce(new Error("Docker daemon unavailable"));
    try {
      const result = await mocked.isolatedRunner.run(
        "git",
        ["add", "--pathspec-from-file=-", "--pathspec-file-nul"],
        {
          cwd: fixture.repoDir,
          stdinFile,
          env: { CODE_UX_CONTAINERIZED_GIT: "1", GH_TOKEN: "fallback-token" },
        },
      );

      expect(result.ok).toBe(true);
      expect(mocked.spawnProcess).toHaveBeenCalledOnce();
      const [fallbackCommand, fallbackOptions] = mocked.spawnProcess.mock.calls[0] ?? [];
      expect(fallbackCommand?.command).toBe("docker");
      expect(fallbackCommand?.args).toEqual(expect.arrayContaining([
        "run",
        "--rm",
        "-i",
        "GH_TOKEN=fallback-token",
        "--entrypoint",
        "git",
        "alpine/git",
      ]));
      expect(fallbackCommand?.args).not.toContain("exec");
      expect(fallbackOptions).toMatchObject({ stdinFile });
    } finally {
      await releaseLease();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("rejects an invalid Git stdin file before creating a warm helper", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-invalid-stdin-");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLease = mocked.activate(fixture.repoDir);
    try {
      await expect(mocked.isolatedRunner.run("git", ["hash-object", "--stdin"], {
        cwd: fixture.repoDir,
        stdinFile: path.join(fixture.tempDir, "missing-input"),
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      })).rejects.toThrow(/stdinFile is not a readable file/);

      expect(mocked.getCapturedSpec()).toBeUndefined();
      expect(mocked.pool.ensure).not.toHaveBeenCalled();
      expect(mocked.spawnProcess).not.toHaveBeenCalled();
    } finally {
      await releaseLease();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("keeps commands needing an external Git path mount on the one-shot helper", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-external-path-");
    const indexDir = path.join(fixture.tempDir, "indexes");
    await fsPromises.mkdir(indexDir);
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLease = mocked.activate(fixture.repoDir);
    try {
      const result = await mocked.isolatedRunner.run("git", ["read-tree", "HEAD"], {
        cwd: fixture.repoDir,
        env: {
          CODE_UX_CONTAINERIZED_GIT: "1",
          GIT_INDEX_FILE: path.join(indexDir, "temporary.index"),
        },
      });

      expect(result.ok).toBe(true);
      expect(mocked.pool.ensure).not.toHaveBeenCalled();
      expect(mocked.spawnProcess).toHaveBeenCalledOnce();
      expect(mocked.spawnProcess.mock.calls[0]?.[0]?.args).toEqual(expect.arrayContaining([
        "run",
        "--rm",
        "--mount",
        `type=bind,source=${indexDir},target=/mnt/code-ux/git-paths/0`,
        "GIT_INDEX_FILE=/mnt/code-ux/git-paths/0/temporary.index",
      ]));
    } finally {
      await releaseLease();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("creates repository-local Git bundles through the warm project helper", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-local-bundle-");
    const bundleDir = path.join(fixture.repoDir, ".git", "code-ux-bundles");
    const bundlePath = path.join(bundleDir, "snapshot.bundle");
    await fsPromises.mkdir(bundleDir, { recursive: true });
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLease = mocked.activate(fixture.repoDir);
    try {
      const result = await mocked.isolatedRunner.run(
        "git",
        ["bundle", "create", bundlePath, "refs/remotes/origin/dev"],
        { cwd: fixture.repoDir, env: { CODE_UX_CONTAINERIZED_GIT: "1" } },
      );

      expect(result.ok).toBe(true);
      expect(mocked.pool.ensure).toHaveBeenCalledOnce();
      expect(mocked.spawnProcess).toHaveBeenCalledOnce();
      expect(mocked.spawnProcess.mock.calls[0]?.[0]).toMatchObject({
        command: "docker",
        containerHostCwd: fixture.repoDir,
      });
      expect(mocked.spawnProcess.mock.calls[0]?.[0]?.args).toEqual(expect.arrayContaining([
        "exec",
        "git-helper-1",
        "git",
        "bundle",
        "create",
        "/workspace/.git/code-ux-bundles/snapshot.bundle",
      ]));
      expect(mocked.spawnProcess.mock.calls[0]?.[0]?.args).not.toContain("run");
    } finally {
      await releaseLease();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("invalidates only a vanished helper generation and retries with its replacement", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-retry-");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLease = mocked.activate(fixture.repoDir);
    mocked.pool.ensure
      .mockResolvedValueOnce("git-helper-old")
      .mockResolvedValueOnce("git-helper-new");
    mocked.spawnProcess
      .mockResolvedValueOnce({
        ok: false,
        code: 1,
        stdout: "",
        stderr: "Error: No such container: git-helper-old",
      })
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: "clean", stderr: "" });
    try {
      const result = await mocked.isolatedRunner.run("git", ["status", "--porcelain"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      });

      const poolKey = mocked.pool.ensure.mock.calls[0]?.[0];
      expect(result).toMatchObject({ ok: true, stdout: "clean" });
      expect(mocked.pool.invalidate).toHaveBeenCalledWith(poolKey, "git-helper-old");
      expect(mocked.pool.ensure).toHaveBeenCalledTimes(2);
      expect(mocked.spawnProcess.mock.calls[0]?.[0]?.args).toContain("git-helper-old");
      expect(mocked.spawnProcess.mock.calls[1]?.[0]?.args).toContain("git-helper-new");
      expect(mocked.spawnProcess.mock.calls.some(([command]) => command.args?.includes("run"))).toBe(false);
    } finally {
      await releaseLease();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("uses one-shot fallback after two vanished warm-helper generations", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-double-gone-");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLease = mocked.activate(fixture.repoDir);
    mocked.pool.ensure
      .mockResolvedValueOnce("git-helper-old")
      .mockResolvedValueOnce("git-helper-replacement");
    mocked.spawnProcess
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "No such container" })
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "container is not running" })
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: "fallback", stderr: "" });
    mocked.pool.isContainerGone.mockImplementation((result) => (
      /no such container|not running/i.test(`${result.stderr ?? ""} ${result.stdout ?? ""}`)
    ));
    try {
      const result = await mocked.isolatedRunner.run("git", ["status", "--porcelain"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      });

      const poolKey = mocked.pool.ensure.mock.calls[0]?.[0];
      expect(result).toMatchObject({ ok: true, stdout: "fallback" });
      expect(mocked.pool.invalidate).toHaveBeenNthCalledWith(1, poolKey, "git-helper-old");
      expect(mocked.pool.invalidate).toHaveBeenNthCalledWith(2, poolKey, "git-helper-replacement");
      expect(mocked.spawnProcess).toHaveBeenCalledTimes(3);
      expect(mocked.spawnProcess.mock.calls[2]?.[0]?.args).toEqual(expect.arrayContaining([
        "run",
        "--rm",
        "--entrypoint",
        "git",
      ]));
    } finally {
      await releaseLease();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("does not fall back for ordinary Git failures from a live warm helper", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-git-failure-");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLease = mocked.activate(fixture.repoDir);
    mocked.spawnProcess.mockResolvedValueOnce({
      ok: false,
      code: 128,
      stdout: "",
      stderr: "fatal: invalid reference",
    });
    try {
      const result = await mocked.isolatedRunner.run("git", ["show", "missing-ref"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      });

      expect(result).toMatchObject({ ok: false, code: 128 });
      expect(mocked.pool.invalidate).not.toHaveBeenCalled();
      expect(mocked.pool.ensure).toHaveBeenCalledOnce();
      expect(mocked.spawnProcess).toHaveBeenCalledOnce();
    } finally {
      await releaseLease();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("does not replay a Git command when warm-helper execution throws unexpectedly", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-exec-error-");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLease = mocked.activate(fixture.repoDir);
    mocked.spawnProcess.mockRejectedValueOnce(new Error("unexpected execution transport failure"));
    try {
      await expect(mocked.isolatedRunner.run("git", ["commit", "-m", "test"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      })).rejects.toThrow("unexpected execution transport failure");

      expect(mocked.pool.ensure).toHaveBeenCalledOnce();
      expect(mocked.spawnProcess).toHaveBeenCalledOnce();
    } finally {
      await releaseLease();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("keeps one project helper for active sprint leases and bounds concurrent Git execs", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-active-sprint-");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLeaseA = mocked.activate(fixture.repoDir);
    const releaseLeaseB = mocked.activate(fixture.repoDir);
    let activeExecs = 0;
    let peakExecs = 0;
    let releaseExecs!: () => void;
    const execGate = new Promise<void>((resolve) => {
      releaseExecs = resolve;
    });
    mocked.spawnProcess.mockImplementation(async (command) => {
      if (command.args?.includes("exec")) {
        activeExecs += 1;
        peakExecs = Math.max(peakExecs, activeExecs);
        await execGate;
        activeExecs -= 1;
      }
      return { ok: true, code: 0, stdout: "", stderr: "" };
    });

    try {
      const commands = Array.from({ length: 8 }, (_, index) => mocked.isolatedRunner.run(
        "git",
        ["show", `ref-${index}`],
        { cwd: fixture.repoDir, env: { CODE_UX_CONTAINERIZED_GIT: "1" } },
      ));
      await vi.waitFor(() => expect(activeExecs).toBe(4));
      expect(mocked.pool.reserve).toHaveBeenCalledOnce();
      expect(mocked.getCapturedSpec()).toBeDefined();

      releaseExecs();
      await Promise.all(commands);
      expect(peakExecs).toBe(4);
      expect(mocked.pool.ensure).toHaveBeenCalledTimes(8);

      await releaseLeaseA();
      expect(mocked.pool.release).not.toHaveBeenCalled();
      await releaseLeaseB();
      expect(mocked.pool.release).toHaveBeenCalledOnce();
    } finally {
      releaseExecs();
      await releaseLeaseA();
      await releaseLeaseB();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("hands an in-flight helper directly to a new lifecycle owner without container churn", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-handoff-");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releasePlanningLease = mocked.activate(fixture.repoDir);
    let finishCommand!: () => void;
    const commandGate = new Promise<void>((resolve) => {
      finishCommand = resolve;
    });
    mocked.spawnProcess.mockImplementationOnce(async () => {
      await commandGate;
      return { ok: true, code: 0, stdout: "", stderr: "" };
    });
    try {
      const command = mocked.isolatedRunner.run("git", ["status", "--porcelain"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      });
      await vi.waitFor(() => expect(mocked.spawnProcess).toHaveBeenCalledOnce());

      const planningRelease = releasePlanningLease();
      const releaseSprintLease = mocked.activate(fixture.repoDir);
      finishCommand();
      await Promise.all([command, planningRelease]);

      expect(mocked.pool.release).not.toHaveBeenCalled();
      await mocked.isolatedRunner.run("git", ["rev-parse", "HEAD"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      });
      expect(mocked.spawnProcess.mock.calls.every(([invocation]) => invocation.args?.includes("exec"))).toBe(true);

      await releaseSprintLease();
      expect(mocked.pool.release).toHaveBeenCalledOnce();
    } finally {
      finishCommand();
      await releasePlanningLease();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("keeps the dashboard-selected project helper running across independent Git operations", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-selected-project-");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    try {
      await mocked.commandRunnerModule.setSelectedProjectGitHelper(fixture.repoDir);
      await mocked.isolatedRunner.run("git", ["status", "--porcelain"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      });
      await mocked.isolatedRunner.run("git", ["rev-parse", "HEAD"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      });

      expect(mocked.spawnProcess).toHaveBeenCalledTimes(3);
      expect(mocked.spawnProcess.mock.calls.every(([command]) => command.args?.includes("exec"))).toBe(true);
      expect(mocked.spawnProcess.mock.calls.some(([command]) => command.args?.includes("run"))).toBe(false);
      expect(mocked.pool.release).not.toHaveBeenCalled();

      await mocked.commandRunnerModule.setSelectedProjectGitHelper(null);
      expect(mocked.pool.release).toHaveBeenCalledOnce();
    } finally {
      await mocked.commandRunnerModule.setSelectedProjectGitHelper(null).catch(() => undefined);
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("prepares a newly selected project before releasing the previous project helper", async () => {
    const first = await createGitRepositoryFixture("code-ux-git-selected-first-");
    const second = await createGitRepositoryFixture("code-ux-git-selected-second-");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const lifecycle: string[] = [];
    mocked.pool.ensure.mockImplementation(async (key: string) => {
      lifecycle.push(`ensure:${key}`);
      return `helper-${key}`;
    });
    mocked.pool.release.mockImplementation(async (key: string) => {
      lifecycle.push(`release:${key}`);
    });
    try {
      await mocked.commandRunnerModule.setSelectedProjectGitHelper(first.repoDir);
      const firstKey = mocked.pool.ensure.mock.calls.at(-1)?.[0];
      await mocked.commandRunnerModule.setSelectedProjectGitHelper(second.repoDir);
      const secondKey = mocked.pool.ensure.mock.calls.at(-1)?.[0];

      expect(firstKey).not.toBe(secondKey);
      expect(lifecycle.indexOf(`ensure:${secondKey}`)).toBeLessThan(lifecycle.indexOf(`release:${firstKey}`));
    } finally {
      await mocked.commandRunnerModule.setSelectedProjectGitHelper(null).catch(() => undefined);
      await mocked.cleanup();
      await Promise.all([
        fsPromises.rm(first.tempDir, { recursive: true, force: true }),
        fsPromises.rm(second.tempDir, { recursive: true, force: true }),
      ]);
    }
  });

  it("uses one-shot Git outside an active sprint and leaves no persistent helper", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-no-active-sprint-");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    try {
      const result = await mocked.isolatedRunner.run("git", ["status", "--porcelain"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      });

      expect(result.ok).toBe(true);
      expect(mocked.getCapturedSpec()).toBeUndefined();
      expect(mocked.pool.ensure).not.toHaveBeenCalled();
      expect(mocked.spawnProcess).toHaveBeenCalledOnce();
      expect(mocked.spawnProcess.mock.calls[0]?.[0]?.args).toEqual(expect.arrayContaining([
        "run",
        "--rm",
        "--entrypoint",
        "git",
      ]));
    } finally {
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("drains the shared project helper after a repo-local worktree lease ends", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-release-");
    const worktreeDir = path.join(fixture.repoDir, ".worktrees", "session-1");
    const worktreeGitDir = path.join(fixture.repoDir, ".git", "worktrees", "session-1");
    await fsPromises.mkdir(worktreeDir, { recursive: true });
    await fsPromises.mkdir(worktreeGitDir, { recursive: true });
    await fsPromises.writeFile(path.join(worktreeGitDir, "HEAD"), "ref: refs/heads/session-1\n", "utf8");
    await fsPromises.writeFile(path.join(worktreeGitDir, "commondir"), "../..\n", "utf8");
    await fsPromises.writeFile(path.join(worktreeDir, ".git"), `gitdir: ${worktreeGitDir}\n`, "utf8");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLease = mocked.activate(fixture.repoDir);
    try {
      await mocked.isolatedRunner.run("git", ["status", "--porcelain"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      });
      const projectPoolKey = mocked.pool.ensure.mock.calls[0]?.[0];

      await releaseLease();
      await mocked.commandRunnerModule.shutdownGitHelperPool();

      expect(mocked.pool.release).toHaveBeenCalledWith(projectPoolKey);
      expect(mocked.pool.shutdown).toHaveBeenCalledOnce();
    } finally {
      await releaseLease();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("does not recreate the warm Git helper pool after runtime shutdown begins", async () => {
    const fixture = await createGitRepositoryFixture("code-ux-git-pool-shutdown-");
    const mocked = await loadCommandRunnerWithMockedGitPool();
    const releaseLease = mocked.activate(fixture.repoDir);
    const shutdownState = await import("../../../../src/services/shutdown-state.js");
    try {
      const warmResult = await mocked.isolatedRunner.run("git", ["status", "--porcelain"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      });
      shutdownState.beginRuntimeShutdown();
      await mocked.commandRunnerModule.shutdownGitHelperPool();
      const lateResult = await mocked.isolatedRunner.run("git", ["status", "--porcelain"], {
        cwd: fixture.repoDir,
        env: { CODE_UX_CONTAINERIZED_GIT: "1" },
      });

      expect(warmResult.ok).toBe(true);
      expect(lateResult.ok).toBe(true);
      expect(mocked.pool.ensure).toHaveBeenCalledOnce();
      expect(mocked.pool.shutdown).toHaveBeenCalledOnce();
      expect(mocked.spawnProcess).toHaveBeenCalledTimes(2);
      expect(mocked.spawnProcess.mock.calls[0]?.[0]?.args).toContain("exec");
      expect(mocked.spawnProcess.mock.calls[1]?.[0]?.args).toEqual(expect.arrayContaining([
        "run",
        "--rm",
        "--entrypoint",
        "git",
      ]));
      expect(mocked.spawnProcess.mock.calls[1]?.[0]?.args).not.toContain("exec");
    } finally {
      await releaseLease();
      shutdownState.resetRuntimeShutdownForTests();
      await mocked.cleanup();
      await fsPromises.rm(fixture.tempDir, { recursive: true, force: true });
    }
  });

  it("mounts the project root for one-shot git commands started from repo-local worktrees", async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "code-ux-git-one-shot-root-"));
    const repoDir = path.join(tempDir, "repo");
    const worktreeDir = path.join(repoDir, ".worktrees", "session-1");
    const gitDir = path.join(repoDir, ".git");
    const worktreeGitDir = path.join(gitDir, "worktrees", "session-1");
    const stdinFile = path.join(tempDir, "paths");
    const previous = process.env.CODE_UX_CONTAINERIZED_GIT;
    process.env.CODE_UX_CONTAINERIZED_GIT = "1";
    try {
      await fsPromises.mkdir(worktreeGitDir, { recursive: true });
      await fsPromises.mkdir(worktreeDir, { recursive: true });
      await fsPromises.writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n", "utf8");
      await fsPromises.writeFile(path.join(worktreeGitDir, "HEAD"), "ref: refs/heads/session-1\n", "utf8");
      await fsPromises.writeFile(path.join(worktreeDir, ".git"), `gitdir: ${worktreeGitDir}\n`, "utf8");
      await fsPromises.writeFile(path.join(worktreeGitDir, "commondir"), "../..\n", "utf8");
      await fsPromises.writeFile(stdinFile, "test-1.md\0", "utf8");

      const containerized = (runner as unknown as {
        resolveCommand: (
          command: string,
          args: string[],
          options: { cwd?: string; env?: NodeJS.ProcessEnv; stdinFile?: string },
        ) => { command: string; args: string[]; containerHostCwd?: string };
      }).resolveCommand("git", ["add", "--pathspec-from-file=-", "--pathspec-file-nul"], {
        cwd: worktreeDir,
        stdinFile,
      });

      expect(containerized.command).toBe("docker");
      expect(containerized.containerHostCwd).toBe(repoDir);
      expect(containerized.args).toEqual(expect.arrayContaining([
        "--workdir",
        "/workspace/.worktrees/session-1",
        "--mount",
        `type=bind,source=${repoDir},target=/workspace`,
      ]));
      expect(containerized.args).not.toContain(`type=bind,source=${worktreeDir},target=/workspace`);
    } finally {
      if (previous === undefined) {
        delete process.env.CODE_UX_CONTAINERIZED_GIT;
      } else {
        process.env.CODE_UX_CONTAINERIZED_GIT = previous;
      }
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });
});
