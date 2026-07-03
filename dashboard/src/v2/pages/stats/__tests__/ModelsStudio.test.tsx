/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import { ModelsStudio } from "../components/ModelsStudio.js";

afterEach(() => {
  cleanup();
});

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn(),
    to: vi.fn(),
    set: vi.fn(),
    timeline: vi.fn(() => ({ to: vi.fn().mockReturnThis(), fromTo: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), kill: vi.fn() })),
  },
}));

const usage = {
  invocationCount: 12,
  activeTimeMs: 720000,
  wallTimeMs: 0,
  inputTokens: 4000,
  cachedInputTokens: 6000,
  outputTokens: 2400,
  reasoningOutputTokens: 600,
  totalTokens: 13000,
  reportedInvocationCount: 12,
  estimatedInvocationCount: 0,
  unavailableInvocationCount: 0,
  unsupportedInvocationCount: 0,
};

const model = {
  id: "claude::claude-opus-4-8",
  provider: "claude",
  model: "claude-opus-4-8",
  label: "claude-opus-4-8",
  usage,
  statusCounts: { completed: 11, failed: 1, cancelled: 0, running: 0, paused: 0 },
  successRate: 11 / 12,
  duration: { sampleCount: 12, avgMs: 42000, p50Ms: 38000, p95Ms: 95000, maxMs: 120000 },
  lastActivityAt: "2026-06-09T18:30:00.000Z",
};

describe("ModelsStudio", () => {
  it("renders the leaderboard with efficiency metrics and highlights", () => {
    const { container } = render(
      <ModelsStudio
        stats={{ models: [model] } as any}
      />,
    );

    expect(screen.getByText("Model performance & efficiency")).toBeTruthy();
    expect(screen.getByText("Model Leaderboard")).toBeTruthy();
    expect(screen.getAllByText("claude-opus-4-8").length).toBeGreaterThan(0);

    // Efficiency derivations: cache hit 6000/(4000+6000)=60%, success 92%
    expect(container.textContent).toContain("60%");
    expect(container.textContent).toContain("92%");
    expect(container.textContent).toContain("Median Latency");
    expect(container.textContent).toContain("Efficiency Highlights");
    expect(container.textContent).toContain("Most Reliable");
  });

  it("renders an empty state when no models reported", () => {
    render(<ModelsStudio stats={{ models: [] } as any} />);
    expect(screen.getByText("No model telemetry landed in this window yet.")).toBeTruthy();
  });

  it("tolerates snapshots without a models field", () => {
    render(<ModelsStudio stats={{} as any} />);
    expect(screen.getByText("No model telemetry landed in this window yet.")).toBeTruthy();
  });
});
