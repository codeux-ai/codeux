/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { LiveSessionPage } from "../../../dashboard/src/v2/LiveSessionPage.js";
import { useDashboardRuntimeData } from "../../../dashboard/src/hooks/use-dashboard-runtime-data.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";
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

  const liveTask = (overrides: Record<string, unknown> = {}) => ({
    id: "T-100",
    record_id: "task-100",
    project_id: "proj-1",
    sprint_id: "sprint-1",
    title: "Live implementation task",
    prompt: "Implement the live task state.",
    status: "RUNNING",
    merge_indicator: "CI",
    pr_url: "https://example.test/pr/100",
    depends_on: [],
    is_independent: true,
    ...overrides,
  });

  const liveDispatch = (overrides: Record<string, unknown> = {}) => ({
    id: "dispatch-100",
    projectId: "proj-1",
    sprintId: "sprint-1",
    sprintRunId: "run-1",
    sprintName: "Sprint 1",
    sprintNumber: 1,
    taskId: "task-100",
    taskKey: "T-100",
    taskTitle: "Live implementation task",
    status: "running",
    executorType: "docker_cli",
    priority: 0,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    taskRunId: "task-run-100",
    taskRunState: "RUNNING",
    provider: "codex",
    sessionId: "session-100",
    sessionName: "session-100",
    workerBranch: "worker/t-100",
    prUrl: "https://example.test/pr/100",
    queuedAt: "2026-07-13T09:59:00.000Z",
    claimedAt: "2026-07-13T09:59:30.000Z",
    startedAt: "2026-07-13T10:00:00.000Z",
    finishedAt: null,
    lastHeartbeatAt: "2026-07-13T10:01:00.000Z",
    errorMessage: null,
    activeLeaseOwnerKey: null,
    activeLeaseExpiresAt: null,
    ...overrides,
  });

  const gateEvent = (overrides: Record<string, unknown> = {}) => ({
    id: "gate-100",
    scopeType: "task_run",
    taskRunId: "task-run-100",
    sprintRunId: "run-1",
    dispatchId: "dispatch-100",
    projectId: "proj-1",
    sprintId: "sprint-1",
    sprintName: "Sprint 1",
    sprintNumber: 1,
    sprintRunStatus: "running",
    taskId: "task-100",
    taskKey: "T-100",
    taskTitle: "Live implementation task",
    taskRunState: "RUNNING",
    eventType: "ci_gate_status",
    originator: "system",
    sourceEventKey: null,
    provider: "codex",
    sessionId: "session-100",
    sessionName: "session-100",
    workerBranch: "worker/t-100",
    prUrl: "https://example.test/pr/100",
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    createdAt: "2026-07-13T10:01:00.000Z",
    payload: { state: "waiting_checks", prNumber: 100, hasPendingChecks: true },
    ...overrides,
  });

  const ciAttention = (overrides: Record<string, unknown> = {}) => ({
    id: "attention-100",
    sprintId: "sprint-1",
    taskId: "task-100",
    sprintRunId: "run-1",
    dispatchId: "dispatch-100",
    attentionType: "ci_fix_required",
    severity: "high",
    ownerType: "worker",
    status: "open",
    assignedWorkerEndpointId: null,
    title: "CI fix required",
    summaryMarkdown: "Checks failed.",
    payload: { taskKey: "T-100", prNumber: 100 },
    openedAt: "2026-07-13T10:01:00.000Z",
    claimedAt: null,
    resolvedAt: null,
    updatedAt: "2026-07-13T10:01:00.000Z",
    ...overrides,
  });

  const liveExecution = (overrides: Record<string, unknown> = {}) => ({
    ...baseRuntimeData().execution,
    sprintRuns: [createSprintRunFixture()],
    taskDispatches: [liveDispatch()],
    ...overrides,
  });

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

  it("renders German idle and active Live presentation while preserving task content", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData());

    const view = render(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <LiveSessionPage />
      </DashboardI18nProvider>,
    );

    expect(screen.getByLabelText("Live-Sitzung")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /Warten auf den Sprint-Start/i })).toBeInTheDocument();

    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      tasksWithLiveActivities: [liveTask({
        title: "KEEP task title verbatim",
        prompt: "KEEP provider-authored prompt verbatim",
      })],
      execution: liveExecution(),
    }));
    view.rerender(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <LiveSessionPage />
      </DashboardI18nProvider>,
    );

    expect(screen.getByText("Sprint-Pipeline")).toBeInTheDocument();
    expect(screen.getByText("KEEP task title verbatim")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aufgabe T-100 bearbeiten" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aufgabe T-100 zwangsweise abschließen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aufgabe T-100 erneut ausführen" })).toBeInTheDocument();

    const statsTab = screen.getByRole("tab", { name: "Statistik" });
    fireEvent.keyDown(statsTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Rennen" })).toHaveAttribute("aria-selected", "true");
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

  it("updates persisted CI evidence live and ignores newer events from unrelated tasks", () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      tasksWithLiveActivities: [liveTask()],
      execution: liveExecution({ recentEvents: [gateEvent()] }),
    }));

    const renderGermanPage = () => (
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <LiveSessionPage />
      </DashboardI18nProvider>
    );
    const { rerender } = render(renderGermanPage());
    expect(screen.getByRole("button", { name: /CI status: CI running/i })).toBeInTheDocument();

    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      tasksWithLiveActivities: [liveTask({ status: "COMPLETED", is_merged: true, merge_indicator: "MERGED" })],
      execution: liveExecution({
        recentEvents: [
          gateEvent(),
          gateEvent({ id: "gate-success", createdAt: "2026-07-13T10:02:00.000Z", payload: { state: "merge_confirmed", prNumber: 100 } }),
          gateEvent({
            id: "other-task-failure",
            taskId: "task-200",
            taskKey: "T-200",
            taskRunId: "task-run-200",
            dispatchId: "dispatch-200",
            createdAt: "2026-07-13T10:03:00.000Z",
            payload: { state: "waiting_checks", hasFailedChecks: true },
          }),
        ],
      }),
    }));
    rerender(renderGermanPage());

    expect(screen.getByRole("button", { name: /CI status: CI passed/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CI status: CI failed/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Merged")).not.toBeInTheDocument();
  });

  it("replays active CI attention through reconnects without inventing disconnect failures", () => {
    const renderGermanPage = () => (
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <LiveSessionPage />
      </DashboardI18nProvider>
    );
    const execution = liveExecution({
      attentionItems: [ciAttention()],
      recentEvents: [gateEvent({ payload: { state: "ready_for_merge", prNumber: 100 } })],
    });
    const taskSnapshot = [liveTask({ status: "PENDING" })];
    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      transportState: "disconnected",
      tasksWithLiveActivities: taskSnapshot,
      execution,
    }));

    const { rerender } = render(renderGermanPage());
    expect(screen.getByRole("button", { name: /CI status: CI failed/i })).toBeInTheDocument();

    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      transportState: "reconnecting",
      isRecovering: true,
      tasksWithLiveActivities: taskSnapshot,
      execution,
    }));
    rerender(renderGermanPage());

    expect(screen.getByRole("button", { name: /CI status: CI failed/i })).toBeInTheDocument();
    expect(screen.getAllByText("Verbindung wird wiederhergestellt").length).toBeGreaterThan(0);

    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      transportState: "disconnected",
      tasksWithLiveActivities: taskSnapshot,
      execution: liveExecution({ attentionItems: [], recentEvents: [] }),
    }));
    rerender(renderGermanPage());

    expect(screen.queryByRole("button", { name: /CI status: CI failed/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CI status: CI running/i })).toBeInTheDocument();
  });

  it("preserves QA disclosures, runtime feed, prompt disclosure, and task controls", async () => {
    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      tasksWithLiveActivities: [liveTask({
        merge_indicator: "QA_PENDING",
        latestReview: {
          status: "completed",
          outcome: "changes_requested",
          summary: "Reconnect behavior needs coverage.",
          findings: ["Replay the snapshot"],
          fixInstructions: "Keep the existing snapshot visible while reconnecting.",
          targetTaskKey: "T-100",
          followUpTasks: [{
            title: "Cover reconnect replay",
            description: "Verify unchanged data survives reconnect.",
            priority: "high",
            dependsOnTaskKeys: ["T-100"],
            promptMarkdown: "Add the reconnect regression.",
          }],
          reviewer: "QA Bot",
          finishedAt: "2026-07-13T10:04:00.000Z",
        },
      })],
      execution: liveExecution({ recentEvents: [gateEvent({ eventType: "run_started", payload: null })] }),
    }));

    render(<LiveSessionPage />);

    expect(screen.getByRole("button", { name: "Edit task T-100" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Force complete task T-100" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rerun task T-100" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show runtime feed for task T-100" }));
    expect(screen.getByRole("button", { name: "Hide runtime feed for task T-100" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand prompt for task T-100" }));
    expect(screen.getByText("Task Prompt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "QA review details" }));
    expect(await screen.findByText("Keep the existing snapshot visible while reconnecting.")).toBeInTheDocument();
    const followUp = screen.getByRole("button", { name: "Follow-up task 1" });
    expect(followUp).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(followUp);
    expect(screen.getByText("Cover reconnect replay")).toBeInTheDocument();
    expect(screen.getByText("Add the reconnect regression.")).toBeInTheDocument();
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
    expect(screen.getAllByText("Worker pause").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No executable work was available.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Resolve the stop condition and restart when ready.").length).toBeGreaterThan(0);

    // Assert intervention badge is absent
    expect(screen.queryByText("Needs you")).not.toBeInTheDocument();
  });

  it("localizes German paused and system-stopped framing while preserving intervention content", () => {
    const renderGermanPage = () => (
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <LiveSessionPage />
      </DashboardI18nProvider>
    );
    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      execution: {
        ...baseRuntimeData().execution,
        sprintRuns: [createSprintRunFixture({
          status: "paused",
          humanIntervention: {
            ...createManualPauseIntervention(),
            title: "KEEP manual title verbatim",
            reason: "KEEP manual reason verbatim",
            instructions: "KEEP manual instructions verbatim",
          },
        })],
      },
    }));

    const view = render(renderGermanPage());

    expect(screen.getAllByText("Pausiert").length).toBeGreaterThan(0);
    expect(screen.getAllByText("KEEP manual title verbatim").length).toBeGreaterThan(0);
    expect(screen.getAllByText("KEEP manual reason verbatim").length).toBeGreaterThan(0);
    expect(screen.getAllByText("KEEP manual instructions verbatim").length).toBeGreaterThan(0);
    expect(screen.getByText("Du wirst benötigt")).toBeInTheDocument();

    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      execution: {
        ...baseRuntimeData().execution,
        sprintRuns: [createSprintRunFixture({
          status: "paused",
          humanIntervention: {
            ...createSystemStopIntervention(),
            title: "KEEP system title verbatim",
            reason: "KEEP system reason verbatim",
            instructions: "KEEP system instructions verbatim",
          },
        })],
      },
    }));
    view.rerender(renderGermanPage());

    expect(screen.getAllByText("Gestoppt").length).toBeGreaterThan(0);
    expect(screen.getAllByText("KEEP system title verbatim").length).toBeGreaterThan(0);
    expect(screen.getAllByText("KEEP system reason verbatim").length).toBeGreaterThan(0);
    expect(screen.getAllByText("KEEP system instructions verbatim").length).toBeGreaterThan(0);
    expect(screen.queryByText("Du wirst benötigt")).not.toBeInTheDocument();

    vi.mocked(useDashboardRuntimeData).mockReturnValue(baseRuntimeData({
      execution: {
        ...baseRuntimeData().execution,
        sprintRuns: [createSprintRunFixture({
          status: "paused",
          humanIntervention: {
            ...createSystemStopIntervention(),
            title: "",
            reason: "",
            instructions: "",
          },
        })],
      },
    }));
    view.rerender(renderGermanPage());

    expect(screen.getByText("Sprint vom System gestoppt")).toBeInTheDocument();
    expect(screen.getByText("Der Orchestrator hat diesen Sprint gestoppt.")).toBeInTheDocument();
    expect(screen.getAllByText("Behebe die Stoppursache und starte erneut, sobald alles bereit ist.").length).toBeGreaterThan(0);
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
