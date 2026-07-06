import { describe, expect, it } from "vitest";
import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageBucketSummary,
  ExecutionUsageTotals,
  ProjectExecutionStatsSnapshot,
} from "../../../dashboard/src/v2/types.js";
import { deriveStatsPageViewModel } from "../../../dashboard/src/v2/pages/stats/stats-page-view-model.js";

const usage = (overrides: Partial<ExecutionUsageTotals> = {}): ExecutionUsageTotals => ({
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
  ...overrides,
});

const entity = (
  id: string,
  label: string,
  entityUsage: ExecutionUsageTotals,
): ExecutionStatsEntitySummary => ({
  id,
  label,
  secondaryLabel: null,
  status: null,
  purpose: null,
  provider: null,
  usage: entityUsage,
  lastActivityAt: null,
});

const bucket = (
  label: string,
  bucketUsage: ExecutionUsageTotals,
): ExecutionUsageBucketSummary => ({
  bucketStart: label,
  bucketEnd: label,
  label,
  usage: bucketUsage,
});

const statsSnapshot = (
  overrides: Partial<ProjectExecutionStatsSnapshot> = {},
): ProjectExecutionStatsSnapshot => {
  const totals = usage({
    invocationCount: 3,
    activeTimeMs: 4000,
    wallTimeMs: 6000,
    inputTokens: 60,
    cachedInputTokens: 10,
    outputTokens: 40,
    reasoningOutputTokens: 5,
    totalTokens: 115,
    reportedInvocationCount: 3,
  });

  return {
    projectId: "project-1",
    projectName: "Project",
    window: "7d",
    query: { window: "7d" },
    range: {
      window: "7d",
      label: "Last 7 Days",
      resolution: "day",
      resolutionLabel: "daily",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-07T23:59:59.999Z",
      bucketCount: 7,
      isCustom: false,
    },
    generatedAt: "2026-01-07T23:59:59.999Z",
    usage: totals,
    git: {
      totals: {
        insertions: 0,
        deletions: 0,
        filesChanged: 0,
        prCount: 0,
        mergedCount: 0,
        mergeConflictCount: 0,
      },
      buckets: [],
      tasks: [],
      sprints: [],
    },
    activeSprint: null,
    buckets: [
      bucket("B1", usage({ totalTokens: 25, activeTimeMs: 1000, wallTimeMs: 2000 })),
      bucket("B2", usage({ totalTokens: 90, activeTimeMs: 3000, wallTimeMs: 4000 })),
    ],
    sprints: [],
    tasks: [],
    providers: [
      entity("provider-a", "Provider A", usage({ totalTokens: 80 })),
      entity("provider-b", "Provider B", usage({ totalTokens: 35 })),
    ],
    purposes: [entity("planning", "Planning", usage({ totalTokens: 20 }))],
    models: [],
    statusCounts: {
      completed: 0,
      failed: 0,
      cancelled: 0,
      running: 0,
      paused: 0,
    },
    duration: {
      sampleCount: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
    },
    tokenSources: [{ source: "reported", count: 3 }],
    chartSeries: [],
    ...overrides,
  };
};

describe("deriveStatsPageViewModel", () => {
  it("returns empty telemetry defaults for null stats", () => {
    const viewModel = deriveStatsPageViewModel(null);

    expect(viewModel.usage.invocationCount).toBe(0);
    expect(viewModel.tokenSeries).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(viewModel.activeTimeSeries).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(viewModel.wallTimeSeries).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(viewModel.planningUsage).toBeNull();
    expect(viewModel.providerSegments).toEqual([]);
    expect(viewModel.sourceSegments).toEqual([]);
    expect(viewModel.tokenSegments).toEqual([]);
    expect(viewModel.completionConfidence).toBe("No telemetry");
  });

  it("derives reported-only usage view data", () => {
    const viewModel = deriveStatsPageViewModel(statsSnapshot());

    expect(viewModel.usage.totalTokens).toBe(115);
    expect(viewModel.tokenSeries).toEqual([25, 90]);
    expect(viewModel.activeTimeSeries).toEqual([1, 3]);
    expect(viewModel.wallTimeSeries).toEqual([2, 4]);
    expect(viewModel.planningUsage?.id).toBe("planning");
    expect(viewModel.providerSegments.map((segment) => [segment.label, segment.value])).toEqual([
      ["Provider A", 80],
      ["Provider B", 35],
    ]);
    expect(viewModel.sourceSegments.map((segment) => [segment.label, segment.value])).toEqual([["reported", 3]]);
    expect(viewModel.tokenSegments.map((segment) => [segment.label, segment.value])).toEqual([
      ["Input", 60],
      ["Cached", 10],
      ["Output", 40],
      ["Reasoning", 5],
    ]);
    expect(viewModel.completionConfidence).toBe("Provider reported");
  });

  it("derives mixed reported plus estimated usage confidence", () => {
    const stats = statsSnapshot({
      usage: usage({
        invocationCount: 5,
        reportedInvocationCount: 3,
        estimatedInvocationCount: 2,
        totalTokens: 40,
      }),
      tokenSources: [
        { source: "reported", count: 3 },
        { source: "estimated", count: 2 },
      ],
    });

    const viewModel = deriveStatsPageViewModel(stats);

    expect(viewModel.completionConfidence).toBe("Mixed reported + fallback");
    expect(viewModel.sourceSegments.map((segment) => [segment.label, segment.value])).toEqual([
      ["reported", 3],
      ["estimated", 2],
    ]);
  });

  it("derives estimated-only usage confidence", () => {
    const viewModel = deriveStatsPageViewModel(statsSnapshot({
      usage: usage({
        invocationCount: 4,
        estimatedInvocationCount: 4,
        totalTokens: 40,
      }),
      tokenSources: [{ source: "estimated", count: 4 }],
    }));

    expect(viewModel.completionConfidence).toBe("Estimated fallback");
    expect(viewModel.sourceSegments.map((segment) => [segment.label, segment.value])).toEqual([["estimated", 4]]);
  });

  it("pads empty bucket series while preserving empty segments", () => {
    const viewModel = deriveStatsPageViewModel(statsSnapshot({
      buckets: [],
      providers: [],
      purposes: [],
      tokenSources: [],
      usage: usage({ invocationCount: 2, unsupportedInvocationCount: 2 }),
    }));

    expect(viewModel.tokenSeries).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(viewModel.activeTimeSeries).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(viewModel.wallTimeSeries).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(viewModel.providerSegments).toEqual([]);
    expect(viewModel.sourceSegments).toEqual([]);
    expect(viewModel.tokenSegments).toEqual([]);
    expect(viewModel.completionConfidence).toBe("Unavailable");
  });
});
