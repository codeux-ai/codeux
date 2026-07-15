import { spawn } from "node:child_process";
import type {
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderMessageDeliveryRecord,
} from "../contracts/chat-provider-types.js";
import {
  CHAT_CONNECTOR_REGISTRY,
  type ChatConnectorRegistry,
} from "../domain/chat-connectors/registry.js";
import type {
  ChatConnectorCommandOutboundRequest,
  ChatConnectorHttpOutboundRequest,
  ChatConnectorProfile,
} from "../domain/chat-connectors/types.js";
import type { ImessageBridgeEnvelope } from "../domain/chat-connectors/providers/imessage.js";
import { ChatConnectorOutboundResponseError } from "../domain/chat-connectors/types.js";
import { redactText } from "../shared/security/redaction.js";
import {
  ImessageNativeBridge,
  ImessageNativeBridgeError,
} from "./chat-providers/imessage-native-bridge.js";

export interface ChatProviderOutboundBridgePayload {
  providerKind: string;
  providerConnectionId: string;
  channelId: string;
  threadId: string;
  conversationMessageId: string;
  replyText: string;
  replyToExternalMessageId: string | null;
  metadata: Record<string, unknown>;
}

export interface ChatProviderOutboundAdapterContext {
  connection: ChatProviderConnectionInternalRecord;
  binding: ChatProviderChannelBindingRecord;
  delivery: ChatProviderMessageDeliveryRecord;
  payload: ChatProviderOutboundBridgePayload;
  correlationId: string;
  signal?: AbortSignal;
}

export interface ChatProviderOutboundAdapterResult {
  externalMessageId?: string | null;
  responseMetadata?: Record<string, unknown>;
  failure?: {
    message: string;
    retryable: boolean;
  };
}

export interface ChatProviderOutboundAdapter {
  send(context: ChatProviderOutboundAdapterContext): Promise<ChatProviderOutboundAdapterResult>;
}

export class ChatProviderOutboundAdapterError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly statusCode?: number,
    readonly retryAfterMs?: number,
    readonly outcome: "rejected" | "ambiguous" | "cancelled" = "rejected",
  ) {
    super(redactText(message));
    this.name = "ChatProviderOutboundAdapterError";
  }
}

interface NativeCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function createDefaultChatProviderOutboundAdapter(
  registry: ChatConnectorRegistry = CHAT_CONNECTOR_REGISTRY,
): ChatProviderOutboundAdapter {
  return new ConfiguredChatProviderOutboundAdapter(registry);
}

export class ConfiguredChatProviderOutboundAdapter implements ChatProviderOutboundAdapter {
  private readonly imessageNativeBridge = new ImessageNativeBridge();
  private readonly rateLimitReadyAt = new Map<string, number>();

  constructor(private readonly registry: ChatConnectorRegistry = CHAT_CONNECTOR_REGISTRY) {}

  async send(context: ChatProviderOutboundAdapterContext): Promise<ChatProviderOutboundAdapterResult> {
    let profile: ChatConnectorProfile;
    try {
      profile = this.registry.getForMode(context.connection.providerKind, context.connection.bridgeMode);
      const request = profile.outbound.buildRequest(context);
      return request.transport === "http"
        ? await this.sendHttp(context, profile, request)
        : await this.sendNative(context, profile, request);
    } catch (error) {
      if (error instanceof ChatProviderOutboundAdapterError) {
        throw error;
      }
      throw new ChatProviderOutboundAdapterError(
        error instanceof Error ? error.message : "Unsupported chat provider bridge mode.",
        false,
      );
    }
  }

  private async sendHttp(
    context: ChatProviderOutboundAdapterContext,
    profile: ChatConnectorProfile,
    request: ChatConnectorHttpOutboundRequest,
  ): Promise<ChatProviderOutboundAdapterResult> {
    const normalizedUrl = requireHttpUrl(request.url, request.label);
    const headers = { ...request.headers };
    const bearer = getFirstSecret(context.connection.secrets, request.bearerSecretKeys);
    if (bearer) {
      headers.authorization = `Bearer ${bearer}`;
    }

    await this.waitForRateLimit(request, context.signal);

    let response: Response;
    try {
      const timeoutSignal = AbortSignal.timeout(request.timeoutMs);
      response = await fetch(normalizedUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(request.body),
        signal: context.signal ? AbortSignal.any([context.signal, timeoutSignal]) : timeoutSignal,
      });
    } catch (error) {
      if (context.signal?.aborted) {
        throw new ChatProviderOutboundAdapterError("Outbound delivery was cancelled.", false, undefined, undefined, "cancelled");
      }
      const ambiguous = profile.outbound.ambiguousTransportFailureModes?.includes(context.connection.bridgeMode) === true;
      throw new ChatProviderOutboundAdapterError(
        ambiguous
          ? "The provider send did not return a response; delivery status is unknown."
          : `Failed to reach ${context.connection.bridgeMode} bridge: ${error instanceof Error ? error.message : String(error)}`,
        !ambiguous,
        undefined,
        undefined,
        ambiguous ? "ambiguous" : "rejected",
      );
    }

    const responseText = await response.text().catch(() => "");
    const responseContext = {
      bridgeMode: context.connection.bridgeMode,
      mode: context.connection.bridgeMode,
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      correlationId: context.correlationId,
    } as const;
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    const classification = profile.outbound.classifyError?.(
      response.status,
      responseText,
      responseContext,
    );
    if (classification) {
      throw new ChatProviderOutboundAdapterError(
        classification.message,
        classification.retryable,
        response.status,
        retryAfterMs,
      );
    }

    let parsed: ChatProviderOutboundAdapterResult;
    try {
      parsed = profile.outbound.parseResponse(responseText, responseContext);
    } catch (error) {
      if (error instanceof ChatConnectorOutboundResponseError) {
        throw new ChatProviderOutboundAdapterError(
          error.message,
          error.retryable,
          error.statusCode ?? response.status,
          Math.max(error.retryAfterMs ?? 0, retryAfterMs ?? 0) || undefined,
        );
      }
      throw error;
    }
    if (parsed.failure) {
      throw new ChatProviderOutboundAdapterError(
        parsed.failure.message,
        parsed.failure.retryable || profile.outbound.isRetryableStatus(response.status),
        response.status,
        retryAfterMs,
      );
    }
    if (!response.ok) {
      throw new ChatProviderOutboundAdapterError(
        `${context.connection.bridgeMode} bridge returned HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 500)}` : ""}`,
        profile.outbound.isRetryableStatus(response.status, context.connection.bridgeMode),
        response.status,
        retryAfterMs,
      );
    }

    return parsed;
  }

  private async waitForRateLimit(request: ChatConnectorHttpOutboundRequest, signal?: AbortSignal): Promise<void> {
    if (!request.rateLimit || request.rateLimit.minimumIntervalMs <= 0) {
      return;
    }
    const now = Date.now();
    const readyAt = Math.max(now, this.rateLimitReadyAt.get(request.rateLimit.key) ?? now);
    this.rateLimitReadyAt.set(request.rateLimit.key, readyAt + request.rateLimit.minimumIntervalMs);
    if (this.rateLimitReadyAt.size > 2_000) {
      const oldest = this.rateLimitReadyAt.keys().next().value as string | undefined;
      if (oldest) {
        this.rateLimitReadyAt.delete(oldest);
      }
    }
    if (readyAt > now) {
      await waitWithSignal(readyAt - now, signal);
    }
  }

  private async sendNative(
    context: ChatProviderOutboundAdapterContext,
    profile: ChatConnectorProfile,
    request: ChatConnectorCommandOutboundRequest,
  ): Promise<ChatProviderOutboundAdapterResult> {
    if (!request.command) {
      throw new ChatProviderOutboundAdapterError("Native bridge command is not configured.", false);
    }

    const bridgeToken = getFirstSecret(context.connection.secrets, request.tokenSecretKeys);
    if (request.protocol === "imessage_bridge") {
      try {
        return await this.imessageNativeBridge.send({
          command: request.command,
          workingDirectory: request.workingDirectory,
          bridgeToken,
          correlationId: context.correlationId,
          request: request.body as ImessageBridgeEnvelope,
          timeoutMs: request.timeoutMs,
          signal: context.signal,
        });
      } catch (error) {
        if (error instanceof ImessageNativeBridgeError) {
          throw new ChatProviderOutboundAdapterError(error.message, error.retryable);
        }
        throw error;
      }
    }
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (bridgeToken) {
      env.CODEUX_CHAT_BRIDGE_TOKEN = bridgeToken;
    }
    const result = await runNativeCommand(
      request.command,
      JSON.stringify(request.body),
      request.workingDirectory,
      env,
      request.timeoutMs,
      context.signal,
    );
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? "unknown"}`;
      throw new ChatProviderOutboundAdapterError(
        `Native bridge command failed: ${detail.slice(0, 500)}`,
        result.code !== 126 && result.code !== 127,
      );
    }

    return profile.outbound.parseResponse(result.stdout, {
      bridgeMode: context.connection.bridgeMode,
      mode: context.connection.bridgeMode,
      statusCode: 200,
      headers: {},
    });
  }
}

function requireHttpUrl(value: string, label: string): string {
  if (!value) {
    throw new ChatProviderOutboundAdapterError(`${label} is not configured.`, false);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("URL must use http or https.");
    }
    return url.toString();
  } catch (error) {
    throw new ChatProviderOutboundAdapterError(
      `${label} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      false,
    );
  }
}

function getFirstSecret(secrets: Record<string, unknown> | null, keys: readonly string[]): string {
  if (!secrets) {
    return "";
  }
  for (const key of keys) {
    const value = secrets[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMs) : undefined;
}

function runNativeCommand(
  command: string,
  stdin: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<NativeCommandResult> {
  const [spawnCommand, ...spawnArgs] = splitCommandLine(command);
  return new Promise((resolve, reject) => {
    const child = spawn(spawnCommand, spawnArgs, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => {
      child.kill("SIGTERM");
      finish(() => reject(new ChatProviderOutboundAdapterError("Native bridge command was cancelled.", false, undefined, undefined, "cancelled")));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new ChatProviderOutboundAdapterError("Native bridge command timed out.", true)));
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish(() => reject(new ChatProviderOutboundAdapterError(`Failed to start native bridge command: ${error.message}`, true)));
    });
    child.on("close", (code) => {
      finish(() => resolve({ code, stdout, stderr }));
    });
    child.stdin.end(stdin);
  });
}

function waitWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new ChatProviderOutboundAdapterError("Outbound delivery was cancelled.", false, undefined, undefined, "cancelled"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new ChatProviderOutboundAdapterError("Outbound delivery was cancelled.", false, undefined, undefined, "cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function splitCommandLine(command: string): string[] {
  const argv: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of command.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        argv.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += "\\";
  }
  if (quote) {
    throw new ChatProviderOutboundAdapterError("Native bridge command has an unterminated quote.", false);
  }
  if (current.length > 0) {
    argv.push(current);
  }
  if (argv.length === 0) {
    throw new ChatProviderOutboundAdapterError("Native bridge command is not configured.", false);
  }
  return argv;
}
