import { describe, expect, it } from "vitest";
import { classifyProviderBilling, foldUsageGroups } from "../../../../../src/domain/sprint/composer/pr-billing-mode.js";
import type { PrUsageGroup } from "../../../../../src/repositories/execution/execution-pr-usage-query.js";
import type { ExecutionUsageTotals } from "../../../../../src/contracts/app-types.js";

function usage(overrides: Partial<ExecutionUsageTotals> = {}): ExecutionUsageTotals {
  return {
    invocationCount: 1,
    activeTimeMs: 1000,
    wallTimeMs: 0,
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 50,
    reasoningOutputTokens: 0,
    totalTokens: 150,
    inputCostUsd: 0,
    outputCostUsd: 0,
    cachedInputCostUsd: 0,
    totalCostUsd: 0,
    toolCallCount: 3,
    reportedInvocationCount: 1,
    estimatedInvocationCount: 0,
    unsupportedInvocationCount: 0,
    unavailableInvocationCount: 0,
    ...overrides,
  };
}

describe("classifyProviderBilling", () => {
  it("always classifies jules as subscription, regardless of settings", () => {
    expect(classifyProviderBilling("jules", { authType: "apiKey" })).toBe("subscription");
    expect(classifyProviderBilling("jules", undefined)).toBe("subscription");
  });

  it("classifies apiKey authType as billed", () => {
    expect(classifyProviderBilling("claude-code", { authType: "apiKey" })).toBe("billed");
  });

  it("classifies localAuth and dashboardAuth authType as subscription", () => {
    expect(classifyProviderBilling("claude-code", { authType: "localAuth" })).toBe("subscription");
    expect(classifyProviderBilling("codex", { authType: "dashboardAuth" })).toBe("subscription");
  });

  it("falls back to mountAuth=true meaning subscription when authType is absent", () => {
    expect(classifyProviderBilling("claude-code", { mountAuth: true })).toBe("subscription");
  });

  it("falls back to mountAuth=false meaning billed when authType is absent", () => {
    expect(classifyProviderBilling("claude-code", { mountAuth: false })).toBe("billed");
  });

  it("defaults to billed when no config is present at all", () => {
    expect(classifyProviderBilling("claude-code", undefined)).toBe("billed");
  });
});

describe("foldUsageGroups", () => {
  it("sums token counts across groups regardless of billing mode", () => {
    const groups: PrUsageGroup[] = [
      { provider: "claude-code", model: "claude-opus-4-6", usage: usage({ totalTokens: 150, totalCostUsd: 1.0 }) },
      { provider: "codex", model: "gpt-6-codex", usage: usage({ totalTokens: 200, totalCostUsd: 2.0 }) },
    ];
    const folded = foldUsageGroups(groups, {
      "claude-code": { authType: "apiKey" },
      codex: { authType: "apiKey" },
    });
    expect(folded.totalTokens).toBe(350);
    expect(folded.invocationCount).toBe(2);
  });

  it("splits billed vs subscription invocation counts and only sums cost for billed groups", () => {
    const groups: PrUsageGroup[] = [
      { provider: "claude-code", model: "claude-opus-4-6", usage: usage({ invocationCount: 3, totalCostUsd: 1.5 }) },
      { provider: "codex", model: "gpt-6-codex", usage: usage({ invocationCount: 2, totalCostUsd: 0.8 }) },
    ];
    const folded = foldUsageGroups(groups, {
      "claude-code": { authType: "localAuth" },
      codex: { authType: "apiKey" },
    });
    expect(folded.subscriptionInvocationCount).toBe(3);
    expect(folded.billedInvocationCount).toBe(2);
    expect(folded.costUsd).toBe(0.8);
  });

  it("returns costUsd null when nothing in the fold was billed", () => {
    const groups: PrUsageGroup[] = [
      { provider: "jules", model: null, usage: usage({ invocationCount: 4, totalCostUsd: 0 }) },
    ];
    const folded = foldUsageGroups(groups, {});
    expect(folded.costUsd).toBeNull();
    expect(folded.billedInvocationCount).toBe(0);
    expect(folded.subscriptionInvocationCount).toBe(4);
  });

  it("returns an empty-but-defined stats object for an empty group list", () => {
    const folded = foldUsageGroups([], {});
    expect(folded.invocationCount).toBe(0);
    expect(folded.costUsd).toBeNull();
  });
});
