import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { randomUUID } from "crypto";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
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
  onTelemetry: (telemetry: ProviderUsageTelemetry) => void;
  getAccumulatedRawStdout: () => string;
  getAccumulatedStderr: () => string;
  nativeSessionId: string | null;
  sessionId: string;
  antigravityLogPath: string | null;
  readClaudeSessionJsonl: (nativeSessionId: string) => Promise<string | null>;
  readCodexLatestSessionJson: () => Promise<string | null>;
  readQwenLogData: () => Promise<{ usage: QwenUsageTotals | null; conversation: ParsedConversationTurn[] } | null>;
  parseAntigravityConversationId: (logPath: string) => Promise<string | null>;
  readAntigravityTranscript: (resolvedSessionId: string) => Promise<string | null>;
  resolveAntigravityDatabase: (resolvedSessionId: string, destPath: string) => Promise<boolean | string | null>;
}

export class ProviderTelemetryWatcher {
  private active = false;
  private promise: Promise<void> | null = null;
  private tempDbPath: string | null = null;
  private lastTelemetrySourceSignature: string | null = null;

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
      await fs.rm(this.tempDbPath, { force: true }).catch(() => undefined);
    }
  }

  private async loop() {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    while (this.active && !this.opts.signal?.aborted) {
      try {
        let claudeSessionJsonl: string | null = null;
        let codexSessionJson: string | null = null;
        let qwenLog: { usage: QwenUsageTotals | null; conversation: ParsedConversationTurn[] } | null = null;
        let antigravityTranscriptJsonl: string | null = null;
        let resolvedNativeSessionId = this.opts.nativeSessionId;

        if (this.opts.provider === "claude-code" && this.opts.nativeSessionId) {
          claudeSessionJsonl = await this.opts.readClaudeSessionJsonl(this.opts.nativeSessionId);
        } else if (this.opts.provider === "codex") {
          codexSessionJson = await this.opts.readCodexLatestSessionJson();
        } else if (this.opts.provider === "qwen-code") {
          qwenLog = await this.opts.readQwenLogData();
        } else if (this.opts.provider === "antigravity") {
          if (!resolvedNativeSessionId && this.opts.antigravityLogPath) {
            resolvedNativeSessionId = await this.opts.parseAntigravityConversationId(this.opts.antigravityLogPath);
          }
          if (resolvedNativeSessionId) {
            antigravityTranscriptJsonl = await this.opts.readAntigravityTranscript(resolvedNativeSessionId);
            if (!this.tempDbPath) {
              const safeSession = resolvedNativeSessionId.replace(/[^A-Za-z0-9_-]/g, "_");
              this.tempDbPath = path.join(os.tmpdir(), `agy-temp-watcher-${safeSession}-${randomUUID()}.db`);
            }
            await this.opts.resolveAntigravityDatabase(resolvedNativeSessionId, this.tempDbPath);
          }
        }

        const stdout = this.opts.getAccumulatedRawStdout();
        const stderr = this.opts.getAccumulatedStderr();
        const sourceSignature = await this.buildTelemetrySourceSignature({
          resolvedNativeSessionId,
          stdout,
          stderr,
          claudeSessionJsonl,
          codexSessionJson,
          qwenLog,
          antigravityTranscriptJsonl,
        });
        if (sourceSignature === this.lastTelemetrySourceSignature) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
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
        this.lastTelemetrySourceSignature = sourceSignature;
      } catch (err) {
        // Swallow background watcher errors
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  private async buildTelemetrySourceSignature(args: {
    resolvedNativeSessionId: string | null;
    stdout: string;
    stderr: string;
    claudeSessionJsonl: string | null;
    codexSessionJson: string | null;
    qwenLog: { usage: QwenUsageTotals | null; conversation: ParsedConversationTurn[] } | null;
    antigravityTranscriptJsonl: string | null;
  }): Promise<string> {
    const parts = [
      this.opts.provider,
      this.opts.model,
      args.resolvedNativeSessionId || this.opts.nativeSessionId || "",
      this.signatureForString(args.stdout),
      this.signatureForString(args.stderr),
      this.signatureForString(args.claudeSessionJsonl || ""),
      this.signatureForString(args.codexSessionJson || ""),
      this.signatureForString(args.antigravityTranscriptJsonl || ""),
    ];

    if (args.qwenLog) {
      parts.push(this.signatureForString(JSON.stringify(args.qwenLog)));
    }

    if (this.tempDbPath) {
      const stat = await fs.stat(this.tempDbPath).catch(() => null);
      if (stat) {
        parts.push(`${stat.size}:${Math.floor(stat.mtimeMs)}`);
      }
    }

    return parts.join("|");
  }

  private signatureForString(value: string): string {
    if (!value) {
      return "0:";
    }
    if (value.length > 32768) {
      return [
        value.length,
        this.hashString(value.slice(0, 4096)),
        this.hashString(value.slice(Math.floor(value.length / 2), Math.floor(value.length / 2) + 4096)),
        this.hashString(value.slice(-16384)),
      ].join(":");
    }
    return `${value.length}:${this.hashString(value)}`;
  }

  private hashString(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
}
