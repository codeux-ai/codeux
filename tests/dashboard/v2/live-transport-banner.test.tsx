/** @vitest-environment jsdom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

import { LiveTransportBanner } from "../../../dashboard/src/v2/components/live-session/LiveTransportBanner.js";
import { resetLiveNowClockForTesting } from "../../../dashboard/src/v2/hooks/use-live-now.js";

describe("LiveTransportBanner", () => {
  beforeEach(() => {
    cleanup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:20Z")); // Set system time to 20 seconds
    resetLiveNowClockForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when connected, not recovering, not stale, and no error", () => {
    const { container } = render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt="2026-01-01T00:00:15Z" // 5 seconds ago (not stale)
        error={null}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders Disconnected when disconnected", () => {
    render(
      <LiveTransportBanner
        transportState="disconnected"
        isRecovering={false}
        snapshotUpdatedAt={null}
        error={null}
      />
    );
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("renders Connection Error when there is an error string", () => {
    render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt={null}
        error="Unable to connect to Orchestrator API"
      />
    );
    expect(screen.getByText("Connection Error")).toBeInTheDocument();
    expect(screen.getByText("Unable to connect to Orchestrator API")).toBeInTheDocument();
  });

  it("renders Reconnecting when transportState is reconnecting", () => {
    render(
      <LiveTransportBanner
        transportState="reconnecting"
        isRecovering={false}
        snapshotUpdatedAt={null}
        error={null}
      />
    );
    expect(screen.getByText("Reconnecting")).toBeInTheDocument();
  });

  it("renders Recovering State when isRecovering is true", () => {
    render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={true}
        snapshotUpdatedAt={null}
        error={null}
      />
    );
    expect(screen.getByText("Recovering State")).toBeInTheDocument();
  });

  it("renders Recovering State when transportState is connecting", () => {
    render(
      <LiveTransportBanner
        transportState="connecting"
        isRecovering={false}
        snapshotUpdatedAt={null}
        error={null}
      />
    );
    expect(screen.getByText("Recovering State")).toBeInTheDocument();
  });

  it("renders Stale Data when snapshot is older than threshold", () => {
    render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt="2026-01-01T00:00:00Z" // 20 seconds ago
        error={null}
      />
    );
    expect(screen.getByText("Stale Data")).toBeInTheDocument();
  });

  it("updates stale state via timer tick", () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:10Z")); // 10 seconds (not stale)
    const { container } = render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt="2026-01-01T00:00:00Z" // 10s old
        error={null}
      />
    );
    expect(container.firstChild).toBeNull();

    act(() => {
      // Advance by 6 seconds to trigger the 1s interval 6 times
      vi.advanceTimersByTime(6000);
    });

    // Now 16 seconds old (stale threshold is 15000ms)
    expect(screen.getByText("Stale Data")).toBeInTheDocument();
  });
});
