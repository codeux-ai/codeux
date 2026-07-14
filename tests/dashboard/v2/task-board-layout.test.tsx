/** @vitest-environment happy-dom */
/** @jsx h */
import { createRef, h } from "preact";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskBoardFeedback } from "../../../dashboard/src/v2/TasksPage.js";
import { TaskBoardColumns } from "../../../dashboard/src/v2/components/tasks/TaskBoardColumns.js";
import { TaskBoardFilters } from "../../../dashboard/src/v2/components/tasks/TaskBoardFilters.js";
import { TaskBoardOverview } from "../../../dashboard/src/v2/components/tasks/TaskBoardOverview.js";
import { buildTaskCardViewModel } from "../../../dashboard/src/v2/lib/tasks/task-card-view-model.js";
import { createMockTask } from "../../../dashboard/src/v2/components/tasks/__tests__/fixtures/tasks.fixture.js";
import type { Sprint, Task, TaskStatus } from "../../../dashboard/src/v2/types.js";

expect.extend(matchers);

vi.mock("gsap", () => {
  const gsap = {
    context: vi.fn((callback?: () => void) => {
      callback?.();
      return { revert: vi.fn() };
    }),
    set: vi.fn(),
    to: vi.fn(),
    fromTo: vi.fn(),
  };
  return { default: gsap, gsap };
});

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: vi.fn(() => true),
  useResolvedMotionDuration: vi.fn((duration: number | string) => typeof duration === "number" ? 0 : "0ms"),
}));

vi.mock("../../../dashboard/src/v2/components/tasks/KanbanTaskCard.js", () => ({
  KanbanTaskCard: ({ viewModel }: { viewModel: { task: Task } }) => (
    <article aria-label={`Task ${viewModel.task.id}`}>{viewModel.task.title}</article>
  ),
}));

class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const longSprintName = "A deliberately long sprint name that must stay inside the responsive task control rail";

function createSprint(): Sprint {
  return {
    id: "sprint-layout",
    projectId: "project-layout",
    number: 12,
    slug: "sprint-layout",
    name: longSprintName,
    isGeneratedName: false,
    originalPrompt: null,
    goal: "Validate the task workspace layout",
    status: "running",
    showcasePinned: false,
    startDate: null,
    endDate: null,
    featureBranch: null,
    baseCommitSha: null,
    tasksCount: 4,
    completion: 25,
    linkedIssues: [],
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    date: "Jul 13",
  };
}

function createTask(recordId: string, status: TaskStatus, priority: Task["priority"] = "medium"): Task {
  return createMockTask({
    recordId,
    id: `TASK-${recordId}`,
    title: `${status} ${recordId}`,
    sprintId: "sprint-layout",
    sprint: "SPR-12",
    status,
    priority,
  });
}

const noop = vi.fn();

describe("task board command surface layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    cleanup();
  });

  it("presents task totals beneath an accessible sprint progress hierarchy", () => {
    const tasks = [
      createTask("queued", "pending"),
      createTask("critical", "pending", "critical"),
      createTask("running", "in_progress"),
      createTask("done", "completed"),
    ];

    render(
      <TaskBoardOverview
        sprint={createSprint()}
        tasks={tasks}
        stats={{ total: 4, inProgress: 1, completed: 1, critical: 1 }}
      />,
    );

    const overview = screen.getByRole("region", { name: "Task board overview" });
    expect(within(overview).getByText(longSprintName)).toBeInTheDocument();
    const progress = within(overview).getByRole("progressbar", { name: `Sprint progress for ${longSprintName}` });
    expect(progress).toHaveAttribute("aria-valuenow", "25");
    expect(progress).toHaveAttribute("aria-valuetext", "1 of 4 tasks complete");
    expect(overview).toHaveTextContent("1 completed");
    expect(overview).toHaveTextContent("1 running");
    expect(overview).toHaveTextContent("2 queued");
    expect(overview).toHaveTextContent("Filtered total");
  });

  it("wraps sprint, status, priority, and visible-card controls without viewport-width classes", () => {
    render(
      <TaskBoardFilters
        sprints={[createSprint()]}
        selectedSprintId="sprint-layout"
        onSelectSprint={noop}
        sprintKeyPrefix="SPR"
        sprintsLoading={false}
        statusFilter="all"
        onStatusFilterChange={noop}
        priorityFilter="all"
        onPriorityFilterChange={noop}
        listWindow={20}
        onListWindowChange={noop}
      />,
    );

    const controls = screen.getByRole("region", { name: "Task board controls" });
    expect(controls).toHaveAttribute("data-task-control-rail", "responsive");
    expect(controls).toHaveClass("min-w-0", "max-w-full");
    expect(controls.firstElementChild?.nextElementSibling?.nextElementSibling).toHaveClass("grid-cols-1", "md:grid-cols-2");
    expect(within(controls).getByRole("tablist", { name: "Task status filter" })).toBeInTheDocument();
    expect(within(controls).getByRole("tablist", { name: "Task priority filter" })).toBeInTheDocument();
    expect(within(controls).getByRole("button", { name: "Select number of task cards per lane" })).toBeInTheDocument();

    const sprintTrigger = within(controls).getByRole("button", { name: new RegExp(`Task sprint scope: SPR-12: ${longSprintName}`) });
    expect(sprintTrigger).toHaveClass("w-full", "min-w-0");
    expect(sprintTrigger).toHaveStyle({ transitionDuration: "0ms" });
    fireEvent.click(sprintTrigger);

    const listbox = within(controls).getByRole("listbox", { name: "Task sprint scope" });
    expect(listbox).toHaveClass("w-full", "min-w-0", "motion-reduce:transition-none");
    expect(`${controls.className} ${listbox.className}`).not.toMatch(/100vw|w-screen/);
    const runningDot = listbox.querySelector('[data-sprint-status-dot="running"]');
    expect(runningDot).toHaveClass("motion-reduce:animate-none", "motion-reduce:ring-2");
  });

  it("keeps one, two, and three-lane framing named, counted, and stable through empty and loading states", () => {
    const queued = createTask("queued", "pending");
    const runningA = createTask("running-a", "in_progress");
    const runningB = createTask("running-b", "coding_completed");
    const tasks = [queued, runningA, runningB];
    const taskViewModels = new Map(tasks.map((task) => [task.recordId, buildTaskCardViewModel(task, new Map(tasks.map((item) => [item.recordId, item])))]));
    const columns = [
      { status: "pending" as const, count: 1, tasks: [queued] },
      { status: "in_progress" as const, count: 2, tasks: [runningA, runningB] },
      { status: "completed" as const, count: 0, tasks: [] },
    ];
    const baseProps = {
      boardRef: createRef<HTMLDivElement>(),
      columns,
      taskViewModels,
      allTasks: tasks,
      agentPresetsMap: new Map(),
      loading: false,
      showSkeletons: false,
      filterTransitionPending: false,
      statusFilter: "all" as const,
      priorityFilter: "all" as const,
      taskScopeSprintId: "sprint-layout",
      reducedMotion: true,
      draggedTaskId: null,
      dropTargetContext: null,
      listTransitionStyle: { transitionDuration: "0ms", transitionTimingFunction: "linear" },
      onDragOver: noop,
      onDrop: noop,
      onDragStart: noop,
      onDragEnd: noop,
      onEditTask: noop,
      onDeleteTask: noop,
    };

    const view = render(<TaskBoardColumns {...baseProps} />);
    const board = view.container.firstElementChild;
    expect(board).toHaveAttribute("data-board-column-count", "3");
    expect(board).toHaveClass("grid-cols-1", "lg:grid-cols-2", "xl:grid-cols-3", "min-w-0");
    expect(screen.getByRole("region", { name: "Queued lane, 1 task" })).toHaveAccessibleDescription(/contains 1 task after current filters/i);
    expect(screen.getByRole("region", { name: "In Progress lane, 2 tasks" })).toHaveAccessibleDescription(/contains 2 tasks after current filters/i);
    const emptyLane = screen.getByRole("region", { name: "Completed lane, 0 tasks" });
    expect(emptyLane).toHaveAttribute("data-reduced-motion", "true");
    expect(within(emptyLane).getByRole("status")).toHaveTextContent("This sprint has no work in this lane.");

    view.rerender(<TaskBoardColumns {...baseProps} loading showSkeletons />);
    expect(screen.getByText("Loading queued tasks.")).toBeInTheDocument();
    expect(screen.getByText("Loading in progress tasks.")).toBeInTheDocument();
    expect(screen.getByText("Loading completed tasks.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Queued lane, 1 task" })).toHaveAttribute("aria-busy", "true");
  });

  it("exposes deliberate error and filter-transition feedback", () => {
    render(<TaskBoardFeedback error="The task service did not respond." filterTransitionPending />);

    expect(screen.getByRole("alert")).toHaveTextContent("Task board update failed");
    expect(screen.getByRole("alert")).toHaveTextContent("The task service did not respond.");
    expect(screen.getByRole("status")).toHaveTextContent("Current cards remain visible until results settle.");
  });
});
