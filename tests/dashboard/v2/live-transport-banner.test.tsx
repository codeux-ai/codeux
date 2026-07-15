/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

import { LiveTransportBanner } from "../../../dashboard/src/v2/components/live-session/LiveTransportBanner.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";

describe("LiveTransportBanner", () => {
  beforeEach(() => {
    cleanup();
  });

  it("returns null when connected, not recovering, not stale, and no error", () => {
    const { container } = render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt={new Date().toISOString()}
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
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
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
    expect(screen.getByText("Live transport state: Connection Error")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
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
    expect(screen.getByText("Attempting to restore connection. Cached runtime data remains visible.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Live transport state: Reconnecting")).toBeInTheDocument();
  });

  it("keeps reduced-motion reconnect affordances static and textual", () => {
    render(
      <LiveTransportBanner
        transportState="reconnecting"
        isRecovering={true}
        snapshotUpdatedAt={new Date().toISOString()}
        error={null}
      />
    );

    expect(screen.getByText("Reconnecting")).toBeInTheDocument();
    expect(document.querySelector(".motion-reduce\\:ring-2")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cached runtime data remains visible");
  });

  it("renders polite reconnect messaging while recovering cached live data", () => {
    render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={true}
        snapshotUpdatedAt={new Date().toISOString()}
        error={null}
      />
    );

    const banner = screen.getByRole("status");
    expect(screen.getByText("Refreshing Live Data")).toBeInTheDocument();
    expect(screen.getByText(/current runtime snapshot visible/)).toBeInTheDocument();
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(banner).toHaveAttribute("aria-busy", "true");
  });

  it("renders recovering state while waiting for the first snapshot", () => {
    render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={true}
        snapshotUpdatedAt={null}
        error={null}
      />
    );

    const banner = screen.getByRole("status");
    expect(screen.getByText("Recovering Live Data")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the first runtime snapshot/)).toBeInTheDocument();
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(banner).toHaveAttribute("aria-busy", "true");
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

  it("renders stale data as a polite non-blocking state", () => {
    render(
      <LiveTransportBanner
        transportState="connected"
        isRecovering={false}
        snapshotUpdatedAt={new Date(Date.now() - 61_000).toISOString()}
        error={null}
      />
    );

    const banner = screen.getByRole("status");
    expect(screen.getByText("Stale Data")).toBeInTheDocument();
    expect(screen.getByText(/snapshot is more than a minute old/)).toBeInTheDocument();
    expect(banner).toHaveAttribute("aria-live", "polite");
    expect(banner).toHaveAttribute("aria-busy", "false");
  });

  it("localizes German reconnecting, recovering, stale, and error presentation while preserving API errors", () => {
    const renderGerman = (props: Parameters<typeof LiveTransportBanner>[0]) => (
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <LiveTransportBanner {...props} />
      </DashboardI18nProvider>
    );
    const baseProps = {
      transportState: "reconnecting" as const,
      isRecovering: false,
      snapshotUpdatedAt: null,
      error: null,
    };
    const view = render(renderGerman(baseProps));

    expect(screen.getByText("Verbindung wird wiederhergestellt")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Zwischengespeicherte Laufzeitdaten bleiben sichtbar");

    view.rerender(renderGerman({ ...baseProps, transportState: "connected", isRecovering: true }));
    expect(screen.getByText("Live-Daten werden wiederhergestellt")).toBeInTheDocument();

    view.rerender(renderGerman({
      ...baseProps,
      transportState: "connected",
      snapshotUpdatedAt: new Date(Date.now() - 61_000).toISOString(),
    }));
    expect(screen.getByText("Veraltete Daten")).toBeInTheDocument();

    view.rerender(renderGerman({
      ...baseProps,
      transportState: "connected",
      error: "Runtime API unavailable: trace-42",
    }));
    expect(screen.getByText("Verbindungsfehler")).toBeInTheDocument();
    expect(screen.getByText("Runtime API unavailable: trace-42")).toBeInTheDocument();
  });
});
