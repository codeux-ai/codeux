/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CostAmount,
  CostCoverageState,
  CostDimensionRow,
  CostModelRow,
  CostProvenance,
  CostSpendSegment,
  CostTokenSegment,
} from "../cost-insights.js";
import { CostAllocationPanels } from "../components/cost/CostAllocationPanels.js";

expect.extend(matchers);

afterEach(() => cleanup());

function provenance(state: CostCoverageState, calls = 10): CostProvenance {
  return {
    state,
    invocationCount: calls,
    configuredPricingInvocationCount: state === "complete" || state === "partial" ? calls - (state === "partial" ? 2 : 0) : 0,
    providerReportedCostInvocationCount: 0,
    unpricedInvocationCount: state === "unpriced" ? calls : state === "partial" ? 2 : 0,
    unknownInvocationCount: state === "unknown" ? calls : 0,
  };
}

function amount(usd: number | null, state: CostCoverageState = "complete", calls = 10): CostAmount {
  return { usd, provenance: provenance(state, calls) };
}

const tokenSegments: CostTokenSegment[] = [
  { id: "input", label: "Input", tokens: 40, share: 0.4 },
  { id: "cached_input", label: "Cached input", tokens: 20, share: 0.2 },
  { id: "output", label: "Output", tokens: 30, share: 0.3 },
  { id: "reasoning", label: "Reasoning", tokens: 10, share: 0.1 },
];

function spendSegments(state: CostCoverageState = "complete"): CostSpendSegment[] {
  const values = [1, 2, 4, 3];
  const ids: CostSpendSegment["id"][] = ["input", "cached_input", "output", "provider_reported"];
  const labels = ["Input", "Cached input", "Output", "Provider reported"];
  return ids.map((id, index) => ({
    id,
    label: labels[index] ?? id,
    amount: amount(values[index] ?? 0, state),
    share: (values[index] ?? 0) / 10,
  }));
}

function dimensionRow(id: string, label: string, cost: number, tokens: number, calls = 2): CostDimensionRow {
  return {
    id,
    label,
    amount: amount(cost, "complete", calls),
    spendShare: cost / 10,
    tokenShare: tokens / 100,
    calls,
    costPerCall: amount(cost / calls, "complete", calls),
    tokens,
  };
}

function modelRow(
  id: string,
  provider: string,
  model: string,
  cost: number,
  tokens: number,
): CostModelRow {
  return {
    ...dimensionRow(id, `${provider} / ${model}`, cost, tokens),
    provider,
    model,
  };
}

function renderPanels(overrides: Partial<Parameters<typeof CostAllocationPanels>[0]> = {}) {
  const models = [
    modelRow("provider-a:model-alpha", "Provider A", "model-alpha", 6, 60),
    modelRow("provider-b:model-alpha", "Provider B", "model-alpha", 4, 40),
  ];
  const purposes = [
    dimensionRow("task_coding", "task_coding", 6, 60),
    dimensionRow("quality-assurance", "quality-assurance", 4, 40),
  ];

  return render(
    <CostAllocationPanels
      totalSpend={amount(10)}
      totalTokens={100}
      tokenSegments={tokenSegments}
      spendSegments={spendSegments()}
      models={models}
      purposes={purposes}
      {...overrides}
    />,
  );
}

describe("CostAllocationPanels", () => {
  it("reconciles exact token and spend segments and keeps provider-reported remainder distinct", () => {
    renderPanels();

    expect(screen.getByRole("region", { name: "Cost allocation" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Input 40; cached 20; output 30; reasoning 10; total 100/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Spend allocation.*Provider reported: \$3\.00, 30\.0%.*Total: \$10\.00/i })).toBeInTheDocument();

    const tokens = screen.getByRole("list", { name: "Exact token allocation values" });
    expect(within(tokens).getByText("40 tokens")).toBeInTheDocument();
    expect(within(tokens).getByText("20 tokens")).toBeInTheDocument();
    expect(within(tokens).getByText("30 tokens")).toBeInTheDocument();
    expect(within(tokens).getByText("10 tokens")).toBeInTheDocument();
    expect(within(tokens).getAllByText(/%$/).map((node) => node.textContent)).toEqual([
      "40.0%", "20.0%", "30.0%", "10.0%",
    ]);

    const spend = screen.getByRole("list", { name: "Exact spend allocation values" });
    expect(within(spend).getByText("Provider reported")).toBeInTheDocument();
    expect(within(spend).getByText("$3.00")).toBeInTheDocument();
    expect(within(spend).getAllByText(/%$/).map((node) => node.textContent)).toEqual([
      "10.0%", "20.0%", "40.0%", "30.0%",
    ]);
  });

  it("preserves deterministic view-model ranking and tie order while retaining provider/model identities", () => {
    const tiedModels = [
      modelRow("a", "Provider A", "same-model", 5, 50),
      modelRow("b", "Provider B", "same-model", 5, 50),
    ];
    renderPanels({ models: tiedModels });

    const ranking = screen.getByRole("list", { name: "Ranked model cost allocation" });
    const providerA = within(ranking).getByText("Provider A · same-model");
    const providerB = within(ranking).getByText("Provider B · same-model");
    expect(providerA.compareDocumentPosition(providerB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(ranking).getAllByText("same-model")).toHaveLength(2);
  });

  it("groups rows beyond the deterministic top six into a bounded Other row that reconciles totals", () => {
    const purposes = Array.from({ length: 8 }, (_, index) => (
      dimensionRow(`purpose_${index + 1}`, `purpose_${index + 1}`, 1.25, 12.5, 1)
    ));
    renderPanels({ purposes });

    const ranking = screen.getByRole("list", { name: "Ranked purpose cost allocation" });
    expect(within(ranking).getAllByRole("listitem")).toHaveLength(7);
    const other = screen.getByLabelText("Other purpose entries, 2 rows, ranked 7");
    expect(within(other).getByText("Other (2)")).toBeInTheDocument();
    expect(within(other).getByText("$2.50")).toBeInTheDocument();
    expect(within(other).getByText("25")).toBeInTheDocument();
    expect(within(other).getAllByText("25.0%", { selector: "dd" })).toHaveLength(2);
    expect(screen.queryByText("Purpose 7")).not.toBeInTheDocument();
    expect(screen.queryByText("Purpose 8")).not.toBeInTheDocument();
  });

  it("keeps long labels intact, humanizes purpose identifiers, and exposes keyboard-scannable rows", () => {
    const longModel = "model-with-an-intentionally-very-long-context-and-reasoning-variant-name";
    const longPurpose = "automated_security_review_and_dependency_validation";
    renderPanels({
      models: [modelRow("long", "Provider with a long regional deployment identity", longModel, 10, 100)],
      purposes: [dimensionRow("long-purpose", longPurpose, 10, 100)],
    });

    expect(screen.getByText(longModel)).toBeInTheDocument();
    expect(screen.getByText(`Provider with a long regional deployment identity · ${longModel}`)).toBeInTheDocument();
    expect(screen.getByText("Automated security review and dependency validation")).toBeInTheDocument();
    expect(screen.getByLabelText(`${longModel} ranked 1`)).toHaveAttribute("tabindex", "0");
  });

  it("shows an explicit empty state without presenting missing data as free usage", () => {
    renderPanels({
      totalSpend: amount(null, "unavailable", 0),
      totalTokens: 0,
      tokenSegments: tokenSegments.map((segment) => ({ ...segment, tokens: 0, share: 0 })),
      spendSegments: spendSegments().map((segment) => ({
        ...segment,
        amount: amount(null, "unavailable", 0),
        share: 0,
      })),
      models: [],
      purposes: [],
    });

    expect(screen.getByText("Empty window — no calls or token usage were recorded.")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("Configured free usage", { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText("No model cost allocation is available for this window.")).toBeInTheDocument();
    expect(screen.getByText("No purpose cost allocation is available for this window.")).toBeInTheDocument();
  });

  it("keeps unpriced usage visibly distinct from a configured zero-dollar total", () => {
    const unpriced = amount(0, "unpriced", 4);
    renderPanels({
      totalSpend: unpriced,
      spendSegments: spendSegments("unpriced").map((segment) => ({
        ...segment,
        amount: unpriced,
        share: 0,
      })),
    });

    expect(screen.getByText("Unpriced usage — 4 calls have usage telemetry but no usable price.")).toBeInTheDocument();
    expect(screen.getAllByText("Unpriced").length).toBeGreaterThan(0);
    expect(screen.queryByText("Configured free usage", { exact: false })).not.toBeInTheDocument();
  });

  it("marks partial coverage as a minimum rather than a complete total", () => {
    renderPanels({ totalSpend: amount(5, "partial", 10) });

    expect(screen.getByText("Partial cost coverage — 2 of 10 calls remain unpriced; shown spend is a minimum.")).toBeInTheDocument();
    expect(screen.getByText("$5.00+", { selector: "strong" })).toBeInTheDocument();
  });

  it("identifies a covered zero total as configured free usage", () => {
    renderPanels({
      totalSpend: amount(0, "complete", 3),
      spendSegments: spendSegments().map((segment) => ({
        ...segment,
        amount: amount(0, "complete", 3),
        share: 0,
      })),
    });

    expect(screen.getByText("Configured free usage — covered calls reconcile to $0.00 and are not unpriced.")).toBeInTheDocument();
    expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unpriced")).not.toBeInTheDocument();
  });
});
