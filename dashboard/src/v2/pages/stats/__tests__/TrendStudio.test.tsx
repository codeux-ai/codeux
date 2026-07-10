/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { TrendStudio } from "../components/TrendStudio.js";

expect.extend(matchers);

vi.mock("../components/InteractiveUsageChart.js", () => ({
  InteractiveUsageChart: () => <div data-testid="interactive-usage-chart" />,
}));

describe("TrendStudio", () => {
  it("leads with the chart and keeps secondary signals and purpose activity flat", () => {
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
              outputTokens: 3200,
              totalCostUsd: 1.75,
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
                  invocationCount: 7,
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

    const chart = screen.getByTestId("interactive-usage-chart");
    const signals = screen.getByLabelText("Secondary trend signals");
    const purposeActivity = screen.getByText("Purpose Activity");

    expect(chart.compareDocumentPosition(signals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(signals.compareDocumentPosition(purposeActivity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chart.compareDocumentPosition(purposeActivity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(container.textContent).toContain("Median duration");
    expect(container.textContent).toContain("Output velocity");
    expect(container.textContent).toContain("Completion success");
    expect(container.textContent).not.toContain("vs first half of window");
    expect(container.textContent).not.toContain("Token trend");
    expect(container.textContent).not.toContain("Invocation trend");
    expect(container.textContent).not.toContain("Active time trend");
    expect(container.textContent).toContain("Purpose Activity");
    expect(screen.queryByLabelText("Trend range metadata")).toBeNull();
  });
});
