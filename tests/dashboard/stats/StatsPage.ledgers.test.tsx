/** @vitest-environment jsdom */
import { h } from "preact";
import { render } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { StatsTopCardsGrid } from "../../../dashboard/src/v2/components/stats/StatsTopCardsGrid.js";

describe("StatsTopCardsGrid", () => {
  const defaultUsage = {
    invocationCount: 10,
    activeTimeMs: 1000,
    wallTimeMs: 2000,
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 200,
    reasoningOutputTokens: 0,
    totalTokens: 300,
    reportedInvocationCount: 10,
    estimatedInvocationCount: 0,
    unavailableInvocationCount: 0,
    unsupportedInvocationCount: 0,
  };

  const defaultStats = {
    projectId: "proj-1",
    projectName: "Project 1",
    window: "7d",
    query: { window: "7d" },
    range: { start: "2023-01-01T00:00:00Z", end: "2023-01-08T00:00:00Z", days: 7, label: "Last 7 days" },
    generatedAt: "2023-01-08T00:00:00Z",
    usage: defaultUsage,
    buckets: [],
    sprints: [],
    tasks: [],
    providers: [],
    purposes: [],
    tokenSources: [],
    git: {
      totals: {
        insertions: 500,
        deletions: 200,
        filesChanged: 10,
        prCount: 5,
        mergedCount: 3,
      },
      buckets: [],
      tasks: [],
      sprints: [],
    },
    activeSprint: null,
  };

  it("should render default metrics when visualMode is not ledgers", () => {
    const { getByText } = render(
      <StatsTopCardsGrid
        stats={defaultStats as any}
        usage={defaultUsage}
        tokenSeries={[]}
        activeTimeSeries={[]}
        wallTimeSeries={[]}
        completionConfidence="Provider reported"
        visualMode="trend"
      />
    );

    expect(getByText("Total Tokens")).toBeDefined();
    expect(getByText("Active AI Time")).toBeDefined();
    expect(getByText("Wall Runtime")).toBeDefined();
    expect(getByText("Telemetry Confidence")).toBeDefined();
  });

  it("should render git metrics when visualMode is ledgers and gitStats exist", () => {
    const { getByText } = render(
      <StatsTopCardsGrid
        stats={defaultStats as any}
        usage={defaultUsage}
        tokenSeries={[]}
        activeTimeSeries={[]}
        wallTimeSeries={[]}
        completionConfidence="Provider reported"
        visualMode="ledgers"
      />
    );

    expect(getByText("Insertions")).toBeDefined();
    expect(getByText("+500")).toBeDefined();

    expect(getByText("Deletions")).toBeDefined();
    expect(getByText("-200")).toBeDefined();

    expect(getByText("Pull Requests")).toBeDefined();
    expect(getByText("5")).toBeDefined();

    expect(getByText("Merges")).toBeDefined();
    expect(getByText("3")).toBeDefined();
  });
});
