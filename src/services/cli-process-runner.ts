import { commandRunner, CommandResult, CommandOptions } from "../shared/subprocess/command-runner.js";

export { commandRunner, CommandResult, CommandOptions };

export interface StreamingCommandOptions {
  signal?: AbortSignal;
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
  return commandRunner.run(command, args, {
    cwd,
    env,
    signal: options.signal,
    onStdoutLine: options.onStdoutLine,
    onStderrLine: options.onStderrLine,
  });
};

export const runCommandStrict = async (
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { signal?: AbortSignal } = {},
): Promise<CommandResult> => {
  return commandRunner.runStrict(command, args, { cwd, env, signal: options.signal });
};
