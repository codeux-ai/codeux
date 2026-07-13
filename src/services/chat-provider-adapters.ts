import { spawn } from "node:child_process";
import type {
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderMessageDeliveryRecord,
} from "../contracts/chat-provider-types.js";
import { getChatConnectorProfileForMode } from "../domain/chat-connectors/registry.js";
import type {
  ChatConnectorCommandOutboundRequest,
  ChatConnectorHttpOutboundRequest,
  ChatConnectorProfile,
} from "../domain/chat-connectors/types.js";
import { redactText } from "../shared/security/redaction.js";

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
}

export interface ChatProviderOutboundAdapterResult {
  externalMessageId?: string | null;
  responseMetadata?: Record<string, unknown>;
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

export function createDefaultChatProviderOutboundAdapter(): ChatProviderOutboundAdapter {
  return new ConfiguredChatProviderOutboundAdapter();
}

export class ConfiguredChatProviderOutboundAdapter implements ChatProviderOutboundAdapter {
  private readonly rateLimitReadyAt = new Map<string, number>();

  async send(context: ChatProviderOutboundAdapterContext): Promise<ChatProviderOutboundAdapterResult> {
    let profile: ChatConnectorProfile;
    try {
      profile = getChatConnectorProfileForMode(context.connection.providerKind, context.connection.bridgeMode);
      const request = profile.outbound.buildRequest(context);
      return request.transport === "http"
        ? this.sendHttp(context, profile, request)
        : this.sendNative(context, profile, request);
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

    await this.waitForRateLimit(request);

    let response: Response;
    try {
      response = await fetch(normalizedUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
    } catch (error) {
      throw new ChatProviderOutboundAdapterError(
        `Failed to reach ${context.connection.bridgeMode} bridge: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }

    const responseText = await response.text().catch(() => "");
    const responseHeaders = Object.fromEntries(response.headers.entries());
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    const parsed = profile.outbound.parseResponse(responseText, {
      statusCode: response.status,
      headers: responseHeaders,
    }, context.connection.bridgeMode);
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
        profile.outbound.isRetryableStatus(response.status),
        response.status,
        retryAfterMs,
      );
    }

    return parsed;
  }

  private async waitForRateLimit(request: ChatConnectorHttpOutboundRequest): Promise<void> {
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
      await new Promise<void>((resolve) => setTimeout(resolve, readyAt - now));
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

    const env: NodeJS.ProcessEnv = { ...process.env };
    const bridgeToken = getFirstSecret(context.connection.secrets, request.tokenSecretKeys);
    if (bridgeToken) {
      env.CODEUX_CHAT_BRIDGE_TOKEN = bridgeToken;
    }
    const result = await runNativeCommand(
      request.command,
      JSON.stringify(request.body),
      request.workingDirectory,
      env,
      request.timeoutMs,
    );
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? "unknown"}`;
      throw new ChatProviderOutboundAdapterError(
        `Native bridge command failed: ${detail.slice(0, 500)}`,
        result.code !== 126 && result.code !== 127,
      );
    }

    return profile.outbound.parseResponse(result.stdout);
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

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : undefined;
}

function runNativeCommand(
  command: string,
  stdin: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
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
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new ChatProviderOutboundAdapterError("Native bridge command timed out.", true));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new ChatProviderOutboundAdapterError(`Failed to start native bridge command: ${error.message}`, true));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
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
