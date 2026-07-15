// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import type { CiStatusPresentation } from "../../../../../dashboard/src/v2/lib/ci-status-presentation.js";
import { WorkflowStatusBadge } from "../../../../../dashboard/src/v2/components/ui/WorkflowStatusBadge.js";
import type { ExecutionAttentionItemSummary } from "../../../../../dashboard/src/types.js";
import { renderWithI18n } from "../../../render-with-i18n.js";

afterEach(cleanup);

const failedCi: CiStatusPresentation = {
  scope: "task",
  state: "failed",
  label: "CI failed",
  accessibleLabel: "CI failed. Pull request: Pull request ready. Checks: Checks failed. Merge: Blocked by checks.",
  failureKind: "ci_checks",
  steps: [
    { id: "pull_request", label: "Pull request", state: "successful", statusLabel: "Pull request ready" },
    { id: "checks", label: "Checks", state: "failed", statusLabel: "Checks failed", failureKind: "ci_checks" },
    { id: "merge", label: "Merge", state: "pending", statusLabel: "Blocked by checks" },
  ],
};

const review = {
  status: "completed",
  outcome: "changes_requested",
  summary: "Add deterministic reconnect coverage.",
  findings: ["The recovery branch needs a regression test."],
  reviewer: "QA Reviewer",
  finishedAt: "2026-07-14T08:00:00.000Z",
} as const;

const activeSprintReview = {
  status: "in_progress",
  outcome: null,
  summary: "Provider-authored QA summary stays verbatim.",
  findings: [],
  reviewer: "QA Reviewer",
  finishedAt: null,
} as const;

const humanIntervention: ExecutionAttentionItemSummary = {
  id: "attention-human",
  sprintId: "sprint-1",
  taskId: "task-1",
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
};

describe("WorkflowStatusBadge", () => {
  it("renders the bright QA-edits trigger and reveals connected workflow and review cards", () => {
    const { container } = render(
      <WorkflowStatusBadge
        scope="task"
        status="coding_completed"
        review={review}
        ciPresentation={failedCi}
        compact
      />,
    );

    const trigger = screen.getByRole("button", { name: /CI status: CI failed/i });
    expect(trigger).toHaveTextContent("QA edits");
    expect(trigger).toHaveClass("text-blue-700");
    expect(screen.getByRole("button", { name: "QA review details" }).querySelector(".workflow-status__chevron")).toBeInTheDocument();

    fireEvent.mouseEnter(trigger.closest("[data-workflow-state]") as Element);
    const workflow = screen.getByRole("region", { name: "CI workflow details" });
    expect(workflow.querySelectorAll("[data-workflow-stage]")).toHaveLength(6);
    expect(workflow.querySelectorAll(".workflow-status__connector")).toHaveLength(5);
    const codingStage = workflow.querySelector('[data-workflow-stage="coding"]') as HTMLElement;
    const codingMarker = codingStage.querySelector("[data-workflow-stage-marker]") as HTMLElement;
    expect(codingMarker.parentElement).toHaveClass("items-center", "self-stretch");
    expect(codingStage.lastElementChild).toHaveClass("min-h-12", "items-center");
    expect(within(workflow).getByText("Coding")).toBeVisible();
    expect(within(workflow).getByText("Completion")).toBeVisible();
    expect(screen.getByRole("region", { name: "QA Changes Requested" })).toHaveTextContent(review.summary);
    expect(container.querySelector('[data-qa-state="changes_requested"]')).toBeInTheDocument();
    expect(workflow).toHaveAttribute("data-glass");
    expect(workflow).toHaveAttribute("data-workflow-overlay-surface", "translucent");
    expect(workflow).toHaveClass("rounded-[1.65rem]", "border", "bg-white/[0.82]", "backdrop-blur-xl");
    expect(within(workflow).getByRole("region", { name: "Workflow status card" })).toHaveClass("rounded-[1.4rem]", "border", "bg-white");
    expect(workflow.querySelector(".workflow-status__chevron")).toBeInTheDocument();
  });

  it("remains interactive without a QA review or CI projection", () => {
    render(<WorkflowStatusBadge scope="sprint" status="running" compact />);

    const trigger = screen.getByRole("button", { name: /CI status: Coding in progress/i });
    expect(trigger).toBeVisible();
    fireEvent.click(trigger);
    const workflow = screen.getByRole("region", { name: "CI workflow details" });
    expect(workflow.querySelectorAll("[data-workflow-stage]")).toHaveLength(6);
    expect(screen.queryByRole("button", { name: "QA review details" })).not.toBeInTheDocument();
  });

  it("does not expose task gate aggregation from a running sprint badge", () => {
    render(<WorkflowStatusBadge scope="sprint" status="running" ciPresentation={failedCi} compact />);

    const trigger = screen.getByRole("button", { name: /CI status: Coding in progress/i });
    expect(trigger).toHaveTextContent("Coding in progress");
    expect(trigger.closest("[data-workflow-state]")).toHaveAttribute("data-ci-state", "in_progress");
    expect(trigger).not.toHaveAccessibleName(/CI failed/i);
  });

  it.each([
    ["en", "QA running", "Review in progress"],
    ["de", "QA läuft", "Prüfung läuft"],
  ] as const)("shows active sprint-level QA in %s", (locale, badgeLabel, reviewLabel) => {
    renderWithI18n(
      <WorkflowStatusBadge scope="sprint" status="running" completion={100} review={activeSprintReview} compact />,
      {},
      locale,
    );

    const trigger = screen.getByRole("button", { name: new RegExp(badgeLabel) });
    expect(trigger).toHaveTextContent(badgeLabel);
    expect(trigger.closest("[data-workflow-state]")).toHaveAttribute("data-qa-state", "running");
    fireEvent.click(trigger);
    expect(screen.getByRole("region", { name: /workflow details|Workflow-Details/i })).toHaveTextContent(reviewLabel);
    expect(screen.getByText("Provider-authored QA summary stays verbatim.")).toBeInTheDocument();
  });

  it("renders active human-only intervention as a red Human needed workflow", () => {
    render(
      <WorkflowStatusBadge
        scope="task"
        status="running"
        ciPresentation={failedCi}
        humanIntervention={humanIntervention}
        compact
      />,
    );

    const trigger = screen.getByRole("button", { name: /CI status: Human needed/i });
    expect(trigger).toHaveTextContent("Human needed");
    expect(trigger).toHaveClass("text-status-red");
    expect(trigger.closest("[data-workflow-state]")).toHaveAttribute("data-human-needed", "true");

    fireEvent.click(trigger);
    const workflow = screen.getByRole("region", { name: "CI workflow details" });
    expect(workflow.querySelectorAll("[data-workflow-stage]")).toHaveLength(6);
    expect(within(workflow).getByText("Operator decision required")).toBeInTheDocument();
  });
});
