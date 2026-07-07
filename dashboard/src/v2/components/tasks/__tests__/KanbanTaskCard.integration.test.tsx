/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { readFileSync } from "node:fs";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import userEvent from "@testing-library/user-event";
import gsap from "gsap";
import { KanbanTaskCard } from "../KanbanTaskCard.js";
import type { TaskCardViewModel } from "../../../lib/tasks/task-card-view-model.js";
import type { TaskSelfReflectionRating } from "../../../../../../src/contracts/task-self-reflection-types.js";

expect.extend(matchers);

const mockRequestConfirm = vi.fn().mockResolvedValue(true);
const taskCardCss = readFileSync("dashboard/src/v2/components/tasks/kanban-task-card.css", "utf8");

const createRating = (overrides: Partial<TaskSelfReflectionRating> = {}): TaskSelfReflectionRating => ({
  id: "rating-1",
  projectId: "project-1",
  sprintId: "sprint-1",
  taskId: "rec_1",
  sourceTaskRunId: "run-1",
  overallRating: 4.5,
  sections: [
    {
      label: "Implementation",
      normalizedLabel: "implementation",
      rating: 4.5,
      note: "Covered edge cases.",
    },
    {
      label: "Scope control",
      normalizedLabel: "scope_control",
      rating: 4,
      note: "Stayed focused.",
    },
  ],
  capturedAt: "2026-07-07T00:00:00.000Z",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
  ...overrides,
});

vi.mock("../../../hooks/use-confirm-dialog.js", () => ({
  useConfirmDialog: () => ({
    isOpen: false,
    options: null,
    requestConfirm: mockRequestConfirm,
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
    triggerRef: { current: null }
  })
}));

vi.mock("../../../hooks/use-reduced-motion.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useReducedMotion: vi.fn().mockReturnValue(false),
    useResolvedMotionDuration: vi.fn().mockImplementation((val) => val)
  };
});

vi.mock("gsap", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const mockGsap = {
    killTweensOf: vi.fn(),
    set: vi.fn(),
    to: vi.fn().mockImplementation((el, config) => {
      if (config?.onComplete) config.onComplete();
    }),
    timeline: vi.fn().mockImplementation(() => ({
      to: vi.fn().mockReturnThis(),
    })),
    fromTo: vi.fn().mockImplementation((el, from, to) => {
      if (to?.onComplete) to.onComplete();
    }),
    context: vi.fn().mockImplementation((fn) => {
      if (fn) fn();
      return { revert: vi.fn() };
    }),
  };
  return { ...actual, default: mockGsap, gsap: mockGsap };
});

describe("KanbanTaskCard Integration", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const mockViewModel: TaskCardViewModel = {
    task: {
      recordId: "rec_1",
      id: "TASK-123",
      title: "Implement new feature",
      priority: "high",
      status: "in_progress",
      assignee: "Alice",
      source: "github",
      executorType: "jules",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any,
    humanizedCreatedAt: "10m ago",
    executorLabel: "Jules",
    dependencyIndicators: [
      { recordId: "rec_2", id: "TASK-124", title: "Backend API", status: "completed" },
      { recordId: "rec_3", id: "TASK-125", title: "Database schema", status: "pending" }
    ],
    dependencyActionLabel: "1 dependency blocker",
    qaReviewLabel: "QA no review",
    optimisticSavingLabel: null,
    dragStateLabel: "Pointer drag only; keyboard reordering is not supported",
    actions: [
      {
        kind: "rerun",
        label: "Rerun",
        ariaLabel: "Rerun task TASK-123: Implement new feature",
        title: "Rerun is available from the Live task detail workflow.",
        disabledReason: "Open Live to rerun task TASK-123.",
      },
      {
        kind: "preview",
        label: "Preview",
        ariaLabel: "Open sprint preview for task TASK-123: Implement new feature",
        title: "Open the sprint preview workspace.",
        href: "/browser?sprintId=sprint-1",
      },
      {
        kind: "pull_request",
        label: "PR pending",
        ariaLabel: "Open pull request for task TASK-123: Implement new feature",
        title: "No pull request is available yet.",
        disabledReason: "No pull request is available for task TASK-123 yet.",
      },
      {
        kind: "live_runtime",
        label: "Live idle",
        ariaLabel: "Open live runtime for task TASK-123: Implement new feature",
        title: "Runtime has not started for this task.",
        disabledReason: "Live runtime has not started for task TASK-123.",
      },
    ],
  };

  const onEdit = vi.fn();
  const onDelete = vi.fn();

  it("renders correctly with full telemetry and dependencies", () => {
    const { getByRole, getByText } = render(
      <KanbanTaskCard
        viewModel={mockViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    // Title and IDs
    expect(getByText("Implement new feature")).toBeInTheDocument();
    expect(getByText("TASK-123")).toBeInTheDocument();

    // Telemetry fields from TaskExecutionMeta
    expect(getByText("10m ago")).toBeInTheDocument(); // humanizedCreatedAt
    expect(getByText("Jules")).toBeInTheDocument(); // executorLabel

    // Dependencies (based on DependencyStatusIndicators rendering)
    expect(getByText("TASK-124")).toBeInTheDocument();
    expect(getByText("TASK-125")).toBeInTheDocument();
  });

  it("renders self-reflection ratings with overall and section details", async () => {
    const rating = createRating();
    const ratedViewModel: TaskCardViewModel = {
      ...mockViewModel,
      task: {
        ...mockViewModel.task,
        selfReflectionRating: rating,
      },
      selfReflectionRating: rating,
    };

    const { getByLabelText, findByRole } = render(
      <KanbanTaskCard
        viewModel={ratedViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    const badge = getByLabelText("Self-reflection rating 4.5 out of 5");
    expect(badge).toHaveAttribute("role", "meter");
    expect(badge).toHaveTextContent("4.5/5");

    fireEvent.focus(badge);
    const overlay = await findByRole("tooltip");
    expect(within(overlay).getByText("Implementation")).toBeInTheDocument();
    expect(within(overlay).getByText("4.5/5")).toBeInTheDocument();
    expect(within(overlay).getByText("Covered edge cases.")).toBeInTheDocument();
    expect(within(overlay).getByText("Scope control")).toBeInTheDocument();
    expect(within(overlay).getByText("4/5")).toBeInTheDocument();
    expect(within(overlay).getByText("Stayed focused.")).toBeInTheDocument();
  });

  it("does not render a self-reflection placeholder when no rating exists", () => {
    const { queryByLabelText } = render(
      <KanbanTaskCard
        viewModel={{ ...mockViewModel, selfReflectionRating: undefined }}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    expect(queryByLabelText(/Self-reflection rating/i)).not.toBeInTheDocument();
  });

  const mockCliViewModel: TaskCardViewModel = {
    task: {
      recordId: "rec_cli",
      id: "TASK-CLI",
      title: "CLI Mode Test",
      priority: "medium",
      status: "completed",
      assignee: "Alice",
      source: "github",
      executorType: "docker_cli",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionMode: "standard",
    } as any,
    humanizedCreatedAt: "5m ago",
    executorLabel: "CLI",
    dependencyIndicators: [],
    dependencyActionLabel: "Dependencies clear",
    qaReviewLabel: "QA no review",
    optimisticSavingLabel: null,
    dragStateLabel: "Pointer drag only; keyboard reordering is not supported",
    actions: [],
  };

  it("renders correctly with CLI execution mode", () => {
    const { getByText } = render(
      <KanbanTaskCard
        viewModel={mockCliViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
    expect(getByText("CLI Mode Test")).toBeInTheDocument();
    expect(getByText("5m ago")).toBeInTheDocument();
    expect(getByText("CLI")).toBeInTheDocument();
  });

  const mockMissingDataViewModel: TaskCardViewModel = {
    task: {
      recordId: "rec_missing",
      id: "TASK-MISSING",
      title: "Task Missing Data",
      priority: "low",
      status: "pending",
      assignee: "Unknown",
      source: "unknown",
      executorType: "auto",
      createdAt: "invalid-date",
      updatedAt: "invalid-date",
    } as any,
    humanizedCreatedAt: "--",
    executorLabel: "Auto",
    dependencyIndicators: [],
    dependencyActionLabel: "Dependencies clear",
    qaReviewLabel: "QA no review",
    optimisticSavingLabel: null,
    dragStateLabel: "Pointer drag only; keyboard reordering is not supported",
    actions: [],
  };

  it("renders correctly with missing telemetry data", () => {
    const { getByText, queryByText } = render(
      <KanbanTaskCard
        viewModel={mockMissingDataViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
    expect(getByText("Task Missing Data")).toBeInTheDocument();
    expect(getByText("--")).toBeInTheDocument();
    expect(queryByText("Auto")).not.toBeInTheDocument();
  });

  const mockLiveViewModel: TaskCardViewModel = {
    ...mockViewModel,
    sessionId: "abc123",
    sessionState: "ACTIVE",
    prUrl: "https://github.com/org/repo/pull/42",
    liveRunningTime: "4m 12s",
    actions: [
      ...mockViewModel.actions!.filter((action) => action.kind !== "pull_request" && action.kind !== "live_runtime"),
      {
        kind: "pull_request",
        label: "PR",
        ariaLabel: "Open pull request for task TASK-123: Implement new feature",
        title: "Open pull request in a new tab.",
        href: "https://github.com/org/repo/pull/42",
        external: true,
      },
      {
        kind: "live_runtime",
        label: "Live",
        ariaLabel: "Open live runtime for task TASK-123: Implement new feature",
        title: "Open the live runtime page.",
        href: "/live",
      },
    ],
  };

  it("renders correctly with live execution fields", () => {
    const { getByRole, getByText } = render(
      <KanbanTaskCard
        viewModel={mockLiveViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    expect(getByText("abc123")).toBeInTheDocument();
    expect(getByText("ACTIVE")).toBeInTheDocument();
    expect(getByText("4m 12s")).toBeInTheDocument();

    expect(getByRole("link", { name: /Open live runtime for task TASK-123: Implement new feature/i })).toHaveTextContent("Live");

    // Test that the PR link anchor tag exists by checking for "PR ready"
    const prLink = getByText("PR ready").closest('a');
    expect(prLink).toBeInTheDocument();
    expect(prLink).toHaveAttribute("href", "https://github.com/org/repo/pull/42");
  });

  it("provides accessible interaction targets and structure", async () => {
    const user = userEvent.setup();
    const { getByRole, getByTitle, container, getByText } = render(
      <KanbanTaskCard
        viewModel={mockViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    // Ensure buttons have accessible titles/labels
    const editBtn = getByTitle(/Edit task/i);
    const deleteBtn = getByTitle(/Delete task/i);
    expect(editBtn).toBeInTheDocument();
    expect(deleteBtn).toBeInTheDocument();
    expect(editBtn).toHaveAccessibleName("Edit task TASK-123: Implement new feature");
    expect(deleteBtn).toHaveAccessibleName("Delete task TASK-123: Implement new feature");

    // Check indicator labels are accessible via their status titles
    const dependencyIndicator = getByTitle(/Depends on Backend API \(Resolved; completed\)/i);
    expect(dependencyIndicator).toBeInTheDocument();

    // The card itself should be focusable via tabIndex={0}
    const card = container.querySelector(".kanban-card");
    expect(card).toHaveAttribute("tabIndex", "0");

    // Simulate focus to verify visibility/interaction
    if (card) {
      await user.click(card);
      expect(card).toHaveFocus();
    }

    const actionsContainer = editBtn.parentElement;
    expect(actionsContainer).toHaveClass("kanban-card__actions");
    expect(actionsContainer).toHaveAttribute("aria-label", "Actions for task TASK-123");
    expect(getByText("Rerun")).toBeInTheDocument();
    expect(getByText("Preview")).toBeInTheDocument();
    expect(getByRole("button", { name: /Open pull request for task TASK-123: Implement new feature/i })).toHaveTextContent("PR pending");
    expect(getByRole("button", { name: /Open live runtime for task TASK-123: Implement new feature/i })).toHaveTextContent("Live idle");

    // Simulate delete click to ensure confirm dialog is requested
    await user.click(deleteBtn);
    expect(mockRequestConfirm).toHaveBeenCalledWith(expect.objectContaining({
      destructive: true,
      body: expect.stringContaining("cannot be undone"),
    }));
  });

  it("keeps quick actions mounted at the card bottom and keyboard reachable without hover", async () => {
    const user = userEvent.setup();
    const { container, getByRole } = render(
      <KanbanTaskCard
        viewModel={mockViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    const card = container.querySelector(".kanban-card");
    const actionsContainer = container.querySelector(".kanban-card__actions");
    expect(card).toHaveAttribute("tabIndex", "0");
    expect(actionsContainer).toHaveClass("kanban-card__actions");
    expect(actionsContainer).toHaveAttribute("aria-label", "Actions for task TASK-123");
    expect(getByRole("button", { name: /Edit task TASK-123: Implement new feature/i })).toBeInTheDocument();
    expect(getByRole("button", { name: /Delete task TASK-123: Implement new feature/i })).toBeInTheDocument();
    expect(actionsContainer).not.toHaveClass("absolute");
    expect(actionsContainer?.previousElementSibling).toHaveClass("sm:flex-row");

    await user.tab();
    expect(card).toHaveFocus();
    await user.tab();
    expect(getByRole("button", { name: /Rerun task TASK-123: Implement new feature/i })).toHaveFocus();

    expect(taskCardCss).toContain("@media (any-pointer: fine) and (hover: hover)");
    expect(taskCardCss).toMatch(/\.kanban-card__actions\s*\{[\s\S]*opacity:\s*1;[\s\S]*pointer-events:\s*auto;[\s\S]*transform:\s*translateY\(0\);/);
    expect(taskCardCss).toMatch(/@media \(any-pointer: fine\) and \(hover: hover\)\s*\{[\s\S]*\.kanban-card__actions\s*\{[\s\S]*opacity:\s*0;[\s\S]*pointer-events:\s*none;[\s\S]*transform:\s*translateY\(0\.375rem\);/);
    expect(taskCardCss).toMatch(/\.kanban-card:hover \.kanban-card__actions,[\s\S]*\.kanban-card:focus \.kanban-card__actions,[\s\S]*\.kanban-card:focus-visible \.kanban-card__actions,[\s\S]*\.kanban-card:focus-within \.kanban-card__actions\s*\{[\s\S]*opacity:\s*1;[\s\S]*pointer-events:\s*auto;[\s\S]*transform:\s*translateY\(0\);/);
  });

  it("renders status transition clearly when a task status updates", async () => {
    const { container, rerender, findByText } = render(
      <KanbanTaskCard
        viewModel={mockViewModel} // status: in_progress
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    // Rerender with a new status to trigger the status update
    const updatedViewModel = {
      ...mockViewModel,
      task: { ...mockViewModel.task, status: "completed" as const }
    };

    rerender(
      <KanbanTaskCard
        viewModel={updatedViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    // We verify the new status is announced via aria-live
    const liveRegion = await findByText("Task TASK-123 status is now Completed");
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(container).toBeInTheDocument();
  });

  it("skips card rerender when stable view-model props are unchanged", () => {
    let titleReads = 0;
    const taskWithTrackedTitle = { ...mockViewModel.task };
    Object.defineProperty(taskWithTrackedTitle, "title", {
      configurable: true,
      get: () => {
        titleReads += 1;
        return "Implement new feature";
      },
    });
    const stableViewModel: TaskCardViewModel = {
      ...mockViewModel,
      task: taskWithTrackedTitle,
    };
    const stableOnEdit = vi.fn();
    const stableOnDelete = vi.fn();

    const { rerender } = render(
      <KanbanTaskCard
        viewModel={stableViewModel}
        onEdit={stableOnEdit}
        onDelete={stableOnDelete}
      />
    );

    titleReads = 0;
    rerender(
      <KanbanTaskCard
        viewModel={stableViewModel}
        onEdit={stableOnEdit}
        onDelete={stableOnDelete}
      />
    );

    expect(titleReads).toBe(0);
  });

  it("disables drag handlers and updates description text in reduced motion", async () => {
    // Override the mock to return true for this test
    const { useReducedMotion } = await import("../../../hooks/use-reduced-motion.js");
    vi.mocked(useReducedMotion).mockReturnValue(true);

    const onDragStart = vi.fn();
    const { container, getByText, queryByText } = render(
      <KanbanTaskCard
        viewModel={mockViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
        onDragStart={onDragStart as any}
      />
    );

    const card = container.querySelector(".kanban-card");
    expect(card).toHaveAttribute("draggable", "false");

    // Simulate drag start
    if (card) {
      const event = new Event('dragstart', { bubbles: true });
      card.dispatchEvent(event);
    }

    // Handlers should not have been called because onDragStart should be undefined
    expect(onDragStart).not.toHaveBeenCalled();

    // Verify screen-reader text is updated
    const srText = getByText("Draggable reordering is disabled in reduced motion mode.");
    expect(srText).toBeInTheDocument();
    expect(srText).toHaveClass("sr-only");
    expect(queryByText("Drag disabled: reduced motion")).not.toBeInTheDocument();
    expect(card).not.toHaveTextContent("Drag disabled: reduced motion");
  });

  it("ensures dependency indicators have clear screen-reader support", () => {
    const { getByText, getByTitle, container } = render(
      <KanbanTaskCard
        viewModel={mockViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    // Check that descriptive 'Dependency' text is in the document (from the new sr-only span)
    const srText = getByText(/Depends on task TASK-124, resolved. Resolved dependency. Dependency completed. Status: completed. Title: Backend API/i);
    expect(srText).toBeInTheDocument();
    expect(srText).toHaveClass("sr-only");

    // Ensure the ID spans have aria-hidden to prevent redundant readouts
    const task124Elements = container.querySelectorAll('span[aria-hidden="true"]');
    expect(Array.from(task124Elements).some(el => el.textContent === "TASK-124")).toBeTruthy();

    // Check aria-hidden is applied to visually distinct but screen-reader-hidden icons
    const indicatorIcon = getByTitle(/Depends on Backend API/i).querySelector("svg");
    if (indicatorIcon) {
       expect(indicatorIcon).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("keeps delete focus on the trigger when a delete confirmation is cancelled", async () => {
    const user = userEvent.setup();
    mockRequestConfirm.mockImplementationOnce(async () => false);

    const { getByTitle } = render(
      <KanbanTaskCard
        viewModel={mockViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    const deleteBtn = getByTitle(/Delete task/i);
    deleteBtn.focus();
    expect(deleteBtn).toHaveFocus();

    await user.click(deleteBtn);

    expect(mockRequestConfirm).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(deleteBtn).toHaveFocus();
  });

  it("provides accurate drag-and-drop screen-reader guidance", async () => {
    const { useReducedMotion } = await import("../../../hooks/use-reduced-motion.js");
    vi.mocked(useReducedMotion).mockReturnValue(false);
    const { queryByText } = render(<KanbanTaskCard viewModel={mockViewModel} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const kbdGuidance = document.getElementById(`task-card-kbd-${mockViewModel.task.recordId}`);
    expect(kbdGuidance).toBeInTheDocument();
    expect(kbdGuidance).toHaveTextContent(/Draggable task. Drag and drop is pointer-only. Keyboard reordering is not supported/i);
    expect(queryByText("Pointer drag only")).not.toBeInTheDocument();
  });

  it("does not trap Enter or Space on the pointer-only draggable card", async () => {
    const user = userEvent.setup();
    const { container } = render(<KanbanTaskCard viewModel={mockViewModel} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const card = container.querySelector(".kanban-card") as HTMLElement;
    expect(card).toHaveAccessibleName(/Task TASK-123: Implement new feature. Status In Progress. Priority High/i);
    card.focus();
    await user.keyboard("{Enter} ");
    expect(card).toHaveFocus();
  });

  it("provides task titles in action button accessible labels", () => {
    const { getByRole } = render(<KanbanTaskCard viewModel={mockViewModel} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(getByRole('button', { name: /Edit task TASK-123: Implement new feature/i })).toBeInTheDocument();
    expect(getByRole('button', { name: /Delete task TASK-123: Implement new feature/i })).toBeInTheDocument();
  });

  it("keeps unavailable task actions keyboard reachable with explanatory labels", () => {
    const { getByRole, getByText } = render(<KanbanTaskCard viewModel={mockViewModel} onEdit={vi.fn()} onDelete={vi.fn()} />);

    expect(getByRole("button", { name: /Rerun task TASK-123: Implement new feature/i })).toHaveAccessibleDescription("Open Live to rerun task TASK-123.");
    expect(getByRole("button", { name: /Open pull request for task TASK-123: Implement new feature/i })).toHaveAccessibleDescription("No pull request is available for task TASK-123 yet.");
    expect(getByRole("button", { name: /Open live runtime for task TASK-123: Implement new feature/i })).toHaveAccessibleDescription("Live runtime has not started for task TASK-123.");
    expect(getByText("Unavailable: Rerun, PR pending, Live idle.")).toBeVisible();
    expect(getByText("1 dependency blocker")).toBeInTheDocument();
    expect(getByText("QA no review")).toBeInTheDocument();
  });

  it("announces card metadata changes and exposes tokenized motion contracts", () => {
    const { container, getByText } = render(<KanbanTaskCard viewModel={mockLiveViewModel} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const card = container.querySelector(".kanban-card");

    expect(card).toHaveAttribute("data-motion-control", "controlFeedback");
    expect(card).toHaveAttribute("data-motion-selection", "selectionMovement");
    expect(card).toHaveAttribute("data-motion-list-reveal", "listReveal");
    expect(card).toHaveAttribute("data-motion-list-reorder", "listReorder");
    expect(getByText(/Pull request available. Live runtime 4m 12s, session ACTIVE./i)).toHaveClass("sr-only");
  });

  it("marks optimistic quick actions busy and suppresses link activation while saving", () => {
    const optimisticViewModel: TaskCardViewModel = {
      ...mockLiveViewModel,
      task: { ...mockLiveViewModel.task, isOptimistic: true },
      optimisticSavingLabel: "Saving task changes",
    };

    const { getByRole, getByText } = render(<KanbanTaskCard viewModel={optimisticViewModel} onEdit={vi.fn()} onDelete={vi.fn()} />);

    const liveAction = getByRole("button", { name: /Open live runtime for task TASK-123: Implement new feature/i });
    expect(liveAction).toHaveAttribute("aria-disabled", "true");
    expect(liveAction).toHaveAttribute("aria-busy", "true");
    expect(liveAction).toHaveAccessibleDescription("Saving task TASK-123; Live is temporarily unavailable.");
    expect(getByText("Saving task TASK-123; actions are paused.")).toBeVisible();
  });

  it("prevents long metadata strings from overflowing the card horizontally", () => {
    const overflowViewModel: TaskCardViewModel = {
      ...mockViewModel,
      task: {
        ...mockViewModel.task,
        title: "A very long task title that could potentially blow out the card width if not wrapped correctly with pr-12 or break-words",
        source: "very-long-repository-name/very-long-branch-name/very-long-file-name.ts",
        assignee: "Very Long Assignee Name That Might Break Layout",
      },
      sessionId: "sess_verylongsessionidentifiertesting1234567890",
    };
    const longAgentPresetName = "Very Long Agent Preset Name Testing Limits";

    const { container } = render(
      <KanbanTaskCard
        viewModel={overflowViewModel}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        agentPresetName={longAgentPresetName}
      />
    );

    const title = container.querySelector("h4");
    expect(title).toHaveClass("break-words");
    expect(title).not.toHaveClass("pr-12");

    const sourceSpan = container.querySelector('.font-mono.truncate');
    expect(sourceSpan).toHaveClass('min-w-0');

    const actionsContainer = container.querySelector('.kanban-card__actions');
    expect(actionsContainer).toHaveClass('kanban-card__actions');
    expect(actionsContainer).not.toHaveClass('absolute');
    expect(actionsContainer).toHaveAttribute("aria-label", "Actions for task TASK-123");
  });

});
