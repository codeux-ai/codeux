/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { TitleBar } from "../TitleBar.js";
import "@testing-library/jest-dom/vitest";

const fetchUpdateStatusMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/system-api.js", () => ({
  fetchUpdateStatus: fetchUpdateStatusMock,
}));

describe("TitleBar", () => {
  beforeEach(() => {
    fetchUpdateStatusMock.mockReset();
    vi.stubGlobal("__APP_VERSION__", "0.8.9");
    window.codeUxDesktop = {
      platform: "linux",
      renderProfile: "standard",
      pickDirectory: vi.fn(),
      window: {
        getState: vi.fn().mockResolvedValue({ isMaximized: false, platform: "linux" }),
        onStateChange: vi.fn(() => () => {}),
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
      },
    } as unknown as typeof window.codeUxDesktop;
  });

  afterEach(() => {
    cleanup();
    delete window.codeUxDesktop;
    vi.unstubAllGlobals();
  });

  it("renders an update badge when a newer version is available", async () => {
    fetchUpdateStatusMock.mockResolvedValue({
      currentVersion: "1.0.0",
      latestVersion: "1.2.0",
      updateAvailable: true,
      checkedAt: "2026-07-02T00:00:00.000Z",
    });

    render(<TitleBar />);

    await waitFor(() => {
      expect(screen.getByText("Update available")).toBeInTheDocument();
    });

    expect(screen.getByText("Update available")).toHaveAttribute("title", "Latest version: 1.2.0");
  });

  it("renders no badge when the update check fails", async () => {
    fetchUpdateStatusMock.mockRejectedValue(new Error("boom"));

    render(<TitleBar />);

    await waitFor(() => {
      expect(fetchUpdateStatusMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Update available")).toBeNull();
  });

  it("renders no badge when no update is available", async () => {
    fetchUpdateStatusMock.mockResolvedValue({
      currentVersion: "1.0.0",
      latestVersion: "1.0.0",
      updateAvailable: false,
      checkedAt: "2026-07-02T00:00:00.000Z",
    });

    render(<TitleBar />);

    await waitFor(() => {
      expect(fetchUpdateStatusMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Update available")).toBeNull();
  });
});
