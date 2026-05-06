import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-repository.js";
import { getEnabledToolDefinitions, isToolEnabled, sanitizeMcpToolToggles } from "../../../src/mcp/mcp-tool-availability.js";

describe("tool availability", () => {
  it("exposes the project-manager MCP tool surface", () => {
    const projectManagerTools = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "project_manager");

    expect(projectManagerTools.some((tool) => tool.name === "listen")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "start_listen")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "pull_inbox")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "post_listen_reply")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "generate_dashboard_reply")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "manage_code_ux")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "listen", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "start_listen", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "post_listen_reply", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "manage_code_ux", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "claim_attention_item", "project_manager" as any)).toBe(false);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "execute_worker_dispatch", "project_manager" as any)).toBe(false);
  });

  it("respects disabled tools for listing and dispatch checks", () => {
    const settings = {
      ...DEFAULT_DASHBOARD_SETTINGS,
      mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) =>
        tool.name === "start_listen" || tool.name === "pull_inbox"
          ? { ...tool, enabled: false }
          : tool
      ),
    };

    const names = getEnabledToolDefinitions(settings, "project_manager").map((tool) => tool.name);
    expect(names).not.toContain("start_listen");
    expect(names).not.toContain("pull_inbox");
    expect(isToolEnabled(settings, "start_listen", "project_manager")).toBe(false);
    expect(isToolEnabled(settings, "pull_inbox", "project_manager")).toBe(false);
  });

  it("sanitizes toggles and ignores unknown tool names", () => {
    const sanitized = sanitizeMcpToolToggles([
      { name: "listen", enabled: false },
      { name: "unknown_tool", enabled: false },
      { name: " ", enabled: true },
    ]);

    expect(sanitized.find((tool) => tool.name === "listen")?.enabled).toBe(false);
    expect(sanitized.find((tool) => tool.name === "pull_inbox")?.enabled).toBe(true);
    expect(sanitized.some((tool) => tool.name === "unknown_tool")).toBe(false);
  });
});
