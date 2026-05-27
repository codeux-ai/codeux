import { describe, it, expect } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { CommandRunner } from "../../../../src/shared/subprocess/command-runner.js";

describe("CommandRunner", () => {
  const runner = new CommandRunner();

  it("should run a simple command (echo)", async () => {
    const result = await runner.run("echo", ["hello"]);
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
    // Use 'sh -c exit 1' to be cross-platform or just 'false' if on linux
    const result = await runner.run("sh", ["-c", "exit 1"]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
  });

  it("should respect timeout", async () => {
    // sleep for 10 seconds but timeout after 100ms
    const result = await runner.run("sleep", ["10"], { timeout: 100 });
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("timed out");
  });

  it("should abort a running command when the signal is cancelled", async () => {
    const controller = new AbortController();
    const runPromise = runner.run("node", ["-e", "setTimeout(() => {}, 10_000)"], {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort("test abort"), 50);

    const result = await runPromise;
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("aborted");
  });

  it("should call streaming callbacks", async () => {
    const stdoutLines: string[] = [];
    await runner.run("echo", ["line1\nline2"], {
      onStdoutLine: (line) => stdoutLines.push(line),
    });
    // Depending on how echo handles newlines, it might be one or two lines
    // In many shells echo "line1\nline2" might not interpret \n without -e
    // Let's use printf or multiple echoes
    const result = await runner.run("sh", ["-c", "echo line1; echo line2"], {
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
    await runner.run("node", ["-e", script], {
      onStdoutLine: (line) => stdoutLines.push(line),
    });
    expect(stdoutLines).toEqual(["hello", "world"]);
  });

  it("should flush remaining string in buffer on close", async () => {
    const stdoutLines: string[] = [];
    await runner.run("node", ["-e", "process.stdout.write('no_newline_at_end')"], {
      onStdoutLine: (line) => stdoutLines.push(line),
    });
    expect(stdoutLines).toEqual(["no_newline_at_end"]);
  });

  it("should preserve raw stdout when trimOutput is disabled", async () => {
    const result = await runner.run("node", ["-e", "process.stdout.write('hello\\n   \\n')"], {
      trimOutput: false,
    });

    expect(result.stdout).toBe("hello\n   \n");
  });

  it("should stream a file into command stdin", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-command-runner-"));
    const inputPath = path.join(tempDir, "input.txt");
    try {
      await fs.writeFile(inputPath, "from-file-stdin", "utf8");

      const result = await runner.run("node", ["-e", "process.stdin.pipe(process.stdout)"], {
        stdinFile: inputPath,
      });

      expect(result.ok).toBe(true);
      expect(result.stdout).toBe("from-file-stdin");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("should clip stderr if too long", async () => {
    // Generate 100 'a's on stderr
    const result = await runner.run("sh", ["-c", "for i in $(seq 1 100); do printf 'a' >&2; done"], {
      maxStderrChars: 10,
    });
    expect(result.stderr.length).toBeLessThanOrEqual(13); // "..." + 10 chars
    expect(result.stderr.startsWith("...")).toBe(true);
    expect(result.stderr.endsWith("aaaaaaaaaa")).toBe(true);
  });

  it("runStrict should throw on failure", async () => {
    await expect(runner.runStrict("sh", ["-c", "exit 1"])).rejects.toThrow("sh -c exit 1 failed");
  });

  it("runStrict truncates very long command arguments in failure messages", async () => {
    const longArg = "x".repeat(5000);
    let error: Error | null = null;

    try {
      await runner.runStrict("node", ["-e", "process.exit(1)", longArg]);
    } catch (caught) {
      error = caught as Error;
    }

    expect(error?.message).toContain("[truncated ");
    expect(error?.message).not.toContain(longArg);
  });

  it("runStrict should return result on success", async () => {
    const result = await runner.runStrict("echo", ["ok"]);
    expect(result.stdout).toBe("ok");
  });
});
