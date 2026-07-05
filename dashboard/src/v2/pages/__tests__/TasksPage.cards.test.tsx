/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import userEvent from "@testing-library/user-event";
import { createContext } from "preact";
import { TasksPage } from "../../TasksPage.js";
import { useProjectData, ProjectDataContext } from "../../context/project-data.js";
import { useSprints } from "../../../hooks/useSprints.js";
import { useProjectTasks } from "../../hooks/use-project-tasks.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";
import { createMockTask } from "../../components/tasks/__tests__/fixtures/tasks.fixture.js";

expect.extend(matchers);

const routerState = vi.hoisted(() => ({
  searchStr: "",
}));

// Mock react-router
vi.mock("@tanstack/react-router", () => ({
  Link: (props: any) => <a {...props}>{props.children}</a>,
  useRouterState: vi.fn((options?: { select?: (state: { location: { searchStr: string } }) => unknown }) => {
    const state = { location: { searchStr: routerState.searchStr } };
    return options?.select ? options.select(state) : state;
  }),
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
vi.mock("../../hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: vi.fn(),
}));

// Need to mock user interaction resize observers usually present in Kanban rendering
global.ResizeObserver = class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
} as any;

describe("TasksPage.cards Integration", () => {
  beforeEach(() => {
    routerState.searchStr = "";
    (useProjectEffectiveSettings as unknown as any).mockReturnValue({
      data: {
        settings: {
          git: {
            autoCreatePr: true,
            githubMode: "REMOTE",
            sprintKeyPrefix: "SPR",
          },
        },
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders task cards with dependencies driven from project hooks correctly mapped to board state", () => {
    const selectSprint = vi.fn();
        (useProjectData as unknown as any).mockReturnValue({
      projects: [{ id: "proj_1", name: "Project Alpha" }],
      selectedProject: { id: "proj_1", name: "Project Alpha" },
    });

        (useSprints as unknown as any).mockReturnValue({
      data: [{ id: "sprint_1", number: 1, name: "Sprint One", status: "running", date: "Jan 1", tasksCount: 2, completion: 50, active: true }],
      loading: false,
      selectedSprintId: "sprint_1",
      selectSprint,
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

    const { getAllByText } = render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "proj_1", name: "Project Alpha" } as any], selectedProject: { id: "proj_1", name: "Project Alpha" } as any } as any}>
        <TasksPage />
      </ProjectDataContext.Provider>
    );

    // Assert that the page rendered both tasks
    expect(screen.getAllByText("Foundation Setup").length).toBeGreaterThan(0);
    expect(screen.getByText("Dependent Feature")).toBeInTheDocument();

    // Since T-101 depends on T-100, the task mapping logic in TasksPage should map "task_rec_1" to T-100's title
    // Then pass it down into KanbanTaskCard via TaskCardViewModel.

    // T-100 ID will appear twice - once as the ID for the Foundation card, once as the dependency ID inside the Dependent Feature card
    const instancesOfT100 = getAllByText("T-100");

    // To specifically guard against count-only regressions, we assert it renders exactly twice:
    // Once as the main card ID, and once as the dependency chip ID
    expect(instancesOfT100.length).toBe(2);

    // Additional dependency text verification
    expect(screen.getAllByText("Foundation Setup").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: /in progress/i })).toHaveAccessibleDescription(/In Progress lane contains 1 task/i);
    expect(screen.getByRole("region", { name: /completed/i })).toHaveAccessibleDescription(/Completed lane contains 1 task/i);
    expect(screen.getByRole("button", { name: /Task sprint scope: SPR-1: Sprint One/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("suppresses pending PR card UI when project settings disable task pull requests", () => {
    (useProjectEffectiveSettings as unknown as any).mockReturnValue({
      data: {
        settings: {
          git: {
            autoCreatePr: false,
            githubMode: "REMOTE",
            sprintKeyPrefix: "CUX",
          },
        },
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    (useProjectData as unknown as any).mockReturnValue({
      projects: [{ id: "proj_1", name: "Project Alpha" }],
      selectedProject: { id: "proj_1", name: "Project Alpha" },
    });
    (useSprints as unknown as any).mockReturnValue({
      data: [{ id: "sprint_1", number: 1, name: "Sprint One", status: "running", date: "Jan 1", tasksCount: 1, completion: 0, active: true }],
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
          status: "pending",
          priority: "high",
          assignee: "Alice",
          dependsOnTaskIds: [],
          executorType: "jules",
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "proj_1", name: "Project Alpha" } as any], selectedProject: { id: "proj_1", name: "Project Alpha" } as any } as any}>
        <TasksPage />
      </ProjectDataContext.Provider>
    );

    expect(screen.getByText("Foundation Setup")).toBeInTheDocument();
    expect(screen.queryByText("PR pending")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open pull request for task T-100: Foundation Setup/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Task sprint scope: CUX-1: Sprint One/i })).toBeInTheDocument();
  });

  it("applies the same PR availability settings on sprint-scoped task routes", () => {
    routerState.searchStr = "?sprintId=sprint_2";
    const selectSprint = vi.fn();
    (useProjectEffectiveSettings as unknown as any).mockReturnValue({
      data: {
        settings: {
          git: {
            autoCreatePr: true,
            githubMode: "LOCAL",
            sprintKeyPrefix: "CUX",
          },
        },
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    (useProjectData as unknown as any).mockReturnValue({
      projects: [{ id: "proj_1", name: "Project Alpha" }],
      selectedProject: { id: "proj_1", name: "Project Alpha" },
    });
    (useSprints as unknown as any).mockReturnValue({
      data: [
        { id: "sprint_1", number: 1, name: "Sprint One", status: "idle", date: "Jan 1", tasksCount: 0, completion: 0, active: false },
        { id: "sprint_2", number: 2, name: "Sprint Two", status: "running", date: "Jan 2", tasksCount: 1, completion: 0, active: true },
      ],
      loading: false,
      selectedSprintId: "sprint_1",
      selectSprint,
      refetch: vi.fn(),
    });
    (useProjectTasks as any).mockReturnValue({
      tasks: [
        createMockTask({
          recordId: "task_rec_2",
          id: "T-200",
          title: "Sprint Scoped Task",
          status: "pending",
          priority: "medium",
          assignee: "Bob",
          sprintId: "sprint_2",
          dependsOnTaskIds: [],
          executorType: "jules",
        }),
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "proj_1", name: "Project Alpha" } as any], selectedProject: { id: "proj_1", name: "Project Alpha" } as any } as any}>
        <TasksPage />
      </ProjectDataContext.Provider>
    );

    expect(useProjectTasks).toHaveBeenCalledWith(
      "proj_1",
      [{ id: "proj_1", name: "Project Alpha" }],
      expect.any(Array),
      "sprint_2",
    );
    expect(selectSprint).toHaveBeenCalledWith("sprint_2");
    expect(screen.getByText("Sprint Scoped Task")).toBeInTheDocument();
    expect(screen.queryByText("PR pending")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open pull request for task T-200: Sprint Scoped Task/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Task sprint scope: CUX-2: Sprint Two/i })).toBeInTheDocument();
  });

  it("supports keyboard operation in the sprint scope selector", async () => {
    const user = userEvent.setup();
    const selectSprint = vi.fn();
    (useProjectData as unknown as any).mockReturnValue({
      projects: [{ id: "proj_1", name: "Project Alpha" }],
      selectedProject: { id: "proj_1", name: "Project Alpha" },
    });
    (useSprints as unknown as any).mockReturnValue({
      data: [
        { id: "sprint_1", number: 1, name: "Sprint One", status: "running", date: "Jan 1", tasksCount: 1, completion: 50, active: true },
        { id: "sprint_2", number: 2, name: "Sprint Two", status: "idle", date: "Jan 2", tasksCount: 0, completion: 0, active: false },
      ],
      loading: false,
      selectedSprintId: "sprint_1",
      selectSprint,
      refetch: vi.fn(),
    });
    (useProjectTasks as any).mockReturnValue({
      tasks: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <ProjectDataContext.Provider value={{ projects: [{ id: "proj_1", name: "Project Alpha" } as any], selectedProject: { id: "proj_1", name: "Project Alpha" } as any } as any}>
        <TasksPage />
      </ProjectDataContext.Provider>
    );

    const trigger = screen.getByRole("button", { name: /Task sprint scope: SPR-1: Sprint One/i });
    trigger.focus();
    await user.keyboard("{ArrowDown}");

    const listbox = screen.getByRole("listbox", { name: "Task sprint scope" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(listbox).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /All Sprints/i })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: /SPR-1: Sprint One/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("Selected").length).toBeGreaterThan(0);

    await user.keyboard("{End}{Enter}");
    expect(selectSprint).toHaveBeenCalledWith("sprint_2");
    await waitFor(() => expect(trigger).toHaveFocus());
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
    expect(card).toHaveClass("opacity-70");
    expect(card).toHaveTextContent("Saving task changes");
  });
});
