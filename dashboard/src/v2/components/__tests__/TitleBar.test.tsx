/**
 * @vitest-environment jsdom
 */

import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { TitleBar } from "../TitleBar.js";

describe("TitleBar", () => {
  beforeEach(() => {
    vi.stubGlobal("__APP_VERSION__", "0.8.9");
  });

  afterEach(() => {
    cleanup();
    delete window.codeUxDesktop;
    vi.unstubAllGlobals();
  });

  it("renders only when the desktop window API is available", () => {
    const { container, rerender } = render(<TitleBar />);

    expect(container).toBeEmptyDOMElement();

    window.codeUxDesktop = {
      platform: "linux",
      renderProfile: "standard",
      pickDirectory: vi.fn(),
      openUpdates: vi.fn().mockResolvedValue(true),
      window: {
        getState: vi.fn().mockResolvedValue({ isMaximized: false, isFullScreen: false, platform: "linux" }),
        onStateChange: vi.fn(() => () => {}),
        minimize: vi.fn(),
        toggleMaximize: vi.fn().mockResolvedValue(true),
        close: vi.fn(),
      },
    };

    rerender(<TitleBar />);

    expect(screen.getByText("v0.8.9")).toBeInTheDocument();
    const updateButton = screen.getByRole("button", { name: "Open updates" });

    fireEvent.click(updateButton);

    expect(window.codeUxDesktop.openUpdates).toHaveBeenCalledTimes(1);
  });
});
