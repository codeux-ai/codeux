import { describe, expect, it } from "vitest";
import type { CiStatusPresentation } from "../../../../dashboard/src/v2/lib/ci-status-presentation.js";
import { deriveWorkflowStatusPresentation } from "../../../../dashboard/src/v2/lib/workflow-status-presentation.js";

const successfulCi: CiStatusPresentation = {
  scope: "task",
  state: "successful",
  label: "CI passed",
  accessibleLabel: "CI passed. Pull request: Pull request ready. Checks: Checks passed. Merge: Merged.",
  steps: [
    { id: "pull_request", label: "Pull request", state: "successful", statusLabel: "Pull request ready" },
    { id: "checks", label: "Checks", state: "successful", statusLabel: "Checks passed" },
    { id: "merge", label: "Merge", state: "successful", statusLabel: "Merged" },
  ],
};

describe("deriveWorkflowStatusPresentation", () => {
  it("keeps a durable six-stage flow when CI evidence is absent", () => {
    const presentation = deriveWorkflowStatusPresentation({ scope: "sprint", status: "running" });

    expect(presentation.stages.map((stage) => stage.id)).toEqual([
      "coding",
      "pull_request",
      "qa",
      "checks",
      "merge",
      "completion",
    ]);
    expect(presentation.label).toBe("Coding in progress");
    expect(presentation.stages[1]).toMatchObject({ state: "pending", statusLabel: "Waiting for pull request" });
    expect(presentation.accessibleLabel).toContain("Completion: Completion pending");
  });

  it("keeps a running sprint on Coding instead of aggregating task gate activity", () => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "sprint",
      status: "running",
      ciPresentation: successfulCi,
      review: {
        status: "completed",
        outcome: "changes_requested",
        summary: "An earlier review requested edits.",
        findings: [],
        reviewer: "QA Reviewer",
        finishedAt: "2026-07-14T08:00:00.000Z",
      },
    });

    expect(presentation).toMatchObject({ state: "in_progress", label: "Coding in progress" });
    expect(presentation.stages[0]).toMatchObject({ state: "in_progress", statusLabel: "Coding in progress" });
    expect(presentation.stages[1]).toMatchObject({ state: "pending", statusLabel: "Waiting for pull request" });
    expect(presentation.stages[2]).toMatchObject({ state: "pending", statusLabel: "QA pending" });
    expect(presentation.stages[3]).toMatchObject({ state: "pending", statusLabel: "Checks pending" });
    expect(presentation.stages[4]).toMatchObject({ state: "pending", statusLabel: "Merge pending" });
  });

  it("settles the complete workflow when status, QA, CI, and merge have succeeded", () => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "task",
      status: "completed",
      ciPresentation: successfulCi,
      review: {
        status: "completed",
        outcome: "approved",
        summary: "Ready to ship.",
        findings: [],
        reviewer: "QA Reviewer",
        finishedAt: "2026-07-14T08:00:00.000Z",
      },
    });

    expect(presentation.label).toBe("Completed");
    expect(presentation.state).toBe("successful");
    expect(presentation.stages.every((stage) => stage.state === "successful")).toBe(true);
  });

  it("settles PR, CI, and merge fallbacks for a completed sprint without gate history", () => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "sprint",
      status: "completed",
    });

    expect(presentation).toMatchObject({ state: "successful", label: "Completed" });
    expect(presentation.stages[1]).toMatchObject({ state: "successful", statusLabel: "Pull request ready" });
    expect(presentation.stages[3]).toMatchObject({ state: "successful", statusLabel: "Checks passed" });
    expect(presentation.stages[4]).toMatchObject({ state: "successful", statusLabel: "Merged" });
    expect(presentation.stages.every((stage) => stage.state === "successful")).toBe(true);
  });

  it("uses the bright blue QA-edit tone for requested changes", () => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "task",
      status: "coding_completed",
      ciPresentation: successfulCi,
      review: {
        status: "completed",
        outcome: "changes_requested",
        summary: "One edit remains.",
        findings: ["Add reconnect coverage."],
        reviewer: "QA Reviewer",
        finishedAt: "2026-07-14T08:00:00.000Z",
      },
    });

    expect(presentation).toMatchObject({ state: "failed", tone: "qa_changes", label: "QA changes" });
    expect(presentation.stages[2]).toMatchObject({ id: "qa", state: "failed", statusLabel: "Changes requested" });
  });

  it("preserves live runtime wait labels inside the coding stage", () => {
    const presentation = deriveWorkflowStatusPresentation({ scope: "task", status: "QUOTA" });
    expect(presentation).toMatchObject({ state: "in_progress", label: "Quota wait" });
    expect(presentation.stages[0].statusLabel).toBe("Quota wait");
  });
});
