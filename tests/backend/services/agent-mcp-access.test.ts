import { describe, expect, it } from "vitest";
import {
  defaultAgentMcpAccess,
  sanitizeAgentMcpAccess,
  resolveAgentMcpRuntime,
  mergeCodeUxToolToggles,
} from "../../../src/services/agent-mcp-access.js";
import type { CustomMcpServer, McpToolToggle } from "../../../src/contracts/app-types.js";
import type { McpConnectionInfo } from "../../../src/contracts/mcp-connection-types.js";

const server = (id: string, name = id): CustomMcpServer => ({
  id, name, enabled: true, transport: "http", url: `https://${name}/mcp`,
});

describe("sanitizeAgentMcpAccess", () => {
  it("returns defaults for empty/invalid input", () => {
    expect(sanitizeAgentMcpAccess(undefined)).toEqual(defaultAgentMcpAccess());
    expect(sanitizeAgentMcpAccess(null)).toEqual(defaultAgentMcpAccess());
    expect(defaultAgentMcpAccess()).toEqual({ codeUxEnabled: true, codeUxToolToggles: [], linkedServerIds: [] });
  });

  it("defaults codeUxEnabled to true unless explicitly false", () => {
    expect(sanitizeAgentMcpAccess({ linkedServerIds: [] }).codeUxEnabled).toBe(true);
    expect(sanitizeAgentMcpAccess({ codeUxEnabled: false }).codeUxEnabled).toBe(false);
  });

  it("dedupes linked ids and drops unknown tool toggles", () => {
    const result = sanitizeAgentMcpAccess({
      codeUxEnabled: true,
      linkedServerIds: ["a", "a", " b ", "", "b"],
      codeUxToolToggles: [
        { name: "manage_tasks", enabled: false },
        { name: "bogus_tool", enabled: false },
        { name: "manage_projects", enabled: true },
      ],
    });
    expect(result.linkedServerIds).toEqual(["a", "b"]);
    expect(result.codeUxToolToggles).toEqual([
      { name: "manage_tasks", enabled: false, isInternal: true },
      { name: "manage_projects", enabled: true, isInternal: true },
    ]);
  });
});

describe("resolveAgentMcpRuntime", () => {
  const conn: McpConnectionInfo = { url: "http://127.0.0.1:3000/mcp", authToken: "secret" };
  const servers = [server("1", "docs"), server("2", "search")];

  it("inherits provider-wide MCP servers when access is undefined", () => {
    const result = resolveAgentMcpRuntime({ access: undefined, agentId: undefined, customMcpServers: servers, mcpConnection: conn });
    expect(result.customMcpServers).toBe(servers);
    expect(result.mcpConnection).toBe(conn);
  });

  it("inherits provider-wide MCP servers and still tags code_ux when access is null", () => {
    const result = resolveAgentMcpRuntime({ access: null, agentId: "a", customMcpServers: servers, mcpConnection: conn });
    expect(result.customMcpServers).toBe(servers);
    expect(result.mcpConnection).toEqual({ ...conn, agentId: "a" });
  });

  it("narrows custom servers to linked ids and attaches the agent id to code_ux", () => {
    const result = resolveAgentMcpRuntime({
      access: { codeUxEnabled: true, codeUxToolToggles: [], linkedServerIds: ["2"] },
      agentId: "agent-7",
      customMcpServers: servers,
      mcpConnection: conn,
    });
    expect(result.customMcpServers.map((s) => s.id)).toEqual(["2"]);
    expect(result.mcpConnection).toEqual({ ...conn, agentId: "agent-7" });
  });

  it("drops code_ux when disabled and yields no custom servers for empty links", () => {
    const result = resolveAgentMcpRuntime({
      access: { codeUxEnabled: false, codeUxToolToggles: [], linkedServerIds: [] },
      agentId: "agent-7",
      customMcpServers: servers,
      mcpConnection: conn,
    });
    expect(result.customMcpServers).toEqual([]);
    expect(result.mcpConnection).toBeNull();
  });

});

describe("mergeCodeUxToolToggles", () => {
  const base: McpToolToggle[] = [
    { name: "manage_tasks", enabled: true, isInternal: true },
    { name: "manage_projects", enabled: true, isInternal: true },
  ];

  it("returns base when there are no agent overrides", () => {
    expect(mergeCodeUxToolToggles(base, null)).toBe(base);
    expect(mergeCodeUxToolToggles(base, [])).toBe(base);
  });

  it("overrides matching tool entries", () => {
    const merged = mergeCodeUxToolToggles(base, [{ name: "manage_tasks", enabled: false, isInternal: true }]);
    expect(merged.find((t) => t.name === "manage_tasks")?.enabled).toBe(false);
    expect(merged.find((t) => t.name === "manage_projects")?.enabled).toBe(true);
  });
});
