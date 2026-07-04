/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TitleBar } from "../TitleBar.js";

expect.extend(matchers);

describe("TitleBar", () => {
  const windowApi = {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    getState: vi.fn(),
    onStateChange: vi.fn(),
  };

  beforeEach(() => {
    (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = "0.0.0-test";
    windowApi.minimize.mockClear();
    windowApi.toggleMaximize.mockClear();
    windowApi.close.mockClear();
    windowApi.getState.mockResolvedValue({ isMaximized: false, platform: "win32" });
    windowApi.onStateChange.mockReturnValue(() => {});
    Object.defineProperty(window, "codeUxDesktop", {
      configurable: true,
      value: {
        platform: "win32",
        window: windowApi,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "codeUxDesktop");
  });

  it("renders explicit accessible names for icon-only desktop controls", async () => {
    render(<TitleBar />);

    expect(await screen.findByRole("button", { name: "Minimize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument();
  });

  it("uses the restore label after the desktop shell reports a maximized window", async () => {
    windowApi.getState.mockResolvedValueOnce({ isMaximized: true, platform: "win32" });

    render(<TitleBar />);

    expect(await screen.findByRole("button", { name: "Restore window" })).toBeInTheDocument();
  });

  it("passes window actions through without changing notification or shell state", async () => {
    const { container } = render(<TitleBar />);

    fireEvent.click(await screen.findByRole("button", { name: "Minimize window" }));
    fireEvent.dblClick(container.querySelector("[data-titlebar='codeux']") as HTMLElement);

    await waitFor(() => expect(windowApi.minimize).toHaveBeenCalledTimes(1));
    expect(windowApi.toggleMaximize).toHaveBeenCalledTimes(1);
  });
});
