/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CostAmount,
  CostAnalyticsViewModel,
  CostCoverageState,
  CostOverTimeRow,
  CostProvenance,
} from "../cost-insights.js";
import { CostOverviewPanel } from "../components/cost/CostOverviewPanel.js";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

function provenance(state: CostCoverageState, overrides: Partial<CostProvenance> = {}): CostProvenance {
  const invocationCount = state === "unavailable" ? 0 : 2;
  return {
    state,
    invocationCount,
    configuredPricingInvocationCount: state === "complete" ? invocationCount : state === "partial" ? 1 : 0,
    providerReportedCostInvocationCount: 0,
    unpricedInvocationCount: state === "unpriced" ? invocationCount : state === "partial" ? 1 : 0,
    unknownInvocationCount: state === "unknown" ? invocationCount : 0,
    ...overrides,
  };
}

function amount(usd: number | null, state: CostCoverageState = "complete", overrides: Partial<CostProvenance> = {}): CostAmount {
  return { usd, provenance: provenance(state, overrides) };
}

function bucket(
  id: string,
  label: string,
  usd: number | null,
  state: CostCoverageState = "complete",
  overrides: Partial<CostOverTimeRow> = {},
): CostOverTimeRow {
  return {
    id,
    bucketStart: `2026-07-${id.padStart(2, "0")}T00:00:00.000Z`,
    bucketEnd: `2026-07-${id.padStart(2, "0")}T01:00:00.000Z`,
    label,
    amount: amount(usd, state),
    spendShare: 0.5,
    calls: 1,
    tokens: 1_000,
    ...overrides,
  };
}

function viewModel(overrides: Partial<CostAnalyticsViewModel> = {}): CostAnalyticsViewModel {
  const totalProvenance = provenance("complete");
  return {
    totalSpend: { usd: 0.0064, provenance: totalProvenance },
    costPerInvocation: { usd: 0.0032, provenance: totalProvenance },
    costPerMillionTokens: { usd: 3.2, provenance: totalProvenance },
    averageCostPerTask: { usd: 0.0032, provenance: totalProvenance, entityCount: 2 },
    averageCostPerSprint: { usd: 0.0064, provenance: totalProvenance, entityCount: 1 },
    calls: 2,
    tokens: 2_000,
    costOverTime: [
      bucket("1", "Jul 1, 12 AM", 0.00000042),
      bucket("2", "Jul 1, 1 AM", 0.00639958),
    ],
    spendSegments: [],
    tokenSegments: [],
    models: [],
    purposes: [],
    tasks: [],
    sprints: [],
    ...overrides,
  };
}

describe("CostOverviewPanel", () => {
  it("renders the executive metrics from the view model with sub-cent precision and provenance", () => {
    render(<CostOverviewPanel viewModel={viewModel()} />);

    expect(screen.getByRole("region", { name: "Cost executive overview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Executive overview" })).toBeInTheDocument();
    expect(screen.getAllByText("$0.0064").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.0032").length).toBeGreaterThan(0);
    expect(screen.getByText("$3.20")).toBeInTheDocument();
    expect(screen.getAllByText("Fully priced").length).toBeGreaterThan(0);
    expect(screen.getByText("Across 2 tasks with usage")).toBeInTheDocument();
    expect(screen.getByText("Across 1 canonical sprint with usage")).toBeInTheDocument();
    expect(screen.getByText(/All 2 invocations are priced/)).toBeInTheDocument();
  });

  it("makes every plotted bucket keyboard reachable and provides exact focused values and a data table", () => {
    render(<CostOverviewPanel viewModel={viewModel()} />);

    const bucketGroup = screen.getByLabelText("Spend buckets");
    const bucketButtons = within(bucketGroup).getAllByRole("button");
    expect(bucketButtons).toHaveLength(2);
    expect(bucketButtons[0]).toHaveAccessibleName(/Jul 1, 12 AM: \$0\.00000042/);
    expect(bucketButtons[1]).toHaveAccessibleName(/Jul 1, 1 AM: \$0\.00639958/);

    bucketButtons[0]?.focus();
    expect(bucketButtons[0]).toHaveFocus();
    expect(screen.getAllByText("$0.00000042").length).toBeGreaterThan(0);

    fireEvent.keyDown(bucketButtons[0] as HTMLButtonElement, { key: "ArrowRight" });
    expect(bucketButtons[1]).toHaveFocus();
    expect(screen.getByText("Jul 1, 1 AM · Peak")).toBeInTheDocument();
    expect(screen.getAllByText("$0.00639958").length).toBeGreaterThan(0);

    const dataTable = screen.getByRole("table", { name: "Spend over time data" });
    expect(within(dataTable).getAllByRole("row")).toHaveLength(3);
    expect(within(dataTable).getByRole("rowheader", { name: "Jul 1, 12 AM" })).toBeInTheDocument();
    expect(screen.getByText(/Peak: Jul 1, 1 AM, \$0\.00639958/)).toBeInTheDocument();
  });

  it("renders a no-usage state without presenting missing cost as zero", () => {
    const unavailable = amount(null, "unavailable");
    render(<CostOverviewPanel viewModel={viewModel({
      totalSpend: unavailable,
      costPerInvocation: unavailable,
      costPerMillionTokens: unavailable,
      averageCostPerTask: { ...unavailable, entityCount: 0 },
      averageCostPerSprint: { ...unavailable, entityCount: 0 },
      calls: 0,
      tokens: 0,
      costOverTime: [],
    })} />);

    expect(screen.getByRole("status")).toHaveTextContent("No usage in this window");
    expect(screen.getByText(/No provider invocations were recorded/)).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(5);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Spend buckets")).not.toBeInTheDocument();
  });

  it("keeps fully unpriced usage visible in metric and chart context without a zero claim", () => {
    const unpriced = amount(0, "unpriced");
    render(<CostOverviewPanel viewModel={viewModel({
      totalSpend: unpriced,
      costPerInvocation: unpriced,
      costPerMillionTokens: unpriced,
      averageCostPerTask: { ...unpriced, entityCount: 1 },
      averageCostPerSprint: { ...unpriced, entityCount: 1 },
      costOverTime: [bucket("1", "Only bucket", 0, "unpriced", { calls: 2 })],
    })} />);

    expect(screen.getAllByText("Unpriced").length).toBeGreaterThan(0);
    expect(screen.getByText(/Dollar totals are unavailable, not zero/)).toBeInTheDocument();
    expect(screen.getByText(/1 time bucket contains usage, but no priced spend is available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Only bucket: Unpriced/ })).toHaveAccessibleName(/no zero-dollar value is claimed/);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("labels partial pricing in both headline and focused chart detail", () => {
    const partialProvenance = provenance("partial");
    const partial = { usd: 0.25, provenance: partialProvenance };
    render(<CostOverviewPanel viewModel={viewModel({
      totalSpend: partial,
      costPerInvocation: { usd: 0.125, provenance: partialProvenance },
      costPerMillionTokens: { usd: 125, provenance: partialProvenance },
      averageCostPerTask: { ...partial, entityCount: 1 },
      averageCostPerSprint: { ...partial, entityCount: 1 },
      costOverTime: [bucket("1", "Partial bucket", 0.25, "partial", { calls: 2 })],
    })} />);

    expect(screen.getAllByText("Partial coverage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.25+").length).toBeGreaterThan(0);
    expect(screen.getByText(/Dollar values are priced subtotals/)).toBeInTheDocument();
    expect(screen.getAllByText("$0.25+ (priced subtotal)").length).toBeGreaterThan(0);
    expect(screen.getByText("Partial pricing; value is a priced subtotal.")).toBeInTheDocument();
  });

  it("distinguishes legitimate zero-cost usage and preserves a responsive single-bucket chart", () => {
    const coveredZero = amount(0, "complete", { invocationCount: 1, configuredPricingInvocationCount: 1 });
    const { container } = render(<CostOverviewPanel viewModel={viewModel({
      totalSpend: coveredZero,
      costPerInvocation: coveredZero,
      costPerMillionTokens: coveredZero,
      averageCostPerTask: { ...coveredZero, entityCount: 1 },
      averageCostPerSprint: { ...coveredZero, entityCount: 1 },
      calls: 1,
      tokens: 100,
      costOverTime: [bucket("1", "Single bucket", 0, "complete")],
    })} />);

    expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/legitimately total \$0\.00/)).toBeInTheDocument();
    expect(screen.getByText("Fully priced usage with a legitimate zero-dollar cost.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Single bucket: \$0\.00/ })).toBeInTheDocument();
    expect(container.querySelector("svg[viewBox='0 0 720 240']")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-responsive-safe='true']").length).toBeGreaterThanOrEqual(2);
  });
});
