/**
 * @vitest-environment jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TelemetryLedgerTabs } from "../components/TelemetryLedgerTabs.js";
import type { ExecutionStatsEntitySummary, ProjectExecutionStatsSnapshot } from "../../../types.js";

expect.extend(matchers);

const usage = (overrides: Partial<ExecutionStatsEntitySummary["usage"]> = {}): ExecutionStatsEntitySummary["usage"] => ({
  invocationCount: 1,
  activeTimeMs: 30_000,
  wallTimeMs: 35_000,
  inputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 80,
  reasoningOutputTokens: 10,
  totalTokens: 210,
  reportedInvocationCount: 1,
  estimatedInvocationCount: 0,
  unavailableInvocationCount: 0,
  unsupportedInvocationCount: 0,
  inputCostUsd: 0,
  outputCostUsd: 0,
  cachedInputCostUsd: 0,
  totalCostUsd: 0,
  ...overrides,
});

const entity = (
  id: string,
  label: string,
  overrides: Partial<ExecutionStatsEntitySummary> = {},
): ExecutionStatsEntitySummary => ({
  id,
  label,
  secondaryLabel: null,
  status: "completed",
  purpose: "task_coding",
  provider: "codex",
  usage: usage(),
  lastActivityAt: "2026-07-03T10:00:00Z",
  ...overrides,
});

const mockStats: ProjectExecutionStatsSnapshot = {
  projectId: "project-1",
  projectName: "Stats Project",
  window: "7d",
  query: { window: "7d" },
  range: {
    window: "7d",
    label: "Last 7 days",
    resolution: "day",
    resolutionLabel: "Daily",
    from: "2026-06-26T00:00:00Z",
    to: "2026-07-03T00:00:00Z",
    bucketCount: 7,
    isCustom: false,
  },
  generatedAt: "2026-07-03T10:00:00Z",
  usage: usage({ invocationCount: 5, totalTokens: 2_860, inputTokens: 1_300, outputTokens: 1_000 }),
  activeSprint: null,
  buckets: [],
  tasks: [
    {
      ...entity("task-1", "Alpha migration", {
      secondaryLabel: "T01",
      usage: usage({ totalTokens: 1_200, inputTokens: 700, outputTokens: 420, invocationCount: 3, totalCostUsd: 0.015 }),
      provider: "codex",
      }),
      duration: { p50Ms: 12_000, p95Ms: 24_000 },
    } as ExecutionStatsEntitySummary & { duration: { p50Ms: number; p95Ms: number } },
    entity("task-2", "Beta repair", {
      secondaryLabel: "T02",
      usage: usage({ totalTokens: 450, inputTokens: 230, outputTokens: 160, invocationCount: 2 }),
      provider: "gemini",
      status: "failed",
    }),
  ],
  sprints: [
    entity("sprint-1", "Sprint One", {
      usage: usage({ totalTokens: 2_100, inputTokens: 1_100, outputTokens: 800, invocationCount: 4 }),
      lastActivityAt: "2026-07-03T09:00:00Z",
    }),
    entity("sprint-2", "Sprint Two", {
      usage: usage({ totalTokens: 760, inputTokens: 300, outputTokens: 300, invocationCount: 1 }),
      lastActivityAt: "2026-07-02T09:00:00Z",
    }),
  ],
  providers: [],
  purposes: [],
  models: [],
  statusCounts: { completed: 1, failed: 1, running: 0, cancelled: 0, paused: 0 },
  duration: { sampleCount: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
  tokenSources: [],
  chartSeries: [],
  git: {
    tasks: [
      {
        id: "git-task-1",
        label: "Alpha migration",
        secondaryLabel: "T01",
        metrics: { insertions: 120, deletions: 20, filesChanged: 4, prCount: 1, mergedCount: 1, mergeConflictCount: 0 },
      },
    ],
    sprints: [
      {
        id: "git-sprint-1",
        label: "Sprint One",
        secondaryLabel: null,
        metrics: { insertions: 180, deletions: 60, filesChanged: 8, prCount: 2, mergedCount: 1, mergeConflictCount: 1 },
      },
      {
        id: "git-sprint-2",
        label: "Sprint Two",
        secondaryLabel: null,
        metrics: { insertions: 20, deletions: 10, filesChanged: 2, prCount: 1, mergedCount: 0, mergeConflictCount: 0 },
      },
    ],
    totals: {
      insertions: 320,
      deletions: 90,
      filesChanged: 14,
      prCount: 4,
      mergedCount: 2,
      mergeConflictCount: 1,
    },
    buckets: [],
  },
};

describe("TelemetryLedgerTabs", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as any;
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("renders tab counts and handles roving keyboard navigation", () => {
    render(<TelemetryLedgerTabs stats={mockStats} />);

    const tablist = screen.getByRole("tablist", { name: "Telemetry ledgers" });
    const tabs = screen.getAllByRole("tab");

    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAccessibleName("Task Telemetry, 2 entries");
    expect(tabs[0]).toHaveTextContent("2");
    expect(tabs[1]).toHaveAccessibleName("Sprint Telemetry, 2 entries");
    expect(tabs[2]).toHaveAccessibleName("Git Telemetry, 3 entries");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-tasks");

    tabs[0].focus();
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveFocus();

    fireEvent.keyDown(tablist, { key: "ArrowDown" });
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(tabs[2]).toHaveFocus();

    fireEvent.keyDown(tablist, { key: "ArrowUp" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveFocus();

    fireEvent.keyDown(tablist, { key: "End" });
    expect(tabs[2]).toHaveAttribute("aria-selected", "true");
    expect(tabs[2]).toHaveFocus();

    fireEvent.keyDown(tablist, { key: "Home" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveFocus();
  });

  it("allows keyboard tabbing from ledger tabs into search and sort controls", async () => {
    const user = userEvent.setup();
    render(<TelemetryLedgerTabs stats={mockStats} />);

    const taskTab = screen.getByRole("tab", { name: "Task Telemetry, 2 entries" });
    taskTab.focus();

    await user.tab();
    expect(screen.getByRole("tabpanel")).toHaveFocus();

    await user.tab();
    expect(screen.getByPlaceholderText("Search tasks")).toHaveFocus();

    await user.tab();
    const latestSort = screen.getByRole("button", { name: "Latest, not sorted" });
    expect(latestSort).toHaveFocus();
    expect(latestSort).toHaveAttribute("aria-pressed", "false");

    await user.tab();
    const tokensSort = screen.getByRole("button", { name: "Tokens, sorted descending" });
    expect(tokensSort).toHaveFocus();
    expect(tokensSort).toHaveAttribute("aria-pressed", "true");
  });

  it("filters task rows and shows clear empty-state context", () => {
    render(<TelemetryLedgerTabs stats={mockStats} />);

    expect(screen.getByLabelText("Alpha migration tasks telemetry row")).toBeInTheDocument();
    expect(screen.getByLabelText("Beta repair tasks telemetry row")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Alpha migration tasks telemetry row")).getByText("Leader")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Alpha migration tasks telemetry row")).getByText("$0.02")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Alpha migration tasks telemetry row")).getByText("p50")).toBeInTheDocument();

    fireEvent.input(screen.getByPlaceholderText("Search tasks"), { target: { value: "beta" } });
    expect(screen.queryByLabelText("Alpha migration tasks telemetry row")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Beta repair tasks telemetry row")).toBeInTheDocument();
    expect(screen.getByText('matching "beta"')).toBeInTheDocument();

    fireEvent.input(screen.getByPlaceholderText("Search tasks"), { target: { value: "missing" } });
    expect(screen.getByText("No tasks match “missing”.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" })[0]);
    expect(screen.getByLabelText("Alpha migration tasks telemetry row")).toBeInTheDocument();
  });

  it("sorts task rows by name and token volume", () => {
    render(<TelemetryLedgerTabs stats={mockStats} />);

    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    const sortedByNameRows = screen.getAllByLabelText(/tasks telemetry row/);
    expect(sortedByNameRows[0]).toHaveAccessibleName("Alpha migration tasks telemetry row");
    expect(sortedByNameRows[1]).toHaveAccessibleName("Beta repair tasks telemetry row");

    fireEvent.click(screen.getByRole("button", { name: /Tokens/ }));
    const sortedByTokensRows = screen.getAllByLabelText(/tasks telemetry row/);
    expect(sortedByTokensRows[0]).toHaveAccessibleName("Alpha migration tasks telemetry row");
    expect(sortedByTokensRows[1]).toHaveAccessibleName("Beta repair tasks telemetry row");

    fireEvent.click(screen.getByRole("button", { name: /Tokens/ }));
    const sortedByTokensAscendingRows = screen.getAllByLabelText(/tasks telemetry row/);
    expect(sortedByTokensAscendingRows[0]).toHaveAccessibleName("Beta repair tasks telemetry row");
    expect(sortedByTokensAscendingRows[1]).toHaveAccessibleName("Alpha migration tasks telemetry row");
  });

  it("renders sprint and git ledger summaries with sortable searchable content", () => {
    render(<TelemetryLedgerTabs stats={mockStats} />);

    fireEvent.click(screen.getByRole("tab", { name: "Sprint Telemetry, 2 entries" }));
    expect(screen.getByText("Top Contributor")).toBeInTheDocument();
    expect(screen.getByLabelText("Sprint One sprints telemetry row")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Git Telemetry, 3 entries" }));
    expect(screen.getByRole("region", { name: "Git telemetry overview" })).toBeInTheDocument();
    expect(screen.getByText("Visible Churn")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Git telemetry leaderboards" })).toBeInTheDocument();
    expect(screen.getByLabelText("Alpha migration git telemetry row")).toBeInTheDocument();

    fireEvent.input(screen.getByPlaceholderText("Search tasks"), { target: { value: "nomatch" } });
    expect(screen.getByText("No tasks match “nomatch”.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" })[0]);
    const gitLedger = screen.getByLabelText("Alpha migration git telemetry row");
    expect(within(gitLedger).getByText("Churn mix")).toBeInTheDocument();
    expect(within(gitLedger).getByText("Leader")).toBeInTheDocument();
  });

  it("renders empty states for empty ledgers", () => {
    render(<TelemetryLedgerTabs stats={{ ...mockStats, tasks: [], sprints: [], git: { ...mockStats.git, tasks: [], sprints: [], totals: { insertions: 0, deletions: 0, filesChanged: 0, prCount: 0, mergedCount: 0, mergeConflictCount: 0 } } }} />);

    expect(screen.getByText("No tasks telemetry is available in this window yet.")).toBeInTheDocument();
    expect(screen.getByText("No task telemetry landed in this window yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Git Telemetry, 0 entries" }));
    expect(screen.getByText("No git telemetry available in this window.")).toBeInTheDocument();
  });

  it("omits the git tab when git telemetry is not available", () => {
    const statsWithoutGit = { ...mockStats, git: null } as unknown as ProjectExecutionStatsSnapshot;

    render(<TelemetryLedgerTabs stats={statsWithoutGit} />);

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.queryByRole("tab", { name: /Git Telemetry/ })).not.toBeInTheDocument();
  });
});
