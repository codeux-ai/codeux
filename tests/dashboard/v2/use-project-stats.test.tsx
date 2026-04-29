/**
 * @vitest-environment happy-dom
 */
import { h } from "preact";
import { render, cleanup, waitFor } from "@testing-library/preact";
import { useProjectStats } from "../../../dashboard/src/v2/hooks/use-project-stats.js";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the realtime client
let mockRealtimeCallback: ((message: any) => void) | null = null;
vi.mock("../../../dashboard/src/v2/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn((scopes, callback, _transportCallback) => {
    mockRealtimeCallback = callback;
    return vi.fn();
  }),
}));

// Mock the API
vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchProjectStats: vi.fn(async (projectId, query, signal) => {
    // Simulate network delay
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, 50);
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeout);
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
          return;
        }
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }
    });
    return {
      id: "stats-snapshot",
      usage: { total: 0 },
      git: { commits: 0 }
    };
  }),
}));

import { fetchProjectStats } from "../../../dashboard/src/v2/lib/project-api.js";

function TestComponent({ projectId, query, pollIntervalMs = 30000, onStats }: { projectId: string | null; query: any, pollIntervalMs?: number, onStats?: (s: any) => void }) {
  const { stats, loading, error } = useProjectStats(projectId, query, pollIntervalMs);

  if (onStats && stats) {
    onStats(stats);
  }

  return h('div', null,
    h('div', { 'data-testid': 'loading' }, loading ? 'loading' : 'idle'),
    h('div', { 'data-testid': 'stats' }, stats ? stats.id : 'none')
  );
}

describe("useProjectStats cancellation", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockRealtimeCallback = null;
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps stable reference on unchanged stats snapshot", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let capturedStats: any = null;
    const { getByTestId } = render(h(TestComponent, {
      projectId: "p1",
      query: "7d",
      pollIntervalMs: 10000,
      onStats: (s) => { capturedStats = s; }
    }));

    // Wait for initial load
    await waitFor(() => {
      expect(getByTestId("loading").textContent).toBe("idle");
    });

    const firstStatsRef = capturedStats;
    expect(firstStatsRef).toBeTruthy();

    // Advance poll interval to trigger a background fetch
    vi.advanceTimersByTime(10500);

    // Wait for the second fetch
    await waitFor(() => {
      expect(fetchProjectStats).toHaveBeenCalledTimes(2);
    });

    // capturedStats shouldn't have structurally changed
    expect(capturedStats).toBe(firstStatsRef);
  });

  it("cancels previous fetch on query change", async () => {
    const { getByTestId, rerender } = render(h(TestComponent, { projectId: "p1", query: "7d" }));
    expect(getByTestId("loading").textContent).toBe("loading");

    // Immediately change the query before the first fetch completes
    rerender(h(TestComponent, { projectId: "p1", query: "30d" }));

    // Wait for the final fetch to settle
    await waitFor(() => {
      expect(getByTestId("loading").textContent).toBe("idle");
    });

    // It should have called fetchProjectStats twice
    expect(fetchProjectStats).toHaveBeenCalledTimes(2);

    // The first call should have been aborted
    const firstCallSignal = vi.mocked(fetchProjectStats).mock.calls[0][2];
    expect(firstCallSignal?.aborted).toBe(true);

    // The second call should not be aborted
    const secondCallSignal = vi.mocked(fetchProjectStats).mock.calls[1][2];
    expect(secondCallSignal?.aborted).toBe(false);

    // The final state should be loaded and stable
    expect(getByTestId("stats").textContent).toBe("stats-snapshot");
  });

  it("performs background refresh on matching realtime event", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { getByTestId } = render(h(TestComponent, { projectId: "p1", query: "7d" }));

    // Wait for initial load
    await waitFor(() => {
      expect(getByTestId("loading").textContent).toBe("idle");
    });

    expect(fetchProjectStats).toHaveBeenCalledTimes(1);

    // The subscription runs in a useEffect that may take an extra tick or requires timer advancement
    vi.runOnlyPendingTimers();

    // Trigger realtime event
    if (mockRealtimeCallback) {
      mockRealtimeCallback({
        type: "event",
        event: { eventType: "project.execution.updated", payload: {} }
      });
    }

    // Run pending timers to let the refetch execute immediately (no debounce anymore)
    vi.runOnlyPendingTimers();

    // Wait for fetch.
    await waitFor(() => {
      expect(fetchProjectStats.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // It should be a silent refresh, so no foreground loading
    expect(getByTestId("loading").textContent).toBe("idle");
  });

  it("performs background polling based on interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { getByTestId } = render(h(TestComponent, { projectId: "p1", query: "7d", pollIntervalMs: 10000 }));

    // Wait for initial load
    await waitFor(() => {
      expect(getByTestId("loading").textContent).toBe("idle");
    });

    expect(fetchProjectStats).toHaveBeenCalledTimes(1);

    // Advance poll interval
    vi.advanceTimersByTime(10500);

    // Since useRealtimeResource uses window.setInterval, we advance time and wait for it
    await waitFor(() => {
      expect(fetchProjectStats).toHaveBeenCalledTimes(2);
    });

    // Check loading remains idle
    expect(getByTestId("loading").textContent).toBe("idle");
  });

  it("deduplicates rapid overlapping poll and realtime fetches", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { getByTestId } = render(h(TestComponent, { projectId: "p1", query: "7d", pollIntervalMs: 10000 }));

    // Wait for initial load
    await waitFor(() => {
      expect(getByTestId("loading").textContent).toBe("idle");
    });

    expect(fetchProjectStats).toHaveBeenCalledTimes(1);

    // Prepare to trigger a realtime event
    if (mockRealtimeCallback) {
      mockRealtimeCallback({
        type: "event",
        event: { eventType: "project.execution.updated", payload: {} }
      });
    }

    // Almost simultaneously, advance timers to trigger poll
    vi.advanceTimersByTime(10500);
    vi.runOnlyPendingTimers();

    // Since useRealtimeResource now dedupes silent fetches, fetchProjectStats should only be called ONE additional time
    // instead of twice.
    await waitFor(() => {
      expect(fetchProjectStats).toHaveBeenCalledTimes(2);
    });

    // Wait a bit to ensure no further calls are made
    vi.advanceTimersByTime(500);
    expect(fetchProjectStats).toHaveBeenCalledTimes(2);
  });

  it("preserves foreground loading reset on project change", async () => {
    const { getByTestId, rerender } = render(h(TestComponent, { projectId: "p1", query: "7d" }));

    // Should be loading initially
    expect(getByTestId("loading").textContent).toBe("loading");

    // Wait for initial load
    await waitFor(() => {
      expect(getByTestId("loading").textContent).toBe("idle");
    });

    // Change project id
    rerender(h(TestComponent, { projectId: "p2", query: "7d" }));

    // Should reset to foreground loading
    expect(getByTestId("loading").textContent).toBe("loading");

    // Wait for new project load
    await waitFor(() => {
      expect(getByTestId("loading").textContent).toBe("idle");
    });
  });
});
