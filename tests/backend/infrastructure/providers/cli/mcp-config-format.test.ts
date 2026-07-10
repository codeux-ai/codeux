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
    expect(artifact?.content).toContain('command = "playwright-mcp"');
    expect(artifact?.content).not.toContain("@playwright/mcp@latest");
  });

  it("serializes stdio command, args, and env without shell interpretation across provider artifacts", () => {
    const server = {
      id: "stdio",
      name: "stdio_safe",
      transport: "stdio" as const,
      command: "node",
      args: ["server.js", "--literal=one; two && three", "--json={\"ok\":true}"],
      env: { MCP_LITERAL: "one; two && three", MCP_JSON: "{\"ok\":true}" },
      enabled: true,
    };

    const claude = buildProviderMcpConfigArtifact("claude-code", null, [server]);
    const claudeJson = JSON.parse(claude?.content || "{}") as { mcpServers: Record<string, unknown> };
    expect(claudeJson.mcpServers.stdio_safe).toEqual({
      type: "stdio",
      command: "node",
      args: ["server.js", "--literal=one; two && three", "--json={\"ok\":true}"],
      env: { MCP_LITERAL: "one; two && three", MCP_JSON: "{\"ok\":true}" },
    });

    const gemini = buildProviderMcpConfigArtifact("gemini", null, [server]);
    const geminiJson = JSON.parse(gemini?.content || "{}") as { mcpServers: Record<string, unknown> };
    expect(geminiJson.mcpServers.stdio_safe).toEqual({
      command: "node",
      args: ["server.js", "--literal=one; two && three", "--json={\"ok\":true}"],
      env: { MCP_LITERAL: "one; two && three", MCP_JSON: "{\"ok\":true}" },
    });

    const qwen = buildProviderMcpConfigArtifact("qwen-code", null, [server]);
    const qwenJson = JSON.parse(qwen?.content || "{}") as { mcpServers: Record<string, unknown> };
    expect(qwenJson.mcpServers.stdio_safe).toEqual(geminiJson.mcpServers.stdio_safe);

    const antigravity = buildProviderMcpConfigArtifact("antigravity", null, [server]);
    const antigravityJson = JSON.parse(antigravity?.content || "{}") as { mcpServers: Record<string, unknown> };
    expect(antigravityJson.mcpServers.stdio_safe).toEqual({
      command: "node",
      args: ["server.js", "--literal=one; two && three", "--json={\"ok\":true}"],
      env: { MCP_LITERAL: "one; two && three", MCP_JSON: "{\"ok\":true}" },
    });

    const codex = buildProviderMcpConfigArtifact("codex", null, [server]);
    expect(codex?.content).toContain("[mcp_servers.stdio_safe]");
    expect(codex?.content).toContain('command = "node"');
    expect(codex?.content).toContain('args = ["server.js", "--literal=one; two && three", "--json={\\"ok\\":true}"]');
    expect(codex?.content).toContain('env = { "MCP_LITERAL" = "one; two && three", "MCP_JSON" = "{\\"ok\\":true}" }');
  });

  it("sanitizes custom servers before provider config generation", () => {
    const artifact = buildProviderMcpConfigArtifact("claude-code", null, [
      {
        id: "unsafe",
        name: "unsafe",
        transport: "http" as const,
        url: "http://169.254.169.254/latest/meta-data",
        enabled: true,
      },
      {
        id: "safe",
        name: "safe",
        transport: "http" as const,
        url: "https://mcp.example.com/sse",
        headers: {
          Authorization: "Bearer redacted",
          Host: "attacker.example",
          "X-Mcp-Session": "session-redacted",
        },
        enabled: true,
      },
    ]);

    const json = JSON.parse(artifact?.content || "{}") as { mcpServers: Record<string, { headers?: Record<string, string> }> };
    expect(json.mcpServers.unsafe).toBeUndefined();
    expect(json.mcpServers.safe.headers).toEqual({
      Authorization: "Bearer redacted",
      "X-Mcp-Session": "session-redacted",
    });
  });
});
