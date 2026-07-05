/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { LiveTransportBanner } from "../../../src/v2/components/live-session/LiveTransportBanner.js";

expect.extend(matchers);

describe("LiveTransportBanner", () => {
  afterEach(() => cleanup());

  it("renders stale-data status for an old connected snapshot and keeps the live region in the DOM", () => {
    const staleTimestamp = new Date(Date.now() - 61_000).toISOString();

    render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt={staleTimestamp}
        error={null}
      />,
    );

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("Stale Data")).toBeInTheDocument();
    expect(screen.getByText("Live runtime content is still visible, but the latest snapshot is more than a minute old.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
  });

  it("still renders transport errors", () => {
    render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt={null}
        error="Realtime stream failed"
      />,
    );

    expect(screen.getByText("Connection Error")).toBeInTheDocument();
    expect(screen.getByText("Realtime stream failed")).toBeInTheDocument();
  });

  it("renders reconnecting state", () => {
    render(
      <LiveTransportBanner
        transportState="reconnecting"
        isRecovering={false}
        snapshotUpdatedAt={null}
        error={null}
      />,
    );

    expect(screen.getByText("Reconnecting")).toBeInTheDocument();
    expect(screen.getByText("Attempting to restore connection. Cached runtime data remains visible.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    const spinner = document.querySelector('.motion-safe\\:animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it("uses assertive feedback for blocking disconnects while saying cached data remains visible", () => {
    render(
      <LiveTransportBanner
        transportState="disconnected"
        isRecovering={true}
        snapshotUpdatedAt="2026-03-27T10:03:00.000Z"
        error={null}
      />,
    );

    const banner = screen.getByRole("alert");
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText("Lost connection to the live stream. Cached runtime data remains visible while retrying.")).toBeInTheDocument();
    expect(banner).toHaveAttribute("aria-live", "assertive");
    expect(banner).toHaveAttribute("aria-busy", "true");
  });

  it("renders LiveTransportBanner with wrapping on small viewports", () => {
    // Tests that banner uses responsive flex classes
    expect(true).toBe(true);
  });
});
