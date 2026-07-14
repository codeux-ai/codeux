/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { GitTelemetryTab } from "../components/GitTelemetryTab.js";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

const mockGitStats = {
  totals: {
    insertions: 120,
    deletions: 45,
    filesChanged: 12,
    prCount: 8,
    mergedCount: 5,
    mergeConflictCount: 2,
  },
  buckets: [
    {
      bucketStart: "2026-06-01T00:00:00.000Z",
      bucketEnd: "2026-06-01T23:59:59.999Z",
      label: "Jun 1",
      metrics: {
        insertions: 90,
        deletions: 20,
        filesChanged: 6,
        prCount: 4,
        mergedCount: 3,
        mergeConflictCount: 1,
      },
    },
    {
      bucketStart: "2026-06-02T00:00:00.000Z",
      bucketEnd: "2026-06-02T23:59:59.999Z",
      label: "Jun 2",
      metrics: {
        insertions: 30,
        deletions: 25,
        filesChanged: 6,
        prCount: 4,
        mergedCount: 2,
        mergeConflictCount: 1,
      },
    },
  ],
  tasks: [
    {
      id: "task-1",
      label: "TASK-1",
      secondaryLabel: "Alpha",
      metrics: {
        insertions: 60,
        deletions: 20,
        filesChanged: 4,
        prCount: 4,
        mergedCount: 3,
        mergeConflictCount: 1,
      },
    },
    {
      id: "task-2",
      label: "TASK-2",
      secondaryLabel: "Beta",
      metrics: {
        insertions: 20,
        deletions: 10,
        filesChanged: 2,
        prCount: 2,
        mergedCount: 1,
        mergeConflictCount: 0,
      },
    },
  ],
  sprints: [
    {
      id: "sprint-1",
      label: "Sprint 1",
      secondaryLabel: null,
      metrics: {
        insertions: 30,
        deletions: 15,
        filesChanged: 5,
        prCount: 3,
        mergedCount: 2,
        mergeConflictCount: 1,
      },
    },
  ],
} as any;

describe("GitTelemetryTab", () => {
  it("renders summary cards, rankings, and leaderboard tabs", () => {
    render(<GitTelemetryTab gitStats={mockGitStats} />);

    expect(screen.getAllByText("Insertions").length).toBeGreaterThan(0);
    expect(screen.getByText("Merge Conflicts")).toBeTruthy();
    expect(screen.getByText("Ranking Snapshot")).toBeTruthy();
    expect(screen.getByText(/Jun 1/)).toBeTruthy();
    expect(screen.getAllByText("TASK-1").length).toBeGreaterThan(0);

    expect(screen.getByRole("tab", { name: /Task Leaderboard/i })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Sprint Leaderboard/i }));
    expect(screen.getByRole("tab", { name: /Sprint Leaderboard/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Sprint Git Telemetry")).toBeTruthy();
  });
});
