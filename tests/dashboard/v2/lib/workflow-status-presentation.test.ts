import { describe, expect, it } from "vitest";
import type { CiStatusPresentation } from "../../../../dashboard/src/v2/lib/ci-status-presentation.js";
import { deriveWorkflowStatusPresentation } from "../../../../dashboard/src/v2/lib/workflow-status-presentation.js";
import type { ExecutionAttentionItemSummary } from "../../../../dashboard/src/types.js";

const attention = (
  overrides: Partial<ExecutionAttentionItemSummary> = {},
): ExecutionAttentionItemSummary => ({
  id: "attention-1",
  sprintId: "sprint-1",
  taskId: "task-record-1",
  sprintRunId: "run-1",
  dispatchId: "dispatch-1",
  attentionType: "human_escalation_required",
  severity: "high",
  ownerType: "human",
  status: "open",
  assignedWorkerEndpointId: null,
  title: "Operator decision required",
  summaryMarkdown: "Choose the safe recovery path.",
  payload: null,
  openedAt: "2026-07-14T08:00:00.000Z",
  claimedAt: null,
  resolvedAt: null,
  updatedAt: "2026-07-14T08:00:00.000Z",
  ...overrides,
});

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
  it("keeps a durable seven-stage sprint flow when CI evidence is absent", () => {
    const presentation = deriveWorkflowStatusPresentation({ scope: "sprint", status: "running" });

    expect(presentation.stages.map((stage) => stage.id)).toEqual([
      "planning",
      "coding",
      "qa",
      "pull_request",
      "checks",
      "merge",
      "completion",
    ]);
    expect(presentation.label).toBe("Coding in progress");
    expect(presentation.stages[0]).toMatchObject({ state: "successful", statusLabel: "Planning complete" });
    expect(presentation.stages[3]).toMatchObject({ state: "pending", statusLabel: "Waiting for pull request" });
    expect(presentation.accessibleLabel).toContain("Completion: Completion pending");
  });

  it("shows active sprint planning as the first workflow stage", () => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "sprint",
      status: "idle",
      tasksCount: 0,
      planningStatus: "running",
    });

    expect(presentation).toMatchObject({ state: "in_progress", label: "Planning in progress" });
    expect(presentation.stages.map((stage) => stage.id)).toEqual([
      "planning",
      "coding",
      "qa",
      "pull_request",
      "checks",
      "merge",
      "completion",
    ]);
    expect(presentation.stages[0]).toMatchObject({ state: "in_progress", statusLabel: "Planning in progress" });
    expect(presentation.stages.slice(1).every((stage) => stage.state === "pending")).toBe(true);
  });

  it("keeps a running sprint on Coding instead of aggregating task gate activity", () => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "sprint",
      status: "running",
      completion: 60,
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
    expect(presentation.stages[1]).toMatchObject({ state: "in_progress", statusLabel: "Coding in progress" });
    expect(presentation.stages[2]).toMatchObject({ state: "pending", statusLabel: "QA pending" });
    expect(presentation.stages[3]).toMatchObject({ state: "pending", statusLabel: "Waiting for pull request" });
    expect(presentation.stages[4]).toMatchObject({ state: "pending", statusLabel: "Checks pending" });
    expect(presentation.stages[5]).toMatchObject({ state: "pending", statusLabel: "Merge pending" });
  });

  it.each(["failed", "cancelled"] as const)(
    "does not let historical %s planning override a running sprint",
    (planningStatus) => {
      const presentation = deriveWorkflowStatusPresentation({
        scope: "sprint",
        status: "running",
        completion: 60,
        tasksCount: 4,
        planningStatus,
        ciPresentation: successfulCi,
      });

      expect(presentation).toMatchObject({ state: "in_progress", label: "Coding in progress" });
      expect(presentation.stages[0]).toMatchObject({
        state: "successful",
        statusLabel: "Planning complete",
      });
      expect(presentation.stages[1]).toMatchObject({
        state: "in_progress",
        statusLabel: "Coding in progress",
      });
      expect(presentation.stages.slice(2, 6).every((stage) => stage.state === "pending")).toBe(true);
    },
  );

  it("uses an active sprint-completion review as the QA stage in German", () => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "sprint",
      status: "running",
      completion: 100,
      ciPresentation: successfulCi,
      review: {
        status: "in_progress",
        outcome: null,
        summary: "Externally supplied review summary",
        findings: [],
        reviewer: "QA Worker",
        finishedAt: null,
      },
    }, "de");

    expect(presentation).toMatchObject({ state: "in_progress", label: "QA läuft" });
    expect(presentation.stages[1]).toMatchObject({ state: "successful", statusLabel: "Implementierung abgeschlossen" });
    expect(presentation.stages[2]).toMatchObject({ state: "in_progress", statusLabel: "Prüfung läuft" });
    expect(presentation.stages[4]).toMatchObject({ state: "successful", statusLabel: "Checks passed" });
  });

  it("restores a completed QA outcome when remediation reaches 100%", () => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "sprint",
      status: "running",
      completion: 100,
      review: {
        status: "completed",
        outcome: "changes_requested",
        summary: "One final correction is required.",
        findings: [],
        reviewer: "QA Worker",
        finishedAt: "2026-07-14T08:00:00.000Z",
      },
    });

    expect(presentation).toMatchObject({ state: "failed", tone: "qa_changes", label: "QA changes" });
    expect(presentation.stages[1]).toMatchObject({ state: "successful", statusLabel: "Coding complete" });
    expect(presentation.stages[2]).toMatchObject({ state: "failed", statusLabel: "Changes requested" });
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
    expect(presentation.stages[3]).toMatchObject({ state: "successful", statusLabel: "Pull request ready" });
    expect(presentation.stages[4]).toMatchObject({ state: "successful", statusLabel: "Checks passed" });
    expect(presentation.stages[5]).toMatchObject({ state: "successful", statusLabel: "Merged" });
    expect(presentation.stages.every((stage) => stage.state === "successful")).toBe(true);
  });

  it.each(["failed", "cancelled"] as const)(
    "does not let historical %s planning override a completed sprint",
    (planningStatus) => {
      const presentation = deriveWorkflowStatusPresentation({
        scope: "sprint",
        status: "completed",
        completion: 100,
        tasksCount: 4,
        planningStatus,
      });

      expect(presentation).toMatchObject({ state: "successful", label: "Completed" });
      expect(presentation.stages[0]).toMatchObject({
        state: "successful",
        statusLabel: "Planning complete",
      });
      expect(presentation.stages.every((stage) => stage.state === "successful")).toBe(true);
    },
  );

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

  it("gives an active human-only intervention red Human needed precedence", () => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "task",
      status: "running",
      humanIntervention: attention(),
    });

    expect(presentation).toMatchObject({
      state: "failed",
      tone: "failed",
      label: "Human needed",
      requiresHuman: true,
    });
    expect(presentation.stages).toHaveLength(6);
    expect(presentation.stages[0]).toMatchObject({ state: "in_progress", statusLabel: "Coding in progress" });
    expect(presentation.accessibleLabel).toContain("Operator decision required");
  });

  it("falls back to the lifecycle after the human intervention is resolved", () => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "task",
      status: "running",
      humanIntervention: attention({ status: "resolved", resolvedAt: "2026-07-14T09:00:00.000Z" }),
    });

    expect(presentation).toMatchObject({
      state: "in_progress",
      tone: "active",
      label: "Coding in progress",
      requiresHuman: false,
    });
  });

  it.each([
    ["worker-owned", attention({ ownerType: "worker" })],
    ["system-owned", attention({ ownerType: "system" })],
    ["worker-assigned", attention({ assignedWorkerEndpointId: "worker-endpoint-1" })],
  ])("does not classify %s attention as Human needed", (_label, humanIntervention) => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "task",
      status: "running",
      humanIntervention,
    });

    expect(presentation).toMatchObject({ label: "Coding in progress", requiresHuman: false });
  });

  it("does not treat an ambiguous sprint-run intervention summary as pure human attention", () => {
    const presentation = deriveWorkflowStatusPresentation({
      scope: "sprint",
      status: "paused",
      humanIntervention: {
        ownerType: "human",
        title: "Sprint paused",
      },
    });

    expect(presentation).toMatchObject({
      label: "Coding paused",
      state: "in_progress",
      requiresHuman: false,
    });
  });
});
