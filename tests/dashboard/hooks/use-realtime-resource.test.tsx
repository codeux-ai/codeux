/**
 * @vitest-environment happy-dom
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
    h("button", { "data-testid": "refetch", onClick: () => refetch() }, "Refetch"),
    h("button", { "data-testid": "refetch-silent", onClick: () => refetch({ silent: true }) }, "Refetch Silent"),
    h("button", { "data-testid": "refetch-abort", onClick: () => {
      const controller = new AbortController();
      refetch({ signal: controller.signal });
      controller.abort();
    } }, "Refetch Abort")
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

  it("does not update state from a stale completion after supersession", async () => {
     let resolve1: any;
     const promise1 = new Promise((r) => resolve1 = r);

     let resolve2: any;
     const promise2 = new Promise((r) => resolve2 = r);

     const fetchResource = vi.fn()
       .mockReturnValueOnce(promise1)
       .mockReturnValueOnce(promise2);

     const { getByTestId } = render(h(TestComponent, { initialData: { id: "initial" }, fetchResource }));

     // Trigger manual refetch
     getByTestId("refetch").click();

     // Resolve the first (stale) promise
     resolve1({ id: "stale" });

     // Yield to microtask queue
     await new Promise(r => setTimeout(r, 10));

     // It should NOT update because it was superseded
     expect(getByTestId("data-id").textContent).toBe("initial");

     // Resolve the active promise
     resolve2({ id: "latest" });

     await new Promise(r => setTimeout(r, 10));

     // It should update to the latest
     expect(getByTestId("data-id").textContent).toBe("latest");
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

  it("keeps the public refetch callback stable across data updates", async () => {
    const seenRefetches: Array<ReturnType<typeof useRealtimeResource>["refetch"]> = [];
    const fetchResource = vi.fn().mockResolvedValue({ id: "fetched" });
    const initialData = { id: "initial" };

    function RefetchIdentityComponent() {
      const { data, refetch } = useRealtimeResource({
        initialData,
        fetchResource,
      });
      seenRefetches.push(refetch);
      return h("div", { "data-testid": "data-id" }, data.id);
    }

    const { getByTestId } = render(h(RefetchIdentityComponent, null));

    await waitFor(() => {
      expect(getByTestId("data-id").textContent).toBe("fetched");
    });

    expect(seenRefetches.length).toBeGreaterThan(1);
    expect(new Set(seenRefetches).size).toBe(1);
  });

  it("composes external abort signals", async () => {
    let internalSignal: AbortSignal | undefined;
    const fetchResource = vi.fn().mockImplementation(async (signal) => {
      internalSignal = signal;
      return new Promise(() => {}); // never resolves
    });

    const { getByTestId } = render(h(TestComponent, { initialData: { id: "1" }, fetchResource }));

    // Mount triggers fetch 1
    expect(fetchResource).toHaveBeenCalledTimes(1);

    getByTestId("refetch-abort").click();

    // Wait for the abort to propagate
    await new Promise(r => setTimeout(r, 10));

    expect(fetchResource).toHaveBeenCalledTimes(2);
    expect(internalSignal?.aborted).toBe(true);
  });

  it("deduplicates concurrent silent fetches", async () => {
    let resolve1: any;
    const promise1 = new Promise((r) => resolve1 = r);
    const fetchResource = vi.fn().mockReturnValue(promise1);

    const { getByTestId } = render(h(TestComponent, { initialData: { id: "1" }, fetchResource }));

    // Mount triggers fetch 1
    expect(fetchResource).toHaveBeenCalledTimes(1);

    resolve1({ id: "1" });
    await new Promise(r => setTimeout(r, 10));

    // Clear mock to track silent fetches
    vi.mocked(fetchResource).mockClear();

    let resolveSilent: any;
    const promiseSilent = new Promise((r) => resolveSilent = r);
    fetchResource.mockReturnValue(promiseSilent);

    // Trigger silent refetch multiple times synchronously
    getByTestId("refetch-silent").click();
    getByTestId("refetch-silent").click();
    getByTestId("refetch-silent").click();

    // It should only result in 1 call to fetchResource
    expect(fetchResource).toHaveBeenCalledTimes(1);
  });

  it("aborts a silent fetch when a foreground fetch triggers", async () => {
    let resolve1: any;
    const promise1 = new Promise((r) => resolve1 = r);
    const fetchResource = vi.fn().mockReturnValue(promise1);

    const { getByTestId } = render(h(TestComponent, { initialData: { id: "1" }, fetchResource }));

    resolve1({ id: "1" });
    await new Promise(r => setTimeout(r, 10));
    vi.mocked(fetchResource).mockClear();

    let resolveSilent: any;
    const promiseSilent = new Promise((r) => resolveSilent = r);

    let resolveForeground: any;
    const promiseForeground = new Promise((r) => resolveForeground = r);

    // Mock first call (silent)
    fetchResource.mockReturnValueOnce(promiseSilent);
    // Mock second call (foreground)
    fetchResource.mockImplementationOnce(async () => {
      return promiseForeground;
    });

    getByTestId("refetch-silent").click();

    // First call (silent) was initiated
    expect(fetchResource).toHaveBeenCalledTimes(1);

    // Now trigger a foreground refetch while silent is ongoing
    getByTestId("refetch").click();

    expect(fetchResource).toHaveBeenCalledTimes(2);
  });

  it("allows future silent fetches after a foreground fetch supersedes a silent fetch", async () => {
    let resolveInitial: any;
    const initialPromise = new Promise((resolve) => resolveInitial = resolve);
    const fetchResource = vi.fn().mockReturnValue(initialPromise);

    const { getByTestId } = render(h(TestComponent, { initialData: { id: "1" }, fetchResource }));

    resolveInitial({ id: "1" });
    await new Promise(r => setTimeout(r, 10));
    vi.mocked(fetchResource).mockClear();

    const neverResolvingSilent = new Promise(() => {});
    let resolveForeground: any;
    const foregroundPromise = new Promise((resolve) => resolveForeground = resolve);

    fetchResource
      .mockReturnValueOnce(neverResolvingSilent)
      .mockReturnValueOnce(foregroundPromise)
      .mockResolvedValueOnce({ id: "silent-after-foreground" });

    getByTestId("refetch-silent").click();
    expect(fetchResource).toHaveBeenCalledTimes(1);

    getByTestId("refetch").click();
    expect(fetchResource).toHaveBeenCalledTimes(2);

    resolveForeground({ id: "foreground" });
    await new Promise(r => setTimeout(r, 10));

    getByTestId("refetch-silent").click();
    expect(fetchResource).toHaveBeenCalledTimes(3);
  });
});
