import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Logger } from "../../shared/logging/logger.js";

export interface BootMcpTransportDeps {
  server: Server;
  logger: Logger;
  isJulesApiConfigured: () => boolean;
  getMissingJulesApiKeyInstruction: () => string;
}

export async function bootMcpTransport(deps: BootMcpTransportDeps): Promise<void> {
  if (!deps.isJulesApiConfigured()) {
    deps.logger.warn("Jules API key is not set. Jules-native tools are disabled; Gemini/Codex CLI providers can still run.");
    deps.logger.warn(deps.getMissingJulesApiKeyInstruction());
  }

  const transport = new StdioServerTransport();
  await deps.server.connect(transport);
  deps.logger.info("Jules Subagents MCP server running on stdio", { version: "1.2.0" });
}
