import { spawn } from "node:child_process";
import type {
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderMessageDeliveryRecord,
} from "../contracts/chat-provider-types.js";
import { redactMetadata, redactText } from "../shared/security/redaction.js";

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

const DEFAULT_TIMEOUT_MS = 15_000;

export function createDefaultChatProviderOutboundAdapter(): ChatProviderOutboundAdapter {
  return new ConfiguredChatProviderOutboundAdapter();
}

export class ConfiguredChatProviderOutboundAdapter implements ChatProviderOutboundAdapter {
  async send(context: ChatProviderOutboundAdapterContext): Promise<ChatProviderOutboundAdapterResult> {
    switch (context.connection.bridgeMode) {
      case "managed_bridge":
        return this.sendHttp(context, resolveManagedUrl(context.connection.setup), "managed_bridge");
      case "webhook":
        return this.sendHttp(context, resolveWebhookUrl(context.connection.setup), "webhook");
      case "native_bridge":
        return this.sendNative(context);
      default:
        throw new ChatProviderOutboundAdapterError("Unsupported chat provider bridge mode.", false);
    }
  }

  private async sendHttp(
    context: ChatProviderOutboundAdapterContext,
    url: string,
    mode: "managed_bridge" | "webhook",
  ): Promise<ChatProviderOutboundAdapterResult> {
    const normalizedUrl = requireHttpUrl(url, `${mode} bridge URL`);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-correlation-id": context.correlationId,
      "x-codeux-provider-kind": context.connection.providerKind,
      "x-codeux-bridge-mode": context.connection.bridgeMode,
    };
    const bearer = getFirstSecret(context.connection.secrets, [
      "bridgeApiKey",
      "bridgeToken",
      "botToken",
      "webhookSecret",
      "signingSecret",
      "botAppPassword",
    ]);
    if (bearer) {
      headers.authorization = `Bearer ${bearer}`;
    }

    let response: Response;
    try {
      response = await fetch(normalizedUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(context.payload),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ChatProviderOutboundAdapterError(
        `Failed to reach ${mode} bridge: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }

    const responseText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new ChatProviderOutboundAdapterError(
        `${mode} bridge returned HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 500)}` : ""}`,
        isRetryableHttpStatus(response.status),
        response.status,
      );
    }

    return parseAdapterResponse(responseText);
  }

  private async sendNative(context: ChatProviderOutboundAdapterContext): Promise<ChatProviderOutboundAdapterResult> {
    const command = getString(context.connection.setup.command);
    if (!command) {
      throw new ChatProviderOutboundAdapterError("Native bridge command is not configured.", false);
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    const bridgeToken = getFirstSecret(context.connection.secrets, ["bridgeToken", "botToken", "webhookSecret"]);
    if (bridgeToken) {
      env.CODEUX_CHAT_BRIDGE_TOKEN = bridgeToken;
    }
    const cwd = getString(context.connection.setup.workingDirectory) || process.cwd();

    const result = await runNativeCommand(command, JSON.stringify(context.payload), cwd, env);
    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code ?? "unknown"}`;
      throw new ChatProviderOutboundAdapterError(
        `Native bridge command failed: ${detail.slice(0, 500)}`,
        result.code !== 126 && result.code !== 127,
      );
    }

    return parseAdapterResponse(result.stdout);
  }
}

function resolveManagedUrl(setup: Record<string, unknown>): string {
  return getString(
    setup.bridgeUrl,
    setup.outboundUrl,
    setup.endpointUrl,
    setup.url,
  );
}

function resolveWebhookUrl(setup: Record<string, unknown>): string {
  return getString(
    setup.outboundWebhookUrl,
    setup.webhookUrl,
    setup.eventsUrl,
    setup.botEndpointUrl,
    setup.gatewayUrl,
    setup.bridgeUrl,
    setup.url,
  );
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

function getString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function getFirstSecret(secrets: Record<string, unknown> | null, keys: string[]): string {
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

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function parseAdapterResponse(text: string): ChatProviderOutboundAdapterResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      return {
        externalMessageId: getString(record.externalMessageId, record.messageId, record.id) || null,
        responseMetadata: redactMetadata(record) as Record<string, unknown>,
      };
    }
  } catch {
    return { responseMetadata: { raw: redactText(trimmed.slice(0, 500)) } };
  }
  return { responseMetadata: { raw: redactText(trimmed.slice(0, 500)) } };
}

function runNativeCommand(
  command: string,
  stdin: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
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
    }, DEFAULT_TIMEOUT_MS);

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
