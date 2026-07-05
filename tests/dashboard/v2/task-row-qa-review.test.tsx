/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/preact";
import { fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TaskRow } from "../../../dashboard/src/v2/components/ui/TaskRow.js";
import { KanbanTaskCard } from "../../../dashboard/src/v2/components/tasks/KanbanTaskCard.js";
import type { Task } from "../../../dashboard/src/v2/types.js";
import type { TaskCardViewModel } from "../../../dashboard/src/v2/lib/tasks/task-card-view-model.js";

const reducedMotionState = vi.hoisted(() => ({ value: false }));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../dashboard/src/v2/hooks/use-reduced-motion.js")>();
  return {
    ...actual,
    useReducedMotion: vi.fn(() => reducedMotionState.value),
    useResolvedMotionDuration: vi.fn((duration: string) => reducedMotionState.value ? "0ms" : duration),
  };
});

vi.mock("gsap", () => {
  const gsapMock = {
    killTweensOf: vi.fn(),
    set: vi.fn(),
    to: vi.fn((_: unknown, config?: { onComplete?: () => void }) => {
      config?.onComplete?.();
    }),
    fromTo: vi.fn((_: unknown, __: unknown, config?: { onComplete?: () => void }) => {
      config?.onComplete?.();
    }),
    context: vi.fn((callback?: () => void) => {
      callback?.();
      return { revert: vi.fn() };
    }),
  };
  return {
    default: gsapMock,
    gsap: gsapMock,
    ...gsapMock,
  };
});

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
  beforeEach(() => {
    cleanup();
    reducedMotionState.value = false;
    vi.clearAllMocks();
  });

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

    const statusElement = document.querySelector('div[aria-live="polite"]');
    expect(statusElement).toBeInTheDocument();
    expect(statusElement).toHaveTextContent(/Task T1 status is now coding completed/i);
  });

  it("opens delete confirmation before invoking the delete handler", async () => {
    const onDelete = vi.fn();
    const task = makeTask();
    const viewModel: TaskCardViewModel = {
      task,
      humanizedCreatedAt: "1h ago",
      executorLabel: "CLI",
      dependencyIndicators: [],
    };

    render(<KanbanTaskCard viewModel={viewModel} onEdit={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("button", { name: /Delete task T1: Reviewed task/i }));

    expect(await screen.findByRole("dialog", { name: "Delete Task" })).toBeInTheDocument();
    expect(screen.getByText(/Delete "Reviewed task"\? This removes the task card and cannot be undone/i)).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("renders dependency blocker labels and reduced-motion drag limitations", () => {
    reducedMotionState.value = true;
    const task = makeTask();
    const viewModel: TaskCardViewModel = {
      task,
      humanizedCreatedAt: "1h ago",
      executorLabel: "CLI",
      dependencyIndicators: [
        { recordId: "dep-1", id: "T0", title: "Prepare API", status: "pending" },
        { recordId: "dep-2", id: "T2", title: "Merged prerequisite", status: "completed" },
      ],
    };

    render(<KanbanTaskCard viewModel={viewModel} onEdit={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByText("Blocked: 1 dependency needs completion")).toBeVisible();
    expect(screen.getByText("Draggable reordering is disabled in reduced motion mode.")).toHaveClass("sr-only");
    expect(screen.queryByText("Drag disabled: reduced motion")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Task T1: Reviewed task/i)).toHaveAttribute("draggable", "false");
  });

  it("keeps task-card action names target-specific and exposes disabled reasons separately", () => {
    const task = makeTask();
    const viewModel: TaskCardViewModel = {
      task,
      humanizedCreatedAt: "1h ago",
      executorLabel: "CLI",
      dependencyIndicators: [],
      qaReviewLabel: "QA no review",
      actions: [
        {
          kind: "rerun",
          label: "Rerun",
          ariaLabel: "Rerun task T1: Reviewed task",
          title: "Rerun is available from the Live task detail workflow.",
          disabledReason: "Open Live to rerun task T1.",
        },
        {
          kind: "preview",
          label: "Preview",
          ariaLabel: "Open sprint preview for task T1: Reviewed task",
          title: "Open the sprint preview workspace.",
          href: "/browser?sprintId=sprint-1",
        },
        {
          kind: "pull_request",
          label: "PR pending",
          ariaLabel: "Open pull request for task T1: Reviewed task",
          title: "No pull request is available yet.",
          disabledReason: "No pull request is available for task T1 yet.",
        },
        {
          kind: "live_runtime",
          label: "Live idle",
          ariaLabel: "Open live runtime for task T1: Reviewed task",
          title: "Runtime has not started for this task.",
          disabledReason: "Live runtime has not started for task T1.",
        },
      ],
    };

    render(<KanbanTaskCard viewModel={viewModel} onEdit={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Rerun task T1: Reviewed task" })).toHaveAccessibleDescription("Open Live to rerun task T1.");
    expect(screen.getByRole("link", { name: "Open sprint preview for task T1: Reviewed task" })).toHaveAttribute("href", "/browser?sprintId=sprint-1");
    expect(screen.getByRole("button", { name: "Open pull request for task T1: Reviewed task" })).toHaveAccessibleDescription("No pull request is available for task T1 yet.");
    expect(screen.getByRole("button", { name: "Open live runtime for task T1: Reviewed task" })).toHaveAccessibleDescription("Live runtime has not started for task T1.");
  });

  it("exposes optimistic saving state and disabled edit/delete reasons without changing action names", () => {
    const task = makeTask();
    const viewModel: TaskCardViewModel = {
      task: { ...task, isOptimistic: true },
      humanizedCreatedAt: "1h ago",
      executorLabel: "CLI",
      dependencyIndicators: [],
      optimisticSavingLabel: "Saving task changes",
      dragStateLabel: "Pointer drag disabled while task changes are saving; keyboard reordering is not supported",
    };

    render(<KanbanTaskCard viewModel={viewModel} onEdit={vi.fn()} onDelete={vi.fn()} />);

    const card = screen.getByLabelText(/^Task T1: Reviewed task/i);
    expect(card).toHaveAttribute("aria-busy", "true");
    expect(card).toHaveAttribute("draggable", "false");
    expect(screen.getByText("Saving task changes")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit task T1: Reviewed task" })).toHaveAccessibleDescription("Saving task T1; edit is temporarily unavailable.");
    expect(screen.getByRole("button", { name: "Delete task T1: Reviewed task" })).toHaveAccessibleDescription("Saving task T1; delete is temporarily unavailable.");
  });
});
