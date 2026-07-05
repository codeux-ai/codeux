/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

import { InvocationFeedPanel } from "../../../../../dashboard/src/v2/components/live-session/InvocationFeedPanel.js";
import { useExecutionTimeline } from "../../../../../dashboard/src/hooks/ExecutionTimelineContext.js";
import type { ExecutionDashboardSnapshot, ExecutionInvocationRecord } from "../../../../../dashboard/src/types.js";
import gsap from "gsap";

vi.mock("../../../../../dashboard/src/hooks/ExecutionTimelineContext.js", () => ({
  useExecutionTimeline: vi.fn(),
  LIVE_EXECUTION_SNAPSHOT_SURFACE: {
    kind: "live",
    label: "Live",
    description: "Runtime data is current.",
    isBusy: false,
  },
}));

vi.mock("../../../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: () => 0,
}));

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn(),
    to: vi.fn(),
    set: vi.fn(),
  },
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
    expect(screen.getByText("3 total")).toBeInTheDocument();
    expect(screen.getByText("1 live")).toBeInTheDocument();
    expect(screen.getByText("1 done")).toBeInTheDocument();
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Task Coding")).toBeInTheDocument();
    expect(screen.getByText("QA Review")).toBeInTheDocument();
    expect(screen.getByText("Provider timed out")).toBeInTheDocument();
    expect(screen.getByText("1 invocation failed. Open the transcript for details.")).toHaveAttribute("role", "alert");
    expect(screen.getAllByText("3 invocations shown: 0 new or queued, 1 running, 1 completed, 1 failed.").length).toBeGreaterThan(0);
    expect(screen.getByText("Invocation status: running.")).toBeInTheDocument();
    expect(document.querySelector(".motion-reduce\\:ring-2")).toBeInTheDocument();

    const feed = screen.getByRole("log", { name: "Live invocation feed" });
    expect(feed).toHaveAttribute("aria-live", "polite");
    expect(feed).toHaveAttribute("aria-busy", "true");

    expect(screen.getByRole("link", { name: "Open transcript for Task Coding invocation xi-live-" }))
      .toHaveAttribute("href", "/chat?mode=invocations&invocation=xi-live-1");
  });

  it("renders a polite loading state when execution has not arrived yet", () => {
    vi.mocked(useExecutionTimeline).mockReturnValue({
      execution: null,
    } as never);

    render(<InvocationFeedPanel />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading invocation feed.");
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("renders an empty feed state when the snapshot has no invocation records", () => {
    vi.mocked(useExecutionTimeline).mockReturnValue({
      execution: createSnapshot([]),
    } as never);

    render(<InvocationFeedPanel />);

    expect(screen.getByText("No invocation records yet.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
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
    expect(screen.getByRole("link", { name: "Open transcript for Task Coding invocation xi-scope" }))
      .toHaveAttribute("href", "/chat?mode=invocations&invocation=xi-scoped");
  });

  it("uses tokenized reduced-motion status highlights without GSAP animation", () => {
    vi.useFakeTimers();
    vi.mocked(useExecutionTimeline).mockReturnValue({
      execution: createSnapshot([]),
    } as never);

    const { rerender } = render(<InvocationFeedPanel invocations={[
      createInvocation({ id: "xi-changing", status: "running" }),
    ]} />);

    rerender(<InvocationFeedPanel invocations={[
      createInvocation({ id: "xi-changing", status: "completed", finishedAt: "2024-01-01T10:02:00.000Z" }),
    ]} />);

    expect(gsap.fromTo).not.toHaveBeenCalled();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(document.querySelector(".motion-reduce\\:ring-status-green\\/25")).toBeInTheDocument();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("exposes collapsible feed state and preserves focus in reduced motion", () => {
    vi.mocked(useExecutionTimeline).mockReturnValue({
      execution: createSnapshot([createInvocation({ status: "completed", finishedAt: "2024-01-01T10:02:00.000Z" })]),
    } as never);

    render(<InvocationFeedPanel collapsible defaultOpen={false} />);

    const toggle = screen.getByRole("button", { name: /Invocation Feed/i });
    const panelId = toggle.getAttribute("aria-controls");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId ?? "")).toHaveAttribute("aria-hidden", "true");
    expect(gsap.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ height: 0, overflow: "hidden" }));

    toggle.focus();
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByText("Invocation feed is current.")).toHaveAttribute("role", "status");
  });

  it("announces invocation row status changes without depending on animation", () => {
    vi.useFakeTimers();
    vi.mocked(useExecutionTimeline).mockReturnValue({
      execution: createSnapshot([]),
    } as never);

    const { rerender } = render(<InvocationFeedPanel invocations={[
      createInvocation({ id: "xi-status-change", status: "running" }),
    ]} />);

    rerender(<InvocationFeedPanel invocations={[
      createInvocation({ id: "xi-status-change", status: "failed", lastErrorMessage: "Provider returned a non-zero exit code" }),
    ]} />);

    expect(screen.getByText("Invocation status changed from running to failed.")).toBeInTheDocument();
    expect(screen.getByText("Provider returned a non-zero exit code")).toHaveAttribute("role", "alert");
    expect(gsap.fromTo).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });
});
