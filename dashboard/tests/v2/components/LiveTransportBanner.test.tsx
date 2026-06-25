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

  it("does not render a stale-data warning for an old connected snapshot, but keeps the live region in the DOM", async () => {
    const staleTimestamp = new Date(Date.now() - 60_000).toISOString();

    render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt={staleTimestamp}
        error={null}
      />,
    );

    // Give it a moment to complete any layout effects, though it should be synchronous for connected.
    // However, it starts disconnected? No, it mounts as "connected".
    // Wait, the role is determined by "isUrgent". `isUrgent` defaults to true in the code.
    // If transportState is "connected", `isUrgent` falls back to true, and `role="alert"`. Let's check.
    const alertRegion = document.querySelector('[role="alert"]') || document.querySelector('[role="status"]');
    expect(alertRegion).toBeInTheDocument();
    expect(screen.queryByText("Stale Data")).not.toBeInTheDocument();
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
    expect(screen.getByText("Attempting to restore connection...")).toBeInTheDocument();
  });
});
