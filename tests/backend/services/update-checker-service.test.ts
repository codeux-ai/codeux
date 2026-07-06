import { beforeEach, describe, expect, it, vi } from "vitest";
import { CODE_UX_VERSION } from "../../../src/shared/config/code-ux-paths.js";
import { UpdateCheckerService } from "../../../src/services/update-checker-service.js";

describe("UpdateCheckerService", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns the latest published version and update availability", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ version: "99.0.0" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new UpdateCheckerService();
    const status = await service.checkForUpdate();

    expect(status.currentVersion).toBe(CODE_UX_VERSION);
    expect(status.latestVersion).toBe("99.0.0");
    expect(status.updateAvailable).toBe(true);
    expect(status.releaseUrl).toBe("https://github.com/codeux-ai/codeux/releases/tag/v99.0.0");
    expect(status.error).toBeUndefined();
    expect(Number.isNaN(Date.parse(status.checkedAt))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches the result until forced to refresh", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ version: "0.8.10" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ version: "0.9.0" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const service = new UpdateCheckerService(60_000);
    const first = await service.checkForUpdate();
    const second = await service.checkForUpdate();
    const forced = await service.checkForUpdate(true);

    expect(first.latestVersion).toBe("0.8.10");
    expect(second.latestVersion).toBe("0.8.10");
    expect(forced.latestVersion).toBe("0.9.0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a safe failure status when the registry request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      json: vi.fn(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new UpdateCheckerService();
    const status = await service.checkForUpdate();

    expect(status.currentVersion).toBe(CODE_UX_VERSION);
    expect(status.latestVersion).toBeNull();
    expect(status.updateAvailable).toBe(false);
    expect(status.releaseUrl).toBe("https://github.com/codeux-ai/codeux/releases");
    expect(status.error).toContain("HTTP 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
