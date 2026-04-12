import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageBucketSummary,
  ExecutionUsageTotals,
  ProjectExecutionStatsSnapshot,
  SegmentDefinition,
} from "../../types.js";

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
};

export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return value.toLocaleString();
}

export function formatDuration(value: number): string {
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

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export const DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "No activity yet";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return DATE_TIME_FORMATTER.format(date);
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

export function createStatsSegments(stats: ProjectExecutionStatsSnapshot | null, usage: ExecutionUsageTotals): {
  providerSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
} {
  const providerSegments = groupSegments(stats?.providers || [], {
    top: 5,
    colorPalette: [
      "rgba(0,224,160,0.9)",
      "rgba(255,184,0,0.88)",
      "rgba(0,170,255,0.9)",
      "rgba(251,113,133,0.88)",
      "rgba(20,184,166,0.9)",
    ],
    fallbackLabel: "Other providers",
  });

  const sourceSegments: SegmentDefinition[] = (stats?.tokenSources || []).map((entry, index) => ({
    label: entry.source,
    value: entry.count,
    color: [
      "rgba(0,224,160,0.9)",
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
      label: "Input",
      value: usage.inputTokens,
      color: "rgba(0,224,160,0.9)",
      textClassName: "text-signal-600 dark:text-signal-400",
    },
    {
      label: "Cached",
      value: usage.cachedInputTokens,
      color: "rgba(0,170,255,0.88)",
      textClassName: "text-cyan-600 dark:text-cyan-400",
    },
    {
      label: "Output",
      value: usage.outputTokens,
      color: "rgba(255,184,0,0.88)",
      textClassName: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Reasoning",
      value: usage.reasoningOutputTokens,
      color: "rgba(251,113,133,0.9)",
      textClassName: "text-rose-600 dark:text-rose-400",
    },
  ].filter((segment) => segment.value > 0);

  return { providerSegments, sourceSegments, tokenSegments };
}

export function normalizePurposeLanes(items: ExecutionStatsEntitySummary[]): ExecutionStatsEntitySummary[] {
  const laneIds = ["planning", "task_coding", "clarification_reply", "merge_recovery", "qa_review"];
  const map = new Map<string, ExecutionStatsEntitySummary>();

  for (const item of items) {
    if (item.id === "merge_conflict") {
      map.set("merge_recovery", { ...item, id: "merge_recovery", label: "merge_recovery" });
    } else {
      map.set(item.id, item);
    }
  }

  return laneIds.map(id => {
    return map.get(id) || {
      id,
      label: id,
      usage: { ...EMPTY_USAGE },
      lastActivityAt: null,
      type: 'purpose',
      secondaryLabel: null,
      status: null,
      purpose: null,
      provider: null
    };
  });
}
