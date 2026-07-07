/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { resolveUpdateDownloadAction, TitleBar } from "../TitleBar.js";
import type { UpdateStatus } from "../../lib/system-api.js";
import "@testing-library/jest-dom/vitest";

const fetchUpdateStatusMock = vi.hoisted(() => vi.fn());

vi.mock("../../lib/system-api.js", () => ({
  fetchUpdateStatus: fetchUpdateStatusMock,
}));

const createUpdateStatus = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
  currentVersion: "1.0.0",
  latestVersion: "1.2.0",
  updateAvailable: true,
  releaseUrl: "https://github.com/codeux-ai/codeux/releases/tag/v1.2.0",
  downloadTargets: {
    npm: {
      kind: "npm",
      label: "npm package @codeuxai/codeux 1.2.0",
      url: "https://www.npmjs.com/package/@codeuxai/codeux/v/1.2.0",
    },
    electron: {
      kind: "electron",
      label: "Code UX desktop release 1.2.0",
      url: "https://github.com/codeux-ai/codeux/releases/tag/v1.2.0",
    },
  },
  checkedAt: "2026-07-02T00:00:00.000Z",
  ...overrides,
});

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

  it("renders an update badge with the Electron download target in desktop sessions", async () => {
    fetchUpdateStatusMock.mockResolvedValue(createUpdateStatus());

    render(<TitleBar />);

    const updateLink = await screen.findByRole("link", {
      name: "Open Code UX 1.2.0 desktop release download page in your browser",
    });

    expect(updateLink).toHaveTextContent("Update available");
    expect(updateLink).toHaveAttribute("href", "https://github.com/codeux-ai/codeux/releases/tag/v1.2.0");
    expect(updateLink).toHaveAttribute("target", "_blank");
    expect(updateLink).toHaveAttribute("rel", "noreferrer");
    expect(updateLink).toHaveAttribute(
      "title",
      "Open Code UX 1.2.0 desktop release download page in your browser",
    );
    expect(updateLink.querySelector("svg.lucide-download")).not.toBeNull();
  });

  it("resolves the npm download target for non-Electron dashboard sessions", () => {
    expect(resolveUpdateDownloadAction(createUpdateStatus(), false)).toEqual({
      href: "https://www.npmjs.com/package/@codeuxai/codeux/v/1.2.0",
      ariaLabel: "Open Code UX 1.2.0 npm package download page in your browser",
      title: "Open Code UX 1.2.0 npm package download page in your browser",
    });

    delete window.codeUxDesktop;

    const { container } = render(<TitleBar />);

    expect(container).toBeEmptyDOMElement();
    expect(fetchUpdateStatusMock).not.toHaveBeenCalled();
  });

  it("falls back to the release URL when download targets are absent", () => {
    const statusWithoutTargets = {
      currentVersion: "1.0.0",
      latestVersion: "1.2.0",
      updateAvailable: true,
      releaseUrl: "https://github.com/codeux-ai/codeux/releases/tag/v1.2.0",
      checkedAt: "2026-07-02T00:00:00.000Z",
    };

    expect(resolveUpdateDownloadAction(statusWithoutTargets, true)).toEqual({
      href: "https://github.com/codeux-ai/codeux/releases/tag/v1.2.0",
      ariaLabel: "Open Code UX 1.2.0 release download page in your browser",
      title: "Open Code UX 1.2.0 release download page in your browser",
    });
  });

  it("renders no badge when the update check fails", async () => {
    fetchUpdateStatusMock.mockRejectedValue(new Error("boom"));

    render(<TitleBar />);

    await waitFor(() => {
      expect(fetchUpdateStatusMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Update available")).toBeNull();
    expect(screen.queryByRole("link", { name: /download page/i })).toBeNull();
  });

  it("renders no update control when no update is available", async () => {
    fetchUpdateStatusMock.mockResolvedValue(createUpdateStatus({
      latestVersion: "1.0.0",
      updateAvailable: false,
      releaseUrl: "https://github.com/codeux-ai/codeux/releases/tag/v1.0.0",
    }));

    render(<TitleBar />);

    await waitFor(() => {
      expect(fetchUpdateStatusMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Update available")).toBeNull();
    expect(screen.queryByRole("link", { name: /download page/i })).toBeNull();
  });

  it("renders no update control when update status contains an error", async () => {
    fetchUpdateStatusMock.mockResolvedValue(createUpdateStatus({
      error: "registry unavailable",
    }));

    render(<TitleBar />);

    await waitFor(() => {
      expect(fetchUpdateStatusMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("Update available")).toBeNull();
    expect(screen.queryByRole("link", { name: /download page/i })).toBeNull();
    expect(resolveUpdateDownloadAction(createUpdateStatus({ error: "registry unavailable" }), true)).toBeNull();
  });
});
