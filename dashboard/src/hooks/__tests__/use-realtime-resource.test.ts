/* @vitest-environment happy-dom */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useRealtimeResource } from "../use-realtime-resource.js";

describe("useRealtimeResource", () => {
  it("skips isEqual check if stabilizeNext returns prev reference", async () => {
    const mockData = { id: "1" };
    let fetchResolve: (val: any) => void;
    const fetchPromise = new Promise(resolve => { fetchResolve = resolve; });
    const mockFetch = vi.fn().mockReturnValue(fetchPromise);
    const mockIsEqual = vi.fn().mockReturnValue(true);
    const mockStabilizeNext = vi.fn().mockReturnValue(mockData); // returns the same reference

    renderHook(() => useRealtimeResource({
      initialData: mockData,
      fetchResource: mockFetch,
      isEqual: mockIsEqual,
      stabilizeNext: mockStabilizeNext
    }));

    await act(async () => {
      fetchResolve({ id: "1", newField: true }); // A new object
      await fetchPromise;
    });

    // Since stabilizeNext returned mockData (prev === stabilized), isEqual should NOT be called.
    expect(mockStabilizeNext).toHaveBeenCalled();
    expect(mockIsEqual).not.toHaveBeenCalled();
  });
});
