/** @vitest-environment jsdom */
import { h } from "preact";
import { cleanup, render, fireEvent, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentMcpManagePanel } from "../AgentMcpManageModal.js";
import type { AgentMcpAccessConfig, CustomMcpServer } from "../../../types.js";

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
});
