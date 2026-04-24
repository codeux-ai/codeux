/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/preact";
import { LiveTaskCard } from "../../../../../dashboard/src/v2/components/LiveTaskCard.js";
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

vi.mock("gsap", () => {
  const gsapMock = {
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    registerPlugin: vi.fn(),
    context: vi.fn((cb) => {
      if (typeof cb === "function") cb();
      return { revert: vi.fn(), add: vi.fn() };
    }),
    timeline: vi.fn(() => ({
      to: vi.fn().mockReturnThis(),
      fromTo: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      add: vi.fn().mockReturnThis(),
      kill: vi.fn().mockReturnThis(),
      clear: vi.fn().mockReturnThis(),
    })),
  };
  return {
    gsap: gsapMock,
    default: gsapMock,
  };
});

describe("LiveTaskCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getMockTask = (status: Subtask["status"]): Subtask => ({
    id: "test-task",
    name: "Test Task",
    project_id: "p1",
    sprint_id: "s1",
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    prompt: "Test prompt",
  });

  it("renders running state properly", () => {
    const task = getMockTask("RUNNING");
    const { container } = render(<LiveTaskCard task={task} onRerun={vi.fn()} isRerunning={false} />);
    expect(container).toBeTruthy();
  });

  it("renders completed state properly", () => {
    const task = getMockTask("COMPLETED");
    const { container } = render(<LiveTaskCard task={task} onRerun={vi.fn()} isRerunning={false} />);
    expect(container).toBeTruthy();
  });
});
