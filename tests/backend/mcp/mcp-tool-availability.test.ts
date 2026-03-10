import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-repository.js";
import { getEnabledToolDefinitions, isToolEnabled, sanitizeMcpToolToggles } from "../../../src/mcp/mcp-tool-availability.js";

describe("tool availability", () => {
  it("filters tools by runtime role", () => {
    const projectManagerTools = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "project_manager");
    const workerHostTools = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "worker_host");

    expect(projectManagerTools.some((tool) => tool.name === "sprint_agent")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "execute_worker_dispatch")).toBe(false);
    expect(workerHostTools.some((tool) => tool.name === "execute_worker_dispatch")).toBe(true);
    expect(workerHostTools.some((tool) => tool.name === "sprint_agent")).toBe(false);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "get_session", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "get_session", "worker_host")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "execute_worker_dispatch", "project_manager")).toBe(false);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "execute_worker_dispatch", "worker_host")).toBe(true);
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

    const names = getEnabledToolDefinitions(settings, "project_manager").map((tool) => tool.name);
    expect(names).not.toContain("get_session");
    expect(names).not.toContain("list_all_activities");
    expect(isToolEnabled(settings, "get_session", "project_manager")).toBe(false);
    expect(isToolEnabled(settings, "list_all_activities", "project_manager")).toBe(false);
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
