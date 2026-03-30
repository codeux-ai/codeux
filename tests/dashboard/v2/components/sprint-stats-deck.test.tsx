/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { render } from "@testing-library/preact";
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { SprintStatsDeck } from "../../../../dashboard/src/v2/components/SprintStatsDeck";
import type { DashboardStats } from "../../../../dashboard/src/v2/types";

expect.extend(matchers);

describe("SprintStatsDeck", () => {
  const mockStats: DashboardStats = {
    running: 1,
    codingCompleted: 2,
    completed: 3,
    failed: 0,
    ci: 4,
    automerge: 5,
    merged: 6,
    mergeBlocked: 2,
    mergeConflicts: 1,
  };

  const mockSprintTiming = {
    sprintStartedAt: "2023-01-01T00:00:00Z",
    sprintElapsedSeconds: 3600,
    trackedTaskCount: 10,
    completedTaskCount: 3,
    averageCompletedTaskSeconds: 1200,
    longestTask: null,
    stageTotals: {
      queued: 0,
      coding: 0,
      ci: 0,
      autofix: 0,
      merge: 0,
    },
    activeStageCounts: {
      queued: 0,
      coding: 0,
      ci: 0,
      autofix: 0,
      merge: 0,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calculates merge pressure correctly (excluding automerge)", () => {
    const { getByText } = render(
      <SprintStatsDeck
        hasSprintContext={true}
        stats={mockStats}
        tasks={[]}
        sprintTiming={mockSprintTiming}
      />
    );

    // mergePressure = stats.ci (4) + stats.mergeBlocked (2) + stats.mergeConflicts (1) = 7
    // automerge (5) should NOT be included.

    // Find the SummaryPill for Pressure.
    const pressureLabel = getByText("Pressure");
    const pressureContainer = pressureLabel.closest("div")?.parentElement;

    expect(pressureContainer).toBeInTheDocument();

    // The value should be '7'
    const valueElement = pressureContainer?.querySelector(".font-mono");
    expect(valueElement).toHaveTextContent("7");
  });

  it("renders Automerge with text-status-green accent", () => {
    const { getAllByText } = render(
      <SprintStatsDeck
        hasSprintContext={true}
        stats={mockStats}
        tasks={[]}
        sprintTiming={mockSprintTiming}
      />
    );

    const automergeLabels = getAllByText("Automerge");
    expect(automergeLabels.length).toBeGreaterThan(0);

    // Check the first found Automerge label's container.
    const labelContainer = automergeLabels[0].closest("div");

    expect(labelContainer).toHaveClass("text-status-green");
    expect(labelContainer).not.toHaveClass("text-ember-500");
  });
});