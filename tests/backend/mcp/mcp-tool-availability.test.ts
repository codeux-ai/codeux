import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-repository.js";
import { DEFAULT_PLAYWRIGHT_MCP_SERVER_ID } from "../../../src/repositories/settings-defaults.js";
import { getEnabledToolDefinitions, isToolEnabled, sanitizeCustomMcpServers, sanitizeCustomMcpServersWithDefaults, sanitizeMcpToolToggles } from "../../../src/mcp/mcp-tool-availability.js";

describe("tool availability", () => {
  it("exposes the project-manager MCP tool surface", () => {
    const projectManagerTools = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "project_manager");

    expect(projectManagerTools.some((tool) => tool.name === "manage_code_ux")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "manage_projects")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "manage_sprints")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "manage_tasks")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "manage_quicksprints")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "manage_scheduler")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "manage_skills")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "search_skills")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "register_worker_endpoint")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "pull_task_dispatch")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "update_task_dispatch")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_code_ux", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_projects", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_sprints", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_quicksprints", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_scheduler", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_skills", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "search_skills", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "register_worker_endpoint", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "pull_task_dispatch", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "update_task_dispatch", "project_manager")).toBe(true);
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

  it("allows per-agent policy to expose skill retrieval without skill management", () => {
    const agentToggles = [
      { name: "manage_skills", enabled: false, isInternal: true },
      { name: "search_skills", enabled: true, isInternal: true },
    ];
    const names = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "project_manager", agentToggles).map((tool) => tool.name);
    expect(names).not.toContain("manage_skills");
    expect(names).toContain("search_skills");
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_skills", "project_manager", agentToggles)).toBe(false);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "search_skills", "project_manager", agentToggles)).toBe(true);
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
  it("includes the default Playwright MCP server for coding providers", () => {
    const playwright = DEFAULT_DASHBOARD_SETTINGS.customMcpServers.find((server) => server.id === DEFAULT_PLAYWRIGHT_MCP_SERVER_ID);

    expect(playwright).toMatchObject({
      id: "playwright",
      name: "playwright",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["@playwright/mcp@latest"],
      providers: ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"],
    });
  });

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
      { id: "x", name: "first", url: "https://one.example.com", enabled: true },
      { id: "x", name: "second", url: "https://two.example.com", enabled: false },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "second", url: "https://two.example.com", enabled: false });
  });

  it("returns an empty array for non-array input", () => {
    expect(sanitizeCustomMcpServers(undefined)).toEqual([]);
    expect(sanitizeCustomMcpServers(null)).toEqual([]);
    expect(sanitizeCustomMcpServers({})).toEqual([]);
  });

  it("seeds defaults without duplicating servers that match by id or name", () => {
    const byId = sanitizeCustomMcpServersWithDefaults([
      {
        id: "playwright",
        name: "playwright",
        transport: "stdio",
        command: "npx",
        args: ["@playwright/mcp@latest"],
        enabled: false,
      },
    ], DEFAULT_DASHBOARD_SETTINGS.customMcpServers);
    expect(byId.filter((server) => server.name === "playwright")).toHaveLength(1);
    expect(byId.find((server) => server.id === "playwright")?.enabled).toBe(false);

    const byName = sanitizeCustomMcpServersWithDefaults([
      {
        id: "custom-playwright",
        name: "playwright",
        transport: "stdio",
        command: "npx",
        args: ["@playwright/mcp@latest"],
        enabled: true,
      },
    ], DEFAULT_DASHBOARD_SETTINGS.customMcpServers);
    expect(byName.filter((server) => server.name === "playwright")).toHaveLength(1);
    expect(byName.find((server) => server.name === "playwright")?.id).toBe("custom-playwright");
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

  it("drops HTTP servers with invalid URLs, credentials, or non-http schemes", () => {
    const result = sanitizeCustomMcpServers([
      { id: "a", name: "cred", url: "https://user:pass@example.com", transport: "http" },
      { id: "b", name: "ftp", url: "ftp://example.com", transport: "http" },
      { id: "c", name: "control", url: "https://example.com/mc\np", transport: "http" },
      { id: "d", name: "ok", url: "http://localhost:3000/mcp", transport: "http" },
    ]);
    expect(result.map((s) => s.id)).toEqual(["d"]);
  });

  it("drops HTTP servers targeting unsafe or ambiguous network destinations", () => {
    const result = sanitizeCustomMcpServers([
      { id: "metadata", name: "metadata", url: "http://169.254.169.254/latest/meta-data", transport: "http" },
      { id: "mapped-metadata", name: "mapped_metadata", url: "http://[::ffff:169.254.169.254]/mcp", transport: "http" },
      { id: "metadata-host", name: "metadata_host", url: "http://metadata.google.internal/computeMetadata/v1", transport: "http" },
      { id: "link-local-v6", name: "link_local_v6", url: "http://[fe80::1]/mcp", transport: "http" },
      { id: "multicast-v4", name: "multicast_v4", url: "http://224.0.0.1/mcp", transport: "http" },
      { id: "multicast-v6", name: "multicast_v6", url: "http://[ff02::1]/mcp", transport: "http" },
      { id: "broadcast", name: "broadcast", url: "http://255.255.255.255/mcp", transport: "http" },
      { id: "single-number", name: "single_number", url: "http://2130706433/mcp", transport: "http" },
      { id: "hex", name: "hex", url: "http://0x7f000001/mcp", transport: "http" },
      { id: "short-ip", name: "short_ip", url: "http://127.1/mcp", transport: "http" },
      { id: "leading-zero", name: "leading_zero", url: "http://0177.0.0.1/mcp", transport: "http" },
      { id: "localhost", name: "localhost", url: "http://localhost:3000/mcp", transport: "http" },
      { id: "ipv4-loopback", name: "ipv4_loopback", url: "http://127.0.0.1:3000/mcp", transport: "http" },
      { id: "ipv6-loopback", name: "ipv6_loopback", url: "http://[::1]:3000/mcp", transport: "http" },
      { id: "mapped-loopback", name: "mapped_loopback", url: "http://[::ffff:127.0.0.1]:3000/mcp", transport: "http" },
      { id: "remote", name: "remote", url: "https://mcp.example.com/sse", transport: "http" },
    ]);

    expect(result.map((s) => s.id)).toEqual(["localhost", "ipv4-loopback", "ipv6-loopback", "mapped-loopback", "remote"]);
  });

  it("sanitizes headers to drop invalid names and control chars in values", () => {
    const result = sanitizeCustomMcpServers([
      {
        id: "srv",
        name: "test",
        url: "https://example.com",
        headers: {
          "Valid-Header": "ok",
          "Bad Header": "skip",
          "Control": "val\n",
          ["TooLongName".repeat(10)]: "skip",
        },
      },
    ]);
    expect(result[0].headers).toEqual({ "Valid-Header": "ok" });
  });

  it("drops hop-by-hop and request-smuggling-sensitive custom headers", () => {
    const result = sanitizeCustomMcpServers([
      {
        id: "srv",
        name: "test",
        url: "https://example.com",
        headers: {
          Authorization: "Bearer redacted",
          Host: "attacker.example",
          Connection: "keep-alive",
          "Transfer-Encoding": "chunked",
          "Content-Length": "5",
          TE: "trailers",
          Trailer: "X-Injected",
          Upgrade: "websocket",
          "Proxy-Authorization": "Basic redacted",
          "Proxy-Connection": "keep-alive",
          Expect: "100-continue",
          "X-Mcp-Session": "ok",
        },
      },
    ]);
    expect(result[0].headers).toEqual({ Authorization: "Bearer redacted", "X-Mcp-Session": "ok" });
  });

  it("sanitizes environment variables to drop invalid names and control chars", () => {
    const result = sanitizeCustomMcpServers([
      {
        id: "srv",
        name: "test",
        command: "node",
        env: {
          "VALID_ENV": "ok",
          "1_BAD": "skip",
          "BAD-NAME": "skip",
          "CONTROL": "val\r",
          ["TOO_LONG".repeat(10)]: "skip",
        },
      },
    ]);
    expect(result[0].env).toEqual({ "VALID_ENV": "ok" });
  });

  it("drops stdio servers with shell metacharacters in command", () => {
    const result = sanitizeCustomMcpServers([
      { id: "a", name: "shell1", command: "node; rm -rf /" },
      { id: "b", name: "shell2", command: "node & echo 1" },
      { id: "c", name: "shell3", command: "node > out.txt" },
      { id: "d", name: "shell4", command: "node `whoami`" },
      { id: "e", name: "shell5", command: "node $(whoami)" },
      { id: "f", name: "shell6", command: "no\nde" },
      { id: "g", name: "ok", command: "/usr/bin/node" },
    ]);
    expect(result.map((s) => s.id)).toEqual(["g"]);
  });

  it("drops stdio args containing control characters", () => {
    const result = sanitizeCustomMcpServers([
      {
        id: "srv",
        name: "test",
        command: "node",
        args: ["valid", "invalid\n", "valid2\r", "valid3"],
      },
    ]);
    expect(result[0].args).toEqual(["valid", "valid3"]);
  });
});
