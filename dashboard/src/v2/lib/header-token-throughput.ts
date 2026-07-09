import type {
  HeaderTokenThroughputProjectSnapshot,
  HeaderTokenThroughputSnapshot,
  HeaderTokenThroughputTotals,
  HeaderTokenThroughputWindow,
} from "../types.js";

export interface HeaderTokenThroughputScopeViewModel {
  scope: "app" | "project";
  label: string;
  tokensPerMinute: number;
  totalTokens: number;
  invocationCount: number;
  activeTimeMs: number;
  rateValueLabel: string;
  rateUnitLabel: "tok/min";
  rateLabel: string;
  totalLabel: string;
  invocationLabel: string;
  detailLabel: string;
  emptyLabel: string;
  ariaLabel: string;
  hasActivity: boolean;
  intensity: "idle" | "low" | "medium" | "high";
}

export interface HeaderTokenThroughputViewModel {
  window: HeaderTokenThroughputWindow;
  rangeLabel: string;
  app: HeaderTokenThroughputScopeViewModel;
  project: HeaderTokenThroughputScopeViewModel;
  statusLabel: string;
  ariaLabel: string;
  isLoading: boolean;
  isError: boolean;
}

const ZERO_TOTALS: HeaderTokenThroughputTotals = {
  totalTokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  invocationCount: 0,
  activeTimeMs: 0,
  tokensPerMinute: 0,
};

function sanitizeMetric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
}

export function normalizeHeaderTokenThroughputTotals(
  totals: Partial<HeaderTokenThroughputTotals> | null | undefined,
): HeaderTokenThroughputTotals {
  return {
    totalTokens: sanitizeMetric(totals?.totalTokens),
    inputTokens: sanitizeMetric(totals?.inputTokens),
    cachedInputTokens: sanitizeMetric(totals?.cachedInputTokens),
    outputTokens: sanitizeMetric(totals?.outputTokens),
    reasoningTokens: sanitizeMetric(totals?.reasoningTokens),
    invocationCount: sanitizeMetric(totals?.invocationCount),
    activeTimeMs: sanitizeMetric(totals?.activeTimeMs),
    tokensPerMinute: sanitizeMetric(totals?.tokensPerMinute),
  };
}

function trimDecimal(value: string): string {
  return value.replace(/\.0$/, "");
}

export function formatCompactTokenNumber(value: unknown): string {
  const normalized = Math.floor(sanitizeMetric(value));
  if (normalized < 1_000) {
    return String(normalized);
  }
  if (normalized >= 999_500_000_000) {
    return "999B+";
  }

  const units = [
    { value: 1_000_000_000, suffix: "B" },
    { value: 1_000_000, suffix: "M" },
    { value: 1_000, suffix: "K" },
  ] as const;

  for (const unit of units) {
    if (normalized >= unit.value) {
      const scaled = normalized / unit.value;
      const precision = scaled < 10 ? 1 : 0;
      const label = trimDecimal(scaled.toFixed(precision));
      return `${label}${unit.suffix}`;
    }
  }

  return String(normalized);
}

export function formatTokensPerMinute(value: unknown): string {
  return `${formatCompactTokenNumber(value)}/min`;
}

export function formatCompactTokenTotal(value: unknown): string {
  const normalized = Math.floor(sanitizeMetric(value));
  const unit = normalized === 1 ? "token" : "tokens";
  return `${formatCompactTokenNumber(normalized)} ${unit}`;
}

function getIntensity(tokensPerMinute: number): HeaderTokenThroughputScopeViewModel["intensity"] {
  if (tokensPerMinute <= 0) return "idle";
  if (tokensPerMinute < 1_000) return "low";
  if (tokensPerMinute < 10_000) return "medium";
  return "high";
}

function buildScopeViewModel(input: {
  scope: "app" | "project";
  label: string;
  totals: HeaderTokenThroughputTotals;
  rangeLabel: string;
  emptyLabel: string;
}): HeaderTokenThroughputScopeViewModel {
  const totals = normalizeHeaderTokenThroughputTotals(input.totals);
  const hasActivity = totals.totalTokens > 0 || totals.invocationCount > 0 || totals.tokensPerMinute > 0;
  const rateValueLabel = formatCompactTokenNumber(totals.tokensPerMinute);
  const rateLabel = `${rateValueLabel} tok/min`;
  const totalLabel = hasActivity ? formatCompactTokenTotal(totals.totalTokens) : "No tokens";
  const invocationLabel = `${formatCompactTokenNumber(totals.invocationCount)} ${totals.invocationCount === 1 ? "call" : "calls"}`;
  const detailLabel = hasActivity ? `${totalLabel} / ${invocationLabel}` : input.emptyLabel;

  return {
    scope: input.scope,
    label: input.label,
    tokensPerMinute: totals.tokensPerMinute,
    totalTokens: totals.totalTokens,
    invocationCount: totals.invocationCount,
    activeTimeMs: totals.activeTimeMs,
    rateValueLabel,
    rateUnitLabel: "tok/min",
    rateLabel,
    totalLabel,
    invocationLabel,
    detailLabel,
    emptyLabel: input.emptyLabel,
    ariaLabel: `${input.label} token throughput is ${rateLabel}, ${totalLabel}, ${invocationLabel}, ${input.rangeLabel}.`,
    hasActivity,
    intensity: getIntensity(totals.tokensPerMinute),
  };
}

function getProjectTotals(project: HeaderTokenThroughputProjectSnapshot | null | undefined): HeaderTokenThroughputTotals {
  if (!project) {
    return ZERO_TOTALS;
  }
  return project;
}

export function buildHeaderTokenThroughputViewModel(input: {
  snapshot: HeaderTokenThroughputSnapshot | null;
  projectId: string | null;
  window: HeaderTokenThroughputWindow;
  loading: boolean;
  error: string | null;
}): HeaderTokenThroughputViewModel {
  const rangeLabel = input.snapshot?.range.label || getFallbackWindowLabel(input.window);
  const projectName = input.snapshot?.project?.projectName || (input.projectId ? "Project" : "No project");
  const app = buildScopeViewModel({
    scope: "app",
    label: "App",
    totals: normalizeHeaderTokenThroughputTotals(input.snapshot?.app),
    rangeLabel,
    emptyLabel: "No app tokens in this window",
  });
  const project = buildScopeViewModel({
    scope: "project",
    label: projectName,
    totals: getProjectTotals(input.snapshot?.project),
    rangeLabel,
    emptyLabel: input.projectId ? "No project tokens in this window" : "Select a project for local throughput",
  });
  const isLoading = input.loading && !input.snapshot;
  const isError = Boolean(input.error);
  const statusLabel = isError
    ? "Token telemetry unavailable"
    : isLoading
      ? "Loading token telemetry"
      : !app.hasActivity && !project.hasActivity
        ? "No token telemetry in this window"
        : `${app.rateLabel} app, ${project.rateLabel} project`;

  return {
    window: input.snapshot?.window || input.window,
    rangeLabel,
    app,
    project,
    statusLabel,
    ariaLabel: `${statusLabel}. ${app.ariaLabel} ${project.ariaLabel}`,
    isLoading,
    isError,
  };
}

export function getFallbackWindowLabel(window: HeaderTokenThroughputWindow): string {
  switch (window) {
    case "20s": return "Last 20 seconds";
    case "1h": return "Last 1 hour";
    case "24h": return "Last 24 hours";
    case "7d": return "Last 7 days";
    case "30d": return "Last 30 days";
    case "all": return "All time";
  }
}
