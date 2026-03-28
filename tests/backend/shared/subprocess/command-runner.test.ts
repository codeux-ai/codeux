import { describe, it, expect } from "vitest";
import { CommandRunner, commandRunner } from "../../../../src/shared/subprocess/command-runner.js";

describe("CommandRunner", () => {
  const runner = new CommandRunner();

  it("exports singleton commandRunner", () => {
     expect(commandRunner).toBeInstanceOf(CommandRunner);
  });

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
    expect(result.stderr).toContain("ENOENT");
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

  it("should abort immediately if signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await runner.run("node", ["-e", "setTimeout(() => {}, 10_000)"], {
        signal: controller.signal,
      });

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain("aborted");
  });

  it("should call streaming callbacks", async () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    await runner.run("sh", ["-c", "echo line1; echo line2 >&2"], {
      onStdoutLine: (line) => stdoutLines.push(line),
      onStderrLine: (line) => stderrLines.push(line)
    });
    expect(stdoutLines).toContain("line1");
    expect(stderrLines).toContain("line2");
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

  it("runStrict should throw with fallback Unknown error if no output", async () => {
      // Create a scenario where it fails but emits nothing.
      await expect(runner.runStrict("sh", ["-c", "exit 1 > /dev/null 2>&1"])).rejects.toThrow("sh -c exit 1 > /dev/null 2>&1 failed");
  });

  it("runStrict should return result on success", async () => {
    const result = await runner.runStrict("echo", ["ok"]);
    expect(result.stdout).toBe("ok");
  });
});
