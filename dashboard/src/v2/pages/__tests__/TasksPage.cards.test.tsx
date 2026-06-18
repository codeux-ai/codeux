/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { createContext } from "preact";
import { TasksPage } from "../../TasksPage.js";
import { useProjectData, ProjectDataContext } from "../../context/project-data.js";
import { useSprints } from "../../../hooks/useSprints.js";
import { useProjectTasks } from "../../hooks/use-project-tasks.js";
import { createMockTask } from "../../components/tasks/__tests__/fixtures/tasks.fixture.js";

expect.extend(matchers);

// Mock react-router
vi.mock("@tanstack/react-router", () => ({
  Link: (props: any) => <a {...props}>{props.children}</a>,
  useRouterState: vi.fn(() => ({ location: { searchStr: "" } })),
}));

// Mock GSAP
vi.mock("gsap", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const mockGsap = {
    context: vi.fn((fn) => {
      if (fn) fn();
      return { revert: vi.fn() };
    }),
    set: vi.fn(),
    to: vi.fn().mockImplementation((el, config) => {
      if (config?.onComplete) config.onComplete();
    }),
    fromTo: vi.fn().mockImplementation((el, from, to) => {
      if (to?.onComplete) to.onComplete();
    }),
    killTweensOf: vi.fn(),
  };
  return { ...actual, default: mockGsap, gsap: mockGsap };
});

vi.mock("../../context/project-data.js", () => {
  const ProjectDataContext = createContext(null);
  return {
    useProjectData: vi.fn(),
    ProjectDataContext,
  };
});
vi.mock("../../../hooks/useSprints.js", () => ({
  useSprints: vi.fn(),
}));
vi.mock("../../../hooks/use-dashboard-runtime-data.js", () => ({
  useDashboardRuntimeData: vi.fn(() => ({
    execution: { taskDispatches: [], recentEvents: [], sprintRuns: [] },
    status: { subtasks: [] }
  })),
}));
vi.mock("../../hooks/use-project-tasks.js", () => ({
  useProjectTasks: vi.fn(),
}));

// Need to mock user interaction resize observers usually present in Kanban rendering
global.ResizeObserver = class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
} as any;

describe("TasksPage.cards Integration", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders task cards with dependencies driven from project hooks correctly mapped to board state", () => {
        (useProjectData as unknown as any).mockReturnValue({
      projects: [{ id: "proj_1", name: "Project Alpha" }],
      selectedProject: { id: "proj_1", name: "Project Alpha" },
    });

        (useSprints as unknown as any).mockReturnValue({
      data: [{ id: "sprint_1", number: 1, active: true }],
      loading: false,
      selectedSprintId: "sprint_1",
      selectSprint: vi.fn(),
      refetch: vi.fn(),
    });

        (useProjectTasks as any).mockReturnValue({
      tasks: [
        createMockTask({
          recordId: "task_rec_1",
          id: "T-100",
          title: "Foundation Setup",
          status: "completed",
          priority: "high",
          assignee: "Alice",
          dependsOnTaskIds: [],

          executorType: "jules"
        }),
        createMockTask({
          recordId: "task_rec_2",
          id: "T-101",
          title: "Dependent Feature",
          status: "in_progress",
          priority: "medium",
          assignee: "Bob",
          dependsOnTaskIds: ["task_rec_1"],

          executorType: "jules"
        })
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    const { getByText, getAllByText } = render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "proj_1", name: "Project Alpha" } as any], selectedProject: { id: "proj_1", name: "Project Alpha" } as any } as any}>
        <TasksPage />
      </ProjectDataContext.Provider>
    );

    // Assert that the page rendered both tasks
    expect(getByText("Foundation Setup")).toBeInTheDocument();
    expect(getByText("Dependent Feature")).toBeInTheDocument();

    // Since T-101 depends on T-100, the task mapping logic in TasksPage should map "task_rec_1" to T-100's title
    // Then pass it down into KanbanTaskCard via TaskCardViewModel.

    // T-100 ID will appear twice - once as the ID for the Foundation card, once as the dependency ID inside the Dependent Feature card
    const instancesOfT100 = getAllByText("T-100");

    // To specifically guard against count-only regressions, we assert it renders exactly twice:
    // Once as the main card ID, and once as the dependency chip ID
    expect(instancesOfT100.length).toBe(2);

    // Additional dependency text verification
    expect(getByText("Foundation Setup")).toBeInTheDocument();
  });

  it("verifies optimistic task rendering and layout stability", () => {
    (useProjectData as unknown as any).mockReturnValue({
      projects: [{ id: "proj_1", name: "Project Alpha" }],
      selectedProject: { id: "proj_1", name: "Project Alpha" },
    });
    (useSprints as unknown as any).mockReturnValue({
      data: [{ id: "sprint_1", number: 1, active: true }],
      loading: false,
      selectedSprintId: "sprint_1",
    });
    (useProjectTasks as any).mockReturnValue({
      tasks: [
        createMockTask({
          recordId: "opt_1",
          id: "T-NEW",
          title: "Optimistic Title",
          status: "pending",
          priority: "low",
          assignee: "Me",
          dependsOnTaskIds: [],
          isOptimistic: true,
        })
      ],
      loading: false,
      error: null,
    });

    const { getByText, container } = render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "proj_1", name: "Project Alpha" } as any], selectedProject: { id: "proj_1", name: "Project Alpha" } as any } as any}>
        <TasksPage />
      </ProjectDataContext.Provider>
    );

    expect(getByText("Optimistic Title")).toBeInTheDocument();
    const card = container.querySelector(".kanban-card");
    expect(card).toHaveClass("border-dashed");
    expect(card).toHaveClass("opacity-60");
    expect(card).toHaveClass("pointer-events-none");
  });
});
