import { describe, it, expect, vi } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { JulesAgentServer } from "../../src/server/jules-agent-server.js";
import { loadAppConfig } from "../../src/config/app-config.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Smoke Test", () => {
  it("should initialize JulesAgentServer and return tools without console errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Use the actual project root
    const projectRoot = path.resolve(__dirname, "../../");
    
    // Mock argv to avoid interference with the test runner
    const argv = ["node", "dist/index.js"];
    
    const appConfig = loadAppConfig(argv, projectRoot);
    
    // This should not throw the TypeError reported by the user
    const server = new JulesAgentServer({ projectRoot, appConfig });
    
    expect(server).toBeDefined();

    // Keep this strict for application console errors. Runtime entrypoints suppress
    // noisy Node SQLite experimental warnings before importing the server.
    expect(errorSpy).not.toHaveBeenCalled();

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
    expect(toolNames).toContain("listen");
    expect(toolNames).toContain("generate_dashboard_reply");
    expect(toolNames).toContain("manage_code_ux");

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
