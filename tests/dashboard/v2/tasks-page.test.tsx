/** @vitest-environment jsdom */
/** @jsx h */
import { h } from "preact";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TasksPage } from "../../../dashboard/src/v2/TasksPage.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn((_target, options) => {
      options?.onComplete?.();
    }),
  },
}));

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: () => ({
    projects: [{ id: "p1", name: "Project 1" }],
    selectedProject: { id: "p1", name: "Project 1" },
  })
}));

vi.mock("../../../dashboard/src/hooks/useSprints.js", () => ({
  useSprints: () => ({
    data: [{ id: "s1", name: "Sprint 1", projectId: "p1", status: "running" }],
    loading: false,
    selectedSprintId: "s1",
    selectSprint: vi.fn(),
    refetch: vi.fn(),
  })
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-tasks.js", () => ({
  useProjectTasks: () => ({
    tasks: [
      { recordId: "t1", id: "TASK-1", sprintId: "s1", title: "Task 1", status: "pending", priority: "medium", executorType: "auto", dependsOnTaskIds: [], source: "", sprint: "", assignee: "", time: "", createdAt: new Date().toISOString(), promptMarkdown: "", description: "", isIndependent: true, isMerged: false, mergeIndicator: null }
    ],
    loading: false,
    error: null,
    refresh: vi.fn()
  })
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  useRouterState: vi.fn(() => ({ select: vi.fn(() => "") })),
}));

vi.mock("../../../dashboard/src/v2/lib/motion.js", () => ({
    isReducedMotion: vi.fn(() => true)
}));

describe("TasksPage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a task card and can open delete confirmation", async () => {
    render(<TasksPage />);

    // It should render Task 1
    expect(screen.getByText("Task 1")).toBeInTheDocument();

    // Hover isn't required for keyboard/touch logically, but we click the Delete button.
    const deleteBtn = screen.getByTitle("Delete task");
    fireEvent.click(deleteBtn);

    // It should show confirmation
    expect(screen.getByText("Delete?")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });
});
