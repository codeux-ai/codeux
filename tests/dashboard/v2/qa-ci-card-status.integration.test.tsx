/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import type { ComponentChildren, VNode } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "../render-with-i18n.js";

import type {
  ExecutionAttentionItemSummary,
  ExecutionRuntimeEventSummary,
  ExecutionTaskDispatchSummary,
  SprintReviewSummary,
  Subtask,
} from "../../../src/contracts/app-types.js";
import { LiveTaskCard } from "../../../dashboard/src/v2/components/LiveTaskCard.js";
import { SprintCell } from "../../../dashboard/src/v2/components/sprints/SprintCell.js";
import { SprintLedgerRow } from "../../../dashboard/src/v2/components/sprints/SprintLedgerRow.js";
import { KanbanTaskCard } from "../../../dashboard/src/v2/components/tasks/KanbanTaskCard.js";
import {
  deriveLiveSessionTaskCardItems,
  type LiveSessionTaskCardItem,
} from "../../../dashboard/src/v2/lib/live-session-view-model.js";
import type { CiStatusPresentation } from "../../../dashboard/src/v2/lib/ci-status-presentation.js";
import {
  buildTaskBoardViewModel,
  type TaskBoardViewModel,
} from "../../../dashboard/src/v2/lib/tasks/task-board-view-model.js";
import type { TaskCardViewModel } from "../../../dashboard/src/v2/lib/tasks/task-card-view-model.js";
import {
  areCiStatusPresentationsEqual,
  buildCiStatusBySprintId,
} from "../../../dashboard/src/v2/pages/sprints/sprints-page-view-models.js";
import type { Sprint, Task } from "../../../dashboard/src/v2/types.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ComponentChildren }) => <a href="#card-target">{children}</a>,
}));

vi.mock("gsap", () => {
  const gsap = {
    context: vi.fn((callback?: () => void) => {
      callback?.();
      return { revert: vi.fn() };
    }),
    fromTo: vi.fn((_target: unknown, _from: unknown, to?: { onComplete?: () => void }) => {
      to?.onComplete?.();
    }),
    killTweensOf: vi.fn(),
    set: vi.fn(),
    timeline: vi.fn(() => ({ fromTo: vi.fn().mockReturnThis() })),
    to: vi.fn((_target: unknown, options?: { onComplete?: () => void }) => {
      options?.onComplete?.();
    }),
  };
  return { default: gsap, gsap };
});
vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
  useResolvedMotionDuration: <T,>(duration: T): T => duration,
}));

const PROJECT_ID = "project-fixture";
const SPRINT_ID = "sprint-fixture";
const SPRINT_RUN_ID = "sprint-run-fixture";
const TASK_RECORD_ID = "task-record-fixture";
const TASK_KEY = "T-100";

const QA_REVIEW: SprintReviewSummary = {
  status: "completed",
  outcome: "changes_requested",
  summary: "Keyboard dismissal and recovery messaging need another pass.",
  findings: [
    "The details trigger must restore focus after dismissal.",
    "Recovered checks must replace the earlier failure.",
  ],
  fixInstructions: "Restore focus on Escape and render only the newest matching CI evidence.",
  targetTaskKey: TASK_KEY,
  followUpTasks: [{
    title: "Cover reconnect replay",
    description: "Prove an unchanged execution snapshot preserves the accessible card state.",
    dependsOnTaskKeys: [TASK_KEY],
    priority: "high",
    promptMarkdown: "Add deterministic keyboard coverage for reconnect replay.\nVerify focus restoration and stale-failure removal on every dashboard card.",
  }],
  reviewer: "QA Worker",
  finishedAt: "2026-07-13T10:05:00.000Z",
};

const TASK: Task = {
  recordId: TASK_RECORD_ID,
  id: TASK_KEY,
  source: "local sprint",
  sprint: "Accessible delivery",
  sprintId: SPRINT_ID,
  title: "Unify card status semantics",
  status: "in_progress",
  priority: "high",
  executorType: "docker_cli",
  assignee: "Worker",
  time: "4m",
  createdAt: "2026-07-13T09:00:00.000Z",
  updatedAt: "2026-07-13T10:05:00.000Z",
  promptMarkdown: "Keep QA and CI outcomes equivalent across dashboard cards.",
  description: "Shared card status integration fixture.",
  dependsOnTaskIds: [],
  isIndependent: true,
  isMerged: false,
  latestReview: QA_REVIEW,
  mergeIndicator: "CI",
};

const SUBTASK: Subtask = {
  record_id: TASK_RECORD_ID,
  project_id: PROJECT_ID,
  sprint_id: SPRINT_ID,
  id: TASK_KEY,
  title: TASK.title,
  prompt: TASK.promptMarkdown,
  depends_on: [],
  status: "RUNNING",
  session_id: "session-fixture",
  provider: "codex",
  worker_branch: "feature/card-status",
  pr_url: "https://example.test/pull/100",
  is_independent: true,
  is_merged: false,
  merge_indicator: "CI",
  latestReview: QA_REVIEW,
};

const SPRINT: Sprint = {
  id: SPRINT_ID,
  projectId: PROJECT_ID,
  number: 7,
  slug: "accessible-delivery",
  name: "Accessible delivery",
  isGeneratedName: false,
  originalPrompt: "Verify shared dashboard status semantics.",
  goal: "Keep QA and CI outcomes equivalent across dashboard cards.",
  status: "running",
  showcasePinned: false,
  startDate: "2026-07-13T09:00:00.000Z",
  endDate: null,
  featureBranch: "feature/card-status",
  baseCommitSha: null,
  kind: "standard",
  rollbackSourceSprintId: null,
  rollbackMode: null,
  rollbackInstructions: null,
  rollbackSafetyReason: null,
  tasksCount: 1,
  completion: 75,
  linkedIssues: [],
  latestReview: QA_REVIEW,
  createdAt: "2026-07-13T09:00:00.000Z",
  updatedAt: "2026-07-13T10:05:00.000Z",
  date: "Jul 13",
};

const DISPATCH: ExecutionTaskDispatchSummary = {
  id: "dispatch-fixture",
  projectId: PROJECT_ID,
  sprintId: SPRINT_ID,
  sprintRunId: SPRINT_RUN_ID,
  sprintName: SPRINT.name,
  sprintNumber: SPRINT.number,
  taskId: TASK_RECORD_ID,
  taskKey: TASK_KEY,
  taskTitle: TASK.title,
  status: "running",
  executorType: "docker_cli",
  priority: 1,
  connectionId: null,
  connectionDisplayName: null,
  connectionRole: null,
  taskRunId: "task-run-fixture",
  taskRunState: "running",
  provider: "codex",
  sessionId: "session-fixture",
  sessionName: null,
  workerBranch: "feature/card-status",
  prUrl: "https://example.test/pull/100",
  queuedAt: "2026-07-13T09:30:00.000Z",
  claimedAt: "2026-07-13T09:31:00.000Z",
  startedAt: "2026-07-13T09:32:00.000Z",
  finishedAt: null,
  lastHeartbeatAt: "2026-07-13T10:05:00.000Z",
  errorMessage: null,
  activeLeaseOwnerKey: null,
  activeLeaseExpiresAt: null,
};

function ciEvent(
  id: string,
  createdAt: string,
  payload: Record<string, unknown>,
  overrides: Partial<ExecutionRuntimeEventSummary> = {},
): ExecutionRuntimeEventSummary {
  return {
    id,
    scopeType: "task_run",
    taskRunId: DISPATCH.taskRunId,
    sprintRunId: SPRINT_RUN_ID,
    dispatchId: DISPATCH.id,
    projectId: PROJECT_ID,
    sprintId: SPRINT_ID,
    sprintName: SPRINT.name,
    sprintNumber: SPRINT.number,
    sprintRunStatus: "running",
    taskId: TASK_RECORD_ID,
    taskKey: TASK_KEY,
    taskTitle: TASK.title,
    taskRunState: "running",
    eventType: "ci_gate_status",
    originator: "runtime",
    sourceEventKey: null,
    provider: "codex",
    sessionId: "session-fixture",
    sessionName: null,
    workerBranch: "feature/card-status",
    prUrl: "https://example.test/pull/100",
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    createdAt,
    payload,
    ...overrides,
  };
}

const CI_HISTORY = [
  ciEvent("ci-awaiting-pr", "2026-07-13T10:00:00.000Z", { state: "waiting_for_pr" }, { prUrl: null }),
  ciEvent("ci-pr-created", "2026-07-13T10:01:00.000Z", { state: "waiting_checks", prNumber: 100 }),
  ciEvent("ci-checks-running", "2026-07-13T10:02:00.000Z", { state: "waiting_checks", prNumber: 100, hasPendingChecks: true }),
  ciEvent("ci-checks-failed", "2026-07-13T10:03:00.000Z", { state: "waiting_checks", prNumber: 100, hasFailedChecks: true }),
];

const CI_RECOVERY = ciEvent(
  "ci-checks-recovered",
  "2026-07-13T10:04:00.000Z",
  { state: "ready_for_merge", prNumber: 100, hasFailedChecks: false, hasPendingChecks: false },
);

function ciAttention(overrides: Partial<ExecutionAttentionItemSummary> = {}): ExecutionAttentionItemSummary {
  return {
    id: "attention-ci-fixture",
    sprintId: SPRINT_ID,
    taskId: TASK_RECORD_ID,
    sprintRunId: SPRINT_RUN_ID,
    dispatchId: DISPATCH.id,
    attentionType: "ci_fix_required",
    severity: "high",
    ownerType: "worker",
    status: "open",
    assignedWorkerEndpointId: null,
    title: "CI fix required",
    summaryMarkdown: "The latest matching checks need attention.",
    payload: {
      projectId: PROJECT_ID,
      taskKey: TASK_KEY,
      prNumber: 100,
      prUrl: "https://example.test/pull/100",
    },
    openedAt: "2026-07-13T10:04:30.000Z",
    claimedAt: null,
    resolvedAt: null,
    updatedAt: "2026-07-13T10:04:30.000Z",
    ...overrides,
  };
}

function humanAttention(overrides: Partial<ExecutionAttentionItemSummary> = {}): ExecutionAttentionItemSummary {
  return ciAttention({
    id: "attention-human-fixture",
    attentionType: "human_escalation_required",
    ownerType: "human",
    title: "Operator decision required",
    summaryMarkdown: "Choose the safe recovery path.",
    payload: { projectId: PROJECT_ID, taskKey: TASK_KEY },
    ...overrides,
  });
}

interface SurfaceData {
  taskBoard: TaskBoardViewModel;
  taskViewModel: TaskCardViewModel;
  liveItem: LiveSessionTaskCardItem;
  sprintCiStatus: CiStatusPresentation;
}

function buildSurfaceData(
  events: ExecutionRuntimeEventSummary[],
  attentionItems: ExecutionAttentionItemSummary[] = [],
  previousTaskViewModels?: ReadonlyMap<string, TaskCardViewModel>,
): SurfaceData {
  const taskBoard = buildTaskBoardViewModel({
    tasks: [TASK],
    optimisticTasks: [],
    statusFilter: "all",
    priorityFilter: "all",
    listWindow: "all",
    taskScopeSprintId: SPRINT_ID,
    projectId: PROJECT_ID,
    taskDispatches: [DISPATCH],
    attentionItems,
    recentEvents: events,
    subtasks: [SUBTASK],
    previousTaskViewModels,
  });
  const taskViewModel = taskBoard.taskViewModels.get(TASK_RECORD_ID);
  const liveItem = deriveLiveSessionTaskCardItems({
    filteredTasks: [SUBTASK],
    dispatches: [DISPATCH],
    events,
    invocations: [],
    attentionItems,
    taskTimingMap: new Map(),
    rerunningIds: new Set(),
    forceCompletePendingIds: new Set(),
    forceCompleteErrorByTaskId: new Map(),
    optimisticallyCompletedTaskIds: new Set(),
  })[0];
  const sprintCiStatus = buildCiStatusBySprintId(
    [SPRINT],
    [DISPATCH],
    events,
    attentionItems,
  ).get(SPRINT_ID);

  if (!taskViewModel || !liveItem || !sprintCiStatus) {
    throw new Error("The shared fixture did not produce every card presentation.");
  }

  return { taskBoard, taskViewModel, liveItem, sprintCiStatus };
}

const noOp = (): void => {};

function TaskSurface({ data }: { data: SurfaceData }): VNode {
  return (
    <section aria-label="Task card surface">
      <KanbanTaskCard viewModel={data.taskViewModel} onEdit={noOp} onDelete={noOp} />
    </section>
  );
}

function LiveSurface({ data }: { data: SurfaceData }): VNode {
  return (
    <section aria-label="Live card surface">
      <LiveTaskCard
        {...data.liveItem}
        allTasks={[SUBTASK]}
        onRerun={noOp}
        onEdit={noOp}
        onForceComplete={noOp}
      />
    </section>
  );
}

function GallerySurface({ data }: { data: SurfaceData }): VNode {
  return (
    <section aria-label="Sprint gallery card surface">
      <SprintCell
        sprint={SPRINT}
        isEven={false}
        accentColor="text-signal-600 dark:text-signal-300"
        ciStatus={data.sprintCiStatus}
      />
    </section>
  );
}

function LedgerSurface({ data }: { data: SurfaceData }): VNode {
  return (
    <section aria-label="Sprint ledger card surface">
      <table>
        <tbody>
          <SprintLedgerRow
            sprint={SPRINT}
            isSelected={false}
            isEven={false}
            activeRun={undefined}
            pauseResumeRun={undefined}
            humanIntervention={null}
            ciStatus={data.sprintCiStatus}
            pendingActionIds={new Set()}
            onToggleRow={noOp}
            onToggleShowcase={noOp}
            onSprintToggle={noOp}
            onSprintPauseResume={noOp}
            onEdit={noOp}
            onExport={noOp}
            onOverrides={noOp}
            onMarkCompleted={noOp}
            onDelete={noOp}
          />
        </tbody>
      </table>
    </section>
  );
}

const SURFACES = [
  ["Task", "Task card surface", TaskSurface],
  ["Live", "Live card surface", LiveSurface],
  ["Sprint gallery", "Sprint gallery card surface", GallerySurface],
  ["Sprint ledger", "Sprint ledger card surface", LedgerSurface],
] as const;

const TASK_SURFACES = SURFACES.slice(0, 2);
const SPRINT_SURFACES = SURFACES.slice(2);

function AllSurfaces({ data }: { data: SurfaceData }): VNode {
  return (
    <>
      <TaskSurface data={data} />
      <LiveSurface data={data} />
      <GallerySurface data={data} />
      <LedgerSurface data={data} />
    </>
  );
}

async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement): Promise<void> {
  for (let index = 0; index < 24 && document.activeElement !== target; index += 1) {
    await user.tab();
  }
  expect(target).toHaveFocus();
}

describe("shared QA and CI card status integration", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    globalThis.ResizeObserver = class ResizeObserverMock {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps task gate detail on task cards and a stable Coding state on running sprint cards", async () => {
    const user = userEvent.setup();
    const data = buildSurfaceData(CI_HISTORY);
    const { container } = renderWithI18n(<AllSurfaces data={data} />);

    for (const [, surfaceLabel] of TASK_SURFACES) {
      const surface = screen.getByRole("region", { name: surfaceLabel });
      const qaTrigger = within(surface).getByRole("button", { name: "QA review details" });
      expect(qaTrigger).toHaveAccessibleDescription(/QA changes requested/i);
      expect(surface.querySelector('[data-qa-state="changes_requested"]')).toBeInTheDocument();
      expect(surface.querySelector('[data-qa-icon="changes_requested"]')).toHaveClass("text-blue-500");

      const ciTrigger = within(surface).getByRole("button", {
        name: /CI status: CI failed.*Pull request ready.*Checks failed.*Blocked by checks.*Show workflow details/i,
      });
      expect(ciTrigger).toHaveTextContent("QA edits");
      expect(ciTrigger).toHaveClass("text-blue-700");
      expect(surface.querySelector('[data-ci-icon="failure"]')).toHaveClass("text-status-red");

      await user.click(ciTrigger);
      const workflow = screen.getByRole("region", { name: "CI workflow details" });
      expect(workflow.querySelector('[data-ci-step="pull_request"]')).toHaveAttribute("data-ci-step-state", "successful");
      expect(workflow.querySelector('[data-ci-step="checks"]')).toHaveAttribute("data-ci-step-state", "failed");
      expect(workflow.querySelector('[data-ci-step="merge"]')).toHaveAttribute("data-ci-step-state", "pending");
      expect(within(workflow).getByText("Checks failed")).toBeVisible();
      await user.keyboard("{Escape}");
    }

    for (const [, surfaceLabel] of SPRINT_SURFACES) {
      const surface = screen.getByRole("region", { name: surfaceLabel });
      const qaTrigger = within(surface).getByRole("button", { name: "QA review details" });
      expect(qaTrigger).toHaveAccessibleDescription(/QA changes requested/i);
      expect(qaTrigger).toHaveClass("text-blue-700");

      const workflowTrigger = within(surface).getByRole("button", {
        name: /Workflow status: Coding in progress.*Show workflow details/i,
      });
      expect(workflowTrigger).toHaveTextContent("Coding in progress");
      expect(surface.querySelector('[data-ci-icon="failure"]')).not.toBeInTheDocument();

      await user.click(workflowTrigger);
      const workflow = screen.getByRole("region", { name: "Workflow details" });
      expect(workflow.querySelector('[data-ci-step="pull_request"]')).toHaveAttribute("data-ci-step-state", "pending");
      expect(workflow.querySelector('[data-ci-step="checks"]')).toHaveAttribute("data-ci-step-state", "pending");
      expect(workflow.querySelector('[data-ci-step="merge"]')).toHaveAttribute("data-ci-step-state", "pending");
      await user.keyboard("{Escape}");
    }

    expect(within(screen.getByRole("region", { name: "Task card surface" })).getByText("QA edits")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Live card surface" })).getByText("QA edits")).toBeVisible();
    expect(container.querySelectorAll('[data-ci-icon="failure"]')).toHaveLength(2);
  });

  it.each(SURFACES)("opens and fully operates the %s QA details without pointer input", async (_name, surfaceLabel, Surface) => {
    const user = userEvent.setup();
    const data = buildSurfaceData(CI_HISTORY);
    renderWithI18n(<Surface data={data} />);

    const surface = screen.getByRole("region", { name: surfaceLabel });
    const trigger = within(surface).getByRole("button", { name: "QA review details" });
    await tabTo(user, trigger);
    await user.keyboard("{Enter}");

    const details = await screen.findByRole("region", { name: "QA Changes Requested" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(details).getByText(QA_REVIEW.summary as string)).toBeVisible();
    expect(within(details).getByText(QA_REVIEW.findings[0])).toBeVisible();
    expect(within(details).getByText(QA_REVIEW.fixInstructions as string)).toBeVisible();
    expect(within(details).getByText(TASK_KEY)).toBeVisible();

    const followUp = within(details).getByRole("button", { name: "Follow-up task 1" });
    expect(followUp).toHaveAttribute("aria-expanded", "false");
    expect(within(details).queryByText("Cover reconnect replay")).not.toBeInTheDocument();
    expect(within(details).queryByText(/Add deterministic keyboard coverage/)).not.toBeInTheDocument();

    details.focus();
    await user.tab();
    expect(followUp).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(followUp).toHaveAttribute("aria-expanded", "true");
    expect(within(details).getByText("Cover reconnect replay")).toBeVisible();
    expect(within(details).getByText(QA_REVIEW.followUpTasks?.[0].description as string)).toBeVisible();
    expect(within(details).getByText("high")).toBeVisible();
    expect(within(details).getAllByText(TASK_KEY)).toHaveLength(2);
    expect(within(details).getByText(/Add deterministic keyboard coverage/)).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "QA Changes Requested" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("removes stale failures, restores active matching attention, and isolates unrelated evidence", () => {
    const unrelatedFailure = ciEvent(
      "ci-unrelated-sprint-failure",
      "2026-07-13T10:06:00.000Z",
      { state: "waiting_checks", prNumber: 200, hasFailedChecks: true },
      {
        projectId: "project-unrelated",
        sprintId: "sprint-unrelated",
        sprintRunId: "sprint-run-unrelated",
        taskRunId: "task-run-unrelated",
        dispatchId: "dispatch-unrelated",
        taskId: "task-record-unrelated",
        taskKey: "T-200",
      },
    );
    const unrelatedAttention = ciAttention({
      id: "attention-unrelated",
      sprintId: "sprint-unrelated",
      sprintRunId: "sprint-run-unrelated",
      taskId: "task-record-unrelated",
      payload: { projectId: "project-unrelated", taskKey: "T-200", prNumber: 200 },
    });
    const recovered = buildSurfaceData(
      [...CI_HISTORY, CI_RECOVERY, unrelatedFailure],
      [unrelatedAttention],
    );

    expect(recovered.taskViewModel.ciStatusPresentation).toMatchObject({ state: "pending", label: "CI pending" });
    expect(recovered.liveItem.ciPresentation).toMatchObject({ state: "pending", label: "CI pending" });
    expect(recovered.sprintCiStatus).toMatchObject({ state: "pending", label: "CI pending" });
    expect(recovered.sprintCiStatus.steps[1]).toMatchObject({ state: "successful", statusLabel: "Checks passed" });

    const matchingAttention = buildSurfaceData(
      [...CI_HISTORY, CI_RECOVERY, unrelatedFailure],
      [unrelatedAttention, ciAttention()],
    );
    expect(matchingAttention.taskViewModel.ciStatusPresentation).toMatchObject({ state: "failed", label: "CI failed" });
    expect(matchingAttention.liveItem.ciPresentation).toMatchObject({ state: "failed", label: "CI failed" });
    expect(matchingAttention.sprintCiStatus).toMatchObject({ state: "failed", label: "CI failed" });

    const siblingTaskFailure = ciEvent(
      "ci-sibling-task-failure",
      "2026-07-13T10:07:00.000Z",
      { state: "waiting_checks", prNumber: 101, hasFailedChecks: true },
      {
        taskRunId: "task-run-sibling",
        dispatchId: "dispatch-sibling",
        taskId: "task-record-sibling",
        taskKey: "T-101",
      },
    );
    const taskScoped = buildSurfaceData([...CI_HISTORY, CI_RECOVERY, siblingTaskFailure]);
    expect(taskScoped.taskViewModel.ciStatusPresentation?.label).toBe("CI pending");
    expect(taskScoped.liveItem.ciPresentation?.label).toBe("CI pending");

    const { rerender } = render(<AllSurfaces data={recovered} />);
    for (const [, surfaceLabel] of TASK_SURFACES) {
      const surface = screen.getByRole("region", { name: surfaceLabel });
      expect(within(surface).getByRole("button", { name: /CI status: CI pending/i })).toBeVisible();
      expect(within(surface).queryByText("CI failed")).not.toBeInTheDocument();
      expect(surface.querySelector('[data-ci-icon="failure"]')).not.toBeInTheDocument();
    }
    for (const [, surfaceLabel] of SPRINT_SURFACES) {
      const surface = screen.getByRole("region", { name: surfaceLabel });
      expect(within(surface).getByRole("button", { name: /Workflow status: Coding in progress/i })).toBeVisible();
      expect(surface.querySelector('[data-ci-icon="failure"]')).not.toBeInTheDocument();
    }

    rerender(<AllSurfaces data={matchingAttention} />);
    for (const [, surfaceLabel] of TASK_SURFACES) {
      const surface = screen.getByRole("region", { name: surfaceLabel });
      expect(within(surface).getByRole("button", { name: /CI status: CI failed/i })).toBeVisible();
      expect(surface.querySelector('[data-ci-icon="failure"]')).toHaveClass("text-status-red");
    }
    for (const [, surfaceLabel] of SPRINT_SURFACES) {
      const surface = screen.getByRole("region", { name: surfaceLabel });
      expect(within(surface).getByRole("button", { name: /Workflow status: Coding in progress/i })).toBeVisible();
      expect(surface.querySelector('[data-ci-icon="failure"]')).not.toBeInTheDocument();
    }
  });

  it("projects active human-only attention into both task and Live workflow badges", () => {
    const data = buildSurfaceData(CI_HISTORY, [humanAttention()]);
    expect(data.taskViewModel.humanIntervention?.id).toBe("attention-human-fixture");
    expect(data.liveItem.humanIntervention?.id).toBe("attention-human-fixture");

    render(<><TaskSurface data={data} /><LiveSurface data={data} /></>);
    for (const [, surfaceLabel] of TASK_SURFACES) {
      const surface = screen.getByRole("region", { name: surfaceLabel });
      const trigger = within(surface).getByRole("button", { name: /CI status: Human needed/i });
      expect(trigger).toHaveTextContent("Human needed");
      expect(trigger).toHaveClass("text-status-red");
    }
  });

  it("preserves workflow disclosure and focus when an unchanged execution snapshot is replayed", async () => {
    const user = userEvent.setup();
    const first = buildSurfaceData(CI_HISTORY);
    const replay = buildSurfaceData(CI_HISTORY, [], first.taskBoard.taskViewModels);

    expect(replay.taskViewModel).toBe(first.taskViewModel);
    expect(replay.liveItem.ciPresentation).toEqual(first.liveItem.ciPresentation);
    expect(areCiStatusPresentationsEqual(replay.sprintCiStatus, first.sprintCiStatus)).toBe(true);

    const view = renderWithI18n(<AllSurfaces data={first} />);
    const taskSurface = screen.getByRole("region", { name: "Task card surface" });
    const ciTrigger = within(taskSurface).getByRole("button", { name: /CI status: CI failed/i });
    ciTrigger.focus();
    await user.keyboard("{Enter}");
    expect(ciTrigger).toHaveFocus();
    expect(screen.getByRole("region", { name: "CI workflow details" })).toBeVisible();

    view.rerender(<AllSurfaces data={replay} />);
    expect(ciTrigger).toHaveFocus();
    expect(ciTrigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "CI workflow details" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "CI workflow details" })).not.toBeInTheDocument();
    expect(ciTrigger).toHaveFocus();
  });
});
