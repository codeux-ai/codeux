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
      releaseUrl: "https://github.com/codeux-ai/codeux/releases/tag/v1.2.0",
      checkedAt: "2026-07-02T00:00:00.000Z",
    });

    render(<TitleBar />);

    const updateLink = await screen.findByRole("link", { name: "Open Code UX 1.2.0 release" });

    expect(updateLink).toHaveTextContent("Update available");
    expect(updateLink).toHaveAttribute("href", "https://github.com/codeux-ai/codeux/releases/tag/v1.2.0");
    expect(updateLink).toHaveAttribute("target", "_blank");
    expect(updateLink).toHaveAttribute("rel", "noreferrer");
    expect(updateLink).toHaveAttribute("title", "Open Code UX 1.2.0 release");
  });

  it("renders no badge when the update check fails", async () => {
    fetchUpdateStatusMock.mockRejectedValue(new Error("boom"));

    render(<TitleBar />);

    await waitFor(() => {
      expect(fetchUpdateStatusMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Update available")).toBeNull();
    expect(screen.queryByRole("link", { name: /release/i })).toBeNull();
  });

  it("renders no update control when no update is available", async () => {
    fetchUpdateStatusMock.mockResolvedValue({
      currentVersion: "1.0.0",
      latestVersion: "1.0.0",
      updateAvailable: false,
      releaseUrl: "https://github.com/codeux-ai/codeux/releases/tag/v1.0.0",
      checkedAt: "2026-07-02T00:00:00.000Z",
    });

    render(<TitleBar />);

    await waitFor(() => {
      expect(fetchUpdateStatusMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Update available")).toBeNull();
    expect(screen.queryByRole("link", { name: /release/i })).toBeNull();
  });

  it("renders no update control when update status contains an error", async () => {
    fetchUpdateStatusMock.mockResolvedValue({
      currentVersion: "1.0.0",
      latestVersion: "1.2.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/codeux-ai/codeux/releases/tag/v1.2.0",
      checkedAt: "2026-07-02T00:00:00.000Z",
      error: "registry unavailable",
    });

    render(<TitleBar />);

    await waitFor(() => {
      expect(fetchUpdateStatusMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Update available")).toBeNull();
    expect(screen.queryByRole("link", { name: /release/i })).toBeNull();
  });
});
