/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { useProjectEffectiveSettings } from "../../../dashboard/src/v2/hooks/use-project-effective-settings.js";
import { fetchProjectEffectiveSettings } from "../../../dashboard/src/v2/lib/settings-api.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/lib/settings-api.js", () => ({
  fetchProjectEffectiveSettings: vi.fn(),
}));

describe("useProjectEffectiveSettings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const MOCK_SETTINGS = {
    settings: {
      provider: "openai",
      systemPrompt: "You are a helpful assistant.",
      llmModel: "gpt-4",
    },
    sources: [],
    system: {},
  };

  const MOCK_SETTINGS_2 = {
    settings: {
      provider: "anthropic",
      systemPrompt: "You are Claude.",
      llmModel: "claude-3",
    },
    sources: [],
  };

  it("should fetch effective settings for the selected project", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue(MOCK_SETTINGS as any);

    const { result } = renderHook(() => useProjectEffectiveSettings("proj-1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(fetchProjectEffectiveSettings).toHaveBeenCalledWith("proj-1", expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(result.current.data).toEqual(MOCK_SETTINGS);
    expect(result.current.error).toBeNull();
  });

  it("should keep stable reference on unchanged settings", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue(MOCK_SETTINGS as any);

    const { result } = renderHook(() => useProjectEffectiveSettings("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const oldData = result.current.data;

    // Return structurally equivalent but new object reference
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue({
      settings: { ...MOCK_SETTINGS.settings },
      sources: [ ...MOCK_SETTINGS.sources ],
    } as any);

    let refreshPromise: Promise<void> | undefined;
    await waitFor(() => {
      refreshPromise = result.current.refresh();
      return true;
    });

    await refreshPromise;

    // Check that stabilization preserves the original reference
    expect(result.current.data).toBe(oldData);
  });

  it("should handle error when fetching fails", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockRejectedValue(new Error("Failed to fetch"));

    const { result } = renderHook(() => useProjectEffectiveSettings("proj-1"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Failed to fetch");
  });

  it("should clear data and abort when projectId becomes null", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValue(MOCK_SETTINGS as any);

    const { result, rerender } = renderHook(
      (props) => useProjectEffectiveSettings(props.projectId),
      { initialProps: { projectId: "proj-1" as string | null } }
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(MOCK_SETTINGS);
    });

    rerender({ projectId: null });

    // useRealtimeResource doesn't automatically drop previously fetched valid state if fetchResource returns null
    // It will return `null` once the promise resolves. Let's wait for it.
    await waitFor(() => {
      expect(result.current.data).toBeNull();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    // Test that the fallback state transitions correctly
    expect(fetchProjectEffectiveSettings).toHaveBeenCalledTimes(1);
  });

  it("should fetch new data and abort stale requests when projectId changes", async () => {
    let abortListener1: (() => void) | undefined;

    vi.mocked(fetchProjectEffectiveSettings).mockImplementationOnce((id, init) => {
      const signal = init?.signal as AbortSignal;
      return new Promise((resolve, reject) => {
        abortListener1 = () => {
          const err = new DOMException("Aborted", "AbortError");
          reject(err);
        };
        signal.addEventListener("abort", abortListener1);
        setTimeout(() => resolve(MOCK_SETTINGS as any), 100);
      });
    });

    vi.mocked(fetchProjectEffectiveSettings).mockImplementationOnce((id, init) => {
      return Promise.resolve(MOCK_SETTINGS_2 as any);
    });

    const { result, rerender } = renderHook(
      (props) => useProjectEffectiveSettings(props.projectId),
      { initialProps: { projectId: "proj-1" as string | null } }
    );

    expect(result.current.loading).toBe(true);

    // Change projectId before the first fetch completes
    rerender({ projectId: "proj-2" });

    await waitFor(() => {
      expect(result.current.data).toEqual(MOCK_SETTINGS_2);
    });

    expect(fetchProjectEffectiveSettings).toHaveBeenCalledTimes(2);
    expect(fetchProjectEffectiveSettings).toHaveBeenNthCalledWith(1, "proj-1", expect.any(Object));
    expect(fetchProjectEffectiveSettings).toHaveBeenNthCalledWith(2, "proj-2", expect.any(Object));
  });

  it("should manually refresh settings", async () => {
    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValueOnce(MOCK_SETTINGS as any);

    const { result } = renderHook(() => useProjectEffectiveSettings("proj-1"));

    await waitFor(() => {
      expect(result.current.data).toEqual(MOCK_SETTINGS);
    });

    vi.mocked(fetchProjectEffectiveSettings).mockResolvedValueOnce(MOCK_SETTINGS_2 as any);

    let refreshPromise: Promise<void> | undefined;
    await waitFor(() => {
      refreshPromise = result.current.refresh();
      return true;
    });

    await refreshPromise;

    await waitFor(() => {
      expect(result.current.data).toEqual(MOCK_SETTINGS_2);
    });

    expect(fetchProjectEffectiveSettings).toHaveBeenCalledTimes(2);
  });
});
