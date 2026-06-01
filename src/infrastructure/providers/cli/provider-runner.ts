import { CliWorkflowSettings, ProviderId } from "../../../contracts/app-types.js";
import type { CustomMcpServer, QwenModelProviderSettings } from "../../../contracts/app-types.js";
import { isUsableCustomMcpServer } from "../../../mcp/mcp-tool-availability.js";
import { buildClaudeMcpServerEntry, buildCodexMcpServerTomlLines, buildGeminiMcpServerEntry, escapeTomlString } from "./mcp-config-format.js";
import type { McpConnectionInfo } from "../../../contracts/mcp-connection-types.js";
import { CommandResult, runStreamingCommand } from "../../../services/cli-process-runner.js";
import type { IDockerRunner } from "./docker-runner.js";
import { isDockerWorkspaceMountError } from "../../../services/cli-docker-utils.js";
import { resultHasSilentQuotaSignal } from "../../../shared/providers/provider-error-classifier.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as pathPosix from "path/posix";
import { randomUUID } from "crypto";
import { getRepoCodeUxPath } from "../../../shared/config/code-ux-paths.js";
import {
  collectProviderUsageTelemetry,
  parseQwenOpenAiLogs,
  sumQwenOpenAiUsage,
  type ProviderUsageTelemetry,
  type QwenUsageTotals,
} from "./provider-usage.js";

const CONTAINER_WORKSPACE_ROOT = "/workspace";
const CONTAINER_RUNTIME_HOME = pathPosix.join(CONTAINER_WORKSPACE_ROOT, ".code-ux-home");
// qwen-code's OpenAI logger defaults to `<cwd>/logs/openai`, which lands inside the
// worker's git worktree and gets committed. We redirect it to a controlled location
// outside the committed tree and read provider-reported usage back from there.
const QWEN_OPENAI_LOG_DIRNAME = "qwen-openai-logs";
// Inside the container, logs live under HOME (.code-ux-home) — on the workspace
// volume (so the host can read them) but excluded from exported patches.
const CONTAINER_QWEN_OPENAI_LOG_DIR = pathPosix.join(CONTAINER_RUNTIME_HOME, QWEN_OPENAI_LOG_DIRNAME);

const enabledCustomServersFor = (servers: CustomMcpServer[] | undefined, provider: ProviderId): CustomMcpServer[] =>
  (servers || []).filter((server) =>
    server.enabled
    && isUsableCustomMcpServer(server)
    && (!server.providers || server.providers.length === 0 || server.providers.includes(provider))
  );

const isOpenCodeNativeSessionId = (value: string | null | undefined): boolean => (
  typeof value === "string" && /^ses_[A-Za-z0-9]+$/.test(value)
);

export type ProviderCommandSpec = (model: string, prompt: string) => { command: string; args: string[] };

export interface ProviderRunResult extends CommandResult {
  usageTelemetry: ProviderUsageTelemetry;
  nativeSessionId: string | null;
  text?: string;
}

export type CliProviderId = Extract<ProviderId, "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity">;

export const providerSpecs: Record<CliProviderId, ProviderCommandSpec> = {
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
    const args = ["exec", "--yolo", "--json", "--output-last-message", "codex-last-message.txt"];
    if (model && model !== "default") args.push("--model", model);
    args.push(prompt);
    return { command: "codex", args };
  },
  "qwen-code": (model: string, prompt: string) => {
    const args = ["--yolo"];
    if (model && model !== "default") args.push("--model", model);
    args.push("-p", prompt);
    return { command: "qwen", args };
  },
  opencode: (model: string, prompt: string) => {
    const args = ["run", "--format", "json"];
    if (model && model !== "default") args.push("--model", model);
    args.push(prompt);
    return { command: "opencode", args };
  },
  antigravity: (model: string, prompt: string) => {
    const args = ["--dangerously-skip-permissions"];
    if (model && model !== "default") args.push("--model", model);
    args.push("-p", prompt);
    return { command: "agy", args };
  },
};

interface OpenCodeRuntimeSettings {
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
}

interface QwenRuntimeSettings {
  qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
  qwenRegion?: "china" | "international";
  qwenBaseUrl?: string;
  qwenEnvKey?: string;
  qwenModelId?: string;
  qwenProtocol?: "openai" | "anthropic" | "gemini";
  qwenAdditionalModelProviders?: QwenModelProviderSettings[];
}

export interface ProviderRunInput {
  provider: CliProviderId;
  prompt: string;
  cwd: string;
  model: string;
  apiKey: string;
  qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
  qwenRegion?: "china" | "international";
  qwenBaseUrl?: string;
  qwenEnvKey?: string;
  qwenModelId?: string;
  qwenProtocol?: "openai" | "anthropic" | "gemini";
  qwenAdditionalModelProviders?: QwenModelProviderSettings[];
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
  providerMountAuth?: boolean;
  providerAuthPath?: string;
  /** Override the default API endpoint for providers that support it.
   *  Sets ANTHROPIC_BASE_URL (claude-code) or OPENAI_BASE_URL (codex). */
  customBaseUrl?: string;
  /** Override the model identifier sent to the CLI for providers that support a custom
   *  base URL (claude-code, codex). Used when routing through a gateway such as OpenRouter
   *  whose model slugs differ from the built-in preset names. */
  customModel?: string;
  sessionId: string;
  workspaceSessionId?: string;
  workflowSettings: CliWorkflowSettings;
  repoPath: string;
  githubToken?: string;
  gitlabToken?: string;
  signal?: AbortSignal;
  onActivity: (desc: string, originator?: string) => void;
  /** Pass a previous nativeSessionId to continue an existing CLI session.
   *  Claude Code: reuses --session-id. Gemini: adds --resume. Codex: uses exec resume --last. */
  continueSessionId?: string | null;
  /** MCP server connection info for injecting management tools into the CLI provider. */
  mcpConnection?: McpConnectionInfo | null;
  /** User-defined custom MCP servers injected into the CLI provider alongside code_ux. */
  customMcpServers?: CustomMcpServer[];
}

export interface IProviderRunner {
  runProvider(input: ProviderRunInput): Promise<ProviderRunResult>;
  runProviderForText(input: ProviderRunInput): Promise<ProviderRunResult & { text: string }>;
}

export class ProviderRunner implements IProviderRunner {
  constructor(private readonly dockerRunner: IDockerRunner) { }

  async runProvider(input: ProviderRunInput): Promise<ProviderRunResult> {
    const prepared = input.workflowSettings.executionMode === "DOCKER"
      ? await this.dockerRunner.ensureWorkspace({
        cwd: input.cwd,
        repoPath: input.repoPath,
        sessionId: input.workspaceSessionId || input.sessionId,
      })
      : { cwd: input.cwd, cleanup: async () => undefined };

    const outputPath = this.resolveCodexOutputPath(input);

    if (outputPath && !outputPath.startsWith("/workspace/")) {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
    }

    try {
      return await this.runProviderInternal({
        ...input,
        cwd: prepared.cwd,
        codexOutputPath: outputPath,
      });
    } finally {
      await prepared.cleanup();
      await this.cleanupCodexOutputPath(outputPath, input.workflowSettings.executionMode, prepared.cwd);
    }
  }

  async runProviderForText(input: ProviderRunInput): Promise<ProviderRunResult & { text: string }> {
    const prepared = input.workflowSettings.executionMode === "DOCKER"
      ? await this.dockerRunner.ensureWorkspace({
        cwd: input.cwd,
        repoPath: input.repoPath,
        sessionId: input.workspaceSessionId || input.sessionId,
      })
      : { cwd: input.cwd, cleanup: async () => undefined };

    const outputPath = this.resolveCodexOutputPath(input);

    if (outputPath && !outputPath.startsWith("/workspace/")) {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
    }

    try {
      const result = await this.runProviderInternal({
        ...input,
        cwd: prepared.cwd,
        codexOutputPath: outputPath,
      });

      const capturedText = outputPath
        ? outputPath.startsWith("/workspace/")
          ? ((await this.dockerRunner.readWorkspaceFile?.(prepared.cwd, outputPath).catch(() => null)) || "").trim()
          : (await fs.readFile(outputPath, "utf8").catch(() => "")).trim()
        : "";

      return {
        ...result,
        text: capturedText || result.usageTelemetry.transcriptText || result.stdout || result.stderr,
      };
    } finally {
      await prepared.cleanup();
      await this.cleanupCodexOutputPath(outputPath, input.workflowSettings.executionMode, prepared.cwd);
    }
  }

  private resolveCodexOutputPath(input: ProviderRunInput): string | null {
    if (input.provider !== "codex") {
      return null;
    }
    return input.workflowSettings.executionMode === "DOCKER"
      ? pathPosix.join("/workspace", `provider-last-message-${input.sessionId}.txt`)
      : path.join(os.tmpdir(), `provider-last-message-${input.sessionId}.txt`);
  }

  private async cleanupCodexOutputPath(
    outputPath: string | null,
    executionMode: CliWorkflowSettings["executionMode"],
    preparedCwd: string,
  ): Promise<void> {
    if (!outputPath) {
      return;
    }
    if (executionMode === "DOCKER") {
      if (this.dockerRunner.removeWorkspaceDir) {
        await this.dockerRunner.removeWorkspaceDir(preparedCwd, outputPath).catch(() => undefined);
      }
    } else {
      await fs.rm(outputPath, { force: true }).catch(() => undefined);
    }
  }

  private async runProviderInternal(input: {
    provider: CliProviderId;
    prompt: string;
    cwd: string;
    model: string;
    apiKey: string;
    qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
    qwenRegion?: "china" | "international";
    qwenBaseUrl?: string;
    qwenEnvKey?: string;
    qwenModelId?: string;
    qwenProtocol?: "openai" | "anthropic" | "gemini";
    qwenAdditionalModelProviders?: QwenModelProviderSettings[];
    openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
    openCodeProviderId?: string;
    openCodeModelId?: string;
    openCodeBaseUrl?: string;
    openCodeEnvKey?: string;
    openCodePackage?: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
    customBaseUrl?: string;
    customModel?: string;
    sessionId: string;
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    githubToken?: string;
    gitlabToken?: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    codexOutputPath?: string | null;
    continueSessionId?: string | null;
    mcpConnection?: McpConnectionInfo | null;
    customMcpServers?: CustomMcpServer[];
  }): Promise<ProviderRunResult> {
    const { provider, prompt, cwd, model, apiKey, providerMountAuth, providerAuthPath, sessionId, workflowSettings, repoPath, githubToken, gitlabToken, signal, onActivity } = input;
    const startedMs = Date.now();
    const runModel = this.resolveRunModel(provider, model, input);
    // Resolve where qwen-code should write its OpenAI request/response logs, as seen
    // by the qwen process. Kept outside the committed worktree in both execution modes.
    const qwenProcessLogDir = provider === "qwen-code"
      ? (workflowSettings.executionMode === "DOCKER"
        ? CONTAINER_QWEN_OPENAI_LOG_DIR
        : this.resolveQwenHostLogDir(sessionId))
      : undefined;
    const providerEnv = this.withProviderEnv(provider, runModel, apiKey, workflowSettings, githubToken, providerMountAuth, input, qwenProcessLogDir, gitlabToken);
    const nativeSessionId = provider === "opencode"
      ? isOpenCodeNativeSessionId(input.continueSessionId) ? input.continueSessionId! : null
      : input.continueSessionId || (provider === "claude-code" || provider === "qwen-code" ? randomUUID() : null);

    const applicableCustomServers = enabledCustomServersFor(input.customMcpServers, provider);
    const hasMcpConfig = !!input.mcpConnection || applicableCustomServers.length > 0;
    const continueSession = !!input.continueSessionId;
    const codexProviderArgs = this.buildCodexCustomProviderArgs(provider, input, workflowSettings);
    const spec = this.buildCommandSpec(
      provider,
      runModel,
      prompt,
      workflowSettings.executionMode === "DOCKER" ? CONTAINER_WORKSPACE_ROOT : cwd,
      input.codexOutputPath,
      nativeSessionId,
      continueSession,
      hasMcpConfig,
      input.qwenAuthMode,
      input.qwenProtocol,
      codexProviderArgs,
    );
    const { command, args } = spec;

    const localMcpCleanup: Array<{ path: string; originalContent: string | null }> = [];
    const localRuntimeCleanup: Array<string> = [];
    if (provider === "opencode" && workflowSettings.executionMode !== "DOCKER") {
      const configPath = await this.writeLocalOpenCodeConfig(providerEnv.OPENCODE_CONFIG_CONTENT, repoPath, sessionId);
      if (configPath) {
        providerEnv.OPENCODE_CONFIG = configPath;
        localRuntimeCleanup.push(configPath);
      }
    }
    if ((input.mcpConnection || applicableCustomServers.length > 0 || (provider === "qwen-code" && providerEnv.QWEN_SETTINGS_CONTENT)) && workflowSettings.executionMode !== "DOCKER") {
      const entries = await this.writeLocalMcpConfig(input.mcpConnection || null, cwd, provider, providerEnv.QWEN_SETTINGS_CONTENT, applicableCustomServers);
      localMcpCleanup.push(...entries);
    }

    // Start each qwen run from an empty log directory so usage aggregation only
    // counts this invocation (the directory is reused across a session's runs).
    if (provider === "qwen-code") {
      await this.resetQwenOpenAiLogDir(cwd, workflowSettings.executionMode, sessionId);
    }

    const runCmd = async () => {
      if (workflowSettings.executionMode === "DOCKER") {
        const result = await this.dockerRunner.runProviderInDocker({
          command, args, cwd, providerEnv, sessionId,
          providerLabel: provider, workflowSettings, repoPath, signal, onActivity,
          providerMountAuth,
          providerAuthPath,
          mcpConnection: input.mcpConnection,
          customMcpServers: input.customMcpServers,
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
      // Antigravity's `agy` CLI prints its quota message and still exits 0. Left as-is
      // it would be reported as a successful (but truncated) run, completing the task
      // unfinished. Demote it to a failure so the shared quota classification/hold path
      // (the same one other providers use) puts the task on hold until quota resets.
      if (result.ok && resultHasSilentQuotaSignal(provider, result)) {
        onActivity(`[${provider}] Quota limit reached; provider stopped before completing the task.`, "provider");
        result = { ...result, ok: false };
      }
      const capturedText = input.codexOutputPath
        ? await this.readProviderOutputPath(cwd, input.codexOutputPath, workflowSettings.executionMode)
        : "";
      const claudeSessionJsonl = provider === "claude-code" && nativeSessionId
        ? await this.readClaudeSessionJsonl(cwd, nativeSessionId, workflowSettings.executionMode)
        : null;
      const codexSessionJson = provider === "codex"
        ? await this.readCodexLatestSessionJson(cwd, workflowSettings.executionMode)
        : null;
      const qwenReportedUsage = provider === "qwen-code"
        ? await this.readQwenOpenAiUsage(cwd, workflowSettings.executionMode, sessionId, startedMs)
        : null;
      const usageTelemetry = await collectProviderUsageTelemetry({
        provider,
        model: runModel,
        prompt,
        cwd,
        stdout: result.stdout,
        stderr: result.stderr,
        capturedText,
        nativeSessionId,
        claudeSessionJsonl,
        codexSessionJson,
        qwenReportedUsage,
        startTimeMs: startedMs,
        executionMode: workflowSettings.executionMode,
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
      for (const cleanupPath of localRuntimeCleanup) {
        await fs.rm(cleanupPath, { force: true }).catch(() => undefined);
      }
      if (provider === "qwen-code" && workflowSettings.executionMode !== "DOCKER") {
        await fs.rm(this.resolveQwenHostLogDir(sessionId), { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  private resolveRunModel(
    provider: CliProviderId,
    model: string,
    config: Pick<ProviderRunInput, "qwenAuthMode" | "qwenModelId" | "openCodeAuthMode" | "openCodeProviderId" | "openCodeModelId" | "customModel">,
  ): string {
    // claude-code / codex routed through a custom base URL (e.g. OpenRouter) use the
    // gateway's own model slug, which overrides the preset model the agent selected.
    if ((provider === "claude-code" || provider === "codex") && config.customModel && config.customModel.trim().length > 0) {
      return config.customModel.trim();
    }
    if (provider === "qwen-code" && config.qwenAuthMode === "MODEL_PROVIDER") {
      if (model === "custom/model" || model === "local-model") {
        return (config.qwenModelId || "glm-4.7-flash").trim();
      }
      return (config.qwenModelId || model || "glm-4.7-flash").trim();
    }
    if (provider !== "opencode" || config.openCodeAuthMode !== "CUSTOM_PROVIDER") {
      return model;
    }
    const providerId = (config.openCodeProviderId || model.split("/")[0] || "custom").trim();
    const modelId = (config.openCodeModelId || model.split("/").slice(1).join("/") || "model").trim();
    return `${providerId}/${modelId}`;
  }

  private async writeLocalOpenCodeConfig(
    content: string | undefined,
    repoPath: string,
    sessionId: string,
  ): Promise<string | null> {
    if (!content) {
      return null;
    }
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "-");
    const configPath = path.join(getRepoCodeUxPath(repoPath, "tmp"), `opencode-config-${safeSessionId}.json`);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, `${content}\n`, "utf8");
    return configPath;
  }

  private async readProviderOutputPath(
    cwd: string,
    outputPath: string,
    executionMode: CliWorkflowSettings["executionMode"],
  ): Promise<string> {
    if (executionMode === "DOCKER" && outputPath.startsWith(`${CONTAINER_WORKSPACE_ROOT}/`)) {
      return ((await this.dockerRunner.readWorkspaceFile?.(cwd, outputPath).catch(() => null)) || "").trim();
    }

    return (await fs.readFile(outputPath, "utf8").catch(() => "")).trim();
  }

  /** Host-side directory for qwen-code OpenAI logs in non-Docker runs, kept outside the worktree. */
  private resolveQwenHostLogDir(sessionId: string): string {
    const safeSession = (sessionId || "session").replace(/[^A-Za-z0-9_-]/g, "_");
    return path.join(os.tmpdir(), "code-ux-qwen-openai-logs", safeSession);
  }

  /** Clears stale qwen OpenAI logs before a run so usage aggregation is per-invocation. */
  private async resetQwenOpenAiLogDir(
    cwd: string,
    executionMode: CliWorkflowSettings["executionMode"],
    sessionId: string,
  ): Promise<void> {
    if (executionMode === "DOCKER") {
      await this.dockerRunner.removeWorkspaceDir?.(cwd, CONTAINER_QWEN_OPENAI_LOG_DIR).catch(() => undefined);
      return;
    }
    const logDir = this.resolveQwenHostLogDir(sessionId);
    await fs.rm(logDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(logDir, { recursive: true }).catch(() => undefined);
  }

  /** Aggregates provider-reported usage from qwen-code OpenAI logs for both execution modes. */
  private async readQwenOpenAiUsage(
    cwd: string,
    executionMode: CliWorkflowSettings["executionMode"],
    sessionId: string,
    startTimeMs: number,
  ): Promise<QwenUsageTotals | null> {
    if (executionMode === "DOCKER") {
      const arrayJson = await this.dockerRunner.readWorkspaceJsonArray?.(cwd, CONTAINER_QWEN_OPENAI_LOG_DIR).catch(() => null);
      if (!arrayJson) return null;
      try {
        const records = JSON.parse(arrayJson);
        return Array.isArray(records) ? sumQwenOpenAiUsage(records) : null;
      } catch {
        return null;
      }
    }
    return parseQwenOpenAiLogs(this.resolveQwenHostLogDir(sessionId), startTimeMs);
  }

  private async readCodexLatestSessionJson(
    cwd: string,
    executionMode: CliWorkflowSettings["executionMode"],
  ): Promise<string | null> {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const day = now.getDate().toString().padStart(2, "0");

    if (executionMode === "DOCKER") {
      const sessionsDir = pathPosix.join(
        CONTAINER_RUNTIME_HOME,
        ".codex",
        "sessions",
        year,
        month,
        day,
      );
      return (await this.dockerRunner.readLatestWorkspaceFile?.(cwd, sessionsDir).catch(() => null)) ?? null;
    }

    const sessionsDir = path.join(os.homedir(), ".codex", "sessions", year, month, day);
    try {
      const files = await fs.readdir(sessionsDir);
      const jsonFiles = files.filter(f => f.endsWith(".json"));
      if (jsonFiles.length === 0) return null;
      const withMtimes = await Promise.all(
        jsonFiles.map(async (f) => {
          const filePath = path.join(sessionsDir, f);
          const stat = await fs.stat(filePath).catch(() => null);
          return { filePath, mtime: stat?.mtimeMs ?? 0 };
        }),
      );
      withMtimes.sort((a, b) => b.mtime - a.mtime);
      return await fs.readFile(withMtimes[0].filePath, "utf8").catch(() => null);
    } catch {
      return null;
    }
  }

  private async readClaudeSessionJsonl(
    cwd: string,
    nativeSessionId: string,
    executionMode: CliWorkflowSettings["executionMode"],
  ): Promise<string | null> {
    if (executionMode !== "DOCKER") {
      return null;
    }

    const sessionPath = pathPosix.join(
      CONTAINER_RUNTIME_HOME,
      ".claude",
      "projects",
      CONTAINER_WORKSPACE_ROOT.replaceAll(pathPosix.sep, "-"),
      `${nativeSessionId}.jsonl`,
    );
    return (await this.dockerRunner.readWorkspaceFile?.(cwd, sessionPath).catch(() => null)) || null;
  }

  /** Builds the `-c` config overrides that point Codex at a custom OpenAI-compatible
   *  model provider (e.g. OpenRouter). We register a dedicated provider with
   *  `requires_openai_auth = false` so non-`sk-` gateway keys are accepted. The wire API is
   *  left at Codex's default (`responses`); `chat` is no longer supported by Codex. Returns an
   *  empty array for non-codex providers or when no custom base URL is configured. */
  private buildCodexCustomProviderArgs(
    provider: CliProviderId,
    config: Pick<ProviderRunInput, "customBaseUrl">,
    workflowSettings: CliWorkflowSettings,
  ): string[] {
    if (provider !== "codex" || !config.customBaseUrl || config.customBaseUrl.trim().length === 0) {
      return [];
    }
    const providerId = "custom_gateway";
    const baseUrl = this.rewriteLoopbackUrlForDocker(
      config.customBaseUrl.trim(),
      this.shouldRewriteDockerLoopbackUrls(workflowSettings),
    );
    return [
      "-c", `model_provider="${providerId}"`,
      "-c", `model_providers.${providerId}.name="${providerId}"`,
      "-c", `model_providers.${providerId}.base_url="${escapeTomlString(baseUrl)}"`,
      "-c", `model_providers.${providerId}.env_key="OPENAI_API_KEY"`,
      "-c", `model_providers.${providerId}.requires_openai_auth=false`,
    ];
  }

  private buildCommandSpec(
    provider: CliProviderId,
    model: string,
    prompt: string,
    providerCwd: string,
    codexOutputPath?: string | null,
    nativeSessionId?: string | null,
    continueSession?: boolean,
    mcpNative?: boolean,
    qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER",
    qwenProtocol?: "openai" | "anthropic" | "gemini",
    codexProviderArgs: string[] = [],
  ): { command: string; args: string[] } {
    if (provider === "codex" && codexOutputPath) {
      // `codex exec resume --last` continues the most recent session in the cwd
      const args = continueSession
        ? ["exec", "resume", "--last", "--yolo", "--json", "--output-last-message", codexOutputPath]
        : ["exec", "--yolo", "--json", "--output-last-message", codexOutputPath];
      args.push(...codexProviderArgs);
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
      const args = continueSession
        ? ["--resume", "--yolo", "--output-format", "json", "--p", prompt]
        : ["--yolo", "--output-format", "json", "--p", prompt];
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

    if (provider === "qwen-code") {
      const authType = qwenAuthMode === "LOCAL_AUTH" ? "qwen-oauth" : (qwenProtocol || "openai");
      const args = ["--auth-type", authType, "--yolo"];
      if (continueSession && nativeSessionId) {
        args.push("--resume", nativeSessionId);
      } else if (nativeSessionId) {
        args.push("--session-id", nativeSessionId);
      }
      if (model && model !== "default") {
        args.push("--model", model);
      }
      args.push("-p", prompt);
      return { command: "qwen", args };
    }

    if (provider === "opencode") {
      const args = continueSession
        ? nativeSessionId
          ? ["run", "--session", nativeSessionId, "--format", "json", "--dir", providerCwd]
          : ["run", "--continue", "--format", "json", "--dir", providerCwd]
        : ["run", "--format", "json", "--dir", providerCwd];
      if (model && model !== "default") {
        args.push("--model", model);
      }
      args.push(prompt);
      return { command: "opencode", args };
    }

    if (provider === "antigravity") {
      const args = ["--dangerously-skip-permissions"];
      if (model && model !== "default") {
        args.push("--model", model);
      }
      if (continueSession && nativeSessionId) {
        args.push(`--conversation=${nativeSessionId}`);
      }
      args.push("-p", prompt);
      return { command: "agy", args };
    }

    const providerSpec = providerSpecs[provider];
    if (!providerSpec) {
      throw new Error(`Unsupported CLI provider: ${provider}`);
    }

    const spec = providerSpec(model, prompt);
    if (provider === "codex" && codexProviderArgs.length > 0) {
      // Inject the custom model-provider config flags right after the `exec` subcommand,
      // ahead of the trailing prompt argument.
      return { command: spec.command, args: ["exec", ...codexProviderArgs, ...spec.args.slice(1)] };
    }
    return spec;
  }

  private withProviderEnv(
    provider: ProviderId,
    model: string,
    apiKey: string,
    workflowSettings: CliWorkflowSettings,
    githubToken?: string,
    providerMountAuth?: boolean,
    providerConfig?: Pick<ProviderRunInput, "qwenAuthMode" | "qwenRegion" | "qwenBaseUrl" | "qwenEnvKey" | "qwenModelId" | "qwenProtocol" | "qwenAdditionalModelProviders" | "openCodeAuthMode" | "openCodeProviderId" | "openCodeModelId" | "openCodeBaseUrl" | "openCodeEnvKey" | "openCodePackage" | "mcpConnection" | "customBaseUrl" | "customModel">,
    qwenOpenAiLogDir?: string,
    gitlabToken?: string,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const useContainerMounts = workflowSettings.executionMode === "DOCKER";
    const useGithubMount = useContainerMounts && workflowSettings.containerMountGithubAuth;
    const useProviderMount = useContainerMounts && Boolean(providerMountAuth);

    if (githubToken && !useGithubMount) {
      env.GH_TOKEN = githubToken;
      env.GITHUB_TOKEN = githubToken;
    }
    if (gitlabToken) {
      env.GITLAB_TOKEN = gitlabToken;
      env.GLAB_TOKEN = gitlabToken;
    }
    if (provider === "gemini") {
      if (model && model !== "default") env.GEMINI_MODEL = model;
      if (apiKey && !useProviderMount) env.GEMINI_API_KEY = apiKey;
      env.GEMINI_CLI_TRUST_WORKSPACE = "true";
    } else if (provider === "claude-code") {
      if (providerConfig?.customBaseUrl) {
        // Claude Code speaks the Anthropic Messages API and always appends `/v1/messages`
        // to ANTHROPIC_BASE_URL. A base ending in `/v1` (e.g. the OpenAI-format URL used by
        // Codex/Qwen, https://openrouter.ai/api/v1) would produce `/v1/v1/messages` and fail
        // auth, so normalize it off — the Anthropic-compatible base is e.g. .../api.
        const normalizedBaseUrl = providerConfig.customBaseUrl.trim().replace(/\/v1\/?$/, "");
        env.ANTHROPIC_BASE_URL = this.rewriteLoopbackUrlForDocker(
          normalizedBaseUrl,
          this.shouldRewriteDockerLoopbackUrls(workflowSettings),
        );
        // Gateways (OpenRouter, LiteLLM, etc.) authenticate with `Authorization: Bearer`,
        // which Claude Code only sends via ANTHROPIC_AUTH_TOKEN. ANTHROPIC_API_KEY would be
        // sent as an `x-api-key` header the gateway rejects, so route the key to the Bearer
        // token and clear the api key to avoid credential conflicts. Mirrors the OpenRouter
        // Claude Code integration guidance.
        if (apiKey && !useProviderMount) {
          env.ANTHROPIC_AUTH_TOKEN = apiKey;
          env.ANTHROPIC_API_KEY = "";
        }
      } else if (apiKey && !useProviderMount) {
        env.ANTHROPIC_API_KEY = apiKey;
      }
      if (providerConfig?.customModel && providerConfig.customModel.trim().length > 0) {
        // A custom (gateway) model usually exposes a single slug, so point every Claude
        // Code model tier at it — including the background "small/fast" tier that would
        // otherwise request a Haiku model the gateway does not serve.
        const customModel = providerConfig.customModel.trim();
        env.ANTHROPIC_MODEL = customModel;
        env.ANTHROPIC_SMALL_FAST_MODEL = customModel;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = customModel;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = customModel;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = customModel;
      }
    } else if (provider === "codex") {
      if (model && model !== "default") env.CODEX_MODEL = model;
      if (apiKey && !useProviderMount) env.OPENAI_API_KEY = apiKey;
      if (providerConfig?.customBaseUrl) {
        env.OPENAI_BASE_URL = this.rewriteLoopbackUrlForDocker(
          providerConfig.customBaseUrl,
          this.shouldRewriteDockerLoopbackUrls(workflowSettings),
        );
      }
    } else if (provider === "qwen-code") {
      const qwenEnvKeys = new Set<string>();
      const primaryEnvKey = providerConfig?.qwenAuthMode === "ALIBABA_CODING_PLAN"
        ? "BAILIAN_CODING_PLAN_API_KEY"
        : providerConfig?.qwenEnvKey || "OLLAMA_API_KEY";
      qwenEnvKeys.add(primaryEnvKey);
      qwenEnvKeys.add("QWEN_CODE_SUPPRESS_YOLO_WARNING");
      env.QWEN_CODE_SUPPRESS_YOLO_WARNING = "1";
      if (apiKey && !useProviderMount) {
        env[primaryEnvKey] = apiKey;
        env.DASHSCOPE_API_KEY ||= apiKey;
        env.BAILIAN_CODING_PLAN_API_KEY ||= apiKey;
        env.QWEN_API_KEY ||= apiKey;
        if ((providerConfig?.qwenProtocol || "openai") === "openai") {
          env.OPENAI_API_KEY ||= apiKey;
        }
      }
      const baseUrl = providerConfig?.qwenAuthMode === "ALIBABA_CODING_PLAN"
        ? providerConfig.qwenRegion === "china"
          ? "https://coding.dashscope.aliyuncs.com/v1"
          : "https://coding-intl.dashscope.aliyuncs.com/v1"
        : providerConfig?.qwenAuthMode === "MODEL_PROVIDER"
          ? providerConfig.qwenBaseUrl || "http://127.0.0.1:11434/v1"
          : undefined;
      if (baseUrl) {
        env.OPENAI_BASE_URL = this.rewriteLoopbackUrlForDocker(baseUrl, this.shouldRewriteDockerLoopbackUrls(workflowSettings));
      }
      for (const entry of providerConfig?.qwenAdditionalModelProviders || []) {
        if (entry.envKey) {
          qwenEnvKeys.add(entry.envKey);
          if (entry.apiKey && !useProviderMount) {
            env[entry.envKey] = entry.apiKey;
          }
        }
      }
      if (qwenEnvKeys.size > 0) {
        env.CODE_UX_PROVIDER_ENV_KEYS = [...qwenEnvKeys].join(",");
      }
      env.QWEN_SETTINGS_CONTENT = this.buildQwenSettingsContent(
        model,
        providerConfig,
        providerConfig?.mcpConnection || null,
        this.shouldRewriteDockerLoopbackUrls(workflowSettings),
        qwenOpenAiLogDir,
      );
    } else if (provider === "opencode") {
      const envKey = providerConfig?.openCodeEnvKey || (providerConfig?.openCodeAuthMode === "CUSTOM_PROVIDER" ? "OLLAMA_API_KEY" : "ANTHROPIC_API_KEY");
      const resolvedApiKey = apiKey || process.env[envKey] || "";
      if (resolvedApiKey && !useProviderMount) {
        env[envKey] = resolvedApiKey;
        env.OPENCODE_API_KEY = resolvedApiKey;
        if ((providerConfig?.openCodeProviderId || model.split("/")[0]) === "anthropic") {
          env.ANTHROPIC_API_KEY ||= resolvedApiKey;
        }
        if ((providerConfig?.openCodeProviderId || model.split("/")[0]) === "openai") {
          env.OPENAI_API_KEY ||= resolvedApiKey;
        }
        if ((providerConfig?.openCodeProviderId || model.split("/")[0]) === "github-copilot") {
          env.GITHUB_TOKEN ||= resolvedApiKey;
        }
      }
      env.OPENCODE_CONFIG_CONTENT = this.buildOpenCodeConfigContent(
        model,
        providerConfig,
        providerConfig?.mcpConnection || null,
        this.shouldRewriteDockerLoopbackUrls(workflowSettings),
      );
    } else if (provider === "antigravity") {
      if (apiKey && !useProviderMount) {
        env.ANTIGRAVITY_API_KEY = apiKey;
      }
    }
    return env;
  }

  private buildQwenSettingsContent(
    model: string,
    config?: QwenRuntimeSettings,
    conn?: McpConnectionInfo | null,
    rewriteDockerLoopbackUrls = false,
    openAiLogDir?: string,
  ): string {
    const authMode = config?.qwenAuthMode || "LOCAL_AUTH";
    const protocol = config?.qwenProtocol || "openai";
    const envKey = authMode === "ALIBABA_CODING_PLAN"
      ? "BAILIAN_CODING_PLAN_API_KEY"
      : config?.qwenEnvKey || "OLLAMA_API_KEY";
    const baseUrl = authMode === "ALIBABA_CODING_PLAN"
      ? config?.qwenRegion === "china"
        ? "https://coding.dashscope.aliyuncs.com/v1"
        : "https://coding-intl.dashscope.aliyuncs.com/v1"
      : authMode === "MODEL_PROVIDER"
        ? config?.qwenBaseUrl || "http://127.0.0.1:11434/v1"
        : config?.qwenBaseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const selectedModel = authMode === "MODEL_PROVIDER"
      ? (config?.qwenModelId || (model === "custom/model" || model === "local-model" ? "glm-4.7-flash" : model) || "glm-4.7-flash").trim()
      : model && model !== "default"
        ? model
        : "qwen3-coder-plus";
    const headers: Record<string, string> = {};
    if (conn?.authToken) {
      headers.Authorization = `Bearer ${conn.authToken}`;
    }
    if (conn?.agentId) {
      headers["X-Code-Ux-Agent"] = conn.agentId;
    }

    const modelConfig: Record<string, unknown> = {
      name: selectedModel,
      enableOpenAILogging: true,
    };
    const runtimeConfig: Record<string, unknown> = {
      security: {
        auth: {
          selectedType: authMode === "LOCAL_AUTH" ? "qwen-oauth" : protocol,
        },
      },
      model: modelConfig,
      enableOpenAILogging: true,
    };
    // Redirect OpenAI request/response logs out of the worktree (default is
    // `<cwd>/logs/openai`). Set at both nesting levels for schema-version safety.
    if (openAiLogDir) {
      modelConfig.openAILoggingDir = openAiLogDir;
      runtimeConfig.openAILoggingDir = openAiLogDir;
    }

    if (authMode !== "LOCAL_AUTH") {
      runtimeConfig.modelProviders = {
        [protocol]: [
          {
            id: selectedModel,
            name: config?.qwenModelId || selectedModel,
            baseUrl: this.rewriteLoopbackUrlForDocker(baseUrl, rewriteDockerLoopbackUrls),
            description: authMode === "ALIBABA_CODING_PLAN" ? "Qwen via Alibaba Cloud Coding Plan" : "Qwen custom model provider",
            envKey,
          },
          ...(config?.qwenAdditionalModelProviders || []).map((entry) => ({
            id: entry.id,
            name: entry.name || entry.id,
            baseUrl: this.rewriteLoopbackUrlForDocker(entry.baseUrl, rewriteDockerLoopbackUrls),
            description: entry.description,
            envKey: entry.envKey,
          })),
        ],
      };
    }

    if (conn) {
      runtimeConfig.mcpServers = {
        code_ux: {
          httpUrl: this.rewriteLoopbackUrlForDocker(conn.url, rewriteDockerLoopbackUrls),
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        },
      };
    }

    return JSON.stringify(runtimeConfig);
  }

  private buildOpenCodeConfigContent(
    model: string,
    config?: OpenCodeRuntimeSettings,
    conn?: McpConnectionInfo | null,
    rewriteDockerLoopbackUrls = false,
  ): string {
    const authMode = config?.openCodeAuthMode || "LOCAL_AUTH";
    const providerId = (config?.openCodeProviderId || model.split("/")[0] || (authMode === "CUSTOM_PROVIDER" ? "ollama" : "anthropic")).trim();
    const modelId = (config?.openCodeModelId || model.split("/").slice(1).join("/") || (authMode === "CUSTOM_PROVIDER" ? "glm-4.7-flash" : "claude-sonnet-4-5")).trim();
    const selectedModel = authMode === "CUSTOM_PROVIDER"
      ? `${providerId}/${modelId}`
      : model && model !== "default"
        ? model
        : `${providerId}/${modelId}`;
    const runtimeConfig: Record<string, unknown> = {
      $schema: "https://opencode.ai/config.json",
      model: selectedModel,
      autoupdate: false,
      permission: "allow",
    };

    if (authMode === "ENV_KEY") {
      runtimeConfig.provider = {
        [providerId]: {
          options: {
            apiKey: "{env:OPENCODE_API_KEY}",
          },
        },
      };
    } else if (authMode === "CUSTOM_PROVIDER") {
      runtimeConfig.provider = {
        [providerId]: {
          npm: config?.openCodePackage || "@ai-sdk/openai-compatible",
          name: providerId,
          options: {
            baseURL: this.rewriteLoopbackUrlForDocker(config?.openCodeBaseUrl || "http://127.0.0.1:11434/v1", rewriteDockerLoopbackUrls),
            apiKey: "{env:OPENCODE_API_KEY}",
          },
          models: {
            [modelId]: {
              name: modelId,
            },
          },
        },
      };
    }

    if (conn) {
      const headers: Record<string, string> = {};
      if (conn.authToken) {
        headers.Authorization = `Bearer ${conn.authToken}`;
      }
      if (conn.agentId) {
        headers["X-Code-Ux-Agent"] = conn.agentId;
      }
      runtimeConfig.mcp = {
        code_ux: {
          type: "remote",
          url: this.rewriteLoopbackUrlForDocker(conn.url, rewriteDockerLoopbackUrls),
          enabled: true,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        },
      };
    }

    return JSON.stringify(runtimeConfig);
  }

  private shouldRewriteDockerLoopbackUrls(workflowSettings: CliWorkflowSettings): boolean {
    if (workflowSettings.executionMode !== "DOCKER") {
      return false;
    }
    const override = process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    if (override === "0" || override === "false") {
      return false;
    }
    if (override === "1" || override === "true") {
      return true;
    }
    return process.platform === "darwin"
      || process.platform === "win32"
      || os.release().toLowerCase().includes("microsoft");
  }

  private rewriteLoopbackUrlForDocker(rawUrl: string, enabled: boolean): string {
    if (!enabled) {
      return rawUrl;
    }
    try {
      const url = new URL(rawUrl);
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1") {
        url.hostname = "host.docker.internal";
        return url.toString();
      }
    } catch {
      return rawUrl;
    }
    return rawUrl;
  }

  private isTransientCodexTransportError(result: CommandResult): boolean {
    const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
    return text.includes("stream disconnected before completion") || text.includes("error sending request for url") || text.includes("channel closed");
  }

  private shouldSuppressStructuredStdout(provider: CliProviderId, line: string): boolean {
    if (provider !== "gemini" && provider !== "codex" && provider !== "opencode") {
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
    conn: McpConnectionInfo | null,
    cwd: string,
    provider: CliProviderId,
    qwenSettingsContent?: string,
    customServers: CustomMcpServer[] = [],
  ): Promise<Array<{ path: string; originalContent: string | null }>> {
    const headers: Record<string, string> = {};
    if (conn?.authToken) {
      headers["Authorization"] = `Bearer ${conn.authToken}`;
    }
    if (conn?.agentId) {
      headers["X-Code-Ux-Agent"] = conn.agentId;
    }
    const created: Array<{ path: string; originalContent: string | null }> = [];

    if (provider === "claude-code") {
      const mcpServers: Record<string, unknown> = {};
      if (conn) {
        mcpServers.code_ux = {
          type: "http",
          url: conn.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        };
      }
      for (const server of customServers) {
        mcpServers[server.name] = buildClaudeMcpServerEntry(server);
      }
      if (Object.keys(mcpServers).length === 0) {
        return created;
      }
      const configPath = path.join(cwd, ".mcp.json");
      const originalContent = await fs.readFile(configPath, "utf8").catch(() => null);
      await fs.writeFile(configPath, JSON.stringify({ mcpServers }, null, 2));
      created.push({ path: configPath, originalContent });
    } else if (provider === "gemini" || provider === "qwen-code") {
      const dirPath = path.join(cwd, provider === "gemini" ? ".gemini" : ".qwen");
      await fs.mkdir(dirPath, { recursive: true });
      const configPath = path.join(dirPath, "settings.json");
      // Merge with existing project-level settings to preserve other config (e.g. general.maxAttempts)
      let existing: Record<string, unknown> = {};
      const originalContent = await fs.readFile(configPath, "utf8").catch(() => null);
      if (originalContent) {
        try { existing = JSON.parse(originalContent); } catch { /* ignore parse errors */ }
      }
      if (provider === "qwen-code" && qwenSettingsContent) {
        try {
          existing = { ...existing, ...(JSON.parse(qwenSettingsContent) as Record<string, unknown>) };
        } catch {
          // ignore parse errors and preserve existing settings
        }
      }
      const mcpServers: Record<string, unknown> = { ...(existing.mcpServers as Record<string, unknown> || {}) };
      if (conn) {
        mcpServers.code_ux = {
          httpUrl: conn.url,
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        };
      }
      for (const server of customServers) {
        mcpServers[server.name] = buildGeminiMcpServerEntry(server);
      }
      if (Object.keys(mcpServers).length > 0) {
        existing.mcpServers = mcpServers;
      }
      await fs.writeFile(configPath, JSON.stringify(existing, null, 2));
      created.push({ path: configPath, originalContent });
    } else if (provider === "codex" && (conn || customServers.length > 0)) {
      const dirPath = path.join(cwd, ".codex");
      await fs.mkdir(dirPath, { recursive: true });
      const configPath = path.join(dirPath, "config.toml");
      const lines: string[] = [];
      if (conn) {
        lines.push("[mcp_servers.code-ux]", `url = "${escapeTomlString(conn.url)}"`);
        const codexHeaderParts: string[] = [];
        if (conn.authToken) {
          codexHeaderParts.push(`"Authorization" = "Bearer ${escapeTomlString(conn.authToken)}"`);
        }
        if (conn.agentId) {
          codexHeaderParts.push(`"X-Code-Ux-Agent" = "${escapeTomlString(conn.agentId)}"`);
        }
        if (codexHeaderParts.length > 0) {
          lines.push(`http_headers = { ${codexHeaderParts.join(", ")} }`);
        }
      }
      for (const server of customServers) {
        lines.push(...buildCodexMcpServerTomlLines(server.name, server));
      }
      const originalContent = await fs.readFile(configPath, "utf8").catch(() => null);
      await fs.writeFile(configPath, lines.join("\n") + "\n");
      created.push({ path: configPath, originalContent });
    }

    return created;
  }
}
