import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-repository.js";
import { getEnabledToolDefinitions, isToolEnabled, sanitizeCustomMcpServers, sanitizeMcpToolToggles } from "../../../src/mcp/mcp-tool-availability.js";

describe("tool availability", () => {
  it("exposes the project-manager MCP tool surface", () => {
    const projectManagerTools = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "project_manager");

    expect(projectManagerTools.some((tool) => tool.name === "manage_code_ux")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "manage_projects")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "manage_sprints")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "manage_tasks")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_code_ux", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_projects", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_sprints", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "claim_attention_item", "project_manager" as any)).toBe(false);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "execute_worker_dispatch", "project_manager" as any)).toBe(false);
  });

  it("no longer exposes the deprecated listening-loop tools", () => {
    const names = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "project_manager").map((tool) => tool.name);
    for (const removed of ["listen", "start_listen", "pull_inbox", "post_listen_reply", "get_session", "generate_dashboard_reply"]) {
      expect(names).not.toContain(removed);
      expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, removed, "project_manager")).toBe(false);
    }
  });

  it("tags every tool with a category", () => {
    const tools = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "project_manager");
    const validCategories = new Set(["orchestration", "agents_memory", "platform", "advanced"]);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((tool) => validCategories.has((tool as { category: string }).category))).toBe(true);
  });

  it("respects disabled tools for listing and dispatch checks", () => {
    const settings = {
      ...DEFAULT_DASHBOARD_SETTINGS,
      mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) =>
        tool.name === "manage_preview" || tool.name === "manage_telemetry"
          ? { ...tool, enabled: false }
          : tool
      ),
    };

    const names = getEnabledToolDefinitions(settings, "project_manager").map((tool) => tool.name);
    expect(names).not.toContain("manage_preview");
    expect(names).not.toContain("manage_telemetry");
    expect(isToolEnabled(settings, "manage_preview", "project_manager")).toBe(false);
    expect(isToolEnabled(settings, "manage_telemetry", "project_manager")).toBe(false);
  });

  it("applies per-agent tool overrides over the system toggles", () => {
    const agentToggles = [{ name: "manage_tasks", enabled: false, isInternal: true }];
    const names = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "project_manager", agentToggles).map((tool) => tool.name);
    expect(names).not.toContain("manage_tasks");
    expect(names).toContain("manage_projects");
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_tasks", "project_manager", agentToggles)).toBe(false);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_projects", "project_manager", agentToggles)).toBe(true);
  });

  it("sanitizes toggles and ignores unknown tool names", () => {
    const sanitized = sanitizeMcpToolToggles([
      { name: "manage_tasks", enabled: false },
      { name: "unknown_tool", enabled: false },
      { name: " ", enabled: true },
    ]);

    expect(sanitized.find((tool) => tool.name === "manage_tasks")?.enabled).toBe(false);
    expect(sanitized.find((tool) => tool.name === "manage_projects")?.enabled).toBe(true);
    expect(sanitized.some((tool) => tool.name === "unknown_tool")).toBe(false);
  });
});

describe("sanitizeCustomMcpServers", () => {
  it("keeps valid HTTP servers and normalizes optional fields", () => {
    const result = sanitizeCustomMcpServers([
      {
        id: "srv-1",
        name: "docs",
        label: " Docs Server ",
        url: " https://example.com/mcp ",
        enabled: true,
        headers: { Authorization: "Bearer x", "": "skip", bad: 5 },
        providers: ["claude-code", "gemini", "not-a-provider"],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "srv-1",
      name: "docs",
      label: "Docs Server",
      url: "https://example.com/mcp",
      enabled: true,
      headers: { Authorization: "Bearer x" },
      providers: ["claude-code", "gemini"],
    });
  });

  it("drops entries missing id, name, or url, and rejects bad names", () => {
    const result = sanitizeCustomMcpServers([
      { id: "", name: "x", url: "https://a" },
      { id: "a", name: "", url: "https://a" },
      { id: "b", name: "ok", url: "" },
      { id: "c", name: "has space", url: "https://a" },
      { id: "d", name: "good-name", url: "https://a" },
      "not-an-object",
    ]);

    expect(result.map((server) => server.id)).toEqual(["d"]);
    expect(result[0].enabled).toBe(true);
  });

  it("dedupes by id, last entry wins", () => {
    const result = sanitizeCustomMcpServers([
      { id: "x", name: "first", url: "https://1", enabled: true },
      { id: "x", name: "second", url: "https://2", enabled: false },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "second", url: "https://2", enabled: false });
  });

  it("returns an empty array for non-array input", () => {
    expect(sanitizeCustomMcpServers(undefined)).toEqual([]);
    expect(sanitizeCustomMcpServers(null)).toEqual([]);
    expect(sanitizeCustomMcpServers({})).toEqual([]);
  });

  it("accepts stdio servers and infers transport from command when unset", () => {
    const result = sanitizeCustomMcpServers([
      { id: "p", name: "playwright", command: "npx", args: ["@playwright/mcp@latest"], env: { DEBUG: "1" } },
      { id: "h", name: "http_inferred", url: "https://x/mcp" },
    ]);
    const byId = Object.fromEntries(result.map((s) => [s.id, s]));
    expect(byId.p.transport).toBe("stdio");
    expect(byId.p.command).toBe("npx");
    expect(byId.p.args).toEqual(["@playwright/mcp@latest"]);
    expect(byId.p.env).toEqual({ DEBUG: "1" });
    expect(byId.p.url).toBeUndefined();
    expect(byId.h.transport).toBe("http");
  });

  it("drops stdio servers missing a command and http servers missing a url", () => {
    const result = sanitizeCustomMcpServers([
      { id: "a", name: "nostdio", transport: "stdio" },
      { id: "b", name: "nohttp", transport: "http" },
      { id: "c", name: "ok", transport: "stdio", command: "node" },
    ]);
    expect(result.map((s) => s.id)).toEqual(["c"]);
  });
});
