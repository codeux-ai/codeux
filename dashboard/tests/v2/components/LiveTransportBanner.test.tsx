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

  it("does not render a stale-data warning for an old connected snapshot", () => {
    const staleTimestamp = new Date(Date.now() - 60_000).toISOString();

    const { container } = render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt={staleTimestamp}
        error={null}
      />,
    );

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Stale Data")).not.toBeInTheDocument();
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
