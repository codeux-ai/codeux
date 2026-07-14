import { describe, expect, it } from "vitest";
import type { TaskSelfReflectionRating } from "../../../../../src/contracts/task-self-reflection-types.js";
import {
  buildSelfReflectionRatingViewModel,
  formatSelfReflectionRatingAriaLabel,
  formatSelfReflectionRatingLabel,
  getSelfReflectionStarStates,
  normalizeSelfReflectionRating,
  sortSelfReflectionSectionRatings,
} from "../../../../../dashboard/src/v2/lib/tasks/self-reflection-rating.js";

const createRating = (overrides: Partial<TaskSelfReflectionRating> = {}): TaskSelfReflectionRating => ({
  id: "rating-1",
  projectId: "project-1",
  sprintId: "sprint-1",
  taskId: "task-1",
  sourceTaskRunId: "run-1",
  overallRating: 4.2,
  sections: [],
  capturedAt: "2026-07-07T00:00:00.000Z",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
  ...overrides,
});

describe("self-reflection rating helpers", () => {
  it("normalizes finite ratings and rejects absent or non-numeric values", () => {
    expect(normalizeSelfReflectionRating(-2)).toBe(0);
    expect(normalizeSelfReflectionRating(2.75)).toBe(2.75);
    expect(normalizeSelfReflectionRating(7)).toBe(5);
    expect(normalizeSelfReflectionRating(Number.NaN)).toBeNull();
    expect(normalizeSelfReflectionRating("4" as unknown)).toBeNull();
    expect(normalizeSelfReflectionRating(undefined)).toBeNull();
  });

  it("computes filled, half, and empty star states from clamped ratings", () => {
    expect(getSelfReflectionStarStates(3.25)).toEqual(["filled", "filled", "filled", "half", "empty"]);
    expect(getSelfReflectionStarStates(4.8)).toEqual(["filled", "filled", "filled", "filled", "filled"]);
    expect(getSelfReflectionStarStates(-1)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
    expect(getSelfReflectionStarStates(Number.POSITIVE_INFINITY)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
  });

  it("formats compact and accessible rating labels", () => {
    expect(formatSelfReflectionRatingLabel(4)).toBe("4/5");
    expect(formatSelfReflectionRatingLabel(4.24)).toBe("4.2/5");
    expect(formatSelfReflectionRatingAriaLabel(4.24)).toBe("Self-reflection rating 4.2 out of 5");
    expect(formatSelfReflectionRatingLabel("bad" as unknown)).toBeNull();
  });

  it("formats German rating values without changing rating thresholds", () => {
    expect(formatSelfReflectionRatingLabel(4.5, "de")).toBe("4,5/5");
    expect(formatSelfReflectionRatingAriaLabel(4.5, "de")).toBe("Selbstreflexionsbewertung 4,5 von 5");
    expect(getSelfReflectionStarStates(4.5)).toEqual(["filled", "filled", "filled", "filled", "half"]);
  });

  it("sorts section ratings by normalized label and then visible label", () => {
    const sorted = sortSelfReflectionSectionRatings([
      { label: "Scope", normalizedLabel: "scope", rating: 3, note: null },
      { label: "Build", normalizedLabel: "implementation", rating: 5, note: null },
      { label: "Architecture", normalizedLabel: "architecture", rating: 4, note: null },
      { label: "Implementation", normalizedLabel: "implementation", rating: 4, note: null },
    ]);

    expect(sorted.map((section) => section.label)).toEqual([
      "Architecture",
      "Build",
      "Implementation",
      "Scope",
    ]);
  });

  it("builds a view model with clamped section ratings and trimmed notes", () => {
    const viewModel = buildSelfReflectionRatingViewModel(createRating({
      overallRating: 6,
      sections: [
        { label: "Implementation", normalizedLabel: "implementation", rating: 4.5, note: "  Strong coverage. " },
        { label: "Scope", normalizedLabel: "scope", rating: -1, note: "   " },
        { label: "Invalid", normalizedLabel: "invalid", rating: Number.NaN, note: "Drop me" },
      ],
    }));

    expect(viewModel?.overallRating).toBe(5);
    expect(viewModel?.overallRatingLabel).toBe("5/5");
    expect(viewModel?.sections).toHaveLength(2);
    expect(viewModel?.sections[0]).toMatchObject({
      label: "Implementation",
      rating: 4.5,
      ratingLabel: "4.5/5",
      note: "Strong coverage.",
    });
    expect(viewModel?.sections[1]).toMatchObject({
      label: "Scope",
      rating: 0,
      ratingLabel: "0/5",
      note: null,
    });
  });

  it("returns null when overall rating data is absent or malformed", () => {
    expect(buildSelfReflectionRatingViewModel(null)).toBeNull();
    expect(buildSelfReflectionRatingViewModel(createRating({ overallRating: Number.NaN }))).toBeNull();
  });
});
