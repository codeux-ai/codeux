/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { LiveTaskCard, QuotaCountdown, TaskDuration } from "../../../../../dashboard/src/v2/components/LiveTaskCard";
import { LiveTaskInvocationRow } from "../../../../../dashboard/src/v2/components/live-session/LiveTaskInvocationRow.js";
import type { ExecutionInvocationRecord, Subtask } from "../../../../../dashboard/src/types.js";
import type { TaskSelfReflectionRating } from "../../../../../src/contracts/task-self-reflection-types.js";
import type { CiStatusPresentation } from "../../../../../dashboard/src/v2/lib/ci-status-presentation.js";

// Mock resize observer and match media
window.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("../../../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (d) => d,
  useReducedMotion: vi.fn(() => false),
}));

// Mock GSAP context to ensure animations fire safely
vi.mock("gsap", () => ({
  default: {
    context: vi.fn((cb) => {
      cb();
      return { revert: vi.fn() };
    }),
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
  },
}));

describe("LiveTaskCard", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const getMockTask = (status: Subtask["status"]): Subtask => ({
    id: "test-task",
    title: "Test Task",
    project_id: "p1",
    sprint_id: "s1",
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    prompt: "Test prompt",
    depends_on: [],
    is_independent: true,
  });

  const getMockSelfReflectionRating = (): TaskSelfReflectionRating => ({
    id: "rating-1",
    projectId: "p1",
    sprintId: "s1",
    taskId: "test-task",
    sourceTaskRunId: "task-run-1",
    overallRating: 5,
    sections: [
      {
        label: "Completeness",
        normalizedLabel: "completeness",
        rating: 5,
        note: "All acceptance criteria covered.",
      },
      {
        label: "Testing",
        normalizedLabel: "testing",
        rating: 4.5,
        note: null,
      },
    ],
    capturedAt: "2026-07-07T00:00:00.000Z",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  });

  const getMockInvocation = (overrides: Partial<ExecutionInvocationRecord> = {}): ExecutionInvocationRecord => ({
    id: "xi-task-1",
    projectId: "p1",
    sprintId: "s1",
    taskId: "test-task",
    sprintRunId: "sr1",
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
    messageCount: 3,
    lastMessageAt: "2024-01-01T10:01:00.000Z",
    invocationSource: "internal",
    agentPresetId: null,
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 40,
    totalTokens: 140,
    sprintNumber: 1,
    sprintName: "Sprint 1",
    sprintSlug: "sprint-1",
    taskKey: "test-task",
    taskTitle: "Test Task",
    createdAt: "2024-01-01T10:00:00.000Z",
    updatedAt: "2024-01-01T10:01:00.000Z",
    ...overrides,
  });

  const getMockCiPresentation = (state: CiStatusPresentation["state"] = "failed"): CiStatusPresentation => ({
    scope: "task",
    state,
    label: state === "failed" ? "CI failed" : state === "in_progress" ? "CI running" : state === "successful" ? "CI passed" : "CI pending",
    accessibleLabel: "CI failed. Pull request: Pull request ready. Checks: Checks failed. Merge: Blocked by checks.",
    steps: [
      { id: "pull_request", label: "Pull request", state: "successful", statusLabel: "Pull request ready" },
      { id: "checks", label: "Checks", state, statusLabel: state === "failed" ? "Checks failed" : "Checks running", ...(state === "failed" ? { failureKind: "ci_checks" as const } : {}) },
      { id: "merge", label: "Merge", state: "pending", statusLabel: "Blocked by checks" },
    ],
    ...(state === "failed" ? { failureKind: "ci_checks" as const } : {}),
  });

  it("renders running state properly", () => {
    const task = getMockTask("RUNNING");
    const { container } = render(<LiveTaskCard task={task} allTasks={[task]} onRerun={vi.fn()} onEdit={vi.fn()} onForceComplete={vi.fn()} isRerunning={false} />);
    expect(container).toBeTruthy();
  });

  it("renders completed state properly", () => {
    const task = getMockTask("COMPLETED");
    const { container } = render(<LiveTaskCard task={task} allTasks={[task]} onRerun={vi.fn()} onEdit={vi.fn()} onForceComplete={vi.fn()} isRerunning={false} />);
    expect(container).toBeTruthy();
  });

  it("renders shared CI progression on a running card without a duplicate merge badge", () => {
    const task = { ...getMockTask("RUNNING"), merge_indicator: "CI" as const };
    const { container } = render(
      <LiveTaskCard
        task={task}
        allTasks={[task]}
        phase="RUNNING"
        ciPresentation={getMockCiPresentation("failed")}
        onRerun={vi.fn()}
        onEdit={vi.fn()}
        onForceComplete={vi.fn()}
        isRerunning={false}
      />,
    );

    expect(screen.getByRole("group", { name: "Status indicators for task test-task" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /CI status: CI failed/i })).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(container.querySelectorAll('[data-ci-state="failed"]')).toHaveLength(1);
    expect(screen.queryByText("CI")).toBeNull();
  });

  it("shows the QUOTA badge instead of Running when the live phase is QUOTA", () => {
    // The subtask record stays RUNNING/in_progress while on hold; the live phase from the
    // dispatch drives the badge so the user sees the quota wait clearly.
    const task = getMockTask("RUNNING");
    const { container } = render(
      <LiveTaskCard
        task={task}
        allTasks={[task]}
        phase="QUOTA"
        onRerun={vi.fn()}
        onEdit={vi.fn()}
        onForceComplete={vi.fn()}
        isRerunning={false}
      />,
    );
    const scoped = within(container);
    expect(scoped.getByText("Quota")).toBeTruthy();
    expect(scoped.queryByText("Running")).toBeNull();
  });

  it("renders a quota countdown timer from the dispatch retry-after tag", () => {
    const task = getMockTask("RUNNING");
    const resetIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { container } = render(
      <LiveTaskCard
        task={task}
        allTasks={[task]}
        phase="QUOTA"
        onRerun={vi.fn()}
        onEdit={vi.fn()}
        onForceComplete={vi.fn()}
        isRerunning={false}
        dispatchInfo={{
          errorMessage: `Antigravity quota exhausted. Resets in 2h0m0s. [ERROR_CATEGORY:QUOTA_EXHAUSTED] [RETRY_AFTER:${resetIso}]`,
          startedAt: null,
          finishedAt: null,
          status: "quota",
        }}
      />,
    );
    expect(within(container).getByText(/resets in/i)).toBeTruthy();
  });

  it("keeps quota countdown export compatible and falls back to the raw error without retry metadata", () => {
    render(<QuotaCountdown errorMessage="Provider quota exhausted without retry metadata." />);
    expect(screen.getByText("Provider quota exhausted without retry metadata.")).toBeTruthy();
  });

  it("ticks the live task duration while the timing display is visible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-21T10:00:05.000Z"));

    const { container } = render(
      <TaskDuration
        dispatchTiming={{
          startedAt: "2026-03-21T10:00:00.000Z",
          finishedAt: null,
          status: "running",
        }}
      />,
    );

    expect(screen.getByText("5s")).toBeTruthy();

    act(() => {
      vi.setSystemTime(new Date("2026-03-21T10:00:06.000Z"));
      vi.advanceTimersByTime(1000);
    });

    expect(container.textContent).not.toBe("5s");
    expect(container.textContent).toMatch(/^[6-9]s$/);
  });

  it("renders a task QA review indicator while QA is running", () => {
    const task = {
      ...getMockTask("CODING_COMPLETED"),
      latestReview: {
        status: "running",
        outcome: null,
        summary: null,
        findings: [],
        reviewer: "QA Bot",
        finishedAt: null,
      },
    };
    render(<LiveTaskCard task={task} allTasks={[task]} onRerun={vi.fn()} onEdit={vi.fn()} onForceComplete={vi.fn()} isRerunning={false} />);
    expect(screen.getByLabelText("QA review running")).toBeTruthy();
    expect(screen.getByText("QA")).toBeTruthy();
  });

  it("keeps complete requested-change guidance available on an active task card", async () => {
    const task = {
      ...getMockTask("RUNNING"),
      latestReview: {
        status: "completed",
        outcome: "changes_requested",
        summary: "One follow-up remains.",
        findings: ["Cover reconnect replay"],
        fixInstructions: "Preserve the persisted review projection.",
        targetTaskKey: "test-task",
        followUpTasks: [{
          title: "Add reconnect coverage",
          description: "Replay the unchanged snapshot.",
          priority: "high" as const,
          dependsOnTaskKeys: ["test-task"],
          promptMarkdown: "Add deterministic reconnect coverage.",
        }],
        reviewer: "QA Bot",
        finishedAt: "2026-07-13T10:00:00.000Z",
      },
    };

    render(<LiveTaskCard task={task} allTasks={[task]} onRerun={vi.fn()} onEdit={vi.fn()} onForceComplete={vi.fn()} isRerunning={false} />);

    fireEvent.click(screen.getByRole("button", { name: "QA review details" }));
    expect(await screen.findByText("Preserve the persisted review projection.")).toBeTruthy();
    const followUp = screen.getByRole("button", { name: "Follow-up task 1" });
    expect(followUp.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(followUp);
    expect(screen.getByText("Add reconnect coverage")).toBeTruthy();
    expect(screen.getByText("Add deterministic reconnect coverage.")).toBeTruthy();
  });

  it.each([
    "COMPLETED",
    "CODING_COMPLETED",
    "QA_REVIEW_FAILED",
  ] satisfies Array<NonNullable<Subtask["status"]>>)("%s cards render self-reflection rating details for rated live tasks", async (status) => {
    const task = {
      ...getMockTask(status),
      selfReflectionRating: getMockSelfReflectionRating(),
    };

    render(<LiveTaskCard task={task} allTasks={[task]} onRerun={vi.fn()} onEdit={vi.fn()} onForceComplete={vi.fn()} isRerunning={false} />);

    const trigger = screen.getByLabelText("Self-reflection rating 5 out of 5");
    expect(trigger.textContent).toContain("5/5");

    fireEvent.focus(trigger);

    const overlay = await screen.findByRole("tooltip");
    expect(within(overlay).getByText("Self-reflection rating")).toBeTruthy();
    expect(within(overlay).getByText("Completeness")).toBeTruthy();
    expect(within(overlay).getByText("Testing")).toBeTruthy();
    expect(within(overlay).getByText("All acceptance criteria covered.")).toBeTruthy();
  });

  it("shows a task-scoped invocation feed with transcript links", () => {
    const task = getMockTask("RUNNING");
    const { container } = render(
      <LiveTaskCard
        task={task}
        allTasks={[task]}
        invocations={[getMockInvocation()]}
        onRerun={vi.fn()}
        onEdit={vi.fn()}
        onForceComplete={vi.fn()}
        isRerunning={false}
      />,
    );
    const scoped = within(container);

    const toggle = scoped.getByRole("button", { name: "Show invocation feed for task test-task" });
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);

    expect(scoped.getByRole("log", { name: "Invocation feed for task test-task" })).toBeTruthy();
    expect(scoped.getByText("Task Invocations")).toBeTruthy();
    expect(scoped.getByText("Task Coding")).toBeTruthy();
    expect(scoped.getByRole("link", { name: "Open transcript for Task Coding invocation xi-task-" }).getAttribute("href"))
      .toBe("/chat?mode=invocations&invocation=xi-task-1");
  });

  it("suppresses force-complete activation while pending and exposes task-specific feedback", () => {
    const task = getMockTask("RUNNING");
    const onForceComplete = vi.fn();

    render(
      <LiveTaskCard
        task={task}
        allTasks={[task]}
        onRerun={vi.fn()}
        onEdit={vi.fn()}
        onForceComplete={onForceComplete}
        isRerunning={false}
        isForceCompleting
      />,
    );

    const forceCompleteButton = screen.getByRole("button", { name: /Force complete task test-task/i });
    fireEvent.click(forceCompleteButton);

    expect(forceCompleteButton.getAttribute("aria-disabled")).toBe("true");
    expect(forceCompleteButton.getAttribute("aria-busy")).toBe("true");
    expect(forceCompleteButton.textContent).toContain("Force completing");
    expect(screen.getAllByText(/Marking this task complete/).length).toBeGreaterThan(0);
    expect(onForceComplete).not.toHaveBeenCalled();
  });

  it("renders invocation row labels, fallback metadata, and encoded transcript links", () => {
    render(
      <LiveTaskInvocationRow
        invocation={getMockInvocation({
          id: "xi task/with space",
          type: "qa_review",
          status: "failed",
          provider: null,
          model: null,
          totalTokens: undefined,
          inputTokens: 4,
          outputTokens: 8,
          lastErrorMessage: "Provider returned an error",
        })}
      />,
    );

    expect(screen.getByText("QA Review")).toBeTruthy();
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByText("provider pending")).toBeTruthy();
    expect(screen.getByText("model pending")).toBeTruthy();
    expect(screen.getByText("12 tok")).toBeTruthy();
    expect(screen.getByText("Provider returned an error")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open transcript for QA Review invocation xi task/" }).getAttribute("href"))
      .toBe("/chat?mode=invocations&invocation=xi%20task%2Fwith%20space");
  });
});
