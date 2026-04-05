/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { render, cleanup, waitFor } from "@testing-library/preact";
import { useRealtimeResource } from "../../../dashboard/src/hooks/use-realtime-resource.js";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn(() => vi.fn()),
}));

function TestComponent({ initialData, fetchResource }: any) {
  const { data, loading, refetch } = useRealtimeResource({
    initialData,
    fetchResource,
    isEqual: (a, b) => a.id === b.id,
  });
  return h("div", null,
    h("div", { "data-testid": "loading" }, loading ? "true" : "false"),
    h("div", { "data-testid": "data-id" }, data.id),
    h("button", { "data-testid": "refetch", onClick: () => refetch() }, "Refetch")
  );
}

describe("useRealtimeResource", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("updates data without stale flash when initialData changes", async () => {
    const fetchResource = vi.fn().mockResolvedValue({ id: "fetched" });

    const Wrapper = ({ id }: { id: string }) => {
      return h(TestComponent, { initialData: { id }, fetchResource });
    };

    const { getByTestId, rerender } = render(h(Wrapper, { id: "initial-1" }));
    expect(getByTestId("data-id").textContent).toBe("initial-1");

    rerender(h(Wrapper, { id: "initial-2" }));
    expect(getByTestId("data-id").textContent).toBe("initial-2");
  });

  it("aborts previous fetch if a manual refetch triggers", async () => {
     let resolve1: any;
     const promise1 = new Promise((r) => resolve1 = r);

     const fetchResource = vi.fn().mockImplementation(async (signal) => {
       if (signal) {
         signal.addEventListener("abort", () => {
           // Reject the promise if aborted, do not throw globally
           const e = new Error("aborted");
           e.name = "AbortError";
         });
       }
       return promise1;
     });

     const { getByTestId } = render(h(TestComponent, { initialData: { id: "1" }, fetchResource }));

     // First call is from mount
     expect(fetchResource).toHaveBeenCalledTimes(1);

     // Trigger manual refetch
     getByTestId("refetch").click();

     expect(fetchResource).toHaveBeenCalledTimes(2);

     // The first call should be aborted since the second one overrides it
     const firstCallSignal = fetchResource.mock.calls[0][0];
     expect(firstCallSignal?.aborted).toBe(true);
  });

  it("does not update state if snapshot is semantically equal", async () => {
    const fetchResource = vi.fn().mockResolvedValue({ id: "1", ignore: "me" });
    const { getByTestId } = render(h(TestComponent, { initialData: { id: "1", ignore: "old" }, fetchResource }));

    // Wait for fetch to complete
    await waitFor(() => {
      expect(fetchResource).toHaveBeenCalledTimes(1);
    });

    // The data-id should still be 1. The component should NOT have thrashed state.
    expect(getByTestId("data-id").textContent).toBe("1");
  });
});
