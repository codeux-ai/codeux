import { describe, it, expect } from "vitest";
import { aggregateTopProviders } from "../../../dashboard/src/v2/lib/stats/provider-aggregation.js";
import type { ProjectExecutionStatsSnapshot, ExecutionStatsEntitySummary } from "../../../src/contracts/app-types.js";

function createProvider(
  id: string,
  totalTokens: number,
  activeTimeMs: number
): ExecutionStatsEntitySummary {
  return {
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    secondaryLabel: null,
    status: null,
    purpose: null,
    provider: id,
    usage: {
      totalTokens,
      activeTimeMs,
      invocationCount: 1,
      wallTimeMs: 100,
      inputTokens: totalTokens / 2,
      cachedInputTokens: 0,
      outputTokens: totalTokens / 2,
      reasoningOutputTokens: 0,
      reportedInvocationCount: 1,
      estimatedInvocationCount: 0,
      unavailableInvocationCount: 0,
      unsupportedInvocationCount: 0,
    },
    lastActivityAt: null,
    buckets: [],
    sprints: [],
    tasks: [],
    providers: [],
    purposes: [],
    tokenSources: [],
    chartSeries: [],
  };
}

describe("aggregateTopProviders", () => {
  it("returns empty array for missing or empty stats", () => {
    expect(aggregateTopProviders(null)).toEqual([]);
    expect(aggregateTopProviders({ providers: [] } as any)).toEqual([]);
  });

  it("selects top 4 providers by usage and falls back to empty series if chartSeries missing", () => {
    const stats: Partial<ProjectExecutionStatsSnapshot> = {
      providers: [
        createProvider("p1", 100, 10),
        createProvider("p2", 200, 20),
        createProvider("p3", 300, 30),
        createProvider("p4", 400, 40),
        createProvider("p5", 50, 5),
      ],
      chartSeries: [],
      buckets: [{} as any, {} as any],
    };

    const result = aggregateTopProviders(stats as any);

    expect(result).toHaveLength(4);
    expect(result[0].id).toBe("p4");
    expect(result[1].id).toBe("p3");
    expect(result[2].id).toBe("p2");
    expect(result[3].id).toBe("p1");
    expect(result[0].dailySeries).toEqual([0, 0]);
  });

  it("resolves ties deterministically using alphabetical", () => {
    const stats: Partial<ProjectExecutionStatsSnapshot> = {
      providers: [
        createProvider("a", 100, 10),
        createProvider("b", 100, 20),
        createProvider("c", 100, 10),
      ],
      chartSeries: [],
      buckets: [],
    };

    const result = aggregateTopProviders(stats as any);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("b");
    expect(result[2].id).toBe("c");
  });

  it("uses provided chartSeries for the provider", () => {
    const stats: Partial<ProjectExecutionStatsSnapshot> = {
      providers: [createProvider("openai", 1000, 500)],
      chartSeries: [
        {
          id: "openai",
          grouping: "provider",
          label: "OpenAI",
          defaultEnabled: true,
          data: [1, 2, 3, 4],
        },
      ],
      buckets: [],
    };

    const result = aggregateTopProviders(stats as any);
    expect(result).toHaveLength(1);
    expect(result[0].dailySeries).toEqual([1, 2, 3, 4]);
  });
});
