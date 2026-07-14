import { describe, expect, it } from "vitest";
import type {
  ExecutionCostCoverage,
  ExecutionModelStatsSummary,
  ExecutionStatsEntitySummary,
  ExecutionUsageTotals,
  ProjectExecutionStatsSnapshot,
} from "../../../../types.js";
import {
  deriveCostAnalyticsViewModel,
  formatAdaptiveCurrency,
} from "../cost-insights.js";

const ZERO_COVERAGE: ExecutionCostCoverage = {
  configuredPricingInvocationCount: 0,
  providerReportedCostInvocationCount: 0,
  unpricedInvocationCount: 0,
  providerReportedCostUsd: 0,
};

function usage(overrides: Partial<ExecutionUsageTotals> = {}): ExecutionUsageTotals {
  return {
    invocationCount: 0,
    activeTimeMs: 0,
    wallTimeMs: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    inputCostUsd: 0,
    outputCostUsd: 0,
    cachedInputCostUsd: 0,
    totalCostUsd: 0,
    reportedInvocationCount: 0,
    estimatedInvocationCount: 0,
    unavailableInvocationCount: 0,
    unsupportedInvocationCount: 0,
    costCoverage: ZERO_COVERAGE,
    ...overrides,
  };
}

function entity(id: string, overrides: Partial<ExecutionStatsEntitySummary> = {}): ExecutionStatsEntitySummary {
  return {
    id,
    label: id,
    secondaryLabel: null,
    status: "completed",
    purpose: "task_coding",
    provider: "codex",
    usage: usage(),
    lastActivityAt: "2026-07-14T10:00:00.000Z",
    ...overrides,
  };
}

function model(id: string, modelUsage: ExecutionUsageTotals): ExecutionModelStatsSummary {
  return {
    id,
    provider: id.split("::")[0] ?? "unknown",
    model: id.split("::")[1] ?? null,
    label: id,
    usage: modelUsage,
    statusCounts: { completed: modelUsage.invocationCount, failed: 0, cancelled: 0, running: 0, paused: 0 },
    successRate: 1,
    duration: { sampleCount: modelUsage.invocationCount, avgMs: 1, p50Ms: 1, p95Ms: 1, maxMs: 1 },
    lastActivityAt: "2026-07-14T10:00:00.000Z",
  };
}

function snapshot(overrides: Partial<ProjectExecutionStatsSnapshot> = {}): ProjectExecutionStatsSnapshot {
  return {
    projectId: "project-test",
    projectName: "Test project",
    window: "7d",
    query: { window: "7d" },
    range: {
      window: "7d",
      label: "Last 7 days",
      resolution: "day",
      resolutionLabel: "Daily",
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-07-14T00:00:00.000Z",
      bucketCount: 0,
      isCustom: false,
    },
    generatedAt: "2026-07-14T10:00:00.000Z",
    usage: usage(),
    costAnalytics: { sprints: [] },
    git: {
      totals: { insertions: 0, deletions: 0, filesChanged: 0, prCount: 0, mergedCount: 0, mergeConflictCount: 0 },
      buckets: [],
      tasks: [],
      sprints: [],
    },
    activeSprint: null,
    buckets: [],
    sprints: [],
    tasks: [],
    providers: [],
    purposes: [],
    models: [],
    statusCounts: { completed: 0, failed: 0, cancelled: 0, running: 0, paused: 0 },
    duration: { sampleCount: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
    tokenSources: [],
    chartSeries: [],
    ...overrides,
  };
}

function sumSpend(viewModel: ReturnType<typeof deriveCostAnalyticsViewModel>): number {
  return viewModel.spendSegments.reduce((sum, segment) => sum + (segment.amount.usd ?? 0), 0);
}

function sumTokens(viewModel: ReturnType<typeof deriveCostAnalyticsViewModel>): number {
  return viewModel.tokenSegments.reduce((sum, segment) => sum + segment.tokens, 0);
}

describe("deriveCostAnalyticsViewModel", () => {
  it("derives fully priced totals, finite rates, segments, and detail rows", () => {
    const priced = usage({
      invocationCount: 2,
      inputTokens: 1_000,
      cachedInputTokens: 500,
      outputTokens: 400,
      reasoningOutputTokens: 100,
      totalTokens: 1_900,
      inputCostUsd: 0.006,
      cachedInputCostUsd: 0.001,
      outputCostUsd: 0.003,
      totalCostUsd: 0.01,
      costCoverage: { ...ZERO_COVERAGE, configuredPricingInvocationCount: 2 },
    });
    const task = entity("task-1", {
      label: "Implement analytics",
      secondaryLabel: "T01",
      usage: priced,
    });
    const sprint = entity("sprint-1", { label: "Cost sprint", usage: priced });
    const stats = snapshot({
      usage: priced,
      tasks: [task],
      sprints: [entity("run-1", { usage: priced })],
      costAnalytics: { sprints: [sprint] },
      models: [model("codex::gpt-5", priced)],
      purposes: [entity("task_coding", { usage: priced })],
      buckets: [{
        bucketStart: "2026-07-14T00:00:00.000Z",
        bucketEnd: "2026-07-15T00:00:00.000Z",
        label: "Jul 14",
        usage: priced,
      }],
    });

    const result = deriveCostAnalyticsViewModel(stats);

    expect(result.totalSpend).toMatchObject({ usd: 0.01, provenance: { state: "complete" } });
    expect(result.costPerInvocation.usd).toBeCloseTo(0.005);
    expect(result.costPerMillionTokens.usd).toBeCloseTo(0.01 / 1_900 * 1_000_000);
    expect(result.averageCostPerTask).toMatchObject({ usd: 0.01, entityCount: 1 });
    expect(result.averageCostPerSprint).toMatchObject({ usd: 0.01, entityCount: 1 });
    expect(result.tasks[0]).toMatchObject({
      id: "task-1",
      status: "completed",
      secondaryLabel: "T01",
      recency: "Jul 14, 10:00 AM",
      spendShare: 1,
    });
    expect(result.sprints.map((row) => row.id)).toEqual(["sprint-1"]);
    expect(result.costOverTime).toHaveLength(1);
    expect(result.models[0]?.costPerCall.usd).toBeCloseTo(0.005);
    expect(sumSpend(result)).toBeCloseTo(result.totalSpend.usd ?? 0);
    expect(sumTokens(result)).toBeCloseTo(result.tokens);
  });

  it("keeps configured and provider-reported spend distinct while treating both as covered", () => {
    const mixed = usage({
      invocationCount: 2,
      totalTokens: 200,
      inputTokens: 100,
      outputTokens: 100,
      inputCostUsd: 0.1,
      totalCostUsd: 0.3,
      costCoverage: {
        configuredPricingInvocationCount: 1,
        providerReportedCostInvocationCount: 1,
        unpricedInvocationCount: 0,
        providerReportedCostUsd: 0.2,
      },
    });

    const result = deriveCostAnalyticsViewModel(snapshot({ usage: mixed }));

    expect(result.totalSpend.provenance.state).toBe("complete");
    expect(result.spendSegments.find((segment) => segment.id === "input")?.amount.usd).toBeCloseTo(0.1);
    expect(result.spendSegments.find((segment) => segment.id === "provider_reported")?.amount.usd).toBeCloseTo(0.2);
    expect(sumSpend(result)).toBeCloseTo(0.3);
  });

  it("carries partial coverage through totals, averages, buckets, rows, and formatting", () => {
    const partial = usage({
      invocationCount: 2,
      totalTokens: 100,
      inputTokens: 100,
      inputCostUsd: 0.25,
      totalCostUsd: 0.25,
      costCoverage: {
        configuredPricingInvocationCount: 1,
        providerReportedCostInvocationCount: 0,
        unpricedInvocationCount: 1,
        providerReportedCostUsd: 0,
      },
    });
    const result = deriveCostAnalyticsViewModel(snapshot({
      usage: partial,
      tasks: [entity("task-partial", { usage: partial })],
      costAnalytics: { sprints: [entity("sprint-partial", { usage: partial })] },
      models: [model("codex::partial", partial)],
      purposes: [entity("testing", { usage: partial })],
      buckets: [{ bucketStart: "a", bucketEnd: "b", label: "A", usage: partial }],
    }));

    expect(result.totalSpend.provenance.state).toBe("partial");
    expect(result.averageCostPerTask.provenance.state).toBe("partial");
    expect(result.averageCostPerSprint.provenance.state).toBe("partial");
    expect(result.costOverTime[0]?.amount.provenance.state).toBe("partial");
    expect(result.models[0]?.costPerCall.provenance.state).toBe("partial");
    expect(result.tasks[0]?.amount.provenance.state).toBe("partial");
    expect(formatAdaptiveCurrency(result.totalSpend)).toBe("$0.25+");
  });

  it("renders entirely unpriced telemetry distinctly from proven zero", () => {
    const unpriced = usage({
      invocationCount: 3,
      totalTokens: 300,
      inputTokens: 300,
      costCoverage: { ...ZERO_COVERAGE, unpricedInvocationCount: 3 },
    });
    const result = deriveCostAnalyticsViewModel(snapshot({ usage: unpriced }));

    expect(result.totalSpend).toMatchObject({ usd: 0, provenance: { state: "unpriced" } });
    expect(formatAdaptiveCurrency(result.totalSpend)).toBe("Unpriced");
    expect(formatAdaptiveCurrency(result.totalSpend)).not.toBe("$0.00");
  });

  it("renders configured zero-price and provider-reported zero as proven zero cost", () => {
    const configuredFree = usage({
      invocationCount: 1,
      totalTokens: 100,
      inputTokens: 100,
      costCoverage: { ...ZERO_COVERAGE, configuredPricingInvocationCount: 1 },
    });
    const reportedFree = usage({
      invocationCount: 1,
      totalTokens: 100,
      outputTokens: 100,
      costCoverage: { ...ZERO_COVERAGE, providerReportedCostInvocationCount: 1 },
    });
    const result = deriveCostAnalyticsViewModel(snapshot({
      usage: configuredFree,
      tasks: [
        entity("free-configured", { usage: configuredFree }),
        entity("free-reported", { usage: reportedFree }),
      ],
    }));

    expect(formatAdaptiveCurrency(result.totalSpend)).toBe("$0.00");
    expect(result.averageCostPerTask).toMatchObject({ usd: 0, entityCount: 2 });
    expect(result.averageCostPerTask.provenance.state).toBe("complete");
    expect(formatAdaptiveCurrency(result.averageCostPerTask)).toBe("$0.00");
  });

  it("marks legacy telemetry without coverage as unknown instead of free", () => {
    const legacy = usage({ invocationCount: 1, totalTokens: 50, inputTokens: 50, costCoverage: undefined });
    const result = deriveCostAnalyticsViewModel(snapshot({ usage: legacy }));

    expect(result.totalSpend.provenance.state).toBe("unknown");
    expect(formatAdaptiveCurrency(result.totalSpend)).toBe("Coverage unknown");
  });

  it("preserves useful precision for tiny costs", () => {
    const tiny = usage({
      invocationCount: 1,
      totalTokens: 1,
      inputTokens: 1,
      inputCostUsd: 0.000004,
      totalCostUsd: 0.000004,
      costCoverage: { ...ZERO_COVERAGE, configuredPricingInvocationCount: 1 },
    });
    const result = deriveCostAnalyticsViewModel(snapshot({ usage: tiny }));

    expect(formatAdaptiveCurrency(result.totalSpend)).toBe("$0.000004");
  });

  it("returns finite unavailable rates and averages for an empty snapshot", () => {
    const result = deriveCostAnalyticsViewModel(snapshot());

    expect(result.totalSpend).toMatchObject({ usd: 0, provenance: { state: "unavailable" } });
    expect(result.costPerInvocation.usd).toBeNull();
    expect(result.costPerMillionTokens.usd).toBeNull();
    expect(result.averageCostPerTask).toMatchObject({ usd: null, entityCount: 0 });
    expect(result.averageCostPerSprint).toMatchObject({ usd: null, entityCount: 0 });
    expect(formatAdaptiveCurrency(result.totalSpend)).toBe("Unavailable");
    expect(result.spendSegments.every((segment) => Number.isFinite(segment.share))).toBe(true);
    expect(result.tokenSegments.every((segment) => Number.isFinite(segment.share))).toBe(true);
  });

  it("normalizes malformed numbers and reconciles every top-level segment", () => {
    const malformed = usage({
      invocationCount: Number.POSITIVE_INFINITY,
      inputTokens: -1,
      cachedInputTokens: Number.NaN,
      outputTokens: 20,
      reasoningOutputTokens: 50,
      totalTokens: 10,
      inputCostUsd: -2,
      outputCostUsd: Number.NaN,
      cachedInputCostUsd: 1,
      totalCostUsd: 0.5,
      costCoverage: {
        configuredPricingInvocationCount: -1,
        providerReportedCostInvocationCount: Number.POSITIVE_INFINITY,
        unpricedInvocationCount: Number.NaN,
        providerReportedCostUsd: Number.POSITIVE_INFINITY,
      },
    });
    const result = deriveCostAnalyticsViewModel(snapshot({ usage: malformed }));

    expect(result.calls).toBe(0);
    expect(result.tokens).toBe(10);
    expect(result.totalSpend.usd).toBe(0.5);
    expect(sumSpend(result)).toBeCloseTo(0.5);
    expect(sumTokens(result)).toBeCloseTo(10);
    expect(result.costPerInvocation.usd).toBeNull();
    expect(result.tokenSegments.every((segment) => Number.isFinite(segment.tokens) && segment.tokens >= 0)).toBe(true);
    expect(result.spendSegments.every((segment) => Number.isFinite(segment.amount.usd))).toBe(true);
  });

  it("uses canonical sprint rows for averages, falls back for legacy snapshots, and orders ties deterministically", () => {
    const tied = usage({
      invocationCount: 1,
      totalTokens: 100,
      inputTokens: 100,
      inputCostUsd: 1,
      totalCostUsd: 1,
      costCoverage: { ...ZERO_COVERAGE, configuredPricingInvocationCount: 1 },
    });
    const canonical = entity("canonical", { usage: usage({
      ...tied,
      invocationCount: 2,
      totalTokens: 200,
      inputTokens: 200,
      inputCostUsd: 2,
      totalCostUsd: 2,
      costCoverage: { ...ZERO_COVERAGE, configuredPricingInvocationCount: 2 },
    }) });
    const result = deriveCostAnalyticsViewModel(snapshot({
      usage: usage({
        ...canonical.usage,
      }),
      sprints: [entity("run-a", { usage: tied }), entity("run-b", { usage: tied })],
      costAnalytics: { sprints: [canonical] },
      models: [model("zeta::same", tied), model("alpha::same", tied)],
      purposes: [entity("zeta", { label: "Same", usage: tied }), entity("alpha", { label: "Same", usage: tied })],
    }));

    expect(result.averageCostPerSprint).toMatchObject({ usd: 2, entityCount: 1 });
    expect(result.sprints.map((row) => row.id)).toEqual(["canonical"]);
    expect(result.models.map((row) => row.id)).toEqual(["alpha::same", "zeta::same"]);
    expect(result.purposes.map((row) => row.id)).toEqual(["alpha", "zeta"]);

    const legacyStats = snapshot({ sprints: [entity("legacy-run", { usage: tied })] });
    delete legacyStats.costAnalytics;
    const legacyResult = deriveCostAnalyticsViewModel(legacyStats);
    expect(legacyResult.averageCostPerSprint).toMatchObject({ usd: 1, entityCount: 1 });
    expect(legacyResult.sprints.map((row) => row.id)).toEqual(["legacy-run"]);
  });
});
