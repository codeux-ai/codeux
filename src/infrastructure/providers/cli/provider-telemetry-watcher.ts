import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
import type { Logger } from "../../../shared/logging/logger.js";
import { getCorrelationId } from "../../../shared/logging/correlation-id.js";
import { CliProviderId } from "./provider-command-specs.js";
import {
  collectProviderUsageTelemetry,
  ProviderUsageTelemetry,
  QwenUsageTotals,
  ParsedConversationTurn,
} from "./provider-usage.js";
import {
  CodexRolloutAccumulator,
  parseCodexExecStdout,
  type CodexLogResult,
} from "./provider-logs/codex-log-parser.js";
import {
  ClaudeCodeLogAccumulator,
  type ClaudeCodeLogResult,
} from "./provider-logs/claude-code-log-parser.js";
import {
  ProviderTranscriptChunkDecoder,
  type ProviderTranscriptChunk,
  type ProviderTranscriptCursor,
} from "./provider-transcript-chunks.js";

export interface TelemetryWatcherOptions {
  provider: CliProviderId;
  model: string;
  prompt: string;
  cwd: string;
  startedMs: number;
  workflowSettings: CliWorkflowSettings;
  signal?: AbortSignal;
  logger?: Pick<Logger, "debug" | "warn">;
  onTelemetry: (telemetry: ProviderUsageTelemetry) => void;
  invocationId?: string | null;
  providerInvocationId?: string | null;
  purpose?: string | null;
  getAccumulatedRawStdout: () => string;
  getAccumulatedStderr: () => string;
  nativeSessionId: string | null;
  sessionId: string;
  antigravityLogPath: string | null;
  /** Highest Antigravity generation row present before this invocation. */
  antigravitySinceIdx?: number | null;
  initialPollDelayMs?: number;
  pollIntervalMs?: number;
  getClaudeSessionJsonlMetadata?: (nativeSessionId: string) => Promise<string | null>;
  readClaudeSessionJsonl: (nativeSessionId: string) => Promise<string | null>;
  readClaudeSessionJsonlChunk?: (nativeSessionId: string, cursor: ProviderTranscriptCursor) => Promise<ProviderTranscriptChunk | null>;
  getCodexLatestSessionJsonMetadata?: () => Promise<string | null>;
  getCodexSessionJsonMetadata?: (nativeSessionId: string) => Promise<string | null>;
  readCodexLatestSessionJson: () => Promise<string | null>;
  readCodexSessionJson?: (nativeSessionId: string) => Promise<string | null>;
  readCodexLatestSessionChunk?: (cursor: ProviderTranscriptCursor) => Promise<ProviderTranscriptChunk | null>;
  readCodexSessionChunk?: (nativeSessionId: string, cursor: ProviderTranscriptCursor) => Promise<ProviderTranscriptChunk | null>;
  getQwenLogDataMetadata?: () => Promise<string | null>;
  readQwenLogData: () => Promise<{ usage: QwenUsageTotals | null; conversation: ParsedConversationTurn[] } | null>;
  getAntigravityLogMetadata?: (logPath: string) => Promise<string | null>;
  parseAntigravityConversationId: (logPath: string) => Promise<string | null>;
  getAntigravityTranscriptMetadata?: (resolvedSessionId: string) => Promise<string | null>;
  getAntigravityDatabaseMetadata?: (resolvedSessionId: string) => Promise<string | null>;
  readAntigravityTranscript: (resolvedSessionId: string) => Promise<string | null>;
  resolveAntigravityDatabase: (resolvedSessionId: string, destPath: string) => Promise<boolean | string | null>;
}

type ProviderMetadataSignature = { available: true; signature: string } | { available: false };

interface FullReadInputs {
  resolvedNativeSessionId: string | null;
  claudeSessionJsonl: string | null;
  claudeLog: ClaudeCodeLogResult | null;
  claudeIncrementalSignature: string | null;
  codexSessionJson: string | null;
  codexRollout: CodexLogResult | null;
  codexIncrementalSignature: string | null;
  qwenLog: { usage: QwenUsageTotals | null; conversation: ParsedConversationTurn[] } | null;
  antigravityTranscriptJsonl: string | null;
}

interface FailureBackoffState {
  sourceSignature: string | null;
  remainingSkippedPolls: number;
}

interface FullReadResult {
  skipped: boolean;
  preReadSourceSignature: string | null;
  inputs: FullReadInputs;
}

const FAILURE_BACKOFF_MAX_SKIPPED_POLLS = 20;
const MAX_INCREMENTAL_CHUNKS_PER_POLL = 4;

function buildMetadataSourceSignature(args: {
  provider: CliProviderId;
  model: string;
  resolvedNativeSessionId: string | null;
  stdout: string;
  stderr: string;
  providerMetadata: string | null;
}): string {
  return [
    args.provider,
    args.model,
    args.resolvedNativeSessionId || "",
    signatureForString(args.stdout),
    signatureForString(args.stderr),
    args.providerMetadata || "",
  ].join("|");
}

async function buildTelemetrySourceSignature(args: {
  provider: CliProviderId;
  model: string;
  resolvedNativeSessionId: string | null;
  stdout: string;
  stderr: string;
  claudeSessionJsonl: string | null;
  claudeIncrementalSignature: string | null;
  codexSessionJson: string | null;
  codexIncrementalSignature: string | null;
  qwenLog: { usage: QwenUsageTotals | null; conversation: ParsedConversationTurn[] } | null;
  antigravityTranscriptJsonl: string | null;
  antigravityTempDbPath: string | null;
}): Promise<string> {
  const parts = [
    args.provider,
    args.model,
    args.resolvedNativeSessionId || "",
    signatureForString(args.stdout),
    signatureForString(args.stderr),
    signatureForString(args.claudeSessionJsonl || ""),
    args.claudeIncrementalSignature || "",
    signatureForString(args.codexSessionJson || ""),
    args.codexIncrementalSignature || "",
    signatureForString(args.antigravityTranscriptJsonl || ""),
  ];

  if (args.qwenLog) {
    parts.push(signatureForString(JSON.stringify(args.qwenLog)));
  }

  if (args.antigravityTempDbPath) {
    parts.push(`antigravity-temp-db:${await readFileMetadataSignature(args.antigravityTempDbPath)}`);
  }

  return parts.join("|");
}

async function readFileMetadataSignature(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) {
    return "missing";
  }
  return `${stat.size}:${Math.floor(stat.mtimeMs)}`;
}

function signatureForString(value: string): string {
  if (!value) {
    return "0:";
  }
  if (value.length > 32768) {
    return [
      value.length,
      hashString(value.slice(0, 4096)),
      hashString(value.slice(Math.floor(value.length / 2), Math.floor(value.length / 2) + 4096)),
      hashString(value.slice(-16384)),
    ].join(":");
  }
  return `${value.length}:${hashString(value)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export class ProviderTelemetryWatcher {
  private active = false;
  private promise: Promise<void> | null = null;
  private tempDbPath: string | null = null;
  private lastTelemetrySourceSignature: string | null = null;
  private lastEmittedPreReadSourceSignature: string | null = null;
  private readFailureCount = 0;
  private lastFailureWarningCount = 0;
  private failureBackoff: FailureBackoffState | null = null;
  private resolvedNativeSessionId: string | null = null;
  private readonly codexRolloutAccumulator: CodexRolloutAccumulator | null;
  private readonly claudeLogAccumulator: ClaudeCodeLogAccumulator | null;
  private readonly codexChunkDecoder = new ProviderTranscriptChunkDecoder();
  private readonly claudeChunkDecoder = new ProviderTranscriptChunkDecoder();
  private wakeWait: (() => void) | null = null;

  constructor(private readonly opts: TelemetryWatcherOptions) {
    this.codexRolloutAccumulator = opts.provider === "codex"
      ? new CodexRolloutAccumulator(opts.startedMs)
      : null;
    this.claudeLogAccumulator = opts.provider === "claude-code"
      ? new ClaudeCodeLogAccumulator(opts.startedMs)
      : null;
  }

  start() {
    this.active = true;
    this.promise = this.loop();
  }

  async stop() {
    this.active = false;
    this.wakeWait?.();
    if (this.promise) {
      await this.promise.catch(() => undefined);
    }
    if (this.tempDbPath) {
      const tempDbPath = this.tempDbPath;
      this.tempDbPath = null;
      await fs.rm(tempDbPath, { force: true }).catch(() => undefined);
    }
  }

  async readFinalCodexRollout(): Promise<CodexLogResult | null> {
    if (
      (!this.opts.readCodexSessionChunk && !this.opts.readCodexLatestSessionChunk)
      || !this.codexRolloutAccumulator
    ) {
      return null;
    }
    this.resolveCodexNativeSessionId(this.opts.getAccumulatedRawStdout());
    const result = await this.collectIncrementalCodexInputs(null, {
      resolvedNativeSessionId: this.resolvedNativeSessionId || this.opts.nativeSessionId,
      claudeSessionJsonl: null,
      claudeLog: null,
      claudeIncrementalSignature: null,
      codexSessionJson: null,
      codexRollout: null,
      codexIncrementalSignature: null,
      qwenLog: null,
      antigravityTranscriptJsonl: null,
    });
    return result.inputs.codexRollout;
  }

  private async loop() {
    await this.wait(this.getInitialPollDelayMs());
    while (this.active && !this.opts.signal?.aborted) {
      let failureSourceSignature: string | null = null;
      try {
        const stdout = this.opts.getAccumulatedRawStdout();
        const stderr = this.opts.getAccumulatedStderr();
        if (this.opts.provider === "codex") {
          this.resolveCodexNativeSessionId(stdout);
        }
        const fallbackFailureSourceSignature = this.buildFallbackFailureSourceSignature({
          resolvedNativeSessionId: this.resolvedNativeSessionId,
          stdout,
          stderr,
        });
        this.resetMetadataFailureIfSourceChanged(fallbackFailureSourceSignature);
        failureSourceSignature = fallbackFailureSourceSignature;
        if (this.shouldDeferFailedSourceRead(fallbackFailureSourceSignature)) {
          this.logPollEvent("provider_telemetry_poll_no_new_data", {
            nativeSessionId: this.resolvedNativeSessionId || this.opts.nativeSessionId || undefined,
          });
          await this.wait(this.getPollIntervalMs());
          continue;
        }
        let preReadSourceSignature = await this.buildPreReadSourceSignature({
          resolvedNativeSessionId: this.resolvedNativeSessionId,
          stdout,
          stderr,
        });
        if (preReadSourceSignature) {
          this.resetFailureIfSourceChanged(preReadSourceSignature);
          failureSourceSignature = preReadSourceSignature;
        }
        if (
          preReadSourceSignature
          && this.lastTelemetrySourceSignature
          && preReadSourceSignature === this.lastEmittedPreReadSourceSignature
        ) {
          this.logPollEvent("provider_telemetry_poll_no_new_data", {
            nativeSessionId: this.resolvedNativeSessionId || this.opts.nativeSessionId || undefined,
          });
          await this.wait(this.getPollIntervalMs());
          continue;
        }

        if (this.shouldDeferFailedSourceRead(preReadSourceSignature)) {
          this.logPollEvent("provider_telemetry_poll_no_new_data", {
            nativeSessionId: this.resolvedNativeSessionId || this.opts.nativeSessionId || undefined,
          });
          await this.wait(this.getPollIntervalMs());
          continue;
        }

        const fullReadInputs = await this.collectFullReadInputs({
          preReadSourceSignature,
          stdout,
          stderr,
        });
        preReadSourceSignature = fullReadInputs.preReadSourceSignature;
        if (preReadSourceSignature) {
          this.resetFailureIfSourceChanged(preReadSourceSignature);
          failureSourceSignature = preReadSourceSignature;
        }
        if (fullReadInputs.skipped) {
          this.logPollEvent("provider_telemetry_poll_no_new_data", {
            nativeSessionId: fullReadInputs.inputs.resolvedNativeSessionId || this.opts.nativeSessionId || undefined,
          });
          await this.wait(this.getPollIntervalMs());
          continue;
        }
        const {
          resolvedNativeSessionId,
          claudeSessionJsonl,
          claudeLog,
          claudeIncrementalSignature,
          codexSessionJson,
          codexRollout,
          codexIncrementalSignature,
          qwenLog,
          antigravityTranscriptJsonl,
        } = fullReadInputs.inputs;

        const sourceSignature = await buildTelemetrySourceSignature({
          provider: this.opts.provider,
          model: this.opts.model,
          resolvedNativeSessionId: resolvedNativeSessionId || this.opts.nativeSessionId,
          stdout,
          stderr,
          claudeSessionJsonl,
          claudeIncrementalSignature,
          codexSessionJson,
          codexIncrementalSignature,
          qwenLog,
          antigravityTranscriptJsonl,
          antigravityTempDbPath: this.tempDbPath,
        });
        if (sourceSignature === this.lastTelemetrySourceSignature) {
          this.lastEmittedPreReadSourceSignature = preReadSourceSignature;
          this.resetReadFailures();
          this.logPollEvent("provider_telemetry_poll_no_new_data", {
            nativeSessionId: resolvedNativeSessionId || this.opts.nativeSessionId || undefined,
          });
          await this.wait(this.getPollIntervalMs());
          continue;
        }

        const parsedCodexRollout: CodexLogResult | null = codexRollout
          ?? (codexSessionJson && this.codexRolloutAccumulator
            ? this.codexRolloutAccumulator.update(codexSessionJson)
            : null);
        const telemetry = await collectProviderUsageTelemetry({
          provider: this.opts.provider,
          model: this.opts.model,
          prompt: this.opts.prompt,
          cwd: this.opts.cwd,
          stdout,
          stderr,
          capturedText: "",
          nativeSessionId: resolvedNativeSessionId || this.opts.nativeSessionId,
          claudeSessionJsonl,
          claudeSessionLog: claudeLog,
          codexSessionJson,
          codexRollout: parsedCodexRollout,
          qwenReportedUsage: qwenLog?.usage ?? null,
          qwenConversation: qwenLog?.conversation ?? null,
          startTimeMs: this.opts.startedMs,
          executionMode: this.opts.workflowSettings.executionMode,
          antigravitySessionDbPath: this.tempDbPath,
          antigravitySinceIdx: this.opts.antigravitySinceIdx,
          antigravityTranscriptJsonl,
        });

        if (this.opts.onTelemetry) {
          this.opts.onTelemetry(telemetry);
        }
        this.logPollEvent(this.getTelemetryPollEventType(telemetry), {
          nativeSessionId: telemetry.nativeSessionId || resolvedNativeSessionId || this.opts.nativeSessionId || undefined,
          usageSource: telemetry.usageSource,
          transcriptChars: telemetry.transcriptText.length,
          conversationTurnCount: telemetry.conversation?.length ?? 0,
          toolCallCount: telemetry.conversation?.filter((turn) => turn.kind === "tool_call").length ?? 0,
          inputTokens: telemetry.inputTokens,
          cachedInputTokens: telemetry.cachedInputTokens,
          outputTokens: telemetry.outputTokens,
          reasoningOutputTokens: telemetry.reasoningOutputTokens,
          totalTokens: telemetry.totalTokens,
          hasRawUsageJson: Boolean(telemetry.rawUsageJson),
        });
        this.lastTelemetrySourceSignature = sourceSignature;
        this.lastEmittedPreReadSourceSignature = preReadSourceSignature;
        this.resetReadFailures();
      } catch (err) {
        this.recordReadFailure(err, failureSourceSignature);
      }
      await this.wait(this.getPollIntervalMs());
    }
  }

  private async collectFullReadInputs(args: {
    preReadSourceSignature: string | null;
    stdout: string;
    stderr: string;
  }): Promise<FullReadResult> {
    if (this.opts.provider === "codex") {
      this.resolveCodexNativeSessionId(args.stdout);
    }
    const emptyInputs: FullReadInputs = {
      resolvedNativeSessionId: this.resolvedNativeSessionId || this.opts.nativeSessionId,
      claudeSessionJsonl: null,
      claudeLog: null,
      claudeIncrementalSignature: null,
      codexSessionJson: null,
      codexRollout: null,
      codexIncrementalSignature: null,
      qwenLog: null,
      antigravityTranscriptJsonl: null,
    };

    if (this.opts.provider === "claude-code" && this.opts.nativeSessionId) {
      if (this.opts.readClaudeSessionJsonlChunk) {
        return this.collectIncrementalClaudeInputs(args.preReadSourceSignature, emptyInputs);
      }
      return {
        skipped: false,
        preReadSourceSignature: args.preReadSourceSignature,
        inputs: {
          ...emptyInputs,
          claudeSessionJsonl: await this.opts.readClaudeSessionJsonl(this.opts.nativeSessionId),
          resolvedNativeSessionId: this.opts.nativeSessionId,
        },
      };
    }

    if (this.opts.provider === "codex") {
      if (
        (this.opts.readCodexSessionChunk || this.opts.readCodexLatestSessionChunk)
        && this.codexRolloutAccumulator
      ) {
        return this.collectIncrementalCodexInputs(args.preReadSourceSignature, emptyInputs);
      }
      const nativeSessionId = emptyInputs.resolvedNativeSessionId;
      return {
        skipped: false,
        preReadSourceSignature: args.preReadSourceSignature,
        inputs: {
          ...emptyInputs,
          codexSessionJson: this.opts.readCodexSessionJson
            ? nativeSessionId
              ? await this.opts.readCodexSessionJson(nativeSessionId)
              : null
            : await this.opts.readCodexLatestSessionJson(),
        },
      };
    }

    if (this.opts.provider === "qwen-code") {
      return {
        skipped: false,
        preReadSourceSignature: args.preReadSourceSignature,
        inputs: {
          ...emptyInputs,
          qwenLog: await this.opts.readQwenLogData(),
        },
      };
    }

    if (this.opts.provider === "antigravity") {
      return await this.collectAntigravityFullReadInputs(args);
    }

    return {
      skipped: false,
      preReadSourceSignature: args.preReadSourceSignature,
      inputs: emptyInputs,
    };
  }

  private async collectIncrementalCodexInputs(
    preReadSourceSignature: string | null,
    emptyInputs: FullReadInputs,
  ): Promise<FullReadResult> {
    let latestRollout: CodexLogResult | null = null;
    let signature: string | null = null;
    let sourceId: string | null = null;
    let reset = false;
    const decodedParts: string[] = [];
    const nativeSessionId = emptyInputs.resolvedNativeSessionId;
    for (let index = 0; index < MAX_INCREMENTAL_CHUNKS_PER_POLL; index += 1) {
      const chunk = this.opts.readCodexSessionChunk
        ? nativeSessionId
          ? await this.opts.readCodexSessionChunk(nativeSessionId, this.codexChunkDecoder.cursor)
          : null
        : await this.opts.readCodexLatestSessionChunk?.(this.codexChunkDecoder.cursor) ?? null;
      if (!chunk) {
        break;
      }
      const decoded = this.codexChunkDecoder.consume(chunk);
      signature = `${chunk.sourceId}:${chunk.nextOffset}:${chunk.totalBytes}`;
      sourceId = decoded.sourceId;
      reset ||= decoded.reset;
      if (decoded.text) decodedParts.push(decoded.text);
      if (decoded.complete || chunk.nextOffset === chunk.startOffset) {
        break;
      }
    }
    if (sourceId) {
      latestRollout = this.codexRolloutAccumulator!.appendChunk(
        decodedParts.join(""),
        sourceId,
        reset,
      );
    }
    return {
      skipped: false,
      preReadSourceSignature,
      inputs: {
        ...emptyInputs,
        codexRollout: latestRollout,
        codexIncrementalSignature: signature,
      },
    };
  }

  private async collectIncrementalClaudeInputs(
    preReadSourceSignature: string | null,
    emptyInputs: FullReadInputs,
  ): Promise<FullReadResult> {
    let latestLog: ClaudeCodeLogResult | null = null;
    let signature: string | null = null;
    let sourceId: string | null = null;
    let reset = false;
    const decodedParts: string[] = [];
    for (let index = 0; index < MAX_INCREMENTAL_CHUNKS_PER_POLL; index += 1) {
      const chunk = await this.opts.readClaudeSessionJsonlChunk!(
        this.opts.nativeSessionId!,
        this.claudeChunkDecoder.cursor,
      );
      if (!chunk) break;
      const decoded = this.claudeChunkDecoder.consume(chunk);
      signature = `${chunk.sourceId}:${chunk.nextOffset}:${chunk.totalBytes}`;
      sourceId = decoded.sourceId;
      reset ||= decoded.reset;
      if (decoded.text) decodedParts.push(decoded.text);
      if (decoded.complete || chunk.nextOffset === chunk.startOffset) break;
    }
    if (sourceId && this.claudeLogAccumulator) {
      latestLog = this.claudeLogAccumulator.appendChunk(decodedParts.join(""), sourceId, reset);
    }
    return {
      skipped: false,
      preReadSourceSignature,
      inputs: {
        ...emptyInputs,
        resolvedNativeSessionId: this.opts.nativeSessionId,
        claudeLog: latestLog,
        claudeIncrementalSignature: signature,
      },
    };
  }

  private async collectAntigravityFullReadInputs(args: {
    preReadSourceSignature: string | null;
    stdout: string;
    stderr: string;
  }): Promise<FullReadResult> {
    let preReadSourceSignature = args.preReadSourceSignature;
    const resolvedNativeSessionId = await this.resolveAntigravityNativeSessionId();
    if (!resolvedNativeSessionId) {
      return {
        skipped: false,
        preReadSourceSignature,
        inputs: {
          resolvedNativeSessionId,
          claudeSessionJsonl: null,
          claudeLog: null,
          claudeIncrementalSignature: null,
          codexSessionJson: null,
          codexRollout: null,
          codexIncrementalSignature: null,
          qwenLog: null,
          antigravityTranscriptJsonl: null,
        },
      };
    }

    const resolvedPreReadSourceSignature = await this.buildPreReadSourceSignature({
      resolvedNativeSessionId,
      stdout: args.stdout,
      stderr: args.stderr,
    });
    if (resolvedPreReadSourceSignature) {
      preReadSourceSignature = resolvedPreReadSourceSignature;
      if (
        this.lastTelemetrySourceSignature
        && resolvedPreReadSourceSignature === this.lastEmittedPreReadSourceSignature
      ) {
        return {
          skipped: true,
          preReadSourceSignature,
          inputs: {
            resolvedNativeSessionId,
            claudeSessionJsonl: null,
            claudeLog: null,
            claudeIncrementalSignature: null,
            codexSessionJson: null,
            codexRollout: null,
            codexIncrementalSignature: null,
            qwenLog: null,
            antigravityTranscriptJsonl: null,
          },
        };
      }
    }

    if (this.shouldDeferFailedSourceRead(preReadSourceSignature)) {
      return {
        skipped: true,
        preReadSourceSignature,
        inputs: {
          resolvedNativeSessionId,
          claudeSessionJsonl: null,
          claudeLog: null,
          claudeIncrementalSignature: null,
          codexSessionJson: null,
          codexRollout: null,
          codexIncrementalSignature: null,
          qwenLog: null,
          antigravityTranscriptJsonl: null,
        },
      };
    }

    const antigravityTranscriptJsonl = await this.opts.readAntigravityTranscript(resolvedNativeSessionId);
    await this.resolveAntigravityTempDatabase(resolvedNativeSessionId);
    return {
      skipped: false,
      preReadSourceSignature,
      inputs: {
        resolvedNativeSessionId,
        claudeSessionJsonl: null,
        claudeLog: null,
        claudeIncrementalSignature: null,
        codexSessionJson: null,
        codexRollout: null,
        codexIncrementalSignature: null,
        qwenLog: null,
        antigravityTranscriptJsonl,
      },
    };
  }

  private async resolveAntigravityNativeSessionId(): Promise<string | null> {
    let resolvedNativeSessionId = this.resolvedNativeSessionId || this.opts.nativeSessionId;
    if (!resolvedNativeSessionId && this.opts.antigravityLogPath) {
      resolvedNativeSessionId = await this.opts.parseAntigravityConversationId(this.opts.antigravityLogPath);
      this.resolvedNativeSessionId = resolvedNativeSessionId;
    }
    return resolvedNativeSessionId;
  }

  private resolveCodexNativeSessionId(stdout: string): string | null {
    const stdoutSessionId = parseCodexExecStdout(stdout).nativeSessionId;
    const resolved = stdoutSessionId
      || this.resolvedNativeSessionId
      || this.opts.nativeSessionId;
    if (resolved) {
      this.resolvedNativeSessionId = resolved;
    }
    return resolved;
  }

  private async resolveAntigravityTempDatabase(resolvedNativeSessionId: string): Promise<void> {
    if (!this.tempDbPath) {
      const safeSession = resolvedNativeSessionId.replace(/[^A-Za-z0-9_-]/g, "_");
      this.tempDbPath = path.join(os.tmpdir(), `agy-temp-watcher-${safeSession}-${randomUUID()}.db`);
    }
    await this.opts.resolveAntigravityDatabase(resolvedNativeSessionId, this.tempDbPath);
  }

  private async buildPreReadSourceSignature(args: {
    resolvedNativeSessionId: string | null;
    stdout: string;
    stderr: string;
  }): Promise<string | null> {
    const resolvedNativeSessionId = args.resolvedNativeSessionId || this.opts.nativeSessionId;
    const providerMetadata = await this.readProviderMetadata(resolvedNativeSessionId);
    if (!providerMetadata.available) {
      return null;
    }
    return buildMetadataSourceSignature({
      provider: this.opts.provider,
      model: this.opts.model,
      resolvedNativeSessionId,
      stdout: args.stdout,
      stderr: args.stderr,
      providerMetadata: providerMetadata.signature,
    });
  }

  private buildFallbackFailureSourceSignature(args: {
    resolvedNativeSessionId: string | null;
    stdout: string;
    stderr: string;
  }): string {
    return buildMetadataSourceSignature({
      provider: this.opts.provider,
      model: this.opts.model,
      resolvedNativeSessionId: args.resolvedNativeSessionId || this.opts.nativeSessionId,
      stdout: args.stdout,
      stderr: args.stderr,
      providerMetadata: "provider-metadata-unavailable",
    });
  }

  private async readProviderMetadata(resolvedNativeSessionId: string | null): Promise<ProviderMetadataSignature> {
    if (this.opts.provider === "claude-code" && this.opts.nativeSessionId) {
      if (!this.opts.getClaudeSessionJsonlMetadata) {
        return { available: false };
      }
      return { available: true, signature: await this.opts.getClaudeSessionJsonlMetadata(this.opts.nativeSessionId) || "" };
    }
    if (this.opts.provider === "codex") {
      if (resolvedNativeSessionId && this.opts.getCodexSessionJsonMetadata) {
        return {
          available: true,
          signature: await this.opts.getCodexSessionJsonMetadata(resolvedNativeSessionId) || "",
        };
      }
      if (!this.opts.getCodexLatestSessionJsonMetadata) {
        return { available: false };
      }
      return { available: true, signature: await this.opts.getCodexLatestSessionJsonMetadata() || "" };
    }
    if (this.opts.provider === "qwen-code") {
      if (!this.opts.getQwenLogDataMetadata) {
        return { available: false };
      }
      return { available: true, signature: await this.opts.getQwenLogDataMetadata() || "" };
    }
    if (this.opts.provider === "antigravity") {
      const parts: string[] = [];
      if (this.opts.antigravityLogPath) {
        if (!this.opts.getAntigravityLogMetadata) {
          return { available: false };
        }
        parts.push(`log:${await this.opts.getAntigravityLogMetadata(this.opts.antigravityLogPath)}`);
      }
      if (resolvedNativeSessionId) {
        if (!this.opts.getAntigravityTranscriptMetadata || !this.opts.getAntigravityDatabaseMetadata) {
          return { available: false };
        }
        parts.push(`transcript:${await this.opts.getAntigravityTranscriptMetadata(resolvedNativeSessionId)}`);
        parts.push(`database:${await this.opts.getAntigravityDatabaseMetadata(resolvedNativeSessionId)}`);
      }
      return { available: true, signature: parts.join("|") };
    }
    return { available: true, signature: "" };
  }

  private recordReadFailure(err: unknown, sourceSignature: string | null): void {
    this.readFailureCount += 1;
    this.failureBackoff = {
      sourceSignature,
      remainingSkippedPolls: this.getFailureBackoffSkippedPolls(),
    };
    if (this.shouldLogFailureWarning()) {
      this.lastFailureWarningCount = this.readFailureCount;
      const errorName = err instanceof Error ? err.name : "Error";
      this.opts.logger?.warn?.("Provider telemetry watcher read failed", {
        logPurpose: "invocation",
        eventType: "provider_telemetry_poll_failed",
        provider: this.opts.provider,
        purpose: this.opts.purpose || undefined,
        sessionId: this.opts.sessionId,
        invocationId: this.opts.invocationId || undefined,
        providerInvocationId: this.opts.providerInvocationId || undefined,
        nativeSessionId: this.resolvedNativeSessionId || this.opts.nativeSessionId || undefined,
        correlationId: getCorrelationId(),
        failureCount: this.readFailureCount,
        errorName,
      });
    }
  }

  private getTelemetryPollEventType(telemetry: ProviderUsageTelemetry): string {
    return telemetry.usageSource === "reported"
      ? "provider_telemetry_poll_succeeded"
      : "provider_telemetry_poll_partial";
  }

  private logPollEvent(eventType: string, metadata: Record<string, unknown>): void {
    this.opts.logger?.debug?.("Provider telemetry watcher poll", {
      logPurpose: "invocation",
      eventType,
      provider: this.opts.provider,
      purpose: this.opts.purpose || undefined,
      sessionId: this.opts.sessionId,
      invocationId: this.opts.invocationId || undefined,
      providerInvocationId: this.opts.providerInvocationId || undefined,
      correlationId: getCorrelationId(),
      ...metadata,
    });
  }

  private shouldLogFailureWarning(): boolean {
    if ([1, 2, 5].includes(this.readFailureCount)) {
      return this.lastFailureWarningCount !== this.readFailureCount;
    }
    return this.readFailureCount % 10 === 0 && this.lastFailureWarningCount !== this.readFailureCount;
  }

  private resetReadFailures(): void {
    this.readFailureCount = 0;
    this.lastFailureWarningCount = 0;
    this.failureBackoff = null;
  }

  private resetFailureIfSourceChanged(sourceSignature: string): void {
    if (this.failureBackoff && this.failureBackoff.sourceSignature !== sourceSignature) {
      this.resetReadFailures();
    }
  }

  private resetMetadataFailureIfSourceChanged(fallbackFailureSourceSignature: string): void {
    if (
      this.failureBackoff
      && this.failureBackoff.sourceSignature?.endsWith("|provider-metadata-unavailable")
      && this.failureBackoff.sourceSignature !== fallbackFailureSourceSignature
    ) {
      this.resetReadFailures();
    }
  }

  private shouldDeferFailedSourceRead(sourceSignature: string | null): boolean {
    if (!sourceSignature || !this.failureBackoff || this.failureBackoff.sourceSignature !== sourceSignature) {
      return false;
    }
    if (this.failureBackoff.remainingSkippedPolls <= 0) {
      return false;
    }
    this.failureBackoff.remainingSkippedPolls -= 1;
    return true;
  }

  private getFailureBackoffSkippedPolls(): number {
    const exponent = Math.min(Math.max(this.readFailureCount - 1, 0), 4);
    return Math.min(2 ** exponent, FAILURE_BACKOFF_MAX_SKIPPED_POLLS);
  }

  private getInitialPollDelayMs(): number {
    return this.opts.initialPollDelayMs ?? 1000;
  }

  private getPollIntervalMs(): number {
    return this.opts.pollIntervalMs ?? 1500;
  }

  private async wait(ms: number): Promise<void> {
    if (this.opts.signal?.aborted || !this.active) {
      return;
    }
    await new Promise<void>((resolve) => {
      let timeout: NodeJS.Timeout | null = null;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        this.opts.signal?.removeEventListener("abort", onAbort);
        if (this.wakeWait === finish) this.wakeWait = null;
        resolve();
      };
      const onAbort = () => finish();
      this.wakeWait = finish;
      timeout = setTimeout(() => {
        finish();
      }, ms);
      this.opts.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
