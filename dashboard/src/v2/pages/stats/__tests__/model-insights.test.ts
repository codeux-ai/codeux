import { describe, expect, it } from "vitest";
import type { ExecutionModelStatsSummary, ExecutionUsageTotals } from "../../../types.js";
import {
  buildModelHighlights,
  buildModelSegments,
  computeUsageEfficiency,
  formatSuccessRate,
  getSuccessTone,
} from "../model-insights.js";

function createUsage(overrides: Partial<ExecutionUsageTotals> = {}): ExecutionUsageTotals {
  return {
    invocationCount: 10,
    activeTimeMs: 600000,
    wallTimeMs: 0,
    inputTokens: 1000,
    cachedInputTokens: 1000,
    outputTokens: 500,
    reasoningOutputTokens: 100,
    totalTokens: 2600,
    inputCostUsd: 0,
    outputCostUsd: 0,
    cachedInputCostUsd: 0,
    totalCostUsd: 0,
    reportedInvocationCount: 10,
    estimatedInvocationCount: 0,
    unavailableInvocationCount: 0,
    unsupportedInvocationCount: 0,
    ...overrides,
  };
}

function createModel(overrides: Partial<ExecutionModelStatsSummary> = {}): ExecutionModelStatsSummary {
  return {
    id: "claude::claude-opus-4-8",
    provider: "claude",
    model: "claude-opus-4-8",
    label: "claude-opus-4-8",
    usage: createUsage(),
    statusCounts: { completed: 9, failed: 1, cancelled: 0, running: 0, paused: 0 },
    successRate: 0.9,
    duration: { sampleCount: 10, avgMs: 30000, p50Ms: 25000, p95Ms: 80000, maxMs: 90000 },
    lastActivityAt: "2026-06-09T10:00:00.000Z",
    ...overrides,
  };
}

describe("computeUsageEfficiency", () => {
  it("derives cache hit, tokens per call, velocity, and reasoning share", () => {
    const efficiency = computeUsageEfficiency(createUsage());

    expect(efficiency.cacheHitRate).toBeCloseTo(0.5);
    expect(efficiency.tokensPerCall).toBeCloseTo(260);
    expect(efficiency.outputTokensPerMinute).toBeCloseTo(50);
    expect(efficiency.reasoningShare).toBeCloseTo(100 / 600);
  });

  it("returns nulls when denominators are zero", () => {
    const efficiency = computeUsageEfficiency(createUsage({
      invocationCount: 0,
      activeTimeMs: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    }));

    expect(efficiency.cacheHitRate).toBeNull();
    expect(efficiency.tokensPerCall).toBeNull();
    expect(efficiency.outputTokensPerMinute).toBeNull();
    expect(efficiency.reasoningShare).toBeNull();
  });
});

describe("formatSuccessRate / getSuccessTone", () => {
  it("formats null as a dash and rates as percentages", () => {
    expect(formatSuccessRate(null)).toBe("—");
    expect(formatSuccessRate(1)).toBe("100%");
    expect(formatSuccessRate(0.9)).toBe("90%");
    expect(formatSuccessRate(0.999)).toBe("99.9%");
  });

  it("maps rates to tones", () => {
    expect(getSuccessTone(null)).toBe("neutral");
    expect(getSuccessTone(0.99)).toBe("strong");
    expect(getSuccessTone(0.85)).toBe("warn");
    expect(getSuccessTone(0.5)).toBe("critical");
  });
});

describe("buildModelHighlights", () => {
  it("selects busiest, fastest, most reliable, and best cache models", () => {
    const fastReliable = createModel({
      id: "gemini::gemini-3-pro",
      provider: "gemini",
      model: "gemini-3-pro",
      label: "gemini-3-pro",
      successRate: 1,
      statusCounts: { completed: 10, failed: 0, cancelled: 0, running: 0, paused: 0 },
      duration: { sampleCount: 10, avgMs: 9000, p50Ms: 8000, p95Ms: 20000, maxMs: 30000 },
      usage: createUsage({ totalTokens: 1200, cachedInputTokens: 0, inputTokens: 1000 }),
    });
    const busyCached = createModel();

    const highlights = buildModelHighlights([fastReliable, busyCached]);

    expect(highlights.busiest?.model.id).toBe(busyCached.id);
    expect(highlights.fastest?.model.id).toBe(fastReliable.id);
    expect(highlights.mostReliable?.model.id).toBe(fastReliable.id);
    expect(highlights.bestCache?.model.id).toBe(busyCached.id);
  });

  it("ignores low-volume models when higher-volume candidates exist", () => {
    const luckySingleCall = createModel({
      id: "codex::codex-mini",
      label: "codex-mini",
      usage: createUsage({ invocationCount: 1 }),
      successRate: 1,
      duration: { sampleCount: 1, avgMs: 100, p50Ms: 100, p95Ms: 100, maxMs: 100 },
    });
    const steady = createModel();

    const highlights = buildModelHighlights([luckySingleCall, steady]);

    expect(highlights.fastest?.model.id).toBe(steady.id);
    expect(highlights.mostReliable?.model.id).toBe(steady.id);
  });

  it("returns nulls for an empty model list", () => {
    const highlights = buildModelHighlights([]);
    expect(highlights.busiest).toBeNull();
    expect(highlights.fastest).toBeNull();
    expect(highlights.mostReliable).toBeNull();
    expect(highlights.bestCache).toBeNull();
  });
});

describe("buildModelSegments", () => {
  it("ranks models and groups overflow into an Other lane", () => {
    const models = Array.from({ length: 7 }, (_, index) => createModel({
      id: `provider::model-${index}`,
      label: `model-${index}`,
      usage: createUsage({ totalTokens: (index + 1) * 1000 }),
    }));

    const segments = buildModelSegments(models, 5);

    expect(segments).toHaveLength(6);
    expect(segments[0]!.label).toBe("model-6");
    expect(segments[5]!.label).toBe("Other models");
    expect(segments[5]!.value).toBe(1000 + 2000);
  });

  it("drops zero-volume segments", () => {
    const segments = buildModelSegments([createModel({ usage: createUsage({ totalTokens: 0 }) })]);
    expect(segments).toHaveLength(0);
  });
});
