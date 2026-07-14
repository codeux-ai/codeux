/**
 * @vitest-environment jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { CostEntityLedgers } from "../components/cost/CostEntityLedgers.js";
import type {
  CostAmount,
  CostAverage,
  CostCoverageState,
  CostDetailRow,
  CostProvenance,
} from "../cost-insights.js";

expect.extend(matchers);

const callbacks: IntersectionObserverCallback[] = [];

function provenance(state: CostCoverageState, calls = 1): CostProvenance {
  const covered = state === "complete" ? calls : state === "partial" ? Math.max(1, calls - 1) : 0;
  return {
    state,
    invocationCount: state === "unavailable" ? 0 : calls,
    configuredPricingInvocationCount: covered,
    providerReportedCostInvocationCount: 0,
    unpricedInvocationCount: state === "unpriced" ? calls : state === "partial" ? calls - covered : 0,
    unknownInvocationCount: state === "unknown" ? calls : 0,
  };
}

function amount(usd: number | null, state: CostCoverageState = "complete", calls = 1): CostAmount {
  return { usd, provenance: provenance(state, calls) };
}

function row(
  id: string,
  label: string,
  overrides: Partial<CostDetailRow> = {},
): CostDetailRow {
  const calls = overrides.calls ?? 2;
  const spend = overrides.amount ?? amount(1, "complete", calls);
  return {
    id,
    label,
    amount: spend,
    spendShare: 0.1,
    tokenShare: 0.1,
    calls,
    costPerCall: overrides.costPerCall ?? amount((spend.usd ?? 0) / Math.max(1, calls), spend.provenance.state, calls),
    tokens: 1_000,
    status: "completed",
    secondaryLabel: `Context ${id}`,
    lastActivityAt: "2026-07-14T10:00:00.000Z",
    recency: "Jul 14, 10:00 AM",
    tokenSegments: [
      { id: "input", label: "Input", tokens: 500, share: 0.5 },
      { id: "cached_input", label: "Cached input", tokens: 100, share: 0.1 },
      { id: "output", label: "Output", tokens: 300, share: 0.3 },
      { id: "reasoning", label: "Reasoning", tokens: 100, share: 0.1 },
    ],
    ...overrides,
  };
}

function average(usd: number | null, entityCount: number, state: CostCoverageState = "complete"): CostAverage {
  return { ...amount(usd, state, entityCount), entityCount };
}

const defaultProps = {
  tasks: [
    row("task-alpha", "Alpha task", { amount: amount(1), costPerCall: amount(0.5) }),
    row("task-beta", "Beta task", {
      amount: amount(2),
      costPerCall: amount(1),
      tokens: 2_000,
      lastActivityAt: "2026-07-14T11:00:00.000Z",
      recency: "Jul 14, 11:00 AM",
    }),
  ],
  sprints: [row("sprint-concept", "Canonical sprint", { secondaryLabel: "2 runs combined" })],
  averageCostPerTask: average(1.5, 2),
  averageCostPerSprint: average(1, 1),
};

describe("CostEntityLedgers", () => {
  beforeEach(() => {
    callbacks.length = 0;
    window.IntersectionObserver = class MockIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "0px";
      readonly thresholds = [0];

      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback);
      }

      disconnect(): void {}
      observe(): void {}
      takeRecords(): IntersectionObserverEntry[] { return []; }
      unobserve(): void {}
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("uses tabs with click, Arrow, Home, and End keyboard behavior", () => {
    render(<CostEntityLedgers {...defaultProps} />);

    const tablist = screen.getByRole("tablist", { name: "Cost ledgers" });
    const taskTab = screen.getByRole("tab", { name: /Tasks/ });
    const sprintTab = screen.getByRole("tab", { name: /Sprints/ });
    expect(taskTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "cost-ledger-tab-tasks");

    taskTab.focus();
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(sprintTab).toHaveFocus();
    expect(sprintTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Canonical sprint sprint cost row")).toBeInTheDocument();

    fireEvent.keyDown(tablist, { key: "Home" });
    expect(taskTab).toHaveFocus();
    expect(taskTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tablist, { key: "End" });
    expect(sprintTab).toHaveFocus();
    fireEvent.keyDown(tablist, { key: "ArrowUp" });
    expect(taskTab).toHaveFocus();

    fireEvent.click(sprintTab);
    expect(sprintTab).toHaveAttribute("aria-selected", "true");
  });

  it("clears search while keeping the full-collection average stable", () => {
    render(<CostEntityLedgers {...defaultProps} />);

    expect(screen.getByText("$3.00")).toBeInTheDocument();
    expect(screen.getByText("$1.50")).toBeInTheDocument();
    fireEvent.input(screen.getByRole("searchbox", { name: "Search tasks" }), { target: { value: "alpha" } });

    expect(screen.getAllByText("$1.00").length).toBeGreaterThan(0);
    expect(screen.getByText("$1.50")).toBeInTheDocument();
    expect(screen.queryByLabelText("Beta task task cost row")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Filter alpha.*1 of 1 matching rows displayed/);

    fireEvent.input(screen.getByRole("searchbox", { name: "Search tasks" }), { target: { value: "missing" } });
    expect(screen.getByText("No tasks match “missing”.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear cost ledger search" }));
    expect(screen.getByLabelText("Beta task task cost row")).toBeInTheDocument();
    expect(screen.getByText("$1.50")).toBeInTheDocument();
  });

  it("toggles every sort deterministically and announces direction", () => {
    const tiedRows = [
      row("z-id", "Same", { amount: amount(2), tokens: 1_000, calls: 2 }),
      row("a-id", "Same", { amount: amount(2), tokens: 1_000, calls: 2 }),
      row("low", "Low", { amount: amount(1), tokens: 500, calls: 1 }),
    ];
    render(<CostEntityLedgers {...defaultProps} tasks={tiedRows} />);

    const labels = () => screen.getAllByRole("article").map((article) => article.getAttribute("aria-label"));
    expect(labels()).toEqual(["Same task cost row", "Same task cost row", "Low task cost row"]);
    expect(screen.getAllByRole("article")[0]).toHaveAttribute("data-cost-row-id", "a-id");

    fireEvent.click(screen.getByRole("button", { name: "Spend, sorted descending" }));
    expect(labels()[0]).toBe("Low task cost row");
    expect(screen.getByRole("status")).toHaveTextContent("Sorted by Spend ascending");

    for (const label of ["Tokens", "Calls", "Cost / call", "Recent", "Name"]) {
      const button = screen.getByRole("button", { name: new RegExp(`^${label.replace("/", "\\/")}, not sorted`) });
      fireEvent.click(button);
      const activeButton = screen.getByRole("button", { name: new RegExp(`^${label.replace("/", "\\/")}, sorted`) });
      expect(activeButton).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(activeButton);
      expect(screen.getByRole("status")).toHaveTextContent(new RegExp(`Sorted by ${label.replace("/", "\\/")} (ascending|descending)`));
    }
  });

  it("shows each canonical sprint once even when its context reports combined reruns", () => {
    render(<CostEntityLedgers {...defaultProps} />);
    fireEvent.click(screen.getByRole("tab", { name: /Sprints/ }));

    expect(screen.getAllByLabelText("Canonical sprint sprint cost row")).toHaveLength(1);
    expect(screen.getByText("2 runs combined · Jul 14, 10:00 AM")).toBeInTheDocument();
    expect(screen.queryByText(/sprint run/i)).not.toBeInTheDocument();
  });

  it("progressively mounts rows without changing filtered totals", () => {
    const tasks = Array.from({ length: 15 }, (_, index) => row(
      `task-${index + 1}`,
      `Task ${String(index + 1).padStart(2, "0")}`,
      { amount: amount(1) },
    ));
    render(<CostEntityLedgers {...defaultProps} tasks={tasks} averageCostPerTask={average(1, 15)} />);

    expect(screen.getAllByRole("article")).toHaveLength(12);
    expect(screen.getByText("$15.00")).toBeInTheDocument();
    expect(screen.getByText(/Showing 12 of 15 rows/)).toBeInTheDocument();

    const callback = callbacks.at(-1);
    expect(callback).toBeDefined();
    act(() => {
      callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(screen.getAllByRole("article")).toHaveLength(15);
    expect(screen.getByText("$15.00")).toBeInTheDocument();
  });

  it("preserves sub-cent precision and distinguishes every pricing provenance state", () => {
    const tasks = [
      row("tiny", "Tiny priced", { amount: amount(0.000004), costPerCall: amount(0.000004), calls: 1 }),
      row("zero", "Legitimate zero", { amount: amount(0), costPerCall: amount(0), calls: 1 }),
      row("partial", "Partial task", { amount: amount(0.25, "partial", 2), costPerCall: amount(0.125, "partial", 2) }),
      row("unpriced", "Unpriced task", { amount: amount(0, "unpriced"), costPerCall: amount(0, "unpriced") }),
      row("unknown", "Unknown task", { amount: amount(0, "unknown"), costPerCall: amount(0, "unknown") }),
    ];
    render(<CostEntityLedgers {...defaultProps} tasks={tasks} averageCostPerTask={average(0.05, 5, "partial")} />);

    expect(within(screen.getByLabelText("Tiny priced task cost row")).getAllByText("$0.000004")).toHaveLength(2);
    expect(within(screen.getByLabelText("Legitimate zero task cost row")).getAllByText("$0.00")).toHaveLength(2);
    expect(within(screen.getByLabelText("Partial task task cost row")).getByText("Partial coverage")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Unpriced task task cost row")).getAllByText("Unpriced").length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText("Unknown task task cost row")).getAllByText("Coverage unknown").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Full coverage").length).toBeGreaterThan(0);
  });

  it("renders deliberate no-task, no-sprint, and empty-search states", () => {
    render(<CostEntityLedgers {...defaultProps} tasks={[]} sprints={[]} averageCostPerTask={average(null, 0, "unavailable")} averageCostPerSprint={average(null, 0, "unavailable")} />);
    expect(screen.getByText("No tasks have cost telemetry in this window.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Sprints/ }));
    expect(screen.getByText("No sprints have cost telemetry in this window.")).toBeInTheDocument();
  });
});
