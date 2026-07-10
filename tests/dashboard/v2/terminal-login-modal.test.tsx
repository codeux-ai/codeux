/** @vitest-environment happy-dom */
import { h } from "preact";
import { act } from "preact/test-utils";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loginSessionMock = vi.hoisted(() => ({
  args: null as null | {
    onSessionMessage: (message: { type: string; data?: string }) => void;
  },
  websocket: {
    readyState: 1,
    send: vi.fn(),
  },
}));

vi.mock("../../../dashboard/src/v2/hooks/useInteractiveLoginSession.js", () => ({
  useInteractiveLoginSession: (args: typeof loginSessionMock.args) => {
    loginSessionMock.args = args;
    return {
      status: "active",
      sessionId: "session-login",
      websocket: loginSessionMock.websocket,
      closeSession: vi.fn(),
    };
  },
}));

import { TerminalLoginModal } from "../../../dashboard/src/v2/components/settings/TerminalLoginModal.js";

describe("TerminalLoginModal", () => {
  beforeEach(() => {
    loginSessionMock.args = null;
    loginSessionMock.websocket.send.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue("antigravity-device-code") },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps Antigravity terminal focus while right-click paste sends clipboard text", async () => {
    render(
      <TerminalLoginModal
        providerConfigId="antigravity-primary"
        providerId="antigravity"
        providerName="Antigravity"
        onClose={vi.fn()}
      />,
    );

    const terminal = screen.getByRole("log", { name: "Antigravity terminal login output for antigravity-primary" });
    const input = screen.getByLabelText("Antigravity terminal input for antigravity-primary");
    fireEvent.click(terminal);
    expect(document.activeElement).toBe(input);

    fireEvent.contextMenu(terminal, { clientX: 120, clientY: 180 });
    expect(document.activeElement).toBe(input);

    const pasteAction = screen.getByRole("menuitem", { name: "Paste clipboard text" });
    fireEvent.mouseDown(pasteAction);
    expect(document.activeElement).toBe(input);
    fireEvent.click(pasteAction);

    await waitFor(() => {
      expect(loginSessionMock.websocket.send).toHaveBeenCalledWith(JSON.stringify({
        type: "input",
        data: "antigravity-device-code",
      }));
    });
    expect(document.activeElement).toBe(input);
    expect(screen.getByText("Clipboard text pasted into the active terminal session.")).toBeDefined();
  });

  it("renders Qwen OSC output as one clean high-contrast terminal screen", () => {
    render(
      <TerminalLoginModal
        providerConfigId="qwen-primary"
        providerId="qwen-code"
        providerName="Qwen Code"
        onClose={vi.fn()}
      />,
    );

    act(() => {
      loginSessionMock.args?.onSessionMessage({ type: "output", data: "\x1b]11;?\x07\x1b]0;Qw" });
      loginSessionMock.args?.onSessionMessage({
        type: "output",
        data: "en\x07\x1b]2;Qwen\x1b\\\x1b[2J\x1b[H╭──────────────╮\r\n│ Qwen sign in │\r\n╰──────────────╯",
      });
    });

    const output = screen.getByTestId("terminal-login-output");
    expect(output.textContent).toBe("╭──────────────╮\n│ Qwen sign in │\n╰──────────────╯");
    expect(output.textContent).not.toMatch(/\]11;\?|\]0;Qwen|\]2;Qwen/u);
    expect(output.className).toContain("text-white");
    expect(output.className).toContain("whitespace-pre");

    const terminal = screen.getByRole("log", { name: "Qwen Code terminal login output for qwen-primary" });
    expect(terminal.className).toContain("bg-black/80");
    expect(terminal.className).toContain("focus-within:ring-2");
  });

  it("keeps keyboard and ordinary pasted input working for another provider", async () => {
    render(
      <TerminalLoginModal
        providerConfigId="codex-primary"
        providerId="codex"
        providerName="Codex"
        onClose={vi.fn()}
      />,
    );

    const terminal = screen.getByRole("log", { name: "Codex terminal login output for codex-primary" });
    const input = screen.getByLabelText("Codex terminal input for codex-primary");
    fireEvent.click(terminal);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.input(input, { target: { value: "codex-device-code" } });

    await waitFor(() => {
      expect(loginSessionMock.websocket.send.mock.calls.map(([payload]) => payload)).toEqual([
        JSON.stringify({ type: "input", data: "\x1b[B" }),
        JSON.stringify({ type: "input", data: "\t" }),
        JSON.stringify({ type: "input", data: "\x1b" }),
        JSON.stringify({ type: "input", data: "codex-device-code" }),
      ]);
    });
    expect(document.activeElement).toBe(input);
  });
});
