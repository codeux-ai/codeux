import type { ModelPricingSettings, TokenPricing } from "../../../contracts/app-types.js";

const readNonNegativeNumber = (value: unknown): number => (
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
);

const readTokenPricing = (value: unknown): TokenPricing | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const pricing: TokenPricing = {
    inputTokens: readNonNegativeNumber(record.inputTokens),
    outputTokens: readNonNegativeNumber(record.outputTokens),
    cachedInputTokens: readNonNegativeNumber(record.cachedInputTokens),
  };
  // Mirrors the "only save if at least one price is set" semantics of the old per-provider
  // pricing modal — an all-zero override is equivalent to no override.
  return pricing.inputTokens > 0 || pricing.outputTokens > 0 || pricing.cachedInputTokens > 0
    ? pricing
    : null;
};

export function sanitizeModelPricing(value: unknown): ModelPricingSettings {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawOverrides = input.overrides && typeof input.overrides === "object"
    ? (input.overrides as Record<string, unknown>)
    : {};

  const overrides: Record<string, TokenPricing> = {};
  for (const [modelId, rawPricing] of Object.entries(rawOverrides)) {
    if (typeof modelId !== "string" || modelId.trim().length === 0) {
      continue;
    }
    const pricing = readTokenPricing(rawPricing);
    if (pricing) {
      overrides[modelId.trim()] = pricing;
    }
  }

  return { overrides };
}
