/** @vitest-environment jsdom */

import { h } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { useUpdateStatus } from "../../../dashboard/src/v2/hooks/use-update-status.js";
import { TitleBar } from "../../../dashboard/src/v2/components/TitleBar.js";

vi.mock("../../../dashboard/src/v2/hooks/use-update-status.js", () => ({
  useUpdateStatus: vi.fn(),
}));

type WindowStateListener = (state: CodeUxWindowState) => void;
const mockUseUpdateStatus = vi.mocked(useUpdateStatus);

const createDesktopBridge = () => {
  let stateListener: WindowStateListener | null = null;
  const bridge = {
    platform: "linux",
    renderProfile: "standard",
    pickDirectory: vi.fn(),
    openUpdates: vi.fn().mockResolvedValue(true),
    window: {
      getState: vi.fn().mockResolvedValue({
        isMaximized: false,
        isFullScreen: false,
        platform: "linux",
      }),
      onStateChange: vi.fn((listener: WindowStateListener) => {
        stateListener = listener;
        return vi.fn();
      }),
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
    },
  } satisfies NonNullable<typeof window.codeUxDesktop>;

  return {
    bridge,
    emitWindowState: (state: CodeUxWindowState) => stateListener?.(state),
  };
};

describe("TitleBar", () => {
  beforeEach(() => {
    vi.stubGlobal("__APP_VERSION__", "2.3.4");
    mockUseUpdateStatus.mockReturnValue({
      status: null,
      updateAvailable: false,
      latestVersion: null,
    });
  });

  afterEach(() => {
    cleanup();
    delete window.codeUxDesktop;
    vi.unstubAllGlobals();
  });

  it("does not render in normal browser dashboard sessions", () => {
    delete window.codeUxDesktop;

    const { container } = render(<TitleBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders Code UX, the version, and the window controls when the desktop window API exists", () => {
    const { bridge } = createDesktopBridge();
    window.codeUxDesktop = bridge;

    render(<TitleBar />);

    expect(screen.getByRole("img", { name: "Code UX" })).toBeInTheDocument();
    expect(screen.getByText("v2.3.4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument();
  });

  it("double-clicks the non-interactive title-bar area to toggle maximize", async () => {
    const { bridge } = createDesktopBridge();
    window.codeUxDesktop = bridge;
    const { container } = render(<TitleBar />);
    const titleBar = container.querySelector('[data-titlebar="codeux"]');

    expect(titleBar).toBeInstanceOf(HTMLElement);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.dblClick(titleBar as HTMLElement);

    await waitFor(() => {
      expect(bridge.window.toggleMaximize).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByRole("button", { name: "Restore window" })).toBeInTheDocument();
  });

  it("marks controls as no-drag regions and keeps their double-clicks from toggling maximize", () => {
    const { bridge } = createDesktopBridge();
    window.codeUxDesktop = bridge;

    render(<TitleBar />);

    const controls = [
      screen.getByRole("button", { name: "Minimize window" }),
      screen.getByRole("button", { name: "Maximize window" }),
      screen.getByRole("button", { name: "Close window" }),
    ];

    for (const control of controls) {
      expect(control).toHaveClass("titlebar-no-drag");
      fireEvent.dblClick(control);
    }

    expect(bridge.window.toggleMaximize).not.toHaveBeenCalled();
  });

  it("renders the update affordance with the available version and opens updates when clicked", () => {
    mockUseUpdateStatus.mockReturnValue({
      status: null,
      updateAvailable: true,
      latestVersion: "2.4.0",
    });
    const { bridge } = createDesktopBridge();
    window.codeUxDesktop = bridge;

    render(<TitleBar />);

    const updateButton = screen.getByRole("button", { name: "Update available: v2.4.0" });

    expect(updateButton).toHaveTextContent("Update");
    expect(updateButton).toHaveClass("titlebar-no-drag");

    fireEvent.click(updateButton);

    expect(bridge.openUpdates).toHaveBeenCalledTimes(1);
  });

  it("updates the maximize button label and icon from state-change events", async () => {
    const { bridge, emitWindowState } = createDesktopBridge();
    window.codeUxDesktop = bridge;

    render(<TitleBar />);

    await act(async () => {
      await Promise.resolve();
    });

    const maximizeButton = screen.getByRole("button", { name: "Maximize window" });
    expect(maximizeButton.querySelector("svg.lucide-square")).not.toBeNull();

    act(() => {
      emitWindowState({ isMaximized: true, isFullScreen: false });
    });

    const restoreButton = await screen.findByRole("button", { name: "Restore window" });
    expect(restoreButton.querySelector("svg")).toHaveClass("-scale-x-100");
  });
});
