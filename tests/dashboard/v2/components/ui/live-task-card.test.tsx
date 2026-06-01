/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/preact";
import { LiveTaskCard } from "../../../../../dashboard/src/v2/components/LiveTaskCard";
import type { Subtask } from "../../../../../dashboard/src/types.js";

// Mock resize observer and match media
window.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("../../../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
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
