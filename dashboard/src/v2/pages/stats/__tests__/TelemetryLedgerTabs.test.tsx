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
  tasks: [{ id: "task-1" }],
  sprints: [{ id: "sprint-1" }, { id: "sprint-2" }],
  git: {
    tasks: [{ id: "git-task-1" }],
    sprints: [{ id: "git-sprint-1" }, { id: "git-sprint-2" }, { id: "git-sprint-3" }],
    totals: {
      insertions: 0,
      deletions: 0,
      filesChanged: 0,
      prCount: 0,
      mergedCount: 0,
      mergeConflictCount: 0,
    },
    buckets: [],
  },
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
    expect(tabs.length).toBe(3);
    expect(tabs[0]).toHaveTextContent("Task Telemetry");
    expect(tabs[0]).toHaveTextContent("1");
    expect(tabs[1]).toHaveTextContent("Sprint Telemetry");
    expect(tabs[1]).toHaveTextContent("2");
    expect(tabs[2]).toHaveTextContent("Git Telemetry");
    expect(tabs[2]).toHaveTextContent("4");

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
