import type { PrUsageGroup } from "../../../repositories/execution/execution-pr-usage-query.js";
import type { PrUsageStats } from "./pr-description-composer.js";

export type PrBillingMode = "billed" | "subscription";

export interface PrBillingModeProviderConfig {
  authType?: "apiKey" | "localAuth" | "dashboardAuth";
  mountAuth?: boolean;
}

/**
 * Mirrors the exact fallback chain the Settings UI uses to derive a provider's auth mode
 * (dashboard/src/v2/components/settings/ProviderInstanceCard.tsx):
 * `authType || (mountAuth ? "localAuth" : "apiKey")`. "localAuth"/"dashboardAuth" both mean the
 * CLI ran under a flat-fee login (Claude Pro/Max, ChatGPT plan, etc.) rather than a metered API key.
 * Jules is always a hosted subscription product with no per-token billing.
 */
export function classifyProviderBilling(
  provider: string | null | undefined,
  providerConfig: PrBillingModeProviderConfig | null | undefined,
): PrBillingMode {
  if (provider === "jules") return "subscription";

  const authType = providerConfig?.authType || (providerConfig?.mountAuth ? "localAuth" : "apiKey");
  return authType === "apiKey" ? "billed" : "subscription";
}

/**
 * Folds per-(provider, model) usage groups into a single PrUsageStats, splitting each group's
 * contribution into `billedInvocationCount`/`costUsd` (metered API usage) vs.
 * `subscriptionInvocationCount` (flat-fee login, or Jules) so the composer never shows a
 * misleading dollar figure for usage that wasn't actually metered.
 */
export function foldUsageGroups(
  groups: PrUsageGroup[],
  providerConfigs: Record<string, PrBillingModeProviderConfig | undefined>,
): PrUsageStats {
  const stats: PrUsageStats = {
    invocationCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    toolCallCount: 0,
    activeTimeMs: 0,
    costUsd: null,
    billedInvocationCount: 0,
    subscriptionInvocationCount: 0,
  };

  let billedCost = 0;
  let hasBilled = false;

  for (const group of groups) {
    stats.invocationCount += group.usage.invocationCount;
    stats.inputTokens += group.usage.inputTokens;
    stats.cachedInputTokens += group.usage.cachedInputTokens;
    stats.outputTokens += group.usage.outputTokens;
    stats.totalTokens += group.usage.totalTokens;
    stats.toolCallCount += group.usage.toolCallCount ?? 0;
    stats.activeTimeMs += group.usage.activeTimeMs;

    const mode = classifyProviderBilling(group.provider, providerConfigs[group.provider]);
    if (mode === "billed") {
      stats.billedInvocationCount += group.usage.invocationCount;
      billedCost += group.usage.totalCostUsd;
      hasBilled = true;
    } else {
      stats.subscriptionInvocationCount += group.usage.invocationCount;
    }
  }

  stats.costUsd = hasBilled ? billedCost : null;
  return stats;
}
