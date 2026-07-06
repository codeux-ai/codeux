import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
import type { Logger } from "../../../shared/logging/logger.js";
import { getCorrelationId } from "../../../shared/logging/correlation-id.js";
import { redactText } from "../../../shared/security/redaction.js";
import { CliProviderId } from "./provider-command-specs.js";
import {
  collectProviderUsageTelemetry,
  ProviderUsageTelemetry,
  QwenUsageTotals,
  ParsedConversationTurn,
} from "./provider-usage.js";

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
  getClaudeSessionJsonlMetadata?: (nativeSessionId: string) => Promise<string | null>;
  readClaudeSessionJsonl: (nativeSessionId: string) => Promise<string | null>;
  getCodexLatestSessionJsonMetadata?: () => Promise<string | null>;
  readCodexLatestSessionJson: () => Promise<string | null>;
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
  codexSessionJson: string | null;
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
    signatureForString(args.codexSessionJson || ""),
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
  private resolvedNativeSessionId: string | null = null;

  constructor(private readonly opts: TelemetryWatcherOptions) {}

  start() {
    this.active = true;
    this.promise = this.loop();
  }

  async stop() {
    this.active = false;
    if (this.promise) {
      await this.promise.catch(() => undefined);
    }
    if (this.tempDbPath) {
      const tempDbPath = this.tempDbPath;
      this.tempDbPath = null;
      await fs.rm(tempDbPath, { force: true }).catch(() => undefined);
    }
  }

  private async loop() {
    await this.wait(1000);
    while (this.active && !this.opts.signal?.aborted) {
      try {
        const stdout = this.opts.getAccumulatedRawStdout();
        const stderr = this.opts.getAccumulatedStderr();
        let preReadSourceSignature = await this.buildPreReadSourceSignature({
          resolvedNativeSessionId: this.resolvedNativeSessionId,
          stdout,
          stderr,
        });
        if (
          preReadSourceSignature
          && this.lastTelemetrySourceSignature
          && preReadSourceSignature === this.lastEmittedPreReadSourceSignature
        ) {
          this.logPollEvent("provider_telemetry_poll_no_new_data", {
            nativeSessionId: this.resolvedNativeSessionId || this.opts.nativeSessionId || undefined,
          });
          await this.wait(1500);
          continue;
        }

        let claudeSessionJsonl: string | null = null;
        let codexSessionJson: string | null = null;
        let qwenLog: { usage: QwenUsageTotals | null; conversation: ParsedConversationTurn[] } | null = null;
        let antigravityTranscriptJsonl: string | null = null;
        let resolvedNativeSessionId = this.resolvedNativeSessionId || this.opts.nativeSessionId;

        if (this.opts.provider === "claude-code" && this.opts.nativeSessionId) {
          claudeSessionJsonl = await this.opts.readClaudeSessionJsonl(this.opts.nativeSessionId);
        } else if (this.opts.provider === "codex") {
          codexSessionJson = await this.opts.readCodexLatestSessionJson();
        } else if (this.opts.provider === "qwen-code") {
          qwenLog = await this.opts.readQwenLogData();
        } else if (this.opts.provider === "antigravity") {
          if (!resolvedNativeSessionId && this.opts.antigravityLogPath) {
            resolvedNativeSessionId = await this.opts.parseAntigravityConversationId(this.opts.antigravityLogPath);
            this.resolvedNativeSessionId = resolvedNativeSessionId;
          }
          if (resolvedNativeSessionId) {
            const resolvedPreReadSourceSignature = await this.buildPreReadSourceSignature({
              resolvedNativeSessionId,
              stdout,
              stderr,
            });
            if (resolvedPreReadSourceSignature) {
              preReadSourceSignature = resolvedPreReadSourceSignature;
              if (
                this.lastTelemetrySourceSignature
                && resolvedPreReadSourceSignature === this.lastEmittedPreReadSourceSignature
              ) {
                this.logPollEvent("provider_telemetry_poll_no_new_data", {
                  nativeSessionId: resolvedNativeSessionId || this.opts.nativeSessionId || undefined,
                });
                await this.wait(1500);
                continue;
              }
            }
            antigravityTranscriptJsonl = await this.opts.readAntigravityTranscript(resolvedNativeSessionId);
            if (!this.tempDbPath) {
              const safeSession = resolvedNativeSessionId.replace(/[^A-Za-z0-9_-]/g, "_");
              this.tempDbPath = path.join(os.tmpdir(), `agy-temp-watcher-${safeSession}-${randomUUID()}.db`);
            }
            await this.opts.resolveAntigravityDatabase(resolvedNativeSessionId, this.tempDbPath);
          }
        }
        this.resolvedNativeSessionId = resolvedNativeSessionId;

        const sourceSignature = await buildTelemetrySourceSignature({
          provider: this.opts.provider,
          model: this.opts.model,
          resolvedNativeSessionId: resolvedNativeSessionId || this.opts.nativeSessionId,
          stdout,
          stderr,
          claudeSessionJsonl,
          codexSessionJson,
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
          await this.wait(1500);
          continue;
        }

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
          codexSessionJson,
          qwenReportedUsage: qwenLog?.usage ?? null,
          qwenConversation: qwenLog?.conversation ?? null,
          startTimeMs: this.opts.startedMs,
          executionMode: this.opts.workflowSettings.executionMode,
          antigravitySessionDbPath: this.tempDbPath,
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
        this.recordReadFailure(err);
      }
      await this.wait(1500);
    }
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

  private async readProviderMetadata(resolvedNativeSessionId: string | null): Promise<ProviderMetadataSignature> {
    if (this.opts.provider === "claude-code" && this.opts.nativeSessionId) {
      if (!this.opts.getClaudeSessionJsonlMetadata) {
        return { available: false };
      }
      return { available: true, signature: await this.opts.getClaudeSessionJsonlMetadata(this.opts.nativeSessionId) || "" };
    }
    if (this.opts.provider === "codex") {
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

  private recordReadFailure(err: unknown): void {
    this.readFailureCount += 1;
    if (this.shouldLogFailureWarning()) {
      this.lastFailureWarningCount = this.readFailureCount;
      this.opts.logger?.warn("Provider telemetry watcher read failed", {
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
        error: redactText(err instanceof Error ? err.message : String(err)),
      });
    }
  }

  private getTelemetryPollEventType(telemetry: ProviderUsageTelemetry): string {
    return telemetry.usageSource === "reported"
      ? "provider_telemetry_poll_succeeded"
      : "provider_telemetry_poll_partial";
  }

  private logPollEvent(eventType: string, metadata: Record<string, unknown>): void {
    this.opts.logger?.debug("Provider telemetry watcher poll", {
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
  }

  private async wait(ms: number): Promise<void> {
    if (this.opts.signal?.aborted || !this.active) {
      return;
    }
    await new Promise<void>((resolve) => {
      let timeout: NodeJS.Timeout;
      const onAbort = () => {
        clearTimeout(timeout);
        this.opts.signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      timeout = setTimeout(() => {
        this.opts.signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      this.opts.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
