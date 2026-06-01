/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
    to: vi.fn().mockImplementation((el, config) => { if (config?.onComplete) config.onComplete(); }),
    set: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
    registerPlugin: vi.fn()
  }
}));
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import { within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

import { LiveSessionPage } from "../../../dashboard/src/v2/LiveSessionPage.js";
import { useDashboardRuntimeData } from "../../../dashboard/src/hooks/use-dashboard-runtime-data.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";





vi.mock("gsap", () => ({
  gsap: {
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
    registerPlugin: vi.fn()
  },
  default: {
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

  it("renders manual pause messaging and shows intervention label only once", () => {
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
      selectedSprintId: "s1",
      status: { subtasks: [], timestamp: "2024-01-01T00:00:00Z", project_id: "p1", sprint_id: "s1" },
      execution: {
        ...mockExecution,
        sprintRuns: [{
          id: "run-manual",
          projectId: "p1",
          sprintId: "s1",
          sprintName: "Sprint 1",
          sprintNumber: 1,
          status: "paused",
          triggerType: "manual",
          triggeredBy: null,
          executorMode: "mixed",
          startedAt: "2024-01-01T10:00:00Z",
          finishedAt: null,
          lastHeartbeatAt: "2024-01-01T10:05:00Z",
          createdAt: "2024-01-01T10:00:00Z",
          activeLeaseOwnerKey: null,
          activeLeaseExpiresAt: null,
          humanIntervention: {
            title: "Sprint Paused For Manual Attention",
            reason: "A dependency must be approved.",
            instructions: "Approve dependency and resume the sprint.",
            attentionType: "manual_attention",
            severity: "medium",
            ownerType: "human",
          },
        }],
      },
      stats: { total: 0 } as any,
      tasksWithLiveActivities: [],
    });

    render(<LiveSessionPage />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getAllByText("Approve dependency and resume the sprint.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Needs you")).toHaveLength(1);
  });

  it("renders system stop messaging without manual intervention label", () => {
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
      selectedSprintId: "s1",
      status: { subtasks: [], timestamp: "2024-01-01T00:00:00Z", project_id: "p1", sprint_id: "s1" },
      execution: {
        ...mockExecution,
        sprintRuns: [{
          id: "run-system",
          projectId: "p1",
          sprintId: "s1",
          sprintName: "Sprint 1",
          sprintNumber: 1,
          status: "paused",
          triggerType: "manual",
          triggeredBy: null,
          executorMode: "mixed",
          startedAt: "2024-01-01T10:00:00Z",
          finishedAt: null,
          lastHeartbeatAt: "2024-01-01T10:05:00Z",
          createdAt: "2024-01-01T10:00:00Z",
          activeLeaseOwnerKey: null,
          activeLeaseExpiresAt: null,
          humanIntervention: {
            title: "Worker pause",
            reason: "No executable work was available.",
            instructions: "Resolve the stop condition and restart when ready.",
            attentionType: "manual_attention",
            severity: "low",
            ownerType: "worker",
          },
        }],
      },
      stats: { total: 0 } as any,
      tasksWithLiveActivities: [],
    });

    render(<LiveSessionPage />);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText("Sprint Stopped By System")).toBeInTheDocument();
    expect(screen.getAllByText("Resolve the stop condition and restart when ready.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Needs you")).not.toBeInTheDocument();
  });
});

describe("LiveSessionPage Integration Isolation", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(useProjectData).mockReturnValue({ selectedProjectId: "p1" } as any);
  });

  it("isolates task state rigidly to the explicitly selected sprint despite concurrent newer execution metadata", () => {
    const execution = {
      projectId: "p1",
      projectName: "Project 1",
      sprintRuns: [
        {
          id: "run-older",
          projectId: "p1",
          sprintId: "sprint-older",
          sprintName: "Older Sprint",
          sprintNumber: 1,
          status: "completed",
          triggerType: "manual",
          triggeredBy: null,
          executorMode: "mixed",
          startedAt: "2024-01-01T10:00:00Z",
          finishedAt: "2024-01-01T10:30:00Z",
          lastHeartbeatAt: "2024-01-01T10:30:00Z",
          createdAt: "2024-01-01T10:00:00Z",
          activeLeaseOwnerKey: null,
          activeLeaseExpiresAt: null,
          humanIntervention: null,
        },
        {
          id: "run-newer",
          projectId: "p1",
          sprintId: "sprint-newer",
          sprintName: "Newer Sprint",
          sprintNumber: 2,
          status: "running",
          triggerType: "manual",
          triggeredBy: null,
          executorMode: "mixed",
          startedAt: "2024-01-01T11:00:00Z",
          finishedAt: null,
          lastHeartbeatAt: "2024-01-01T11:05:00Z",
          createdAt: "2024-01-01T11:00:00Z",
          activeLeaseOwnerKey: null,
          activeLeaseExpiresAt: null,
          humanIntervention: null,
        },
      ],
      taskDispatches: [
        {
          id: "dispatch-older",
          projectId: "p1",
          sprintId: "sprint-older",
          sprintRunId: "run-older",
          sprintName: "Older Sprint",
          sprintNumber: 1,
          taskId: "task-rec-1",
          taskKey: "T1",
          taskTitle: "Task 1",
          status: "completed",
          executorType: "jules",
          priority: 0,
          connectionId: null,
          connectionDisplayName: null,
          connectionRole: null,
          taskRunId: "task-run-older",
          taskRunState: "COMPLETED",
          provider: "gemini",
          sessionId: "session-older",
          sessionName: "session-older",
          workerBranch: "older-branch",
          prUrl: "https://pr.com/1",
          queuedAt: "2024-01-01T10:00:00Z",
          claimedAt: "2024-01-01T10:01:00Z",
          startedAt: "2024-01-01T10:02:00Z",
          finishedAt: "2024-01-01T10:30:00Z",
          lastHeartbeatAt: "2024-01-01T10:30:00Z",
          errorMessage: null,
          activeLeaseOwnerKey: null,
          activeLeaseExpiresAt: null,
        },
        {
          id: "dispatch-newer",
          projectId: "p1",
          sprintId: "sprint-newer",
          sprintRunId: "run-newer",
          sprintName: "Newer Sprint",
          sprintNumber: 2,
          taskId: "task-rec-2",
          taskKey: "T1", // Same task key, different sprint
          taskTitle: "Task 1 (New)",
          status: "running",
          executorType: "jules",
          priority: 0,
          connectionId: null,
          connectionDisplayName: null,
          connectionRole: null,
          taskRunId: "task-run-newer",
          taskRunState: "RUNNING",
          provider: "gemini",
          sessionId: "session-newer",
          sessionName: "session-newer",
          workerBranch: "newer-branch",
          prUrl: "https://pr.com/2",
          queuedAt: "2024-01-01T11:00:00Z",
          claimedAt: "2024-01-01T11:01:00Z",
          startedAt: "2024-01-01T11:02:00Z",
          finishedAt: null,
          lastHeartbeatAt: "2024-01-01T11:05:00Z",
          errorMessage: null,
          activeLeaseOwnerKey: null,
          activeLeaseExpiresAt: null,
        },
      ],
      connections: [],
      primaryAssignedWorker: null,
      overflowAssignedWorkers: [],
      attentionItems: [],
      recentEvents: [],
      updatedAt: "2024-01-01T11:05:00Z",
    };

    // We explicitly select the OLDER sprint
    vi.mocked(useDashboardRuntimeData).mockReturnValue({
      error: null,
      gitStatus: null,
      gitStatusError: null,
      initialLoadComplete: true,
      transportState: "connected",
      isRecovering: false,
      snapshotUpdatedAt: "2024-01-01T11:05:00Z",
      refreshGitStatus: vi.fn(),
      refreshRuntimeStatus: vi.fn(),
      selectedSprintId: "sprint-older", // Scope is the older sprint
      status: {
        project_id: "p1",
        sprint_id: "sprint-older",
        sprint_number: 1,
        timestamp: "2024-01-01T10:30:00Z",
        subtasks: [
          {
            record_id: "task-rec-1",
            id: "T1",
            title: "Task 1",
            prompt: "Older prompt",
            depends_on: [],
            is_independent: true,
            status: "COMPLETED",
          },
        ],
      },
      execution,
      stats: { total: 1, completed: 1, running: 0, failed: 0, not_started: 0, running_percent: 0, completed_percent: 100, failed_percent: 0 },
      tasksWithLiveActivities: [
        {
          record_id: "task-rec-1",
          id: "T1",
          title: "Task 1",
          prompt: "Older prompt",
          depends_on: [],
          is_independent: true,
          status: "COMPLETED",
        },
      ],
    });

    render(<LiveSessionPage />);

    // Since we are looking at the older sprint, the task T1 should be shown as COMPLETED.
    // Even though there is a newer sprint running a task with the same key T1.
    // Stats should show 1 completed, 0 running.
    expect(screen.getByText("Task 1")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.queryByText("Task 1 (New)")).not.toBeInTheDocument();
  });

  it("hides stale dispatch errors after a rerun starts and shows the latest PR metadata on the card", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue({
      error: null,
      gitStatus: null,
      gitStatusError: null,
      initialLoadComplete: true,
      transportState: "connected",
      isRecovering: false,
      snapshotUpdatedAt: "2024-01-01T11:05:00Z",
      refreshGitStatus: vi.fn(),
      refreshRuntimeStatus: vi.fn(),
      selectedSprintId: "sprint-1",
      status: {
        project_id: "p1",
        sprint_id: "sprint-1",
        sprint_number: 1,
        timestamp: "2024-01-01T11:05:00Z",
        subtasks: [
          {
            record_id: "task-rec-1",
            sprint_id: "sprint-1",
            project_id: "p1",
            id: "T1",
            title: "Restarted task",
            prompt: "Finish the restarted task",
            depends_on: [],
            is_independent: true,
            status: "RUNNING",
          },
        ],
      },
      execution: {
        ...mockExecution,
        sprintRuns: [{
          id: "run-1",
          projectId: "p1",
          sprintId: "sprint-1",
          sprintName: "Sprint 1",
          sprintNumber: 1,
          status: "running",
          triggerType: "manual",
          triggeredBy: null,
          executorMode: "mixed",
          startedAt: "2024-01-01T10:00:00Z",
          finishedAt: null,
          lastHeartbeatAt: "2024-01-01T11:05:00Z",
          createdAt: "2024-01-01T10:00:00Z",
          activeLeaseOwnerKey: null,
          activeLeaseExpiresAt: null,
          humanIntervention: null,
        }],
        taskDispatches: [
          {
            id: "dispatch-old",
            projectId: "p1",
            sprintId: "sprint-1",
            sprintRunId: "run-1",
            sprintName: "Sprint 1",
            sprintNumber: 1,
            taskId: "task-rec-1",
            taskKey: "T1",
            taskTitle: "Restarted task",
            status: "failed",
            executorType: "jules",
            priority: 0,
            connectionId: null,
            connectionDisplayName: null,
            connectionRole: null,
            taskRunId: "task-run-old",
            taskRunState: "FAILED",
            provider: "jules",
            sessionId: "session-old",
            sessionName: "session-old",
            workerBranch: null,
            prUrl: null,
            queuedAt: "2024-01-01T09:00:00Z",
            claimedAt: "2024-01-01T09:01:00Z",
            startedAt: "2024-01-01T09:02:00Z",
            finishedAt: "2024-01-01T09:03:00Z",
            lastHeartbeatAt: "2024-01-01T09:03:00Z",
            errorMessage: "Needs clarification before continuing",
            activeLeaseOwnerKey: null,
            activeLeaseExpiresAt: null,
          },
          {
            id: "dispatch-new",
            projectId: "p1",
            sprintId: "sprint-1",
            sprintRunId: "run-1",
            sprintName: "Sprint 1",
            sprintNumber: 1,
            taskId: "task-rec-1",
            taskKey: "T1",
            taskTitle: "Restarted task",
            status: "completed",
            executorType: "jules",
            priority: 0,
            connectionId: null,
            connectionDisplayName: null,
            connectionRole: null,
            taskRunId: "task-run-new",
            taskRunState: "COMPLETED",
            provider: "jules",
            sessionId: "session-new",
            sessionName: "session-new",
            workerBranch: "worker/t1",
            prUrl: "https://github.com/example/repo/pull/101",
            queuedAt: "2024-01-01T10:00:00Z",
            claimedAt: "2024-01-01T10:01:00Z",
            startedAt: "2024-01-01T10:02:00Z",
            finishedAt: "2024-01-01T10:20:00Z",
            lastHeartbeatAt: "2024-01-01T10:20:00Z",
            errorMessage: null,
            activeLeaseOwnerKey: null,
            activeLeaseExpiresAt: null,
          },
        ],
        recentEvents: [],
      },
      stats: { total: 1, completed: 0, running: 1, failed: 0, not_started: 0, running_percent: 100, completed_percent: 0, failed_percent: 0 },
      tasksWithLiveActivities: [
        {
          record_id: "task-rec-1",
          sprint_id: "sprint-1",
          project_id: "p1",
          id: "T1",
          title: "Restarted task",
          prompt: "Finish the restarted task",
          depends_on: [],
          is_independent: true,
          status: "RUNNING",
        },
      ],
    });

    render(<LiveSessionPage />);
    const card = screen.getByText("Restarted task").closest('[tabindex="0"]');

    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).queryByText("Needs clarification before continuing")).not.toBeInTheDocument();
    expect(within(card as HTMLElement).getByRole("link", { name: /PR/i })).toHaveAttribute("href", "https://github.com/example/repo/pull/101");
  });

  it("does not surface a previous failure banner once the latest dispatch is running", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue({
      error: null,
      gitStatus: null,
      gitStatusError: null,
      initialLoadComplete: true,
      transportState: "connected",
      isRecovering: false,
      snapshotUpdatedAt: "2024-01-01T11:05:00Z",
      refreshGitStatus: vi.fn(),
      refreshRuntimeStatus: vi.fn(),
      selectedSprintId: "sprint-1",
      status: {
        project_id: "p1",
        sprint_id: "sprint-1",
        sprint_number: 1,
        timestamp: "2024-01-01T11:05:00Z",
        subtasks: [
          {
            record_id: "task-rec-2",
            sprint_id: "sprint-1",
            project_id: "p1",
            id: "T2",
            title: "Running rerun",
            prompt: "Continue the rerun",
            depends_on: [],
            is_independent: true,
            status: "RUNNING",
          },
        ],
      },
      execution: {
        ...mockExecution,
        sprintRuns: [{
          id: "run-1",
          projectId: "p1",
          sprintId: "sprint-1",
          sprintName: "Sprint 1",
          sprintNumber: 1,
          status: "running",
          triggerType: "manual",
          triggeredBy: null,
          executorMode: "mixed",
          startedAt: "2024-01-01T10:00:00Z",
          finishedAt: null,
          lastHeartbeatAt: "2024-01-01T11:05:00Z",
          createdAt: "2024-01-01T10:00:00Z",
          activeLeaseOwnerKey: null,
          activeLeaseExpiresAt: null,
          humanIntervention: null,
        }],
        taskDispatches: [
          {
            id: "dispatch-old",
            projectId: "p1",
            sprintId: "sprint-1",
            sprintRunId: "run-1",
            sprintName: "Sprint 1",
            sprintNumber: 1,
            taskId: "task-rec-2",
            taskKey: "T2",
            taskTitle: "Running rerun",
            status: "failed",
            executorType: "jules",
            priority: 0,
            connectionId: null,
            connectionDisplayName: null,
            connectionRole: null,
            taskRunId: "task-run-old",
            taskRunState: "FAILED",
            provider: "jules",
            sessionId: "session-old",
            sessionName: "session-old",
            workerBranch: null,
            prUrl: null,
            queuedAt: "2024-01-01T09:00:00Z",
            claimedAt: "2024-01-01T09:01:00Z",
            startedAt: "2024-01-01T09:02:00Z",
            finishedAt: "2024-01-01T09:03:00Z",
            lastHeartbeatAt: "2024-01-01T09:03:00Z",
            errorMessage: "Restart failure should be hidden",
            activeLeaseOwnerKey: null,
            activeLeaseExpiresAt: null,
          },
          {
            id: "dispatch-new",
            projectId: "p1",
            sprintId: "sprint-1",
            sprintRunId: "run-1",
            sprintName: "Sprint 1",
            sprintNumber: 1,
            taskId: "task-rec-2",
            taskKey: "T2",
            taskTitle: "Running rerun",
            status: "running",
            executorType: "jules",
            priority: 0,
            connectionId: null,
            connectionDisplayName: null,
            connectionRole: null,
            taskRunId: "task-run-new",
            taskRunState: "RUNNING",
            provider: "jules",
            sessionId: "session-new",
            sessionName: "session-new",
            workerBranch: null,
            prUrl: null,
            queuedAt: "2024-01-01T10:00:00Z",
            claimedAt: "2024-01-01T10:01:00Z",
            startedAt: "2024-01-01T10:02:00Z",
            finishedAt: null,
            lastHeartbeatAt: "2024-01-01T10:05:00Z",
            errorMessage: null,
            activeLeaseOwnerKey: null,
            activeLeaseExpiresAt: null,
          },
        ],
        recentEvents: [],
      },
      stats: { total: 1, completed: 0, running: 1, failed: 0, not_started: 0, running_percent: 100, completed_percent: 0, failed_percent: 0 },
      tasksWithLiveActivities: [
        {
          record_id: "task-rec-2",
          sprint_id: "sprint-1",
          project_id: "p1",
          id: "T2",
          title: "Running rerun",
          prompt: "Continue the rerun",
          depends_on: [],
          is_independent: true,
          status: "RUNNING",
        },
      ],
    });

    render(<LiveSessionPage />);
    const card = screen.getByText("Running rerun").closest('[tabindex="0"]');

    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).queryByText("Restart failure should be hidden")).not.toBeInTheDocument();
  });

  it("renders the redesigned sidebar composition with active CI and stable card order", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue({
      error: null,
      gitStatus: {
        mode: "REMOTE",
        available: true,
        repositoryRoot: "/repo",
        branch: "feat/live-sidebar",
        hasRemote: true,
        dirty: false,
        tracking: {
          scope: "FEATURE_PR_CI",
          label: "Feature PR + CI",
          branch: "feat/live-sidebar",
        },
        warnings: [],
        lastUpdated: "2024-01-01T11:05:00Z",
        openPullRequests: [
          {
            number: 17,
            title: "Refine runtime sidebar",
            url: "https://github.com/example/repo/pull/17",
            state: "OPEN",
            isDraft: false,
            headRefName: "feat/live-sidebar",
            baseRefName: "main",
            mergeStateStatus: "QUEUED",
            reviewDecision: null,
            updatedAt: "2024-01-01T11:03:00Z",
            comments: 2,
            checks: [],
          },
        ],
        ciRuns: [
          {
            id: 101,
            name: "unit-and-integration",
            workflowName: "CI",
            status: "IN_PROGRESS",
            conclusion: null,
            event: "pull_request",
            headBranch: "feat/live-sidebar",
            url: "https://github.com/example/repo/actions/runs/101",
            updatedAt: "2024-01-01T11:04:00Z",
            failedJobs: [],
          },
        ],
        mergedPullRequests: [],
      },
      gitStatusError: null,
      initialLoadComplete: true,
      transportState: "connected",
      isRecovering: false,
      snapshotUpdatedAt: "2024-01-01T11:05:00Z",
      refreshGitStatus: vi.fn(),
      refreshRuntimeStatus: vi.fn(),
      selectedSprintId: "sprint-1",
      status: {
        project_id: "p1",
        sprint_id: "sprint-1",
        sprint_number: 1,
        timestamp: "2024-01-01T11:05:00Z",
        subtasks: [],
      },
      execution: {
        ...mockExecution,
        connections: [
          {
            id: "conn-1",
            role: "listener",
            status: "listening",
            listenMode: true,
            displayName: "Primary Listener",
            transport: "streamable_http",
            model: "gpt-5",
            connectionKey: "listener-1",
            lastHeartbeatAt: "2024-01-01T11:04:30Z",
            pendingInboxCount: 1,
            activeDispatchCount: 1,
            threadCount: 3,
            tasksRunCount: 4,
            labels: ["runtime"],
            instruction: "Handle live task orchestration updates.",
            machineName: "runner-a",
            platform: "linux",
            arch: "x64",
            localExecutionRuntime: "host",
          },
        ],
        attentionItems: [
          {
            id: "attn-1",
            projectId: "p1",
            sprintId: "sprint-1",
            taskId: "task-1",
            dispatchId: "dispatch-1",
            attentionType: "manual_attention",
            ownerType: "worker",
            status: "open",
            severity: "medium",
            title: "Review failing CI logs",
            summaryMarkdown: "The worker needs a human decision before continuing.",
            assignedWorkerEndpointId: null,
            createdAt: "2024-01-01T11:02:00Z",
            updatedAt: "2024-01-01T11:04:00Z",
            expiresAt: null,
          },
        ],
      },
      stats: { total: 0 } as any,
      tasksWithLiveActivities: [],
    } as any);

    render(<LiveSessionPage />);

    const liveConnections = screen.getAllByText("Live Connections").find((node) => node.closest("aside")) ?? null;
    const gitCiPr = screen.getByText("Git / CI / PR");
    const attentionQueue = screen.getByText("Attention Queue");
    const executionRuntime = screen.getByText("Execution Runtime");

    expect(liveConnections).not.toBeNull();
    expect(gitCiPr).toBeInTheDocument();
    expect(attentionQueue).toBeInTheDocument();
    expect(executionRuntime).toBeInTheDocument();
    expect(screen.getAllByText("Primary Listener").length).toBeGreaterThan(0);
    expect(screen.getByText("Review failing CI logs")).toBeInTheDocument();

    expect(screen.queryByText("Latest Activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Protocol")).not.toBeInTheDocument();

    expect(Boolean((liveConnections as HTMLElement).compareDocumentPosition(gitCiPr) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(gitCiPr.compareDocumentPosition(attentionQueue) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(attentionQueue.compareDocumentPosition(executionRuntime) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    const inProgressStatus = screen.getByText("IN_PROGRESS");
    expect(inProgressStatus).toBeInTheDocument();
    const ciRunCard = inProgressStatus.closest("a");
    expect(ciRunCard).not.toBeNull();
    expect(ciRunCard?.querySelector("svg.animate-spin")).toBeTruthy();
  });
});
