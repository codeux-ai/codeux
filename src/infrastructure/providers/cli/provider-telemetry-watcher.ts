import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import type { CliWorkflowSettings } from "../../../contracts/app-types.js";
import {
  collectProviderUsageTelemetry,
  type ProviderUsageTelemetry,
  type QwenUsageTotals,
  type ParsedConversationTurn,
} from "./provider-usage.js";
import type { CliProviderId } from "./provider-runner-types.js";

export interface IProviderLogReaders {
  readClaudeSessionJsonl(cwd: string, nativeSessionId: string, executionMode: CliWorkflowSettings["executionMode"]): Promise<string | null>;
  readCodexLatestSessionJson(cwd: string, executionMode: CliWorkflowSettings["executionMode"]): Promise<string | null>;
  readQwenLogData(cwd: string, executionMode: CliWorkflowSettings["executionMode"], sessionId: string, startTimeMs: number): Promise<{ usage: QwenUsageTotals | null; conversation: ParsedConversationTurn[] } | null>;
  parseAntigravityConversationId(cwd: string, logPath: string, executionMode: CliWorkflowSettings["executionMode"]): Promise<string | null>;
  readAntigravityTranscript(cwd: string, conversationId: string, executionMode: CliWorkflowSettings["executionMode"]): Promise<string | null>;
  resolveAntigravityDatabase(cwd: string, conversationId: string, executionMode: CliWorkflowSettings["executionMode"], tempDbPath: string): Promise<boolean>;
}

export interface ProviderTelemetryWatcherDependencies {
  provider: CliProviderId;
  model: string;
  prompt: string;
  cwd: string;
  sessionId: string;
  startedMs: number;
  executionMode: CliWorkflowSettings["executionMode"];
  signal?: AbortSignal;
  nativeSessionId: string | null;
  antigravityLogPath: string | null;
  getAccumulatedStdout: () => string;
  getAccumulatedStderr: () => string;
  onTelemetry: (telemetry: ProviderUsageTelemetry) => void;
  readers: IProviderLogReaders;
}

/**
 * Encapsulates the background telemetry polling loop for CLI providers.
 * Polling allows live updates of token usage and conversation transcripts while
 * the provider process is still running.
 */
export class ProviderTelemetryWatcher {
  private active = false;
  private watcherPromise: Promise<void> | null = null;
  private watcherTempDbPath: string | null = null;
  private resolvedNativeSessionId: string | null = null;
  private stopController = new AbortController();

  constructor(private readonly deps: ProviderTelemetryWatcherDependencies) {
    this.resolvedNativeSessionId = deps.nativeSessionId;
  }

  /**
   * Starts the background polling loop.
   */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.watcherPromise = this.runLoop();
  }

  /**
   * Stops the background polling loop and performs cleanup.
   * Ensures that we don't wait indefinitely if the loop is blocked.
   */
  async stop(): Promise<void> {
    this.active = false;
    this.stopController.abort();
    if (this.watcherPromise) {
      // Use a race to avoid hanging the process if the loop is somehow stuck,
      // though the abort-aware sleep should prevent this.
      await Promise.race([
        this.watcherPromise,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]).catch(() => undefined);
    }
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (this.watcherTempDbPath) {
      const dbPath = this.watcherTempDbPath;
      this.watcherTempDbPath = null;
      await fs.rm(dbPath, { force: true }).catch(() => undefined);
    }
  }

  private async runLoop(): Promise<void> {
    const { deps } = this;

    // Small initial delay to let the process spin up and start writing logs
    await this.sleep(1000);

    while (this.active && !deps.signal?.aborted) {
      try {
        let claudeSessionJsonl: string | null = null;
        let codexSessionJson: string | null = null;
        let qwenLog: { usage: QwenUsageTotals | null; conversation: ParsedConversationTurn[] } | null = null;
        let antigravityTranscriptJsonl: string | null = null;

        if (deps.provider === "claude-code" && this.resolvedNativeSessionId) {
          claudeSessionJsonl = await deps.readers.readClaudeSessionJsonl(deps.cwd, this.resolvedNativeSessionId, deps.executionMode);
        } else if (deps.provider === "codex") {
          codexSessionJson = await deps.readers.readCodexLatestSessionJson(deps.cwd, deps.executionMode);
        } else if (deps.provider === "qwen-code") {
          qwenLog = await deps.readers.readQwenLogData(deps.cwd, deps.executionMode, deps.sessionId, deps.startedMs);
        } else if (deps.provider === "antigravity") {
          if (!this.resolvedNativeSessionId && deps.antigravityLogPath) {
            this.resolvedNativeSessionId = await deps.readers.parseAntigravityConversationId(deps.cwd, deps.antigravityLogPath, deps.executionMode);
          }
          if (this.resolvedNativeSessionId) {
            antigravityTranscriptJsonl = await deps.readers.readAntigravityTranscript(deps.cwd, this.resolvedNativeSessionId, deps.executionMode);
            if (!this.watcherTempDbPath) {
              const safeSession = this.resolvedNativeSessionId.replace(/[^A-Za-z0-9_-]/g, "_");
              this.watcherTempDbPath = path.join(os.tmpdir(), `agy-temp-watcher-${safeSession}-${randomUUID()}.db`);
            }
            await deps.readers.resolveAntigravityDatabase(deps.cwd, this.resolvedNativeSessionId, deps.executionMode, this.watcherTempDbPath);
          }
        }

        const telemetry = await collectProviderUsageTelemetry({
          provider: deps.provider,
          model: deps.model,
          prompt: deps.prompt,
          cwd: deps.cwd,
          stdout: deps.getAccumulatedStdout(),
          stderr: deps.getAccumulatedStderr(),
          capturedText: "",
          nativeSessionId: this.resolvedNativeSessionId || deps.nativeSessionId,
          claudeSessionJsonl,
          codexSessionJson,
          qwenReportedUsage: qwenLog?.usage ?? null,
          qwenConversation: qwenLog?.conversation ?? null,
          startTimeMs: deps.startedMs,
          executionMode: deps.executionMode,
          antigravitySessionDbPath: this.watcherTempDbPath,
          antigravityTranscriptJsonl,
        });

        deps.onTelemetry(telemetry);
      } catch (err) {
        // Swallow background watcher errors to prevent crashing the main execution
      }

      await this.sleep(1500);
    }
  }

  private async sleep(ms: number): Promise<void> {
    const { signal } = this.deps;
    if (signal?.aborted || !this.active) return;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timeout);
        cleanup();
        resolve();
      };

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        this.stopController.signal.removeEventListener("abort", onAbort);
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      this.stopController.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

}
