import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";
afterEach(() => { cleanup(); });
/** @jsx h */
/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { SprintCell } from "../../../dashboard/src/v2/components/sprints/SprintCell";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search, to, ...props }: any) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`} {...props}>{children}</a>
  ),
}));

describe("SprintCell", () => {
  const defaultSprint = {
    id: "sprint-1",
    projectId: "proj-1",
    name: "Feature Alpha",
    goal: "Build Alpha",
    slug: "alpha",
    status: "idle" as const,
    tasksCount: 5,
    completion: 0,
    showcasePinned: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };

  it("renders sprint details correctly", () => {
    render(<SprintCell sprint={defaultSprint} isEven={true} accentColor="text-blue-500" />);
    expect(screen.getByText("Feature Alpha")).toBeDefined();
    expect(screen.getByText("5")).toBeDefined();
  });

  it("renders whole and fractional completion without rounding", () => {
    render(
      <>
        <SprintCell sprint={{ ...defaultSprint, id: "sprint-5", tasksCount: 10, completion: 5 }} isEven={true} accentColor="text-blue-500" />
        <SprintCell sprint={{ ...defaultSprint, id: "sprint-7-5", tasksCount: 10, completion: 7.5 }} isEven={false} accentColor="text-blue-500" />
      </>
    );

    expect(screen.getByText("5%")).toBeDefined();
    expect(screen.getByText("7.5%")).toBeDefined();
    expect(screen.queryByText("8%")).toBeNull();
  });

  it("links to project-aware tasks and live routes", () => {
    render(<SprintCell sprint={defaultSprint} isEven={true} accentColor="text-blue-500" />);

    const tasksLink = screen.getByRole("link", { name: "Open tasks for sprint Feature Alpha" });
    const liveLink = screen.getByRole("link", { name: "Open live session for sprint Feature Alpha" });
    expect(tasksLink.textContent).toContain("Tasks");
    expect(liveLink.textContent).toContain("Live");
    expect(tasksLink.getAttribute("href")).toBe("/tasks?projectId=proj-1&sprintId=sprint-1");
    expect(liveLink.getAttribute("href")).toBe("/live?projectId=proj-1&sprintId=sprint-1");
    expect(screen.queryByText("View Tasks")).toBeNull();
  });

  it("calls onMarkCompleted when menu action is clicked", async () => {
    const onMarkCompleted = vi.fn();
    render(
      <SprintCell
        sprint={defaultSprint}
        isEven={true}
        accentColor="text-blue-500"
        onMarkCompleted={onMarkCompleted}
      />
    );

    const menuButton = screen.getByTitle("Settings");
    fireEvent.click(menuButton);

    await waitFor(() => {
      const markCompletedButton = screen.getByText("Mark Completed");
      expect(markCompletedButton).toBeDefined();
    });

    fireEvent.click(screen.getByText("Mark Completed"));
    expect(onMarkCompleted).toHaveBeenCalled();
  });

  it("displays QA Reviewed badge and hover summary", async () => {
    const sprintWithReview = {
      ...defaultSprint,
      latestReview: {
        status: "reviewed",
        outcome: "approved",
        summary: "Everything looks solid.",
        reviewer: "Jules",
        finishedAt: "2024-01-02T00:00:00.000Z"
      }
    };

    render(
      <SprintCell
        sprint={sprintWithReview}
        isEven={true}
        accentColor="text-blue-500"
      />
    );

    const reviewBadge = screen.getByLabelText("QA review details");
    expect(reviewBadge).toBeDefined();
    fireEvent.mouseEnter(reviewBadge.parentElement as Element);

    await waitFor(() => {
      expect(screen.getByText("QA Review Complete")).toBeDefined();
    });

    // Check for the summary content
    expect(screen.getByText("Everything looks solid.")).toBeDefined();
    expect(screen.getByText("Reviewed by Jules")).toBeDefined();
  });

  it("does not show Mark Completed if sprint is already completed", async () => {
    const completedSprint = { ...defaultSprint, status: "completed" as const };
    render(
      <SprintCell
        sprint={completedSprint}
        isEven={true}
        accentColor="text-blue-500"
      />
    );

    const menuButton = screen.getByTitle("Settings");
    fireEvent.click(menuButton);

    await waitFor(() => {
      expect(screen.getByText("Edit")).toBeDefined();
    });

    expect(screen.queryByText("Mark Completed")).toBeNull();
  });

  it("renders only the canonical Human Intervention badge and no redundant alerts", () => {
    const mockIntervention = {
      title: "Manual Approval Required",
      reason: "Reviewing large diffs",
      instructions: "Please check the diff and approve.",
      ownerType: "human",
    };

    // Note: status must be 'paused' for the canonical badge to show via the mapper
    const pausedSprint = { ...defaultSprint, status: "paused" as const };

    render(
      <SprintCell
        sprint={pausedSprint}
        isEven={true}
        accentColor="text-blue-500"
        humanIntervention={mockIntervention}
      />
    );

    // Canonical badge should be present
    expect(screen.getByText("Needs you")).toBeDefined();

    // Redundant inline alert should be absent
    expect(screen.queryByText("Human intervention required")).toBeNull();
  });
});
