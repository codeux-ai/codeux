/**
 * @vitest-environment jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { render, screen, cleanup, fireEvent } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TopCardsModeRenderer } from "../../../src/v2/components/stats/TopCardsModeRenderer.js";
import { TelemetryLedgerTabs } from "../../../src/v2/pages/stats/components/TelemetryLedgerTabs.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn(),
    to: vi.fn(),
    set: vi.fn(),
    timeline: vi.fn().mockReturnValue({ to: vi.fn(), fromTo: vi.fn(), kill: vi.fn() }),
    matchMedia: vi.fn().mockReturnValue({
      add: vi.fn().mockImplementation((_query, callback) => {
        callback();
      }),
      revert: vi.fn(),
    }),
  },
}));

vi.mock("../../../src/v2/pages/stats/components/TelemetryLedger.js", () => ({
  TelemetryLedger: () => <div data-testid="mock-telemetry-ledger" />,
}));

vi.mock("../../../src/v2/pages/stats/components/GitTelemetryTab.js", () => ({
  GitTelemetryTab: () => <div data-testid="mock-git-ledger" />,
}));

const mockStats = {
  purposes: [
    { id: "task_coding", usage: { totalTokens: 1000 } },
    { id: "ci_fix", usage: { totalTokens: 500 } },
    { id: "qa_review", usage: { totalTokens: 200 } },
    { id: "planning", usage: { totalTokens: 100 } },
  ],
  usage: {
    wallTimeMs: 120000,
    inputTokens: 1500,
    outputTokens: 300,
    cachedInputTokens: 50,
    reasoningOutputTokens: 0,
    reportedInvocationCount: 8,
    estimatedInvocationCount: 2,
    unavailableInvocationCount: 1,
    unsupportedInvocationCount: 0,
  },
  providers: [
    { id: "provider-a", label: "Provider A", usage: { totalTokens: 1200 } },
  ],
  models: [
    {
      id: "model-a",
      label: "Gemini 2.0 Flash",
      usage: {
        invocationCount: 5,
        totalTokens: 1200,
        inputTokens: 700,
        cachedInputTokens: 100,
        outputTokens: 400,
        reasoningOutputTokens: 80,
        activeTimeMs: 240000,
        wallTimeMs: 300000,
      },
      duration: {
        sampleCount: 5,
        p50Ms: 42000,
        p95Ms: 71000,
        avgMs: 50000,
        minMs: 30000,
        maxMs: 90000,
      },
      successRate: 0.8,
      statusCounts: {
        completed: 4,
        failed: 1,
        cancelled: 0,
        running: 0,
        paused: 0,
      },
    },
  ],
  statusCounts: {
    completed: 8,
    failed: 2,
    cancelled: 1,
    running: 0,
    paused: 0,
  },
  mergeConflictCount: 3,
  git: {
    totals: {
      insertions: 100,
      deletions: 50,
      filesChanged: 12,
      prCount: 4,
      mergedCount: 2,
      mergeConflictCount: 3,
    },
  },
  ledgers: {
    tasks: [{}, {}],
    invocations: [{}, {}, {}],
  },
};

const baseProps = {
  stats: mockStats as any,
  providerSegments: [
    { id: "p_a", label: "Provider A", value: 1200, color: "#111" },
  ],
  tokenSegments: [],
  sourceSegments: [],
};

afterEach(() => {
  cleanup();
});

describe("TopCardsModeRenderer mode regression", () => {
  it("keeps the trend, composition, models, reliability, and ledgers labels stable", () => {
    render(<TopCardsModeRenderer mode="trend" {...baseProps} />);
    expect(screen.getByText("Task Coding")).toBeInTheDocument();
    expect(screen.getByText("CI Fix")).toBeInTheDocument();
    expect(screen.getByText("QA Review")).toBeInTheDocument();
    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByText("Wall Runtime")).toBeInTheDocument();

    cleanup();
    render(<TopCardsModeRenderer mode="composition" {...baseProps} />);
    expect(screen.getByText("Active Providers")).toBeInTheDocument();
    expect(screen.getByText("Top Provider")).toBeInTheDocument();
    expect(screen.getByText("Provider A")).toBeInTheDocument();
    expect(screen.getByText("Input Tokens")).toBeInTheDocument();
    expect(screen.getByText("Output Tokens")).toBeInTheDocument();
    expect(screen.getByText("Merge Conflicts")).toBeInTheDocument();

    cleanup();
    render(<TopCardsModeRenderer mode="models" {...baseProps} />);
    expect(screen.getByText("Active Models")).toBeInTheDocument();
    expect(screen.getByText("Top Model")).toBeInTheDocument();
    expect(screen.getByText("Gemini 2.0 Flash")).toBeInTheDocument();
    expect(screen.getByText("Success Rate")).toBeInTheDocument();
    expect(screen.getByText("Median Latency")).toBeInTheDocument();
    expect(screen.getByText("Cache Hit Rate")).toBeInTheDocument();

    cleanup();
    render(<TopCardsModeRenderer mode="reliability" {...baseProps} />);
    expect(screen.getByText("Provider A")).toBeInTheDocument();

    cleanup();
    render(<TopCardsModeRenderer mode="ledgers" {...baseProps} />);
    expect(screen.getByText("Insertions")).toBeInTheDocument();
    expect(screen.getByText("Deletions")).toBeInTheDocument();
    expect(screen.getByText("Pull Requests")).toBeInTheDocument();
    expect(screen.getByText("Merged Commits")).toBeInTheDocument();
    expect(screen.getByText("Files Changed")).toBeInTheDocument();
  });
});

describe("TelemetryLedgerTabs", () => {
  it("keeps ledger tab counts and roving keyboard navigation intact", () => {
    render(
      <TelemetryLedgerTabs
        stats={{
          tasks: [{ id: "task-1" }],
          sprints: [{ id: "sprint-1" }, { id: "sprint-2" }],
          git: {
            tasks: [{ id: "git-task-1" }],
            sprints: [{ id: "git-sprint-1" }, { id: "git-sprint-2" }, { id: "git-sprint-3" }],
            totals: {
              insertions: 0,
              deletions: 0,
              filesChanged: 0,
              prCount: 0,
              mergedCount: 0,
              mergeConflictCount: 0,
            },
            buckets: [],
          },
        } as any}
      />
    );

    const tablist = screen.getByRole("tablist", { name: "Telemetry ledgers" });
    const tabs = screen.getAllByRole("tab");

    expect(tabs[0]).toHaveTextContent("Task Telemetry");
    expect(tabs[0]).toHaveTextContent("1");
    expect(tabs[1]).toHaveTextContent("Sprint Telemetry");
    expect(tabs[1]).toHaveTextContent("2");
    expect(tabs[2]).toHaveTextContent("Git Telemetry");
    expect(tabs[2]).toHaveTextContent("4");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });
});
