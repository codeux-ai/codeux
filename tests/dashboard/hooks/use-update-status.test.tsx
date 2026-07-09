/** @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdateStatus } from "../../../dashboard/src/v2/hooks/use-update-status.js";
import { fetchUpdateStatus, type UpdateStatus } from "../../../dashboard/src/v2/lib/system-api.js";

vi.mock("../../../dashboard/src/v2/lib/system-api.js", () => ({
  fetchUpdateStatus: vi.fn(),
}));

const makeUpdateStatus = (overrides: Partial<UpdateStatus>): UpdateStatus => ({
  currentVersion: "0.9.3",
  latestVersion: null,
  updateAvailable: false,
  releaseUrl: "https://github.com/codeux-ai/codeux/releases/latest",
  downloadTargets: {
    npm: {
      kind: "npm",
      label: "npm",
      url: "https://www.npmjs.com/package/@codeuxai/codeux",
    },
    electron: {
      kind: "electron",
      label: "Desktop app",
      url: "https://github.com/codeux-ai/codeux/releases/latest",
    },
  },
  checkedAt: "2026-07-09T00:00:00.000Z",
  ...overrides,
});

describe("useUpdateStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes available updates with the latest version", async () => {
    vi.mocked(fetchUpdateStatus).mockResolvedValueOnce(makeUpdateStatus({
      latestVersion: "0.9.4",
      updateAvailable: true,
    }));

    const { result } = renderHook(() => useUpdateStatus());

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true);
    });

    expect(result.current.latestVersion).toBe("0.9.4");
    expect(result.current.status?.updateAvailable).toBe(true);
    expect(fetchUpdateStatus).toHaveBeenCalledTimes(1);
  });

  it("treats an up-to-date payload as no update available", async () => {
    vi.mocked(fetchUpdateStatus).mockResolvedValueOnce(makeUpdateStatus({
      latestVersion: "0.9.3",
      updateAvailable: false,
    }));

    const { result } = renderHook(() => useUpdateStatus());

    await waitFor(() => {
      expect(result.current.status).not.toBeNull();
    });

    expect(result.current.updateAvailable).toBe(false);
    expect(result.current.latestVersion).toBe("0.9.3");
    expect(fetchUpdateStatus).toHaveBeenCalledTimes(1);
  });

  it("treats a rejected fetch as no update available", async () => {
    vi.mocked(fetchUpdateStatus).mockRejectedValueOnce(new Error("network unavailable"));

    const { result } = renderHook(() => useUpdateStatus());

    await waitFor(() => {
      expect(fetchUpdateStatus).toHaveBeenCalledTimes(1);
    });

    expect(result.current.status).toBeNull();
    expect(result.current.updateAvailable).toBe(false);
    expect(result.current.latestVersion).toBeNull();
  });
});
