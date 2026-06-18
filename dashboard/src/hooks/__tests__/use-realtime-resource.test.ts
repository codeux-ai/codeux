/* @vitest-environment happy-dom */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useRealtimeResource } from "../use-realtime-resource.js";

describe("useRealtimeResource (Hook Integration)", () => {
  it("skips isEqual check if stabilizeNext returns prev reference", async () => {
    const mockData = { id: "1" };
    let fetchResolve: (val: any) => void;
    const fetchPromise = new Promise(resolve => { fetchResolve = resolve; });
    const mockFetch = vi.fn().mockReturnValue(fetchPromise);
    const mockIsEqual = vi.fn().mockReturnValue(true);
    const mockStabilizeNext = vi.fn().mockReturnValue(mockData);

    const { unmount } = renderHook(() => useRealtimeResource({
      initialData: mockData,
      fetchResource: mockFetch,
      isEqual: mockIsEqual,
      stabilizeNext: mockStabilizeNext
    }));

    await act(async () => {
      fetchResolve({ id: "1", newField: true });
    });

    expect(mockStabilizeNext).toHaveBeenCalled();
    expect(mockIsEqual).not.toHaveBeenCalled();
    unmount();
  });
});
