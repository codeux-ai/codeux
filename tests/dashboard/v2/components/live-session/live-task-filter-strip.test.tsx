/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

import { LiveTaskFilterStrip } from "../../../../../dashboard/src/v2/components/live-session/LiveTaskFilterStrip.js";
import type { LiveSessionTaskFilter } from "../../../../../dashboard/src/v2/lib/live-session-view-model.js";

const taskCounts: Record<LiveSessionTaskFilter, number> = {
  All: 5,
  Running: 2,
  Completed: 1,
  Failed: 1,
  Pending: 1,
};

describe("LiveTaskFilterStrip", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders accessible task filter tabs with counts and selected state", () => {
    const onFilterChange = vi.fn();

    render(
      <LiveTaskFilterStrip
        activeFilter="Running"
        taskCounts={taskCounts}
        announcement="2 running tasks shown."
        onFilterChange={onFilterChange}
        selectionMovementStyle={{ transitionDuration: "120ms", transitionTimingFunction: "ease-out" }}
      />,
    );

    const tablist = screen.getByRole("tablist", { name: "Task status filters" });
    const runningTab = within(tablist).getByRole("tab", { name: "Running tasks filter, 2 tasks. Running filter is already selected." });
    const allTab = within(tablist).getByRole("tab", { name: "All tasks filter, 5 tasks" });

    expect(runningTab).toHaveAttribute("aria-selected", "true");
    expect(runningTab).toHaveAttribute("tabindex", "0");
    expect(runningTab).toHaveAttribute("title", "Running filter is already selected.");
    expect(allTab).toHaveAttribute("aria-selected", "false");
    expect(allTab).toHaveAttribute("tabindex", "-1");
    expect(screen.getByText("2 running tasks shown.")).toHaveAttribute("aria-live", "polite");
  });

  it("moves filter selection and focus with arrow keys", () => {
    const onFilterChange = vi.fn();

    const { rerender } = render(
      <LiveTaskFilterStrip
        activeFilter="Running"
        taskCounts={taskCounts}
        announcement="2 running tasks shown."
        onFilterChange={onFilterChange}
        selectionMovementStyle={{ transitionDuration: "120ms", transitionTimingFunction: "ease-out" }}
      />,
    );

    const tablist = screen.getByRole("tablist", { name: "Task status filters" });
    const runningTab = within(tablist).getByRole("tab", { name: "Running tasks filter, 2 tasks. Running filter is already selected." });
    runningTab.focus();

    fireEvent.keyDown(runningTab, { key: "ArrowRight" });

    expect(onFilterChange).toHaveBeenCalledWith("Completed");
    expect(document.activeElement).toBe(within(tablist).getByRole("tab", { name: "Completed tasks filter, 1 task" }));

    rerender(
      <LiveTaskFilterStrip
        activeFilter="Completed"
        taskCounts={taskCounts}
        announcement="1 completed task shown."
        onFilterChange={onFilterChange}
        selectionMovementStyle={{ transitionDuration: "120ms", transitionTimingFunction: "ease-out" }}
      />,
    );

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" });

    expect(onFilterChange).toHaveBeenLastCalledWith("Running");
    expect(document.activeElement).toBe(within(tablist).getByRole("tab", { name: "Running tasks filter, 2 tasks" }));
  });

  it("suppresses duplicate selected and pending filter activation", () => {
    const onFilterChange = vi.fn();

    render(
      <LiveTaskFilterStrip
        activeFilter="Running"
        pendingFilter="Completed"
        taskCounts={taskCounts}
        announcement="2 running tasks shown."
        onFilterChange={onFilterChange}
        selectionMovementStyle={{ transitionDuration: "120ms", transitionTimingFunction: "ease-out" }}
      />,
    );

    const tablist = screen.getByRole("tablist", { name: "Task status filters" });
    const runningTab = within(tablist).getByRole("tab", { name: "Running tasks filter, 2 tasks. Running filter is already selected." });
    const completedTab = within(tablist).getByRole("tab", { name: "Completed tasks filter, 1 task. Completed filter selection is already in progress." });

    fireEvent.click(runningTab);
    fireEvent.click(completedTab);

    expect(onFilterChange).not.toHaveBeenCalled();
    expect(completedTab).toHaveAttribute("aria-disabled", "true");
    expect(completedTab).toHaveAttribute("aria-busy", "true");
    expect(completedTab).toHaveAttribute("title", "Completed filter selection is already in progress.");
  });
});
