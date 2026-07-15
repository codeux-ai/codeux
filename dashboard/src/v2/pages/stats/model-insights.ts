import type {
  ExecutionModelStatsSummary,
  ExecutionUsageTotals,
  SegmentDefinition,
  TokenUsageSource,
} from "../../types.js";
import type { DashboardLocale } from "../../i18n/index.js";

export interface ModelEfficiencyMetrics {
  cacheHitRate: number | null;
  tokensPerCall: number | null;
  outputTokensPerMinute: number | null;
  outputTokensPerSecond: number | null;
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

export function computeUsageEfficiency(usage: ExecutionUsageTotals): ModelEfficiencyMetrics {
  const cacheDenominator = usage.inputTokens + usage.cachedInputTokens;
  const activeMinutes = usage.activeTimeMs / 60000;
  const activeSeconds = usage.activeTimeMs / 1000;
  return {
    cacheHitRate: cacheDenominator > 0 ? usage.cachedInputTokens / cacheDenominator : null,
    tokensPerCall: usage.invocationCount > 0 ? usage.totalTokens / usage.invocationCount : null,
    outputTokensPerMinute: activeMinutes > 0 ? usage.outputTokens / activeMinutes : null,
    outputTokensPerSecond: activeSeconds > 0 ? usage.outputTokens / activeSeconds : null,
    reasoningShare: usage.outputTokens + usage.reasoningOutputTokens > 0
      ? usage.reasoningOutputTokens / (usage.outputTokens + usage.reasoningOutputTokens)
      : null,
    outputInputRatio: cacheDenominator > 0 ? usage.outputTokens / cacheDenominator : null,
  };
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

export function buildTelemetrySourceSummary(usage: Pick<ExecutionUsageTotals, "reportedInvocationCount" | "estimatedInvocationCount" | "unavailableInvocationCount" | "unsupportedInvocationCount">, locale: DashboardLocale = "en"): TelemetrySourceSummary {
  const mix = buildTelemetrySourceMix(usage);
  const dominant = mix.dominant;

  if (mix.total === 0) {
    return {
      label: locale === "de" ? "Nicht verfügbar" : "Unavailable",
      tone: "neutral",
      detail: locale === "de" ? "Für diesen Zeitraum wurden keine Telemetriezahlen erfasst." : "No telemetry counts were recorded for this window.",
      caveat: locale === "de" ? "Es gibt noch keine Aufrufquellen-Telemetrie zum Vergleichen." : "There is no invocation-source telemetry to compare yet.",
      mix,
    };
  }

  const number = new Intl.NumberFormat(locale);
  const reportedLabel = locale === "de" ? `${number.format(mix.reported)} gemeldet` : `${number.format(mix.reported)} reported`;
  const fallbackLabel = [
    mix.estimated > 0 ? (locale === "de" ? `${number.format(mix.estimated)} geschätzt` : `${number.format(mix.estimated)} estimated`) : null,
    mix.unavailable > 0 ? (locale === "de" ? `${number.format(mix.unavailable)} nicht verfügbar` : `${number.format(mix.unavailable)} unavailable`) : null,
    mix.unsupported > 0 ? (locale === "de" ? `${number.format(mix.unsupported)} nicht unterstützt` : `${number.format(mix.unsupported)} unsupported`) : null,
  ].filter(Boolean).join(", ");

  const label = dominant === "reported"
    ? (locale === "de" ? "Gemeldet" : "Reported")
    : dominant === "estimated"
      ? (locale === "de" ? "Geschätzt" : "Estimated")
      : dominant === "unavailable"
        ? (locale === "de" ? "Nicht verfügbar" : "Unavailable")
        : dominant === "unsupported"
          ? (locale === "de" ? "Nicht unterstützt" : "Unsupported")
          : (locale === "de" ? "Unbekannt" : "Unknown");

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
    ? (locale === "de" ? "Für diesen Zeitraum fehlen Telemetriezahlen." : "Telemetry counts are missing for this window.")
    : mix.reportedShare === 1
      ? (locale === "de" ? "Alle gezählten Aufrufe wurden direkt gemeldet." : "All counted invocations were reported directly.")
      : mix.estimated > 0 || mix.unavailable > 0 || mix.unsupported > 0
        ? (locale === "de" ? "Ersatzwerte und nicht unterstützte Quellen sind enthalten; die gemeldete Qualität ist daher nur teilweise vollständig." : "Fallback and unsupported sources are included in the count, so reported quality is only partial.")
        : (locale === "de" ? "Gemeldete Werte dominieren diesen Zeitraum." : "Reported counts dominate this window.");

  return { label, tone, detail, caveat, mix };
}

export function formatSuccessRate(successRate: number | null, locale: DashboardLocale = "en"): string {
  if (successRate === null) {
    return "—";
  }
  const fractionDigits = successRate >= 0.995 && successRate < 1 ? 1 : 0;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(successRate);
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

export function buildModelHighlights(models: ExecutionModelStatsSummary[], locale: DashboardLocale = "en"): ModelHighlights {
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
    busiest: busiest
      ? {
          model: busiest,
          value: locale === "de" ? `${formatCompactTokens(busiest.usage.totalTokens, locale)} Tokens` : `${formatCompactTokens(busiest.usage.totalTokens, locale)} tokens`,
          detail: locale === "de" ? `${new Intl.NumberFormat(locale).format(busiest.usage.invocationCount)} Aufrufe` : `${new Intl.NumberFormat(locale).format(busiest.usage.invocationCount)} calls`,
        }
      : null,
    fastest: fastest
      ? {
          model: fastest,
          value: `${formatCompactDuration(fastest.duration.p50Ms, locale)} ${locale === "de" ? "Median" : "median"}`,
          detail: `p95 ${formatCompactDuration(fastest.duration.p95Ms, locale)}`,
        }
      : null,
    mostReliable: mostReliable
      ? {
          model: mostReliable,
          value: locale === "de" ? `${formatSuccessRate(mostReliable.successRate, locale)} erfolgreich` : `${formatSuccessRate(mostReliable.successRate, locale)} success`,
          detail: locale === "de" ? `${new Intl.NumberFormat(locale).format(mostReliable.statusCounts.failed)} fehlgeschlagen` : `${new Intl.NumberFormat(locale).format(mostReliable.statusCounts.failed)} failed`,
        }
      : null,
    bestCache: bestCache
      ? {
          model: bestCache,
          value: locale === "de" ? `${new Intl.NumberFormat(locale, { style: "percent" }).format(computeUsageEfficiency(bestCache.usage).cacheHitRate ?? 0)} Cache-Treffer` : `${new Intl.NumberFormat(locale, { style: "percent" }).format(computeUsageEfficiency(bestCache.usage).cacheHitRate ?? 0)} cache hits`,
          detail: locale === "de" ? `${formatCompactTokens(bestCache.usage.cachedInputTokens, locale)} im Cache` : `${formatCompactTokens(bestCache.usage.cachedInputTokens, locale)} cached`,
        }
      : null,
    highestVelocity: buildVelocityHighlight(pool, locale),
    strongestReasoning: buildReasoningHighlight(pool, locale),
  };
}

const MODEL_SEGMENT_PALETTE = [
  "rgb(var(--signal-rgb) / 0.9)",
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

export function buildVelocityHighlight(models: ExecutionModelStatsSummary[], locale: DashboardLocale = "en"): ModelHighlight | null {
  const eligible = models.filter((model) => model.usage.invocationCount >= MIN_HIGHLIGHT_CALLS);
  const pool = eligible.length > 0 ? eligible : models;

  const valid = pool.filter((model) => {
    const efficiency = computeUsageEfficiency(model.usage);
    return efficiency.outputTokensPerSecond !== null && efficiency.outputTokensPerSecond > 0;
  });
  if (valid.length === 0) {
    return null;
  }

  const best = valid.reduce((best, model) => {
    const bestVelocity = computeUsageEfficiency(best.usage).outputTokensPerSecond ?? 0;
    const velocity = computeUsageEfficiency(model.usage).outputTokensPerSecond ?? 0;
    return velocity > bestVelocity ? model : best;
  });

  const velocity = Math.round(computeUsageEfficiency(best.usage).outputTokensPerSecond ?? 0);
  return { model: best, value: `${new Intl.NumberFormat(locale).format(velocity)} ${locale === "de" ? "Tok./s" : "tok/s"}`, detail: `${formatCompactDuration(best.usage.activeTimeMs, locale)} ${locale === "de" ? "aktiv" : "active"}` };
}

export function buildReasoningHighlight(models: ExecutionModelStatsSummary[], locale: DashboardLocale = "en"): ModelHighlight | null {
  const eligible = models.filter((model) => model.usage.invocationCount >= MIN_HIGHLIGHT_CALLS);
  const pool = eligible.length > 0 ? eligible : models;

  const valid = pool.filter((model) => {
    const efficiency = computeUsageEfficiency(model.usage);
    return efficiency.reasoningShare !== null && efficiency.reasoningShare > 0;
  });
  if (valid.length === 0) {
    return null;
  }

  const best = valid.reduce((best, model) => {
    const bestShare = computeUsageEfficiency(best.usage).reasoningShare ?? 0;
    const share = computeUsageEfficiency(model.usage).reasoningShare ?? 0;
    return share > bestShare ? model : best;
  });

  const share = Math.round((computeUsageEfficiency(best.usage).reasoningShare ?? 0) * 100);
  const formattedShare = new Intl.NumberFormat(locale, { style: "percent" }).format(share / 100);
  return { model: best, value: locale === "de" ? `${formattedShare} Schlussfolgerung` : `${formattedShare} reasoning`, detail: locale === "de" ? `${formatCompactTokens(best.usage.reasoningOutputTokens, locale)} Schlussfolgerungs-Tokens` : `${formatCompactTokens(best.usage.reasoningOutputTokens, locale)} reasoning tokens` };
}

export function buildModelSegments(models: ExecutionModelStatsSummary[], top = 5, locale: DashboardLocale = "en"): SegmentDefinition[] {
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
      label: locale === "de" ? "Andere Modelle" : "Other models",
      value: tail.reduce((sum, model) => sum + model.usage.totalTokens, 0),
      color: "rgba(148,163,184,0.46)",
      textClassName: "text-slate-600 dark:text-slate-300",
    });
  }

  return segments.filter((segment) => segment.value > 0);
}

function formatCompactTokens(value: number, locale: DashboardLocale): string {
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 1_000_000)}${locale === "de" ? " Mio." : "M"}`;
  }
  if (value >= 1_000) {
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 1_000)}k`;
  }
  return new Intl.NumberFormat(locale).format(value);
}

function formatCompactDuration(value: number, locale: DashboardLocale): string {
  const seconds = Math.max(0, Math.round(value / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours > 0) {
    return locale === "de" ? `${hours} Std. ${minutes} Min.` : `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return locale === "de" ? `${minutes} Min. ${remainingSeconds} Sek.` : `${minutes}m ${remainingSeconds}s`;
  }
  return locale === "de" ? `${remainingSeconds} Sek.` : `${remainingSeconds}s`;
}
