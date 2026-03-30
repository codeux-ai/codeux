/** @vitest-environment jsdom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

import { LiveSessionPage } from "../../../dashboard/src/v2/LiveSessionPage.js";
import { useDashboardRuntimeData } from "../../../dashboard/src/hooks/use-dashboard-runtime-data.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";

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

const mockExecution = {
  projectId: "p1",
  projectName: "Project 1",
  sprintRuns: [],
  taskDispatches: [],
  connections: [],
  primaryAssignedWorker: null,
  overflowAssignedWorkers: [],
  attentionItems: [],
  recentEvents: [],
  updatedAt: "2024-01-01T00:00:00Z",
};

describe("LiveSessionPage Runtime Status", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(useProjectData).mockReturnValue({ selectedProjectId: "p1" } as any);
  });

  it("renders the LiveTransportBanner in a disconnected state", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue({
      error: null,
      gitStatus: null,
      gitStatusError: null,
      initialLoadComplete: true,
      transportState: "disconnected",
      isRecovering: false,
      snapshotUpdatedAt: new Date().toISOString(),
      refreshGitStatus: vi.fn(),
      refreshRuntimeStatus: vi.fn(),
      selectedSprintId: "s1",
      status: { subtasks: [], timestamp: "2024-01-01T00:00:00Z", project_id: "p1", sprint_id: "s1" },
      execution: mockExecution,
      stats: { total: 0 } as any,
      tasksWithLiveActivities: [],
    });

    render(<LiveSessionPage />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText(/Lost connection to the live stream/)).toBeInTheDocument();
  });

  it("renders the LiveTransportBanner in a recovering state", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue({
      error: null,
      gitStatus: null,
      gitStatusError: null,
      initialLoadComplete: true,
      transportState: "connected",
      isRecovering: true,
      snapshotUpdatedAt: new Date().toISOString(),
      refreshGitStatus: vi.fn(),
      refreshRuntimeStatus: vi.fn(),
      selectedSprintId: "s1",
      status: { subtasks: [], timestamp: "2024-01-01T00:00:00Z", project_id: "p1", sprint_id: "s1" },
      execution: mockExecution,
      stats: { total: 0 } as any,
      tasksWithLiveActivities: [],
    });

    render(<LiveSessionPage />);
    expect(screen.getByText("Recovering State")).toBeInTheDocument();
  });

  it("renders the LiveTransportBanner with an error message", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue({
      error: "Some network failure",
      gitStatus: null,
      gitStatusError: null,
      initialLoadComplete: true,
      transportState: "connected",
      isRecovering: false,
      snapshotUpdatedAt: new Date().toISOString(),
      refreshGitStatus: vi.fn(),
      refreshRuntimeStatus: vi.fn(),
      selectedSprintId: "s1",
      status: { subtasks: [], timestamp: "2024-01-01T00:00:00Z", project_id: "p1", sprint_id: "s1" },
      execution: mockExecution,
      stats: { total: 0 } as any,
      tasksWithLiveActivities: [],
    });

    render(<LiveSessionPage />);
    expect(screen.getByText("Connection Error")).toBeInTheDocument();
    expect(screen.getByText("Some network failure")).toBeInTheDocument();
  });
});
