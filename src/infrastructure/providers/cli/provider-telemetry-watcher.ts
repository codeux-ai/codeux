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

        const telemetry = await collectProviderUsageTelemetry({
          provider: this.opts.provider,
          model: this.opts.model,
          prompt: this.opts.prompt,
          cwd: this.opts.cwd,
          stdout: this.opts.getAccumulatedRawStdout(),
          stderr: this.opts.getAccumulatedStderr(),
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
      } catch (err) {
        // Swallow background watcher errors
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}
