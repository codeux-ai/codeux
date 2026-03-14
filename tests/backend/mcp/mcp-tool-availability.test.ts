import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-repository.js";
import { getEnabledToolDefinitions, isToolEnabled, sanitizeMcpToolToggles } from "../../../src/mcp/mcp-tool-availability.js";

describe("tool availability", () => {
  it("filters tools by runtime role", () => {
    const projectManagerTools = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "project_manager");
    const workerHostTools = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "worker_host");
    const workerGatewayTools = getEnabledToolDefinitions(DEFAULT_DASHBOARD_SETTINGS, "worker_gateway");

    expect(projectManagerTools.some((tool) => tool.name === "listen")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "start_listen")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "pull_inbox")).toBe(true);
    expect(projectManagerTools.some((tool) => tool.name === "execute_worker_dispatch")).toBe(false);
    expect(projectManagerTools.some((tool) => tool.name === "generate_dashboard_reply")).toBe(true);
    expect(workerHostTools.some((tool) => tool.name === "execute_worker_dispatch")).toBe(true);
    expect(workerHostTools.some((tool) => tool.name === "claim_attention_item")).toBe(true);
    expect(workerHostTools.some((tool) => tool.name === "resolve_attention_item")).toBe(true);
    expect(workerHostTools.some((tool) => tool.name === "report_attention_outcome")).toBe(true);
    expect(workerHostTools.some((tool) => tool.name === "listen")).toBe(true);
    expect(workerGatewayTools.some((tool) => tool.name === "start_listen")).toBe(true);
    expect(workerGatewayTools.some((tool) => tool.name === "pull_inbox")).toBe(true);
    expect(workerGatewayTools.some((tool) => tool.name === "listen")).toBe(true);
    expect(workerGatewayTools.some((tool) => tool.name === "claim_attention_item")).toBe(true);
    expect(workerGatewayTools.some((tool) => tool.name === "resolve_attention_item")).toBe(true);
    expect(workerGatewayTools.some((tool) => tool.name === "report_attention_outcome")).toBe(true);
    expect(workerGatewayTools.some((tool) => tool.name === "update_task_dispatch")).toBe(true);
    expect(workerGatewayTools.some((tool) => tool.name === "execute_worker_dispatch")).toBe(false);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "listen", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "listen", "worker_gateway")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "claim_attention_item", "worker_host")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "claim_attention_item", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "resolve_attention_item", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "report_attention_outcome", "worker_host")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "report_attention_outcome", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "update_task_dispatch", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "update_task_dispatch", "worker_gateway")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "start_listen", "project_manager")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "execute_worker_dispatch", "project_manager")).toBe(false);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "execute_worker_dispatch", "worker_host")).toBe(true);
    expect(isToolEnabled(DEFAULT_DASHBOARD_SETTINGS, "execute_worker_dispatch", "worker_gateway")).toBe(false);
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
    expect(sanitized.find((tool) => tool.name === "pull_task_dispatch")?.enabled).toBe(true);
    expect(sanitized.some((tool) => tool.name === "unknown_tool")).toBe(false);
  });
});
