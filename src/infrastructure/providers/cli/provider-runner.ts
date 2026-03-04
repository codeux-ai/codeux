import { CliWorkflowSettings, ProviderId } from "../../../contracts/app-types.js";
import { CommandResult, runStreamingCommand } from "../../../services/cli-process-runner.js";
import { IDockerRunner } from "./docker-runner.js";
import { isDockerWorkspaceMountError } from "../../../services/cli-docker-utils.js";
import * as fs from "fs/promises";

export interface IProviderRunner {
  runProvider(input: {
    provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
    prompt: string;
    cwd: string;
    model: string;
    apiKey: string;
    sessionId: string;
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    githubToken?: string;
    onActivity: (desc: string, originator?: string) => void;
  }): Promise<CommandResult>;
}

export class ProviderRunner implements IProviderRunner {
  constructor(private readonly dockerRunner: IDockerRunner) { }

  async runProvider(input: {
    provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
    prompt: string;
    cwd: string;
    model: string;
    apiKey: string;
    sessionId: string;
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    githubToken?: string;
    onActivity: (desc: string, originator?: string) => void;
  }): Promise<CommandResult> {
    const { provider, prompt, cwd, model, apiKey, sessionId, workflowSettings, repoPath, githubToken, onActivity } = input;
    const providerEnv = this.withProviderEnv(provider, model, apiKey, githubToken);

    let command: string;
    let args: string[];

    if (provider === "gemini") {
      command = "gemini";
      args = ["--yolo", "--p", prompt];
    } else if (provider === "claude-code") {
      command = "claude";
      args = ["--dangerously-skip-permissions"];
      if (model && model !== "default") args.push("--model", model);
      args.push("-p", prompt);
    } else {
      command = "codex";
      args = ["exec", "--yolo", "--output-last-message", "/tmp/codex-last-message.txt"];
      if (model && model !== "default") args.push("--model", model);
      args.push(prompt);
    }

    const runCmd = async () => {
      if (workflowSettings.executionMode === "DOCKER") {
        const result = await this.dockerRunner.runProviderInDocker({
          command, args, cwd, providerEnv, sessionId,
          providerLabel: provider as any, workflowSettings, repoPath, onActivity
        });
        if (!result.ok && isDockerWorkspaceMountError(result)) {
          try { await fs.access(cwd); onActivity(`Docker could not mount workspace path (${cwd}) even though it exists locally. Path visibility mismatch.`); } catch { /* ignore */ }
        }
        return result;
      }
      return await runStreamingCommand(command, args, cwd, providerEnv, {
        onStdoutLine: (line) => onActivity(line, "agent"),
        onStderrLine: (line) => onActivity(`[${provider}] ${line}`, "provider"),
      });
    };

    let result = await runCmd();
    if (!result.ok && provider === "codex" && this.isTransientCodexTransportError(result)) {
      onActivity("Codex transport disconnected. Retrying once automatically...");
      await new Promise(r => setTimeout(r, 1500));
      result = await runCmd();
    }
    return result;
  }

  private withProviderEnv(provider: ProviderId, model: string, apiKey: string, githubToken?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (githubToken) { env.GH_TOKEN = githubToken; env.GITHUB_TOKEN = githubToken; }
    if (provider === "gemini") {
      if (model && model !== "default") env.GEMINI_MODEL = model;
      if (apiKey) env.GEMINI_API_KEY = apiKey;
    } else if (provider === "claude-code") {
      if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
    } else if (provider === "codex") {
      if (model && model !== "default") env.CODEX_MODEL = model;
      if (apiKey) env.OPENAI_API_KEY = apiKey;
    }
    return env;
  }

  private isTransientCodexTransportError(result: CommandResult): boolean {
    const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return text.includes("stream disconnected before completion") || text.includes("error sending request for url") || text.includes("channel closed");
  }
}
