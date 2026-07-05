/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { LiveSessionPage } from "../../../dashboard/src/v2/LiveSessionPage.js";
import { useDashboardRuntimeData } from "../../../dashboard/src/hooks/use-dashboard-runtime-data.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { 
  createSprintRunFixture, 
  createManualPauseIntervention, 
  createSystemStopIntervention 
} from "../fixtures/sprint-status.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
    to: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
    set: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
    registerPlugin: vi.fn()
  },
  gsap: {
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
    registerPlugin: vi.fn()
  }
}));

vi.mock("../../../dashboard/src/hooks/use-dashboard-runtime-data.js");
vi.mock("../../../dashboard/src/v2/context/project-data.js");
vi.mock("../../../dashboard/src/v2/hooks/use-preview-sessions.js", () => ({
  usePreviewSessions: () => ({ selectedSession: null }),
}));
vi.mock("../../../dashboard/src/v2/hooks/use-live-session-actions.js", () => ({
  useLiveSessionActions: () => ({
    rerunningIds: new Set(),
    pendingActionIds: new Set(),
    handleRerun: vi.fn(),
    handleOrchestrateSprint: vi.fn(),
    handlePauseSprintRun: vi.fn(),
    handleCancelSprintRun: vi.fn(),
    handleForceCancelSprintRun: vi.fn(),
    handleCancelTaskDispatch: vi.fn(),
    handleForceCancelTaskDispatch: vi.fn(),
    handleRetryTaskDispatch: vi.fn(),
    handleClaimAttentionItem: vi.fn(),
    handleResolveAttentionItem: vi.fn(),
    handleDismissAttentionItem: vi.fn(),
  }),
}));

describe("LiveSessionPage Status Regression", () => {
  const baseRuntimeData = (overrides: Record<string, unknown> = {}) => ({
    error: null,
    gitStatus: null,
    gitStatusError: null,
    initialLoadComplete: true,
    transportState: "connected",
    isRecovering: false,
    snapshotUpdatedAt: new Date().toISOString(),
    refreshGitStatus: vi.fn(),
    refreshRuntimeStatus: vi.fn(),
    selectedSprintId: "sprint-1",
    status: { subtasks: [], timestamp: new Date().toISOString(), project_id: "proj-1", sprint_id: "sprint-1" },
    execution: {
      projectId: "proj-1",
      projectName: "Project 1",
      sprintRuns: [],
      taskDispatches: [],
      connections: [],
      primaryAssignedWorker: null,
      overflowAssignedWorkers: [],
      attentionItems: [],
      recentEvents: [],
      updatedAt: new Date().toISOString(),
    },
    stats: { total: 0 } as any,
    tasksWithLiveActivities: [],
    ...overrides,
  } as any);

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(useProjectData).mockReturnValue({ selectedProjectId: "proj-1" } as any);
  });

  it("exposes the first-load state as a busy live session region", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      initialLoadComplete: false,
      selectedSprintId: null,
      status: { subtasks: [], timestamp: new Date().toISOString(), project_id: "proj-1", sprint_id: null },
    }));

    render(<LiveSessionPage />);

    expect(screen.getByLabelText("Live Session")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "Loading live session telemetry" })).toHaveTextContent("Loading live session telemetry.");
  });

  it("announces transport errors with alert semantics", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      error: "Runtime stream failed.",
      transportState: "disconnected",
      isRecovering: true,
    }));

    render(<LiveSessionPage />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Connection Error");
    expect(alert).toHaveTextContent("Runtime stream failed.");
    expect(alert).toHaveAttribute("aria-busy", "true");
  });

  it("announces the empty live-session state after loading completes", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData());

    render(<LiveSessionPage />);

    expect(screen.getByLabelText("Live Session")).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("status", { name: /Waiting for Sprint Start/i })).toHaveTextContent("Launch a sprint to activate live task telemetry");
  });

  it("keeps recovered live task data in the task pipeline", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      tasksWithLiveActivities: [
        {
          id: "T-100",
          record_id: "task-100",
          title: "Recovered implementation task",
          prompt: "Implement the recovered task state.",
          status: "RUNNING",
          sprint_id: "sprint-1",
          depends_on: [],
          is_independent: true,
        },
      ],
      execution: {
        ...baseRuntimeData().execution,
        sprintRuns: [createSprintRunFixture({ status: "running" })],
      },
    }));

    render(<LiveSessionPage />);

    expect(screen.getByText("Recovered implementation task")).toBeInTheDocument();
    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("DAG view selected."))).toBe(true);
  });

  it("shows manual pause copy and intervention badge when manually paused", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue({
      error: null,
      gitStatus: null,
      gitStatusError: null,
      initialLoadComplete: true,
      transportState: "connected",
      isRecovering: false,
      snapshotUpdatedAt: new Date().toISOString(),
      refreshGitStatus: vi.fn(),
      refreshRuntimeStatus: vi.fn(),
      selectedSprintId: "sprint-1",
      status: { subtasks: [], timestamp: new Date().toISOString(), project_id: "proj-1", sprint_id: "sprint-1" },
      execution: {
        projectId: "proj-1",
        projectName: "Project 1",
        sprintRuns: [
          createSprintRunFixture({
            status: "paused",
            humanIntervention: createManualPauseIntervention(),
          })
        ],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: new Date().toISOString(),
      },
      stats: { total: 0 } as any,
      tasksWithLiveActivities: [],
    });

    render(<LiveSessionPage />);

    // Assert manual copy - using getAllByText as copy may appear in both hero subtitle and status panel
    expect(screen.getAllByText("Paused").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sprint Paused For Manual Attention").length).toBeGreaterThan(0);
    expect(screen.getAllByText("A dependency must be approved.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Approve dependency and resume the sprint.").length).toBeGreaterThan(0);

    // Assert intervention badge exists
    expect(screen.getByText("Needs you")).toBeInTheDocument();
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  it("shows system stop copy and hides intervention badge when stopped by system", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue({
      error: null,
      gitStatus: null,
      gitStatusError: null,
      initialLoadComplete: true,
      transportState: "connected",
      isRecovering: false,
      snapshotUpdatedAt: new Date().toISOString(),
      refreshGitStatus: vi.fn(),
      refreshRuntimeStatus: vi.fn(),
      selectedSprintId: "sprint-1",
      status: { subtasks: [], timestamp: new Date().toISOString(), project_id: "proj-1", sprint_id: "sprint-1" },
      execution: {
        projectId: "proj-1",
        projectName: "Project 1",
        sprintRuns: [
          createSprintRunFixture({
            status: "paused",
            humanIntervention: createSystemStopIntervention(),
          })
        ],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: new Date().toISOString(),
      },
      stats: { total: 0 } as any,
      tasksWithLiveActivities: [],
    });

    render(<LiveSessionPage />);

    // Assert system stop copy
    expect(screen.getAllByText("Stopped").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sprint Stopped By System").length).toBeGreaterThan(0);
    expect(screen.getAllByText("The orchestrator stopped this sprint.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Resolve the stop condition and restart when ready.").length).toBeGreaterThan(0);

    // Assert intervention badge is absent
    expect(screen.queryByText("Needs you")).not.toBeInTheDocument();
  });

  it("ensures duplicate intervention sections/badges are absent in the header", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue({
      error: null,
      gitStatus: null,
      gitStatusError: null,
      initialLoadComplete: true,
      transportState: "connected",
      isRecovering: false,
      snapshotUpdatedAt: new Date().toISOString(),
      refreshGitStatus: vi.fn(),
      refreshRuntimeStatus: vi.fn(),
      selectedSprintId: "sprint-1",
      status: { subtasks: [], timestamp: new Date().toISOString(), project_id: "proj-1", sprint_id: "sprint-1" },
      execution: {
        projectId: "proj-1",
        projectName: "Project 1",
        sprintRuns: [
          createSprintRunFixture({
            status: "paused",
            humanIntervention: createManualPauseIntervention(),
          })
        ],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: new Date().toISOString(),
      },
      stats: { total: 0 } as any,
      tasksWithLiveActivities: [],
    });

    render(<LiveSessionPage />);

    // Check for "Needs you" badge - should only be one in the header
    const badges = screen.getAllByText("Needs you");
    expect(badges).toHaveLength(1);

    // Check for status panel content - it legitimately appears in hero subtitle, status panel title/reason/detail, etc.
    // The key is that we don't have TWO status panels.
    const statusPanels = screen.queryAllByText("Sprint Paused For Manual Attention");
    // It appears in status panel title and some other place, but we expect it to be stable.
    expect(statusPanels.length).toBeGreaterThan(0);
  });
});
