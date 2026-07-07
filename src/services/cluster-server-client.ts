import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  ClusterManageSettingsCallResult,
  ClusterToolCallResult,
  ClusterToolListResult,
} from "../contracts/cluster-types.js";
import type { ManageSettingsArgs } from "../contracts/internal-management-types.js";
import type { Logger } from "../shared/logging/logger.js";
import { redactText } from "../shared/security/redaction.js";

export interface ClusterServerClientOptions {
  remoteUrl: string;
  bearerToken: string;
  logger?: Logger;
  clientFactory?: () => Pick<Client, "connect" | "request">;
  transportFactory?: (url: URL, bearerToken: string) => StreamableHTTPClientTransport;
}

export class ClusterServerClient {
  private readonly remoteUrl: URL;
  private readonly bearerToken: string;
  private readonly logger?: Logger;
  private readonly client: Pick<Client, "connect" | "request">;
  private readonly transport: StreamableHTTPClientTransport;
  private connected = false;

  constructor(options: ClusterServerClientOptions) {
    this.remoteUrl = new URL(options.remoteUrl);
    this.bearerToken = options.bearerToken;
    this.logger = options.logger;
    this.transport = options.transportFactory
      ? options.transportFactory(this.remoteUrl, this.bearerToken)
      : new StreamableHTTPClientTransport(this.remoteUrl, {
          requestInit: {
            headers: {
              Authorization: `Bearer ${this.bearerToken}`,
            },
          },
        });
    this.client = options.clientFactory
      ? options.clientFactory()
      : new Client({ name: "code-ux-cluster-settings-sync", version: "1.0.0" });
  }

  async listTools(): Promise<ClusterToolListResult> {
    await this.ensureConnected();
    const result = await this.client.request({
      method: "tools/list",
      params: {},
    }, ListToolsResultSchema) as ClusterToolListResult;
    return result;
  }

  async callManageSettings(args: ManageSettingsArgs): Promise<ClusterManageSettingsCallResult> {
    const raw = await this.callTool("manage_settings", args as unknown as Record<string, unknown>);
    if (raw.isError) {
      throw new Error(this.sanitize(`Remote manage_settings returned an MCP tool error: ${JSON.stringify(raw)}`));
    }

    const envelope = this.parseManagementEnvelope(raw);
    return { envelope, raw };
  }

  async close(): Promise<void> {
    const maybeClose = this.transport as StreamableHTTPClientTransport & { close?: () => Promise<void> | void };
    await maybeClose.close?.();
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<ClusterToolCallResult> {
    await this.ensureConnected();
    const result = await this.client.request({
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    }, CallToolResultSchema) as ClusterToolCallResult;
    return result;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.logger?.debug("Connecting to remote Code UX MCP server.", {
      logPurpose: "mcp",
      remoteUrl: this.remoteUrl.toString(),
      authorization: "Bearer [REDACTED]",
    });
    await this.client.connect(this.transport);
    this.connected = true;
  }

  private parseManagementEnvelope(raw: ClusterToolCallResult): ClusterManageSettingsCallResult["envelope"] {
    const textContent = raw.content?.find((entry) => entry.type === "text" && typeof entry.text === "string");
    if (textContent?.text) {
      try {
        const parsed = JSON.parse(textContent.text);
        if (parsed && typeof parsed === "object") {
          return parsed as ClusterManageSettingsCallResult["envelope"];
        }
      } catch (error) {
        throw new Error(this.sanitize(`Remote manage_settings returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    if (raw.structuredContent && typeof raw.structuredContent === "object") {
      return raw.structuredContent as ClusterManageSettingsCallResult["envelope"];
    }

    throw new Error(this.sanitize(`Remote manage_settings returned no management envelope: ${JSON.stringify(raw)}`));
  }

  private sanitize(value: string): string {
    return redactText(value).split(this.bearerToken).join("[REDACTED]");
  }
}
