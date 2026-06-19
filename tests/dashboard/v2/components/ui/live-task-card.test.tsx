/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/preact";
import { LiveTaskCard } from "../../../../../dashboard/src/v2/components/LiveTaskCard";
import type { Subtask } from "../../../../../dashboard/src/types.js";

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
    vi.clearAllMocks();
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
});
