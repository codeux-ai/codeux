import { createLogger, type Logger } from "../../../shared/logging/logger.js";
import { ProviderTelemetryWatcher } from "./provider-telemetry-watcher.js";
import { CliWorkflowSettings, ProviderId, ThinkingMode, type ProviderConfigMode } from "../../../contracts/app-types.js";
import type { CustomMcpServer, QwenModelProviderSettings } from "../../../contracts/app-types.js";
import { normalizeProviderThinkingMode } from "../../../repositories/settings-defaults.js";
import { buildProviderMcpConfigArtifact, buildClaudeMcpServerEntry, buildCodexMcpServerTomlLines, buildGeminiMcpServerEntry, escapeTomlString } from "./mcp-config-format.js";
import type { McpConnectionInfo } from "../../../contracts/mcp-connection-types.js";
import { CliProviderId, E2E_PROVIDER_CLI_SHIM_ENV, enabledCustomServersFor, getNativeSessionOperationPrompt, isOpenCodeNativeSessionId, type NativeSessionOperation, ProviderCommandSpec, providerSpecs } from "./provider-command-specs.js";
import { CommandResult, runStreamingCommand } from "../../../services/cli-process-runner.js";
import type { IDockerRunner } from "./docker-runner.js";
import type { SnapshotCheckout } from "./workspace-manager.js";
import { buildInvocationGitPolicy, type InvocationWorkspaceGitPolicy } from "./invocation-workspace-preparer.js";
import { isDockerWorkspaceMountError } from "../../../services/cli-docker-utils.js";
import { sanitizeInvocationOutputText } from "../../../services/invocation-output-sanitizer.js";
import { redactMetadata } from "../../../shared/security/redaction.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as pathPosix from "path/posix";
import { randomUUID } from "crypto";
import { getRepoCodeUxPath } from "../../../shared/config/code-ux-paths.js";
import { runProviderExecutionLoop } from "./provider-execution-loop.js";
import {
  isClaudeConversationNotFoundError,
  isOpenCodeSessionNotFoundError,
  isTransientCodexTransportError,
} from "../../../shared/providers/provider-error-classifier.js";
import {
  CONTAINER_RUNTIME_HOME,
  CONTAINER_WORKSPACE_ROOT,
  CONTAINER_QWEN_OPENAI_LOG_DIR,
  resolveCodexOutputPath,
  cleanupCodexOutputPath,
  resolveQwenHostLogDir,
  resetQwenOpenAiLogDir,
  resolveAntigravityHostLogPath,
  resolveAntigravityContainerLogPath,
  cleanupProviderRuntimeArtifacts
} from "./provider-runtime-artifacts.js";
import { readQwenLogData, readCodexLatestSessionChunk, readCodexLatestSessionJson, readClaudeSessionJsonl, readClaudeSessionJsonlChunk, parseAntigravityConversationId, readAntigravityTranscript } from "./provider-transcripts.js";
import { parseOpenCodeJsonLines } from "./provider-logs/opencode-log-parser.js";
import { parseAntigravityDatabase } from "./provider-logs/antigravity-log-parser.js";
import { runMockupCliProvider } from "./mockup-cli-provider.js";
import {
  collectProviderUsageTelemetry,
  readQwenOpenAiLogRecords,
  buildQwenConversation,
  sumQwenOpenAiUsage,
  type ProviderUsageTelemetry,
  type QwenUsageTotals,
  type ParsedConversationTurn,
} from "./provider-usage.js";
import { buildQwenRuntimeConfig, buildOpenCodeRuntimeConfig, type QwenRuntimeSettings, type OpenCodeRuntimeSettings } from "./provider-runtime-config.js";
import type { PersistentSkillStorageRuntimeMount } from "../../../services/skill-service.js";
import type { GoogleDriveRuntimeMount } from "../../../services/google-drive-mount-service.js";
import type { ProviderTranscriptCursor } from "./provider-transcript-chunks.js";
import { BoundedTextBuffer } from "../../../shared/subprocess/bounded-text-buffer.js";

const PROVIDER_LIVE_STDOUT_MAX_CHARS = 512 * 1024;
const PROVIDER_LIVE_STDERR_MAX_CHARS = 32 * 1024;

export interface ProviderRunResult extends CommandResult {
  usageTelemetry: ProviderUsageTelemetry;
  nativeSessionId: string | null;
  text?: string;
}

export interface ProviderRunInput {
  provider: CliProviderId;
  prompt: string;
  cwd: string;
  model: string;
  thinkingMode?: ThinkingMode;
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
  providerConfigMode?: ProviderConfigMode;
  providerConfigPath?: string;
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
  snapshotCheckout?: SnapshotCheckout;
  gitPolicy?: InvocationWorkspaceGitPolicy;
  workspaceLifecycle?: "fresh" | "continue";
  githubToken?: string;
  gitlabToken?: string;
  signal?: AbortSignal;
  onActivity: (desc: string, originator?: string) => void;
  onTelemetry?: (telemetry: ProviderUsageTelemetry) => void;
  invocationId?: string | null;
  providerInvocationId?: string | null;
  purpose?: string | null;
  /** Native in-session operation to run against an existing CLI provider session.
   *  Only valid for CLI providers when `continueSessionId` points at an existing
   *  provider session, or at a logical session supported by that provider's
   *  continue/resume mode. */
  nativeSessionOperation?: NativeSessionOperation;
  /** Pass a previous nativeSessionId to continue an existing CLI session.
   *  Claude Code: uses --resume. Gemini: adds --resume. Codex: uses exec resume --last.
   *  Qwen Code uses project-scoped --continue because Code UX logical ids are not Qwen saved-session ids. */
  continueSessionId?: string | null;
  /** The previous invocation's raw opencode export snapshot (`{ tokens, cost }`)
   *  for this same session, when `continueSessionId` resumes it. `opencode
   *  export` reports cumulative session totals, so this is subtracted out to
   *  isolate the current run's own usage. No-op for other providers. */
  openCodeBaselineUsage?: Record<string, unknown> | null;
  /** MCP server connection info for injecting management tools into the CLI provider. */
  mcpConnection?: McpConnectionInfo | null;
  /** User-defined custom MCP servers injected into the CLI provider alongside code_ux. */
  customMcpServers?: CustomMcpServer[];
  /** Writable persistent skill storage mounts available outside the project workspace. */
  persistentSkillStorageMounts?: PersistentSkillStorageRuntimeMount[];
  /** Validated Google Drive bind mount available to Docker-backed provider runs. */
  googleDriveMount?: GoogleDriveRuntimeMount;
}

export interface IProviderRunner {
  runProvider(input: ProviderRunInput): Promise<ProviderRunResult>;
  runProviderForText(input: ProviderRunInput): Promise<ProviderRunResult & { text: string }>;
}

export class ProviderRunner implements IProviderRunner {
    private readonly logger: Logger;

  constructor(
    private readonly dockerRunner: IDockerRunner,
    logger?: Logger
  ) {
    this.logger = logger ?? createLogger({ bindings: { component: "ProviderRunner" } });
  }

  private async executeWithWorkspace<T>(
    input: ProviderRunInput,
    callback: (prepared: { cwd: string; cleanup: () => Promise<void> }, outputPath: string | null) => Promise<T>
  ): Promise<T> {
    const preserveSessionWorkspace = this.shouldPreserveSessionWorkspace(input);
    const reuseExistingWorkspace = input.workspaceLifecycle === "continue" || Boolean(input.continueSessionId);
    const prepared = input.workflowSettings.executionMode === "DOCKER"
      ? await this.dockerRunner.ensureWorkspace({
        cwd: input.cwd,
        repoPath: input.repoPath,
        sessionId: input.workspaceSessionId || input.sessionId,
        snapshotCheckout: input.snapshotCheckout,
        gitPolicy: input.gitPolicy || (input.snapshotCheckout?.remoteOnly
          ? buildInvocationGitPolicy({
            githubMode: "REMOTE",
            githubToken: input.githubToken,
            gitlabToken: input.gitlabToken,
          })
          : undefined),
        preserve: preserveSessionWorkspace,
        reuseExisting: reuseExistingWorkspace,
      })
      : { cwd: input.cwd, cleanup: async () => undefined };

    const outputPath = resolveCodexOutputPath(input);

    if (outputPath && !outputPath.startsWith("/workspace/")) {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
    }

    try {
      return await callback(prepared, outputPath);
    } finally {
      await prepared.cleanup();
      await cleanupCodexOutputPath(outputPath, input.workflowSettings.executionMode, prepared.cwd, this.dockerRunner.removeWorkspaceDir ? this.dockerRunner.removeWorkspaceDir.bind(this.dockerRunner) : undefined);
    }
  }

  async runProvider(input: ProviderRunInput): Promise<ProviderRunResult> {
    return this.executeWithWorkspace(input, async (prepared, outputPath) => {
      return await this.runProviderInternal({
        ...input,
        cwd: prepared.cwd,
        codexOutputPath: outputPath,
      });
    });
  }

  async runProviderForText(input: ProviderRunInput): Promise<ProviderRunResult & { text: string }> {
    return this.executeWithWorkspace(input, async (prepared, outputPath) => {
      const result = await this.runProviderInternal({
        ...input,
        cwd: prepared.cwd,
        codexOutputPath: outputPath,
      });

      const capturedText = outputPath
        ? await this.readProviderOutputPath(prepared.cwd, outputPath, input.workflowSettings.executionMode)
        : "";

      return {
        ...result,
        text: sanitizeInvocationOutputText(capturedText || result.usageTelemetry.transcriptText || result.stdout || result.stderr),
      };
    });
  }

  private shouldPreserveSessionWorkspace(input: ProviderRunInput): boolean {
    return input.workflowSettings.executionMode === "DOCKER"
      && !input.cwd.startsWith("docker-volume://");
  }

  private async runProviderInternal(input: {
    provider: CliProviderId;
    prompt: string;
    cwd: string;
    model: string;
    thinkingMode?: ThinkingMode;
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
    providerConfigMode?: ProviderConfigMode;
    providerConfigPath?: string;
    customBaseUrl?: string;
    customModel?: string;
    sessionId: string;
    workflowSettings: CliWorkflowSettings;
    repoPath: string;
    githubToken?: string;
    gitlabToken?: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    onTelemetry?: (telemetry: ProviderUsageTelemetry) => void;
    invocationId?: string | null;
    providerInvocationId?: string | null;
    purpose?: string | null;
    nativeSessionOperation?: NativeSessionOperation;
    codexOutputPath?: string | null;
    continueSessionId?: string | null;
    openCodeBaselineUsage?: Record<string, unknown> | null;
    mcpConnection?: McpConnectionInfo | null;
    customMcpServers?: CustomMcpServer[];
    persistentSkillStorageMounts?: PersistentSkillStorageRuntimeMount[];
    googleDriveMount?: GoogleDriveRuntimeMount;
  }): Promise<ProviderRunResult> {
    const { provider, cwd, model, apiKey, providerMountAuth, providerAuthPath, sessionId, workflowSettings, repoPath, githubToken, gitlabToken, signal, onActivity, onTelemetry } = input;
    const prompt = this.resolveNativeSessionOperationPrompt(provider, input.prompt, input.nativeSessionOperation, input.continueSessionId);
    const startedMs = Date.now();
    const runModel = model;
    // Resolve where qwen-code should write its OpenAI request/response logs, as seen
    // by the qwen process. Kept outside the committed worktree in both execution modes.
    const qwenProcessLogDir = provider === "qwen-code"
      ? (workflowSettings.executionMode === "DOCKER"
        ? CONTAINER_QWEN_OPENAI_LOG_DIR
        : resolveQwenHostLogDir(sessionId))
      : undefined;
    // Antigravity's `agy` CLI writes its real diagnostics (quota/auth/executor errors)
    // only to a glog log file — never to stdout/stderr — and exits 0 regardless. Point
    // it at a controlled path we can read back so those failures aren't lost.
    const antigravityLogPath = provider === "antigravity"
      ? (workflowSettings.executionMode === "DOCKER"
        ? resolveAntigravityContainerLogPath(sessionId)
        : resolveAntigravityHostLogPath(sessionId))
      : null;
    const providerEnv = this.withProviderEnv(provider, runModel, apiKey, workflowSettings, githubToken, providerMountAuth, input, qwenProcessLogDir, gitlabToken);
    if (provider === "mockup-cli") {
      providerEnv.CODE_UX_MOCKUP_SESSION_ID = sessionId;
    }
    let nativeSessionId = provider === "opencode"
      ? isOpenCodeNativeSessionId(input.continueSessionId) ? input.continueSessionId! : null
      : provider === "qwen-code"
        ? null
      : input.continueSessionId || (provider === "claude-code" ? randomUUID() : null);

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
      antigravityLogPath,
      input.thinkingMode,
    );
    let { command, args } = spec;

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

    // A resumed antigravity conversation (`--conversation=<id>`) keeps appending to
    // the same gen_metadata table across separate CLI invocations, so read the
    // highest idx already present *before* this run so only the generations this
    // run adds get summed afterward — otherwise a follow-up would re-report every
    // earlier generation's tokens too (see parseAntigravityDatabase).
    let antigravityBaselineIdx: number | null = null;
    if (provider === "antigravity" && continueSession && nativeSessionId) {
      const peekDbPath = path.join(os.tmpdir(), `agy-baseline-${nativeSessionId.replace(/[^A-Za-z0-9_-]/g, "_")}-${randomUUID()}.db`);
      try {
        const resolved = await this.resolveAntigravityDatabase(cwd, nativeSessionId, workflowSettings.executionMode, peekDbPath);
        if (resolved) {
          antigravityBaselineIdx = parseAntigravityDatabase(peekDbPath)?.lastIdx ?? null;
        }
      } catch {
        // Best-effort: if this fails, the run falls back to summing the whole
        // conversation, which just re-reports rather than losing usage.
      } finally {
        await fs.rm(peekDbPath, { force: true }).catch(() => undefined);
      }
    }

    // Start each qwen run from an empty log directory so usage aggregation only
    // counts this invocation (the directory is reused across a session's runs).
    if (provider === "qwen-code") {
      await resetQwenOpenAiLogDir(cwd,  workflowSettings.executionMode,  sessionId, this.dockerRunner.removeWorkspaceDir ? this.dockerRunner.removeWorkspaceDir.bind(this.dockerRunner) : undefined);
    }

    const accumulatedStderr = new BoundedTextBuffer(PROVIDER_LIVE_STDERR_MAX_CHARS);
    // Raw stdout including structured JSON lines that are suppressed from the
    // activity feed. The codex live-telemetry watcher parses this so the
    // conversation is built from the exec --json stream in real time even when
    // the rollout file isn't yet readable.
    const accumulatedRawStdout = new BoundedTextBuffer(PROVIDER_LIVE_STDOUT_MAX_CHARS);
    const retainsLiveStdout = provider === "codex" || provider === "gemini" || provider === "opencode";
    const trackingOnActivity = (desc: string, originator?: string) => {
      if (originator === "agent" && this.shouldSuppressStructuredStdout(provider, desc)) {
        accumulatedRawStdout.append(desc + "\n");
        return;
      }
      const sanitizedDesc = sanitizeInvocationOutputText(desc);
      if (originator === "agent") {
        if (retainsLiveStdout) {
          accumulatedRawStdout.append(desc + "\n");
        }
      } else if (originator === "provider") {
        accumulatedStderr.append(sanitizedDesc + "\n");
      }
      onActivity(sanitizedDesc, originator);
    };

    const runCmd = async () => {
      if (workflowSettings.executionMode === "DOCKER") {
        const result = await this.dockerRunner.runProviderInDocker({
          command, args, cwd, providerEnv, sessionId,
          providerLabel: provider, workflowSettings, repoPath, signal, onActivity: trackingOnActivity,
          providerMountAuth,
          providerAuthPath,
          providerConfigMode: input.providerConfigMode,
          providerConfigPath: input.providerConfigPath,
          mcpConnection: input.mcpConnection,
          customMcpServers: input.customMcpServers,
          persistentSkillStorageMounts: input.persistentSkillStorageMounts,
          googleDriveMount: input.googleDriveMount,
        });
        if (!result.ok && isDockerWorkspaceMountError(result)) {
          try { await fs.access(cwd); trackingOnActivity(`Docker could not mount workspace path (${cwd}) even though it exists locally. Path visibility mismatch.`, "provider"); } catch { /* ignore */ }
        }
        return result;
      }
      if (provider === "mockup-cli") {
        return await runMockupCliProvider({
          prompt,
          cwd,
          model: runModel,
          sessionId,
          env: providerEnv,
          signal,
          onStdoutLine: (line) => trackingOnActivity(line, "agent"),
          onStderrLine: (line) => trackingOnActivity(`[${provider}] ${line}`, "provider"),
        });
      }
      return await runStreamingCommand(command, args, cwd, providerEnv, {
        signal,
        onStdoutLine: (line) => {
          if (this.shouldSuppressStructuredStdout(provider, line)) {
            // Keep the structured line out of the activity feed but retain it
            // for the telemetry watcher's stream parsing.
            accumulatedRawStdout.append(line + "\n");
            return;
          }
          trackingOnActivity(line, "agent");
        },
        onStderrLine: (line) => trackingOnActivity(`[${provider}] ${line}`, "provider"),
      });
    };

    let tempDbPath: string | null = null;
    let watcher: ProviderTelemetryWatcher | null = null;

    if (input.onTelemetry) {
      watcher = new ProviderTelemetryWatcher({
        provider,
        model: runModel,
        prompt,
        cwd,
        startedMs,
        workflowSettings,
        signal,
        onTelemetry: input.onTelemetry,
        invocationId: input.invocationId,
        providerInvocationId: input.providerInvocationId,
        purpose: input.purpose,
        getAccumulatedRawStdout: () => accumulatedRawStdout.toString(),
        getAccumulatedStderr: () => accumulatedStderr.toString(),
        nativeSessionId,
        sessionId,
        antigravityLogPath,
        antigravitySinceIdx: antigravityBaselineIdx,
        logger: this.logger,
        ...(workflowSettings.executionMode === "HOST"
          ? { getCodexLatestSessionJsonMetadata: async () => this.readCodexLatestSessionMetadata() }
          : {}),
        readClaudeSessionJsonl: async (id) => readClaudeSessionJsonl(cwd, id, workflowSettings.executionMode, this.dockerRunner),
        ...(this.dockerRunner.readWorkspaceFileChunk || workflowSettings.executionMode === "HOST"
          ? { readClaudeSessionJsonlChunk: async (id: string, cursor: ProviderTranscriptCursor) =>
              readClaudeSessionJsonlChunk(cwd, id, workflowSettings.executionMode, cursor, this.dockerRunner) }
          : {}),
        readCodexLatestSessionJson: async () => readCodexLatestSessionJson(cwd, workflowSettings.executionMode, this.dockerRunner),
        ...(this.dockerRunner.readLatestWorkspaceFileChunk || workflowSettings.executionMode === "HOST"
          ? { readCodexLatestSessionChunk: async (cursor: ProviderTranscriptCursor) =>
              readCodexLatestSessionChunk(cwd, workflowSettings.executionMode, cursor, this.dockerRunner) }
          : {}),
        ...(workflowSettings.executionMode === "HOST"
          ? { getQwenLogDataMetadata: async () => this.readQwenLogMetadata(sessionId) }
          : this.dockerRunner.readWorkspaceDirectoryMetadata
            ? { getQwenLogDataMetadata: async () => this.dockerRunner.readWorkspaceDirectoryMetadata!(cwd, CONTAINER_QWEN_OPENAI_LOG_DIR, "*.json") }
            : {}),
        readQwenLogData: async () => readQwenLogData(cwd, workflowSettings.executionMode, sessionId, startedMs, this.dockerRunner),
        ...(workflowSettings.executionMode === "HOST"
          ? { getAntigravityLogMetadata: async (logPath: string) => this.readFileMetadata(logPath) }
          : this.dockerRunner.readWorkspaceFileMetadata
            ? { getAntigravityLogMetadata: async (logPath: string) => this.dockerRunner.readWorkspaceFileMetadata!(cwd, logPath) }
            : {}),
        parseAntigravityConversationId: async (logPath) => parseAntigravityConversationId(cwd, logPath, workflowSettings.executionMode, this.dockerRunner),
        ...(workflowSettings.executionMode === "HOST"
          ? { getAntigravityTranscriptMetadata: async (resolvedId: string) => this.readAntigravityTranscriptMetadata(resolvedId) }
          : this.dockerRunner.readWorkspaceFileMetadata
            ? { getAntigravityTranscriptMetadata: async (resolvedId: string) => this.readDockerAntigravityMetadata(cwd, resolvedId, ".jsonl") }
            : {}),
        ...(workflowSettings.executionMode === "HOST"
          ? { getAntigravityDatabaseMetadata: async (resolvedId: string) => this.readAntigravityDatabaseMetadata(resolvedId) }
          : this.dockerRunner.readWorkspaceFileMetadata
            ? { getAntigravityDatabaseMetadata: async (resolvedId: string) => this.readDockerAntigravityMetadata(cwd, resolvedId, ".db") }
            : {}),
        readAntigravityTranscript: async (resolvedId) => readAntigravityTranscript(cwd, resolvedId, workflowSettings.executionMode, this.dockerRunner),
        resolveAntigravityDatabase: async (resolvedId, destPath) => this.resolveAntigravityDatabase(cwd, resolvedId, workflowSettings.executionMode, destPath),
      });
      watcher.start();
    }

    try {

      const buildFreshClaudeSpec = () => {
        nativeSessionId = randomUUID();
        return this.buildCommandSpec(
          provider,
          runModel,
          prompt,
          workflowSettings.executionMode === "DOCKER" ? CONTAINER_WORKSPACE_ROOT : cwd,
          input.codexOutputPath,
          nativeSessionId,
          false,
          hasMcpConfig,
          input.qwenAuthMode,
          input.qwenProtocol,
          codexProviderArgs,
          antigravityLogPath,
          input.thinkingMode,
        );
      };
      const buildFreshOpenCodeSpec = () => {
        return this.buildCommandSpec(
          provider,
          runModel,
          prompt,
          workflowSettings.executionMode === "DOCKER" ? CONTAINER_WORKSPACE_ROOT : cwd,
          input.codexOutputPath,
          null,
          false,
          hasMcpConfig,
          input.qwenAuthMode,
          input.qwenProtocol,
          codexProviderArgs,
          antigravityLogPath,
          input.thinkingMode,
        );
      };
      const readAntigravityDiagnostics = async () => {
        return await this.readAntigravityDiagnostics(cwd, antigravityLogPath!, workflowSettings.executionMode);
      };

      const result = await runProviderExecutionLoop({
        provider,
        command,
        args,
        continueSession: !!continueSession,
        antigravityLogPath,
        runCmd: async (cmd, a) => {
          command = cmd;
          args = a;
          return await runCmd();
        },
        trackingOnActivity,
        isTransientCodexTransportError,
        isClaudeConversationNotFoundError,
        isOpenCodeSessionNotFoundError,
        buildFreshClaudeSpec,
        buildFreshOpenCodeSpec,
        readAntigravityDiagnostics,
      });

      const finalCodexRollout = provider === "codex" && watcher
        ? await (async () => {
            await watcher.stop();
            return watcher.readFinalCodexRollout();
          })()
        : null;

      const capturedText = input.codexOutputPath
        ? await this.readProviderOutputPath(cwd, input.codexOutputPath, workflowSettings.executionMode)
        : "";
      const claudeSessionJsonl = provider === "claude-code" && nativeSessionId
        ? await readClaudeSessionJsonl(cwd, nativeSessionId, workflowSettings.executionMode, this.dockerRunner)
        : null;
      const codexSessionJson = provider === "codex" && !finalCodexRollout
        ? await readCodexLatestSessionJson(cwd, workflowSettings.executionMode, this.dockerRunner)
        : null;
      const qwenLog = provider === "qwen-code"
        ? await readQwenLogData(cwd, workflowSettings.executionMode, sessionId, startedMs, this.dockerRunner)
        : null;

      const usedOpenCodeNativeSession = provider === "opencode" && args.includes("--session");
      let resolvedNativeSessionId = provider === "opencode" && !usedOpenCodeNativeSession
        ? null
        : nativeSessionId;
      if (provider === "antigravity" && !resolvedNativeSessionId && antigravityLogPath) {
        resolvedNativeSessionId = await parseAntigravityConversationId(cwd, antigravityLogPath, workflowSettings.executionMode, this.dockerRunner);
      }

      // OpenCode reports no token usage on the `run --format json` stream; its
      // session id is the only usage handle it gives us. Resolve it from the
      // stream, then read authoritative usage via `opencode export`.
      let opencodeExportJson: string | null = null;
      if (provider === "opencode") {
        if (!resolvedNativeSessionId) {
          resolvedNativeSessionId = parseOpenCodeJsonLines(result.stdout)?.nativeSessionId ?? null;
        }
        if (resolvedNativeSessionId) {
          opencodeExportJson = await this.readOpenCodeExport(
            cwd,
            resolvedNativeSessionId,
            providerEnv,
            sessionId,
            workflowSettings,
            repoPath,
            {
              providerMountAuth,
              providerAuthPath,
              providerConfigMode: input.providerConfigMode,
              providerConfigPath: input.providerConfigPath,
              mcpConnection: input.mcpConnection,
              customMcpServers: input.customMcpServers,
              googleDriveMount: input.googleDriveMount,
              signal,
            },
          );
        }
      }

      let antigravityTranscriptJsonl: string | null = null;
      if (provider === "antigravity" && resolvedNativeSessionId) {
        antigravityTranscriptJsonl = await readAntigravityTranscript(cwd, resolvedNativeSessionId, workflowSettings.executionMode, this.dockerRunner);
        
        const safeSession = resolvedNativeSessionId.replace(/[^A-Za-z0-9_-]/g, "_");
        const hostTempDb = path.join(os.tmpdir(), `agy-temp-${safeSession}-${randomUUID()}.db`);
        const resolvedDb = await this.resolveAntigravityDatabase(cwd, resolvedNativeSessionId, workflowSettings.executionMode, hostTempDb);
        if (resolvedDb) {
          tempDbPath = hostTempDb;
        }
      }

      const usageTelemetry = await collectProviderUsageTelemetry({
        provider,
        model: runModel,
        prompt,
        cwd,
        stdout: result.stdout,
        stderr: result.stderr,
        capturedText,
        nativeSessionId: resolvedNativeSessionId || nativeSessionId,
        claudeSessionJsonl,
        codexSessionJson,
        codexRollout: finalCodexRollout,
        qwenReportedUsage: qwenLog?.usage ?? null,
        qwenConversation: qwenLog?.conversation ?? null,
        startTimeMs: startedMs,
        executionMode: workflowSettings.executionMode,
        antigravitySessionDbPath: tempDbPath,
        antigravitySinceIdx: antigravityBaselineIdx,
        antigravityTranscriptJsonl,
        opencodeExportJson,
        opencodeBaselineUsage: input.openCodeBaselineUsage,
      });
      return {
        ...this.sanitizeCommandResult(result),
        usageTelemetry: this.sanitizeUsageTelemetry(usageTelemetry),
        nativeSessionId: usageTelemetry.nativeSessionId || resolvedNativeSessionId || nativeSessionId,
      };
    } finally {
      await this.performCleanup({
        watcher,
        tempDbPath,
        localMcpCleanup,
        localRuntimeCleanup,
        provider,
        workflowSettings,
        sessionId,
        cwd,
        antigravityLogPath,
      });
    }
  }

  private sanitizeCommandResult(result: CommandResult): CommandResult {
    return {
      ...result,
      stdout: sanitizeInvocationOutputText(result.stdout || ""),
      stderr: sanitizeInvocationOutputText(result.stderr || ""),
    };
  }

  private resolveNativeSessionOperationPrompt(
    provider: CliProviderId,
    prompt: string,
    operation: NativeSessionOperation | undefined,
    continueSessionId: string | null | undefined,
  ): string {
    if (!operation) {
      return prompt;
    }
    if (!continueSessionId) {
      throw new Error(`Native session operation '${operation}' requires continueSessionId for provider ${provider}.`);
    }
    const nativePrompt = getNativeSessionOperationPrompt(provider, operation);
    if (!nativePrompt) {
      throw new Error(`Provider ${provider} does not support native session operation '${operation}'.`);
    }
    return nativePrompt;
  }

  private sanitizeUsageTelemetry(usageTelemetry: ProviderUsageTelemetry): ProviderUsageTelemetry {
    const rawUsageJson = redactMetadata(usageTelemetry.rawUsageJson) as Record<string, unknown> | null;
    return {
      ...usageTelemetry,
      rawUsageJson,
      transcriptText: sanitizeInvocationOutputText(usageTelemetry.transcriptText || ""),
      conversation: usageTelemetry.conversation.map((turn) => ({
        ...turn,
        text: sanitizeInvocationOutputText(turn.text || ""),
      })),
    };
  }

  private async performCleanup(opts: {
    watcher: ProviderTelemetryWatcher | null;
    tempDbPath: string | null;
    localMcpCleanup: { path: string; originalContent: string | null }[];
    localRuntimeCleanup: string[];
    provider: CliProviderId;
    workflowSettings: CliWorkflowSettings;
    sessionId: string;
    cwd: string;
    antigravityLogPath: string | null;
  }): Promise<void> {
    const {
      watcher,
      tempDbPath,
      localMcpCleanup,
      localRuntimeCleanup,
      provider,
      workflowSettings,
      sessionId,
      cwd,
      antigravityLogPath,
    } = opts;

    if (watcher) {
      try {
        await watcher.stop();
      } catch (err) {
        this.logger.error("Provider cleanup task failed: watcher stop", { logPurpose: "runtime", errorName: err instanceof Error ? err.name : "Error" });
      }
    }

    if (tempDbPath) {
      try {
        await fs.rm(tempDbPath, { force: true });
      } catch (err) {
        this.logger.error("Provider cleanup task failed: temp db removal", { logPurpose: "runtime", errorName: err instanceof Error ? err.name : "Error" });
      }
    }

    for (const entry of localMcpCleanup) {
      try {
        if (entry.originalContent !== null) {
          await fs.writeFile(entry.path, entry.originalContent);
        } else {
          await fs.rm(entry.path, { force: true });
        }
      } catch (err) {
        this.logger.error("Provider cleanup task failed: mcp config restore", { logPurpose: "runtime", errorName: err instanceof Error ? err.name : "Error" });
      }
    }

    for (const cleanupPath of localRuntimeCleanup) {
      try {
        await fs.rm(cleanupPath, { force: true });
      } catch (err) {
        this.logger.error("Provider cleanup task failed: runtime cleanup", { logPurpose: "runtime", errorName: err instanceof Error ? err.name : "Error" });
      }
    }

    try {
      await cleanupProviderRuntimeArtifacts(
        provider,
        workflowSettings.executionMode,
        sessionId,
        cwd,
        antigravityLogPath,
        this.dockerRunner.removeWorkspaceDir ? this.dockerRunner.removeWorkspaceDir.bind(this.dockerRunner) : undefined
      );
    } catch (err) {
      this.logger.error("Provider cleanup task failed: artifact cleanup", { logPurpose: "runtime", errorName: err instanceof Error ? err.name : "Error" });
    }
  }


  /**
   * Reads authoritative token usage for an OpenCode run by invoking
   * `opencode export <sessionID>` against the same workspace (its `run
   * --format json` stream carries no usage). In DOCKER mode this reuses the run
   * volume via {@link IDockerRunner.runProviderInDocker}; in HOST mode it runs
   * opencode directly. Returns the raw export stdout, or null on failure — the
   * caller falls back to estimated usage.
   */
  private async readOpenCodeExport(
    cwd: string,
    nativeSessionId: string,
    providerEnv: NodeJS.ProcessEnv,
    sessionId: string,
    workflowSettings: CliWorkflowSettings,
    repoPath: string,
    opts: {
      providerMountAuth?: boolean;
      providerAuthPath?: string;
      providerConfigMode?: ProviderConfigMode;
      providerConfigPath?: string;
      mcpConnection?: McpConnectionInfo | null;
      customMcpServers?: CustomMcpServer[];
      googleDriveMount?: GoogleDriveRuntimeMount;
      signal?: AbortSignal;
    },
  ): Promise<string | null> {
    try {
      if (workflowSettings.executionMode === "DOCKER") {
        const result = await this.dockerRunner.runProviderInDocker({
          command: "opencode",
          args: ["export", nativeSessionId],
          cwd,
          providerEnv,
          // Distinct container name from the run so the two never collide.
          sessionId: `${sessionId}-export`,
          providerLabel: "opencode",
          workflowSettings,
          repoPath,
          signal: opts.signal,
          onActivity: () => undefined,
          providerMountAuth: opts.providerMountAuth,
          providerAuthPath: opts.providerAuthPath,
          providerConfigMode: opts.providerConfigMode,
          providerConfigPath: opts.providerConfigPath,
          mcpConnection: opts.mcpConnection,
          customMcpServers: opts.customMcpServers,
          googleDriveMount: opts.googleDriveMount,
        });
        return result.stdout || null;
      }
      const result = await runStreamingCommand("opencode", ["export", nativeSessionId], cwd, providerEnv, { signal: opts.signal });
      return result.stdout || null;
    } catch {
      return null;
    }
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
    await fs.writeFile(configPath, `${content}\n`, { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") {
      await fs.chmod(configPath, 0o600);
    }
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

  private async readCodexLatestSessionMetadata(): Promise<string | null> {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const day = now.getDate().toString().padStart(2, "0");
    const sessionsDir = path.join(os.homedir(), ".codex", "sessions", year, month, day);
    try {
      const files = (await fs.readdir(sessionsDir)).filter(f => f.endsWith(".jsonl"));
      if (files.length === 0) {
        return "none";
      }
      const withStats = await Promise.all(
        files.map(async (fileName) => {
          const filePath = path.join(sessionsDir, fileName);
          const stat = await fs.stat(filePath).catch(() => null);
          return {
            fileName,
            size: stat?.size ?? 0,
            mtimeMs: stat?.mtimeMs ?? 0,
          };
        }),
      );
      withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const latest = withStats[0];
      return `${latest.fileName}:${latest.size}:${Math.floor(latest.mtimeMs)}`;
    } catch {
      return "missing";
    }
  }

  private async readQwenLogMetadata(sessionId: string): Promise<string | null> {
    const logDir = resolveQwenHostLogDir(sessionId);
    try {
      const entries = await fs.readdir(logDir);
      if (entries.length === 0) {
        return "none";
      }
      const withStats = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = path.join(logDir, entry);
          const stat = await fs.stat(entryPath).catch(() => null);
          return {
            entry,
            size: stat?.size ?? 0,
            mtimeMs: stat?.mtimeMs ?? 0,
          };
        }),
      );
      return withStats
        .sort((a, b) => a.entry.localeCompare(b.entry))
        .map(entry => `${entry.entry}:${entry.size}:${Math.floor(entry.mtimeMs)}`)
        .join("|");
    } catch {
      return "missing";
    }
  }

  private async readAntigravityTranscriptMetadata(conversationId: string): Promise<string | null> {
    const candidates = [
      path.join(os.homedir(), ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl"),
      path.join(os.homedir(), ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "overview.txt"),
      path.join(os.homedir(), ".gemini", "antigravity", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl"),
      path.join(os.homedir(), ".gemini", "antigravity", "brain", conversationId, ".system_generated", "logs", "overview.txt"),
    ];
    for (const candidate of candidates) {
      const metadata = await this.readFileMetadata(candidate);
      if (metadata !== "missing") {
        return metadata;
      }
    }
    return "missing";
  }

  private async readAntigravityDatabaseMetadata(conversationId: string): Promise<string | null> {
    const candidates = [
      path.join(os.homedir(), ".gemini", "antigravity-cli", "conversations", `${conversationId}.db`),
      path.join(os.homedir(), ".gemini", "antigravity", "conversations", `${conversationId}.db`),
    ];
    for (const candidate of candidates) {
      const metadata = await this.readFileMetadata(candidate);
      if (metadata !== "missing") {
        return metadata;
      }
    }
    return "missing";
  }

  private async readDockerAntigravityMetadata(
    cwd: string,
    conversationId: string,
    kind: ".jsonl" | ".db",
  ): Promise<string | null> {
    const candidates = kind === ".db"
      ? [
          pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity-cli", "conversations", `${conversationId}.db`),
          pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity", "conversations", `${conversationId}.db`),
        ]
      : [
          pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl"),
          pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "overview.txt"),
          pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl"),
          pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity", "brain", conversationId, ".system_generated", "logs", "overview.txt"),
        ];
    for (const candidate of candidates) {
      const metadata = await this.dockerRunner.readWorkspaceFileMetadata?.(cwd, candidate);
      if (metadata) return metadata;
    }
    return "missing";
  }

  private async readFileMetadata(filePath: string): Promise<string> {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) {
      return "missing";
    }
    return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
  }

  /** Reads antigravity's captured log file and extracts only the meaningful failure lines
   *  (executor/quota/auth errors), stripped of their glog prefix. Returns "" when the log is
   *  absent or carries no error — i.e. a normal successful run. */
  private async readAntigravityDiagnostics(
    cwd: string,
    logPath: string,
    executionMode: CliWorkflowSettings["executionMode"],
  ): Promise<string> {
    const raw = executionMode === "DOCKER"
      ? ((await this.dockerRunner.readWorkspaceFile?.(cwd, logPath).catch(() => null)) || "")
      : (await fs.readFile(logPath, "utf8").catch(() => ""));
    return this.extractAntigravityErrorLines(raw);
  }

  /** Pulls executor/quota/auth error lines out of agy's verbose glog output, strips the glog
   *  prefix (`E0601 09:45:02.402482 813902 log.go:398] `), and de-duplicates them. agy logs the
   *  same quota line twice and appends a redundant `: <repeat>` suffix, so both are normalized. */
  private extractAntigravityErrorLines(rawLog: string): string {
    if (!rawLog.trim()) {
      return "";
    }
    const signal = /agent executor error|RESOURCE_EXHAUSTED|Individual quota reached|Contact your administrator to enable overages|enable overages/i;
    const glogPrefix = /^[IWEF]\d{4}\s+[\d:.]+\s+\d+\s+\S+?:\d+\]\s*/;
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const rawLine of rawLog.split("\n")) {
      if (!signal.test(rawLine)) {
        continue;
      }
      let cleaned = rawLine.replace(glogPrefix, "").trim();
      cleaned = cleaned.replace(/^agent executor error:\s*/i, "");
      // agy repeats the message as `<msg>: <msg>`; collapse the exact duplicate to one copy.
      cleaned = cleaned.replace(/^(.+?):\s+\1$/, "$1");
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned);
        lines.push(cleaned);
      }
    }
    return lines.join("\n");
  }

  /** Aggregates provider-reported usage and the conversation from qwen-code
   *  OpenAI logs for both execution modes. Reads the log records once so usage
   *  and the parsed conversation come from the same set of files. */
  private async resolveAntigravityDatabase(
    cwd: string,
    conversationId: string,
    executionMode: CliWorkflowSettings["executionMode"],
    tempDbPath: string,
  ): Promise<boolean> {
    const candidates = [
      executionMode === "DOCKER"
        ? pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity-cli", "conversations", `${conversationId}.db`)
        : path.join(os.homedir(), ".gemini", "antigravity-cli", "conversations", `${conversationId}.db`),
      executionMode === "DOCKER"
        ? pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity", "conversations", `${conversationId}.db`)
        : path.join(os.homedir(), ".gemini", "antigravity", "conversations", `${conversationId}.db`),
    ];

    for (const p of candidates) {
      if (executionMode === "DOCKER") {
        if (this.dockerRunner.readWorkspaceFileBase64) {
          const base64Str = await this.dockerRunner.readWorkspaceFileBase64(cwd, p).catch(() => null);
          if (base64Str) {
            const dbBuffer = Buffer.from(base64Str, "base64");
            await fs.writeFile(tempDbPath, dbBuffer);
            return true;
          }
        }
      } else {
        try {
          await fs.copyFile(p, tempDbPath);
          return true;
        } catch {
          // ignore error and try next
        }
      }
    }
    return false;
  }

  /** Builds the `-c` config overrides that point Codex at a custom OpenAI-compatible
   *  model provider (e.g. OpenRouter). We register a dedicated provider with
   *  `requires_openai_auth = false` so non-`sk-` gateway keys are accepted. The wire API is
   *  left at Codex's default (`responses`); `chat` is no longer supported by Codex. Returns an
   *  empty array for non-codex providers or when no custom base URL is configured. */
  private buildCodexCustomProviderArgs(
    provider: CliProviderId,
    config: Pick<ProviderRunInput, "customBaseUrl" | "providerMountAuth">,
    workflowSettings: CliWorkflowSettings,
  ): string[] {
    if (provider !== "codex" || config.providerMountAuth || !config.customBaseUrl || config.customBaseUrl.trim().length === 0) {
      return [];
    }
    const providerId = "custom_gateway";
    const customBaseUrl = config.customBaseUrl.trim();
    const baseUrl = this.rewriteLoopbackUrlForDocker(
      customBaseUrl,
      this.shouldRewriteDockerLoopbackUrls(workflowSettings, [customBaseUrl]),
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
    antigravityLogPath?: string | null,
    thinkingMode?: ThinkingMode,
  ): { command: string; args: string[] } {
    if (provider === "codex" && codexOutputPath) {
      const e2eShimPath = process.env[E2E_PROVIDER_CLI_SHIM_ENV]?.trim();
      if (e2eShimPath) {
        const args = [
          e2eShimPath,
          "--provider", provider,
          "--model", model || "default",
          "--prompt", prompt,
          "--codex-output-path", codexOutputPath,
        ];
        if (nativeSessionId) {
          args.push("--native-session-id", nativeSessionId);
        }
        if (continueSession) {
          args.push("--continue-session");
        }
        return { command: process.execPath, args };
      }
      // `codex exec resume --last` continues the most recent session in the cwd
      const args = continueSession
        ? ["exec", "resume", "--last", "--yolo", "--json", "--output-last-message", codexOutputPath]
        : ["exec", "--yolo", "--json", "--output-last-message", codexOutputPath];
      args.push(...codexProviderArgs);
      if (thinkingMode) {
        args.push("-c", `model_reasoning_effort="${normalizeProviderThinkingMode("codex", thinkingMode, undefined, model)}"`);
      }
      if (model && model !== "default") {
        args.push("--model", model);
      }
      args.push(prompt);
      return { command: "codex", args };
    }

    if (provider === "claude-code" && nativeSessionId) {
      const args = ["--dangerously-skip-permissions"];
      if (continueSession) {
        args.push("--resume", nativeSessionId);
      } else {
        args.push("--session-id", nativeSessionId);
      }
      if (model && model !== "default") {
        args.push("--model", model);
      }
      if (thinkingMode) {
        args.push("--effort", normalizeProviderThinkingMode("claude-code", thinkingMode));
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
      if (continueSession) {
        args.push("--continue");
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
      if (thinkingMode) {
        args.push("--variant", normalizeProviderThinkingMode("opencode", thinkingMode));
      }
      args.push(prompt);
      return { command: "opencode", args };
    }

    if (provider === "antigravity") {
      const args = ["--dangerously-skip-permissions"];
      if (antigravityLogPath) {
        // Capture agy's diagnostics (quota/auth/executor errors) which it only writes
        // to this log file, never to stdout/stderr. Placed ahead of the terminal -p flag.
        args.push("--log-file", antigravityLogPath);
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

    const spec = providerSpec(model, prompt, thinkingMode);
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
    providerConfig?: Pick<ProviderRunInput, "qwenAuthMode" | "qwenRegion" | "qwenBaseUrl" | "qwenEnvKey" | "qwenModelId" | "qwenProtocol" | "qwenAdditionalModelProviders" | "thinkingMode" | "openCodeAuthMode" | "openCodeProviderId" | "openCodeModelId" | "openCodeBaseUrl" | "openCodeEnvKey" | "openCodePackage" | "mcpConnection" | "customBaseUrl" | "customModel" | "customMcpServers">,
    qwenProcessLogDir?: string,
    gitlabToken?: string,
  ): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const useContainerMounts = workflowSettings.executionMode === "DOCKER";
    const useGithubMount = useContainerMounts && workflowSettings.containerMountGithubAuth;
    const useProviderMount = useContainerMounts && Boolean(providerMountAuth);
    const isApiKeyMode = !providerMountAuth;

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
      if (isApiKeyMode && apiKey && !useProviderMount) env.GEMINI_API_KEY = apiKey;
      env.GEMINI_CLI_TRUST_WORKSPACE = "true";
    } else if (provider === "claude-code") {
      if (isApiKeyMode && providerConfig?.customBaseUrl) {
        // Claude Code speaks the Anthropic Messages API and always appends `/v1/messages`
        // to ANTHROPIC_BASE_URL. A base ending in `/v1` (e.g. the OpenAI-format URL used by
        // Codex/Qwen, https://openrouter.ai/api/v1) would produce `/v1/v1/messages` and fail
        // auth, so normalize it off — the Anthropic-compatible base is e.g. .../api.
        const normalizedBaseUrl = providerConfig.customBaseUrl.trim().replace(/\/v1\/?$/, "");
        env.ANTHROPIC_BASE_URL = this.rewriteLoopbackUrlForDocker(
          normalizedBaseUrl,
          this.shouldRewriteDockerLoopbackUrls(workflowSettings, [normalizedBaseUrl]),
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
      } else if (isApiKeyMode && apiKey && !useProviderMount) {
        env.ANTHROPIC_API_KEY = apiKey;
      }

      // If a custom model is provided (and thus passed in `model`), point every Claude
      // Code model tier at it — including the background "small/fast" tier that would
      // otherwise request a Haiku model the gateway does not serve.
      if (isApiKeyMode && model && model !== "default") {
        env.ANTHROPIC_MODEL = model;
        env.ANTHROPIC_SMALL_FAST_MODEL = model;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;
      }
    } else if (provider === "codex") {
      if (model && model !== "default") env.CODEX_MODEL = model;
      if (isApiKeyMode && apiKey && !useProviderMount) env.OPENAI_API_KEY = apiKey;
      if (isApiKeyMode && providerConfig?.customBaseUrl) {
        env.OPENAI_BASE_URL = this.rewriteLoopbackUrlForDocker(
          providerConfig.customBaseUrl,
          this.shouldRewriteDockerLoopbackUrls(workflowSettings, [providerConfig.customBaseUrl]),
        );
      }
    } else if (provider === "qwen-code") {
      const qwenEnvKeys = new Set<string>();
      const primaryEnvKey = !isApiKeyMode
        ? "OLLAMA_API_KEY"
        : providerConfig?.qwenAuthMode === "ALIBABA_CODING_PLAN"
          ? "BAILIAN_CODING_PLAN_API_KEY"
          : providerConfig?.qwenEnvKey || "OLLAMA_API_KEY";
      qwenEnvKeys.add(primaryEnvKey);
      qwenEnvKeys.add("QWEN_CODE_SUPPRESS_YOLO_WARNING");
      env.QWEN_CODE_SUPPRESS_YOLO_WARNING = "1";
      if (isApiKeyMode && apiKey && !useProviderMount) {
        env[primaryEnvKey] = apiKey;
        env.DASHSCOPE_API_KEY ||= apiKey;
        env.BAILIAN_CODING_PLAN_API_KEY ||= apiKey;
        env.QWEN_API_KEY ||= apiKey;
        if ((providerConfig?.qwenProtocol || "openai") === "openai") {
          env.OPENAI_API_KEY ||= apiKey;
        }
      }
      const baseUrl = isApiKeyMode && providerConfig?.qwenAuthMode === "ALIBABA_CODING_PLAN"
        ? providerConfig.qwenRegion === "china"
          ? "https://coding.dashscope.aliyuncs.com/v1"
          : "https://coding-intl.dashscope.aliyuncs.com/v1"
        : isApiKeyMode && providerConfig?.qwenAuthMode === "MODEL_PROVIDER"
          ? providerConfig.qwenBaseUrl || "http://127.0.0.1:11434/v1"
          : undefined;
      if (baseUrl) {
        env.OPENAI_BASE_URL = this.rewriteLoopbackUrlForDocker(baseUrl, this.shouldRewriteDockerLoopbackUrls(workflowSettings, [baseUrl]));
      }
      if (isApiKeyMode) {
        for (const entry of providerConfig?.qwenAdditionalModelProviders || []) {
          if (entry.envKey) {
            qwenEnvKeys.add(entry.envKey);
            if (entry.apiKey && !useProviderMount) {
              env[entry.envKey] = entry.apiKey;
            }
          }
        }
      }
      if (qwenEnvKeys.size > 0) {
        env.CODE_UX_PROVIDER_ENV_KEYS = [...qwenEnvKeys].join(",");
      }
      env.QWEN_SETTINGS_CONTENT = buildQwenRuntimeConfig(
        model,
        {
          ...providerConfig,
          qwenAuthMode: !isApiKeyMode ? "LOCAL_AUTH" : providerConfig?.qwenAuthMode,
        },
        providerConfig?.mcpConnection || null,
        this.shouldRewriteDockerLoopbackUrls(
          workflowSettings,
          this.collectDockerReachabilityUrls(
            providerConfig?.mcpConnection || null,
            providerConfig?.customMcpServers || [],
            baseUrl ? [baseUrl] : [],
          ),
        ),
        (url, enabled) => this.rewriteLoopbackUrlForDocker(url, enabled),
        qwenProcessLogDir,
      );
    } else if (provider === "opencode") {
      const envKey = isApiKeyMode
        ? (providerConfig?.openCodeEnvKey || (providerConfig?.openCodeAuthMode === "CUSTOM_PROVIDER" ? "OLLAMA_API_KEY" : "ANTHROPIC_API_KEY"))
        : "ANTHROPIC_API_KEY";
      const resolvedApiKey = isApiKeyMode ? (apiKey || process.env[envKey] || "") : "";
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
      env.OPENCODE_CONFIG_CONTENT = buildOpenCodeRuntimeConfig(
        model,
        {
          ...providerConfig,
          openCodeAuthMode: !isApiKeyMode ? "LOCAL_AUTH" : providerConfig?.openCodeAuthMode,
        },
        providerConfig?.mcpConnection || null,
        this.shouldRewriteDockerLoopbackUrls(
          workflowSettings,
          this.collectDockerReachabilityUrls(
            providerConfig?.mcpConnection || null,
            providerConfig?.customMcpServers || [],
            providerConfig?.openCodeBaseUrl ? [providerConfig.openCodeBaseUrl] : [],
          ),
        ),
        (url, enabled) => this.rewriteLoopbackUrlForDocker(url, enabled),
      );
    } else if (provider === "antigravity") {
      if (isApiKeyMode && apiKey && !useProviderMount) {
        env.ANTIGRAVITY_API_KEY = apiKey;
      }
      if (model && model !== "default") {
        env.ANTIGRAVITY_MODEL = model;
        env.AGY_MODEL = model;
      }
    } else if (provider === "mockup-cli") {
      env.CODE_UX_MOCKUP_MODEL = model || "default";
    }
    return env;
  }

  private shouldRewriteDockerLoopbackUrls(workflowSettings: CliWorkflowSettings, candidateUrls: string[] = []): boolean {
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
      || os.release().toLowerCase().includes("microsoft")
      || candidateUrls.some((url) => this.isLoopbackUrl(url));
  }

  private rewriteLoopbackUrlForDocker(rawUrl: string, enabled: boolean): string {
    if (!enabled) {
      return rawUrl;
    }
    try {
      const url = new URL(rawUrl);
      if (
        url.hostname === "127.0.0.1"
        || url.hostname === "localhost"
        || url.hostname === "::1"
        || url.hostname === "[::1]"
        || url.hostname === "0.0.0.0"
        || url.hostname === "::"
        || url.hostname === "[::]"
      ) {
        url.hostname = "host.docker.internal";
        return url.toString();
      }
    } catch {
      return rawUrl;
    }
    return rawUrl;
  }

  private collectDockerReachabilityUrls(
    conn: McpConnectionInfo | null,
    customServers: CustomMcpServer[],
    extraUrls: string[] = [],
  ): string[] {
    const urls = [...extraUrls];
    if (conn) {
      urls.push(conn.url);
    }
    for (const server of customServers) {
      if (server.enabled && server.transport !== "stdio" && server.url) {
        urls.push(server.url);
      }
    }
    return urls;
  }

  private isLoopbackUrl(rawUrl: string): boolean {
    try {
      const url = new URL(rawUrl);
      return url.hostname === "127.0.0.1"
        || url.hostname === "localhost"
        || url.hostname === "::1"
        || url.hostname === "[::1]"
        || url.hostname === "0.0.0.0"
        || url.hostname === "::"
        || url.hostname === "[::]";
    } catch {
      return false;
    }
  }



  private shouldSuppressStructuredStdout(provider: CliProviderId, line: string): boolean {
    if (provider !== "gemini" && provider !== "codex" && provider !== "opencode") {
      return false;
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return false;
    }
    return (trimmed.startsWith("{") && trimmed.endsWith("}"))
      || (trimmed.startsWith("[") && trimmed.endsWith("]"));
  }

  private async writeLocalMcpConfig(
    conn: McpConnectionInfo | null,
    cwd: string,
    provider: CliProviderId,
    qwenSettingsContent?: string,
    customServers: CustomMcpServer[] = [],
  ): Promise<Array<{ path: string; originalContent: string | null }>> {
    let dirPath: string | null = null;
    let expectedFilename: string | null = null;

    if (provider === "claude-code") {
      dirPath = path.join(cwd, ".claude");
      expectedFilename = "settings.local.json";
    } else if (provider === "gemini") {
      dirPath = path.join(cwd, ".gemini");
      expectedFilename = "settings.json";
    } else if (provider === "qwen-code") {
      dirPath = path.join(cwd, ".qwen");
      expectedFilename = "settings.json";
    } else if (provider === "codex") {
      dirPath = path.join(cwd, ".codex");
      expectedFilename = "config.toml";
    } else if (provider === "antigravity") {
      dirPath = path.join(cwd, ".agents");
      expectedFilename = "mcp_config.json";
    }

    if (!dirPath || !expectedFilename) {
      return [];
    }

    const configPath = path.join(dirPath, expectedFilename);
    const originalContent = await fs.readFile(configPath, "utf8").catch(() => null);

    const artifact = buildProviderMcpConfigArtifact(provider, conn, customServers, {
      qwenSettingsContent,
      existingContent: originalContent,
    });

    if (!artifact) {
      return [];
    }

    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(configPath, artifact.content, { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") {
      await fs.chmod(configPath, 0o600);
    }
    return [{ path: configPath, originalContent }];
  }
}
