import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageBucketSummary,
  ExecutionUsageTotals,
  ProjectExecutionStatsSnapshot,
  SegmentDefinition,
} from "../../types.js";
import {
  Brain,
  Code2,
  ShieldCheck,
  Sparkles,
  Search,
  Wand2,
  Zap,
  Activity,
  Lightbulb,
} from "lucide-preact";
import type { ComponentType } from "preact";
import type { StatsCardAccent } from "./components/StatsCard.js";
import type { DashboardLocale } from "../../i18n/index.js";

export function isValidCustomRange(from: string, to: string): boolean {
  if (!from || !to) return false;
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return false;
  }
  return fromDate <= toDate;
}

export const EMPTY_USAGE: ExecutionUsageTotals = {
  invocationCount: 0,
  activeTimeMs: 0,
  wallTimeMs: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
  reportedInvocationCount: 0,
  estimatedInvocationCount: 0,
  unavailableInvocationCount: 0,
  unsupportedInvocationCount: 0,
  inputCostUsd: 0,
  outputCostUsd: 0,
  cachedInputCostUsd: 0,
  totalCostUsd: 0,
};

export const createStatsNumberFormatter = (locale: DashboardLocale = "en"): Intl.NumberFormat => (
  new Intl.NumberFormat(locale)
);

/** @deprecated Pass a locale to the presentation helpers instead. */
export const NUMBER_FORMATTER = createStatsNumberFormatter();

export function formatTokens(value: number, locale: DashboardLocale = "en"): string {
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 1_000_000)}${locale === "de" ? " Mio." : "M"}`;
  }
  if (value >= 1_000) {
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value / 1_000)}k`;
  }
  return createStatsNumberFormatter(locale).format(value);
}


export function formatCost(usd: number | null | undefined, locale: DashboardLocale = "en"): string {
  if (usd === null || usd === undefined) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(usd);
}

export function formatStatsDuration(value: number, locale: DashboardLocale = "en"): string {
  const seconds = Math.max(0, Math.round(value / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const number = createStatsNumberFormatter(locale);
  if (hours > 0) {
    return locale === "de" ? `${number.format(hours)} h ${number.format(minutes)} min` : `${number.format(hours)}h ${number.format(minutes)}m`;
  }
  if (minutes > 0) {
    return locale === "de" ? `${number.format(minutes)} min ${number.format(remainingSeconds)} s` : `${number.format(minutes)}m ${number.format(remainingSeconds)}s`;
  }
  return locale === "de" ? `${number.format(remainingSeconds)} s` : `${number.format(remainingSeconds)}s`;
}

export function formatPercent(value: number, locale: DashboardLocale = "en", fractionDigits = 0): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value / 100);
}

export const createStatsDateTimeFormatter = (locale: DashboardLocale = "en"): Intl.DateTimeFormat => new Intl.DateTimeFormat(locale, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** @deprecated Pass a locale to formatDateTime instead. */
export const DATE_TIME_FORMATTER = createStatsDateTimeFormatter();

export function formatDateTime(value: string | null, locale: DashboardLocale = "en"): string {
  if (!value) {
    return locale === "de" ? "Noch keine Aktivität" : "No activity yet";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return createStatsDateTimeFormatter(locale).format(date);
}

export function sumUsage(items: ExecutionStatsEntitySummary[]): ExecutionUsageTotals {
  return items.reduce<ExecutionUsageTotals>((accumulator, item) => ({
    invocationCount: accumulator.invocationCount + item.usage.invocationCount,
    activeTimeMs: accumulator.activeTimeMs + item.usage.activeTimeMs,
    wallTimeMs: accumulator.wallTimeMs + item.usage.wallTimeMs,
    inputTokens: accumulator.inputTokens + item.usage.inputTokens,
    cachedInputTokens: accumulator.cachedInputTokens + item.usage.cachedInputTokens,
    outputTokens: accumulator.outputTokens + item.usage.outputTokens,
    reasoningOutputTokens: accumulator.reasoningOutputTokens + item.usage.reasoningOutputTokens,
    totalTokens: accumulator.totalTokens + item.usage.totalTokens,
    reportedInvocationCount: accumulator.reportedInvocationCount + item.usage.reportedInvocationCount,
    estimatedInvocationCount: accumulator.estimatedInvocationCount + item.usage.estimatedInvocationCount,
    unavailableInvocationCount: accumulator.unavailableInvocationCount + item.usage.unavailableInvocationCount,
    unsupportedInvocationCount: accumulator.unsupportedInvocationCount + item.usage.unsupportedInvocationCount,
    inputCostUsd: accumulator.inputCostUsd + item.usage.inputCostUsd,
    outputCostUsd: accumulator.outputCostUsd + item.usage.outputCostUsd,
    cachedInputCostUsd: accumulator.cachedInputCostUsd + item.usage.cachedInputCostUsd,
    totalCostUsd: accumulator.totalCostUsd + item.usage.totalCostUsd,
  }), { ...EMPTY_USAGE });
}

export function createSeries(
  buckets: ExecutionUsageBucketSummary[],
  selector: (bucket: ExecutionUsageBucketSummary) => number,
): number[] {
  const values = buckets.map(selector);
  return values.some((value) => value > 0) ? values : new Array(Math.max(buckets.length, 7)).fill(0);
}

export function groupSegments(
  items: ExecutionStatsEntitySummary[],
  options: {
    top?: number;
    colorPalette: string[];
    fallbackLabel: string;
  },
): SegmentDefinition[] {
  const sorted = [...items].sort((left, right) => right.usage.totalTokens - left.usage.totalTokens);
  const topCount = options.top ?? sorted.length;
  const head = sorted.slice(0, topCount);
  const tail = sorted.slice(topCount);

  const segments = head.map((item, index) => ({
    label: item.label,
    value: item.usage.totalTokens,
    color: options.colorPalette[index % options.colorPalette.length]!,
    textClassName: [
      "text-signal-600 dark:text-signal-400",
      "text-amber-600 dark:text-amber-400",
      "text-cyan-600 dark:text-cyan-400",
      "text-rose-600 dark:text-rose-400",
      "text-emerald-600 dark:text-emerald-400",
    ][index % 5] || "text-slate-600 dark:text-slate-300",
  }));

  if (tail.length > 0) {
    segments.push({
      label: options.fallbackLabel,
      value: sumUsage(tail).totalTokens,
      color: "rgba(148,163,184,0.46)",
      textClassName: "text-slate-600 dark:text-slate-300",
    });
  }

  return segments.filter((segment) => segment.value > 0);
}

export function createStatsSegments(stats: ProjectExecutionStatsSnapshot | null, usage: ExecutionUsageTotals, locale: DashboardLocale = "en"): {
  providerSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
} {
  const providerSegments = groupSegments(stats?.providers || [], {
    top: 5,
    colorPalette: [
      "rgb(var(--signal-rgb) / 0.9)",
      "rgba(255,184,0,0.88)",
      "rgba(0,170,255,0.9)",
      "rgba(251,113,133,0.88)",
      "rgba(20,184,166,0.9)",
    ],
    fallbackLabel: locale === "de" ? "Andere Anbieter" : "Other providers",
  });

  const sourceSegments: SegmentDefinition[] = (stats?.tokenSources || []).map((entry, index) => ({
    label: entry.source,
    value: entry.count,
    color: [
      "rgb(var(--signal-rgb) / 0.9)",
      "rgba(255,184,0,0.9)",
      "rgba(248,113,113,0.88)",
      "rgba(148,163,184,0.8)",
    ][index % 4]!,
    textClassName: [
      "text-signal-600 dark:text-signal-400",
      "text-amber-600 dark:text-amber-400",
      "text-rose-600 dark:text-rose-400",
      "text-slate-600 dark:text-slate-300",
    ][index % 4]!,
  }));

  const tokenSegments: SegmentDefinition[] = [
    {
      label: locale === "de" ? "Eingabe" : "Input",
      value: usage.inputTokens,
      color: "rgb(var(--signal-rgb) / 0.9)",
      textClassName: "text-signal-600 dark:text-signal-400",
    },
    {
      label: locale === "de" ? "Im Cache" : "Cached",
      value: usage.cachedInputTokens,
      color: "rgba(0,170,255,0.88)",
      textClassName: "text-cyan-600 dark:text-cyan-400",
    },
    {
      label: locale === "de" ? "Ausgabe" : "Output",
      value: usage.outputTokens,
      color: "rgba(255,184,0,0.88)",
      textClassName: "text-amber-600 dark:text-amber-400",
    },
    {
      label: locale === "de" ? "Schlussfolgerung" : "Reasoning",
      value: usage.reasoningOutputTokens,
      color: "rgba(251,113,133,0.9)",
      textClassName: "text-rose-600 dark:text-rose-400",
    },
  ].filter((segment) => segment.value > 0);

  return { providerSegments, sourceSegments, tokenSegments };
}


export const PURPOSE_MAPPING: Record<string, { icon: ComponentType<any>; accent: StatsCardAccent }> = {
  planning: { icon: Brain, accent: "rose" },
  code_generation: { icon: Code2, accent: "signal" },
  testing: { icon: ShieldCheck, accent: "emerald" },
  analysis: { icon: Search, accent: "cyan" },
  refactor: { icon: Wand2, accent: "amber" },
  optimization: { icon: Zap, accent: "amber" },
  review: { icon: Activity, accent: "emerald" },
  brainstorming: { icon: Lightbulb, accent: "amber" },
};

export function getPurposeConfig(purposeId: string): { icon: ComponentType<any>; accent: StatsCardAccent } {
  return PURPOSE_MAPPING[purposeId] || { icon: Sparkles, accent: "default" };
}
