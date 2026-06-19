/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

import { ExecutionTimelineProvider } from "../../../dashboard/src/hooks/ExecutionTimelineContext.js";
import { ExecutionTimeline } from "../../../dashboard/src/v2/components/ExecutionTimeline.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
    registerPlugin: vi.fn(),
  },
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (d) => d,
  useReducedMotion: () => false,
}));

const baseExecution = {
  projectId: "project-1",
  projectName: "Project One",
  taskDispatches: [],
  connections: [],
  primaryAssignedWorker: null,
  overflowAssignedWorkers: [],
  attentionItems: [],
  updatedAt: "2024-01-01T00:00:00Z",
};

const activeRun = {
  id: "run-active",
  projectId: "project-1",
  sprintId: "sprint-1",
  sprintName: "Sprint One",
  sprintNumber: 1,
  status: "running",
  triggerType: "manual",
  triggeredBy: null,
  executorMode: "mixed",
  startedAt: "2024-01-01T00:00:00Z",
  finishedAt: null,
  lastHeartbeatAt: "2024-01-01T00:05:00Z",
  createdAt: "2024-01-01T00:00:00Z",
  activeLeaseOwnerKey: null,
  activeLeaseExpiresAt: null,
  humanIntervention: null,
};

describe("ExecutionTimeline", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders as a standalone runtime timeline card and derives active runs internally", () => {
    const execution = {
      ...baseExecution,
      sprintRuns: [activeRun],
      recentEvents: [
        {
          id: "event-1",
          scopeType: "sprint_run",
          taskRunId: null,
          sprintRunId: "run-active",
          dispatchId: null,
          projectId: "project-1",
          sprintId: "sprint-1",
          sprintName: "Sprint One",
          sprintNumber: 1,
          sprintRunStatus: "running",
          taskId: null,
          taskKey: null,
          taskTitle: null,
          taskRunState: null,
          eventType: "run_completed",
          originator: "system",
          sourceEventKey: null,
          provider: null,
          sessionId: null,
          sessionName: null,
          createdAt: "2024-01-01T00:05:00Z",
          payload: null,
        },
      ],
    };

    render(
      <ExecutionTimelineProvider execution={execution as any}>
        <ExecutionTimeline />
      </ExecutionTimelineProvider>
    );

    expect(screen.getByText("Runtime Timeline")).toBeInTheDocument();
    expect(screen.getByText("run completed")).toBeInTheDocument();
    expect(screen.queryByText("No task run events recorded yet.")).not.toBeInTheDocument();
  });

  it("keeps the timeline empty when there are no active sprint runs", () => {
    const execution = {
      ...baseExecution,
      sprintRuns: [
        {
          ...activeRun,
          status: "completed",
        },
      ],
      recentEvents: [
        {
          id: "event-1",
          scopeType: "sprint_run",
          taskRunId: null,
          sprintRunId: "run-active",
          dispatchId: null,
          projectId: "project-1",
          sprintId: "sprint-1",
          sprintName: "Sprint One",
          sprintNumber: 1,
          sprintRunStatus: "completed",
          taskId: null,
          taskKey: null,
          taskTitle: null,
          taskRunState: null,
          eventType: "run_completed",
          originator: "system",
          sourceEventKey: null,
          provider: null,
          sessionId: null,
          sessionName: null,
          createdAt: "2024-01-01T00:05:00Z",
          payload: null,
        },
      ],
    };

    render(
      <ExecutionTimelineProvider execution={execution as any}>
        <ExecutionTimeline />
      </ExecutionTimelineProvider>
    );

    expect(screen.getByText("Runtime Timeline")).toBeInTheDocument();
    expect(screen.getByText("No runtime events yet")).toBeInTheDocument();
    expect(screen.queryByText("run completed")).not.toBeInTheDocument();
  });
});
