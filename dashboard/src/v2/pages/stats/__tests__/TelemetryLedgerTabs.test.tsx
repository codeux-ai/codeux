/**
 * @vitest-environment jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { render, screen, cleanup, fireEvent } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TelemetryLedgerTabs } from "../components/TelemetryLedgerTabs.js";

expect.extend(matchers);

const mockStats = {
  tasks: [],
  sprints: [],
  git: null
} as any;

describe("TelemetryLedgerTabs Accessibility", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a tablist and handles keyboard navigation", () => {
    render(<TelemetryLedgerTabs stats={mockStats} />);

    const tablist = screen.getByRole("tablist", { name: "Telemetry ledgers" });
    expect(tablist).toBeInTheDocument();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBeGreaterThan(0);

    // Initial state: Task Telemetry is selected
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    tabs[0].focus();
    expect(tabs[0]).toHaveFocus();

    // Press ArrowRight on tablist
    fireEvent.keyDown(tablist, { key: "ArrowRight" });

    // Sprint Telemetry should be selected
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");

    // Press ArrowLeft on tablist
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });

    // Task Telemetry should be selected again
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });
});
