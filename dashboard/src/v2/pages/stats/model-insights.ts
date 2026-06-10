import type {
  ExecutionModelStatsSummary,
  ExecutionUsageTotals,
  SegmentDefinition,
} from "../../types.js";

export interface ModelEfficiencyMetrics {
  cacheHitRate: number | null;
  tokensPerCall: number | null;
  outputTokensPerMinute: number | null;
  reasoningShare: number | null;
  outputInputRatio: number | null;
}

export interface ModelHighlight {
  model: ExecutionModelStatsSummary;
  value: string;
}

export interface ModelHighlights {
  busiest: ModelHighlight | null;
  fastest: ModelHighlight | null;
  mostReliable: ModelHighlight | null;
  bestCache: ModelHighlight | null;
}

export function computeUsageEfficiency(usage: ExecutionUsageTotals): ModelEfficiencyMetrics {
  const cacheDenominator = usage.inputTokens + usage.cachedInputTokens;
  const activeMinutes = usage.activeTimeMs / 60000;
  return {
    cacheHitRate: cacheDenominator > 0 ? usage.cachedInputTokens / cacheDenominator : null,
    tokensPerCall: usage.invocationCount > 0 ? usage.totalTokens / usage.invocationCount : null,
    outputTokensPerMinute: activeMinutes > 0 ? usage.outputTokens / activeMinutes : null,
    reasoningShare: usage.outputTokens + usage.reasoningOutputTokens > 0
      ? usage.reasoningOutputTokens / (usage.outputTokens + usage.reasoningOutputTokens)
      : null,
    outputInputRatio: cacheDenominator > 0 ? usage.outputTokens / cacheDenominator : null,
  };
}

export function formatSuccessRate(successRate: number | null): string {
  if (successRate === null) {
    return "—";
  }
  return `${(successRate * 100).toFixed(successRate >= 0.995 && successRate < 1 ? 1 : 0)}%`;
}

export function getSuccessTone(successRate: number | null): "strong" | "warn" | "critical" | "neutral" {
  if (successRate === null) {
    return "neutral";
  }
  if (successRate >= 0.95) {
    return "strong";
  }
  if (successRate >= 0.8) {
    return "warn";
  }
  return "critical";
}

const MIN_HIGHLIGHT_CALLS = 3;

export function buildModelHighlights(models: ExecutionModelStatsSummary[]): ModelHighlights {
  const eligible = models.filter((model) => model.usage.invocationCount >= MIN_HIGHLIGHT_CALLS);
  const pool = eligible.length > 0 ? eligible : models;

  const busiest = pool.length > 0
    ? pool.reduce((best, model) => (model.usage.totalTokens > best.usage.totalTokens ? model : best))
    : null;

  const withDuration = pool.filter((model) => model.duration.sampleCount > 0 && model.duration.p50Ms > 0);
  const fastest = withDuration.length > 0
    ? withDuration.reduce((best, model) => (model.duration.p50Ms < best.duration.p50Ms ? model : best))
    : null;

  const withSuccess = pool.filter((model) => model.successRate !== null);
  const mostReliable = withSuccess.length > 0
    ? withSuccess.reduce((best, model) => ((model.successRate ?? 0) > (best.successRate ?? 0) ? model : best))
    : null;

  const withCache = pool.filter((model) => {
    const efficiency = computeUsageEfficiency(model.usage);
    return efficiency.cacheHitRate !== null && efficiency.cacheHitRate > 0;
  });
  const bestCache = withCache.length > 0
    ? withCache.reduce((best, model) => {
      const bestRate = computeUsageEfficiency(best.usage).cacheHitRate ?? 0;
      const rate = computeUsageEfficiency(model.usage).cacheHitRate ?? 0;
      return rate > bestRate ? model : best;
    })
    : null;

  return {
    busiest: busiest ? { model: busiest, value: `${formatCompactTokens(busiest.usage.totalTokens)} tokens` } : null,
    fastest: fastest ? { model: fastest, value: `${formatCompactDuration(fastest.duration.p50Ms)} median` } : null,
    mostReliable: mostReliable ? { model: mostReliable, value: `${formatSuccessRate(mostReliable.successRate)} success` } : null,
    bestCache: bestCache
      ? { model: bestCache, value: `${Math.round((computeUsageEfficiency(bestCache.usage).cacheHitRate ?? 0) * 100)}% cache hits` }
      : null,
  };
}

const MODEL_SEGMENT_PALETTE = [
  "rgba(0,224,160,0.9)",
  "rgba(255,184,0,0.88)",
  "rgba(0,170,255,0.9)",
  "rgba(251,113,133,0.88)",
  "rgba(139,92,246,0.88)",
];

const MODEL_SEGMENT_TEXT = [
  "text-signal-600 dark:text-signal-400",
  "text-amber-600 dark:text-amber-400",
  "text-cyan-600 dark:text-cyan-400",
  "text-rose-600 dark:text-rose-400",
  "text-violet-600 dark:text-violet-400",
];

export function buildModelSegments(models: ExecutionModelStatsSummary[], top = 5): SegmentDefinition[] {
  const sorted = [...models].sort((left, right) => right.usage.totalTokens - left.usage.totalTokens);
  const head = sorted.slice(0, top);
  const tail = sorted.slice(top);

  const segments: SegmentDefinition[] = head.map((model, index) => ({
    label: model.label,
    value: model.usage.totalTokens,
    color: MODEL_SEGMENT_PALETTE[index % MODEL_SEGMENT_PALETTE.length]!,
    textClassName: MODEL_SEGMENT_TEXT[index % MODEL_SEGMENT_TEXT.length]!,
  }));

  if (tail.length > 0) {
    segments.push({
      label: "Other models",
      value: tail.reduce((sum, model) => sum + model.usage.totalTokens, 0),
      color: "rgba(148,163,184,0.46)",
      textClassName: "text-slate-600 dark:text-slate-300",
    });
  }

  return segments.filter((segment) => segment.value > 0);
}

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

function formatCompactDuration(value: number): string {
  const seconds = Math.max(0, Math.round(value / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}
