/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
// @ts-ignore
globalThis.React = { createElement: h };
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

// Mock GSAP to avoid timing issues in tests
vi.mock("gsap", () => {
  const mockGsap = {
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    quickTo: vi.fn(() => vi.fn()),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
  };
  return {
    default: mockGsap,
    ...mockGsap,
  };
});

import { SchedulerPage } from "../../../dashboard/src/v2/SchedulerPage.js";
import { ProjectDataContext } from "../../../dashboard/src/v2/context/project-data.js";
import { fetchSprints } from "../../../dashboard/src/v2/lib/project-api.js";
import { fetchQuicksprintTemplates } from "../../../dashboard/src/v2/lib/quicksprint-api.js";
import {
  fetchProjectSchedule,
  createSchedulerEntry,
  updateSchedulerEntry,
  deleteSchedulerEntry,
} from "../../../dashboard/src/v2/lib/scheduler-api.js";
import { subscribeToDashboardRealtime } from "../../../dashboard/src/lib/realtime/dashboard-realtime-client.js";

// Mock API modules
vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchSprints: vi.fn().mockResolvedValue({ sprints: [] }),
}));
vi.mock("../../../dashboard/src/v2/lib/quicksprint-api.js", () => ({
  fetchQuicksprintTemplates: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../dashboard/src/v2/lib/scheduler-api.js", () => ({
  fetchProjectSchedule: vi.fn().mockResolvedValue({ entries: [], occurrences: [] }),
  createSchedulerEntry: vi.fn().mockResolvedValue({ id: "entry-1" }),
  updateSchedulerEntry: vi.fn().mockResolvedValue({ id: "entry-1" }),
  deleteSchedulerEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn().mockReturnValue(vi.fn()),
}));

const mockProjectData = {
  projects: [{ id: "proj-1", name: "Project 1", isActive: true }],
  selectedProject: { id: "proj-1", name: "Project 1", isActive: true },
  setSelectedProject: vi.fn(),
  loadProjects: vi.fn(),
};

const renderSchedulerPage = (projectContextValue: any = mockProjectData) => {
  return render(
    <ProjectDataContext.Provider value={projectContextValue}>
      <SchedulerPage />
    </ProjectDataContext.Provider>
  );
};

describe("SchedulerPage", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders project placeholder when no project is selected", () => {
    renderSchedulerPage({
      projects: [],
      selectedProject: null,
      setSelectedProject: vi.fn(),
      loadProjects: vi.fn(),
    });

    expect(screen.getByText("Select a project to schedule work.")).toBeInTheDocument();
  });

  it("renders page title, eyebrow, and components when project is selected", async () => {
    const mockSprints = [
      { id: "sprint-1", name: "Sprint 1", status: "active" },
      { id: "sprint-2", name: "Sprint 2", status: "completed" },
    ];
    const mockTemplates = [
      { id: "template-1", name: "Quicksprint Template 1" },
    ];
    const mockSchedule = {
      entries: [
        {
          id: "entry-1",
          projectId: "proj-1",
          title: "Scheduled Run Sprint 1",
          targetType: "sprint",
          status: "scheduled",
          runCount: 1,
          nextRunAt: "2026-06-01T12:00:00Z",
          recurrence: { frequency: "daily", interval: 1, endMode: "never" },
        },
      ],
      occurrences: [
        {
          id: "occurrence-1",
          entryId: "entry-1",
          title: "Scheduled Run Sprint 1",
          targetType: "sprint",
          startsAt: "2026-06-01T12:00:00Z",
        },
      ],
    };

    vi.mocked(fetchSprints).mockResolvedValue({ sprints: mockSprints } as any);
    vi.mocked(fetchQuicksprintTemplates).mockResolvedValue(mockTemplates as any);
    vi.mocked(fetchProjectSchedule).mockResolvedValue(mockSchedule as any);

    renderSchedulerPage();

    // Verify loading and header structure
    await waitFor(() => {
      expect(screen.getByText("Runtime Scheduler")).toBeInTheDocument();
    });

    const pageRoot = screen.getByTestId("scheduler-page-root");
    expect(pageRoot.className).toContain("px-8");
    expect(pageRoot.className).toContain("py-24");
    expect(pageRoot.className).toContain("md:px-20");
    expect(screen.getByTestId("scheduler-primary-header")).toBeInTheDocument();
    const calendarPanel = screen.getByTestId("scheduler-calendar-panel");
    const formPanel = screen.getByTestId("scheduler-form-panel");
    expect(calendarPanel.className).toContain("bg-white/70");
    expect(calendarPanel.className).toContain("dark:bg-void-800/60");
    expect(formPanel.className).toContain("bg-white/70");
    expect(formPanel.className).toContain("dark:bg-void-800/60");

    expect(screen.getByRole("heading", { level: 1, name: /Schedule/i })).toBeInTheDocument();
    expect(screen.getByText("Events.")).toBeInTheDocument();

    // Verify stats
    expect(screen.getByText("Active entries")).toBeInTheDocument();
    expect(screen.getByText("Repeating")).toBeInTheDocument();
    expect(screen.getByText("Next run")).toBeInTheDocument();

    // Verify add entry aside and tabs
    expect(screen.getByText("Add entry")).toBeInTheDocument();
    expect(screen.getAllByText("Sprint").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Quicksprint").length).toBeGreaterThan(0);
    expect(screen.getByText("Chat message")).toBeInTheDocument();

    // Verify scheduled entries section
    expect(screen.getByText("Scheduled entries")).toBeInTheDocument();
    expect(screen.getAllByText("Scheduled Run Sprint 1").length).toBeGreaterThan(0);
    expect(pageRoot.innerHTML).not.toContain("#f5f1e8");
    expect(pageRoot.innerHTML).not.toContain("#f7f3ea");
  });

  it("handles switching target types and scheduler submissions", async () => {
    vi.mocked(fetchSprints).mockResolvedValue({ sprints: [] } as any);
    vi.mocked(fetchQuicksprintTemplates).mockResolvedValue([] as any);
    vi.mocked(fetchProjectSchedule).mockResolvedValue({ entries: [], occurrences: [] } as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Runtime Scheduler")).toBeInTheDocument();
    });

    // Switch to Quicksprint target
    const quicksprintTab = screen.getByRole("button", { name: /quicksprint/i });
    fireEvent.click(quicksprintTab);

    expect(screen.getByText("Task count")).toBeInTheDocument();

    // Switch to Chat message target
    const chatTab = screen.getByRole("button", { name: /chat message/i });
    fireEvent.click(chatTab);

    expect(screen.getByPlaceholderText(/Ask the chat agent to check status/i)).toBeInTheDocument();
  });

  it("toggles view between calendar and 24 hours", async () => {
    vi.mocked(fetchProjectSchedule).mockResolvedValue({ entries: [], occurrences: [] } as any);
    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Calendar view")).toBeInTheDocument();
    });

    const dayViewToggle = screen.getByRole("button", { name: /24 hours/i });
    fireEvent.click(dayViewToggle);

    expect(screen.getByText("24 hour view")).toBeInTheDocument();
    expect(dayViewToggle.className).toContain("bg-signal-500");
    expect(dayViewToggle.className).toContain("text-void-900");
  });

  it("handles scheduled entry toggle pause/resume and delete", async () => {
    const mockSchedule = {
      entries: [
        {
          id: "entry-1",
          projectId: "proj-1",
          title: "Scheduled Run",
          targetType: "sprint",
          status: "scheduled",
          runCount: 0,
          nextRunAt: "2026-06-01T12:00:00Z",
          recurrence: { frequency: "none", interval: 1, endMode: "never" },
        },
      ],
      occurrences: [],
    };

    vi.mocked(fetchProjectSchedule).mockResolvedValue(mockSchedule as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Scheduled Run")).toBeInTheDocument();
    });

    // Click pause
    const pauseButton = screen.getByRole("button", { name: /pause schedule entry/i });
    fireEvent.click(pauseButton);
    expect(updateSchedulerEntry).toHaveBeenCalledWith("entry-1", { status: "paused" });

    // Click delete
    const deleteButton = screen.getByRole("button", { name: /delete schedule entry/i });
    fireEvent.click(deleteButton);
    expect(deleteSchedulerEntry).toHaveBeenCalledWith("entry-1");
  });

  it("opens edit mode, updates title and scheduled time, and saves the entry using PATCH", async () => {
    const mockSprints = [
      { id: "sprint-1", name: "Sprint 1", status: "active" },
    ];
    const mockSchedule = {
      entries: [
        {
          id: "entry-1",
          projectId: "proj-1",
          title: "Original Sprint Title",
          targetType: "sprint",
          status: "scheduled",
          scheduledFor: "2026-06-01T12:00:00.000Z",
          timezone: "UTC",
          sprintTarget: { sprintId: "sprint-1" },
          recurrence: { frequency: "none", interval: 1, endMode: "never" },
          runCount: 0,
        },
      ],
      occurrences: [],
    };

    vi.mocked(fetchSprints).mockResolvedValue({ sprints: mockSprints } as any);
    vi.mocked(fetchProjectSchedule).mockResolvedValue(mockSchedule as any);

    const { container } = renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Original Sprint Title")).toBeInTheDocument();
    });

    // Verify form header before edit
    expect(screen.getByText("Add entry")).toBeInTheDocument();

    // Click Edit button
    const editButton = screen.getByRole("button", { name: /^edit schedule entry$/i });
    fireEvent.click(editButton);

    // Verify form header updates to "Edit entry"
    expect(screen.getByText("Edit entry")).toBeInTheDocument();

    // The title field should be hydrated with the current title
    const titleInput = screen.getByPlaceholderText("Optional description/title") as HTMLInputElement;
    expect(titleInput.value).toBe("Original Sprint Title");

    // Change title
    fireEvent.input(titleInput, { target: { value: "Updated Sprint Title" } });

    // Change scheduled time
    const dateTimeInput = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.input(dateTimeInput, { target: { value: "2026-06-02T15:30" } });

    // Click Save changes button
    const saveButton = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveButton);

    // Verify updateSchedulerEntry was called with the correct patched payload
    await waitFor(() => {
      expect(updateSchedulerEntry).toHaveBeenCalledWith("entry-1", {
        title: "Updated Sprint Title",
        targetType: "sprint",
        scheduledFor: new Date("2026-06-02T15:30").toISOString(),
        timezone: "UTC",
        sprintTarget: { sprintId: "sprint-1" },
        recurrence: { frequency: "none", interval: 1, endMode: "never" },
      });
    });

    // Form title should revert back to "Add entry"
    expect(screen.getByText("Add entry")).toBeInTheDocument();
  });

  it("allows cancelling edit mode without mutating the entry", async () => {
    const mockSchedule = {
      entries: [
        {
          id: "entry-2",
          projectId: "proj-1",
          title: "Cancel Target Entry",
          targetType: "chat",
          status: "scheduled",
          scheduledFor: "2026-06-01T12:00:00.000Z",
          timezone: "UTC",
          chatTarget: { bodyMarkdown: "Ping text" },
          recurrence: { frequency: "none", interval: 1, endMode: "never" },
          runCount: 0,
        },
      ],
      occurrences: [],
    };

    vi.mocked(fetchProjectSchedule).mockResolvedValue(mockSchedule as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Cancel Target Entry")).toBeInTheDocument();
    });

    // Click Edit button
    const editButton = screen.getByRole("button", { name: /^edit schedule entry$/i });
    fireEvent.click(editButton);

    expect(screen.getByText("Edit entry")).toBeInTheDocument();

    // Click Cancel button
    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    // Revert form header
    expect(screen.getByText("Add entry")).toBeInTheDocument();

    // Verify updateSchedulerEntry was NOT called
    expect(updateSchedulerEntry).not.toHaveBeenCalled();
  });
});
