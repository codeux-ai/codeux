import { describe, expect, it } from "vitest";
import { buildClaudeMcpServerEntry, buildCodexMcpServerTomlLines, buildProviderMcpConfigArtifact, escapeTomlString } from "../../../../../src/infrastructure/providers/cli/mcp-config-format.js";
import { DEFAULT_PLAYWRIGHT_MCP_SERVER } from "../../../../../src/repositories/settings-defaults.js";

describe("mcp-config-format injection prevention", () => {
  it("escapes quotes and backslashes in TOML strings to prevent structural injection", () => {
    const raw = 'test"injection"\\value';
    const escaped = escapeTomlString(raw);
    expect(escaped).toBe('test\\"injection\\"\\\\value');
  });

  it("builds Claude JSON config safely avoiding structural injection", () => {
    const server = {
      id: "test",
      name: "test-server",
      transport: "stdio" as const,
      command: "node",
      args: ['-e', 'console.log("hello")'],
      env: { "MY_ENV": "value\"with\"quotes" },
      enabled: true
    };
    const entry = buildClaudeMcpServerEntry(server);
    const jsonStr = JSON.stringify(entry);
    expect(jsonStr).toContain('"args":["-e","console.log(\\"hello\\")"]');
    expect(jsonStr).toContain('"MY_ENV":"value\\"with\\"quotes"');
  });

  it("builds Codex TOML lines safely avoiding structural injection", () => {
    const server = {
      id: "test",
      name: "test-server",
      transport: "stdio" as const,
      command: "node",
      args: ['--eval="process.exit(0)"'],
      env: { "BAD\"KEY": "BAD\"VALUE" },
      enabled: true
    };
    const lines = buildCodexMcpServerTomlLines("test-server", server);
    const tomlStr = lines.join("\n");
    expect(tomlStr).toContain('command = "node"');
    expect(tomlStr).toContain('args = ["--eval=\\"process.exit(0)\\""]');
    expect(tomlStr).toContain('"BAD\\"KEY" = "BAD\\"VALUE"');
  });

  it("renders the default Playwright MCP server as stdio provider config", () => {
    const artifact = buildProviderMcpConfigArtifact("codex", null, [DEFAULT_PLAYWRIGHT_MCP_SERVER]);

    expect(artifact?.content).toContain("[mcp_servers.playwright]");
    expect(artifact?.content).toContain('command = "npx"');
    expect(artifact?.content).toContain('args = ["@playwright/mcp@latest"]');
  });
});
