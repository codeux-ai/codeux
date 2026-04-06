import { CliWorkflowSettings, ProviderId } from "../../../contracts/app-types.js";
import type { McpConnectionInfo } from "../../../contracts/mcp-connection-types.js";
import { CommandResult, runStreamingCommand } from "../../../services/cli-process-runner.js";
import type { IDockerRunner } from "./docker-runner.js";
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
  /** MCP server connection info for injecting management tools into the CLI provider. */
  mcpConnection?: McpConnectionInfo | null;
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
    mcpConnection?: McpConnectionInfo | null;
  }): Promise<ProviderRunResult> {
    const { provider, prompt, cwd, model, apiKey, sessionId, workflowSettings, repoPath, githubToken, signal, onActivity } = input;
    const providerEnv = this.withProviderEnv(provider, model, apiKey, workflowSettings, githubToken);
    const nativeSessionId = input.continueSessionId || (provider === "claude-code" ? randomUUID() : null);

    const continueSession = !!input.continueSessionId;
    const spec = this.buildCommandSpec(provider, model, prompt, input.codexOutputPath, nativeSessionId, continueSession, !!input.mcpConnection);
    const { command, args } = spec;

    const localMcpCleanup: Array<{ path: string; originalContent: string | null }> = [];
    if (input.mcpConnection && workflowSettings.executionMode !== "DOCKER") {
      const entries = await this.writeLocalMcpConfig(input.mcpConnection, cwd, provider);
      localMcpCleanup.push(...entries);
    }

    const runCmd = async () => {
      if (workflowSettings.executionMode === "DOCKER") {
        const result = await this.dockerRunner.runProviderInDocker({
          command, args, cwd, providerEnv, sessionId,
          providerLabel: provider, workflowSettings, repoPath, signal, onActivity,
          mcpConnection: input.mcpConnection
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

    try {
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
    } finally {
      for (const entry of localMcpCleanup) {
        if (entry.originalContent !== null) {
          await fs.writeFile(entry.path, entry.originalContent).catch(() => undefined);
        } else {
          await fs.rm(entry.path, { force: true }).catch(() => undefined);
        }
      }
    }
  }

  private buildCommandSpec(
    provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">,
    model: string,
    prompt: string,
    codexOutputPath?: string | null,
    nativeSessionId?: string | null,
    continueSession?: boolean,
    mcpNative?: boolean,
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

    if (provider === "gemini" && mcpNative) {
      // MCP-native mode: drop --output-format json so Gemini loads MCP tools and returns plain text
      const args = continueSession
        ? ["--resume", "--yolo", "--p", prompt]
        : ["--yolo", "--p", prompt];
      return { command: "gemini", args };
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

  private async writeLocalMcpConfig(
    conn: McpConnectionInfo,
    cwd: string,
    provider: Extract<ProviderId, "gemini" | "codex" | "claude-code">
  ): Promise<Array<{ path: string; originalContent: string | null }>> {
    const headers: Record<string, string> = {};
    if (conn.authToken) {
      headers["Authorization"] = `Bearer ${conn.authToken}`;
    }
    const created: Array<{ path: string; originalContent: string | null }> = [];

    if (provider === "claude-code") {
      const configPath = path.join(cwd, ".mcp.json");
      const config = {
        mcpServers: {
          "sprint-os": {
            type: "http",
            url: conn.url,
            ...(Object.keys(headers).length > 0 ? { headers } : {}),
          },
        },
      };
      const originalContent = await fs.readFile(configPath, "utf8").catch(() => null);
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      created.push({ path: configPath, originalContent });
    } else if (provider === "gemini") {
      const dirPath = path.join(cwd, ".gemini");
      await fs.mkdir(dirPath, { recursive: true });
      const configPath = path.join(dirPath, "settings.json");
      const mcpServers = {
        "sprint-os": {
          httpUrl: conn.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        },
      };
      // Merge with existing project-level settings to preserve other config (e.g. general.maxAttempts)
      let existing: Record<string, unknown> = {};
      const originalContent = await fs.readFile(configPath, "utf8").catch(() => null);
      if (originalContent) {
        try { existing = JSON.parse(originalContent); } catch { /* ignore parse errors */ }
      }
      existing.mcpServers = { ...(existing.mcpServers as Record<string, unknown> || {}), ...mcpServers };
      await fs.writeFile(configPath, JSON.stringify(existing, null, 2));
      created.push({ path: configPath, originalContent });
    } else if (provider === "codex") {
      const dirPath = path.join(cwd, ".codex");
      await fs.mkdir(dirPath, { recursive: true });
      const configPath = path.join(dirPath, "config.toml");
      const lines = ["[mcp_servers.sprint-os]", `url = "${conn.url}"`];
      if (conn.authToken) {
        lines.push(`http_headers = { "Authorization" = "Bearer ${conn.authToken}" }`);
      }
      const originalContent = await fs.readFile(configPath, "utf8").catch(() => null);
      await fs.writeFile(configPath, lines.join("\n") + "\n");
      created.push({ path: configPath, originalContent });
    }

    return created;
  }
}
