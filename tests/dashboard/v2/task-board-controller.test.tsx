/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { useTaskBoardController } from "../../../dashboard/src/v2/hooks/use-task-board-controller.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { useSprints } from "../../../dashboard/src/hooks/useSprints.js";
import { useDashboardRuntimeData } from "../../../dashboard/src/hooks/use-dashboard-runtime-data.js";
import { useProjectEffectiveSettings } from "../../../dashboard/src/v2/hooks/use-project-effective-settings.js";
import { useProjectTasks } from "../../../dashboard/src/v2/hooks/use-project-tasks.js";
import type { Source, Sprint } from "../../../dashboard/src/v2/types.js";

expect.extend(matchers);

const routerState = vi.hoisted(() => ({
  searchStr: "?sprintId=sprint-a",
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: vi.fn((options?: { select?: (state: { location: { searchStr: string } }) => unknown }) => {
    const state = { location: { searchStr: routerState.searchStr } };
    return options?.select ? options.select(state) : state;
  }),
  useNavigate: () => routerState.navigate,
}));

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(),
}));

vi.mock("../../../dashboard/src/hooks/useSprints.js", () => ({
  useSprints: vi.fn(),
}));

vi.mock("../../../dashboard/src/hooks/use-dashboard-runtime-data.js", () => ({
  useDashboardRuntimeData: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-effective-settings.js", () => ({
  useProjectEffectiveSettings: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-tasks.js", () => ({
  useProjectTasks: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: vi.fn(() => true),
}));

vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
  fetchAgentPresets: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  createProject: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  updateTask: vi.fn(),
}));

const createProject = (id: string, name: string): Source => ({
  id,
  slug: id,
  name,
  baseDir: `/tmp/${id}`,
  repoUrl: null,
  sourceType: "local",
  sourceRef: "main",
  gitProvider: "local",
  gitHostDomain: null,
  defaultBranch: null,
  featureBranchPrefix: null,
  status: "idle",
  sprintsCount: 1,
  openTasks: 0,
  completedTasks: 0,
  isRunning: false,
  settingsOverrides: {},
  agentBindings: [],
  lastRunAt: null,
  lastRunStatus: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const createSprint = (id: string, projectId: string, number: number): Sprint => ({
  id,
  projectId,
  number,
  slug: id,
  name: `Sprint ${number}`,
  isGeneratedName: false,
  originalPrompt: null,
  goal: `Goal ${number}`,
  status: "idle",
  showcasePinned: false,
  startDate: null,
  endDate: null,
  featureBranch: null,
  baseCommitSha: null,
  tasksCount: 0,
  completion: 0,
  linkedIssues: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  date: "Jan 1",
});

describe("useTaskBoardController project and sprint scope", () => {
  const projectA = createProject("project-a", "Project A");
  const projectB = createProject("project-b", "Project B");
  const sprintA = createSprint("sprint-a", projectA.id, 1);
  const sprintB = createSprint("sprint-b", projectB.id, 2);
  const emptyTasks: [] = [];
  const runtimeData = {
    execution: { taskDispatches: [], recentEvents: [] },
    status: { subtasks: [] },
  } as ReturnType<typeof useDashboardRuntimeData>;
  const settingsData = {
    data: {
      settings: {
        git: {
          autoCreatePr: true,
          githubMode: "REMOTE",
          sprintKeyPrefix: "SPR",
        },
      },
    },
  } as ReturnType<typeof useProjectEffectiveSettings>;
  const projectTasks = {
    tasks: emptyTasks,
    loading: false,
    error: null,
    refresh: vi.fn(),
  };
  const selectProject = vi.fn();
  const selectSprint = vi.fn();
  let selectedProject = projectA;
  let sprintData: Sprint[] = [sprintA];
  let selectedSprintId: string | null = sprintA.id;
  let sprintsLoading = false;

  const Harness = () => {
    const controller = useTaskBoardController();
    return (
      <div>
        <div data-testid="project-id">{controller.selectedProject?.id ?? "none"}</div>
        <div data-testid="task-scope">{controller.taskScopeSprintId ?? "all"}</div>
        <div data-testid="selected-sprint">{controller.selectedSprintId ?? "none"}</div>
        <div data-testid="sprint-count">{controller.sprints.length}</div>
        <button type="button" onClick={() => controller.handleSprintScopeSelect(sprintB.id)}>
          Select Sprint B
        </button>
      </div>
    );
  };

  beforeEach(() => {
    selectedProject = projectA;
    sprintData = [sprintA];
    selectedSprintId = sprintA.id;
    sprintsLoading = false;
    routerState.searchStr = "?sprintId=sprint-a";
    window.history.replaceState(null, "", "/tasks?sprintId=sprint-a");
    routerState.navigate.mockImplementation(async ({ search, to }: { search?: Record<string, string>; to: string }) => {
      const query = new URLSearchParams(search).toString();
      routerState.searchStr = query ? `?${query}` : "";
      window.history.replaceState(null, "", `${to}${routerState.searchStr}`);
    });
    vi.mocked(useDashboardRuntimeData).mockReturnValue(runtimeData);
    vi.mocked(useProjectEffectiveSettings).mockReturnValue(settingsData);
    vi.mocked(useProjectTasks).mockReturnValue(projectTasks);
    vi.mocked(useProjectData).mockImplementation(() => ({
      projects: [projectA, projectB],
      selectedProjectId: selectedProject.id,
      selectedProject,
      loading: false,
      error: null,
      refreshProjects: vi.fn(),
      selectProject,
      createProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
    }));
    vi.mocked(useSprints).mockImplementation(() => ({
      data: sprintData,
      selectedSprintId,
      selectedSprint: sprintData.find((sprint) => sprint.id === selectedSprintId) ?? null,
      selectSprint,
      loading: sprintsLoading,
      error: null,
      refetch: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps navbar project selection stable on Tasks when the previous project's sprint scope is stale", async () => {
    const { rerender } = render(<Harness />);

    expect(screen.getByTestId("project-id")).toHaveTextContent(projectA.id);
    expect(screen.getByTestId("task-scope")).toHaveTextContent(sprintA.id);

    selectedProject = projectB;
    sprintData = [sprintA];
    selectedSprintId = sprintA.id;

    await act(async () => {
      rerender(<Harness />);
    });

    expect(screen.getByTestId("project-id")).toHaveTextContent(projectB.id);
    expect(screen.getByTestId("task-scope")).toHaveTextContent("all");
    expect(screen.getByTestId("selected-sprint")).toHaveTextContent("none");
    expect(screen.getByTestId("sprint-count")).toHaveTextContent("0");
    expect(selectSprint).not.toHaveBeenCalledWith(sprintA.id);
    expect(window.location.search).toBe("");

    sprintData = [sprintB];
    selectedSprintId = null;
    routerState.searchStr = window.location.search;

    await act(async () => {
      rerender(<Harness />);
    });

    expect(screen.getByTestId("project-id")).toHaveTextContent(projectB.id);
    expect(screen.getByTestId("task-scope")).toHaveTextContent("all");
    expect(selectSprint).not.toHaveBeenCalledWith(sprintA.id);
  });

  it("keeps body sprint scope selection project-local and updates the Tasks query string", async () => {
    selectedProject = projectB;
    sprintData = [sprintB];
    selectedSprintId = null;
    routerState.searchStr = "";
    window.history.replaceState(null, "", "/tasks");

    render(<Harness />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select Sprint B" }));
    });

    expect(window.location.search).toBe("?sprintId=sprint-b");
    expect(selectSprint).toHaveBeenCalledWith(sprintB.id);
  });
});
