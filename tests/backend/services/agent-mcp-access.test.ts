import { describe, expect, it } from "vitest";
import {
  defaultAgentMcpAccess,
  defaultCodingAgentMcpAccess,
  codeUxAgentMcpAccess,
  codeUxAgentMcpAccessWithoutScheduler,
  schedulerOnlyAgentMcpAccess,
  sanitizeAgentMcpAccess,
  resolveAgentMcpRuntime,
  mergeCodeUxToolToggles,
  toAgentCodeUxToolAccess,
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
    expect(defaultAgentMcpAccess()).toEqual({ codeUxEnabled: false, codeUxToolToggles: [], linkedServerIds: [] });
  });

  it("defaults codeUxEnabled to false unless explicitly true", () => {
    expect(sanitizeAgentMcpAccess({ linkedServerIds: [] }).codeUxEnabled).toBe(false);
    expect(sanitizeAgentMcpAccess({ codeUxEnabled: false }).codeUxEnabled).toBe(false);
    expect(sanitizeAgentMcpAccess({ codeUxEnabled: true }).codeUxEnabled).toBe(true);
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

describe("agent MCP defaults", () => {
  it("keeps coding-agent custom links without implying Code UX access", () => {
    expect(defaultCodingAgentMcpAccess()).toEqual({
      codeUxEnabled: false,
      codeUxToolToggles: [],
      linkedServerIds: ["playwright"],
    });
  });

  it("builds scheduler-only Code UX access with every other built-in tool disabled", () => {
    const access = schedulerOnlyAgentMcpAccess(["playwright", "playwright", " docs "]);
    const enabledTools = access.codeUxToolToggles.filter((toggle) => toggle.enabled).map((toggle) => toggle.name);

    expect(access.codeUxEnabled).toBe(true);
    expect(enabledTools).toEqual(["scheduler_code_ux"]);
    expect(access.codeUxToolToggles.find((toggle) => toggle.name === "manage_scheduler")?.enabled).toBe(false);
    expect(access.codeUxToolToggles.find((toggle) => toggle.name === "manage_tasks")?.enabled).toBe(false);
    expect(access.codeUxToolToggles.find((toggle) => toggle.name === "manage_sprints")?.enabled).toBe(false);
    expect(access.codeUxToolToggles.find((toggle) => toggle.name === "manage_settings")?.enabled).toBe(false);
    expect(access.codeUxToolToggles.find((toggle) => toggle.name === "manage_code_ux")?.enabled).toBe(false);
    expect(access.linkedServerIds).toEqual(["playwright", "docs"]);
  });

  it("builds dashboard reply Code UX access with scheduler enabled", () => {
    const access = codeUxAgentMcpAccess(["playwright", "playwright", " docs "]);

    expect(access.codeUxEnabled).toBe(true);
    expect(access.codeUxToolToggles.every((toggle) => toggle.enabled)).toBe(true);
    expect(access.codeUxToolToggles.find((toggle) => toggle.name === "scheduler_code_ux")?.enabled).toBe(true);
    expect(access.codeUxToolToggles.find((toggle) => toggle.name === "manage_code_ux")?.enabled).toBe(true);
    expect(access.linkedServerIds).toEqual(["playwright", "docs"]);
  });

  it("builds non-dashboard Code UX defaults with scheduler disabled", () => {
    const access = codeUxAgentMcpAccessWithoutScheduler(["playwright"]);

    expect(access.codeUxEnabled).toBe(true);
    expect(access.codeUxToolToggles.find((toggle) => toggle.name === "scheduler_code_ux")?.enabled).toBe(false);
    expect(access.codeUxToolToggles.find((toggle) => toggle.name === "manage_code_ux")?.enabled).toBe(true);
  });
});

describe("resolveAgentMcpRuntime", () => {
  const conn: McpConnectionInfo = { url: "http://127.0.0.1:3000/mcp", authToken: "secret" };
  const servers = [server("1", "docs"), server("2", "search")];

  it("inherits provider-wide MCP servers when access is undefined for a non-agent run", () => {
    const result = resolveAgentMcpRuntime({ access: undefined, agentId: undefined, customMcpServers: servers, mcpConnection: conn });
    expect(result.customMcpServers).toBe(servers);
    expect(result.mcpConnection).toBe(conn);
  });

  it("defaults missing agent-scoped access to no custom servers and no code_ux", () => {
    const result = resolveAgentMcpRuntime({ access: null, agentId: "a", customMcpServers: servers, mcpConnection: conn });
    expect(result.customMcpServers).toEqual([]);
    expect(result.mcpConnection).toBeNull();
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

  it("does not resurrect linked custom servers that fail sanitization", () => {
    const result = resolveAgentMcpRuntime({
      access: { codeUxEnabled: true, codeUxToolToggles: [], linkedServerIds: ["unsafe", "safe"] },
      agentId: "agent-7",
      customMcpServers: [
        { id: "unsafe", name: "unsafe", enabled: true, transport: "http", url: "http://169.254.169.254/latest/meta-data" },
        { id: "safe", name: "safe", enabled: true, transport: "http", url: "https://mcp.example.com/sse" },
      ],
      mcpConnection: conn,
    });

    expect(result.customMcpServers.map((s) => s.id)).toEqual(["safe"]);
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

  it("disables every Code UX tool when the agent policy disables Code UX", () => {
    const merged = mergeCodeUxToolToggles(base, {
      codeUxEnabled: false,
      codeUxToolToggles: [{ name: "manage_projects", enabled: true, isInternal: true }],
    });

    expect(merged).toEqual([
      { name: "manage_tasks", enabled: false, isInternal: true },
      { name: "manage_projects", enabled: false, isInternal: true },
    ]);
  });

  it("maps agent MCP access to the router availability policy", () => {
    const access = toAgentCodeUxToolAccess({
      codeUxEnabled: true,
      codeUxToolToggles: [{ name: "manage_tasks", enabled: false, isInternal: true }],
    });

    expect(access).toEqual({
      codeUxEnabled: true,
      codeUxToolToggles: [{ name: "manage_tasks", enabled: false, isInternal: true }],
    });
  });
});
