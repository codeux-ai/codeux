/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
// @ts-ignore
globalThis.React = { createElement: h };
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/preact";
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
import { fetchNodeFlows } from "../../../dashboard/src/v2/lib/node-flow-api.js";
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
vi.mock("../../../dashboard/src/v2/lib/node-flow-api.js", () => ({
  fetchNodeFlows: vi.fn().mockResolvedValue({ flows: [] }),
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
            recurrence: { frequency: "minutely", interval: 15, endMode: "never" },
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
    expect(pageRoot.className).toContain("px-4");
    expect(pageRoot.className).toContain("py-10");
    expect(pageRoot.className).toContain("md:px-8");
    expect(screen.getByTestId("scheduler-primary-header")).toBeInTheDocument();
    const calendarPanel = screen.getByTestId("scheduler-calendar-panel");
    const formPanel = screen.getByTestId("scheduler-form-panel");
    expect(calendarPanel.className).toContain("bg-white/70");
    expect(calendarPanel.className).toContain("dark:bg-void-800/60");
    expect(formPanel.className).toContain("bg-white/70");
    expect(formPanel.className).toContain("dark:bg-void-800/60");

    expect(screen.getByRole("heading", { level: 1, name: /Schedule Events/i })).toBeInTheDocument();

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
    expect(pageRoot.textContent).toContain("Every 15 minutes");
    expect(pageRoot.innerHTML).not.toContain("#f5f1e8");
    expect(pageRoot.innerHTML).not.toContain("#f7f3ea");
  });

  it("handles switching target types and scheduler submissions", async () => {
    vi.mocked(fetchSprints).mockResolvedValue({ sprints: [{ id: "sprint-1", name: "Sprint 1", status: "active" }] } as any);
    vi.mocked(fetchQuicksprintTemplates).mockResolvedValue([] as any);
    vi.mocked(fetchNodeFlows).mockResolvedValue({
      flows: [
        {
          id: "flow-1",
          projectId: "proj-1",
          title: "Data Sync Flow",
          description: "",
          graph: { nodes: [], edges: [] },
          version: 1,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    } as any);
    vi.mocked(fetchProjectSchedule).mockResolvedValue({ entries: [], occurrences: [] } as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Runtime Scheduler")).toBeInTheDocument();
    });

    // Switch to Quicksprint target
    const quicksprintTab = screen.getByRole("button", { name: /quicksprint/i });
    fireEvent.click(quicksprintTab);

    expect(quicksprintTab).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Task count")).toBeInTheDocument();

    // Switch to Chat message target
    const chatTab = screen.getByRole("button", { name: /chat message/i });
    fireEvent.click(chatTab);

    expect(chatTab).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Selected schedule target: Chat/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Ask the chat agent to check status/i)).toBeInTheDocument();

    const nodeFlowTab = screen.getByRole("button", { name: /node flow/i });
    fireEvent.click(nodeFlowTab);

    expect(nodeFlowTab).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Selected schedule target: Node flow/)).toBeInTheDocument();
    expect(screen.getByText("Data Sync Flow")).toBeInTheDocument();
    expect(screen.getByLabelText(/json input/i)).toBeInTheDocument();
    expect(fetchNodeFlows).toHaveBeenCalledWith("proj-1", expect.any(AbortSignal));
  });

  it("blocks node-flow schedules with invalid JSON input", async () => {
    vi.mocked(fetchSprints).mockResolvedValue({ sprints: [] } as any);
    vi.mocked(fetchQuicksprintTemplates).mockResolvedValue([] as any);
    vi.mocked(fetchNodeFlows).mockResolvedValue({
      flows: [
        {
          id: "flow-1",
          projectId: "proj-1",
          title: "Data Sync Flow",
          description: "",
          graph: { nodes: [], edges: [] },
          version: 1,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    } as any);
    vi.mocked(fetchProjectSchedule).mockResolvedValue({ entries: [], occurrences: [] } as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Runtime Scheduler")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /node flow/i }));
    fireEvent.input(screen.getByLabelText(/json input/i), { target: { value: "{\"branch\":" } });
    fireEvent.click(screen.getByRole("button", { name: /schedule/i }));

    expect(await screen.findByText("Node flow input must be valid JSON.")).toBeInTheDocument();
    expect(createSchedulerEntry).not.toHaveBeenCalled();
  });

  it("creates node-flow schedules with parsed JSON input", async () => {
    vi.mocked(fetchSprints).mockResolvedValue({ sprints: [] } as any);
    vi.mocked(fetchQuicksprintTemplates).mockResolvedValue([] as any);
    vi.mocked(fetchNodeFlows).mockResolvedValue({
      flows: [
        {
          id: "flow-1",
          projectId: "proj-1",
          title: "Data Sync Flow",
          description: "",
          graph: { nodes: [], edges: [] },
          version: 3,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    } as any);
    vi.mocked(fetchProjectSchedule).mockResolvedValue({ entries: [], occurrences: [] } as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Runtime Scheduler")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /node flow/i }));
    fireEvent.input(screen.getByLabelText(/json input/i), {
      target: { value: "{\"branch\":\"dev\",\"dryRun\":true,\"count\":2}" },
    });
    fireEvent.click(screen.getByRole("button", { name: /schedule/i }));

    await waitFor(() => {
      expect(createSchedulerEntry).toHaveBeenCalledTimes(1);
    });

    const [, payload] = vi.mocked(createSchedulerEntry).mock.calls[0]!;
    expect(payload).toEqual(expect.objectContaining({
      title: "Run Data Sync Flow",
      targetType: "node_flow",
      nodeFlowTarget: {
        flowId: "flow-1",
        input: {
          branch: "dev",
          dryRun: true,
          count: 2,
        },
      },
      recurrence: { frequency: "none", interval: 1, endMode: "never" },
    }));
    expect(payload.nodeFlowTarget?.input).not.toBe("{\"branch\":\"dev\",\"dryRun\":true,\"count\":2}");
  });

  it("submits minute-based recurrence payloads from the form", async () => {
    vi.mocked(fetchSprints).mockResolvedValue({ sprints: [{ id: "sprint-1", name: "Sprint 1", status: "active" }] } as any);
    vi.mocked(fetchQuicksprintTemplates).mockResolvedValue([] as any);
    vi.mocked(fetchProjectSchedule).mockResolvedValue({ entries: [], occurrences: [] } as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Runtime Scheduler")).toBeInTheDocument();
    });

    const formPanel = screen.getByTestId("scheduler-form-panel");
    const scoped = within(formPanel);

    fireEvent.click(scoped.getByRole("checkbox"));

    const frequencyTrigger = scoped.getByRole("button", { name: /^days$/i });
    fireEvent.click(frequencyTrigger);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /^Minutes$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("option", { name: /^Minutes$/i }));

    const intervalInput = formPanel.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.input(intervalInput, { target: { value: "15" } });

    fireEvent.click(screen.getByRole("button", { name: /schedule/i }));

    await waitFor(() => {
      expect(createSchedulerEntry).toHaveBeenCalledWith("proj-1", expect.objectContaining({
        targetType: "sprint",
        sprintTarget: { sprintId: "sprint-1" },
        recurrence: { frequency: "minutely", interval: 15, endMode: "never", count: null, until: null },
      }));
    });
  });

  it("creates an after-sprint-end quicksprint schedule with the shared anchor payload", async () => {
    vi.mocked(fetchSprints).mockResolvedValue({
      sprints: [
        { id: "sprint-source", name: "Source Sprint", status: "running" },
        { id: "sprint-complete", name: "Completed Sprint", status: "completed" },
      ],
    } as any);
    vi.mocked(fetchQuicksprintTemplates).mockResolvedValue([
      { id: "template-1", name: "Quicksprint Template 1" },
    ] as any);
    vi.mocked(fetchProjectSchedule).mockResolvedValue({ entries: [], occurrences: [] } as any);

    const { container } = renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Runtime Scheduler")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /quicksprint/i }));
    fireEvent.click(screen.getByLabelText(/after another sprint ends/i));

    const offsetInput = screen.getByLabelText(/offset minutes/i) as HTMLInputElement;
    fireEvent.input(offsetInput, { target: { value: "30" } });

    fireEvent.click(screen.getByRole("button", { name: /schedule/i }));

    await waitFor(() => {
      expect(createSchedulerEntry).toHaveBeenCalledTimes(1);
    });

    const [, payload] = vi.mocked(createSchedulerEntry).mock.calls[0]!;
    expect(payload).toEqual(expect.objectContaining({
      targetType: "quicksprint",
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: "sprint-source",
        offsetMinutes: 30,
      },
      quicksprintTarget: {
        templateId: "template-1",
        taskCount: 5,
        submitMode: "plan_and_start",
      },
      recurrence: { frequency: "none", interval: 1, endMode: "never" },
    }));
    expect(payload).not.toHaveProperty("scheduledFor");
    expect(container.textContent).toContain("After-sprint-end schedules are one-time entries.");
  });

  it("toggles view between calendar and 24 hours", async () => {
    vi.mocked(fetchProjectSchedule).mockResolvedValue({ entries: [], occurrences: [] } as any);
    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Calendar view")).toBeInTheDocument();
    });

    const dayViewToggle = screen.getByRole("tab", { name: /24 hours/i });
    fireEvent.click(dayViewToggle);

    expect(screen.getByText("24 hour view")).toBeInTheDocument();
    expect(dayViewToggle).toHaveAttribute("role", "tab");
    expect(dayViewToggle).toHaveAttribute("aria-selected", "true");
    expect(dayViewToggle).toHaveAttribute("aria-controls", "scheduler-view-panel");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "scheduler-view-tab-day");
    expect(dayViewToggle.className).toContain("bg-signal-500");
    expect(dayViewToggle.className).toContain("text-void-900");
  });

  it("keeps cached schedule content visible during refresh", async () => {
    const mockSchedule = {
      entries: [],
      occurrences: [
        {
          id: "occurrence-cached",
          entryId: "entry-1",
          title: "Cached Run",
          targetType: "sprint",
          startsAt: new Date().toISOString(),
        },
      ],
    };
    let resolveRefresh: ((value: any) => void) | null = null;
    vi.mocked(fetchProjectSchedule)
      .mockResolvedValueOnce(mockSchedule as any)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = resolve;
      }) as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Cached Run")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    expect(await screen.findByText(/Updating schedule\. Showing cached 1 visible occurrences/)).toBeInTheDocument();
    expect(screen.getByText("Cached Run")).toBeInTheDocument();

    resolveRefresh?.(mockSchedule);
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

  it("renders agent wakeup and task schedules without exposing unsupported creation controls", async () => {
    const occurrenceTime = new Date();
    occurrenceTime.setHours(10, 0, 0, 0);
    const mockSchedule = {
      entries: [
        {
          id: "entry-agent",
          projectId: "proj-1",
          title: "Agent Standup Wakeup",
          targetType: "agent_wakeup",
          status: "scheduled",
          scheduledFor: occurrenceTime.toISOString(),
          timezone: "UTC",
          agentWakeupTarget: {
            bodyMarkdown: "Wake up and check the morning queue.",
            threadId: "thread-123",
            title: "Morning wakeup",
            origin: "agent_scheduler",
            source: "agent_scheduler",
            createdByAgentId: "agent-1",
          },
          runCount: 0,
          nextRunAt: occurrenceTime.toISOString(),
          recurrence: { frequency: "none", interval: 1, endMode: "never" },
        },
        {
          id: "entry-task",
          projectId: "proj-1",
          title: "Retry blocked task",
          targetType: "task",
          status: "paused",
          scheduledFor: occurrenceTime.toISOString(),
          timezone: "UTC",
          taskTarget: {
            taskId: "task-42",
            provider: "codex",
            origin: "agent_scheduler",
            source: "agent_scheduler",
            createdByAgentId: "agent-1",
          },
          runCount: 2,
          nextRunAt: null,
          recurrence: { frequency: "hourly", interval: 2, endMode: "never" },
        },
      ],
      occurrences: [
        {
          id: "occurrence-agent",
          entryId: "entry-agent",
          projectId: "proj-1",
          title: "Agent Standup Wakeup",
          targetType: "agent_wakeup",
          status: "scheduled",
          startsAt: occurrenceTime.toISOString(),
          occurrenceIndex: 0,
          isNextRun: true,
          isCompletedRun: false,
        },
      ],
    };

    vi.mocked(fetchProjectSchedule).mockResolvedValue(mockSchedule as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getAllByText("Agent Standup Wakeup").length).toBeGreaterThan(0);
    });

    const formPanel = screen.getByTestId("scheduler-form-panel");
    expect(within(formPanel).queryByRole("button", { name: /agent wakeup/i })).not.toBeInTheDocument();
    expect(within(formPanel).queryByRole("button", { name: /^task$/i })).not.toBeInTheDocument();

    const agentRow = screen.getByTestId("scheduler-entry-entry-agent");
    expect(within(agentRow).getByText("Agent wakeup")).toBeInTheDocument();
    expect(within(agentRow).getByText(/Agent wakeup: thread-123/)).toBeInTheDocument();
    expect(within(agentRow).getByRole("button", { name: /cannot be edited in the dashboard form/i })).toHaveAttribute("aria-disabled", "true");
    expect(within(agentRow).getByRole("button", { name: /pause schedule entry/i })).toBeInTheDocument();
    expect(within(agentRow).getByRole("button", { name: /delete schedule entry/i })).toBeInTheDocument();

    const taskRow = screen.getByTestId("scheduler-entry-entry-task");
    expect(within(taskRow).getByText("Task")).toBeInTheDocument();
    expect(within(taskRow).getByText(/Task rerun: task-42/)).toBeInTheDocument();
    expect(within(taskRow).getByText(/codex/)).toBeInTheDocument();
    expect(within(taskRow).getByRole("button", { name: /resume schedule entry/i })).toBeInTheDocument();

    expect(screen.getByTestId("scheduler-stat-active").textContent).toContain("1");
    expect(screen.getAllByText("scheduled").length).toBeGreaterThan(0);
    expect(screen.queryByText("Chat", { selector: "span" })).not.toBeInTheDocument();
  });

  it("keeps pause, resume, and delete available for agent-created schedules while edit is blocked", async () => {
    const mockSchedule = {
      entries: [
        {
          id: "entry-agent",
          projectId: "proj-1",
          title: "Agent Wakeup",
          targetType: "agent_wakeup",
          status: "scheduled",
          scheduledFor: "2026-06-01T12:00:00.000Z",
          timezone: "UTC",
          agentWakeupTarget: {
            bodyMarkdown: "Check in.",
            origin: "agent_scheduler",
            source: "agent_scheduler",
          },
          runCount: 0,
          nextRunAt: "2026-06-01T12:00:00.000Z",
          recurrence: { frequency: "none", interval: 1, endMode: "never" },
        },
      ],
      occurrences: [],
    };

    vi.mocked(fetchProjectSchedule).mockResolvedValue(mockSchedule as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Agent Wakeup")).toBeInTheDocument();
    });

    const row = screen.getByTestId("scheduler-entry-entry-agent");
    fireEvent.click(within(row).getByRole("button", { name: /cannot be edited in the dashboard form/i }));
    expect(screen.getByText(/Agent wakeup schedules are created by the secured MCP scheduler tool/i)).toBeInTheDocument();
    expect(updateSchedulerEntry).not.toHaveBeenCalled();

    fireEvent.click(within(row).getByRole("button", { name: /pause schedule entry/i }));
    expect(updateSchedulerEntry).toHaveBeenCalledWith("entry-agent", { status: "paused" });

    fireEvent.click(within(row).getByRole("button", { name: /delete schedule entry/i }));
    expect(deleteSchedulerEntry).toHaveBeenCalledWith("entry-agent");
  });

  it("continues to render supported scheduler target summaries", async () => {
    const mockSprints = [
      { id: "sprint-1", name: "Sprint 1", status: "active" },
    ];
    const mockTemplates = [
      { id: "template-1", name: "Template 1" },
    ];
    const mockSchedule = {
      entries: [
        {
          id: "entry-sprint",
          projectId: "proj-1",
          title: "Run Sprint",
          targetType: "sprint",
          status: "scheduled",
          scheduledFor: "2026-06-01T12:00:00.000Z",
          timezone: "UTC",
          sprintTarget: { sprintId: "sprint-1" },
          runCount: 0,
          nextRunAt: "2026-06-01T12:00:00.000Z",
          recurrence: { frequency: "none", interval: 1, endMode: "never" },
        },
        {
          id: "entry-quicksprint",
          projectId: "proj-1",
          title: "Run Template",
          targetType: "quicksprint",
          status: "scheduled",
          scheduledFor: "2026-06-01T13:00:00.000Z",
          timezone: "UTC",
          quicksprintTarget: { templateId: "template-1", taskCount: 3, submitMode: "plan_and_start" },
          runCount: 0,
          nextRunAt: "2026-06-01T13:00:00.000Z",
          recurrence: { frequency: "none", interval: 1, endMode: "never" },
        },
        {
          id: "entry-chat",
          projectId: "proj-1",
          title: "Send Chat",
          targetType: "chat",
          status: "scheduled",
          scheduledFor: "2026-06-01T14:00:00.000Z",
          timezone: "UTC",
          chatTarget: { bodyMarkdown: "Ping", threadId: "thread-1" },
          runCount: 0,
          nextRunAt: "2026-06-01T14:00:00.000Z",
          recurrence: { frequency: "none", interval: 1, endMode: "never" },
        },
        {
          id: "entry-memory",
          projectId: "proj-1",
          title: "Clean Memory",
          targetType: "memory_remediation",
          status: "scheduled",
          scheduledFor: "2026-06-01T15:00:00.000Z",
          timezone: "UTC",
          memoryRemediationTarget: { mode: "ai" },
          runCount: 0,
          nextRunAt: "2026-06-01T15:00:00.000Z",
          recurrence: { frequency: "none", interval: 1, endMode: "never" },
        },
      ],
      occurrences: [],
    };

    vi.mocked(fetchSprints).mockResolvedValue({ sprints: mockSprints } as any);
    vi.mocked(fetchQuicksprintTemplates).mockResolvedValue(mockTemplates as any);
    vi.mocked(fetchProjectSchedule).mockResolvedValue(mockSchedule as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Run Sprint")).toBeInTheDocument();
    });

    expect(screen.getByText(/Sprint: Sprint 1/)).toBeInTheDocument();
    expect(screen.getByText(/Quicksprint: Template 1/)).toBeInTheDocument();
    expect(screen.getByText(/Chat thread: thread-1/)).toBeInTheDocument();
    expect(screen.getByText(/Memory remediation: AI review/)).toBeInTheDocument();
  });

  it("renders node-flow scheduled entries in the calendar and entry list", async () => {
    const occurrenceTime = new Date();
    occurrenceTime.setHours(11, 0, 0, 0);
    vi.mocked(fetchNodeFlows).mockResolvedValue({
      flows: [
        {
          id: "flow-1",
          projectId: "proj-1",
          title: "Data Sync Flow",
          description: "",
          graph: { nodes: [], edges: [] },
          version: 3,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    } as any);
    vi.mocked(fetchProjectSchedule).mockResolvedValue({
      entries: [
        {
          id: "entry-node-flow",
          projectId: "proj-1",
          title: "Run data sync",
          targetType: "node_flow",
          status: "scheduled",
          scheduledFor: occurrenceTime.toISOString(),
          timezone: "UTC",
          nodeFlowTarget: {
            flowId: "flow-1",
            input: { branch: "dev" },
          },
          runCount: 0,
          nextRunAt: occurrenceTime.toISOString(),
          recurrence: { frequency: "none", interval: 1, endMode: "never" },
        },
      ],
      occurrences: [
        {
          id: "occurrence-node-flow",
          entryId: "entry-node-flow",
          projectId: "proj-1",
          title: "Run data sync",
          targetType: "node_flow",
          status: "scheduled",
          startsAt: occurrenceTime.toISOString(),
          occurrenceIndex: 0,
          isNextRun: true,
          isCompletedRun: false,
        },
      ],
    } as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getAllByText("Run data sync").length).toBeGreaterThan(0);
    });

    const row = screen.getByTestId("scheduler-entry-entry-node-flow");
    expect(within(row).getByText("Node flow")).toBeInTheDocument();
    expect(within(row).getByText(/Node flow: Data Sync Flow/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: /^edit schedule entry$/i }));

    const input = screen.getByLabelText(/json input/i) as HTMLTextAreaElement;
    expect(input.value).toContain('"branch": "dev"');
    expect(screen.getAllByText("Node flow").length).toBeGreaterThan(1);
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
          recurrence: { frequency: "minutely", interval: 15, endMode: "never" },
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

    expect(screen.getByRole("button", { name: /^Minutes$/i })).toBeInTheDocument();

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
        recurrence: { frequency: "minutely", interval: 15, endMode: "never", count: null, until: null },
      });
    });

    // Form title should revert back to "Add entry"
    expect(screen.getByText("Add entry")).toBeInTheDocument();
  });

  it("hydrates and updates an anchored sprint schedule in edit mode", async () => {
    const mockSprints = [
      { id: "sprint-source", name: "Source Sprint", status: "completed" },
      { id: "sprint-target", name: "Target Sprint", status: "running" },
    ];
    const mockSchedule = {
      entries: [
        {
          id: "entry-anchor",
          projectId: "proj-1",
          title: "Anchored Sprint Title",
          targetType: "sprint",
          status: "scheduled",
          scheduledFor: "2026-06-01T12:00:00.000Z",
          scheduleAnchor: {
            mode: "after_sprint_end",
            sourceSprintId: "sprint-source",
            offsetMinutes: 10,
          },
          timezone: "UTC",
          sprintTarget: { sprintId: "sprint-target" },
          recurrence: { frequency: "none", interval: 1, endMode: "never" },
          runCount: 0,
        },
      ],
      occurrences: [],
    };

    vi.mocked(fetchSprints).mockResolvedValue({ sprints: mockSprints } as any);
    vi.mocked(fetchProjectSchedule).mockResolvedValue(mockSchedule as any);

    renderSchedulerPage();

    await waitFor(() => {
      expect(screen.getByText("Anchored Sprint Title")).toBeInTheDocument();
    });

    expect(screen.getByText(/After Source Sprint ends \+ 10 minutes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^edit schedule entry$/i }));

    expect(screen.getByText("Edit entry")).toBeInTheDocument();
    expect(screen.getByLabelText(/after another sprint ends/i)).toBeChecked();
    expect(screen.getByText("Target Sprint")).toBeInTheDocument();
    expect(screen.getByText("Source Sprint (completed)")).toBeInTheDocument();

    const offsetInput = screen.getByLabelText(/offset minutes/i) as HTMLInputElement;
    expect(offsetInput.value).toBe("10");
    fireEvent.input(offsetInput, { target: { value: "20" } });

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(updateSchedulerEntry).toHaveBeenCalledWith("entry-anchor", expect.objectContaining({
        title: "Anchored Sprint Title",
        targetType: "sprint",
        timezone: "UTC",
        scheduleAnchor: {
          mode: "after_sprint_end",
          sourceSprintId: "sprint-source",
          offsetMinutes: 20,
        },
        sprintTarget: { sprintId: "sprint-target" },
        recurrence: { frequency: "none", interval: 1, endMode: "never" },
      }));
    });
    const [, payload] = vi.mocked(updateSchedulerEntry).mock.calls[0]!;
    expect(payload).not.toHaveProperty("scheduledFor");
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
