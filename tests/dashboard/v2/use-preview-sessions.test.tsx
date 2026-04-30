/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { usePreviewSessions } from "../../../dashboard/src/v2/hooks/use-preview-sessions.js";
import { fetchPreviewSessions } from "../../../dashboard/src/v2/lib/browser-api.js";

vi.mock("../../../dashboard/src/v2/lib/browser-api.js", () => ({
  fetchPreviewSessions: vi.fn(),
}));

describe("usePreviewSessions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty array and no selected session if projectId is null", async () => {
    const { result } = renderHook(() => usePreviewSessions({ projectId: null }));
    expect(result.current.sessions).toEqual([]);
    expect(result.current.selectedSession).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(fetchPreviewSessions).not.toHaveBeenCalled();
  });

  it("fetches sessions successfully when projectId is provided", async () => {
    const mockSessions = [{ id: "s1", sprintId: "sp1" }, { id: "s2", sprintId: "sp2" }];
    vi.mocked(fetchPreviewSessions).mockResolvedValue(mockSessions as any);

    const { result } = renderHook(() => usePreviewSessions({ projectId: "p1" }));

    expect(result.current.loading).toBe(true);

    await act(async () => {
      // wait for the promise to resolve
      await Promise.resolve();
    });

    expect(fetchPreviewSessions).toHaveBeenCalledWith("p1");
    expect(result.current.loading).toBe(false);
    expect(result.current.sessions).toEqual(mockSessions);
    // falls back to index 0 if no activeSessionId or selectedSprintId
    expect(result.current.selectedSession).toEqual(mockSessions[0]);
  });

  it("selects session by activeSessionId correctly", async () => {
    const mockSessions = [{ id: "s1", sprintId: "sp1" }, { id: "s2", sprintId: "sp2" }];
    vi.mocked(fetchPreviewSessions).mockResolvedValue(mockSessions as any);

    const { result } = renderHook(() => usePreviewSessions({ projectId: "p1", activeSessionId: "s2" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.selectedSession).toEqual(mockSessions[1]);
  });

  it("selects session by selectedSprintId correctly if no activeSessionId", async () => {
    const mockSessions = [{ id: "s1", sprintId: "sp1" }, { id: "s2", sprintId: "sp2" }];
    vi.mocked(fetchPreviewSessions).mockResolvedValue(mockSessions as any);

    const { result } = renderHook(() => usePreviewSessions({ projectId: "p1", selectedSprintId: "sp2" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.selectedSession).toEqual(mockSessions[1]);
  });

  it("handles fetch errors gracefully", async () => {
    vi.mocked(fetchPreviewSessions).mockRejectedValue(new Error("Network Error"));

    const { result } = renderHook(() => usePreviewSessions({ projectId: "p1" }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("Network Error");
    expect(result.current.sessions).toEqual([]);
  });

  it("refreshes periodically without setting loading state when silent", async () => {
    const mockSessions = [{ id: "s1" }];
    vi.mocked(fetchPreviewSessions).mockResolvedValue(mockSessions as any);

    const { result } = renderHook(() => usePreviewSessions({ projectId: "p1", pollInterval: 1000 }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchPreviewSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(fetchPreviewSessions).toHaveBeenCalledTimes(2);
    // Loading shouldn't be set back to true during silent poll
    expect(result.current.loading).toBe(false);
  });
});
