import { describe, expect, it } from "vitest";
import type { Subtask } from "../../../../dashboard/src/types.js";
import { areDagNodePropsEqual } from "../../../../dashboard/src/v2/components/SprintDag.js";

function node(taskOverrides: Partial<Subtask> = {}) {
  return {
    node: {
      task: {
        id: "T1",
        record_id: "task-1",
        title: "Original title",
        prompt: "Original prompt",
        depends_on: [],
        status: "RUNNING",
        is_independent: true,
        ...taskOverrides,
      },
      phase: "RUNNING",
      depth: 0,
      row: 0,
      order: 0,
      incoming: [],
      outgoing: [],
      isReady: false,
      hover: {
        prompt: "Original prompt",
        dependencies: [],
        counters: { incoming: 0, outgoing: 0 },
      },
      isFocusMode: true,
      x: 110,
      y: 110,
    },
  } as Parameters<typeof areDagNodePropsEqual>[0];
}

describe("SprintDag node memoization", () => {
  it("rerenders when task title or status changes", () => {
    const previous = node();
    expect(areDagNodePropsEqual(previous, node({ title: "Updated title" }))).toBe(false);
    expect(areDagNodePropsEqual(previous, node({ status: "COMPLETED" }))).toBe(false);
  });

  it("rerenders when QA review content changes", () => {
    const baseReview = {
      status: "completed",
      outcome: "passed",
      summary: "Initial review",
      findings: [],
      reviewer: "QA",
      finishedAt: "2026-07-16T08:00:00.000Z",
    };
    const previous = node({ latestReview: baseReview });
    const next = node({ latestReview: { ...baseReview, summary: "Updated review" } });

    expect(areDagNodePropsEqual(previous, next)).toBe(false);
  });
});
