import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { createHash, randomUUID } from "crypto";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
import { createLogger, type Logger } from "../../../shared/logging/logger.js";
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
  logger?: Pick<Logger, "warn">;
}

const WATCHER_INITIAL_DELAY_MS = 1000;
const WATCHER_POLL_INTERVAL_MS = 1500;
const WATCHER_WARNING_INTERVAL_MS = 30_000;

async function abortableDelay(ms: number, signals: (AbortSignal | undefined)[]): Promise<boolean> {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.some((signal) => signal.aborted)) {
    return false;
  }

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout | null = setTimeout(() => {
      timeout = null;
      cleanup();
      resolve(true);
    }, ms);

    const abort = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      for (const signal of activeSignals) {
        signal.removeEventListener("abort", abort);
      }
    };

    for (const signal of activeSignals) {
      signal.addEventListener("abort", abort, { once: true });
    }
  });
}

function fingerprintText(value: string | null): string {
  if (!value) {
    return "empty";
  }
  return `${value.length}:${createHash("sha256").update(value).digest("hex")}`;
}

export class ProviderTelemetryWatcher {
  private active = false;
  private promise: Promise<void> | null = null;
  private tempDbPath: string | null = null;
  private stopController = new AbortController();
  private logger: Pick<Logger, "warn">;
  private lastWarningMs: number | null = null;
  private suppressedWarningCount = 0;
  private lastResolvedAntigravityDbSignature: string | null = null;
  private hasResolvedAntigravityDb = false;

  constructor(private readonly opts: TelemetryWatcherOptions) {
    this.logger = opts.logger ?? createLogger({ bindings: { component: "ProviderTelemetryWatcher" } });
  }

  start() {
    if (this.stopController.signal.aborted) {
      this.stopController = new AbortController();
    }
    this.active = true;
    this.promise = this.loop();
  }

  async stop() {
    this.active = false;
    this.stopController.abort();
    if (this.promise) {
      await this.promise.catch(() => undefined);
    }
    if (this.tempDbPath) {
      await fs.rm(this.tempDbPath, { force: true }).catch(() => undefined);
    }
  }

  private async loop() {
    const delaySignals = [this.stopController.signal, this.opts.signal];
    if (!await abortableDelay(WATCHER_INITIAL_DELAY_MS, delaySignals)) {
      return;
    }
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
            const dbSourceSignature = await this.buildAntigravityDbSourceSignature(resolvedNativeSessionId, antigravityTranscriptJsonl);
            if (!this.hasResolvedAntigravityDb || this.lastResolvedAntigravityDbSignature !== dbSourceSignature) {
              const resolvedDb = await this.opts.resolveAntigravityDatabase(resolvedNativeSessionId, this.tempDbPath);
              if (resolvedDb) {
                this.hasResolvedAntigravityDb = true;
                this.lastResolvedAntigravityDbSignature = await this.buildAntigravityDbSourceSignature(resolvedNativeSessionId, antigravityTranscriptJsonl);
              }
            }
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
        this.warnPollingError(err);
      }
      if (!await abortableDelay(WATCHER_POLL_INTERVAL_MS, delaySignals)) {
        return;
      }
    }
  }

  private async buildAntigravityDbSourceSignature(resolvedNativeSessionId: string, transcriptJsonl: string | null): Promise<string> {
    return JSON.stringify({
      nativeSessionId: resolvedNativeSessionId,
      logPath: this.opts.antigravityLogPath ?? null,
      transcript: fingerprintText(transcriptJsonl),
      stdout: fingerprintText(this.opts.getAccumulatedRawStdout()),
      stderr: fingerprintText(this.opts.getAccumulatedStderr()),
      tempDb: await this.getTempDbMetadataSignature(),
    });
  }

  private async getTempDbMetadataSignature(): Promise<string> {
    if (!this.tempDbPath) {
      return "none";
    }
    try {
      const stat = await fs.stat(this.tempDbPath);
      return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    } catch {
      return "missing";
    }
  }

  private warnPollingError(err: unknown): void {
    const now = Date.now();
    if (this.lastWarningMs !== null && now - this.lastWarningMs < WATCHER_WARNING_INTERVAL_MS) {
      this.suppressedWarningCount++;
      return;
    }

    const errorName = err instanceof Error ? err.name : typeof err;
    this.logger.warn("Provider telemetry watcher polling failed", {
      provider: this.opts.provider,
      sessionId: this.opts.sessionId,
      nativeSessionId: this.opts.nativeSessionId,
      errorName,
      suppressedPollingErrors: this.suppressedWarningCount,
      logPurpose: "invocation",
    });
    this.lastWarningMs = now;
    this.suppressedWarningCount = 0;
  }
}
