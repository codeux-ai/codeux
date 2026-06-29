/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

import { InvocationFeedPanel } from "../../../../../dashboard/src/v2/components/live-session/InvocationFeedPanel.js";
import { useExecutionTimeline } from "../../../../../dashboard/src/hooks/ExecutionTimelineContext.js";
import type { ExecutionDashboardSnapshot, ExecutionInvocationRecord } from "../../../../../dashboard/src/types.js";

vi.mock("../../../../../dashboard/src/hooks/ExecutionTimelineContext.js", () => ({
  useExecutionTimeline: vi.fn(),
}));

const createInvocation = (overrides: Partial<ExecutionInvocationRecord> = {}): ExecutionInvocationRecord => ({
  id: "xi-live-1",
  projectId: "project-1",
  sprintId: "sprint-1",
  taskId: "task-1",
  sprintRunId: "sprint-run-1",
  dispatchId: "dispatch-1",
  taskRunId: "task-run-1",
  attentionItemId: null,
  providerInvocationId: "provider-invocation-1",
  type: "cli_task_coding",
  status: "running",
  provider: "codex",
  model: "gpt-5",
  systemPrompt: null,
  startedAt: "2024-01-01T10:00:00.000Z",
  finishedAt: null,
  errorMessage: null,
  lastErrorCategory: null,
  lastErrorMessage: null,
  lastRetryAfterIso: null,
  messageCount: 4,
  lastMessageAt: "2024-01-01T10:01:00.000Z",
  invocationSource: "internal",
  agentPresetId: null,
  inputTokens: 100,
  cachedInputTokens: 0,
  outputTokens: 50,
  totalTokens: 150,
  sprintNumber: 7,
  sprintName: "Live Sprint",
  sprintSlug: "live-sprint",
  taskKey: "T-1",
  taskTitle: "Build live invocation feed",
  createdAt: "2024-01-01T10:00:00.000Z",
  updatedAt: "2024-01-01T10:01:00.000Z",
  ...overrides,
});

const createSnapshot = (recentInvocations: ExecutionInvocationRecord[]): ExecutionDashboardSnapshot => ({
  projectId: "project-1",
  projectName: "Project 1",
  sprintRuns: [],
  taskDispatches: [],
  connections: [],
  primaryAssignedWorker: null,
  overflowAssignedWorkers: [],
  attentionItems: [],
  recentEvents: [],
  recentInvocations,
  updatedAt: "2024-01-01T10:01:00.000Z",
});

describe("InvocationFeedPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("renders live invocation counts and transcript links from the execution snapshot", () => {
    vi.mocked(useExecutionTimeline).mockReturnValue({
      execution: createSnapshot([
        createInvocation(),
        createInvocation({
          id: "xi-live-2",
          status: "failed",
          type: "qa_review",
          lastErrorMessage: "Provider timed out",
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
        }),
        createInvocation({
          id: "xi-live-3",
          status: "completed",
          type: "planning",
          finishedAt: "2024-01-01T10:02:00.000Z",
        }),
      ]),
    } as never);

    render(<InvocationFeedPanel />);

    expect(screen.getByText("Invocation Feed")).toBeInTheDocument();
    expect(screen.getByText("1 live")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Task Coding")).toBeInTheDocument();
    expect(screen.getByText("QA Review")).toBeInTheDocument();
    expect(screen.getByText("Provider timed out")).toBeInTheDocument();

    const feed = screen.getByRole("log", { name: "Live invocation feed" });
    expect(feed).toHaveAttribute("aria-live", "polite");

    expect(screen.getByRole("link", { name: "Open transcript for Task Coding" }))
      .toHaveAttribute("href", "/chat?mode=invocations&invocation=xi-live-1");
  });

  it("renders an empty feed state when the snapshot has no invocation records", () => {
    vi.mocked(useExecutionTimeline).mockReturnValue({
      execution: createSnapshot([]),
    } as never);

    render(<InvocationFeedPanel />);

    expect(screen.getByText("No invocation records yet.")).toBeInTheDocument();
  });

  it("renders explicitly scoped invocations instead of the full snapshot list", () => {
    vi.mocked(useExecutionTimeline).mockReturnValue({
      execution: createSnapshot([
        createInvocation({ id: "xi-raw", provider: "raw-provider" }),
      ]),
    } as never);

    render(<InvocationFeedPanel invocations={[
      createInvocation({ id: "xi-scoped", provider: "scoped-provider" }),
    ]} />);

    expect(screen.getByText("scoped-provider")).toBeInTheDocument();
    expect(screen.queryByText("raw-provider")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open transcript for Task Coding" }))
      .toHaveAttribute("href", "/chat?mode=invocations&invocation=xi-scoped");
  });
});
