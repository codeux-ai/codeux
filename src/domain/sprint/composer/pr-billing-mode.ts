import type { PrUsageGroup } from "../../../repositories/execution/execution-pr-usage-query.js";
import type { PrUsageStats } from "./pr-description-composer.js";

export type PrBillingMode = "billed" | "subscription";

export interface PrBillingModeProviderConfig {
  provider?: string;
  model?: string;
  customModel?: string;
  qwenModelId?: string;
  openCodeModelId?: string;
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

function normalized(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function configProviderMatches(
  provider: string,
  configId: string,
  config: PrBillingModeProviderConfig | undefined,
): boolean {
  return normalized(config?.provider) === normalized(provider) || normalized(configId) === normalized(provider);
}

function configModelCandidates(config: PrBillingModeProviderConfig): string[] {
  return [
    config.model,
    config.customModel,
    config.qwenModelId,
    config.openCodeModelId,
  ].flatMap((value) => {
    const candidate = normalized(value);
    return candidate ? [candidate] : [];
  });
}

function hasProviderConfig(
  entry: [string, PrBillingModeProviderConfig | undefined],
): entry is [string, PrBillingModeProviderConfig] {
  return Boolean(entry[1]);
}

function classifyUsageGroupBilling(
  group: PrUsageGroup,
  providerConfigs: Record<string, PrBillingModeProviderConfig | undefined>,
): PrBillingMode {
  if (group.provider === "jules") return "subscription";

  const groupModel = normalized(group.model);
  if (groupModel) {
    const modelMatches = Object.entries(providerConfigs)
      .filter(hasProviderConfig)
      .filter(([configId, config]) => configProviderMatches(group.provider, configId, config))
      .filter(([, config]) => configModelCandidates(config).includes(groupModel));

    if (modelMatches.length > 0) {
      return modelMatches.some(([configId, config]) => classifyProviderBilling(config?.provider || configId, config) === "billed")
        ? "billed"
        : "subscription";
    }
  }

  return classifyProviderBilling(group.provider, providerConfigs[group.provider]);
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
    includedCostUsd: null,
    billedInvocationCount: 0,
    subscriptionInvocationCount: 0,
  };

  let billedCost = 0;
  let hasBilled = false;
  let includedCost = 0;
  let hasIncluded = false;

  for (const group of groups) {
    stats.invocationCount += group.usage.invocationCount;
    stats.inputTokens += group.usage.inputTokens;
    stats.cachedInputTokens += group.usage.cachedInputTokens;
    stats.outputTokens += group.usage.outputTokens;
    stats.totalTokens += group.usage.totalTokens;
    stats.toolCallCount += group.usage.toolCallCount ?? 0;
    stats.activeTimeMs += group.usage.activeTimeMs;

    const mode = classifyUsageGroupBilling(group, providerConfigs);
    if (mode === "billed") {
      stats.billedInvocationCount += group.usage.invocationCount;
      billedCost += group.usage.totalCostUsd;
      hasBilled = true;
    } else {
      stats.subscriptionInvocationCount += group.usage.invocationCount;
      // Reference-priced at the same catalog rate as billed usage, for comparison only —
      // subscription/flat-fee usage was not actually charged per token.
      includedCost += group.usage.totalCostUsd;
      hasIncluded = true;
    }
  }

  stats.costUsd = hasBilled ? billedCost : null;
  stats.includedCostUsd = hasIncluded ? includedCost : null;
  return stats;
}
