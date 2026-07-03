import type {
  ExecutionModelStatsSummary,
  ExecutionUsageTotals,
  SegmentDefinition,
  TokenUsageSource,
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
  detail?: string;
}

export interface ModelHighlights {
  busiest: ModelHighlight | null;
  fastest: ModelHighlight | null;
  mostReliable: ModelHighlight | null;
  bestCache: ModelHighlight | null;
  highestVelocity: ModelHighlight | null;
  strongestReasoning: ModelHighlight | null;
}

export interface TelemetrySourceMix {
  reported: number;
  estimated: number;
  unavailable: number;
  unsupported: number;
  total: number;
  reportedShare: number | null;
  estimatedShare: number | null;
  unavailableShare: number | null;
  unsupportedShare: number | null;
  dominant: TokenUsageSource | "unknown";
}

export interface TelemetrySourceSummary {
  label: string;
  tone: "strong" | "warn" | "critical" | "neutral";
  detail: string;
  caveat: string;
  mix: TelemetrySourceMix;
}

export interface TelemetryQualityIndicator {
  id: TokenUsageSource;
  label: string;
  count: number;
  share: number | null;
  status: "direct" | "fallback" | "missing";
  summary: string;
}

export interface ProviderConfidenceSummary {
  label: "Direct" | "Partial" | "Fallback" | "Unknown";
  score: number | null;
  detail: string;
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

export function formatShare(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${Math.round(value * 100)}%`;
}

export function buildTelemetrySourceMix(usage: Pick<ExecutionUsageTotals, "reportedInvocationCount" | "estimatedInvocationCount" | "unavailableInvocationCount" | "unsupportedInvocationCount">): TelemetrySourceMix {
  const reported = usage.reportedInvocationCount || 0;
  const estimated = usage.estimatedInvocationCount || 0;
  const unavailable = usage.unavailableInvocationCount || 0;
  const unsupported = usage.unsupportedInvocationCount || 0;
  const total = reported + estimated + unavailable + unsupported;

  const reportedShare = total > 0 ? reported / total : null;
  const estimatedShare = total > 0 ? estimated / total : null;
  const unavailableShare = total > 0 ? unavailable / total : null;
  const unsupportedShare = total > 0 ? unsupported / total : null;
  const dominant = reported > 0
    ? "reported"
    : estimated > 0
      ? "estimated"
      : unavailable > 0
        ? "unavailable"
        : unsupported > 0
          ? "unsupported"
          : "unknown";

  return {
    reported,
    estimated,
    unavailable,
    unsupported,
    total,
    reportedShare,
    estimatedShare,
    unavailableShare,
    unsupportedShare,
    dominant,
  };
}

export function buildTelemetryQualityIndicators(usage: Pick<ExecutionUsageTotals, "reportedInvocationCount" | "estimatedInvocationCount" | "unavailableInvocationCount" | "unsupportedInvocationCount">): TelemetryQualityIndicator[] {
  const mix = buildTelemetrySourceMix(usage);
  return [
    {
      id: "reported",
      label: "Reported",
      count: mix.reported,
      share: mix.reportedShare,
      status: "direct",
      summary: mix.reported > 0 ? `${formatShare(mix.reportedShare)} directly reported` : "No reported calls",
    },
    {
      id: "estimated",
      label: "Estimated",
      count: mix.estimated,
      share: mix.estimatedShare,
      status: "fallback",
      summary: mix.estimated > 0 ? `${formatShare(mix.estimatedShare)} estimated from fallback records` : "No estimated calls",
    },
    {
      id: "unavailable",
      label: "Unavailable",
      count: mix.unavailable,
      share: mix.unavailableShare,
      status: "missing",
      summary: mix.unavailable > 0 ? `${formatShare(mix.unavailableShare)} missing usage details` : "No unavailable calls",
    },
    {
      id: "unsupported",
      label: "Unsupported",
      count: mix.unsupported,
      share: mix.unsupportedShare,
      status: "missing",
      summary: mix.unsupported > 0 ? `${formatShare(mix.unsupportedShare)} unsupported by provider telemetry` : "No unsupported calls",
    },
  ];
}

export function buildProviderConfidenceSummary(usage: Pick<ExecutionUsageTotals, "reportedInvocationCount" | "estimatedInvocationCount" | "unavailableInvocationCount" | "unsupportedInvocationCount">): ProviderConfidenceSummary {
  const mix = buildTelemetrySourceMix(usage);
  if (mix.total === 0) {
    return { label: "Unknown", score: null, detail: "No provider-level source counts." };
  }

  const score = mix.reported / mix.total;
  if (score >= 0.8 && mix.unavailable === 0 && mix.unsupported === 0) {
    return { label: "Direct", score, detail: `${formatShare(score)} reported source coverage.` };
  }
  if (score > 0) {
    return { label: "Partial", score, detail: `${formatShare(score)} reported with fallback sources present.` };
  }
  return { label: "Fallback", score, detail: "No calls were directly reported by this provider." };
}

export function buildTelemetrySourceSummary(usage: Pick<ExecutionUsageTotals, "reportedInvocationCount" | "estimatedInvocationCount" | "unavailableInvocationCount" | "unsupportedInvocationCount">): TelemetrySourceSummary {
  const mix = buildTelemetrySourceMix(usage);
  const dominant = mix.dominant;

  if (mix.total === 0) {
    return {
      label: "Unavailable",
      tone: "neutral",
      detail: "No telemetry counts were recorded for this window.",
      caveat: "There is no invocation-source telemetry to compare yet.",
      mix,
    };
  }

  const reportedLabel = `${mix.reported} reported`;
  const fallbackLabel = [
    mix.estimated > 0 ? `${mix.estimated} estimated` : null,
    mix.unavailable > 0 ? `${mix.unavailable} unavailable` : null,
    mix.unsupported > 0 ? `${mix.unsupported} unsupported` : null,
  ].filter(Boolean).join(", ");

  const label = dominant === "reported"
    ? "Reported"
    : dominant === "estimated"
      ? "Estimated"
      : dominant === "unavailable"
        ? "Unavailable"
        : dominant === "unsupported"
          ? "Unsupported"
          : "Unknown";

  const tone = mix.reportedShare !== null && mix.reportedShare >= 0.8 && mix.unavailable === 0 && mix.unsupported === 0
    ? "strong"
    : mix.reportedShare !== null && mix.reportedShare >= 0.5
      ? "warn"
      : mix.reportedShare !== null && mix.reportedShare > 0
        ? "critical"
        : mix.estimated > 0
          ? "warn"
          : mix.unavailable > 0 || mix.unsupported > 0
            ? "critical"
            : "neutral";

  const detail = fallbackLabel.length > 0
    ? `${reportedLabel}${reportedLabel && fallbackLabel ? " · " : ""}${fallbackLabel}`
    : reportedLabel;

  const caveat = mix.reportedShare === null
    ? "Telemetry counts are missing for this window."
    : mix.reportedShare === 1
      ? "All counted invocations were reported directly."
      : mix.estimated > 0 || mix.unavailable > 0 || mix.unsupported > 0
        ? "Fallback and unsupported sources are included in the count, so reported quality is only partial."
        : "Reported counts dominate this window.";

  return { label, tone, detail, caveat, mix };
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

  const withVelocity = pool.filter((model) => model.usage.outputTokens > 0 && model.usage.activeTimeMs > 0);
  const highestVelocity = withVelocity.length > 0
    ? withVelocity.reduce((best, model) => {
      const bestVelocity = best.usage.outputTokens / Math.max(1, best.usage.activeTimeMs / 1000);
      const velocity = model.usage.outputTokens / Math.max(1, model.usage.activeTimeMs / 1000);
      return velocity > bestVelocity ? model : best;
    })
    : null;

  const withReasoning = pool.filter((model) => model.usage.reasoningOutputTokens > 0 && model.usage.outputTokens > 0);
  const strongestReasoning = withReasoning.length > 0
    ? withReasoning.reduce((best, model) => {
      const bestShare = best.usage.reasoningOutputTokens / Math.max(1, best.usage.outputTokens);
      const share = model.usage.reasoningOutputTokens / Math.max(1, model.usage.outputTokens);
      return share > bestShare ? model : best;
    })
    : null;

  return {
    busiest: busiest
      ? {
          model: busiest,
          value: `${formatCompactTokens(busiest.usage.totalTokens)} tokens`,
          detail: `${busiest.usage.invocationCount.toLocaleString()} calls`,
        }
      : null,
    fastest: fastest
      ? {
          model: fastest,
          value: `${formatCompactDuration(fastest.duration.p50Ms)} median`,
          detail: `p95 ${formatCompactDuration(fastest.duration.p95Ms)}`,
        }
      : null,
    mostReliable: mostReliable
      ? {
          model: mostReliable,
          value: `${formatSuccessRate(mostReliable.successRate)} success`,
          detail: `${mostReliable.statusCounts.failed.toLocaleString()} failed`,
        }
      : null,
    bestCache: bestCache
      ? {
          model: bestCache,
          value: `${Math.round((computeUsageEfficiency(bestCache.usage).cacheHitRate ?? 0) * 100)}% cache hits`,
          detail: `${formatCompactTokens(bestCache.usage.cachedInputTokens)} cached`,
        }
      : null,
    highestVelocity: highestVelocity
      ? {
          model: highestVelocity,
          value: `${Math.round(highestVelocity.usage.outputTokens / Math.max(1, highestVelocity.usage.activeTimeMs / 1000))} tok/s`,
          detail: `${formatCompactDuration(highestVelocity.usage.activeTimeMs)} active`,
        }
      : null,
    strongestReasoning: strongestReasoning
      ? {
          model: strongestReasoning,
          value: `${Math.round((strongestReasoning.usage.reasoningOutputTokens / Math.max(1, strongestReasoning.usage.outputTokens)) * 100)}% reasoning`,
          detail: `${formatCompactTokens(strongestReasoning.usage.reasoningOutputTokens)} reasoning tokens`,
        }
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

export function buildVelocityHighlight(models: ExecutionModelStatsSummary[]): ModelHighlight | null {
  const eligible = models.filter((model) => model.usage.invocationCount >= MIN_HIGHLIGHT_CALLS);
  const pool = eligible.length > 0 ? eligible : models;

  const valid = pool.filter((model) => model.usage.outputTokens > 0 && model.usage.activeTimeMs > 0);
  if (valid.length === 0) {
    return null;
  }

  const best = valid.reduce((best, model) => {
    const bestVelocity = best.usage.outputTokens / Math.max(1, best.usage.activeTimeMs / 1000);
    const velocity = model.usage.outputTokens / Math.max(1, model.usage.activeTimeMs / 1000);
    return velocity > bestVelocity ? model : best;
  });

  const velocity = Math.round(best.usage.outputTokens / Math.max(1, best.usage.activeTimeMs / 1000));
  return { model: best, value: `${velocity} tok/s`, detail: `${formatCompactDuration(best.usage.activeTimeMs)} active` };
}

export function buildReasoningHighlight(models: ExecutionModelStatsSummary[]): ModelHighlight | null {
  const eligible = models.filter((model) => model.usage.invocationCount >= MIN_HIGHLIGHT_CALLS);
  const pool = eligible.length > 0 ? eligible : models;

  const valid = pool.filter((model) => model.usage.reasoningOutputTokens > 0 && model.usage.outputTokens > 0);
  if (valid.length === 0) {
    return null;
  }

  const best = valid.reduce((best, model) => {
    const bestShare = best.usage.reasoningOutputTokens / Math.max(1, best.usage.outputTokens);
    const share = model.usage.reasoningOutputTokens / Math.max(1, model.usage.outputTokens);
    return share > bestShare ? model : best;
  });

  const share = Math.round((best.usage.reasoningOutputTokens / Math.max(1, best.usage.outputTokens)) * 100);
  return { model: best, value: `${share}% reasoning`, detail: `${formatCompactTokens(best.usage.reasoningOutputTokens)} reasoning tokens` };
}

export function buildModelSegments(models: ExecutionModelStatsSummary[], top = 5): SegmentDefinition[] {
  const sorted = [...models].sort((left, right) => {
    const tokenDelta = right.usage.totalTokens - left.usage.totalTokens;
    return tokenDelta !== 0 ? tokenDelta : left.label.localeCompare(right.label);
  });
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
