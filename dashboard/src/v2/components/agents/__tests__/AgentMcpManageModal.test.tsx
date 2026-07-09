/** @vitest-environment jsdom */
import { h } from "preact";
import { cleanup, render, fireEvent, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentMcpManagePanel } from "../AgentMcpManageModal.js";
import type { AgentMcpAccessConfig, CustomMcpServer } from "../../../types.js";
import { TOOL_DEFINITIONS } from "../../../../../../src/contracts/mcp-tool-definitions.js";
import { codeUxAgentMcpAccess, schedulerOnlyAgentMcpAccess } from "../../../lib/agent-mcp-display.js";

vi.mock("gsap", () => ({
  default: {
    set: vi.fn(),
    to: vi.fn(),
  },
}));

const value: AgentMcpAccessConfig = {
  codeUxEnabled: true,
  codeUxToolToggles: [],
  linkedServerIds: [],
};

const servers: CustomMcpServer[] = [
  {
    id: "server_enabled",
    name: "enabled-server",
    label: "Enabled Server",
    enabled: true,
    transport: "stdio",
    command: "enabled",
  },
  {
    id: "server_disabled",
    name: "disabled-server",
    label: "Disabled Server",
    enabled: false,
    transport: "stdio",
    command: "disabled",
  },
];

describe("AgentMcpManagePanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("shows pending feedback, disabled server reasons, and selected labels", () => {
    const onChange = vi.fn();
    render(
      <AgentMcpManagePanel
        value={value}
        onChange={onChange}
        onClose={vi.fn()}
        availableServers={servers}
      />
    );

    expect(screen.getByText("MCP access changes are pending until the agent is saved.")).toBeInTheDocument();
    expect(screen.getByText("Disabled Server")).toBeInTheDocument();
    expect(screen.getAllByText("Disabled").length).toBeGreaterThan(0);

    const disabledServerToggle = screen.getByRole("switch", { name: "Link Disabled Server" });
    expect(disabledServerToggle).toBeDisabled();

    fireEvent.click(screen.getByRole("switch", { name: "Link Enabled Server" }));
    expect(screen.getByText("Enabled Server linked. Save Agent to persist MCP server access.")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ linkedServerIds: ["server_enabled"] }));
  });

  test("starts from default-deny and enables non-dashboard Code UX access with scheduler off", () => {
    const onChange = vi.fn();
    render(
      <AgentMcpManagePanel
        value={{ codeUxEnabled: false, codeUxToolToggles: [], linkedServerIds: ["server_enabled"] }}
        onChange={onChange}
        onClose={vi.fn()}
        availableServers={servers}
      />
    );

    expect(screen.getByText("Disabled for this agent")).toBeInTheDocument();
    expect(screen.getByText(/Code UX built-in tools are disabled by default/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Enable Code UX for this agent" }));

    const next = onChange.mock.calls[0]?.[0] as AgentMcpAccessConfig;
    expect(next.codeUxEnabled).toBe(true);
    expect(next.linkedServerIds).toEqual(["server_enabled"]);
    expect(next.codeUxToolToggles).toHaveLength(TOOL_DEFINITIONS.length);
    expect(next.codeUxToolToggles.find((toggle) => toggle.name === "scheduler_code_ux")).toMatchObject({ enabled: false });
    expect(next.codeUxToolToggles.find((toggle) => toggle.name === "manage_scheduler")).toMatchObject({ enabled: true });
    expect(next.codeUxToolToggles.find((toggle) => toggle.name === "manage_code_ux")).toMatchObject({ enabled: true });
  });

  test("enables dashboard reply Code UX access with scheduler on", () => {
    const onChange = vi.fn();
    render(
      <AgentMcpManagePanel
        value={{ codeUxEnabled: false, codeUxToolToggles: [], linkedServerIds: [] }}
        onChange={onChange}
        onClose={vi.fn()}
        availableServers={servers}
        isDashboardReplyAgent
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: "Enable Code UX for this agent" }));

    expect(onChange).toHaveBeenCalledWith(codeUxAgentMcpAccess());
    expect(screen.getByText(/Code UX MCP and scheduler enabled for dashboard chat/i)).toBeInTheDocument();
  });

  test("warns when scheduler-only access is active for a non-chat agent", () => {
    render(
      <AgentMcpManagePanel
        value={schedulerOnlyAgentMcpAccess()}
        onChange={vi.fn()}
        onClose={vi.fn()}
        availableServers={servers}
      />
    );

    expect(screen.getByText(/Scheduler-only is active for a non-chat agent/i)).toBeInTheDocument();
  });
});
