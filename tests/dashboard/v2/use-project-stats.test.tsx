/**
 * @vitest-environment jsdom
 * @jsx h
 * @jsxFrag Fragment
 */
import { h, Fragment } from "preact";
import { render, cleanup } from "@testing-library/preact";
import { useProjectStats } from "../../../dashboard/src/v2/hooks/use-project-stats.js";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the realtime client
vi.mock("../../../dashboard/src/v2/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn(() => vi.fn()),
}));

// Mock the API
vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchProjectStats: vi.fn(async (projectId, query, signal) => {
    // Simulate network delay
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, 100);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }
    });
    return { id: "stats-snapshot" };
  }),
}));

import { fetchProjectStats } from "../../../dashboard/src/v2/lib/project-api.js";

function TestComponent({ projectId, query }: { projectId: string | null; query: any }) {
  const { stats, loading, error } = useProjectStats(projectId, query);
  return h('div', null,
    h('div', { 'data-testid': 'loading' }, loading ? 'loading' : 'idle'),
    h('div', { 'data-testid': 'stats' }, stats ? stats.id : 'none')
  );
}

describe("useProjectStats cancellation", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("cancels previous fetch on query change", async () => {
    const { getByTestId, rerender } = render(h(TestComponent, { projectId: "p1", query: "7d" }));
    expect(getByTestId("loading").textContent).toBe("loading");

    // Immediately change the query before the first fetch completes
    rerender(h(TestComponent, { projectId: "p1", query: "30d" }));

    // Wait for the final fetch to settle
    await new Promise(r => setTimeout(r, 200));

    // It should have called fetchProjectStats twice
    expect(fetchProjectStats).toHaveBeenCalledTimes(2);

    // The first call should have been aborted
    const firstCallSignal = vi.mocked(fetchProjectStats).mock.calls[0][2];
    expect(firstCallSignal?.aborted).toBe(true);

    // The second call should not be aborted
    const secondCallSignal = vi.mocked(fetchProjectStats).mock.calls[1][2];
    expect(secondCallSignal?.aborted).toBe(false);

    // The final state should be loaded and stable
    expect(getByTestId("loading").textContent).toBe("idle");
    expect(getByTestId("stats").textContent).toBe("stats-snapshot");
  });
});
