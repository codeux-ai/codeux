/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { cleanup, render, screen, waitFor, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPage } from "../../../dashboard/src/v2/TasksPage.js";
import { createMockTask } from "../../../dashboard/src/v2/components/tasks/__tests__/fixtures/tasks.fixture.js";
import type { TaskBoardController } from "../../../dashboard/src/v2/hooks/use-task-board-controller.js";
import { buildTaskBoardViewModel } from "../../../dashboard/src/v2/lib/tasks/task-board-view-model.js";
import type { Source, Sprint, Task } from "../../../dashboard/src/v2/types.js";

expect.extend(matchers);

const mocks = vi.hoisted(() => ({
  controller: vi.fn(),
  reducedMotion: false,
}));

vi.mock("../../../dashboard/src/v2/hooks/use-task-board-controller.js", () => ({
  useTaskBoardController: mocks.controller,
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => mocks.reducedMotion,
  useResolvedMotionDuration: <T extends number | string>(duration: T): T => (
    mocks.reducedMotion
      ? (typeof duration === "number" ? 0 : "0ms") as T
      : duration
  ),
}));

vi.mock("gsap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gsap")>();
  const gsap = {
    context: vi.fn((callback?: () => void) => {
      callback?.();
      return { revert: vi.fn() };
    }),
    fromTo: vi.fn().mockImplementation((_target, _from, to) => {
      to?.onComplete?.();
    }),
    set: vi.fn(),
    to: vi.fn().mockImplementation((_target, to) => {
      to?.onComplete?.();
    }),
    killTweensOf: vi.fn(),
  };
  return { ...actual, default: gsap, gsap };
});

const project = {
  id: "project-fixture",
  name: "Test Project",
} as unknown as Source;

const sprint = {
  id: "sprint-fixture",
  projectId: project.id,
  number: 7,
  name: "Redesign Fixture Sprint",
  date: "Jul 14",
} as unknown as Sprint;

function createIntegratedTasks(): Task[] {
  return [
    createMockTask({
      recordId: "dependency-record",
      id: "T-701",
      sprintId: sprint.id,
      sprint: sprint.name,
      title: "Compile dependency surface",
      status: "coding_completed",
      priority: "high",
    }),
    createMockTask({
      recordId: "target-record",
      id: "T-702",
      sprintId: sprint.id,
      sprint: sprint.name,
      title: "Integrate redesigned task board",
      status: "pending",
      priority: "critical",
      dependsOnTaskIds: ["dependency-record"],
    }),
    createMockTask({
      recordId: "completed-record",
      id: "T-703",
      sprintId: sprint.id,
      sprint: sprint.name,
      title: "Document acceptance states",
      status: "completed",
      priority: "low",
    }),
  ];
}

function createController(overrides: Partial<TaskBoardController> = {}): TaskBoardController {
  const tasks = overrides.tasks ?? createIntegratedTasks();
  const boardViewModel = overrides.boardViewModel ?? buildTaskBoardViewModel({
    tasks,
    optimisticTasks: [],
    statusFilter: overrides.statusFilter ?? "all",
    priorityFilter: overrides.priorityFilter ?? "all",
    listWindow: overrides.listWindow ?? 20,
    taskScopeSprintId: sprint.id,
    projectId: project.id,
    taskDispatches: [],
    attentionItems: [],
    recentEvents: [],
    subtasks: [],
  });

  return {
    projects: [project],
    selectedProject: project,
    sprints: [sprint],
    sprintsLoading: false,
    selectedSprintId: sprint.id,
    taskScopeSprintId: sprint.id,
    selectedSprintModel: sprint,
    sprintKeyPrefix: "TST",
    isTaskScopeReady: true,
    tasks,
    loading: false,
    error: null,
    statusFilter: "all",
    setStatusFilter: vi.fn(),
    priorityFilter: "all",
    setPriorityFilter: vi.fn(),
    listWindow: 20,
    setListWindow: vi.fn(),
    showComposer: false,
    editingTask: null,
    composerRef: { current: null },
    showAddProjectModal: false,
    setShowAddProjectModal: vi.fn(),
    reducedMotion: mocks.reducedMotion,
    showSkeletons: false,
    filterTransitionPending: false,
    boardCountAnnouncement: "Showing 3 tasks. Queued: 1, In Progress: 1, Completed: 1.",
    boardViewModel,
    draggedTaskId: null,
    dropTargetContext: null,
    agentPresets: [],
    agentPresetsMap: new Map(),
    resolvedTaskId: null,
    clearResolvedTaskId: vi.fn(),
    handleSprintScopeSelect: vi.fn(),
    handleComposerToggle: vi.fn(),
    handleComposerClose: vi.fn(),
    handleTaskSubmit: vi.fn(),
    handleDragStart: vi.fn(),
    handleDragEnd: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    handleDeleteTask: vi.fn(),
    handleEditClick: vi.fn(),
    handleAddProject: vi.fn(),
    ...overrides,
  };
}

describe("Tasks page redesign integration", () => {
  beforeEach(() => {
    mocks.reducedMotion = false;
    mocks.controller.mockReset();
    mocks.controller.mockReturnValue(createController());
    vi.stubGlobal("ResizeObserver", class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => (
      window.setTimeout(() => callback(performance.now()), 0)
    ));
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("integrates board semantics, dependency status copy, and keyboard menu focus", async () => {
    const user = userEvent.setup();
    render(<TasksPage />);

    const workspace = screen.getByRole("region", { name: "Task Board" });
    expect(within(workspace).getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Queued lane/i })).toHaveAccessibleDescription(/Queued lane contains 1 task/i);
    expect(screen.getByRole("region", { name: /In Progress lane/i })).toHaveAccessibleDescription(/In Progress lane contains 1 task/i);
    expect(screen.getByRole("region", { name: /Completed lane/i })).toHaveAccessibleDescription(/Completed lane contains 1 task/i);
    expect(screen.getByRole("progressbar", { name: /Sprint progress for Redesign Fixture Sprint/i })).toHaveAttribute("aria-valuetext", "1 of 3 tasks complete");

    const targetCard = screen.getByLabelText(/^Task T-702: Integrate redesigned task board/i);
    const dependencyRow = within(targetCard).getByRole("listitem", {
      name: /Depends on task T-701, ready for qa\. Blocking dependency\./i,
    });
    expect(dependencyRow).toHaveAttribute("data-dependency-state", "blocked");
    expect(within(dependencyRow).getByText("T-701")).toHaveAttribute("aria-hidden", "true");
    expect(within(dependencyRow).getByText("Ready for QA")).toHaveAttribute("aria-hidden", "true");

    const trigger = within(targetCard).getByRole("button", {
      name: "Open task actions for task T-702: Integrate redesigned task board",
    });
    trigger.focus();
    await user.keyboard("{ArrowDown}");

    const menu = await screen.findByRole("menu", {
      name: "Actions for task T-702: Integrate redesigned task board",
    });
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: /Open sprint preview for task T-702/i })).toHaveFocus());
    expect(within(menu).getByRole("menuitem", { name: /Rerun task T-702/i })).toHaveAccessibleDescription("Open Live to rerun task T-702.");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("menu", { name: /Actions for task T-702/i })).not.toBeInTheDocument();
  });

  it("keeps accessible loading, error, and empty states in the integrated lanes", () => {
    const loadingController = createController({ loading: true, showSkeletons: true });
    mocks.controller.mockReturnValue(loadingController);
    const view = render(<TasksPage />);

    expect(screen.getByText("Loading queued tasks.")).toHaveAttribute("role", "status");
    expect(screen.getByText("Loading in progress tasks.")).toHaveAttribute("role", "status");
    expect(screen.getByText("Loading completed tasks.")).toHaveAttribute("role", "status");

    const emptyTasks: Task[] = [];
    mocks.controller.mockReturnValue(createController({
      tasks: emptyTasks,
      error: "Fixture refresh failed safely.",
      boardViewModel: buildTaskBoardViewModel({
        tasks: emptyTasks,
        optimisticTasks: [],
        statusFilter: "all",
        priorityFilter: "all",
        listWindow: 20,
        taskScopeSprintId: sprint.id,
        projectId: project.id,
        taskDispatches: [],
        attentionItems: [],
        recentEvents: [],
        subtasks: [],
      }),
    }));
    view.rerender(<TasksPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Fixture refresh failed safely.");
    expect(screen.getByText("No queued tasks")).toBeVisible();
    expect(screen.getByText("No in progress tasks")).toBeVisible();
    expect(screen.getByText("No completed tasks")).toBeVisible();
  });

  it("preserves status semantics while disabling drag motion in reduced-motion mode", () => {
    mocks.reducedMotion = true;
    mocks.controller.mockReturnValue(createController({ reducedMotion: true }));
    const { container } = render(<TasksPage />);

    const targetCard = screen.getByLabelText(/^Task T-702:/i);
    expect(within(targetCard).getByText("Draggable reordering is disabled in reduced motion mode.")).toHaveClass("sr-only");
    expect(targetCard).toHaveAttribute("draggable", "false");
    expect(screen.getByRole("region", { name: /Queued lane/i })).toHaveAttribute("data-reduced-motion", "true");
    expect(container.querySelector("[data-board-column-count]")).toHaveClass("motion-reduce:transition-none");
    expect(targetCard).toHaveAccessibleName(/No pull request available yet\./i);
    expect(targetCard).toHaveAccessibleDescription(/Draggable reordering is disabled in reduced motion mode\./i);
  });
});
