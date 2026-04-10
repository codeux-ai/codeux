import { spawn } from "child_process";

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
  trimOutput?: boolean;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  maxStderrChars?: number;
}

export class CommandRunner {
  private static readonly DEFAULT_MAX_STDERR_CHARS = 4096;

  /**
   * Runs a command and returns a Promise that resolves with the execution result.
   */
  async run(
    command: string,
    args: string[],
    options: CommandOptions = {}
  ): Promise<CommandResult> {
    const {
      cwd,
      env = process.env,
      timeout,
      signal,
      trimOutput = true,
      onStdoutLine,
      onStderrLine,
      maxStderrChars = CommandRunner.DEFAULT_MAX_STDERR_CHARS,
    } = options;

    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
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

        resolve({
          ok,
          code,
          stdout: trimOutput ? stdout.trim() : stdout,
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
      const commandString = `${command} ${args.join(" ")}`;
      const errorMessage = result.stderr || result.stdout || "Unknown error";
      throw new Error(`${commandString} failed: ${errorMessage}`);
    }
    return result;
  }
}

/**
 * Singleton instance of CommandRunner for project-wide use.
 */
export const commandRunner = new CommandRunner();
