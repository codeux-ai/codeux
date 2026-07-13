import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ChatConnectorOutboundResult } from "../../domain/chat-connectors/types.js";
import {
  buildImessageBridgeRequest,
  IMESSAGE_BRIDGE_PROTOCOL_VERSION,
  parseImessageBridgeResponse,
  type ImessageBridgeEnvelope,
} from "../../domain/chat-connectors/providers/imessage.js";
import { redactText } from "../../shared/security/redaction.js";
import { isRuntimeShutdownInProgress } from "../shutdown-state.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_STDOUT_BYTES = 256 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const FORCE_KILL_DELAY_MS = 250;
const SHUTDOWN_POLL_MS = 50;

export type ImessageBridgeDiagnosticCode =
  | "healthy"
  | "unsupported_platform"
  | "missing_executable"
  | "permission_denied"
  | "invalid_configuration"
  | "protocol_version_mismatch"
  | "correlation_mismatch"
  | "timeout"
  | "cancelled"
  | "shutdown"
  | "output_limit_exceeded"
  | "malformed_response"
  | "nonzero_exit"
  | "spawn_failed"
  | "bridge_error"
  | "network_error"
  | "http_error"
  | "provider_native_verification_unavailable";

export interface ImessageBridgeHealthResult {
  ok: boolean;
  code: ImessageBridgeDiagnosticCode;
  message: string;
  protocolVersion: string | null;
  durationMs: number;
}

export interface ImessageNativeCommandInput {
  command: string;
  workingDirectory?: string;
  bridgeToken?: string;
  correlationId: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  signal?: AbortSignal;
}

export interface ImessageNativeSendInput extends ImessageNativeCommandInput {
  request: ImessageBridgeEnvelope;
}

export interface ImessageNativeHealthInput extends ImessageNativeCommandInput {
  supportedPlatforms?: readonly NodeJS.Platform[];
}

export interface ImessageManagedHealthInput {
  url: string;
  bridgeApiKey: string;
  correlationId: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  signal?: AbortSignal;
}

interface ImessageNativeBridgeDependencies {
  platform?: NodeJS.Platform;
  fetch?: typeof fetch;
  now?: () => number;
  isShuttingDown?: () => boolean;
}

interface ActiveProcess {
  closed: Promise<void>;
  terminate(error: ImessageNativeBridgeError): void;
}

interface NativeExecutionResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export class ImessageNativeBridgeError extends Error {
  constructor(
    readonly code: Exclude<ImessageBridgeDiagnosticCode, "healthy">,
    message: string,
    readonly retryable: boolean,
  ) {
    super(redactText(message));
    this.name = "ImessageNativeBridgeError";
  }
}

export class ImessageNativeBridge {
  private readonly platform: NodeJS.Platform;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly isShuttingDown: () => boolean;
  private readonly activeProcesses = new Map<ChildProcessWithoutNullStreams, ActiveProcess>();
  private disposed = false;

  constructor(deps: ImessageNativeBridgeDependencies = {}) {
    this.platform = deps.platform ?? process.platform;
    this.fetchFn = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.isShuttingDown = deps.isShuttingDown ?? isRuntimeShutdownInProgress;
  }

  async send(input: ImessageNativeSendInput): Promise<ChatConnectorOutboundResult> {
    const execution = await this.executeNative(input);
    if (execution.code !== 0) {
      throw this.nonzeroExitError(execution, input.bridgeToken);
    }
    this.validateResponseEnvelope(execution.stdout, input.correlationId, "sent", true, input.bridgeToken);
    try {
      return redactResultSecret(parseImessageBridgeResponse(execution.stdout), input.bridgeToken);
    } catch (error) {
      throw this.responseError(error, input.bridgeToken);
    }
  }

  async verifyNative(input: ImessageNativeHealthInput): Promise<ImessageBridgeHealthResult> {
    const startedAt = this.now();
    try {
      if (input.supportedPlatforms && !input.supportedPlatforms.includes(this.platform)) {
        throw new ImessageNativeBridgeError(
          "unsupported_platform",
          `The configured local bridge does not support ${this.platform}.`,
          false,
        );
      }
      const request = buildImessageBridgeRequest("health_check", input.correlationId);
      const execution = await this.executeNative({ ...input, request });
      if (execution.code !== 0) {
        throw this.nonzeroExitError(execution, input.bridgeToken);
      }
      this.validateResponseEnvelope(execution.stdout, input.correlationId, "healthy", false, input.bridgeToken);
      return this.healthResult(true, "healthy", "The local bridge protocol health check succeeded.", startedAt);
    } catch (error) {
      return this.failedHealthResult(error, input.bridgeToken, startedAt);
    }
  }

  async verifyManaged(input: ImessageManagedHealthInput): Promise<ImessageBridgeHealthResult> {
    const startedAt = this.now();
    let url: URL;
    try {
      url = new URL(input.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new ImessageNativeBridgeError("invalid_configuration", "Managed bridge URL must use HTTP or HTTPS.", false);
      }
      if (isAppleHostname(url.hostname)) {
        throw new ImessageNativeBridgeError(
          "provider_native_verification_unavailable",
          "Apple provider-native endpoint verification is unavailable; configure a third-party bridge URL.",
          false,
        );
      }
      if (!input.bridgeApiKey.trim()) {
        throw new ImessageNativeBridgeError("invalid_configuration", "Managed bridge API key is not configured.", false);
      }
      this.assertRunnable(input.signal);

      const timeoutMs = requirePositiveLimit(input.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
      const controller = new AbortController();
      let abortCode: "timeout" | "cancelled" | "shutdown" | null = null;
      const abort = (code: typeof abortCode): void => {
        if (!controller.signal.aborted) {
          abortCode = code;
          controller.abort(code);
        }
      };
      const timeout = setTimeout(() => abort("timeout"), timeoutMs);
      const shutdownPoll = setInterval(() => {
        if (this.disposed || this.isShuttingDown()) abort("shutdown");
      }, SHUTDOWN_POLL_MS);
      const onAbort = (): void => abort("cancelled");
      input.signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const request = buildImessageBridgeRequest("health_check", input.correlationId);
        const response = await this.fetchFn(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.bridgeApiKey}`,
            "content-type": "application/json",
            "x-correlation-id": input.correlationId,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        const text = await readBoundedResponse(response, input.maxResponseBytes ?? DEFAULT_MAX_STDOUT_BYTES);
        if (!response.ok) {
          throw new ImessageNativeBridgeError(
            "http_error",
            `Managed bridge health check returned HTTP ${response.status}${text ? `: ${sanitize(text, input.bridgeApiKey).slice(0, 500)}` : ""}.`,
            response.status === 408 || response.status === 429 || response.status >= 500,
          );
        }
        this.validateResponseEnvelope(text, input.correlationId, "healthy", false, input.bridgeApiKey);
        return this.healthResult(true, "healthy", "The managed bridge protocol health check succeeded.", startedAt);
      } catch (error) {
        if (abortCode) {
          throw abortError(abortCode, timeoutMs);
        }
        if (error instanceof ImessageNativeBridgeError) throw error;
        throw new ImessageNativeBridgeError(
          "network_error",
          `Managed bridge health check failed: ${sanitize(errorMessage(error), input.bridgeApiKey)}.`,
          true,
        );
      } finally {
        clearTimeout(timeout);
        clearInterval(shutdownPoll);
        input.signal?.removeEventListener("abort", onAbort);
      }
    } catch (error) {
      return this.failedHealthResult(error, input.bridgeApiKey, startedAt);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const shutdownError = new ImessageNativeBridgeError("shutdown", "iMessage bridge execution stopped during runtime shutdown.", true);
    const active = [...this.activeProcesses.values()];
    for (const entry of active) entry.terminate(shutdownError);
    await Promise.allSettled(active.map((entry) => entry.closed));
  }

  private async executeNative(input: ImessageNativeSendInput): Promise<NativeExecutionResult> {
    this.assertRunnable(input.signal);
    const [executable, ...args] = parseImessageNativeBridgeCommand(input.command, this.platform);
    await assertExecutable(executable, this.platform);
    const timeoutMs = requirePositiveLimit(input.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
    const maxStdoutBytes = requirePositiveLimit(input.maxStdoutBytes, DEFAULT_MAX_STDOUT_BYTES, "maxStdoutBytes");
    const maxStderrBytes = requirePositiveLimit(input.maxStderrBytes, DEFAULT_MAX_STDERR_BYTES, "maxStderrBytes");
    const secret = input.bridgeToken?.trim() ?? "";

    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(executable, args, {
          cwd: input.workingDirectory || process.cwd(),
          env: bridgeEnvironment(secret),
          shell: false,
          detached: this.platform !== "win32",
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        reject(classifyImessageNativeBridgeSpawnError(error));
        return;
      }

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let terminalError: ImessageNativeBridgeError | null = null;
      let settled = false;
      let forceKillTimer: NodeJS.Timeout | null = null;

      let closeActive!: () => void;
      const closed = new Promise<void>((close) => { closeActive = close; });
      const terminate = (error: ImessageNativeBridgeError): void => {
        if (terminalError || settled) return;
        terminalError = error;
        terminateProcessTree(child, this.platform, false);
        forceKillTimer = setTimeout(() => terminateProcessTree(child, this.platform, true), FORCE_KILL_DELAY_MS);
      };
      this.activeProcesses.set(child, { closed, terminate });

      const timeout = setTimeout(
        () => terminate(new ImessageNativeBridgeError("timeout", `Native bridge command timed out after ${timeoutMs}ms.`, true)),
        timeoutMs,
      );
      const shutdownPoll = setInterval(() => {
        if (this.disposed || this.isShuttingDown()) {
          terminate(new ImessageNativeBridgeError("shutdown", "Native bridge command stopped during runtime shutdown.", true));
        }
      }, SHUTDOWN_POLL_MS);
      const onAbort = (): void => terminate(new ImessageNativeBridgeError("cancelled", "Native bridge command was cancelled.", true));
      input.signal?.addEventListener("abort", onAbort, { once: true });
      if (input.signal?.aborted) onAbort();

      const cleanup = (): void => {
        clearTimeout(timeout);
        clearInterval(shutdownPoll);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        input.signal?.removeEventListener("abort", onAbort);
        this.activeProcesses.delete(child);
        closeActive();
      };
      const finishError = (error: ImessageNativeBridgeError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > maxStdoutBytes) {
          terminate(new ImessageNativeBridgeError("output_limit_exceeded", "Native bridge stdout exceeded its configured limit.", false));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > maxStderrBytes) {
          terminate(new ImessageNativeBridgeError("output_limit_exceeded", "Native bridge stderr exceeded its configured limit.", false));
          return;
        }
        stderr.push(chunk);
      });
      child.once("error", (error) => {
        terminalError = terminalError ?? classifyImessageNativeBridgeSpawnError(error);
      });
      child.once("close", (code) => {
        if (terminalError) {
          finishError(terminalError);
          return;
        }
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
      child.stdin.once("error", () => {
        // A bridge may exit without consuming stdin; close/error handling reports the terminal result.
      });
      child.stdin.end(JSON.stringify(input.request));
    });
  }

  private validateResponseEnvelope(
    text: string,
    correlationId: string,
    expectedStatus: "sent" | "healthy",
    allowLegacySend: boolean,
    secret?: string,
  ): void {
    let value: unknown;
    try {
      value = JSON.parse(text.trim());
    } catch {
      throw new ImessageNativeBridgeError("malformed_response", "Bridge response was not valid JSON.", false);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ImessageNativeBridgeError("malformed_response", "Bridge response must be a JSON object.", false);
    }
    const record = value as Record<string, unknown>;
    if (allowLegacySend && !("protocolVersion" in record) && typeof record.externalMessageId === "string") {
      return;
    }
    const stableFields = ["correlation", "message", "chat", "sender", "reply", "result", "error"];
    if (stableFields.some((field) => !(field in record))) {
      throw new ImessageNativeBridgeError("malformed_response", "Bridge response omitted required protocol fields.", false);
    }
    if (record.protocolVersion !== IMESSAGE_BRIDGE_PROTOCOL_VERSION) {
      throw new ImessageNativeBridgeError(
        "protocol_version_mismatch",
        `Bridge protocol version ${String(record.protocolVersion ?? "missing")} is unsupported; expected ${IMESSAGE_BRIDGE_PROTOCOL_VERSION}.`,
        false,
      );
    }
    const expectedOperation = expectedStatus === "healthy" ? "health_check" : "send";
    if (record.operation !== expectedOperation) {
      throw new ImessageNativeBridgeError("malformed_response", `Bridge response operation must be ${expectedOperation}.`, false);
    }
    const correlation = asRecord(record.correlation);
    if (correlation?.id !== correlationId) {
      throw new ImessageNativeBridgeError("correlation_mismatch", "Bridge response correlation id did not match the request.", false);
    }
    const bridgeError = asRecord(record.error);
    if (bridgeError) {
      throw new ImessageNativeBridgeError(
        "bridge_error",
        `Bridge error (${String(bridgeError.code ?? "unknown")}): ${sanitize(String(bridgeError.message ?? "Unknown bridge error."), secret)}.`,
        bridgeError.retryable === true,
      );
    }
    const result = asRecord(record.result);
    if (result?.status !== expectedStatus) {
      throw new ImessageNativeBridgeError("malformed_response", `Bridge response did not contain result.status=${expectedStatus}.`, false);
    }
  }

  private responseError(error: unknown, secret?: string): ImessageNativeBridgeError {
    if (error instanceof ImessageNativeBridgeError) return error;
    const message = errorMessage(error);
    const code = /protocol version/i.test(message) ? "protocol_version_mismatch" : "malformed_response";
    return new ImessageNativeBridgeError(code, sanitize(message, secret), false);
  }

  private nonzeroExitError(result: NativeExecutionResult, secret?: string): ImessageNativeBridgeError {
    const detail = sanitize(result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? "unknown"}`, secret).slice(0, 500);
    return new ImessageNativeBridgeError(
      "nonzero_exit",
      `Native bridge command exited with code ${result.code ?? "unknown"}: ${detail}.`,
      result.code !== 126 && result.code !== 127,
    );
  }

  private assertRunnable(signal?: AbortSignal): void {
    if (this.disposed || this.isShuttingDown()) {
      throw new ImessageNativeBridgeError("shutdown", "iMessage bridge execution is unavailable during runtime shutdown.", true);
    }
    if (signal?.aborted) {
      throw new ImessageNativeBridgeError("cancelled", "iMessage bridge operation was cancelled.", true);
    }
  }

  private healthResult(
    ok: boolean,
    code: ImessageBridgeDiagnosticCode,
    message: string,
    startedAt: number,
  ): ImessageBridgeHealthResult {
    return {
      ok,
      code,
      message,
      protocolVersion: ok ? IMESSAGE_BRIDGE_PROTOCOL_VERSION : null,
      durationMs: Math.max(0, this.now() - startedAt),
    };
  }

  private failedHealthResult(error: unknown, secret: string | undefined, startedAt: number): ImessageBridgeHealthResult {
    const normalized = error instanceof ImessageNativeBridgeError
      ? error
      : new ImessageNativeBridgeError("spawn_failed", sanitize(errorMessage(error), secret), true);
    return this.healthResult(false, normalized.code, sanitize(normalized.message, secret), startedAt);
  }
}

export function parseImessageNativeBridgeCommand(command: string, platform: NodeJS.Platform = process.platform): string[] {
  if (!command.trim()) {
    throw new ImessageNativeBridgeError("invalid_configuration", "Native bridge command is not configured.", false);
  }
  if (command.includes("\0")) {
    throw new ImessageNativeBridgeError("invalid_configuration", "Native bridge command cannot contain null bytes.", false);
  }

  const argv: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  const pushCurrent = (): void => {
    if (!current) return;
    argv.push(normalizeWindowsEscapedToken(current, platform));
    current = "";
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && quote === "\"" && shouldEscape(command[index + 1], platform)) {
        current += command[index + 1] ?? "";
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
    } else if (char === "\\" && shouldEscape(command[index + 1], platform)) {
      current += command[index + 1] ?? "";
      index += 1;
    } else if (/\s/.test(char)) {
      pushCurrent();
    } else {
      current += char;
    }
  }
  if (quote) {
    throw new ImessageNativeBridgeError("invalid_configuration", "Native bridge command has an unterminated quote.", false);
  }
  pushCurrent();
  if (!argv.length) {
    throw new ImessageNativeBridgeError("invalid_configuration", "Native bridge command is not configured.", false);
  }
  return argv;
}

function normalizeWindowsEscapedToken(value: string, platform: NodeJS.Platform): string {
  return platform === "win32" && (/^[A-Za-z]:\\\\/.test(value) || /^\\\\\\\\/.test(value))
    ? value.replace(/\\\\/g, "\\")
    : value;
}

function shouldEscape(next: string | undefined, platform: NodeJS.Platform): boolean {
  if (!next) return false;
  if (platform === "win32") return next === "\"";
  return /[\s'"\\]/.test(next);
}

async function assertExecutable(executable: string, platform: NodeJS.Platform): Promise<void> {
  if (!isAbsolute(executable) && !executable.includes("/") && !executable.includes("\\")) return;
  try {
    await access(executable, platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
  } catch (error) {
    const code = asErrorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      throw new ImessageNativeBridgeError("permission_denied", `Native bridge executable is not permitted: ${executable}.`, false);
    }
    throw new ImessageNativeBridgeError("missing_executable", `Native bridge executable was not found: ${executable}.`, false);
  }
}

export function classifyImessageNativeBridgeSpawnError(error: unknown): ImessageNativeBridgeError {
  const code = asErrorCode(error);
  if (code === "ENOENT") return new ImessageNativeBridgeError("missing_executable", "Native bridge executable was not found.", false);
  if (code === "EACCES" || code === "EPERM") return new ImessageNativeBridgeError("permission_denied", "Native bridge executable is not permitted.", false);
  return new ImessageNativeBridgeError("spawn_failed", `Failed to start native bridge command: ${errorMessage(error)}.`, true);
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams, platform: NodeJS.Platform, force: boolean): void {
  if (!child.pid) return;
  if (platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => child.kill(force ? "SIGKILL" : "SIGTERM"));
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
}

function bridgeEnvironment(token: string): NodeJS.ProcessEnv {
  const allowed = [
    "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR", "PATHEXT",
    "LOCALAPPDATA", "APPDATA", "LANG", "LC_ALL", "TZ",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (token) env.CODEUX_CHAT_BRIDGE_TOKEN = token;
  return env;
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  const limit = requirePositiveLimit(maxBytes, DEFAULT_MAX_STDOUT_BYTES, "maxResponseBytes");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ImessageNativeBridgeError("output_limit_exceeded", "Managed bridge response exceeded its configured limit.", false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(concatBytes(chunks, size));
}

function concatBytes(chunks: Uint8Array[], size: number): Uint8Array {
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function abortError(code: "timeout" | "cancelled" | "shutdown", timeoutMs: number): ImessageNativeBridgeError {
  if (code === "timeout") return new ImessageNativeBridgeError("timeout", `Bridge health check timed out after ${timeoutMs}ms.`, true);
  if (code === "shutdown") return new ImessageNativeBridgeError("shutdown", "Bridge health check stopped during runtime shutdown.", true);
  return new ImessageNativeBridgeError("cancelled", "Bridge health check was cancelled.", true);
}

function requirePositiveLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new ImessageNativeBridgeError("invalid_configuration", `${name} must be a positive integer.`, false);
  }
  return resolved;
}

function isAppleHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "apple.com" || normalized.endsWith(".apple.com");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asErrorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitize(value: string, secret?: string): string {
  let sanitized = redactText(value);
  if (secret) sanitized = sanitized.split(secret).join("[REDACTED]");
  return sanitized;
}

function redactResultSecret(result: ChatConnectorOutboundResult, secret?: string): ChatConnectorOutboundResult {
  if (!secret || !result.responseMetadata) return result;
  return {
    ...result,
    responseMetadata: replaceSecret(result.responseMetadata, secret) as Record<string, unknown>,
  };
}

function replaceSecret(value: unknown, secret: string): unknown {
  if (typeof value === "string") return value.split(secret).join("[REDACTED]");
  if (Array.isArray(value)) return value.map((entry) => replaceSecret(entry, secret));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceSecret(entry, secret)]));
  }
  return value;
}
