/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { TaskRow } from "../../../dashboard/src/v2/components/ui/TaskRow.js";
import type { Task } from "../../../dashboard/src/v2/types.js";

const makeTask = (latestReview?: Task["latestReview"]): Task => ({
  recordId: "task-record-1",
  id: "T1",
  source: "Project",
  sprint: "Sprint",
  sprintId: "sprint-1",
  title: "Reviewed task",
  status: "coding_completed",
  priority: "medium",
  executorType: "docker_cli",
  assignee: "CLI",
  time: "Review",
  createdAt: "2026-05-30T09:00:00.000Z",
  updatedAt: "2026-05-30T09:00:00.000Z",
  promptMarkdown: "Implement the task",
  description: "Implement the task",
  dependsOnTaskIds: [],
  isIndependent: true,
  isMerged: false,
  latestReview,
  mergeIndicator: null,
});

describe("TaskRow QA review indicator", () => {
  it("shows a visible task QA indicator when a latest review exists", () => {
    render(<TaskRow task={makeTask({
      status: "completed",
      outcome: "pass",
      summary: "Looks good.",
      findings: [],
      reviewer: "QA Bot",
      finishedAt: "2026-05-30T09:10:00.000Z",
    })} />);

    expect(screen.getByLabelText("QA review details")).toBeTruthy();
    expect(screen.getByText("QA")).toBeTruthy();
  });
});
