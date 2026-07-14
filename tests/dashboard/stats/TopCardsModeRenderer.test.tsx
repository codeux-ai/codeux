/**
 * @vitest-environment jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import { render, screen, cleanup, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopCardsModeRenderer } from "../../../dashboard/src/v2/components/stats/TopCardsModeRenderer.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn(),
  },
}));

vi.mock("../../../dashboard/src/v2/components/ui/Sparkline.js", () => ({
  Sparkline: () => <div data-testid="mock-sparkline">Sparkline</div>,
}));

const usage = {
  invocationCount: 14,
  activeTimeMs: 1_800_000,
  wallTimeMs: 3_600_000,
  inputTokens: 25_000,
  cachedInputTokens: 5_000,
  outputTokens: 18_000,
  reasoningOutputTokens: 2_000,
  totalTokens: 50_000,
  inputCostUsd: 4.25,
  outputCostUsd: 7.59,
  cachedInputCostUsd: 0.5,
  totalCostUsd: 12.34,
  costCoverage: {
    configuredPricingInvocationCount: 10,
    providerReportedCostInvocationCount: 4,
    unpricedInvocationCount: 0,
    providerReportedCostUsd: 2.5,
  },
  reportedInvocationCount: 9,
  estimatedInvocationCount: 1,
  unavailableInvocationCount: 0,
  unsupportedInvocationCount: 0,
};

const stats = {
  projectId: "project-1",
  projectName: "Project 1",
  window: "7d",
  query: { window: "7d" },
  range: {
    window: "7d",
    label: "Last 7 days",
    resolution: "day",
    resolutionLabel: "day",
    from: "2026-06-26T00:00:00.000Z",
    to: "2026-07-03T00:00:00.000Z",
    bucketCount: 3,
    isCustom: false,
  },
  generatedAt: "2026-07-03T00:00:00.000Z",
  usage,
  buckets: [
    { bucketStart: "2026-07-01T00:00:00.000Z", bucketEnd: "2026-07-02T00:00:00.000Z", label: "Jul 1", usage: { ...usage, invocationCount: 4, totalTokens: 10_000, activeTimeMs: 600_000, wallTimeMs: 900_000, cachedInputTokens: 1_000, inputTokens: 5_000 } },
    { bucketStart: "2026-07-02T00:00:00.000Z", bucketEnd: "2026-07-03T00:00:00.000Z", label: "Jul 2", usage: { ...usage, invocationCount: 5, totalTokens: 15_000, activeTimeMs: 700_000, wallTimeMs: 1_100_000, cachedInputTokens: 2_000, inputTokens: 8_000 } },
    { bucketStart: "2026-07-03T00:00:00.000Z", bucketEnd: "2026-07-04T00:00:00.000Z", label: "Jul 3", usage: { ...usage, invocationCount: 5, totalTokens: 25_000, activeTimeMs: 500_000, wallTimeMs: 1_600_000, cachedInputTokens: 2_000, inputTokens: 12_000 } },
  ],
  chartSeries: [
    { id: "core_total_tokens", data: [10_000, 15_000, 25_000] },
    { id: "core_total_cost", data: [2.1, 3.4, 6.84] },
    { id: "provider_codex", data: [5_000, 10_000, 15_000] },
    { id: "model_gpt-5", data: [8_000, 12_000, 20_000] },
    { id: "git_merge_conflicts", data: [0, 1, 0] },
  ],
  providers: [
    { id: "claude", label: "Claude", usage: { ...usage, totalTokens: 20_000, invocationCount: 4, totalCostUsd: 3.25 } },
    { id: "codex", label: "Codex", usage: { ...usage, totalTokens: 30_000, invocationCount: 10, totalCostUsd: 9.09 } },
  ],
  purposes: [
    { id: "planning", label: "Planning", usage: { ...usage, totalTokens: 5_000, invocationCount: 3 } },
    { id: "task_coding", label: "Task Coding", usage: { ...usage, totalTokens: 45_000, invocationCount: 11 } },
  ],
  models: [
    {
      id: "gpt-5",
      provider: "codex",
      model: "gpt-5",
      label: "GPT-5",
      usage: { ...usage, totalTokens: 40_000, invocationCount: 10, totalCostUsd: 10.1 },
      statusCounts: { completed: 9, failed: 1, cancelled: 0, running: 0, paused: 0 },
      successRate: 0.9,
      duration: { sampleCount: 10, avgMs: 50_000, p50Ms: 40_000, p95Ms: 90_000, maxMs: 100_000 },
      lastActivityAt: "2026-07-03T00:00:00.000Z",
    },
  ],
  tasks: [
    { id: "task-a", label: "Task A", usage: { ...usage, totalTokens: 12_000, totalCostUsd: 1.25 } },
    { id: "task-b", label: "Task B", usage: { ...usage, totalTokens: 30_000, totalCostUsd: 5.5 } },
  ],
  sprints: [
    { id: "sprint-1", label: "Sprint 1", usage: { ...usage, totalTokens: 50_000 } },
  ],
  git: {
    totals: {
      insertions: 120,
      deletions: 40,
      filesChanged: 8,
      prCount: 3,
      mergedCount: 2,
      mergeConflictCount: 1,
    },
    buckets: [],
    tasks: [],
    sprints: [],
  },
  mergeConflictCount: 1,
  activeSprint: { sprintId: "sprint-1", sprintName: "Sprint 1", sprintNumber: 7 },
  statusCounts: { completed: 9, failed: 1, cancelled: 0, running: 4, paused: 0 },
  duration: { sampleCount: 10, avgMs: 50_000, p50Ms: 40_000, p95Ms: 90_000, maxMs: 100_000 },
  tokenSources: [{ source: "reported", count: 9 }],
} as any;

const baseProps = {
  stats,
  providerSegments: [
    { label: "Claude", value: 20_000, color: "#888", textClassName: "text-slate-500" },
    { label: "Codex", value: 30_000, color: "#00E0A0", textClassName: "text-signal-600" },
  ],
  tokenSegments: [
    { label: "Output", value: 18_000, color: "#888", textClassName: "text-slate-500" },
    { label: "Input", value: 25_000, color: "#00E0A0", textClassName: "text-signal-600" },
  ],
  sourceSegments: [
    { label: "estimated", value: 1, color: "#888", textClassName: "text-slate-500" },
    { label: "reported", value: 9, color: "#00E0A0", textClassName: "text-signal-600" },
  ],
};

afterEach(() => {
  cleanup();
});

describe("TopCardsModeRenderer", () => {
  it("sorts trend cards around work, cost, and throughput signals", () => {
    render(<TopCardsModeRenderer mode="trend" {...baseProps} />);

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(5);
    expect(within(cards[0]!).getByText("Invocations")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("14")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("Cost")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("$12.34")).toBeInTheDocument();
    expect(within(cards[2]!).getByText("Total Tokens")).toBeInTheDocument();
    expect(within(cards[2]!).getByText("50.0k")).toBeInTheDocument();
  });

  it("surfaces the dominant provider and token segment in composition mode", () => {
    render(<TopCardsModeRenderer mode="composition" {...baseProps} />);

    expect(screen.getByRole("article", { name: /Provider Share: 60%/ })).toHaveTextContent("Codex leads 2 provider rows by tokens");
    expect(screen.getByRole("article", { name: /Token Anatomy: 50.0k/ })).toHaveTextContent("Input leads at 50%");
    expect(screen.getByRole("article", { name: /Source Mix: 90%/ })).toHaveTextContent("reported is the dominant telemetry source");
  });

  it("renders a provenance-aware cost deck with normalized averages and coverage", () => {
    render(<TopCardsModeRenderer mode="cost" {...baseProps} />);

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(5);
    expect(cards[0]).toHaveAccessibleName(/Total Spend: \$12\.34/);
    expect(screen.getByRole("article", { name: /Average per Task: \$3\.38/ })).toHaveTextContent("Across 2 tasks");
    expect(screen.getByRole("article", { name: /Average per Sprint: \$12\.34/ })).toHaveTextContent("canonical sprint");
    expect(screen.getByRole("article", { name: /Blended Cost \/ 1M Tokens: \$246\.80/ })).toHaveTextContent("50,000 tracked tokens");
    expect(screen.getByRole("article", { name: /Pricing Coverage: 100\.0%/ })).toHaveTextContent("All 14 calls");
  });

  it("prioritizes active model health, ledger volume, and live system health", () => {
    render(<TopCardsModeRenderer mode="models" {...baseProps} />);
    expect(screen.getAllByRole("article")[0]).toHaveAccessibleName(/Top Model: GPT-5/);
    expect(screen.getByRole("article", { name: /Success Rate: 90%/ })).toHaveTextContent("9 completed");

    cleanup();
    render(<TopCardsModeRenderer mode="ledgers" {...baseProps} />);
    expect(screen.getAllByRole("article")[0]).toHaveAccessibleName(/Task Rows: 2/);
    expect(screen.getByRole("article", { name: /Files Changed: 8/ })).toHaveTextContent("120 added");

    cleanup();
    render(<TopCardsModeRenderer mode="system" {...baseProps} />);
    expect(screen.getAllByRole("article")[0]).toHaveAccessibleName(/System Health: 90.0%/);
    expect(screen.getByRole("article", { name: /Provider Rows: 2/ })).toHaveTextContent("Lead provider: Codex");
  });
});
