/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import userEvent from "@testing-library/user-event";
import { KanbanTaskCard } from "../KanbanTaskCard.js";
import type { TaskCardViewModel } from "../../../lib/tasks/task-card-view-model.js";

expect.extend(matchers);

// Mock gsap since it's used heavily in motion hooks
vi.mock("gsap", () => {
  return {
    default: {
      killTweensOf: vi.fn(),
      set: vi.fn(),
      to: vi.fn().mockImplementation((el, config) => {
        if (config?.onComplete) config.onComplete();
      }),
      fromTo: vi.fn().mockImplementation((el, from, to) => {
        if (to?.onComplete) to.onComplete();
      }),
      context: vi.fn().mockImplementation((fn) => {
        if (fn) fn();
        return { revert: vi.fn() };
      }),
    },
  };
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
  };

  const onEdit = vi.fn();
  const onDelete = vi.fn();

  it("renders correctly with full telemetry and dependencies", () => {
    const { getByText } = render(
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
  };

  it("renders correctly with missing telemetry data", () => {
    const { getByText } = render(
      <KanbanTaskCard
        viewModel={mockMissingDataViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
    expect(getByText("Task Missing Data")).toBeInTheDocument();
    expect(getByText("--")).toBeInTheDocument();
    expect(getByText("Auto")).toBeInTheDocument();
  });

  it("provides accessible interaction targets and structure", async () => {
    const user = userEvent.setup();
    const { getByTitle, container, getByText } = render(
      <KanbanTaskCard
        viewModel={mockViewModel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );

    // Ensure buttons have accessible titles/labels
    const editBtn = getByTitle("Edit task");
    const deleteBtn = getByTitle("Delete task");
    expect(editBtn).toBeInTheDocument();
    expect(deleteBtn).toBeInTheDocument();

    // Check indicator labels are accessible via their status titles
    const dependencyIndicator = getByTitle(/Depends on Backend API/i);
    expect(dependencyIndicator).toBeInTheDocument();

    // The card itself should be focusable via tabIndex={0}
    const card = container.querySelector(".kanban-card");
    expect(card).toHaveAttribute("tabIndex", "0");

    // Simulate focus to verify visibility/interaction
    if (card) {
      await user.click(card);
      expect(card).toHaveFocus();
    }
  });
});
