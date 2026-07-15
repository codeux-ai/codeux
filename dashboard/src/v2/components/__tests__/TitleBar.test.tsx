/**
 * @vitest-environment jsdom
 */

import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { useUpdateStatus } from "../../hooks/use-update-status.js";
import { TitleBar } from "../TitleBar.js";
import { DashboardI18nProvider } from "../../i18n/context.js";

vi.mock("../../hooks/use-update-status.js", () => ({
  useUpdateStatus: vi.fn(),
}));

const mockUseUpdateStatus = vi.mocked(useUpdateStatus);

const installDesktopApi = () => {
  const desktopApi = {
    platform: "linux",
    renderProfile: "standard" as const,
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
  window.codeUxDesktop = desktopApi;
  return desktopApi;
};

describe("TitleBar", () => {
  beforeEach(() => {
    vi.stubGlobal("__APP_VERSION__", "0.8.9");
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

  it("renders only when the desktop window API is available", () => {
    const { container, rerender } = render(<TitleBar />);

    expect(container).toBeEmptyDOMElement();

    installDesktopApi();

    rerender(<TitleBar />);

    expect(screen.getByText("v0.8.9")).toBeInTheDocument();
  });

  it("renders the update button with the available version and opens updates when clicked", () => {
    mockUseUpdateStatus.mockReturnValue({
      status: null,
      updateAvailable: true,
      latestVersion: "0.9.0",
    });
    const desktopApi = installDesktopApi();

    render(<TitleBar />);

    const updateButton = screen.getByRole("button", { name: "Update available: v0.9.0" });

    fireEvent.click(updateButton);

    expect(desktopApi.openUpdates).toHaveBeenCalledTimes(1);
  });

  it("hides the update button when no update is available while keeping title and window controls", () => {
    installDesktopApi();

    render(<TitleBar />);

    expect(screen.queryByRole("button", { name: /update/i })).not.toBeInTheDocument();
    expect(screen.getByText("v0.8.9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Maximize window" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close window" })).toBeInTheDocument();
  });

  it("updates desktop chrome when the active locale is German", () => {
    installDesktopApi();
    render(<DashboardI18nProvider initialLocale="de"><TitleBar /></DashboardI18nProvider>);

    expect(screen.getByRole("button", { name: "Fenster minimieren" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fenster maximieren" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fenster schließen" })).toBeInTheDocument();
  });
});
