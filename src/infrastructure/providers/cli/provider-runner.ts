import { CliWorkflowSettings, ProviderId } from "../../../contracts/app-types.js";
import { CommandResult, runStreamingCommand } from "../../../services/cli-process-runner.js";
import { IDockerRunner } from "./docker-runner.js";
import { isDockerWorkspaceMountError } from "../../../services/cli-docker-utils.js";
import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { getRepoSprintOsPath } from "../../../shared/config/sprint-os-paths.js";
import { collectProviderUsageTelemetry, type ProviderUsageTelemetry } from "./provider-usage.js";

export type ProviderCommandSpec = (model: string, prompt: string) => { command: string; args: string[] };

export interface ProviderRunResult extends CommandResult {
  usageTelemetry: ProviderUsageTelemetry;
  nativeSessionId: string | null;
  text?: string;
}

export const providerSpecs: Record<Extract<ProviderId, "gemini" | "codex" | "claude-code">, ProviderCommandSpec> = {
  "gemini": (model: string, prompt: string) => ({
    command: "gemini",
    args: ["--yolo", "--output-format", "json", "--p", prompt]
  }),
  "claude-code": (model: string, prompt: string) => {
    const args = ["--dangerously-skip-permissions"];
    if (model && model !== "default") args.push("--model", model);
    args.push("-p", prompt);
    return { command: "claude", args };
  },
  "codex": (model: string, prompt: string) => {
    const args = ["exec", "--yolo", "--json", "--output-last-message", "/tmp/codex-last-message.txt"];
    if (model && model !== "default") args.push("--model", model);
    args.push(prompt);
    return { command: "codex", args };
  }
};

export interface ProviderRunInput {
  provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
  prompt: string;
  cwd: string;
  model: string;
  apiKey: string;
  sessionId: string;
  workflowSettings: CliWorkflowSettings;
  repoPath: string;
  githubToken?: string;
  signal?: AbortSignal;
  onActivity: (desc: string, originator?: string) => void;
  /** Pass a previous nativeSessionId to continue an existing CLI session.
   *  Claude Code: reuses --session-id. Gemini: adds --resume. Codex: uses exec resume --last. */
  continueSessionId?: string | null;
}

export interface IProviderRunner {
  runProvider(input: ProviderRunInput): Promise<ProviderRunResult>;
  runProviderForText(input: ProviderRunInput): Promise<ProviderRunResult & { text: string }>;
}

export class ProviderRunner implements IProviderRunner {
  constructor(private readonly dockerRunner: IDockerRunner) { }

  async runProvider(input: ProviderRunInput): Promise<ProviderRunResult> {
    return await this.runProviderInternal(input);
  }

  async runProviderForText(input: ProviderRunInput): Promise<ProviderRunResult & { text: string }> {
    const outputPath = input.provider === "codex"
      ? path.join(getRepoSprintOsPath(input.repoPath, "tmp"), `provider-last-message-${input.sessionId}.txt`)
      : null;

    if (outputPath) {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
    }

    try {
      const result = await this.runProviderInternal({
        ...input,
        codexOutputPath: outputPath,
      });

      const capturedText = outputPath
        ? (await fs.readFile(outputPath, "utf8").catch(() => "")).trim()
        : "";

      return {
        ...result,
        text: capturedText || result.usageTelemetry.transcriptText || result.stdout || result.stderr,
      };
    } finally {
      if (outputPath) {
        await fs.rm(outputPath, { force: true }).catch(() => undefined);
      }
    }
  }

  private async runProviderInternal(input: {
    provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
    prompt: string;
    cwd: string;
    model: string;
    apiKey: string;
    sessionId: string;
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    githubToken?: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    codexOutputPath?: string | null;
    continueSessionId?: string | null;
  }): Promise<ProviderRunResult> {
    const { provider, prompt, cwd, model, apiKey, sessionId, workflowSettings, repoPath, githubToken, signal, onActivity } = input;
    const providerEnv = this.withProviderEnv(provider, model, apiKey, workflowSettings, githubToken);
    const nativeSessionId = input.continueSessionId || (provider === "claude-code" ? randomUUID() : null);

    const continueSession = !!input.continueSessionId;
    const spec = this.buildCommandSpec(provider, model, prompt, input.codexOutputPath, nativeSessionId, continueSession);
    const { command, args } = spec;

    const runCmd = async () => {
      if (workflowSettings.executionMode === "DOCKER") {
        const result = await this.dockerRunner.runProviderInDocker({
          command, args, cwd, providerEnv, sessionId,
          providerLabel: provider, workflowSettings, repoPath, signal, onActivity
        });
        if (!result.ok && isDockerWorkspaceMountError(result)) {
          try { await fs.access(cwd); onActivity(`Docker could not mount workspace path (${cwd}) even though it exists locally. Path visibility mismatch.`); } catch { /* ignore */ }
        }
        return result;
      }
      return await runStreamingCommand(command, args, cwd, providerEnv, {
        signal,
        onStdoutLine: (line) => {
          if (this.shouldSuppressStructuredStdout(provider, line)) {
            return;
          }
          onActivity(line, "agent");
        },
        onStderrLine: (line) => onActivity(`[${provider}] ${line}`, "provider"),
      });
    };

    let result = await runCmd();
    if (!result.ok && provider === "codex" && this.isTransientCodexTransportError(result)) {
      onActivity("Codex transport disconnected. Retrying once automatically...");
      await new Promise(r => setTimeout(r, 1500));
      result = await runCmd();
    }
    const capturedText = input.codexOutputPath
      ? (await fs.readFile(input.codexOutputPath, "utf8").catch(() => "")).trim()
      : "";
    const usageTelemetry = await collectProviderUsageTelemetry({
      provider,
      model,
      prompt,
      cwd,
      stdout: result.stdout,
      stderr: result.stderr,
      capturedText,
      nativeSessionId,
    });
    return {
      ...result,
      usageTelemetry,
      nativeSessionId: usageTelemetry.nativeSessionId || nativeSessionId,
    };
  }

  private buildCommandSpec(
    provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">,
    model: string,
    prompt: string,
    codexOutputPath?: string | null,
    nativeSessionId?: string | null,
    continueSession?: boolean,
  ): { command: string; args: string[] } {
    if (provider === "codex" && codexOutputPath) {
      // `codex exec resume --last` continues the most recent session in the cwd
      const args = continueSession
        ? ["exec", "resume", "--last", "--yolo", "--json", "--output-last-message", codexOutputPath]
        : ["exec", "--yolo", "--json", "--output-last-message", codexOutputPath];
      if (model && model !== "default") {
        args.push("--model", model);
      }
      args.push(prompt);
      return { command: "codex", args };
    }

    if (provider === "claude-code" && nativeSessionId) {
      const args = ["--dangerously-skip-permissions", "--session-id", nativeSessionId];
      if (model && model !== "default") {
        args.push("--model", model);
      }
      args.push("-p", prompt);
      return { command: "claude", args };
    }

    if (provider === "gemini" && continueSession) {
      // `gemini --resume` restores the last session's chat history
      // the generic builder does not handle model for gemini because gemini CLI reads it from env
      const args = ["--resume", "--yolo", "--output-format", "json", "--p", prompt];
      return {
        command: "gemini",
        args,
      };
    }

    const providerSpec = providerSpecs[provider];
    if (!providerSpec) {
      throw new Error(`Unsupported CLI provider: ${provider}`);
    }

    return providerSpec(model, prompt);
  }

  private withProviderEnv(
    provider: ProviderId,
    model: string,
    apiKey: string,
    workflowSettings: CliWorkflowSettings,
    githubToken?: string
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const useContainerMounts = workflowSettings.executionMode === "DOCKER";
    const useGithubMount = useContainerMounts && workflowSettings.containerMountGithubAuth;
    const useProviderMount = useContainerMounts
      && ((provider === "gemini" && workflowSettings.containerMountGeminiAuth)
        || (provider === "claude-code" && workflowSettings.containerMountClaudeCodeAuth)
        || (provider === "codex" && workflowSettings.containerMountCodexAuth));

    if (githubToken && !useGithubMount) {
      env.GH_TOKEN = githubToken;
      env.GITHUB_TOKEN = githubToken;
    }
    if (provider === "gemini") {
      if (model && model !== "default") env.GEMINI_MODEL = model;
      if (apiKey && !useProviderMount) env.GEMINI_API_KEY = apiKey;
    } else if (provider === "claude-code") {
      if (apiKey && !useProviderMount) env.ANTHROPIC_API_KEY = apiKey;
    } else if (provider === "codex") {
      if (model && model !== "default") env.CODEX_MODEL = model;
      if (apiKey && !useProviderMount) env.OPENAI_API_KEY = apiKey;
    }
    return env;
  }

  private isTransientCodexTransportError(result: CommandResult): boolean {
    const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return text.includes("stream disconnected before completion") || text.includes("error sending request for url") || text.includes("channel closed");
  }

  private shouldSuppressStructuredStdout(provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">, line: string): boolean {
    if (provider !== "gemini" && provider !== "codex") {
      return false;
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return false;
    }
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
}
