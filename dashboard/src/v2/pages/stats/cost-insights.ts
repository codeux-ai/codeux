import type {
  ExecutionCostCoverage,
  ExecutionModelStatsSummary,
  ExecutionStatsEntitySummary,
  ExecutionUsageTotals,
  ProjectCostAnalyticsSummary,
  ProjectExecutionStatsSnapshot,
} from "../../../types.js";
import { translateDashboardMessage, type DashboardLocale } from "../../i18n/index.js";
import { statsMessages } from "../../i18n/messages/stats.js";
import { formatDateTime } from "./stats-utils.js";

export type CostCoverageState = "complete" | "partial" | "unpriced" | "unknown" | "unavailable";

export interface CostProvenance {
  state: CostCoverageState;
  invocationCount: number;
  configuredPricingInvocationCount: number;
  providerReportedCostInvocationCount: number;
  unpricedInvocationCount: number;
  unknownInvocationCount: number;
}

export interface CostAmount {
  usd: number | null;
  provenance: CostProvenance;
}

export interface CostAverage extends CostAmount {
  entityCount: number;
}

export interface CostSpendSegment {
  id: "input" | "cached_input" | "output" | "provider_reported";
  label: string;
  amount: CostAmount;
  share: number;
}

export interface CostTokenSegment {
  id: "input" | "cached_input" | "output" | "reasoning";
  label: string;
  tokens: number;
  share: number;
}

export interface CostOverTimeRow {
  id: string;
  bucketStart: string;
  bucketEnd: string;
  label: string;
  amount: CostAmount;
  spendShare: number;
  calls: number;
  tokens: number;
}

export interface CostDimensionRow {
  id: string;
  label: string;
  amount: CostAmount;
  spendShare: number;
  tokenShare: number;
  calls: number;
  costPerCall: CostAmount;
  tokens: number;
}

export interface CostModelRow extends CostDimensionRow {
  provider: string;
  model: string | null;
}

export interface CostDetailRow extends CostDimensionRow {
  status: string | null;
  secondaryLabel: string | null;
  lastActivityAt: string | null;
  recency: string;
  tokenSegments: CostTokenSegment[];
}

export interface CostAnalyticsViewModel {
  totalSpend: CostAmount;
  costPerInvocation: CostAmount;
  costPerMillionTokens: CostAmount;
  averageCostPerTask: CostAverage;
  averageCostPerSprint: CostAverage;
  calls: number;
  tokens: number;
  costOverTime: CostOverTimeRow[];
  spendSegments: CostSpendSegment[];
  tokenSegments: CostTokenSegment[];
  models: CostModelRow[];
  purposes: CostDimensionRow[];
  tasks: CostDetailRow[];
  sprints: CostDetailRow[];
}

type CostDimensionSource = Pick<ExecutionStatsEntitySummary, "id" | "label" | "usage">;

const COST_LABELS: Record<CostSpendSegment["id"], string> = {
  input: "Input",
  cached_input: "Cached input",
  output: "Output",
  provider_reported: "Provider reported",
};

const TOKEN_LABELS: Record<CostTokenSegment["id"], string> = {
  input: "Input",
  cached_input: "Cached input",
  output: "Output",
  reasoning: "Reasoning",
};

function normalizeNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeUsage(usage: ExecutionUsageTotals): ExecutionUsageTotals {
  return {
    invocationCount: normalizeNumber(usage.invocationCount),
    activeTimeMs: normalizeNumber(usage.activeTimeMs),
    wallTimeMs: normalizeNumber(usage.wallTimeMs),
    inputTokens: normalizeNumber(usage.inputTokens),
    cachedInputTokens: normalizeNumber(usage.cachedInputTokens),
    outputTokens: normalizeNumber(usage.outputTokens),
    reasoningOutputTokens: normalizeNumber(usage.reasoningOutputTokens),
    totalTokens: normalizeNumber(usage.totalTokens),
    inputCostUsd: normalizeNumber(usage.inputCostUsd),
    outputCostUsd: normalizeNumber(usage.outputCostUsd),
    cachedInputCostUsd: normalizeNumber(usage.cachedInputCostUsd),
    totalCostUsd: normalizeNumber(usage.totalCostUsd),
    toolCallCount: normalizeNumber(usage.toolCallCount),
    reportedInvocationCount: normalizeNumber(usage.reportedInvocationCount),
    estimatedInvocationCount: normalizeNumber(usage.estimatedInvocationCount),
    unavailableInvocationCount: normalizeNumber(usage.unavailableInvocationCount),
    unsupportedInvocationCount: normalizeNumber(usage.unsupportedInvocationCount),
    costCoverage: usage.costCoverage,
  };
}

function deriveProvenance(
  invocationCount: number,
  coverage: ExecutionCostCoverage | undefined,
): CostProvenance {
  if (invocationCount === 0) {
    return {
      state: "unavailable",
      invocationCount: 0,
      configuredPricingInvocationCount: 0,
      providerReportedCostInvocationCount: 0,
      unpricedInvocationCount: 0,
      unknownInvocationCount: 0,
    };
  }

  if (!coverage) {
    return {
      state: "unknown",
      invocationCount,
      configuredPricingInvocationCount: 0,
      providerReportedCostInvocationCount: 0,
      unpricedInvocationCount: 0,
      unknownInvocationCount: invocationCount,
    };
  }

  const configured = Math.min(invocationCount, normalizeNumber(coverage.configuredPricingInvocationCount));
  const providerReported = Math.min(
    invocationCount - configured,
    normalizeNumber(coverage.providerReportedCostInvocationCount),
  );
  const unpriced = Math.min(
    invocationCount - configured - providerReported,
    normalizeNumber(coverage.unpricedInvocationCount),
  );
  const unknown = Math.max(0, invocationCount - configured - providerReported - unpriced);
  const covered = configured + providerReported;

  let state: CostCoverageState;
  if (unknown > 0) {
    state = "unknown";
  } else if (covered === 0) {
    state = "unpriced";
  } else if (unpriced > 0) {
    state = "partial";
  } else {
    state = "complete";
  }

  return {
    state,
    invocationCount,
    configuredPricingInvocationCount: configured,
    providerReportedCostInvocationCount: providerReported,
    unpricedInvocationCount: unpriced,
    unknownInvocationCount: unknown,
  };
}

function amountFromUsage(usage: ExecutionUsageTotals): CostAmount {
  const normalized = normalizeUsage(usage);
  return {
    usd: normalized.totalCostUsd,
    provenance: deriveProvenance(normalized.invocationCount, usage.costCoverage),
  };
}

function unavailableAmount(provenance: CostProvenance): CostAmount {
  return { usd: null, provenance: { ...provenance, state: "unavailable" } };
}

function safeAdd(left: number, right: number): number {
  const sum = left + right;
  return Number.isFinite(sum) ? sum : Number.MAX_VALUE;
}

function divideAmount(amount: CostAmount, denominator: number, multiplier = 1): CostAmount {
  if (denominator <= 0 || amount.usd === null) {
    return unavailableAmount(amount.provenance);
  }
  const quotient = (amount.usd / denominator) * multiplier;
  return Number.isFinite(quotient)
    ? { usd: quotient, provenance: amount.provenance }
    : unavailableAmount(amount.provenance);
}

function finiteShare(value: number, total: number): number {
  if (total <= 0) return 0;
  const share = value / total;
  return Number.isFinite(share) ? share : 0;
}

function reconcileParts(parts: number[], total: number): number[] {
  if (total === 0) return parts.map(() => 0);
  const partsTotal = parts.reduce((sum, value) => sum + value, 0);
  if (partsTotal === 0) return parts.map((_, index) => index === 0 ? total : 0);

  const reconciled = parts.map((value) => (value / partsTotal) * total);
  const beforeLast = reconciled.slice(0, -1).reduce((sum, value) => sum + value, 0);
  reconciled[reconciled.length - 1] = Math.max(0, total - beforeLast);
  return reconciled;
}

function buildSpendSegments(usage: ExecutionUsageTotals): CostSpendSegment[] {
  const normalized = normalizeUsage(usage);
  const providerReported = normalizeNumber(usage.costCoverage?.providerReportedCostUsd);
  const values = reconcileParts([
    normalized.inputCostUsd,
    normalized.cachedInputCostUsd,
    normalized.outputCostUsd,
    providerReported,
  ], normalized.totalCostUsd);
  const provenance = deriveProvenance(normalized.invocationCount, usage.costCoverage);
  const ids: CostSpendSegment["id"][] = ["input", "cached_input", "output", "provider_reported"];

  return ids.map((id, index) => ({
    id,
    label: COST_LABELS[id],
    amount: { usd: values[index] ?? 0, provenance },
    share: finiteShare(values[index] ?? 0, normalized.totalCostUsd),
  }));
}

function buildTokenSegments(usage: ExecutionUsageTotals): CostTokenSegment[] {
  const normalized = normalizeUsage(usage);
  const input = normalized.inputTokens;
  const cached = normalized.cachedInputTokens;
  const output = normalized.outputTokens;
  const reasoning = normalized.reasoningOutputTokens;
  const trackedWithoutReasoning = input + cached + output;
  const outputExcludingReasoning = trackedWithoutReasoning >= normalized.totalTokens
    ? Math.max(0, output - reasoning)
    : output;
  const values = reconcileParts(
    [input, cached, outputExcludingReasoning, reasoning],
    normalized.totalTokens,
  );
  const ids: CostTokenSegment["id"][] = ["input", "cached_input", "output", "reasoning"];

  return ids.map((id, index) => ({
    id,
    label: TOKEN_LABELS[id],
    tokens: values[index] ?? 0,
    share: finiteShare(values[index] ?? 0, normalized.totalTokens),
  }));
}

function compareDimensionRows(left: CostDimensionRow, right: CostDimensionRow): number {
  const spendDifference = (right.amount.usd ?? 0) - (left.amount.usd ?? 0);
  if (spendDifference !== 0) return spendDifference;
  const tokenDifference = right.tokens - left.tokens;
  if (tokenDifference !== 0) return tokenDifference;
  const callDifference = right.calls - left.calls;
  if (callDifference !== 0) return callDifference;
  const labelDifference = left.label.localeCompare(right.label, "en");
  return labelDifference !== 0 ? labelDifference : left.id.localeCompare(right.id, "en");
}

function buildDimensionRow(
  entity: CostDimensionSource,
  totalSpend: number,
  totalTokens: number,
): CostDimensionRow {
  const usage = normalizeUsage(entity.usage);
  const amount = amountFromUsage(entity.usage);
  return {
    id: entity.id,
    label: entity.label,
    amount,
    spendShare: finiteShare(amount.usd ?? 0, totalSpend),
    tokenShare: finiteShare(usage.totalTokens, totalTokens),
    calls: usage.invocationCount,
    costPerCall: divideAmount(amount, usage.invocationCount),
    tokens: usage.totalTokens,
  };
}

function buildDetailRows(
  entities: ExecutionStatsEntitySummary[],
  totalSpend: number,
  totalTokens: number,
): CostDetailRow[] {
  return entities.map((entity) => ({
    ...buildDimensionRow(entity, totalSpend, totalTokens),
    status: entity.status,
    secondaryLabel: entity.secondaryLabel,
    lastActivityAt: entity.lastActivityAt,
    recency: formatDateTime(entity.lastActivityAt),
    tokenSegments: buildTokenSegments(entity.usage),
  })).sort(compareDimensionRows);
}

function combineProvenance(entities: ExecutionStatsEntitySummary[]): CostProvenance {
  let invocationCount = 0;
  let configured = 0;
  let providerReported = 0;
  let unpriced = 0;
  let unknown = 0;

  for (const entity of entities) {
    const usage = normalizeUsage(entity.usage);
    const provenance = deriveProvenance(usage.invocationCount, entity.usage.costCoverage);
    invocationCount = safeAdd(invocationCount, provenance.invocationCount);
    configured = safeAdd(configured, provenance.configuredPricingInvocationCount);
    providerReported = safeAdd(providerReported, provenance.providerReportedCostInvocationCount);
    unpriced = safeAdd(unpriced, provenance.unpricedInvocationCount);
    unknown = safeAdd(unknown, provenance.unknownInvocationCount);
  }

  let state: CostCoverageState = "unavailable";
  const covered = configured + providerReported;
  if (invocationCount > 0) {
    if (unknown > 0) state = "unknown";
    else if (covered === 0) state = "unpriced";
    else if (unpriced > 0) state = "partial";
    else state = "complete";
  }

  return {
    state,
    invocationCount,
    configuredPricingInvocationCount: configured,
    providerReportedCostInvocationCount: providerReported,
    unpricedInvocationCount: unpriced,
    unknownInvocationCount: unknown,
  };
}

function buildAverage(entities: ExecutionStatsEntitySummary[]): CostAverage {
  const seen = new Set<string>();
  const distinct = entities.filter((entity) => {
    if (seen.has(entity.id) || normalizeUsage(entity.usage).invocationCount === 0) return false;
    seen.add(entity.id);
    return true;
  });
  const provenance = combineProvenance(distinct);
  if (distinct.length === 0) return { ...unavailableAmount(provenance), entityCount: 0 };

  const spend = distinct.reduce(
    (sum, entity) => safeAdd(sum, normalizeUsage(entity.usage).totalCostUsd),
    0,
  );
  return { usd: spend / distinct.length, provenance, entityCount: distinct.length };
}

function buildCostOverTime(stats: ProjectExecutionStatsSnapshot, totalSpend: number): CostOverTimeRow[] {
  return stats.buckets.map((bucket) => {
    const usage = normalizeUsage(bucket.usage);
    const amount = amountFromUsage(bucket.usage);
    return {
      id: `${bucket.bucketStart}:${bucket.bucketEnd}`,
      bucketStart: bucket.bucketStart,
      bucketEnd: bucket.bucketEnd,
      label: bucket.label,
      amount,
      spendShare: finiteShare(amount.usd ?? 0, totalSpend),
      calls: usage.invocationCount,
      tokens: usage.totalTokens,
    };
  }).sort((left, right) => left.bucketStart.localeCompare(right.bucketStart, "en")
    || left.bucketEnd.localeCompare(right.bucketEnd, "en")
    || left.label.localeCompare(right.label, "en"));
}

function getCanonicalSprints(stats: ProjectExecutionStatsSnapshot): ProjectCostAnalyticsSummary["sprints"] {
  return stats.costAnalytics?.sprints ?? stats.sprints;
}

export function deriveCostAnalyticsViewModel(stats: ProjectExecutionStatsSnapshot): CostAnalyticsViewModel {
  const usage = normalizeUsage(stats.usage);
  const totalSpend = amountFromUsage(stats.usage);
  const totalSpendUsd = totalSpend.usd ?? 0;
  const totalTokens = usage.totalTokens;

  const models = stats.models.map((model: ExecutionModelStatsSummary): CostModelRow => ({
    ...buildDimensionRow(model, totalSpendUsd, totalTokens),
    provider: model.provider,
    model: model.model,
  })).sort(compareDimensionRows);
  const purposes = stats.purposes
    .map((purpose) => buildDimensionRow(purpose, totalSpendUsd, totalTokens))
    .sort(compareDimensionRows);
  const canonicalSprints = getCanonicalSprints(stats);

  return {
    totalSpend,
    costPerInvocation: divideAmount(totalSpend, usage.invocationCount),
    costPerMillionTokens: divideAmount(totalSpend, totalTokens, 1_000_000),
    averageCostPerTask: buildAverage(stats.tasks),
    averageCostPerSprint: buildAverage(canonicalSprints),
    calls: usage.invocationCount,
    tokens: totalTokens,
    costOverTime: buildCostOverTime(stats, totalSpendUsd),
    spendSegments: buildSpendSegments(stats.usage),
    tokenSegments: buildTokenSegments(stats.usage),
    models,
    purposes,
    tasks: buildDetailRows(stats.tasks, totalSpendUsd, totalTokens),
    sprints: buildDetailRows(canonicalSprints, totalSpendUsd, totalTokens),
  };
}

function formatProvenCurrency(usd: number, locale: DashboardLocale): string {
  if (usd === 0) return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(0);
  if (usd < 0.000001) return `<${new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 6 }).format(0.000001)}`;
  const fractionDigits = usd < 0.001 ? 6 : usd < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(usd);
}

export function formatAdaptiveCurrency(amount: CostAmount, locale: DashboardLocale = "en"): string {
  if (amount.usd === null || !Number.isFinite(amount.usd) || amount.provenance.state === "unavailable") {
    return translateDashboardMessage(statsMessages, locale, "unavailable");
  }
  if (amount.provenance.state === "unpriced") return translateDashboardMessage(statsMessages, locale, "unpriced");
  if (amount.provenance.state === "unknown" && amount.usd === 0) return translateDashboardMessage(statsMessages, locale, "coverageUnknown");

  const formatted = formatProvenCurrency(Math.max(0, amount.usd), locale);
  if (amount.provenance.state === "partial") return `${formatted}+`;
  if (amount.provenance.state === "unknown") return `${formatted} · ${translateDashboardMessage(statsMessages, locale, "coverageUnknown").toLocaleLowerCase(locale)}`;
  return formatted;
}
