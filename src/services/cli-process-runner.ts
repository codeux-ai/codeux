import { spawn } from "child_process";

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface StreamingCommandOptions {
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export const runStreamingCommand = async (
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: StreamingCommandOptions = {}
): Promise<CommandResult> => {
  return await new Promise<CommandResult>((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (options.onStdoutLine) {
        for (const line of text.split("\n").map((entry) => entry.trim()).filter((entry) => entry.length > 0)) {
          options.onStdoutLine(line);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      if (options.onStderrLine) {
        for (const line of text.split("\n").map((entry) => entry.trim()).filter((entry) => entry.length > 0)) {
          options.onStderrLine(line);
        }
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
};

export const runCommandStrict = async (
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<CommandResult> => {
  const result = await runStreamingCommand(command, args, cwd, env);
  if (!result.ok) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result;
};
