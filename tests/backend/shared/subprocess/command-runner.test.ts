import { describe, it, expect } from "vitest";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import { CommandRunner } from "../../../../src/shared/subprocess/command-runner.js";

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

  it("should clip stderr if too long", async () => {
    const result = await runner.run(node, ["-e", "process.stderr.write('a'.repeat(100))"], {
      maxStderrChars: 10,
    });
    expect(result.stderr.length).toBeLessThanOrEqual(13); // "..." + 10 chars
    expect(result.stderr.startsWith("...")).toBe(true);
    expect(result.stderr.endsWith("aaaaaaaaaa")).toBe(true);
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
});
