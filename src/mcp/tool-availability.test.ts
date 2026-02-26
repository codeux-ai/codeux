import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../settings-repository.js";
import { getEnabledToolDefinitions, isToolEnabled, sanitizeMcpToolToggles } from "./tool-availability.js";

describe("tool availability", () => {
  it("enables all MCP tools by default", () => {
    const enabled = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS);
    expect(enabled.length).toBe(DEFAULT_DASHBOARD_SETTINGS.mcpTools.length);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "get_session")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "list_all_activities")).toBe(true);
  });

  it("respects disabled tools for listing and dispatch checks", () => {
    const settings = {
      ...DEFAULT_DASHBOARD_SETTINGS,
      mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) =>
        tool.name === "get_session" || tool.name === "list_all_activities"
          ? { ...tool, enabled: false }
          : tool
      ),
    };

    const names = getEnabledToolDefinitions(settings).map((tool) => tool.name);
    expect(names).not.toContain("get_session");
    expect(names).not.toContain("list_all_activities");
    expect(isToolEnabled(settings, "get_session")).toBe(false);
    expect(isToolEnabled(settings, "list_all_activities")).toBe(false);
  });

  it("sanitizes toggles and ignores unknown tool names", () => {
    const sanitized = sanitizeMcpToolToggles([
      { name: "get_session", enabled: false },
      { name: "unknown_tool", enabled: false },
      { name: " ", enabled: true },
    ]);

    expect(sanitized.find((tool) => tool.name === "get_session")?.enabled).toBe(false);
    expect(sanitized.find((tool) => tool.name === "list_all_activities")?.enabled).toBe(true);
    expect(sanitized.some((tool) => tool.name === "unknown_tool")).toBe(false);
  });
});
