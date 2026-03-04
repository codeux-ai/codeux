import { describe, it, expect, vi } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { JulesAgentServer } from "../../src/server/jules-agent-server.js";
import { loadAppConfig } from "../../src/config/app-config.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Smoke Test", () => {
  it("should initialize JulesAgentServer and return tools", async () => {
    // Use the actual project root
    const projectRoot = path.resolve(__dirname, "../../");
    
    // Mock argv to avoid interference with the test runner
    const argv = ["node", "dist/index.js"];
    
    const appConfig = loadAppConfig(argv, projectRoot);
    
    // This should not throw the TypeError reported by the user
    const server = new JulesAgentServer({ projectRoot, appConfig });
    
    expect(server).toBeDefined();

    // Verify tools are registered and can be listed
    // We access the private mcp server via cast to any for smoke testing
    const mcpServer = (server as any).server;
    expect(mcpServer).toBeDefined();

    const handlers = (mcpServer as any)._requestHandlers;
    const listToolsHandler = handlers.get("tools/list");
    expect(listToolsHandler).toBeDefined();

    const result = await listToolsHandler({ method: "tools/list" });
    expect(result.tools).toBeDefined();
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBeGreaterThan(0);
    
    // Check for some expected tools
    const toolNames = result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("sprint_agent");
    expect(toolNames).toContain("task_agent");
  });
});
