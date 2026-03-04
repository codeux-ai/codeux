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
      let timedOut = false;
      let resolved = false;

      const finish = (ok: boolean, code: number | null, extraStderr?: string) => {
        if (resolved) return;
        resolved = true;
        if (timer) clearTimeout(timer);

        let finalStderr = stderr.trim();
        if (extraStderr) {
          finalStderr = finalStderr ? `${finalStderr}\n${extraStderr}` : extraStderr;
        }

        const clippedStderr = finalStderr.length > maxStderrChars
          ? `...${finalStderr.slice(-maxStderrChars)}`
          : finalStderr;

        resolve({
          ok,
          code,
          stdout: stdout.trim(),
          stderr: clippedStderr,
        });
      };

      const timer = timeout
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, timeout)
        : null;

      const handleData = (data: Buffer, isStderr: boolean, callback?: (line: string) => void) => {
        const text = data.toString();
        if (isStderr) {
          stderr += text;
        } else {
          stdout += text;
        }

        if (callback) {
          const lines = text.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
              callback(trimmed);
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
        const ok = code === 0 && !timedOut;
        const extra = timedOut ? `Command timed out after ${timeout}ms` : undefined;
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
