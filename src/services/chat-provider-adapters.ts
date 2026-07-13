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
    if (!response.ok) {
      const classification = profile.outbound.classifyError?.(response.status, responseText);
      throw new ChatProviderOutboundAdapterError(
        classification?.message
          ?? `${context.connection.bridgeMode} bridge returned HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 500)}` : ""}`,
        classification?.retryable ?? profile.outbound.isRetryableStatus(response.status),
        response.status,
      );
    }

    return profile.outbound.parseResponse(responseText);
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
