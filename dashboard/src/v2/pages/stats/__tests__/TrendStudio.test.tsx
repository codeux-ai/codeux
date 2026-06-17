/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TrendStudio } from "../components/StatsShared.js";

expect.extend(matchers);

vi.mock("../components/InteractiveUsageChart.js", () => ({
  InteractiveUsageChart: () => <div data-testid="interactive-usage-chart" />,
}));

describe("TrendStudio", () => {
  it("renders the summary band, period chips, chart, and purpose breakdown in order", () => {
    const { container } = render(
      <TrendStudio
        stats={
          {
            usage: {
              totalTokens: 12500,
              invocationCount: 42,
              activeTimeMs: 5400000,
              inputTokens: 1000,
              cachedInputTokens: 250,
            },
            range: {
              label: "Last 7 Days",
              resolutionLabel: "Daily",
            },
            buckets: [{}, {}],
            purposes: [
              {
                id: "planning",
                label: "Planning",
                usage: {
                  totalTokens: 5000,
                  activeTimeMs: 1800000,
                  inputTokens: 2400,
                  outputTokens: 1600,
                },
              },
            ],
          } as any
        }
        loading={false}
        error={null}
        refresh={vi.fn()}
        planningUsage={null}
        chartState={{ metrics: { peakCostUsd: 1.5 } } as any}
      />,
    );

    const totalTokens = screen.getByText("Total Tokens");
    const rangeLabel = screen.getByText("Last 7 Days");
    const chart = screen.getByTestId("interactive-usage-chart");
    const purposeActivity = screen.getByText("Purpose Activity");

    expect(totalTokens.compareDocumentPosition(rangeLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rangeLabel.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chart.compareDocumentPosition(purposeActivity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(container.textContent).toContain("12.5k");
    expect(container.textContent).toContain("42");
    expect(container.textContent).toContain("Purpose Activity");
  });
});
