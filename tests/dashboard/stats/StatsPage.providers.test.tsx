/// <reference types="@testing-library/jest-dom" />
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

import { StatsTopCardsGrid } from "../../../dashboard/src/v2/components/stats/StatsTopCardsGrid.js";

// Mock child components
vi.mock("../../../dashboard/src/v2/components/stats/ProviderUsageCard.js", () => ({
  ProviderUsageCard: ({ provider }: { provider: any }) => (
    <div data-testid={`provider-card-${provider.id}`}>{provider.name}</div>
  ),
}));

vi.mock("../../../dashboard/src/v2/pages/stats/components/StatsShared.js", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    SignalMetricCard: ({ label }: { label: string }) => <div data-testid={`signal-card-${label}`}>{label}</div>,
  };
});

describe("StatsTopCardsGrid Providers Mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  const baseProps: any = {
    stats: {
      providers: [
        {
          id: "openai",
          label: "OpenAI",
          usage: { totalTokens: 1000, activeTimeMs: 100, invocationCount: 10 },
        },
        {
          id: "anthropic",
          label: "Anthropic",
          usage: { totalTokens: 2000, activeTimeMs: 200, invocationCount: 20 },
        },
      ],
      chartSeries: [],
      buckets: [],
    },
    usage: {
      totalTokens: 1000,
      activeTimeMs: 1000,
      wallTimeMs: 1000,
      reportedInvocationCount: 1,
      estimatedInvocationCount: 0,
      invocationCount: 1,
      unavailableInvocationCount: 0,
      unsupportedInvocationCount: 0,
    },
    tokenSeries: [],
    activeTimeSeries: [],
    wallTimeSeries: [],
    completionConfidence: "High",
  };

  it("renders ProviderUsageCards when visualMode is providers", () => {
    render(<StatsTopCardsGrid {...baseProps} visualMode="providers" />);

    expect(screen.getByTestId("signal-card-Anthropic")).toBeInTheDocument();
    expect(screen.getByTestId("signal-card-OpenAI")).toBeInTheDocument();
  });

  it("falls back to standard usage cards when visualMode is trend", () => {
    render(<StatsTopCardsGrid {...baseProps} visualMode="trend" />);

    expect(screen.queryByTestId("signal-card-Anthropic")).not.toBeInTheDocument();

    // It should render standard signal metric cards
    expect(screen.getByTestId("signal-card-Total Tokens")).toBeInTheDocument();
    expect(screen.getByTestId("signal-card-Active AI Time")).toBeInTheDocument();
  });
});
