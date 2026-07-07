import { describe, expect, it } from "vitest";
import type { HeaderTokenThroughputSnapshot, HeaderTokenThroughputTotals } from "../../../dashboard/src/v2/types.js";
import {
  buildHeaderTokenThroughputViewModel,
  formatCompactTokenNumber,
  formatCompactTokenTotal,
  formatTokensPerMinute,
  normalizeHeaderTokenThroughputTotals,
} from "../../../dashboard/src/v2/lib/header-token-throughput.js";

const makeTotals = (overrides: Partial<HeaderTokenThroughputTotals> = {}): HeaderTokenThroughputTotals => ({
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  invocationCount: 0,
  activeTimeMs: 0,
  tokensPerMinute: 0,
  ...overrides,
});

const makeSnapshot = (overrides: Partial<HeaderTokenThroughputSnapshot> = {}): HeaderTokenThroughputSnapshot => ({
  generatedAt: "2026-07-07T12:00:00.000Z",
  window: "1h",
  range: {
    window: "1h",
    label: "Last 1 hour",
    resolution: "5min",
    resolutionLabel: "5-minute telemetry buckets",
    from: "2026-07-07T11:00:00.000Z",
    to: "2026-07-07T12:00:00.000Z",
    bucketCount: 12,
    isCustom: false,
  },
  app: makeTotals(),
  project: null,
  ...overrides,
});

describe("header token throughput helpers", () => {
  it("formats token rates and totals into compact stable labels", () => {
    expect(formatTokensPerMinute(1250)).toBe("1.3K/min");
    expect(formatCompactTokenTotal(987654)).toBe("988K tokens");
    expect(formatCompactTokenTotal(1)).toBe("1 token");
    expect(formatCompactTokenNumber(Number.MAX_SAFE_INTEGER)).toBe("999B+");
  });

  it("normalizes invalid numeric input without NaN or Infinity labels", () => {
    const totals = normalizeHeaderTokenThroughputTotals({
      totalTokens: Number.NaN,
      inputTokens: Number.POSITIVE_INFINITY,
      cachedInputTokens: -10,
      outputTokens: 200,
      reasoningTokens: undefined,
      invocationCount: Number.NEGATIVE_INFINITY,
      activeTimeMs: 1000,
      tokensPerMinute: Number.NaN,
    });

    expect(totals).toEqual({
      totalTokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 200,
      reasoningTokens: 0,
      invocationCount: 0,
      activeTimeMs: 1000,
      tokensPerMinute: 0,
    });
    expect(formatTokensPerMinute(Number.POSITIVE_INFINITY)).toBe("0/min");
    expect(formatCompactTokenTotal(Number.NaN)).toBe("0 tokens");
  });

  it("builds app and project throughput view models", () => {
    const snapshot = makeSnapshot({
      app: makeTotals({ totalTokens: 32000, invocationCount: 8, tokensPerMinute: 1600 }),
      project: {
        projectId: "project-1",
        projectName: "Selected Project",
        ...makeTotals({ totalTokens: 12000, invocationCount: 3, tokensPerMinute: 750 }),
      },
    });

    const view = buildHeaderTokenThroughputViewModel({
      snapshot,
      projectId: "project-1",
      window: "1h",
      loading: false,
      error: null,
    });

    expect(view.app.rateLabel).toBe("1.6K tok/min");
    expect(view.app.totalLabel).toBe("32K tokens");
    expect(view.project.label).toBe("Selected Project");
    expect(view.project.rateLabel).toBe("750 tok/min");
    expect(view.statusLabel).toBe("1.6K tok/min app, 750 tok/min project");
  });

  it("returns stable empty, loading, and error copy", () => {
    const emptyView = buildHeaderTokenThroughputViewModel({
      snapshot: makeSnapshot(),
      projectId: "project-1",
      window: "1h",
      loading: false,
      error: null,
    });
    expect(emptyView.statusLabel).toBe("No token telemetry in this window");
    expect(emptyView.project.detailLabel).toBe("No project tokens in this window");

    const loadingView = buildHeaderTokenThroughputViewModel({
      snapshot: null,
      projectId: null,
      window: "24h",
      loading: true,
      error: null,
    });
    expect(loadingView.statusLabel).toBe("Loading token telemetry");
    expect(loadingView.project.detailLabel).toBe("Select a project for local throughput");

    const errorView = buildHeaderTokenThroughputViewModel({
      snapshot: null,
      projectId: "project-1",
      window: "7d",
      loading: false,
      error: "Request failed",
    });
    expect(errorView.statusLabel).toBe("Token telemetry unavailable");
    expect(JSON.stringify(errorView)).not.toMatch(/NaN|Infinity/);
  });
});
