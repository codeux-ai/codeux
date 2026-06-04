/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { render, screen, cleanup, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { LiveSessionPage } from "../../../dashboard/src/v2/LiveSessionPage.js";

expect.extend(matchers);

const forceCompleteLiveTaskMock = vi.fn();

vi.mock("gsap", () => ({
  default: {
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: vi.fn((cb?: () => void) => {
      cb?.();
      return { revert: vi.fn() };
    }),
  },
}));

vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js", () => ({
  fetchAgentPresets: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../dashboard/src/v2/lib/api/live-tasks-client.js", () => ({
  forceCompleteLiveTask: (...args: unknown[]) => forceCompleteLiveTaskMock(...args),
}));

vi.mock("../../../dashboard/src/v2/context/project-data.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../dashboard/src/v2/context/project-data.js")>();
  return {
    ...actual,
    useProjectData: () => ({ selectedProjectId: "project-1", loading: false }),
  };
});

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => false,
}));

vi.mock("../../../dashboard/src/v2/hooks/use-preview-sessions.js", () => ({
  usePreviewSessions: () => ({ selectedSession: null }),
}));

const refreshRuntimeStatusMock = vi.fn().mockResolvedValue(undefined);
const refreshGitStatusMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../dashboard/src/hooks/use-dashboard-runtime-data.js", () => ({
  useDashboardRuntimeData: () => ({
    error: null,
    execution: {
      projectId: "project-1",
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
    gitStatus: null,
    gitStatusError: null,
    initialLoadComplete: true,
    transportState: "connected",
    isRecovering: false,
    snapshotUpdatedAt: new Date().toISOString(),
    refreshRuntimeStatus: refreshRuntimeStatusMock,
    refreshGitStatus: refreshGitStatusMock,
    selectedSprintId: "sprint-1",
    status: {
      project_id: "project-1",
      sprint_id: "sprint-1",
      timestamp: new Date().toISOString(),
      instructions: "",
      reportText: "",
      subtasks: [],
    },
    tasksWithLiveActivities: [
      {
        id: "T1",
        record_id: "task-record-1",
        project_id: "project-1",
        sprint_id: "sprint-1",
        status: "RUNNING",
        title: "Ship task controls",
        prompt: "Implement task controls",
        depends_on: [],
        is_independent: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "T2",
        record_id: "task-record-2",
        project_id: "project-1",
        sprint_id: "sprint-1",
        status: "COMPLETED",
        title: "Already done task",
        prompt: "Completed prompt",
        depends_on: [],
        is_independent: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
  }),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-project-git-status.js", () => ({
  useProjectGitStatus: () => ({ data: null, loading: false, error: null, refresh: refreshGitStatusMock }),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-live-session-actions.js", () => ({
  useLiveSessionActions: () => ({
    rerunningIds: new Set<string>(),
    pendingActionIds: new Set<string>(),
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

describe("live task card actions", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    forceCompleteLiveTaskMock.mockResolvedValue(undefined);
    window.history.replaceState({}, "", "/live");
  });

  it("shows edit and force-complete controls and disables force-complete for completed tasks", () => {
    render(<LiveSessionPage />);
    expect(screen.getAllByRole("button", { name: "Edit" }).length).toBeGreaterThan(0);
    const forceButtons = screen.getAllByRole("button", { name: "Force complete" });
    expect(forceButtons.length).toBeGreaterThan(0);
    const disabledCompleted = forceButtons.find((button) => button.hasAttribute("disabled"));
    expect(disabledCompleted).toBeTruthy();
  });

  it("navigates to task edit route from the edit action", async () => {
    render(<LiveSessionPage />);
    const buttons = screen.getAllByRole("button", { name: "Edit" });
    await userEvent.click(buttons[0]!);
    expect(window.location.pathname).toBe("/tasks");
    expect(window.location.search).toContain("taskId=task-record-1");
    expect(window.location.search).toContain("sprintId=sprint-1");
  });

  it("force-completes successfully and refreshes live data", async () => {
    render(<LiveSessionPage />);
    const buttons = screen.getAllByRole("button", { name: "Force complete" });
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      expect(forceCompleteLiveTaskMock).toHaveBeenCalledWith("project-1", "task-record-1");
    });
    await waitFor(() => {
      expect(refreshRuntimeStatusMock).toHaveBeenCalled();
      expect(refreshGitStatusMock).toHaveBeenCalled();
    });
    expect(await screen.findByText("Task marked as completed.")).toBeInTheDocument();
  });

  it("renders inline error when force-complete fails", async () => {
    forceCompleteLiveTaskMock.mockRejectedValueOnce(new Error("force complete failed"));
    render(<LiveSessionPage />);
    const buttons = screen.getAllByRole("button", { name: "Force complete" });
    await userEvent.click(buttons[0]!);
    expect(await screen.findByText("force complete failed")).toBeInTheDocument();
  });
});
