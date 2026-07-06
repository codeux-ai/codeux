/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SettingsMcpPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsMcpPanel.js";
import type { CustomMcpServer, McpToolToggle } from "../../../dashboard/src/v2/types.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: vi.fn((callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    }),
    fromTo: vi.fn(),
  },
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useGsapDurations: () => ({ feedback: { duration: 0 } }),
  useReducedMotion: () => true,
  useResolvedMotionDuration: (duration: number | string) => duration,
}));

const TestHarness = () => {
  const [customMcpServers, setCustomMcpServers] = useState<CustomMcpServer[]>([]);
  const [mcpTools, setMcpTools] = useState<McpToolToggle[]>([]);

  const systemSettings = {
    mcpTools,
    customMcpServers,
  };

  return (
    <SettingsMcpPanel
      state={{
        activeScope: "system",
        selectedProject: null,
        systemSettings,
        projectSettings: null,
        updateSystem: (updater: (current: typeof systemSettings) => typeof systemSettings) => {
          const next = updater(systemSettings);
          setMcpTools(next.mcpTools);
          setCustomMcpServers(next.customMcpServers);
        },
        updateProject: vi.fn(),
      } as any}
    />
  );
};

describe("SettingsMcpPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("guides HTTP/SSE custom server setup and keeps the generated preview accurate", () => {
    render(<TestHarness />);

    expect(screen.getByText(/exposes its built-in MCP server over stdio by default/i)).toBeInTheDocument();
    expect(screen.getByText(/MCP_HTTP_\* environment variables or --mcp-http\* flags/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add MCP server/i }));

    expect(screen.getByText("HTTP / SSE setup")).toBeInTheDocument();
    expect(screen.getByText(/Choose HTTP \/ SSE for a remote MCP server/i)).toBeInTheDocument();
    expect(screen.getByText(/Code UX injects the updated config on the next CLI run/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /HTTP \/ SSE/i })).toHaveAttribute("aria-checked", "true");

    const serverUrl = screen.getByLabelText("Server URL");
    const authHeaders = screen.getByLabelText("Auth headers JSON");
    expect(serverUrl).toBeInTheDocument();
    expect(authHeaders).toBeInTheDocument();

    fireEvent.input(screen.getByPlaceholderText("playwright"), { target: { value: "remote_docs" } });
    fireEvent.input(serverUrl, { target: { value: "https://mcp.example.test/sse" } });
    fireEvent.input(authHeaders, { target: { value: '{\n  "Authorization": "Bearer test-token"\n}' } });

    const preview = screen.getByRole("region", { name: /generated MCP configuration preview/i });
    expect(within(preview).getByText(/"remote_docs":/)).toBeInTheDocument();
    expect(within(preview).getByText(/"type": "http"/)).toBeInTheDocument();
    expect(within(preview).getByText(/"url": "https:\/\/mcp\.example\.test\/sse"/)).toBeInTheDocument();
    expect(within(preview).getByText(/"headers":/)).toBeInTheDocument();
    expect(within(preview).getByText(/"Authorization": "Bearer test-token"/)).toBeInTheDocument();
  });
});
