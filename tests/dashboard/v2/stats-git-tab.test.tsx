/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { render, screen, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, describe, it, beforeEach } from "vitest";
import { GitTelemetryTab } from "../../../dashboard/src/v2/pages/stats/components/GitTelemetryTab.jsx";

expect.extend(matchers);

const mockGitStats = {
  totals: {
    insertions: 500,
    deletions: 200,
    filesChanged: 10,
    prCount: 2,
    mergedCount: 1,
  },
  buckets: [],
  tasks: [
    {
      id: "task-1",
      label: "Fix issue 1",
      secondaryLabel: null,
      metrics: { insertions: 100, deletions: 50, filesChanged: 2, prCount: 1, mergedCount: 1 },
    },
    {
      id: "task-2",
      label: "Add feature X",
      secondaryLabel: "PROJ-123",
      metrics: { insertions: 400, deletions: 150, filesChanged: 8, prCount: 1, mergedCount: 0 },
    },
  ],
  sprints: [
    {
      id: "sprint-1",
      label: "Sprint 1",
      secondaryLabel: "Week 1",
      metrics: { insertions: 500, deletions: 200, filesChanged: 10, prCount: 2, mergedCount: 1 },
    },
  ],
};

describe("GitTelemetryTab", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as any;
    }
  });

  it("renders Task Leaderboard by default", () => {
    render(<GitTelemetryTab gitStats={mockGitStats as any} />);
    expect(screen.getByText("Task Git Ledger")).toBeInTheDocument();
    expect(screen.getByText("Fix issue 1")).toBeInTheDocument();
    expect(screen.getByText("Add feature X")).toBeInTheDocument();
  });

  it("switches to Sprint Leaderboard", () => {
    render(<GitTelemetryTab gitStats={mockGitStats as any} />);
    const buttons = screen.getAllByRole("button", { name: "Sprint Leaderboard" });
    fireEvent.click(buttons[0] as HTMLElement);
    expect(screen.getByText("Sprint Git Ledger")).toBeInTheDocument();
    expect(screen.getByText("Sprint 1")).toBeInTheDocument();
  });

  it("can sort by insertions, deletions, files, prs, merges", () => {
    render(<GitTelemetryTab gitStats={mockGitStats as any} />);

    // Default is insertions, Add feature X has 400 vs Fix issue 1 has 100
    // so Add feature X should be first.
    const tasks = screen.getAllByText(/Fix issue 1|Add feature X/);
    expect(tasks[0]?.textContent).toBe("Add feature X");

    // Sort by name
    const buttons = screen.getAllByRole("button", { name: /Name/i });
    fireEvent.click(buttons[0] as HTMLElement);
    // A comes before F
    const tasksByName = screen.getAllByText(/Fix issue 1|Add feature X/);
    expect(tasksByName[0]?.textContent).toBe("Add feature X");
  });

  it("shows empty states if items are empty", () => {
    render(<GitTelemetryTab gitStats={{...mockGitStats, tasks: []} as any} />);
    expect(screen.getByText("No task git telemetry landed in this window yet.")).toBeInTheDocument();
  });
});
