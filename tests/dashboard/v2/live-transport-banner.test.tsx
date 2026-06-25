/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

import { LiveTransportBanner } from "../../../dashboard/src/v2/components/live-session/LiveTransportBanner.js";

describe("LiveTransportBanner", () => {
  beforeEach(() => {
    cleanup();
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
    expect(container.firstChild).toHaveClass("overflow-hidden");
    expect(container.firstChild).toBeEmptyDOMElement();
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

  it("renders nothing while recovering (transient state must not flash/shift layout)", () => {
    const { container } = render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={true}
        snapshotUpdatedAt={null}
        error={null}
      />
    );
    expect(container.firstChild).toHaveClass("overflow-hidden");
    expect(container.firstChild).toBeEmptyDOMElement();
    expect(screen.queryByText("Recovering State")).not.toBeInTheDocument();
  });

  it("renders nothing while connecting (initial connect resolves near-instantly)", () => {
    const { container } = render(
      <LiveTransportBanner
        transportState="connecting"
        isRecovering={false}
        snapshotUpdatedAt={null}
        error={null}
      />
    );
    expect(container.firstChild).toHaveClass("overflow-hidden");
    expect(container.firstChild).toBeEmptyDOMElement();
    expect(screen.queryByText("Recovering State")).not.toBeInTheDocument();
  });

  it("returns null when connected with an old snapshot", () => {
    const { container } = render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt="2026-01-01T00:00:00Z"
        error={null}
      />
    );

    expect(container.firstChild).toHaveClass("overflow-hidden");
    expect(container.firstChild).toBeEmptyDOMElement();
    expect(screen.queryByText("Stale Data")).not.toBeInTheDocument();
  });
});
