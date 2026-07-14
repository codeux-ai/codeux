/** @jsx h */
/**
 * @vitest-environment happy-dom
 */
import { h } from "preact";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/preact";
import { renderHook, act } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

import { OverviewTelemetry } from "../../../dashboard/src/v2/components/OverviewTelemetry.js";
import { useOverviewTelemetry } from "../../../dashboard/src/hooks/use-overview-telemetry.js";
import { useProjectData } from "../../../dashboard/src/v2/context/project-data.js";
import type { ExecutionAttentionItemSummary, OverviewTelemetrySnapshot } from "../../../dashboard/src/types.js";
import * as api from "../../../dashboard/src/lib/api/dashboard-api.js";
import * as realtime from "../../../dashboard/src/lib/realtime/dashboard-realtime-client.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/lib/api/dashboard-api.js");
vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");
vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    killTweensOf: vi.fn(),
    to: vi.fn(),
    set: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
  },
}));

vi.mock("../../../dashboard/src/hooks/use-overview-telemetry.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    useOverviewTelemetry: vi.fn(actual.useOverviewTelemetry),
  };
});

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
  useProjectData: vi.fn(),
  ProjectDataContext: { Provider: ({children}: any) => children, Consumer: ({children}: any) => children } as any
}));

const makeRuntimeData = (attentionItems: ExecutionAttentionItemSummary[] = []) => ({
  error: null,
  gitStatus: null,
  gitStatusError: null,
  initialLoadComplete: true,
  transportState: "connected",
  isRecovering: false,
  snapshotUpdatedAt: "2024-01-01T00:00:00Z",
  refreshGitStatus: vi.fn(),
  refreshRuntimeStatus: vi.fn(),
  selectedSprintId: "sprint-selected",
  status: { subtasks: [], timestamp: "2024-01-01T00:00:00Z", project_id: "p1", sprint_id: "sprint-selected" },
  execution: {
    projectId: "p1",
    projectName: "Selected Project",
    sprintRuns: [],
    taskDispatches: [],
    connections: [],
    primaryAssignedWorker: null,
    overflowAssignedWorkers: [],
    attentionItems,
    recentEvents: [],
    updatedAt: "2024-01-01T00:00:00Z",
  },
  stats: { total: 0 } as any,
  tasksWithLiveActivities: [],
});

const makeAttentionItem = (overrides: Partial<ExecutionAttentionItemSummary> = {}): ExecutionAttentionItemSummary => ({
  id: "attention-selected",
  sprintId: "sprint-selected",
  taskId: "task-selected",
  sprintRunId: "run-selected",
  dispatchId: "dispatch-selected",
  attentionType: "merge_conflict",
  severity: "high",
  ownerType: "worker",
  status: "open",
  assignedWorkerEndpointId: null,
  title: "Resolve selected sprint blocker",
  summaryMarkdown: "Selected sprint needs operator review.",
  payload: null,
  openedAt: "2024-01-01T00:00:00Z",
  claimedAt: null,
  resolvedAt: null,
  updatedAt: "2024-01-01T00:01:00Z",
  ...overrides,
});

describe("OverviewTelemetry Component", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(useProjectData).mockReturnValue({ selectedProjectId: null, selectedProject: null, loading: false } as any);
  });

  it("renders skeletons when loading", () => {
    vi.mocked(useOverviewTelemetry).mockReturnValue({
      telemetry: {
        activeProjects: [],
        attentionProjects: [],
        recentEvents: [],
        updatedAt: null,
      } as OverviewTelemetrySnapshot,
      loading: true,
      error: null,
      refresh: vi.fn(),
    });

    const { container } = render(<OverviewTelemetry />);
    expect(screen.getByText("Telemetry.")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading overview telemetry" })).toHaveAttribute("aria-busy", "true");
  });

  it("renders Awaiting Runtime state when empty", () => {
    vi.mocked(useOverviewTelemetry).mockReturnValue({
      telemetry: {
        activeProjects: [],
        attentionProjects: [],
        recentEvents: [],
        updatedAt: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<OverviewTelemetry />);
    expect(screen.getByText("Awaiting Runtime")).toBeInTheDocument();
    expect(screen.getByText("No active project telemetry yet")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Awaiting Runtime");
  });

  it("renders selected-project attention queue items from the scoped live snapshot", () => {
    vi.mocked(useProjectData).mockReturnValue({
      selectedProjectId: "p1",
      selectedProject: { id: "p1", name: "Selected Project" },
      loading: false,
    } as any);
    vi.mocked(useOverviewTelemetry).mockReturnValue({
      telemetry: {
        activeProjects: [],
        attentionProjects: [],
        recentEvents: [],
        updatedAt: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<OverviewTelemetry execution={makeRuntimeData([makeAttentionItem()]).execution} />);
    expect(screen.getByText("Selected Sprint Attention Queue")).toBeInTheDocument();
    expect(screen.getByText("Resolve selected sprint blocker")).toBeInTheDocument();
    expect(screen.getByText("Selected sprint needs operator review.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resolve attention item/i })).not.toBeInTheDocument();
  });

  it("does not render unrelated sprint blockers when the live snapshot is already scoped", () => {
    vi.mocked(useProjectData).mockReturnValue({
      selectedProjectId: "p1",
      selectedProject: { id: "p1", name: "Selected Project" },
      loading: false,
    } as any);
    vi.mocked(useOverviewTelemetry).mockReturnValue({
      telemetry: {
        activeProjects: [],
        attentionProjects: [
          {
            projectId: "p1",
            projectName: "Selected Project",
            sprintId: "sprint-unrelated",
            sprintName: "Unrelated Sprint",
            sprintNumber: 2,
            sprintRunId: "run-unrelated",
            sprintRunStatus: "paused",
            activeDispatchCount: 0,
            runningDispatchCount: 0,
            updatedAt: null,
            humanIntervention: {
              title: "Unrelated sprint blocker",
              reason: "Different sprint needs work.",
              instructions: "Do not show this in the selected queue.",
              attentionType: "manual_attention",
              severity: "medium",
              ownerType: "human",
            },
          },
        ],
        recentEvents: [],
        updatedAt: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<OverviewTelemetry execution={makeRuntimeData([
      makeAttentionItem({ title: "Scoped sprint blocker", summaryMarkdown: "Only selected sprint data is present." }),
    ]).execution} />);

    const selectedQueue = screen.getByRole("list", { name: "Selected sprint attention items" });
    expect(within(selectedQueue).getByText("Scoped sprint blocker")).toBeInTheDocument();
    expect(within(selectedQueue).queryByText("Unrelated sprint blocker")).not.toBeInTheDocument();
    expect(screen.getByText("Human Intervention Needed")).toBeInTheDocument();
    expect(screen.getByText("Unrelated sprint blocker")).toBeInTheDocument();
  });

  it("renders compact intervention cards", () => {
    vi.mocked(useOverviewTelemetry).mockReturnValue({
      telemetry: {
        activeProjects: [],
        attentionProjects: [
          {
            projectId: "p1",
            projectName: "Blocker Project",
            sprintId: "s1",
            sprintName: "Sprint One",
            sprintNumber: 1,
            sprintRunId: "run1",
            sprintRunStatus: "paused",
            activeDispatchCount: 0,
            runningDispatchCount: 0,
            updatedAt: null,
            humanIntervention: {
              title: "Merge Request",
              reason: "This reason should not be shown.",
              instructions: "These instructions should not be shown.",
              attentionType: "merge",
              severity: "high",
              ownerType: "worker",
            },
          },
        ],
        recentEvents: [],
        updatedAt: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<OverviewTelemetry />);
    expect(screen.getByText("Human Intervention Needed")).toBeInTheDocument();
    expect(screen.getByText("Blocker Project")).toBeInTheDocument();
    expect(screen.getByText("Merge Request")).toBeInTheDocument();
    expect(screen.queryByText("This reason should not be shown.")).not.toBeInTheDocument();
    expect(screen.queryByText("These instructions should not be shown.")).not.toBeInTheDocument();
    expect(screen.queryByText("What to do")).not.toBeInTheDocument();
  });

  it("renders runtime timeline events with correct mapped styles and project lookup", () => {
    vi.mocked(useOverviewTelemetry).mockReturnValue({
      telemetry: {
        activeProjects: [
          {
            projectId: "p1",
            projectName: "Fast Project",
            sprintId: "s1",
            sprintName: "Sprint One",
            sprintNumber: null,
            sprintRunId: "run1",
            sprintRunStatus: "running",
            activeDispatchCount: 1,
            runningDispatchCount: 1,
            updatedAt: null,
            humanIntervention: null,
          },
        ],
        attentionProjects: [],
        recentEvents: [
          {
            id: "e1",
            scopeType: "task_run",
            taskRunId: "tr1",
            sprintRunId: "sr1",
            dispatchId: "d1",
            projectId: "p1",
            sprintId: "s1",
            sprintName: "Sprint One",
            sprintNumber: null,
            sprintRunStatus: "running",
            taskId: "t1",
            taskKey: "T-01",
            taskTitle: "Do work",
            taskRunState: "completed",
            eventType: "run_completed",
            originator: "worker",
            sourceEventKey: null,
            provider: null,
            sessionId: null,
            sessionName: null,
            createdAt: "2023-10-27T10:00:00Z",
            payload: null,
          },
          {
            id: "e2",
            scopeType: "task_run",
            taskRunId: "tr2",
            sprintRunId: "sr2",
            dispatchId: "d2",
            projectId: "p2",
            sprintId: "s2",
            sprintName: "Sprint Two",
            sprintNumber: null,
            sprintRunStatus: "failed",
            taskId: "t2",
            taskKey: "T-02",
            taskTitle: "Fail work",
            taskRunState: "failed",
            eventType: "dispatch_failed",
            originator: "worker",
            sourceEventKey: null,
            provider: null,
            sessionId: null,
            sessionName: null,
            createdAt: "2023-10-27T10:05:00Z",
            payload: null,
          },
        ],
        updatedAt: null,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });

    render(<OverviewTelemetry />);

    // Fast Project lookup maps "p1" correctly
    expect(screen.getAllByText("Fast Project").length).toBeGreaterThan(0);
    // Project lookup fails gracefully to "Project" for unknown "p2"
    expect(screen.getAllByText("Project").length).toBeGreaterThan(0);

    // Event style maps and formatted label
    expect(screen.getByText("run completed")).toHaveClass("text-status-green");
    expect(screen.getByText("dispatch failed")).toHaveClass("text-status-red");
    expect(screen.getByRole("log", { name: "Overview runtime timeline" })).toHaveAttribute("aria-live", "polite");
  });
});

describe("useOverviewTelemetry Hook", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("handles websocket event updates directly", async () => {
    let realtimeCallback: (message: any) => void;

    vi.mocked(realtime.subscribeToDashboardRealtime).mockImplementation((scopes, rc, tc) => {
      realtimeCallback = rc;
      return () => {};
    });

    const mockPayload: OverviewTelemetrySnapshot = {
      activeProjects: [],
      attentionProjects: [],
      recentEvents: [],
      updatedAt: "initial",
    };

    vi.mocked(api.fetchOverviewTelemetry).mockResolvedValue(mockPayload);

    // Reset the mocked implementation to use actual for testing the hook behavior directly
    vi.mocked(useOverviewTelemetry).mockRestore();

    const { result } = renderHook(() => useOverviewTelemetry());

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.telemetry.updatedAt).toBe(null);

    // Send a direct websocket event with identical semantics but different timestamp
    act(() => {
      realtimeCallback({
        type: "event",
        event: {
          eventType: "overview.telemetry.updated",
          payload: { ...mockPayload, updatedAt: "websocket-update" },
        },
      });
    });

    // Should not update since semantic data is identical
    expect(result.current.telemetry.updatedAt).toBe(null);
  });
});
